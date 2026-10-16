'use strict';
// The shared faculty pages' actions (platform/public/kit/) on POST /api/session. Faculty sign in with the platform
// launch only; each student plays their own run from the class link; Rehearse opens one practice student.
const store = require('./store');
const K = require('./kit');
const { META, acceptsLaunchId } = require('./meta');
const { verifyLaunch, reportCompletion } = require('./launch');
const { hydrate } = require('./session');
const { courseEnrolments, moveSessionRoster } = require('./course-enrolments');

const KIT_ACTIONS = new Set(['create', 'faculty_state', 'faculty_enrolments', 'group', 'rename_team', 'set_captain', 'control',
  'hide_session', 'course_sessions', 'course_session', 'practice_start', 'practice_status', 'practice_finish']);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const isPracticeSub = sub => String(sub || '').startsWith('practice-');
const out = (status, body) => ({ status, body });
const keys = {
  course: c => `kit:course:${c}`,
  courseList: c => `kit:course:${c}:sessions`,
  practice: (c, o) => `kit:practice:${c}:${o}`,
  run: id => `run03:${id}`
};
async function pointCourse(fn) { try { await fn(); } catch (e) { console.error('course session pointer update failed', e.code || e.message); } }

function launchFor(req, b = {}) {
  const p = verifyLaunch(String(req.headers['x-launch-token'] || b.launchToken || ''));
  return p && acceptsLaunchId(p.sim) && typeof p.sub === 'string' && p.sub && ['student', 'faculty', 'faculty_preview'].includes(p.role) ? p : null;
}
function faculty(req, b) {
  const lt = launchFor(req, b);
  return lt && ['faculty', 'faculty_preview'].includes(lt.role) ? { name: lt.name || 'Faculty', launch: lt, owner: { sub: lt.sub, course: lt.course || null } } : null;
}
const owns = (sess, who) => !!sess.owner && JSON.stringify(sess.owner) === JSON.stringify(who.owner);

async function people(code) { return Object.values((await store.getParticipants(code)) || {}).filter(Boolean); }
async function runsOf(list) {
  const out = {};
  for (const p of list) if (p.runId) { const raw = await store.getRaw(keys.run(p.runId)); if (raw) out[p.id] = hydrate(raw); }
  return out;
}
const publicFaculty = sess => ({ ...sess, mode: 'individual', paused: false });

// Report one student: revision 1 when the report is filed, revision 2 with the review. Never for practice.
async function reportPerson(sess, p, revision) {
  if (!sess || sess.practice || !p || !p.launchId || isPracticeSub(String(p.id).slice(9))) return { ok: false, skipped: true };
  const raw = p.runId && await store.getRaw(keys.run(p.runId));
  const c = raw && K.completion(sess, p, hydrate(raw), revision);
  if (!c) return { ok: false, skipped: true };
  return reportCompletion({ launch: { sub: String(p.id).slice(9), sim: META.id, course: sess.courseId, run: p.launchId }, ...c }).catch(() => ({ ok: false }));
}

async function courseList(courseId) {
  const list = (await store.getRaw(keys.courseList(courseId))) || [];
  const p = await store.getRaw(keys.course(courseId));
  return p && p.code && !list.some(x => x.code === p.code) ? [{ code: p.code, at: 0 }, ...list] : list;
}
async function otherOpen(courseId, except) {
  const found = [];
  for (const x of await courseList(courseId)) {
    if (x.code === except) continue;
    const s = await store.getSession(x.code);
    if (s && s.kit && !s.practice && s.state !== 'closed') found.push(s);
  }
  return found;
}
const otherOpenReply = list => out(409, { error: 'other_session_open', open: list.map(x => ({ code: x.code, name: x.name })),
  message: `Starting closes the open session "${list[0].name || META.title}". Students keep their saved work and filed reports.` });

async function closeSession(req, b, sess, now, extra = {}) {
  const next = { ...sess, state: 'closed', closedAt: now, ...extra };
  await store.putSession(sess.code, next);
  if (next.courseId && !next.practice) await pointCourse(async () => { const cur = await store.getRaw(keys.course(next.courseId)); if (cur && cur.code === sess.code) await store.putRaw(keys.course(next.courseId), {}); });
  await moveSessionRoster(req, b, next, 'archive', await store.getParticipants(sess.code));
  return next;
}

async function owned(who, code) {
  if (!who) return { fail: out(401, { error: 'faculty_authorization_required' }) };
  const sess = await store.getSession(String(code || '').toUpperCase());
  if (!sess || !sess.kit) return { fail: out(404, { error: 'no_such_session' }) };
  const mine = sess.practice ? sess.facultyId === who.owner.sub && (sess.courseId || null) === (who.owner.course || null) : owns(sess, who);
  if (!mine) return { fail: out(403, { error: 'not_session_owner' }) };
  return { sess };
}

function joinUrlOf(sess) {
  const url = new URL((process.env.PLATFORM_URL || 'https://rapidsims.flexee.org').replace(/\/+$/, '') + '/session.html');
  url.searchParams.set('sim', META.id); url.searchParams.set('session', sess.code);
  if (sess.courseId) url.searchParams.set('course', sess.courseId);
  return url.href;
}

async function kitAction(a, req, b, now = Date.now()) {
  const who = faculty(req, b), code = String(b.code || '').toUpperCase().trim();
  switch (a) {
    case 'create': {
      if (!who) return out(401, { error: 'faculty_authorization_required' });
      if (b.mode && b.mode !== 'individual') return out(400, { error: 'play_mode_required', message: `${META.title} is played individually.` });
      const courseId = who.owner.course;
      if (courseId) {
        const open = await otherOpen(courseId, null);
        if (open.length && !b.closeOpen) return otherOpenReply(open);
        for (const s2 of open) await closeSession(req, b, s2, now, { closedFrom: 'new-session' });
      }
      let c = newCode();
      for (let i = 0; i < 5 && await store.getSession(c); i++) c = newCode();
      const sess = { code: c, owner: who.owner, ownerName: who.name, platformAuth: true, courseId: courseId || null, kit: true,
        state: 'lobby', mode: 'individual', name: String(b.name || META.title).slice(0, 80), createdAt: now };
      await store.putSession(c, sess);
      if (courseId) {
        await pointCourse(() => store.putRaw(keys.course(courseId), { code: c }));
        await pointCourse(async () => store.putRaw(keys.courseList(courseId), [{ code: c, at: now }, ...((await store.getRaw(keys.courseList(courseId))) || []).filter(x => x.code !== c)].slice(0, 20)));
      }
      const joinUrl = joinUrlOf(sess);
      return out(200, { session: { ...publicFaculty(sess), joinUrl }, you: who.name, joinUrl, code: c });
    }

    case 'faculty_state': {
      const o = await owned(who, code); if (o.fail) return o.fail;
      const list = await people(code);
      const k = K.facultyKit(o.sess, list, await runsOf(list));
      return out(200, { session: { ...publicFaculty(o.sess), joinUrl: o.sess.practice ? null : joinUrlOf(o.sess), ended: k.kit.ended },
        participants: k.participants, runs: k.runs, kit: k.kit, you: who.name, serverNow: now });
    }

    // Approved students of the class appear before they open the sim.
    case 'faculty_enrolments': {
      const o = await owned(who, code); if (o.fail) return o.fail;
      const list = await people(code);
      if (o.sess.practice) return out(200, { available: true, practice: true, students: list.map(p => ({ participantId: p.id, name: p.name, accessReleased: true })) });
      try {
        const roster = await courseEnrolments(req, b, o.sess);
        if (roster.available && o.sess.state !== 'closed') {
          const have = new Set(list.map(p => p.id));
          for (const st of roster.students) {
            const id = String(st.participantId || '');
            if (st.accessReleased !== true || !/^platform:[A-Za-z0-9_-]+$/.test(id) || have.has(id) || !String(st.name || '').trim()) continue;
            await store.addParticipantIfNew(code, id, { id, name: String(st.name).trim().slice(0, 60), groupId: id, source: 'course', addedAt: now, joinedAt: null });
          }
        }
        return out(200, roster);
      } catch (e) { return out(e.status || 503, { error: 'course_roster_unavailable', message: e.message || 'Course enrolment could not be refreshed.' }); }
    }

    // Individual play: nobody is grouped and there is no team lead.
    case 'group': case 'rename_team': case 'set_captain': {
      const o = await owned(who, code); if (o.fail) return o.fail;
      return out(200, { ok: true });
    }

    case 'control': {
      const o = await owned(who, code); if (o.fail) return o.fail;
      const set = String(b.set || ''), sess = o.sess;
      if (set === 'start') {
        if (sess.state !== 'lobby') return out(409, { error: 'session_already_started' });
        const next = { ...sess, state: 'running', startedAt: now };
        await store.putSession(code, next);
        return out(200, { session: publicFaculty(next) });
      }
      if (set === 'close') {
        if (sess.state === 'closed') return out(409, { error: 'session_closed' });
        return out(200, { session: publicFaculty(await closeSession(req, b, sess, now)) });
      }
      if (set === 'reopen') {
        if (sess.state !== 'closed') return out(409, { error: 'session_not_closed' });
        if (!sess.practice && sess.courseId) {
          const open = await otherOpen(sess.courseId, code);
          if (open.length && !b.closeOpen) return otherOpenReply(open);
          for (const s2 of open) await closeSession(req, b, s2, now, { closedFrom: 'new-session' });
        }
        const next = { ...sess, state: sess.startedAt ? 'running' : 'lobby', closedAt: null, reopenedAt: now };
        await store.putSession(code, next);
        if (next.courseId && !next.practice) await pointCourse(() => store.putRaw(keys.course(next.courseId), { code }));
        await moveSessionRoster(req, b, next, 'restore', await store.getParticipants(code));
        return out(200, { session: publicFaculty(next) });
      }
      return out(400, { error: 'unknown_control' });
    }

    case 'hide_session': {
      const o = await owned(who, code); if (o.fail) return o.fail;
      if (o.sess.state !== 'closed') return out(409, { error: 'session_open', message: 'Close the session first. Then you can hide it.' });
      await store.putSession(code, { ...o.sess, hidden: true, hiddenAt: now });
      return out(200, { ok: true });
    }

    // The class's sessions, newest first, for the Sessions page.
    case 'course_sessions': {
      if (!who) return out(401, { error: 'faculty_authorization_required' });
      if (!who.owner.course) return out(200, { sessions: [] });
      const sessions = [];
      for (const x of (await courseList(who.owner.course)).slice(0, 20)) {
        const s2 = await store.getSession(x.code);
        if (!s2 || !s2.kit || s2.practice || s2.hidden || !owns(s2, who)) continue;
        const list = await people(x.code);
        sessions.push({ code: s2.code, name: s2.name, mode: 'individual', state: s2.state, paused: false, createdAt: s2.createdAt || null,
          students: list.filter(p => p.joinedAt).length, teams: list.length, submitted: list.filter(p => p.filedAt).length });
      }
      sessions.sort((p, q) => (q.createdAt || 0) - (p.createdAt || 0));
      return out(200, { sessions });
    }

    // A student opening the class link lands in the class's open session, or a practice student in theirs.
    case 'course_session': {
      const p = launchFor(req, b);
      if (!p) return out(401, { error: 'sign_in_required' });
      return out(200, { code: await entryCode(p) });
    }

    // Rehearse: one practice student who plays the whole run, outside the class's sessions.
    case 'practice_start': case 'practice_status': case 'practice_finish': {
      if (!who) return out(401, { error: 'faculty_authorization_required' });
      if (!who.owner.course) return out(403, { error: 'course_launch_required' });
      const pkey = keys.practice(who.owner.course, who.owner.sub);
      const current = (await store.getRaw(pkey) || {}).code, existing = current ? await store.getSession(current) : null;
      const mine = existing && existing.practice && existing.facultyId === who.owner.sub ? existing : null;
      const progressOf = async s2 => {
        const list = await people(s2.code), runs = await runsOf(list);
        const students = list.map(p => {
          const stage = K.stageOf(runs[p.id]);
          return { name: p.name, status: p.review ? 'Sent the review' : !p.joinedAt ? 'Ready to start' : K.STAGES[stage], finished: stage === 4 };
        });
        return { students, complete: students.length > 0 && students.every(x => x.finished) };
      };
      const wipe = async s2 => { for (const p of await people(s2.code)) if (p.runId) await store.putRaw(keys.run(p.runId), null); await store.wipe(s2.code); };
      if (a === 'practice_status') return out(200, mine ? { code: current, ...(await progressOf(mine)) } : { code: null });
      if (a === 'practice_finish') { if (mine) await wipe(mine); await store.putRaw(pkey, {}); return out(200, { ok: true }); }
      if (mine && b.startOver !== true) return out(200, { code: current, resumed: true, ...(await progressOf(mine)) });
      if (mine) await wipe(mine);
      const students = (Array.isArray(b.students) ? b.students : []).filter(y => y && typeof y.sub === 'string' && y.sub.startsWith(`practice-${who.owner.sub}-`) &&
        /^[A-Za-z0-9_-]{1,160}$/.test(y.sub) && typeof y.name === 'string' && y.name.trim()).slice(0, 1);
      if (!students.length) return out(400, { error: 'practice_students_required' });
      const c = newCode();
      await store.putSession(c, { code: c, owner: who.owner, ownerName: who.name, facultyId: who.owner.sub, platformAuth: true, courseId: who.owner.course,
        kit: true, practice: true, state: 'running', mode: 'individual', name: 'Practice', createdAt: now, startedAt: now });
      for (const x of students) {
        const id = `platform:${x.sub}`;
        await store.addParticipant(c, id, { id, name: x.name.trim().slice(0, 60), groupId: id, source: 'practice', addedAt: now, joinedAt: null });
      }
      await store.putRaw(pkey, { code: c });
      return out(200, { code: c, students: students.map(x => ({ participantId: `platform:${x.sub}`, name: x.name, status: 'Ready to start', finished: false })) });
    }
  }
  return null;
}

// The session a student's class link opens: the class's open session, or a practice student's own.
async function entryCode(p) {
  if (!p.course) return null;
  if (isPracticeSub(p.sub)) {
    const owner = String(p.sub).slice('practice-'.length).replace(/-[^-]+$/, '');
    return ((await store.getRaw(keys.practice(p.course, owner))) || {}).code || null;
  }
  const room = await store.getRaw(keys.course(p.course));
  const s2 = room && room.code && await store.getSession(room.code);
  return s2 && s2.courseId === p.course && s2.state !== 'closed' ? s2.code : null;
}

module.exports = { KIT_ACTIONS, kitAction, entryCode, reportPerson, isPracticeSub, launchFor, faculty, keys };
