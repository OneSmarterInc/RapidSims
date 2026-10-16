'use strict';
// One endpoint, action-dispatched, matching the other team-mode sims.
// Every write is compare-and-set with retry, so four seats on one table never overwrite each other.
const { store, keys } = require('../lib/store');
const { body, faculty, entrant, owns, participant } = require('../lib/guard');
const { announce } = require('../lib/launch');
const R = require('../lib/room');
const T = require('../engine/table');
const { walkthrough } = require('../data/content');
const K = require('../lib/kit');

const FACULTY_ACTIONS = new Set([]);
const TABLE_ACTIONS = { move: T.move, sign: T.sign, unsign: T.unsign, unlock: T.unlock };
const clone = v => JSON.parse(JSON.stringify(v));
const busy = () => Object.assign(new Error('busy_retry'), { status: 409 });
const reject = (m, status = 400) => Object.assign(new Error(m), { status });

async function retry(fn) {
  for (let i = 0; i < 6; i++) { const r = await fn(); if (r !== undefined) return r; }
  throw busy();
}

async function loadTables(code, ids) {
  const vals = await store.getMany(ids.map(id => keys.table(code, id)));
  return Object.fromEntries(ids.map((id, i) => [id, vals[i]]));
}

// Lazy deadline: whichever request first arrives after the clock runs out closes every table.
async function settleDeadline(code, now) {
  let sess = await store.get(keys.session(code));
  if (!sess || !R.dueToClose(sess, now)) return sess;
  for (const id of sess.tableIds) {
    await retry(async () => {
      const t = await store.get(keys.table(code, id));
      if (t.phase === 'closed') return true;
      const next = T.closeTable(clone(t), now);
      return (await store.cas(keys.table(code, id), t, next)) ? true : undefined;
    });
  }
  const closed = await retry(async () => {
    const s = await store.get(keys.session(code));
    if (s.phase !== 'negotiation') return s;
    const next = { ...s, phase: 'closed', phaseEndsAt: null, deadlineAt: now };
    return (await store.cas(keys.session(code), s, next)) ? { ...next, justClosed: true } : undefined;
  });
  // The deadline is each student's outcome: revision 1 reports once, from whichever request closed the tables.
  if (closed.justClosed) { delete closed.justClosed; await require('../lib/kit-api').reportPeople(code, null, 1); }
  return closed;
}

async function studentAction(a, req, b, now) {
  const code = String(b.code || '').toUpperCase().trim();
  if (a === 'join') {
    const who = entrant(req, b);
    if (!who) throw reject('sign_in_required', 401);
    const sess = await store.get(keys.session(code));
    if (!sess) throw reject('no_such_session', 404);
    if (sess.state === 'closed') throw reject('session_closed', 410);
    if (!sess.practice && require('../lib/kit-api').isPracticeSub(who.launch.sub)) throw reject('practice_only', 403);
    if (sess.platformAuth && (!who.launch || (sess.courseId && who.launch.course !== sess.courseId))) throw reject('wrong_course', 403);
    const name = b.name || (who.launch && who.launch.name);
    return retry(async () => {
      const roster = await store.get(keys.roster(code));
      const existing = who.launch && roster['platform:' + who.launch.sub];
      if (existing) {
        if ((existing.launch.course || null) !== (who.launch.course || null)) throw reject('wrong_course', 403);
        // A student imported from the class roster opens the sim for the first time.
        if (!existing.joinedAt || existing.launchId !== who.launch.run) {
          const next = { ...roster, ['platform:' + who.launch.sub]: { ...existing, name: who.launch.name || existing.name, joinedAt: existing.joinedAt || now, launchId: who.launch.run || null, launch: { ...existing.launch, ...who.launch } } };
          if (!await store.cas(keys.roster(code), roster, next)) return undefined;
        }
        return { participantId: 'platform:' + who.launch.sub, participantKey: existing.key, rejoined: true };
      }
      const current = await store.get(keys.session(code));
      if (current.practice) throw reject('private_session', 403);
      if (current.state !== 'lobby' || current.tableIds.length) throw reject('seating_closed', 409);
      const j = R.join(roster, name, who.launch, now);
      j.roster[j.pid] = { ...j.roster[j.pid], groupId: null, teamLabel: '', launchId: who.launch.run || null };
      return (await store.cas(keys.roster(code), roster, j.roster)) ? { participantId: j.pid, participantKey: j.key } : undefined;
    });
  }
  const pid = String(b.participantId || '');
  let sess = await store.get(keys.session(code));
  if (!sess) throw reject('no_such_session', 404);
  const roster = await store.get(keys.roster(code));
  const me = roster[pid];
  if (!participant(req, b, sess, me)) throw reject('not_joined', 403);
  sess = await settleDeadline(code, now);

  if (a === 'view') {
    const table = me.table ? await store.get(keys.table(code, me.table)) : null;
    return withReview(R.studentView(sess, roster, pid, table, now), me, table);
  }
  // A student's two review answers, after the deadline. Revision 2 of the same completion.
  if (a === 'review') {
    const table = me.table ? await store.get(keys.table(code, me.table)) : null;
    if (!table || !table.result) throw reject('not_finished', 409);
    const r1 = String(b.reflection1 || '').trim().slice(0, 1500), r2 = String(b.reflection2 || '').trim().slice(0, 1500);
    if (!r1 || !r2) throw reject('answers_required', 400);
    const next = await retry(async () => {
      const cur = await store.get(keys.roster(code)), upd = { ...cur, [pid]: { ...cur[pid], review: { reflection1: r1, reflection2: r2, at: now } } };
      return (await store.cas(keys.roster(code), cur, upd)) ? upd : undefined;
    });
    await require('../lib/kit-api').reportPeople(code, [pid], 2);
    return withReview(R.studentView(sess, next, pid, table, now), next[pid], table);
  }
  if (a === 'walkthrough') {
    if (sess.phase !== 'lobby' || sess.walkthroughVersion !== 1) throw reject('walkthrough_closed', 409);
    return retry(async () => {
      const current = await store.get(keys.roster(code)), person = current[pid], step = Number(b.step);
      const previous = person.walkthroughStep || 0;
      if (!Number.isInteger(step) || step < 1 || step > walkthrough.length || step > previous + 1) throw reject('invalid_walkthrough_step');
      const next = { ...current, [pid]: { ...person, walkthroughStep: Math.max(previous, step) } };
      if (!await store.cas(keys.roster(code), current, next)) return undefined;
      const table = person.table ? await store.get(keys.table(code, person.table)) : null;
      return R.studentView(sess, next, pid, table, now);
    });
  }
  const op = TABLE_ACTIONS[a];
  if (!op) throw reject('unknown_action');
  if (!R.canNegotiate(sess, now)) throw reject('not_negotiating', 409);
  if (!me.table) throw reject('not_seated', 409);
  return retry(async () => {
    const t = await store.get(keys.table(code, me.table));
    const next = clone(t);
    if (a === 'move') op(next, me.seat, String(b.dial), Number(b.value), now);
    else if (a === 'unlock') op(next, me.seat, String(b.group), now);
    else op(next, me.seat, String(b.dial), now);
    return (await store.cas(keys.table(code, me.table), t, next)) ? R.studentView(sess, roster, pid, next, now) : undefined;
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!store.configured()) return res.status(503).json({ error: 'no_store' });
  const b = body(req), a = String(b.action || ''), now = Date.now();
  await announce();
  try {
    const KA = require('../lib/kit-api');
    if (KA.KIT_ACTIONS.has(a)) {
      const r = await KA.kitAction(a, req, b, now, settleDeadline);
      return res.status(r.status).json(r.body);
    }
    return res.status(200).json(await studentAction(a, req, b, now));
  } catch (e) {
    if (e.code === 'REJECTED') return res.status(400).json({ error: e.message });
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('session failed', e);
    return res.status(503).json({ error: 'session_unavailable' });
  }
};
module.exports.settleDeadline = settleDeadline;

// After the deadline: the four questions and, for a signed-in student, the review.
function withReview(view, me, table) {
  if (table && table.label) view = { ...view, tableLabel: table.label };
  if (!table || !table.result) return view;
  return { ...view, afterReveal: K.LESSON_QUESTIONS, review: { open: true, questions: K.REVIEW_QUESTIONS, sent: !!(me && me.review) } };
}
