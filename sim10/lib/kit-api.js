'use strict';
// The shared faculty pages' actions (platform/public/kit/), on POST /api/session with an action. Faculty sign in
// with the platform launch only. Students join from the class link; a practice student opens their own run.
const crypto = require('crypto');
const config = require('../data/config');
const E = require('./engine');
const K = require('./kit');
const L = require('./launch');
const { courseEnrolments, moveSessionRoster } = require('./course-enrolments');

const newCode = () => { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (const x of crypto.randomBytes(5)) s += a[x % a.length]; return s; };
const newId = () => crypto.randomBytes(12).toString('hex');
const isPracticeSub = sub => String(sub || '').startsWith('practice-');
const KEY = {
  pointer: c => `s10:course:${c}`,
  list: c => `s10:course:${c}:sessions`,
  practice: (c, o) => `s10:practice:${c}:${o}`
};
const out = (status, body) => ({ status, body });

function facultyOf(launch) {
  if (!launch || !L.isFaculty(launch)) return null;
  return { name: launch.name || 'Facilitator', userId: launch.sub, platformAuth: true, courseId: launch.course || null };
}
function owns(who, s) {
  if (!who) return false;
  if (s.practice) return s.facultyId === who.userId && (s.courseId || null) === (who.courseId || null);
  if (s.solo || !s.kit) return false;
  if (s.courseId && s.courseId !== who.courseId) return false;
  return s.ownerId === who.userId;
}
async function pointCourse(fn) { try { await fn(); } catch (e) { console.error('course session pointer update failed', e.code || e.message); } }
async function courseList(store, courseId) {
  const list = (await store.get(KEY.list(courseId))) || [];
  const p = await store.get(KEY.pointer(courseId));
  return p && !list.some(x => x.code === p) ? [{ code: p, at: 0 }, ...list] : list;
}
async function addToCourse(store, s) {
  const list = ((await store.get(KEY.list(s.courseId))) || []).filter(x => x.code !== s.code);
  await store.set(KEY.list(s.courseId), [{ code: s.code, at: s.createdAt }, ...list].slice(0, 20));
}
async function clearPointer(store, courseId, code) { if ((await store.get(KEY.pointer(courseId))) === code) await store.del(KEY.pointer(courseId)); }

function newSession(fields) {
  const cases = fields.cases || ['A', 'B'];
  return { code: fields.code, simId: config.simId, kit: true, mode: fields.mode, cases, teams: null, teamIds: null,
    clock: { ...config.clock[`${cases.length}-${fields.mode}`] }, createdAt: fields.now, hostKey: newId(),
    platformAuth: true, courseId: fields.courseId || null, owner: fields.owner || null, ownerId: fields.ownerId || null,
    name: String(fields.name || config.title).slice(0, 80), state: 'lobby',
    runs: Object.fromEntries(cases.map(c => [c, { startedAt: null, reveal: 0 }])),
    projected: Object.fromEntries(cases.map(c => [c, { pair: null, opposing: null }])), showHeld: false,
    ...(fields.extra || {}) };
}

// Report each student whose run is over: revision 1 at the last outcome (or close), revision 2 with their review.
async function reportPeople(store, s, ids, now, revision) {
  if (s.practice || !s.platformAuth) return { sent: 0 };
  const people = await K.participants(store, s);
  let sent = 0;
  for (const id of ids || Object.keys(people)) {
    const me = people[id];
    if (!me || !id.startsWith('platform:') || !me.launchId || isPracticeSub(id.slice(9))) continue;
    const c = await K.completion(store, s, people, id, now, revision);
    if (!c) continue;
    const r = await L.reportCompletion({ launch: { sub: id.slice(9), sim: config.simId, course: s.courseId, run: me.launchId }, ...c }).catch(() => ({ ok: false }));
    if (r && r.ok) sent++;
  }
  return { sent };
}

async function otherOpen(store, courseId, except) {
  const out2 = [];
  for (const x of await courseList(store, courseId)) {
    if (x.code === except) continue;
    const s2 = await store.get(E.K.sess(x.code));
    if (s2 && !s2.practice && s2.state !== 'closed') out2.push(s2);
  }
  return out2;
}
async function closeSession(store, req, b, s, now, extra = {}) {
  const next = { ...s, state: 'closed', closedAt: now, ...extra };
  await store.set(E.K.sess(s.code), next);
  if (next.courseId && !next.practice) await pointCourse(() => clearPointer(store, next.courseId, s.code));
  await reportPeople(store, next, null, now, 1);
  await moveSessionRoster(req, b, next, 'archive', await K.participants(store, next));
  return next;
}
const otherOpenReply = list => out(409, { error: 'other_session_open', open: list.map(x => ({ code: x.code, name: x.name })),
  message: `Starting closes the open session "${list[0].name || config.title}". Students keep the calls they recorded.` });

// Import the class's approved students into a team session, so faculty can split them before they open it.
async function syncRoster(store, req, b, s) {
  const roster = await courseEnrolments(req, b, s);
  if (!roster.available || s.mode !== 'team' || s.state === 'closed') return roster;
  for (const st of roster.students) {
    if (st.accessReleased !== true || !/^platform:[A-Za-z0-9_-]+$/.test(String(st.participantId || '')) || !String(st.name || '').trim()) continue;
    const added = await store.setnx(E.K.part(s.code, st.participantId), { pid: st.participantId, name: String(st.name).trim().slice(0, 60), groupId: null, teamLabel: '', team: null, source: 'course', joinedAt: null });
    if (added) await store.sadd(E.K.pids(s.code), st.participantId);
  }
  return roster;
}
const approvedIds = roster => (roster && roster.available ? new Set(roster.students.filter(p => p.accessReleased === true).map(p => p.participantId)) : null);

async function owned(store, who, code) {
  if (!who) return { fail: out(401, { error: 'faculty_authorization_required' }) };
  const s = await store.get(E.K.sess(String(code || '').toUpperCase()));
  if (!s) return { fail: out(404, { error: 'no_such_session' }) };
  if (!owns(who, s)) return { fail: out(403, { error: 'not_your_session' }) };
  return { s };
}

function studentLaunch(launch) { return launch && launch.sub && L.ROLES.includes(launch.role) ? launch : null; }

const PRACTICE_STATUS = { read: 'Reading', verdict: 'Making the call', private: 'Making the call', team: 'Making the call' };

async function kitAction(req, b, launch, store, now) {
  const action = String(b.action || ''), code = String(b.code || '').toUpperCase().trim(), who = facultyOf(launch);
  switch (action) {
    case 'create': {
      if (!who) return out(401, { error: 'faculty_authorization_required' });
      const mode = String(b.mode || '');
      if (!['individual', 'team'].includes(mode)) return out(400, { error: 'play_mode_required' });
      if (who.courseId) {
        const open = await otherOpen(store, who.courseId, null);
        if (open.length && !b.closeOpen) return otherOpenReply(open);
        for (const s2 of open) await closeSession(store, req, b, s2, now, { closedFrom: 'new-session' });
      }
      let c; for (let i = 0; i < 5; i++) { c = newCode(); if (!(await store.get(E.K.sess(c)))) break; }
      const s = newSession({ code: c, mode, now, courseId: who.courseId, owner: who.name, ownerId: who.userId, name: b.name });
      await store.set(E.K.sess(c), s);
      if (s.courseId) { await pointCourse(() => addToCourse(store, s)); await pointCourse(() => store.set(KEY.pointer(s.courseId), c)); }
      const joinUrl = E.platformJoinUrl(s);
      return out(200, { session: { ...publicFaculty(s), joinUrl }, you: who.name, joinUrl });
    }

    case 'faculty_state': {
      const o = await owned(store, who, code); if (o.fail) return o.fail;
      const k = await K.facultyKit(store, o.s, now);
      const roster = Object.values(k.people).map(p => ({ id: p.pid, name: p.name, groupId: p.groupId || null, teamLabel: p.teamLabel || '' }));
      return out(200, { session: { ...publicFaculty(o.s), joinUrl: o.s.practice ? null : E.platformJoinUrl(o.s), clock: k.clock, ended: k.kit.ended },
        roster, participants: k.participants, runs: k.runs, kit: k.kit, you: who.name, serverNow: now });
    }

    case 'faculty_enrolments': {
      const o = await owned(store, who, code); if (o.fail) return o.fail;
      if (o.s.practice) {
        const people = Object.values(await K.participants(store, o.s));
        return out(200, { available: true, practice: true, students: people.map(p => ({ participantId: p.pid, name: p.name, accessReleased: true })), participants: {} });
      }
      try { const roster = await syncRoster(store, req, b, o.s); return out(200, { ...roster, participants: await K.participants(store, o.s) }); }
      catch (e) { return out(e.status || 503, { error: 'course_roster_unavailable', message: e.message || 'Course enrolment could not be refreshed.' }); }
    }

    case 'group': {
      const o = await owned(store, who, code); if (o.fail) return o.fail;
      const s = o.s;
      if (s.mode !== 'team') return out(409, { error: 'not_team_mode' });
      if (s.state !== 'lobby') return out(409, { error: 'teams_locked', message: 'Teams are fixed once the session starts.' });
      const allowed = approvedIds(s.courseId ? await syncRoster(store, req, b, s).catch(() => null) : null);
      const people = await K.participants(store, s);
      const assign = b.assign && typeof b.assign === 'object' ? b.assign : {};
      const next = {};
      for (const [id, label] of Object.entries(assign)) {
        const p = people[id];
        if (!p) return out(404, { error: 'no_such_participant' });
        const clean = String(label || '').trim().slice(0, 40);
        if (!clean || clean === '__unassigned__') { next[id] = { ...p, groupId: null, teamLabel: '', team: null }; continue; }
        if (allowed && !allowed.has(id)) return out(403, { error: 'student_not_approved' });
        // The Teams tab moves a student into an existing team by its id.
        const mate = clean.startsWith('team:') && Object.values(people).find(x => x.groupId === clean);
        if (mate) { next[id] = { ...p, groupId: clean, teamLabel: mate.teamLabel || clean.slice(5), team: null }; continue; }
        const norm = clean.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
        if (!norm) return out(400, { error: 'team_name_required' });
        next[id] = { ...p, groupId: `team:${norm}`, teamLabel: clean, team: null };
      }
      for (const [id, rec] of Object.entries(next)) await store.set(E.K.part(s.code, id), rec);
      return out(200, { ok: true });
    }

    case 'rename_team': {
      const o = await owned(store, who, code); if (o.fail) return o.fail;
      const gid = String(b.groupId || ''), label = String(b.teamLabel || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!gid.startsWith('team:') || !label) return out(400, { error: 'team_name_required' });
      let hit = 0;
      for (const p of Object.values(await K.participants(store, o.s))) if (p.groupId === gid) { await store.set(E.K.part(o.s.code, p.pid), { ...p, teamLabel: label }); hit++; }
      return hit ? out(200, { ok: true }) : out(404, { error: 'no_such_team' });
    }

    // Any member commits the team's call, so there is no team lead to choose.
    case 'set_captain': {
      const o = await owned(store, who, code); if (o.fail) return o.fail;
      return out(200, { ok: true });
    }

    case 'control': {
      const o = await owned(store, who, code); if (o.fail) return o.fail;
      const s = o.s, set = String(b.set || '');
      let next;
      if (set === 'cases_one' || set === 'cases_two') {
        if (s.state !== 'lobby') return out(409, { error: 'session_already_started' });
        const cases = set === 'cases_one' ? ['A'] : ['A', 'B'];
        next = { ...s, cases, clock: { ...config.clock[`${cases.length}-${s.mode}`] },
          runs: Object.fromEntries(cases.map(c => [c, { startedAt: null, reveal: 0 }])),
          projected: Object.fromEntries(cases.map(c => [c, { pair: null, opposing: null }])) };
      } else if (set === 'start') {
        if (s.state !== 'lobby') return out(409, { error: 'session_already_started' });
        next = { ...s, state: 'running', startedAt: now, runs: { ...s.runs, A: { ...s.runs.A, startedAt: now } } };
        if (s.mode === 'team') {
          const people = Object.values(await K.participants(store, s));
          const joined = people.filter(p => p.joinedAt || p.groupId);
          const unassigned = people.filter(p => p.joinedAt && !p.groupId);
          if (!people.some(p => p.groupId)) return out(409, { error: 'participants_required', message: 'Assign at least one student to a team before starting.' });
          if (unassigned.length) return out(409, { error: 'unassigned_participants', count: unassigned.length,
            message: `${unassigned.length} student${unassigned.length === 1 ? ' is' : 's are'} still unassigned. Assign every student to a team before starting.` });
          next.teamIds = [...new Set(joined.map(p => p.groupId).filter(Boolean))];
          for (const p of joined) if (p.groupId) await store.set(E.K.part(s.code, p.pid), { ...p, team: p.groupId });
        }
      } else if (set === 'advance') {
        if (s.state !== 'running') return out(409, { error: 'session_not_running' });
        const cs = E.activeCase(s), ph = E.phaseOf(s, cs, now);
        if (!ph.endsAt || ph.name === 'closed' || ph.name === 'waiting') return out(409, { error: 'nothing_to_advance' });
        // The current part ends now: the case's clock moves forward by the time left.
        next = { ...s, runs: { ...s.runs, [cs]: { ...s.runs[cs], startedAt: s.runs[cs].startedAt - (ph.endsAt - now) } } };
      } else if (set === 'reveal') {
        if (s.state !== 'running') return out(409, { error: 'session_not_running' });
        const cs = E.activeCase(s);
        if (E.phaseOf(s, cs, now).name !== 'closed') return out(409, { error: 'clock_running', message: 'The reveal opens after the clock runs out.' });
        if (s.runs[cs].reveal >= 3) return out(409, { error: 'reveal_complete' });
        next = { ...s, runs: { ...s.runs, [cs]: { ...s.runs[cs], reveal: s.runs[cs].reveal + 1 } } };
      } else if (set === 'start_b') {
        if (s.state !== 'running' || !s.cases.includes('B') || s.runs.B.startedAt) return out(409, { error: 'cannot_start_b' });
        if (s.runs.A.reveal < 3) return out(409, { error: 'reveal_first', message: 'Show what happened to company 1 before starting company 2.' });
        next = { ...s, runs: { ...s.runs, B: { ...s.runs.B, startedAt: now } } };
      } else if (set === 'close') {
        if (s.state === 'closed') return out(409, { error: 'session_closed' });
        next = await closeSession(store, req, b, s, now);
        return out(200, { session: publicFaculty(next) });
      } else if (set === 'reopen') {
        if (s.state !== 'closed') return out(409, { error: 'session_not_closed' });
        if (!s.practice && s.courseId) {
          const open = await otherOpen(store, s.courseId, code);
          if (open.length && !b.closeOpen) return otherOpenReply(open);
          for (const s2 of open) await closeSession(store, req, b, s2, now, { closedFrom: 'new-session' });
        }
        // Each case's clock continues from where it was closed.
        const shift = now - (s.closedAt || now), runs = {};
        for (const [c, r] of Object.entries(s.runs)) runs[c] = r.startedAt && E.phaseOf(s, c, s.closedAt || now).name !== 'closed' ? { ...r, startedAt: r.startedAt + shift } : r;
        next = { ...s, runs, state: s.runs.A.startedAt ? 'running' : 'lobby', closedAt: null, reopenedAt: now };
      } else return out(400, { error: 'unknown_control' });
      if (!await store.compareAndSet(E.K.sess(s.code), s, next)) return out(409, { error: 'busy_retry', message: 'The session changed while saving. Please try again.' });
      if (set === 'reopen') {
        if (next.courseId && !next.practice) await pointCourse(() => store.set(KEY.pointer(next.courseId), code));
        await moveSessionRoster(req, b, next, 'restore', await K.participants(store, next));
      }
      // The last company's outcome ends the run: every student reports.
      if (set === 'reveal' && K.finished(next, now) && !K.finished(s, now)) await reportPeople(store, next, null, now, 1);
      return out(200, { session: publicFaculty(next) });
    }

    case 'hide_session': {
      const o = await owned(store, who, code); if (o.fail) return o.fail;
      if (o.s.state !== 'closed') return out(409, { error: 'session_open', message: 'Close the session first. Then you can hide it.' });
      await store.set(E.K.sess(o.s.code), { ...o.s, hidden: true, hiddenAt: now });
      return out(200, { ok: true });
    }

    // The class's sessions, newest first, for the Sessions page.
    case 'course_sessions': {
      if (!who) return out(401, { error: 'faculty_authorization_required' });
      if (!who.courseId) return out(200, { sessions: [] });
      const sessions = [];
      for (const x of (await courseList(store, who.courseId)).slice(0, 20)) {
        const s2 = await store.get(E.K.sess(x.code));
        if (!s2 || s2.practice || s2.hidden || !owns(who, s2)) continue;
        const k = await K.facultyKit(store, s2, now), list = Object.values(k.runs);
        sessions.push({ code: s2.code, name: s2.name, mode: s2.mode, state: s2.state, paused: false, createdAt: s2.createdAt || null,
          students: Object.values(k.people).filter(p => p.joinedAt).length, teams: s2.mode === 'team' ? list.length : 0, submitted: list.filter(r => r.done).length });
      }
      sessions.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
      return out(200, { sessions });
    }

    // A student opening the class link lands in the class's open session, or a practice student in theirs.
    case 'course_session': {
      const p = studentLaunch(launch);
      if (!p) return out(401, { error: 'platform_signin_required' });
      if (!p.course) return out(200, { code: null });
      if (isPracticeSub(p.sub)) {
        const owner = String(p.sub).slice('practice-'.length).replace(/-[^-]+$/, '');
        return out(200, { code: (await store.get(KEY.practice(p.course, owner))) || null });
      }
      const open = await store.get(KEY.pointer(p.course));
      const s2 = open ? await store.get(E.K.sess(open)) : null;
      return out(200, { code: s2 && s2.state !== 'closed' && s2.courseId === p.course ? open : null });
    }

    // Rehearse: one practice student on a private run of their own, outside the class's sessions.
    case 'practice_start':
    case 'practice_status':
    case 'practice_finish': {
      if (!who) return out(401, { error: 'faculty_authorization_required' });
      if (!who.courseId || !who.userId) return out(403, { error: 'course_launch_required' });
      const key = KEY.practice(who.courseId, who.userId);
      const current = await store.get(key);
      const existing = current ? await store.get(E.K.sess(current)) : null;
      const mine = existing && owns(who, existing) ? existing : null;
      const wipe = async (s2) => {
        const pids = await store.smembers(E.K.pids(s2.code)), keys = [E.K.sess(s2.code), E.K.pids(s2.code)];
        for (const p of pids) { keys.push(E.K.part(s2.code, p), E.K.report(s2.code, p)); for (const c of s2.cases) keys.push(E.K.resp(s2.code, c, p)); }
        await store.del(...keys);
      };
      const progressOf = async (s2) => {
        const people = Object.values(await K.participants(store, s2));
        const students = people.map(p => {
          const cs = E.activeCase(s2), ph = E.phaseOf(s2, cs, now).name, n = s2.cases.indexOf(cs) + 1, done = K.finished(s2, now);
          const status = p.review ? 'Sent the review' : done ? 'Read what happened' : !p.joinedAt ? 'Ready to start'
            : ph === 'closed' ? `Reading the reveal for company ${n}` : `${PRACTICE_STATUS[ph] || 'Reading'}: company ${n}`;
          return { participantId: p.pid, name: p.name, finished: done, status };
        });
        return { students, complete: students.length > 0 && students.every(x => x.finished) };
      };
      if (action === 'practice_status') return out(200, mine ? { code: current, ...(await progressOf(mine)) } : { code: null });
      if (action === 'practice_finish') { if (mine) await wipe(mine); await store.del(key); return out(200, { ok: true }); }
      if (mine && b.startOver !== true) return out(200, { code: current, resumed: true, ...(await progressOf(mine)) });
      if (mine) await wipe(mine);
      const x = (Array.isArray(b.students) ? b.students : []).find(y => y && typeof y.sub === 'string' && y.sub.startsWith(`practice-${who.userId}-`) &&
        /^[A-Za-z0-9_-]{1,160}$/.test(y.sub) && typeof y.name === 'string' && y.name.trim());
      if (!x) return out(400, { error: 'practice_students_required' });
      let c; for (let i = 0; i < 5; i++) { c = newCode(); if (!(await store.get(E.K.sess(c)))) break; }
      const id = `platform:${x.sub}`;
      // A private run: its clock starts when the practice student opens it, and they move it along themselves.
      await store.set(E.K.sess(c), newSession({ code: c, mode: 'individual', now, courseId: who.courseId, name: 'Practice',
        extra: { solo: true, practice: true, soloPid: id, facultyId: who.userId, ownerId: who.userId, owner: who.name } }));
      await store.set(E.K.part(c, id), { pid: id, name: x.name.trim().slice(0, 60), groupId: null, teamLabel: '', team: null, joinedAt: null });
      await store.sadd(E.K.pids(c), id);
      await store.set(key, c);
      return out(200, { code: c, students: [{ participantId: id, name: x.name, status: 'Ready to start', finished: false }] });
    }

    // A student's two review answers, after the last company's outcome. Revision 2 of the same completion.
    case 'review': {
      const p = studentLaunch(launch);
      if (!p) return out(401, { error: 'platform_signin_required' });
      const s = await store.get(E.K.sess(code));
      if (!s) return out(404, { error: 'no_such_session' });
      const pid = `platform:${p.sub}`;
      if (s.courseId && p.course !== s.courseId) return out(403, { error: 'session_course_mismatch' });
      const me = await store.get(E.K.part(s.code, pid));
      if (!me) return out(403, { error: 'not_joined' });
      if (!K.finished(s, now)) return out(409, { error: 'not_finished', message: 'The review opens after the last company’s outcome.' });
      const r1 = String(b.reflection1 || '').trim().slice(0, 1500), r2 = String(b.reflection2 || '').trim().slice(0, 1500);
      if (!r1 || !r2) return out(400, { error: 'answers_required', message: 'Answer both questions, then submit.' });
      await store.set(E.K.part(s.code, pid), { ...me, review: { reflection1: r1, reflection2: r2, at: now } });
      await reportPeople(store, s, [pid], now, 2);
      return out(200, { ok: true });
    }

    default:
      return out(400, { error: 'unknown_action' });
  }
}

// What faculty pages see of a session: never the old host key.
function publicFaculty(s) { const { hostKey, ...rest } = s; return { ...rest, paused: false }; }

module.exports = { kitAction, reportPeople, KEY, isPracticeSub };
