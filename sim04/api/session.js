'use strict';
// Sim04 sessions. Faculty use the shared RapidSims faculty pages (platform/public/kit/): the
// actions match Midland's so those pages work unchanged. The room rules live in lib/room.js.
const { randomBytes, randomInt } = require('node:crypto');
const { body, access, faculty, owns, participant } = require('../lib/guard');
const { announce, reportCompletion } = require('../lib/launch');
const { accountJoinUrl } = require('../lib/session-entry');
const { courseEnrolments, moveSessionRoster } = require('../lib/course-enrolments');
const store = require('../lib/store');
const room = require('../lib/room');
const debrief = require('../lib/debrief');
const config = require('../data/config');

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codeOf = () => Array.from({ length: 5 }, () => CHARS[randomInt(CHARS.length)]).join('');
const newId = () => randomBytes(16).toString('hex');
const error = (res, status, code, message, extra = {}) => res.status(status).json({ error: code, ...(message ? { message } : {}), ...extra });
const validCode = code => /^[A-Z2-9]{5}$/.test(code);
const TITLE = 'Whose Number Is Right?';
const safe = s => ({ code: s.code, name: s.name, mode: s.mode, groupSize: s.groupSize,
  clockMinutes: s.clockMinutes, state: s.state, stage: s.stage });
const studentResult = (session, id) => ({ session: safe(session), view: room.studentView(session, id, Date.now()) });
const joinUrl = s => s.platformAuth ? accountJoinUrl(s)
  : process.env.SIM_URL ? process.env.SIM_URL.replace(/\/+$/, '') + '/launch.html?session=' + s.code + '&guest=1' : null;
const isPracticeId = id => String(id || '').startsWith('platform:practice-');
const FACULTY_ACTIONS = ['faculty_state', 'faculty_enrolments', 'divide', 'move', 'rename', 'start', 'advance', 'private_check',
  'report', 'control', 'group', 'set_captain', 'rename_team', 'hide_session'];

// The completion a student's run reports to the platform: revision 1 when the number is final,
// revision 2 with their review. The run id is the team's (or the student's), so the review
// replaces the first report and Past sessions groups the class by session and team.
function completionFor(session, id, revision) {
  const p = session.participants[id];
  const slot = room.slotFor(session, id);
  if (!p || !slot || !id.startsWith('platform:') || !p.launchId) return null;
  const band = room.bandOf(slot), b = debrief.BANDS[band];
  const team = session.mode === 'team';
  const number = slot.commit ? slot.commit.number.toFixed(1) : null;
  const summary = {
    sessionCode: session.code, sessionName: session.name || null, sessionCreatedAt: session.createdAt || null,
    band, year3Band: band, bandLabel: b.label, bandTone: b.cls, reviewQuestions: debrief.REVIEW_QUESTIONS,
    result: { overall: number ? `${b.label}. Reported ${number}% with confidence ${slot.commit.confidence}/5.` : `${b.label}.` },
    number, confidence: slot.commit?.confidence || null,
    ...(team ? { teamRunId: slot.id, teamLabel: slot.label, teamMembers: slot.memberIds.map(m => session.participants[m]?.name).filter(Boolean),
      completedBy: slot.commit?.by ? session.participants[slot.commit.by]?.name || null : null } : {}),
    reflection1: p.review?.reflection1 || '', reflection2: p.review?.reflection2 || ''
  };
  const metrics = { revision, Result: b.label, Number: number ? number + '%' : 'None', Confidence: slot.commit?.confidence || '',
    ...(p.review ? { reflection1: p.review.reflection1, reflection2: p.review.reflection2 } : {}) };
  return { participantId: id, courseId: session.courseId, runId: `${session.code}:${team ? slot.id : id}`, launchId: p.launchId, summary, metrics };
}
async function reportPeople(session, ids, revision) {
  if (session.practice || !session.platformAuth) return { sent: 0, failed: 0 };
  const jobs = ids.map(id => completionFor(session, id, revision)).filter(Boolean);
  const results = await Promise.all(jobs.map(j => reportCompletion(j).catch(() => false)));
  return { sent: results.filter(Boolean).length, failed: results.filter(r => !r).length };
}
// Everyone with a final number (or none, when the clock ran out) and their first report.
const finishedIds = session => Object.values(session.participants)
  .filter(p => p.joinedAt && p.slotId && room.slotFor(session, p.id)).map(p => p.id);

// The class's other open sessions (one open session per class).
async function otherOpen(courseId, except) {
  if (!courseId) return [];
  const list = await store.courseSessions(courseId).catch(() => []);
  const out = [];
  for (const x of list) {
    if (x.code === except) continue;
    const s = await store.getSession(x.code);
    if (s && !s.practice && room.kitState(s) !== 'closed') out.push(s);
  }
  return out;
}
function closed(session, who, from) {
  const next = structuredClone(session);
  if (next.pausedAt) { next.pausedMs = (next.pausedMs || 0) + (Date.now() - next.pausedAt); next.pausedAt = null; }
  Object.assign(next, { state: 'closed', reviewOpen: true, closedAt: Date.now(), closedBy: who?.name || null, closedFrom: from || null });
  return next;
}
async function closeOthers(list, who, req, b) {
  for (const s of list) {
    const latest = await store.getSession(s.code);
    if (!latest || room.kitState(latest) === 'closed') continue;
    const next = closed(latest, who, 'new-session');
    if (await store.compareAndSetSession(s.code, latest, next)) {
      await reportPeople(next, finishedIds(next), 1);
      await moveSessionRoster(req, b, next, 'archive', next.participants);
    }
  }
}
function otherOpenReply(res, list, verb) {
  const first = list[0];
  return error(res, 409, 'other_session_open', `${verb} closes the open session "${first.name || TITLE}". Students who finished keep their results.`,
    { open: list.map(s => ({ code: s.code, name: s.name || TITLE })) });
}
function practiceProgress(session) {
  const now = Date.now();
  const students = Object.values(session.participants).map(p => {
    const slot = room.slotFor(session, p.id);
    const finished = !!slot?.commit && (!!p.review || !session.reviewOpen);
    const status = p.review ? 'Sent the review' : slot?.commit ? 'Locked a number' : session.state === 'lobby' ? (p.joinedAt ? 'Reading the story' : 'Ready to start')
      : room.clock(session, now).expired ? 'Time ended' : p.joinedAt ? 'Working on the number' : 'Ready to start';
    return { name: p.name, status, finished: !!slot?.commit };
  });
  return { students, complete: students.length > 0 && students.every(x => x.finished) };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  if (req.method !== 'POST') return error(res, 405, 'post_only');
  if (!store.configured()) return error(res, 503, 'no_store', 'Session storage is not configured.');
  const b = body(req), action = String(b.action || ''), code = String(b.code || '').trim().toUpperCase();
  try {
    if (action === 'faculty_access') {
      return faculty(req, b) ? res.status(200).json({ ok: true })
        : error(res, 401, 'faculty_authorization_required');
    }
    if (action === 'course_sessions') {
      const who = access(req, b);
      // Faculty: every session of the class, newest first, for the Sessions page.
      if (who?.platform && ['faculty', 'faculty_preview'].includes(who.role)) {
        if (!who.courseId) return res.status(200).json({ sessions: [] });
        const codes = await store.listCourseSessions(who.courseId).catch(() => []);
        for (const x of await store.courseSessions(who.courseId).catch(() => [])) if (!codes.includes(x.code)) codes.unshift(x.code);
        const sessions = [];
        for (const c of codes.slice(0, 20)) {
          const s = await store.getSession(c);
          if (!s || s.practice || s.hidden || !owns(who, s)) continue;
          const k = room.facultyKit(s, Date.now());
          const runs = Object.values(k.runs);
          sessions.push({ code: c, name: s.name, mode: s.mode, state: k.session.state, paused: k.session.paused, createdAt: s.createdAt || null,
            students: Object.keys(s.participants).length, teams: s.mode === 'team' ? runs.length : 0, submitted: runs.filter(r => r.done).length });
        }
        sessions.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
        return res.status(200).json({ sessions });
      }
      if (!who?.platform || who.role !== 'student' || !who.courseId) {
        return error(res, 403, 'student_course_required', 'Open Sim04 from a course where you have access.');
      }
      // A practice student (Rehearse) finds its own practice session.
      if (isPracticeId(who.id)) {
        const owner = who.id.slice('platform:practice-'.length).replace(/-[^-]+$/, '');
        const c = await store.getPracticeSession(who.courseId, owner).catch(() => null);
        const s = c ? await store.getSession(c) : null;
        return res.status(200).json({ sessions: s ? [{ code: c, name: 'Practice', mode: s.mode, state: s.state, stage: s.stage }] : [] });
      }
      return res.status(200).json({ sessions: await store.courseSessions(who.courseId) });
    }
    // A faculty member previewing as a student gets a private practice room of
    // their own: they own it, they are its only participant, it is never listed
    // for a course and it never reports completion.
    if (action === 'practice') {
      const who = faculty(req, b);
      if (!who) return error(res, 401, 'faculty_authorization_required');
      const pid = who.platform ? who.id : 'practice:' + newId();
      for (let attempt = 0; attempt < 10; attempt++) {
        const c = codeOf();
        let session = room.createSession({ code: c, owner: who.name || 'Instructor', ownerKey: who.key || null,
          mode: 'team', groupSize: 1, name: 'Practice session', now: Date.now() });
        Object.assign(session, { platformAuth: !!who.platform, ownerId: who.platform ? who.id : null,
          courseId: who.courseId || null, practice: true, solo: true });
        session = room.join(session, pid, who.email || 'instructor@practice.room', Date.now());
        session = room.move(session, pid, 'new');
        if (!await store.createSession(c, session)) continue;
        return res.status(200).json({ participantId: pid, ...studentResult(session, pid) });
      }
      return error(res, 503, 'code_unavailable');
    }
    if (action === 'create') {
      const who = faculty(req, b);
      if (!who) return error(res, 401, 'faculty_authorization_required');
      if (who.platform && who.courseId) {
        const open = await otherOpen(who.courseId, null);
        if (open.length && !b.closeOpen) return otherOpenReply(res, open, 'Starting a new session');
        if (open.length) await closeOthers(open, who, req, b);
      }
      const mode = String(b.mode || '');
      const minutes = b.clockMinutes === undefined ? undefined : Number(b.clockMinutes);
      for (let attempt = 0; attempt < 10; attempt++) {
        const c = codeOf();
        let session;
        try { session = room.createSession({ code: c, owner: who.name || 'Facilitator', ownerKey: who.key || null, mode,
          groupSize: b.groupSize === undefined ? undefined : Number(b.groupSize),
          clockMinutes: minutes, name: b.name, now: Date.now() }); }
        catch (e) { return error(res, 400, 'invalid_session', e.message); }
        session.platformAuth = !!who.platform;
        session.ownerId = who.platform ? who.id : null;
        session.courseId = who.courseId || null;
        if (!await store.createSession(c, session)) continue;
        if (session.platformAuth && session.courseId) await store.addCourseSession(session.courseId, c, session.createdAt).catch(e => console.error('course list failed', e.message));
        await announce();
        return res.status(200).json({ session: { ...room.facultyKit(session, Date.now()).session, joinUrl: joinUrl(session) }, joinUrl: joinUrl(session) });
      }
      return error(res, 503, 'code_unavailable');
    }
    // Rehearse: three practice students, each on their own run, outside the class's sessions.
    if (['practice_start', 'practice_status', 'practice_finish'].includes(action)) {
      const who = faculty(req, b);
      if (!who) return error(res, 401, 'faculty_authorization_required');
      if (!who.platform || !who.courseId) return error(res, 403, 'course_launch_required');
      const ownerSub = who.id.slice('platform:'.length);
      const current = await store.getPracticeSession(who.courseId, ownerSub);
      const existing = current ? await store.getSession(current) : null;
      const mine = existing && existing.practice && owns(who, existing) ? existing : null;
      if (action === 'practice_status') return res.status(200).json(mine ? { code: current, ...practiceProgress(mine) } : { code: null });
      if (action === 'practice_finish') {
        if (mine) await store.wipe(current);
        await store.clearPracticeSession(who.courseId, ownerSub);
        return res.status(200).json({ ok: true });
      }
      if (mine && b.startOver !== true && room.kitState(mine) !== 'closed') return res.status(200).json({ code: current, resumed: true, ...practiceProgress(mine) });
      if (mine) await store.wipe(current);
      const prefix = `practice-${ownerSub}-`;
      const people = (Array.isArray(b.students) ? b.students : []).slice(0, 3).filter(x => x && typeof x.sub === 'string' &&
        x.sub.startsWith(prefix) && /^[A-Za-z0-9_-]{1,160}$/.test(x.sub) && typeof x.name === 'string' && x.name.trim());
      if (!people.length) return error(res, 400, 'practice_students_required');
      for (let attempt = 0; attempt < 10; attempt++) {
        const c = codeOf(), now = Date.now();
        let session = room.createSession({ code: c, owner: who.name || 'Instructor', mode: 'individual', name: 'Practice', now });
        Object.assign(session, { platformAuth: true, ownerId: who.id, courseId: who.courseId, practice: true });
        for (const x of people) {
          const id = `platform:${x.sub}`;
          session.participants[id] = { id, email: null, name: x.name.trim().slice(0, 60), joinedAt: null, slotId: null, reportedAt: null };
        }
        // Practice opens in setup, as a class does: the students read the story, then one starts the clock.
        if (!await store.createSession(c, session)) continue;
        await store.setPracticeSession(who.courseId, ownerSub, c);
        return res.status(200).json({ code: c, students: people.map(x => ({ participantId: `platform:${x.sub}`, name: x.name })) });
      }
      return error(res, 503, 'code_unavailable');
    }
    if (!validCode(code)) return error(res, 400, 'invalid_session_code');
    for (let attempt = 0; attempt < 8; attempt++) {
      const session = await store.getSession(code);
      if (!session) return error(res, 404, 'no_such_session');
      let who;
      if (FACULTY_ACTIONS.includes(action)) {
        who = faculty(req, b);
        if (!who) return error(res, 401, 'faculty_authorization_required');
        if (!owns(who, session)) return error(res, 403, 'not_your_session');
      }
      if (action === 'faculty_state') {
        const k = room.facultyKit(session, Date.now());
        return res.status(200).json({ ...k, session: { ...k.session, joinUrl: joinUrl(session) }, joinUrl: joinUrl(session),
          projector: room.projector(session, Date.now()) });
      }
      // Approved students of the class appear on the Teams tab before they open the sim.
      if (action === 'faculty_enrolments') {
        if (session.practice) {
          return res.status(200).json({ available: true, practice: true,
            students: Object.values(session.participants).map(p => ({ participantId: p.id, name: p.name, accessReleased: true })) });
        }
        let roster;
        try { roster = await courseEnrolments(req, b, session); }
        catch (e) { return error(res, e.status || 503, 'enrolments_unavailable', e.message); }
        const add = roster.available && room.kitState(session) !== 'closed'
          ? roster.students.filter(st => st.accessReleased === true && /^platform:[A-Za-z0-9_-]+$/.test(String(st.participantId || '')) && !session.participants[st.participantId])
          : [];
        if (add.length) {
          const next = structuredClone(session);
          for (const st of add) next.participants[st.participantId] = { id: st.participantId, email: null,
            name: String(st.name || '').trim().slice(0, 60) || 'Student', joinedAt: null, slotId: null, reportedAt: null, source: 'course' };
          if (!await store.compareAndSetSession(code, session, next)) continue;
        }
        return res.status(200).json(roster);
      }
      if (action === 'private_check') return res.status(200).json({ checks: room.privateCheck(session) });
      if (action === 'report') {
        if (room.kitState(session) !== 'closed' && session.stage !== 3) return error(res, 409, 'not_complete');
        return res.status(200).json({ ok: true, completion: await reportPeople(session, finishedIds(session), 1) });
      }
      if (action === 'hide_session') {
        if (room.kitState(session) !== 'closed') return error(res, 409, 'session_open', 'Close the session first. Then you can hide it.');
        if (!await store.compareAndSetSession(code, session, { ...session, hidden: true, hiddenAt: Date.now() })) continue;
        return res.status(200).json({ ok: true });
      }
      let next, after = null;
      try {
        if (action === 'control') {
          const set = String(b.set || ''), now = Date.now(), state = room.kitState(session);
          if (set === 'start') next = room.start(session, now);
          else if (set === 'pause') {
            if (state !== 'running' || session.pausedAt) return error(res, 409, 'not_running', 'The session is not running.');
            next = { ...session, pausedAt: now };
          } else if (set === 'resume') {
            if (!session.pausedAt) return error(res, 409, 'not_paused', 'The session is not paused.');
            next = { ...session, pausedAt: null, pausedMs: (session.pausedMs || 0) + (now - session.pausedAt) };
          } else if (set === 'review') {
            if (state !== 'running' || !room.allLocked(session, now)) return error(res, 409, 'numbers_open', 'Release the review questions once every team has locked its number.');
            next = { ...session, reviewOpen: true, reviewAt: now };
            after = async n => reportPeople(n, finishedIds(n), 1);
          } else if (set === 'close') {
            next = closed(session, who, String(b.from || '').slice(0, 20));
            after = async n => { await reportPeople(n, finishedIds(n), 1); await moveSessionRoster(req, b, n, 'archive', n.participants); };
          } else if (set === 'reopen') {
            if (state !== 'closed') return error(res, 409, 'session_not_closed');
            if (!session.practice && session.courseId) {
              const open = await otherOpen(session.courseId, code);
              if (open.length && !b.closeOpen) return otherOpenReply(res, open, 'Reopening this session');
              if (open.length) await closeOthers(open, who, req, b);
            }
            next = { ...session, state: session.startedAt ? 'running' : 'lobby', stage: session.stage >= 3 ? 2 : session.stage, reopenedAt: now };
            after = async n => {
              if (n.courseId && !n.practice && n.platformAuth) await store.indexCourseSession(n.courseId, code).catch(() => {});
              await moveSessionRoster(req, b, n, 'restore', n.participants);
            };
          } else return error(res, 400, 'unknown_control');
        } else if (action === 'group') {
          next = session;
          for (const [pid, value] of Object.entries(b.assign || {})) {
            if (!next.participants[pid]) throw new Error('Choose a student on the class list.');
            next = room.assign(next, pid, value);
          }
        } else if (action === 'set_captain') next = room.setCaptain(session, String(b.participantId || ''));
        else if (action === 'rename_team') next = room.rename(session, String(b.groupId || ''), b.teamLabel);
        else if (['divide', 'move', 'rename'].includes(action)) {
          next = action === 'divide' ? room.divide(session, b.groupSize === undefined ? undefined : Number(b.groupSize))
            : action === 'move' ? room.move(session, String(b.participantId || ''), String(b.target || ''))
            : room.rename(session, String(b.slotId || ''), b.label);
          next = room.withCaptains(next);
        } else if (action === 'start') {
          // The faculty preview room starts from the student page.
          next = room.start(session, Date.now());
        } else if (action === 'advance') {
          next = room.advance(session, Date.now());
          if (next.stage >= 2) next.reviewOpen = true;
          if (next.stage === 3) after = async n => reportPeople(n, finishedIds(n), 1);
        }
      } catch (e) { return error(res, 409, action === 'control' ? 'control_rejected' : 'groups_rejected', e.message); }

      if (['join', 'state', 'commit', 'review', 'practice_clock'].includes(action)) {
        const me = participant(req, b, session);
        if (!me) return error(res, 401, 'participant_authorization_required');
        if (action === 'join') {
          const id = me.platform ? me.id : (me.id || newId());
          if (me.platform && !!session.practice !== isPracticeId(id) && !session.solo) return error(res, 403, 'practice_only');
          if (session.practice && !session.solo && !session.participants[id]) return error(res, 403, 'practice_only');
          try { next = room.join(session, id, me.platform ? (me.email || b.email) : b.email, Date.now(), me.platform ? me.name : null); }
          catch (e) { return error(res, 409, 'join_rejected', e.message); }
          if (me.platform) next.participants[id].launchId = me.launchId;
          if (!await store.compareAndSetSession(code, session, next)) continue;
          return res.status(200).json({ participantId: id, ...studentResult(next, id) });
        }
        if (!me.id || !session.participants[me.id]) return error(res, 403, 'not_joined');
        if (action === 'state') return res.status(200).json(studentResult(session, me.id));
        // Rehearse: any practice student starts the practice clock (a class waits for its instructor).
        if (action === 'practice_clock') {
          if (!session.practice || session.solo) return error(res, 403, 'practice_only');
          try { next = room.start(session, Date.now()); }
          catch (e) { return error(res, 409, 'start_rejected', e.message); }
          if (!await store.compareAndSetSession(code, session, next)) continue;
          return res.status(200).json(studentResult(next, me.id));
        }
        if (action === 'review') {
          const view = room.studentView(session, me.id, Date.now());
          if (!view.review.open) return error(res, 409, 'review_closed', 'The review questions open after the class sees the numbers.');
          const r1 = String(b.reflection1 || '').trim().slice(0, 1500), r2 = String(b.reflection2 || '').trim().slice(0, 1500);
          if (!r1 || !r2) return error(res, 400, 'answers_required', 'Answer both questions, then submit.');
          next = structuredClone(session);
          next.participants[me.id].review = { reflection1: r1, reflection2: r2, at: Date.now() };
          if (!await store.compareAndSetSession(code, session, next)) continue;
          await reportPeople(next, [me.id], 2);
          return res.status(200).json({ ok: true, ...studentResult(next, me.id) });
        }
        try { next = room.commit(session, me.id, b.number, b.confidence, Date.now()); }
        catch (e) { return error(res, 409, 'commit_rejected', e.message); }
        if (!await store.compareAndSetSession(code, session, next)) continue;
        return res.status(200).json({ ok: true, ...studentResult(next, me.id) });
      }
      if (!next) return error(res, 400, 'unknown_action');
      if (!await store.compareAndSetSession(code, session, next)) continue;
      const completion = after ? await after(next) : undefined;
      return res.status(200).json({ session: { ...room.facultyKit(next, Date.now()).session, joinUrl: joinUrl(next) }, ...(completion ? { completion } : {}) });
    }
    return error(res, 409, 'busy_retry', 'The session changed while saving. Try again.');
  } catch (e) {
    console.error('Sim 04 session error:', action, e.message);
    return error(res, e.status || 503, 'session_unavailable', 'Please try again.');
  }
};
