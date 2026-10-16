'use strict';
// The shared faculty pages' actions (platform/public/kit/) on POST /api/session. Faculty sign in with the platform
// launch only; students join from the class link; Rehearse opens four practice students at one table.
const crypto = require('crypto');
const C = require('../data/config');
const R = require('./room');
const K = require('./kit');
const { store, keys } = require('./store');
const { faculty, launchFor, owns } = require('./guard');
const { reportCompletion } = require('./launch');
const { courseEnrolments, moveSessionRoster } = require('./course-enrolments');

const KIT_ACTIONS = new Set(['create', 'faculty_state', 'faculty_enrolments', 'group', 'rename_team', 'set_captain', 'control',
  'hide_session', 'course_sessions', 'course_session', 'entry', 'practice_start', 'practice_status', 'practice_finish']);
const isPracticeSub = sub => String(sub || '').startsWith('practice-');
const out = (status, body) => ({ status, body });
const busy = () => out(409, { error: 'busy_retry', message: 'The session changed while saving. Please try again.' });
async function put(key, fn) {
  for (let i = 0; i < 6; i++) {
    const cur = await store.get(key), next = fn(cur);
    if (next === undefined) return cur;
    if (await store.cas(key, cur, next)) return next;
  }
  return null;
}
async function pointCourse(fn) { try { await fn(); } catch (e) { console.error('course session pointer update failed', e.code || e.message); } }
async function tablesOf(sess) {
  const vals = await store.getMany(sess.tableIds.map(id => keys.table(sess.code, id)));
  return Object.fromEntries(sess.tableIds.map((id, i) => [id, vals[i]]));
}
const publicFaculty = (sess, roster) => {
  const { seed, ...rest } = sess;
  return { ...rest, mode: 'team', paused: false, walkthroughPending: roster ? K.walkthroughOf(sess, roster).pending : [] };
};

// Report each student whose table has an outcome: revision 1 at the deadline (or close), revision 2 with the review.
async function reportPeople(code, ids, revision) {
  const sess = await store.get(keys.session(code));
  if (!sess || sess.practice || !sess.platformAuth) return { sent: 0 };
  const roster = await store.get(keys.roster(code)), tables = await tablesOf(sess);
  let sent = 0;
  for (const id of ids || Object.keys(roster)) {
    const me = roster[id];
    if (!me || !id.startsWith('platform:') || !me.launchId || isPracticeSub(id.slice(9))) continue;
    const c = K.completion(sess, roster, id, me.table ? tables[me.table] : null, revision);
    if (!c) continue;
    const r = await reportCompletion({ launch: { sub: id.slice(9), sim: C.id, course: sess.courseId, run: me.launchId }, ...c }).catch(() => ({ ok: false }));
    if (r && r.ok) sent++;
  }
  return { sent };
}

async function courseList(courseId) {
  const list = (await store.get(keys.courseList(courseId))) || [];
  const p = await store.get(keys.course(courseId));
  return p && p.code && !list.some(x => x.code === p.code) ? [{ code: p.code, at: 0 }, ...list] : list;
}
async function otherOpen(courseId, except) {
  const found = [];
  for (const x of await courseList(courseId)) {
    if (x.code === except) continue;
    const s = await store.get(keys.session(x.code));
    if (s && s.kit && !s.practice && s.state !== 'closed') found.push(s);
  }
  return found;
}
const otherOpenReply = list => out(409, { error: 'other_session_open', open: list.map(x => ({ code: x.code, name: x.name })),
  message: `Starting closes the open session "${list[0].name || 'Who Pays for the Wire?'}". Tables that reached the deadline keep their outcomes.` });

// Close a session: an open negotiation reaches its deadline now, then the session closes and every student reports.
async function closeSession(req, b, code, now, settle, extra = {}) {
  const s0 = await store.get(keys.session(code));
  if (s0.phase === 'negotiation') { await put(keys.session(code), s => s.phase === 'negotiation' ? { ...s, phaseEndsAt: now } : undefined); await settle(code, now); }
  const next = await put(keys.session(code), s => ({ ...s, state: 'closed', closedAt: now, ...extra }));
  if (next.courseId && !next.practice) await pointCourse(() => put(keys.course(next.courseId), cur => cur && cur.code === code ? null : undefined));
  await reportPeople(code, null, 1);
  await moveSessionRoster(req, b, next, 'archive', await store.get(keys.roster(code)));
  return next;
}

// Import the class's approved students so faculty can split them into tables before they open the sim.
async function syncRoster(req, b, sess) {
  const roster = await courseEnrolments(req, b, sess);
  if (!roster.available || sess.state === 'closed') return roster;
  await put(keys.roster(sess.code), cur => {
    const next = { ...(cur || {}) }; let added = 0;
    for (const st of roster.students) {
      const id = String(st.participantId || '');
      if (st.accessReleased !== true || !/^platform:[A-Za-z0-9_-]+$/.test(id) || next[id] || !String(st.name || '').trim()) continue;
      next[id] = { name: String(st.name).trim().slice(0, 40), key: crypto.randomBytes(12).toString('base64url'), launch: { sub: id.slice(9), course: sess.courseId },
        joinedAt: null, table: null, seat: null, groupId: null, teamLabel: '', source: 'course' };
      added++;
    }
    return added ? next : undefined;
  });
  return roster;
}

async function owned(who, code) {
  if (!who) return { fail: out(401, { error: 'faculty_authorization_required' }) };
  const sess = await store.get(keys.session(String(code || '').toUpperCase()));
  if (!sess || !sess.kit) return { fail: out(404, { error: 'no_such_session' }) };
  const mine = sess.practice ? sess.facultyId === who.owner.sub && (sess.courseId || null) === (who.owner.course || null) : owns(sess, who);
  if (!mine) return { fail: out(403, { error: 'not_session_owner' }) };
  return { sess };
}

async function kitAction(a, req, b, now, settle) {
  const who = faculty(req, b), code = String(b.code || '').toUpperCase().trim();
  switch (a) {
    case 'create': {
      if (!who) return out(401, { error: 'faculty_authorization_required' });
      if (b.mode && b.mode !== 'team') return out(400, { error: 'play_mode_required', message: 'Who Pays for the Wire? is played in teams.' });
      const courseId = who.owner.course;
      if (courseId) {
        const open = await otherOpen(courseId, null);
        if (open.length && !b.closeOpen) return otherOpenReply(open);
        for (const s2 of open) await closeSession(req, b, s2.code, now, settle, { closedFrom: 'new-session' });
      }
      for (let i = 0; i < 5; i++) {
        const c = R.newCode();
        const sess = { ...R.newSession(c, who.name, now), owner: who.owner, ownerId: who.owner.sub, platformAuth: true, courseId: courseId || null,
          kit: true, state: 'lobby', mode: 'team', name: String(b.name || 'Who Pays for the Wire?').slice(0, 80), tableOf: {} };
        if (!await store.cas(keys.session(c), null, sess)) continue;
        await store.cas(keys.roster(c), null, {});
        if (courseId) {
          await pointCourse(() => put(keys.course(courseId), () => ({ code: c })));
          await pointCourse(() => put(keys.courseList(courseId), cur => [{ code: c, at: now }, ...(cur || []).filter(x => x.code !== c)].slice(0, 20)));
        }
        const joinUrl = joinUrlOf(sess);
        return out(200, { session: { ...publicFaculty(sess, {}), joinUrl }, you: who.name, joinUrl, code: c });
      }
      return busy();
    }

    case 'faculty_state': {
      const o = await owned(who, code); if (o.fail) return o.fail;
      const sess = await settle(code, now) || o.sess;
      const roster = (await store.get(keys.roster(code))) || {}, tables = await tablesOf(sess);
      const k = K.facultyKit(sess, roster, tables, now);
      return out(200, { session: { ...publicFaculty(sess, roster), joinUrl: sess.practice ? null : joinUrlOf(sess), clock: k.clock, ended: k.kit.ended },
        roster: Object.entries(roster).map(([id, p]) => ({ id, name: p.name, groupId: p.groupId || null, teamLabel: p.teamLabel || '' })),
        participants: k.participants, runs: k.runs, kit: k.kit, you: who.name, serverNow: now });
    }

    case 'faculty_enrolments': {
      const o = await owned(who, code); if (o.fail) return o.fail;
      const roster = (await store.get(keys.roster(code))) || {};
      if (o.sess.practice) return out(200, { available: true, practice: true, students: Object.entries(roster).map(([id, p]) => ({ participantId: id, name: p.name, accessReleased: true })), participants: {} });
      try { const r = await syncRoster(req, b, o.sess); return out(200, { ...r, participants: (await store.get(keys.roster(code))) || {} }); }
      catch (e) { return out(e.status || 503, { error: 'course_roster_unavailable', message: e.message || 'Course enrolment could not be refreshed.' }); }
    }

    case 'group': {
      const o = await owned(who, code); if (o.fail) return o.fail;
      if (o.sess.state !== 'lobby' || o.sess.tableIds.length) return out(409, { error: 'teams_locked', message: 'Tables are fixed once the session starts.' });
      const assign = b.assign && typeof b.assign === 'object' ? b.assign : {};
      let error = null;
      await put(keys.roster(code), cur => {
        const next = { ...cur };
        for (const [id, label] of Object.entries(assign)) {
          const p = next[id];
          if (!p) { error = out(404, { error: 'no_such_participant' }); return undefined; }
          const clean = String(label || '').trim().slice(0, 40);
          if (!clean || clean === '__unassigned__') { next[id] = { ...p, groupId: null, teamLabel: '' }; continue; }
          const mate = clean.startsWith('team:') && Object.values(next).find(x => x.groupId === clean);
          if (mate) { next[id] = { ...p, groupId: clean, teamLabel: mate.teamLabel || clean.slice(5) }; continue; }
          const norm = clean.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
          if (!norm) { error = out(400, { error: 'team_name_required' }); return undefined; }
          next[id] = { ...p, groupId: `team:${norm}`, teamLabel: clean };
        }
        return next;
      });
      return error || out(200, { ok: true });
    }

    case 'rename_team': {
      const o = await owned(who, code); if (o.fail) return o.fail;
      const gid = String(b.groupId || ''), label = String(b.teamLabel || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!gid.startsWith('team:') || !label) return out(400, { error: 'team_name_required' });
      let hit = 0;
      await put(keys.roster(code), cur => { hit = 0; const next = { ...cur }; for (const [id, p] of Object.entries(next)) if (p.groupId === gid) { next[id] = { ...p, teamLabel: label }; hit++; } return hit ? next : undefined; });
      if (!hit) return out(404, { error: 'no_such_team' });
      for (const id of o.sess.tableIds) await put(keys.table(code, id), t => t.groupId === gid ? { ...t, label } : undefined);
      return out(200, { ok: true });
    }

    // Every seat signs for itself, so there is no team lead to choose.
    case 'set_captain': {
      const o = await owned(who, code); if (o.fail) return o.fail;
      return out(200, { ok: true });
    }

    case 'control': {
      const o = await owned(who, code); if (o.fail) return o.fail;
      const set = String(b.set || '');
      let sess = await settle(code, now) || o.sess;
      if (set === 'start' || set === 'start_anyway') {
        if (sess.state !== 'lobby' || sess.tableIds.length) return out(409, { error: 'session_already_started' });
        const roster = (await store.get(keys.roster(code))) || {}, people = Object.values(roster);
        const counts = {};
        for (const p of people) if (p.groupId) counts[p.groupId] = (counts[p.groupId] || 0) + 1;
        if (!Object.keys(counts).length) return out(409, { error: 'participants_required', message: 'Split the class into tables of four before starting.' });
        const unassigned = people.filter(p => p.joinedAt && !p.groupId);
        if (unassigned.length) return out(409, { error: 'unassigned_participants', message: `${unassigned.length} student${unassigned.length === 1 ? ' is' : 's are'} still unassigned. Put every student at a table before starting.` });
        const small = Object.entries(counts).filter(([, n]) => n < 4);
        if (small.length) return out(409, { error: 'table_too_small', message: `Each table needs at least four students. ${small.map(([g]) => (people.find(p => p.groupId === g) || {}).teamLabel || g.slice(5)).join(', ')} ${small.length === 1 ? 'has' : 'have'} fewer.` });
        const pending = K.walkthroughOf(sess, roster).pending;
        if (pending.length && set !== 'start_anyway') return out(409, { error: 'walkthrough_incomplete', message: `Still reading the walkthrough: ${pending.join(', ')}. Wait for them, or press Start anyway.` });
        const seated = K.seatTeams(sess, roster);
        for (const [id, t] of Object.entries(seated.tables)) await put(keys.table(code, id), () => t);
        if (!await store.cas(keys.roster(code), roster, seated.roster)) return busy();
        const started = R.setPhase({ ...sess, tableIds: seated.tableIds }, 'briefing', now);
        const next = { ...started, state: 'running', startedAt: now, tableOf: seated.tableOf,
          ...(pending.length ? { walkthroughOverride: { at: now, by: who.name, participants: Object.entries(roster).filter(([, p]) => pending.includes(p.name)).map(([id, p]) => ({ id, name: p.name })) } } : {}) };
        if (!await store.cas(keys.session(code), sess, next)) return busy();
        return out(200, { session: publicFaculty(next, seated.roster) });
      }
      if (set === 'openings' || set === 'negotiation') {
        if (sess.state !== 'running') return out(409, { error: 'session_not_running' });
        let next;
        try { next = R.setPhase(sess, set, now); } catch (e) { return out(409, { error: 'wrong_phase', message: e.message }); }
        if (!await store.cas(keys.session(code), sess, next)) return busy();
        return out(200, { session: publicFaculty(next) });
      }
      if (set === 'extend') {
        let next;
        try { next = R.extend(sess); } catch (e) { return out(409, { error: 'cannot_extend', message: e.message }); }
        if (!await store.cas(keys.session(code), sess, next)) return busy();
        return out(200, { session: publicFaculty(next) });
      }
      if (set === 'close_sheet') {
        if (sess.phase !== 'negotiation') return out(409, { error: 'not_negotiating', message: 'Only negotiation can be closed.' });
        await put(keys.session(code), s => s.phase === 'negotiation' ? { ...s, phaseEndsAt: now } : undefined);
        sess = await settle(code, now);
        return out(200, { session: publicFaculty(sess) });
      }
      const notice = set.match(/^notice__(T\d+)__([a-z]+)$/);
      if (notice) {
        if (sess.phase !== 'negotiation' || !sess.tableIds.includes(notice[1])) return out(409, { error: 'not_negotiating' });
        try { await put(keys.table(code, notice[1]), t => R.addNotice(t, notice[2], now)); } catch (e) { return out(400, { error: 'unknown_notice' }); }
        return out(200, { session: publicFaculty(sess) });
      }
      if (set === 'close') {
        if (sess.state === 'closed') return out(409, { error: 'session_closed' });
        const next = await closeSession(req, b, code, now, settle);
        return out(200, { session: publicFaculty(next) });
      }
      if (set === 'reopen') {
        if (sess.state !== 'closed') return out(409, { error: 'session_not_closed' });
        if (!sess.practice && sess.courseId) {
          const open = await otherOpen(sess.courseId, code);
          if (open.length && !b.closeOpen) return otherOpenReply(open);
          for (const s2 of open) await closeSession(req, b, s2.code, now, settle, { closedFrom: 'new-session' });
        }
        const next = await put(keys.session(code), s => ({ ...s, state: s.tableIds.length ? 'running' : 'lobby', closedAt: null, reopenedAt: now }));
        if (next.courseId && !next.practice) await pointCourse(() => put(keys.course(next.courseId), () => ({ code })));
        await moveSessionRoster(req, b, next, 'restore', await store.get(keys.roster(code)));
        return out(200, { session: publicFaculty(next) });
      }
      return out(400, { error: 'unknown_control' });
    }

    case 'hide_session': {
      const o = await owned(who, code); if (o.fail) return o.fail;
      if (o.sess.state !== 'closed') return out(409, { error: 'session_open', message: 'Close the session first. Then you can hide it.' });
      await put(keys.session(code), s => ({ ...s, hidden: true, hiddenAt: now }));
      return out(200, { ok: true });
    }

    // The class's sessions, newest first, for the Sessions page.
    case 'course_sessions': {
      if (!who) return out(401, { error: 'faculty_authorization_required' });
      if (!who.owner.course) return out(200, { sessions: [] });
      const sessions = [];
      for (const x of (await courseList(who.owner.course)).slice(0, 20)) {
        const s2 = await store.get(keys.session(x.code));
        if (!s2 || !s2.kit || s2.practice || s2.hidden || !owns(s2, who)) continue;
        const roster = (await store.get(keys.roster(x.code))) || {};
        const k = K.facultyKit(s2, roster, await tablesOf(s2), now), list = Object.values(k.runs);
        sessions.push({ code: s2.code, name: s2.name, mode: 'team', state: s2.state, paused: false, createdAt: s2.createdAt || null,
          students: Object.values(roster).filter(p => p.joinedAt).length, teams: list.length, submitted: list.filter(r => r.done).length });
      }
      sessions.sort((p, q) => (q.createdAt || 0) - (p.createdAt || 0));
      return out(200, { sessions });
    }

    // A student opening the class link lands in the class's open session, or a practice student in theirs.
    case 'entry':
    case 'course_session': {
      const p = launchFor(req, b);
      if (!p) return out(401, { error: 'sign_in_required' });
      if (!p.course) return out(200, { code: null });
      if (isPracticeSub(p.sub)) {
        const owner = String(p.sub).slice('practice-'.length).replace(/-[^-]+$/, '');
        return out(200, { code: (await store.get(keys.practice(p.course, owner))) || null });
      }
      const room = await store.get(keys.course(p.course));
      const s2 = room && room.code && await store.get(keys.session(room.code));
      return out(200, { code: s2 && s2.courseId === p.course && s2.state !== 'closed' ? s2.code : null });
    }

    // Rehearse: four practice students at one table, one per seat, outside the class's sessions.
    case 'practice_start':
    case 'practice_status':
    case 'practice_finish': {
      if (!who) return out(401, { error: 'faculty_authorization_required' });
      if (!who.owner.course) return out(403, { error: 'course_launch_required' });
      const pkey = keys.practice(who.owner.course, who.owner.sub);
      const current = await store.get(pkey), existing = current ? await store.get(keys.session(current)) : null;
      const mine = existing && existing.practice && existing.facultyId === who.owner.sub ? existing : null;
      const progressOf = async s2 => {
        const roster = (await store.get(keys.roster(s2.code))) || {}, tables = await tablesOf(s2);
        const students = Object.values(roster).map(p => {
          const t = p.table ? tables[p.table] : null, finished = !!(t && t.result);
          const status = p.review ? 'Sent the review' : finished ? 'Reading the outcome' : !p.joinedAt ? 'Ready to start'
            : s2.phase === 'lobby' ? (R.walkthroughComplete(s2, p) ? 'Walkthrough done' : 'Reading the walkthrough')
            : ({ briefing: 'Reading the brief', openings: 'Opening statements', negotiation: 'Negotiating' })[s2.phase] || 'Waiting';
          return { name: p.name, status, finished };
        });
        return { students, complete: students.length > 0 && students.every(x => x.finished) };
      };
      const wipe = async s2 => { for (const k of [keys.session(s2.code), keys.roster(s2.code), ...s2.tableIds.map(id => keys.table(s2.code, id))]) await put(k, () => null); };
      if (a === 'practice_status') return out(200, mine ? { code: current, ...(await progressOf(mine)) } : { code: null });
      if (a === 'practice_finish') { if (mine) await wipe(mine); await put(pkey, () => null); return out(200, { ok: true }); }
      if (mine && b.startOver !== true) return out(200, { code: current, resumed: true, ...(await progressOf(mine)) });
      if (mine) await wipe(mine);
      const students = (Array.isArray(b.students) ? b.students : []).filter(y => y && typeof y.sub === 'string' && y.sub.startsWith(`practice-${who.owner.sub}-`) &&
        /^[A-Za-z0-9_-]{1,160}$/.test(y.sub) && typeof y.name === 'string' && y.name.trim()).slice(0, 4);
      if (students.length < 4) return out(400, { error: 'practice_students_required', message: 'Rehearse needs four practice students, one per seat.' });
      for (let i = 0; i < 5; i++) {
        const c = R.newCode();
        const sess = { ...R.newSession(c, who.name, now), owner: who.owner, ownerId: who.owner.sub, facultyId: who.owner.sub, platformAuth: true,
          courseId: who.owner.course, kit: true, practice: true, state: 'lobby', mode: 'team', name: 'Practice', tableOf: {} };
        if (!await store.cas(keys.session(c), null, sess)) continue;
        const roster = Object.fromEntries(students.map(x => [`platform:${x.sub}`, { name: x.name.trim().slice(0, 40), key: crypto.randomBytes(12).toString('base64url'),
          launch: { sub: x.sub, course: who.owner.course }, joinedAt: null, table: null, seat: null, groupId: 'team:practice-table', teamLabel: 'Practice table', source: 'practice' }]));
        await store.cas(keys.roster(c), null, roster);
        await put(pkey, () => c);
        return out(200, { code: c, students: students.map(x => ({ participantId: `platform:${x.sub}`, name: x.name, status: 'Ready to start', finished: false })) });
      }
      return busy();
    }
  }
  return null;
}

function joinUrlOf(sess) {
  const base = (process.env.PLATFORM_URL || 'https://rapidsims.flexee.org').replace(/\/+$/, '');
  const url = new URL(base + '/session.html');
  url.searchParams.set('sim', C.id); url.searchParams.set('session', sess.code);
  if (sess.courseId) url.searchParams.set('course', sess.courseId);
  return url.href;
}

module.exports = { KIT_ACTIONS, kitAction, reportPeople, isPracticeSub };
