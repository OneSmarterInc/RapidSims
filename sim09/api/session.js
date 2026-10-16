const { body, checkAccess } = require('../lib/guard.js');
const { randomBytes } = require('node:crypto');
const { syncCourseRoster, approvedIds } = require('../lib/session-roster.js');
const store = require('../lib/store.js');
const { verifyLaunch } = require('../lib/launch.js');
const S = require('../lib/scenario.js');
const R = require('../lib/room.js');
const { accountJoinUrl, participantLaunch, participantError } = require('../lib/session-entry.js');
const K = require('../lib/kit.js');
const { reportCompletion } = require('../lib/launch.js');
const { moveSessionRoster } = require('../lib/course-enrolments.js');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const newId = () => randomBytes(16).toString('hex');

function facultyRoster() {
  const raw = process.env.FACULTY_CODES || '';
  const out = [];
  raw.split(',').map(s => s.trim()).filter(Boolean).forEach(entry => {
    const i = entry.lastIndexOf(':');
    if (i > 0) out.push({ name: entry.slice(0, i).trim(), code: entry.slice(i + 1).trim() });
  });
  if (process.env.FACULTY_CODE) out.push({ name: 'Facilitator', code: process.env.FACULTY_CODE });
  return out;
}

function whoIsFaculty(req, b) {
  const lt = req.headers['x-launch-token'] || (b && b.launchToken);
  if (lt) {
    const p = verifyLaunch(String(lt));
    if (p && p.sub && p.sim === S.META.id && (p.role === 'faculty' || p.role === 'faculty_preview')) {
      return { name: p.name || 'Facilitator', userId: p.sub || null, platformAuth: true, courseId: p.course || null };
    }
  }
  // Fail closed: an empty standalone faculty roster is not authorization.
  const roster = facultyRoster();
  if (!roster.length) return null;
  const given = String((b && b.facultyCode) || req.headers['x-faculty-code'] || '').trim();
  if (!given) return null;
  const hit = roster.find(r => r.code === given);
  return hit ? { name: hit.name } : null;
}

function ownsSession(who, sess) {
  // A Rehearse practice run is the faculty member's own; other private runs belong to their student.
  if (who && sess.practice) return !!who.userId && sess.facultyId === who.userId && (sess.courseId || null) === (who.courseId || null);
  if (!who || sess.solo) return false;
  if (sess.platformAuth) {
    if (!who.platformAuth) return false;
    if (sess.courseId && sess.courseId !== who.courseId) return false;
    if (sess.ownerId) return sess.ownerId === who.userId;
    return !!sess.owner && sess.owner === who.name;
  }
  // Standalone sessions belong to the facilitator code that created them. A
  // platform account never matches one by display name.
  if (who.platformAuth) return false;
  return !!sess.owner && sess.owner === who.name;
}

function publicSession(sess) {
  return { code: sess.code, name: sess.name, mode: sess.mode, state: sess.state, paused: !!sess.paused, solo: !!sess.solo, practice: !!sess.practice };
}

async function pointCourse(fn) { try { await fn(); } catch (e) { console.error('course session pointer update failed', e.code || e.message); } }
const isPracticeSub = sub => String(sub || '').startsWith('practice-');
// After the 2010 stage: the four questions and, for a signed-in student, the review.
function withExtras(view, me, sess) {
  if (!view || !view.closing) return view;
  return { ...view, afterReveal: K.LESSON_QUESTIONS,
    review: { open: !!sess.platformAuth && String(me.id || '').startsWith('platform:'), questions: K.REVIEW_QUESTIONS, sent: !!me.review } };
}
// Report each student whose fund is settled: revision 1 at the 2010 stage (or close), revision 2 with their review.
async function reportPeople(sess, participants, ids, now, revision) {
  if (sess.practice || !sess.platformAuth) return { sent: 0 };
  let sent = 0;
  for (const id of ids) {
    const me = participants[id];
    if (!me || me.kind === 'team' || !id.startsWith('platform:') || !me.launchId || isPracticeSub(id.slice(9))) continue;
    const c = K.completion(sess, participants, id, now, revision);
    if (!c) continue;
    const r = await reportCompletion({ launch: { sub: id.slice(9), sim: S.META.id, course: sess.courseId, run: me.launchId }, ...c }).catch(() => ({ ok: false }));
    if (r && r.ok) sent++;
  }
  return { sent };
}
// One open session per class.
async function otherOpen(courseId, except) {
  if (!courseId) return [];
  let codes = [];
  try { codes = (await store.listCourseSessions(courseId)) || []; const p = await store.getCourseSession(courseId); if (p && !codes.includes(p)) codes.push(p); }
  catch (e) { return []; }
  const out = [];
  for (const c of codes) { if (c === except) continue; const s2 = await store.getSession(c).catch(() => null); if (s2 && !s2.practice && s2.state !== 'closed') out.push(s2); }
  return out;
}
async function closeSessions(list, req, b, now) {
  for (const s2 of list) {
    const participants = await store.getParticipants(s2.code).catch(() => ({}));
    const r = R.applyControl(s2, 'close', now, participants);
    const next = { ...(r.next || { ...s2, state: 'closed', closedAt: now }), closedFrom: 'new-session' };
    await store.putSession(s2.code, next);
    if (next.courseId) await pointCourse(() => store.clearCourseSession(next.courseId, s2.code));
    await reportPeople(next, participants, Object.keys(participants), now, 1);
    await moveSessionRoster(req, b, next, 'archive', participants);
  }
}
function otherOpenReply(res, list, verb) {
  return res.status(409).json({ error: 'other_session_open', open: list.map(x => ({ code: x.code, name: x.name })),
    message: `${verb} closes the open session "${list[0].name || S.META.title}". Students who placed their fund keep their results.` });
}

async function ownedSession(req, res, b, code) {
  const who = whoIsFaculty(req, b);
  if (!who) { res.status(401).json({ error: 'faculty_authorization_required' }); return null; }
  const sess = await store.getSession(code);
  if (!sess) { res.status(404).json({ error: 'no_such_session' }); return null; }
  if (!ownsSession(who, sess)) { res.status(403).json({ error: 'not_your_session' }); return null; }
  return { who, sess };
}

const humans = (participants) => Object.values(participants).filter(p => p && p.kind !== 'team');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  if (!store.configured()) {
    return res.status(503).json({ error: 'no_store', message: 'Session storage is not configured for this deployment.' });
  }

  const b = body(req);
  const action = String(b.action || '');
  const code = String(b.code || '').toUpperCase().trim();
  const now = typeof module.exports._now === 'function' ? module.exports._now() : Date.now();

  try {
    const facultyRename = action === 'rename_team' && !!whoIsFaculty(req, b);
    if (['join', 'state', 'statements', 'allocate', 'advance', 'review'].includes(action)) {
      const sess = await store.getSession(code);
      if (sess) {
        const error = participantError(req, b, sess, action === 'join' ? null : String(b.participantId || ''));
        if (error) return res.status(error.status).json({ error: error.error });
      }
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      switch (action) {
        case 'create': {
          const who = whoIsFaculty(req, b);
          if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
          const mode = String(b.mode || '');
          if (!R.MODES.includes(mode)) return res.status(400).json({ error: 'play_mode_required' });
          if (who.platformAuth && who.courseId) {
            const open = await otherOpen(who.courseId, null);
            if (open.length && !b.closeOpen) return otherOpenReply(res, open, 'Starting a new session');
            if (open.length) await closeSessions(open, req, b, now);
          }
          const c = newCode();
          const sess = {
            code: c, owner: who.name, ownerId: who.userId || null,
            platformAuth: !!who.platformAuth, courseId: who.courseId || null,
            name: String(b.name || S.META.title).slice(0, 80),
            mode, state: 'lobby', paused: false, released: 0, createdAt: now
          };
          await store.putSession(c, sess);
          if (sess.platformAuth && sess.courseId) {
            await pointCourse(() => store.addCourseSession(sess.courseId, c, now));
            await pointCourse(() => store.setCourseSession(sess.courseId, c));
          }
          const joinUrl = sess.platformAuth ? accountJoinUrl(sess) : null;
          return res.status(200).json({ session: { ...sess, joinUrl }, you: who.name, joinUrl });
        }

        case 'faculty_state': {
          const o = await ownedSession(req, res, b, code); if (!o) return;
          const participants = await store.getParticipants(code);
          const roster = humans(participants).map(p => ({ id: p.id, name: p.name, groupId: p.groupId || null, teamLabel: p.teamLabel || '' }));
          const k = K.facultyKit(o.sess, participants, now);
          return res.status(200).json({
            session: { ...o.sess, joinUrl: o.sess.platformAuth ? accountJoinUrl(o.sess) : null, clock: k.clock, ended: k.kit.ended },
            roster, participants: k.participants, runs: k.runs, kit: k.kit,
            projector: R.projectorView(o.sess, participants, now),
            you: o.who.name
          });
        }

        case 'faculty_enrolments': {
          const o = await ownedSession(req, res, b, code); if (!o) return;
          if (o.sess.practice) {
            const people = humans(await store.getParticipants(code));
            return res.status(200).json({ available: true, practice: true, students: people.map(p => ({ participantId: p.id, name: p.name, accessReleased: true })), participants: {} });
          }
          try {
            const roster = await syncCourseRoster(req, b, o.sess);
            return res.status(200).json({ ...roster, participants: await store.getParticipants(code) });
          } catch (error) {
            return res.status(error.status || 503).json({ error: 'course_roster_unavailable', message: error.message || 'Course enrolment could not be refreshed.' });
          }
        }

        case 'group': {
          const o = await ownedSession(req, res, b, code); if (!o) return;
          const sess = o.sess;
          if (sess.mode !== 'team') return res.status(409).json({ error: 'not_team_mode' });
          if (sess.state !== 'lobby') return res.status(409).json({ error: 'teams_locked', message: 'Teams are fixed once the session starts.' });
          const roster = sess.platformAuth && sess.courseId ? await syncCourseRoster(req, b, sess) : null;
          const allowed = approvedIds(roster);
          const participants = await store.getParticipants(code);
          const previous = structuredClone(participants);
          const assign = b.assign && typeof b.assign === 'object' ? b.assign : {};
          for (const [id, label] of Object.entries(assign)) {
            const p = participants[id];
            if (!p || p.kind === 'team') return res.status(404).json({ error: 'no_such_participant' });
            const clean = String(label || '').trim().slice(0, 40);
            if (!clean || clean === '__unassigned__') { p.groupId = null; p.teamLabel = ''; continue; }
            if (allowed && !allowed.has(id)) return res.status(403).json({ error: 'student_not_approved' });
            // The Teams tab moves a student into an existing team by its id.
            const mate = clean.startsWith('team:') && humans(participants).find(x => x.groupId === clean);
            if (mate) { p.groupId = clean; p.teamLabel = mate.teamLabel || clean.slice(5); continue; }
            const norm = clean.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
            if (!norm) return res.status(400).json({ error: 'team_name_required' });
            p.groupId = `team:${norm}`; p.teamLabel = clean;
          }
          if (!await store.compareAndSetRoster(code, previous, participants, sess)) continue;
          return res.status(200).json({ ok: true });
        }

        case 'control': {
          const o = await ownedSession(req, res, b, code); if (!o) return;
          const sess = o.sess;
          const set = String(b.set || '');
          let next;
          if (set === 'start') {
            if (sess.state !== 'lobby') return res.status(409).json({ error: 'session_already_started' });
            next = { ...sess, state: 'running', startedAt: now, paused: false, pausedTotalMs: 0, skipSeconds: 0, released: 0 };
            if (sess.mode === 'team') {
              const participants = await store.getParticipants(code);
              const present = humans(participants).filter(p => p.joinedAt);
              const unassigned = present.filter(p => !p.groupId);
              if (!present.length) return res.status(409).json({ error: 'participants_required', message: 'Assign at least one student to a team before starting.' });
              if (unassigned.length) {
                return res.status(409).json({ error: 'unassigned_participants', count: unassigned.length,
                  message: `${unassigned.length} student${unassigned.length === 1 ? ' is' : 's are'} still unassigned. Assign every student to a team before starting.` });
              }
              next.teams = R.freezeTeams(participants);
            }
          } else if (set === 'reopen') {
            if (sess.state !== 'closed') return res.status(409).json({ error: 'session_not_closed' });
            if (!sess.practice && sess.courseId) {
              const open = await otherOpen(sess.courseId, code);
              if (open.length && !b.closeOpen) return otherOpenReply(res, open, 'Reopening this session');
              if (open.length) await closeSessions(open, req, b, now);
            }
            // The clock continues from where it was closed.
            next = { ...sess, state: sess.startedAt ? 'running' : 'lobby', paused: false, closedAt: null, reopenedAt: now,
              pausedTotalMs: (sess.pausedTotalMs || 0) + (sess.closedAt ? now - sess.closedAt : 0) };
          } else {
            const participants = await store.getParticipants(code);
            // The session bar closes the fund for everyone; an unplaced fund stays unplaced.
            const r = set === 'close_fund' ? R.applyControl(sess, 'close_allocation', now, participants, true) : R.applyControl(sess, set, now, participants, !!b.force);
            if (r.error) return res.status(r.status).json({ error: r.error });
            next = r.next;
          }
          if (!await store.compareAndSetSession(code, sess, next)) continue;
          if (next.courseId && !next.practice) {
            if (set === 'close') await pointCourse(() => store.clearCourseSession(next.courseId, code));
            if (set === 'reopen') await pointCourse(() => store.setCourseSession(next.courseId, code));
          }
          if (set === 'close' || set === 'reopen') {
            const participants = await store.getParticipants(code).catch(() => ({}));
            if (set === 'close') await reportPeople(next, participants, Object.keys(participants), now, 1);
            await moveSessionRoster(req, b, next, set === 'close' ? 'archive' : 'restore', participants);
          }
          return res.status(200).json({ session: next });
        }

        // A direct launch with no facilitated session: one private room, its own clock.
        case 'solo': {
          if (!checkAccess(req, res)) return;
          const launch = req.launch || null;
          if (launch && !participantLaunch(req, b)) return res.status(401).json({ error: 'launch_token_invalid' });
          if (launch && launch.mode === 'session') return res.status(409).json({ error: 'use_session' });
          const c = newCode();
          const id = launch ? `platform:${launch.sub}` : newId();
          const sess = {
            code: c, solo: true, owner: id, ownerId: launch ? launch.sub : null,
            platformAuth: !!launch, courseId: launch ? launch.course || null : null,
            name: S.META.title, mode: 'individual', released: 0,
            state: 'running', startedAt: now, paused: false, pausedTotalMs: 0, skipSeconds: 0, createdAt: now
          };
          await store.putSession(c, sess);
          const me = { id, name: String(launch ? launch.name || 'Participant' : b.name || 'Participant').slice(0, 60), groupId: `individual:${id}`, joinedAt: now };
          await store.addParticipant(c, id, me);
          return res.status(200).json({ code: c, participantId: id, session: publicSession(sess) });
        }

        case 'join': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          if (sess.state === 'closed') return res.status(410).json({ error: 'session_closed' });
          const launched = participantLaunch(req, b);
          // A Rehearse practice run takes its own practice student only; other private runs take nobody.
          if (sess.solo && !(sess.practice && launched && sess.owner === `platform:${launched.sub}`)) return res.status(403).json({ error: 'private_session' });
          if (!sess.practice && launched && isPracticeSub(launched.sub)) return res.status(403).json({ error: 'practice_only' });
          if ((req.headers['x-launch-token'] || b.launchToken) && !launched) return res.status(401).json({ error: 'launch_token_invalid' });
          if (launched && sess.courseId && launched.course !== sess.courseId) return res.status(403).json({ error: 'session_course_mismatch' });
          const name = String(launched ? launched.name || '' : b.name || '').slice(0, 60).trim();
          if (!name) return res.status(400).json({ error: 'name_required' });
          const all = await store.getParticipants(code);
          const key = x => String(x || '').trim().toLowerCase();
          let id = launched ? `platform:${launched.sub}` : String(b.participantId || '').trim();
          if (id.startsWith('team:')) return res.status(400).json({ error: 'invalid_participant' });
          if (!launched && (!id || !all[id])) {
            const match = humans(all).find(p => !p.id.startsWith('platform:') && key(p.name) === key(name));
            id = match ? match.id : (id || newId());
          }
          if (!launched && id.startsWith('platform:')) return res.status(401).json({ error: 'platform_signin_required' });
          const existing = all[id];
          if (!existing && sess.mode === 'team' && sess.state !== 'lobby') {
            return res.status(409).json({ error: 'teams_locked', message: 'This team session has started. Ask your instructor to add you to the next one.' });
          }
          const participant = {
            ...existing, id, name,
            groupId: sess.mode === 'individual' ? `individual:${id}` : existing ? existing.groupId : null,
            teamLabel: sess.mode === 'individual' ? '' : existing ? existing.teamLabel || '' : '',
            joinedAt: existing?.joinedAt || now,
            ...(launched ? { launchId: launched.run } : {})
          };
          if (!await store.compareAndSetParticipant(code, id, existing, participant, sess)) continue;
          // A practice run's clock starts when its student first opens it.
          if (sess.practice && sess.state === 'lobby') await store.compareAndSetSession(code, sess, { ...sess, state: 'running', startedAt: now, paused: false, pausedTotalMs: 0, skipSeconds: 0, released: 0 });
          return res.status(200).json({ participantId: id, session: publicSession(sess) });
        }

        case 'state': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          const pid = String(b.participantId || '');
          const participants = await store.getParticipants(code);
          const me = participants[pid];
          if (!me || me.kind === 'team') return res.status(403).json({ error: 'not_joined' });
          return res.status(200).json({ session: publicSession(sess), view: withExtras(R.studentView(sess, participants, pid, now), me, sess) });
        }

        case 'statements':
        case 'allocate': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          const pid = String(b.participantId || '');
          const participants = await store.getParticipants(code);
          const me = participants[pid];
          if (!me || me.kind === 'team') return res.status(403).json({ error: 'not_joined' });
          const r = action === 'statements'
            ? R.applyStatements(sess, participants, me, b.statements, now)
            : R.applyAllocation(sess, participants, me, b.allocation, now);
          if (r.error) return res.status(r.status).json({ error: r.error, left: r.left });
          if (!await store.compareAndSetParticipant(code, r.id, r.prev, r.next, sess)) continue;
          participants[r.id] = r.next;
          // A solo player who commits has nothing left to wait for.
          if (action === 'allocate' && sess.solo) {
            const next = { ...sess, allocationClosed: true, allocationClosedAt: now };
            await store.compareAndSetSession(code, sess, next);
            return res.status(200).json({ ok: true, view: withExtras(R.studentView(next, participants, pid, now), participants[pid], next) });
          }
          return res.status(200).json({ ok: true, view: withExtras(R.studentView(sess, participants, pid, now), participants[pid], sess) });
        }

        // Solo only: the player moves their own private run along.
        case 'advance': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          if (!sess.solo) return res.status(403).json({ error: 'instructor_controls_this_room' });
          const pid = String(b.participantId || '');
          if (sess.owner !== pid) return res.status(403).json({ error: 'not_your_session' });
          const participants = await store.getParticipants(code);
          const view = R.studentView(sess, participants, pid, now);
          if (!view.canAdvance) return res.status(409).json({ error: 'cannot_advance' });
          const set = ['held', 'reveal'].includes(view.clock.phase) ? 'release' : 'advance';
          const r = R.applyControl(sess, set, now, participants);
          if (r.error) return res.status(r.status).json({ error: r.error });
          if (!await store.compareAndSetSession(code, sess, r.next)) continue;
          return res.status(200).json({ ok: true, view: withExtras(R.studentView(r.next, participants, pid, now), participants[pid], r.next) });
        }

        // Faculty rename a team from the Teams tab.
        case 'rename_team': {
          if (!facultyRename) return res.status(401).json({ error: 'faculty_authorization_required' });
          const o = await ownedSession(req, res, b, code); if (!o) return;
          const gid = String(b.groupId || '');
          const label = String(b.teamLabel || '').replace(/\s+/g, ' ').trim().slice(0, 40);
          if (!gid.startsWith('team:') || !label) return res.status(400).json({ error: 'team_name_required' });
          const participants = await store.getParticipants(code);
          const previous = structuredClone(participants);
          let hit = 0;
          for (const p of humans(participants)) if (p.groupId === gid) { participants[p.id].teamLabel = label; hit++; }
          if (!hit) return res.status(404).json({ error: 'no_such_team' });
          if (!await store.compareAndSetRoster(code, previous, participants, o.sess)) continue;
          return res.status(200).json({ ok: true });
        }

        // The first press decides for the team, so there is no team lead to choose.
        case 'set_captain': {
          const o = await ownedSession(req, res, b, code); if (!o) return;
          return res.status(200).json({ ok: true });
        }

        case 'hide_session': {
          const o = await ownedSession(req, res, b, code); if (!o) return;
          if (o.sess.state !== 'closed') return res.status(409).json({ error: 'session_open', message: 'Close the session first. Then you can hide it.' });
          if (!await store.compareAndSetSession(code, o.sess, { ...o.sess, hidden: true, hiddenAt: now })) continue;
          return res.status(200).json({ ok: true });
        }

        // The class's sessions, newest first, for the Sessions page.
        case 'course_sessions': {
          const who = whoIsFaculty(req, b);
          if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
          if (!who.platformAuth || !who.courseId) return res.status(200).json({ sessions: [] });
          let codes = [];
          try { codes = await store.listCourseSessions(who.courseId); const p = await store.getCourseSession(who.courseId); if (p && !codes.includes(p)) codes.unshift(p); } catch (e) { codes = []; }
          const sessions = [];
          for (const c of codes.slice(0, 20)) {
            const s2 = await store.getSession(c);
            if (!s2 || s2.practice || s2.hidden || !ownsSession(who, s2)) continue;
            const participants = await store.getParticipants(c);
            const k = K.facultyKit(s2, participants, now);
            const list = Object.values(k.runs);
            sessions.push({ code: c, name: s2.name, mode: s2.mode, state: s2.state, paused: !!s2.paused, createdAt: s2.createdAt || null,
              students: humans(participants).filter(p => p.joinedAt).length, teams: s2.mode === 'team' ? list.length : 0,
              submitted: list.filter(r => r.done).length });
          }
          sessions.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
          return res.status(200).json({ sessions });
        }

        // A student opening the class link lands in the class's open session, or a practice student in theirs.
        case 'course_session': {
          const p = participantLaunch(req, b);
          if (!p) return res.status(401).json({ error: 'platform_signin_required' });
          if (!p.course) return res.status(200).json({ code: null });
          if (isPracticeSub(p.sub)) {
            const owner = String(p.sub).slice('practice-'.length).replace(/-[^-]+$/, '');
            return res.status(200).json({ code: (await store.getPracticeSession(p.course, owner).catch(() => null)) || null });
          }
          const open = await store.getCourseSession(p.course).catch(() => null);
          const s2 = open ? await store.getSession(open) : null;
          return res.status(200).json({ code: s2 && s2.state !== 'closed' && s2.courseId === p.course ? open : null });
        }

        // Rehearse: one practice student on a private run of their own, outside the class's sessions.
        case 'practice_start':
        case 'practice_status':
        case 'practice_finish': {
          const who = whoIsFaculty(req, b);
          if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
          if (!who.platformAuth || !who.courseId || !who.userId) return res.status(403).json({ error: 'course_launch_required' });
          const current = await store.getPracticeSession(who.courseId, who.userId);
          const existing = current ? await store.getSession(current) : null;
          const mine = existing && ownsSession(who, existing) ? existing : null;
          const LABEL = { briefing: 'Reading the briefing', wall: 'Writing the statements', allocate: 'Placing the fund', held: 'Fund placed' };
          const progressOf = async c => {
            const [s2, participants] = await Promise.all([store.getSession(c), store.getParticipants(c)]);
            const students = humans(participants).map(p2 => {
              const v = s2 ? R.studentView(s2, participants, p2.id, now) : null;
              const finished = !!(v && v.closing);
              return { name: p2.name, finished, status: p2.review ? 'Sent the review' : finished ? 'Read the 2010 stage' : !p2.joinedAt ? 'Ready to start'
                : v && v.clock.phase === 'reveal' ? `Reading the ${v.stages[v.stages.length - 1].year} stage` : (v && LABEL[v.clock.phase]) || 'Ready to start' };
            });
            return { students, complete: students.length > 0 && students.every(x => x.finished) };
          };
          if (action === 'practice_status') return res.status(200).json(mine ? { code: current, ...(await progressOf(current)) } : { code: null });
          if (action === 'practice_finish') {
            if (mine) await store.wipe(current);
            await store.clearPracticeSession(who.courseId, who.userId);
            return res.status(200).json({ ok: true });
          }
          if (mine && b.startOver !== true) return res.status(200).json({ code: current, resumed: true, ...(await progressOf(current)) });
          if (mine) await store.wipe(current);
          const x = (Array.isArray(b.students) ? b.students : []).find(y => y && typeof y.sub === 'string' && y.sub.startsWith(`practice-${who.userId}-`) &&
            /^[A-Za-z0-9_-]{1,160}$/.test(y.sub) && typeof y.name === 'string' && y.name.trim());
          if (!x) return res.status(400).json({ error: 'practice_students_required' });
          const c = newCode(), id = `platform:${x.sub}`;
          // A private run: its clock starts when the practice student opens it, and they move it along themselves.
          await store.putSession(c, { code: c, solo: true, practice: true, owner: id, ownerId: x.sub, facultyId: who.userId,
            platformAuth: true, courseId: who.courseId, name: 'Practice', mode: 'individual', released: 0,
            state: 'lobby', paused: false, pausedTotalMs: 0, skipSeconds: 0, createdAt: now });
          await store.addParticipant(c, id, { id, name: x.name.trim().slice(0, 60), groupId: `individual:${id}`, joinedAt: null });
          await store.setPracticeSession(who.courseId, who.userId, c);
          return res.status(200).json({ code: c, students: [{ participantId: id, name: x.name, status: 'Ready to start', finished: false }] });
        }

        // A student's two review answers, after the 2010 stage. Revision 2 of the same completion.
        case 'review': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          const pid = String(b.participantId || '');
          const participants = await store.getParticipants(code);
          const me = participants[pid];
          if (!me || me.kind === 'team') return res.status(403).json({ error: 'not_joined' });
          if (!R.studentView(sess, participants, pid, now).closing) return res.status(409).json({ error: 'not_finished', message: 'The review opens after the 2010 stage.' });
          const r1 = String(b.reflection1 || '').trim().slice(0, 1500), r2 = String(b.reflection2 || '').trim().slice(0, 1500);
          if (!r1 || !r2) return res.status(400).json({ error: 'answers_required', message: 'Answer both questions, then submit.' });
          const next = { ...me, review: { reflection1: r1, reflection2: r2, at: now } };
          if (!await store.compareAndSetParticipant(code, pid, me, next, sess)) continue;
          participants[pid] = next;
          await reportPeople(sess, participants, [pid], now, 2);
          return res.status(200).json({ ok: true, view: withExtras(R.studentView(sess, participants, pid, now), next, sess) });
        }

        default:
          return res.status(400).json({ error: 'unknown_action' });
      }
    }
    return res.status(409).json({ error: 'busy_retry', message: 'The session changed while saving. Please try again.' });
  } catch (e) {
    console.error('session error', action, e.message);
    return res.status(e.status || 500).json({ error: 'session_error', message: e.status ? e.message : 'Something went wrong. Please try again.' });
  }
};
