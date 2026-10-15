// Everything to do with a facilitated session. One endpoint, action-switched,
// so the deployment stays small. Faculty use the shared RapidSims faculty pages
// (platform/public/kit/); the actions match Midland's so those pages work unchanged.
const crypto = require('node:crypto');
const { body } = require('../lib/guard.js');
const store = require('../lib/store.js');
const { verifyLaunch } = require('../lib/launch.js');
const enrolments = require('../lib/course-enrolments.js');
const S = require('../lib/scenario.js');
const B = require('../lib/bands.js');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const newId = () => Math.random().toString(36).slice(2, 10);
const TITLE = 'Disaster or Breach?';

async function pointCourse(fn) {
  try { await fn(); } catch (e) { console.error('course session pointer update failed', e.code || e.message); }
}

// Faculty codes. FACULTY_CODES holds one entry per person as "Name:code",
// comma separated — e.g. "Chuck Rivera:chuck-8811,Dana Okoye:dana-4420".
// FACULTY_CODE (singular) is still honoured as a shared fallback.
function facultyRoster() {
  const raw = process.env.FACULTY_CODES || '';
  const out = [];
  raw.split(',').map(s => s.trim()).filter(Boolean).forEach(entry => {
    const i = entry.lastIndexOf(':');
    if (i > 0) out.push({ name: entry.slice(0, i).trim(), code: entry.slice(i + 1).trim() });
  });
  const single = process.env.FACULTY_CODE;
  if (single) out.push({ name: 'Facilitator', code: single });
  return out;
}

// Returns who the faculty member is, or null. A platform launch token proves it;
// a configured facilitator code still works for standalone use.
function whoIsFaculty(req, b) {
  const lt = req.headers['x-launch-token'] || (b && b.launchToken);
  if (lt) {
    const p = verifyLaunch(String(lt));
    if (p && p.sim === S.META.id && (p.role === 'faculty' || p.role === 'faculty_preview')) {
      return { name: p.name || 'Facilitator', ownerId: p.sub, courseId: p.course || null, platformAuth: true, session: p.mode === 'session' };
    }
  }
  const roster = facultyRoster();
  if (!roster.length) return null;
  const given = String((b && b.facultyCode) || req.headers['x-faculty-code'] || '').trim();
  if (!given) return null;
  const hit = roster.find(r => r.code === given);
  return hit ? { name: hit.name, ownerKey: crypto.createHash('sha256').update(hit.code).digest('hex') } : null;
}

// A session belongs to whoever created it. Others can't drive it.
function ownsSession(who, sess) {
  if (!who || !sess) return false;
  if (sess.ownerId) return who.ownerId === sess.ownerId && (who.courseId || null) === (sess.courseId || null);
  return !!sess.ownerKey && who.ownerKey === sess.ownerKey;
}

// A student or faculty member signed in through the platform.
function participantLaunch(req, b) {
  const token = req.headers['x-launch-token'] || (b && b.launchToken);
  const p = token ? verifyLaunch(String(token)) : null;
  return p && p.sim === S.META.id && p.sub && ['student', 'faculty', 'faculty_preview'].includes(p.role) ? p : null;
}
const isPracticeSub = sub => String(sub || '').startsWith('practice-');

// What the student's browser is allowed to know about the session.
function publicSession(sess) {
  return {
    code: sess.code, name: sess.name, state: sess.state, mode: 'individual',
    paused: !!sess.paused, revealed: !!sess.revealed, holdReveal: !!sess.holdReveal
  };
}

// One open session per class. The class's other open sessions (practice excluded).
async function otherOpenSessions(courseId, except) {
  if (!courseId) return [];
  let codes = [];
  try {
    codes = (await store.listCourseSessions(courseId)) || [];
    const pointer = await store.getCourseSession(courseId);
    if (pointer && !codes.includes(pointer)) codes.push(pointer);
  } catch (e) { console.error('course session list failed', e.code || e.message); return []; }
  const out = [];
  for (const c of codes) {
    if (c === except) continue;
    const s = await store.getSession(c).catch(() => null);
    if (s && !s.practice && s.state !== 'closed') out.push(s);
  }
  return out;
}
async function closeSessions(list, who, from, req, b) {
  for (const s of list) {
    const next = { ...s, state: 'closed', revealed: true, closedAt: Date.now(), closedBy: who.name || null, closedFrom: from };
    await store.putSession(s.code, next);
    if (next.courseId) await pointCourse(() => store.clearCourseSession(next.courseId, s.code));
    if (req) await enrolments.moveSessionRoster(req, b, next, 'archive', await store.getParticipants(s.code).catch(() => ({})));
  }
}
function otherOpenReply(res, list, verb) {
  const first = list[0];
  return res.status(409).json({ error: 'other_session_open', open: list.map(s => ({ code: s.code, name: s.name || TITLE })),
    message: `${verb} closes the open session "${first.name || TITLE}". Students who finished keep their results.` });
}

// The faculty pages read one run per student, keyed by its run id, with its result band.
function facultyRuns(runs, participants) {
  const out = {};
  for (const [gid, r] of Object.entries(runs || {})) {
    if (!r) continue;
    const p = participants[gid], runId = `individual:${gid}`;
    out[runId] = { ...r, runId, runnerId: gid, completedBy: r.done ? gid : null, teamLabel: p ? p.name : '',
      band: r.done ? B.bandOf(r.positions) : null };
  }
  return out;
}

// What the faculty pages need to show results and run the class debrief. Faculty only:
// it names the resolution, so it never reaches a student's browser.
const debriefKit = () => ({
  bands: B.BANDS, order: B.ORDER, irreversible: B.IRREVERSIBLE, actionLabels: B.ACTION_LABEL, readingLabels: B.READING_LABEL,
  phases: S.PHASES.map(p => p.label), reviewQuestions: S.REVIEW_QUESTIONS, lessonQuestions: S.LESSON_QUESTIONS, lessons: S.LESSONS,
  resolution: { headline: 'It was <span class="md-t-both">both</span>.', text: 'A real FW-2231 firmware fault corrupted SAN-03, as Kate said. Separately, an intruder had been in the estate for three weeks and used the incident window. The modified backup jobs were theirs.' },
  fork: S.FORK, coverage: 'A cost review had cut Sophia\'s detection on one segment. "Nothing has alerted" meant her tooling saw nothing there. She told anyone who asked where her silence was worth less.'
});

// Students already finished, as the class page's practice panel shows them.
async function practiceProgress(code) {
  const [people, runs] = await Promise.all([store.getParticipants(code), store.getRuns(code)]);
  const students = Object.values(people || {}).filter(Boolean).map(p => {
    const r = (runs || {})[p.id] || {};
    const status = r.done ? 'Finished the debrief' : r.phase > 0 ? `At ${S.PHASES[Math.min(r.phase, 2)].label}` : p.joinedAt ? 'Reading the brief' : 'Ready to start';
    return { name: p.name, status, finished: !!r.done };
  });
  return { students, complete: students.length > 0 && students.every(x => x.finished) };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!store.configured()) {
    return res.status(503).json({ error: 'no_store', message: 'Session storage is not set up on this deployment.' });
  }

  const b = body(req);
  const action = String(b.action || '');
  const code = String(b.code || '').toUpperCase().trim();
  const facultyOnly = async () => {
    const who = whoIsFaculty(req, b);
    if (!who) { res.status(401).json({ error: 'faculty_authorization_required' }); return null; }
    const sess = await store.getSession(code);
    if (!sess) { res.status(404).json({ error: 'no_such_session' }); return null; }
    if (!ownsSession(who, sess)) { res.status(403).json({ error: 'not_your_session', message: `That session belongs to ${sess.owner}.` }); return null; }
    return { who, sess };
  };

  try {
    switch (action) {

      // ---------- faculty ----------
      case 'create': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        if (b.mode && b.mode !== 'individual') return res.status(400).json({ error: 'play_mode_required', message: 'Disaster or Breach is played individually.' });
        if (who.platformAuth && who.courseId) {
          const open = await otherOpenSessions(who.courseId, null);
          if (open.length && !b.closeOpen) return otherOpenReply(res, open, 'Starting a new session');
          if (open.length) await closeSessions(open, who, 'new-session', req, b);
        }
        const c = newCode();
        const sess = {
          code: c, owner: who.name, ownerId: who.ownerId || null, ownerKey: who.ownerKey || null,
          platformAuth: !!who.platformAuth, courseId: who.courseId || null,
          name: String(b.name || TITLE).slice(0, 80), mode: 'individual',
          state: 'lobby', paused: false, revealed: false,
          // Release the debrief to students yourself, or let each student see it as they finish.
          holdReveal: b.holdReveal === true,
          createdAt: Date.now()
        };
        await store.putSession(c, sess);
        if (sess.courseId) {
          await pointCourse(() => store.addCourseSession(sess.courseId, c, sess.createdAt));
          await pointCourse(() => store.setCourseSession(sess.courseId, c));
        }
        return res.status(200).json({ session: sess, you: who.name });
      }

      case 'faculty_state': {
        const ok = await facultyOnly(); if (!ok) return;
        const { who, sess } = ok;
        const [participants, runs] = await Promise.all([store.getParticipants(code), store.getRuns(code)]);
        return res.status(200).json({ session: sess, participants, runs: facultyRuns(runs, participants), you: who.name,
          phases: S.PHASES.map(p => p.label), kit: debriefKit() });
      }

      // Approved students of the class appear on the Students tab before they open the sim.
      case 'faculty_enrolments': {
        const ok = await facultyOnly(); if (!ok) return;
        const { sess } = ok;
        if (sess.practice) {
          const people = Object.values(await store.getParticipants(code) || {}).filter(Boolean);
          return res.status(200).json({ available: true, practice: true,
            students: people.map(p => ({ participantId: p.id, name: p.name, accessReleased: true })) });
        }
        try {
          const roster = await enrolments.courseEnrolments(req, b, sess);
          if (roster.available && sess.state !== 'closed') {
            const existing = await store.getParticipants(code);
            for (const st of roster.students) {
              const id = String(st.participantId || '');
              if (st.accessReleased !== true || !/^platform:[A-Za-z0-9_-]+$/.test(id) || existing[id]) continue;
              await store.addParticipant(code, id, { id, name: String(st.name || '').trim().slice(0, 60) || 'Student',
                groupId: id, source: 'course', addedAt: Date.now(), joinedAt: null });
            }
          }
          return res.status(200).json(roster);
        } catch (e) {
          return res.status(e.status || 503).json({ error: 'enrolments_unavailable', message: e.message });
        }
      }

      case 'control': {
        const ok = await facultyOnly(); if (!ok) return;
        const { who, sess } = ok;
        if (b.set === 'start') {
          if (sess.state !== 'lobby') return res.status(409).json({ error: 'session_already_started', message: 'This session has already started. Use Resume for a paused session.' });
          sess.state = 'running'; sess.startedAt = Date.now();
        }
        if (b.set === 'pause') sess.paused = true;
        if (b.set === 'resume') sess.paused = false;
        if (b.set === 'reveal') sess.revealed = true;
        if (b.set === 'reopen') {
          if (sess.state !== 'closed') return res.status(409).json({ error: 'session_not_closed' });
          if (!sess.practice && sess.courseId) {
            const open = await otherOpenSessions(sess.courseId, code);
            if (open.length && !b.closeOpen) return otherOpenReply(res, open, 'Reopening this session');
            if (open.length) await closeSessions(open, who, 'reopen-other', req, b);
          }
          sess.state = sess.startedAt ? 'running' : 'lobby'; sess.paused = false; sess.reopenedAt = Date.now();
        }
        if (b.set === 'close') {
          sess.state = 'closed'; sess.revealed = true;
          sess.closedAt = Date.now(); sess.closedBy = who.name || null; sess.closedFrom = String(b.from || '').slice(0, 20) || null;
        }
        await store.putSession(code, sess);
        if (sess.courseId && !sess.practice) {
          if (sess.state === 'closed') await pointCourse(() => store.clearCourseSession(sess.courseId, code));
          if (b.set === 'reopen') await pointCourse(() => store.setCourseSession(sess.courseId, code));
        }
        // Students move into Results on the class page when a session closes; reopening brings them back.
        if (b.set === 'close' || b.set === 'reopen') {
          await enrolments.moveSessionRoster(req, b, sess, b.set === 'close' ? 'archive' : 'restore', await store.getParticipants(code).catch(() => ({})));
        }
        return res.status(200).json({ session: sess });
      }

      // The class's sessions, newest first, for the Sessions page.
      case 'course_sessions': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        if (!who.platformAuth || !who.courseId) return res.status(200).json({ sessions: [] });
        let codes = [];
        try {
          codes = await store.listCourseSessions(who.courseId);
          const open = await store.getCourseSession(who.courseId);
          if (open && !codes.includes(open)) codes.unshift(open);
        } catch (e) { console.error('course session list failed', e.code || e.message); }
        const sessions = [];
        for (const c of codes.slice(0, 20)) {
          const sess = await store.getSession(c);
          if (!sess || sess.practice || sess.hidden || !ownsSession(who, sess)) continue;
          const [people, runs] = await Promise.all([store.getParticipants(c), store.getRuns(c)]);
          const list = Object.values(people || {}).filter(Boolean);
          sessions.push({ code: c, name: sess.name, mode: 'individual', state: sess.state, paused: !!sess.paused,
            createdAt: sess.createdAt || null, students: list.length, teams: 0,
            submitted: Object.values(runs || {}).filter(r => r && r.done).length });
        }
        sessions.sort((a, b2) => (b2.createdAt || 0) - (a.createdAt || 0));
        return res.status(200).json({ sessions });
      }

      // A closed session leaves the Sessions list. Its results stay on the platform under Past sessions.
      case 'hide_session': {
        const ok = await facultyOnly(); if (!ok) return;
        const { sess } = ok;
        if (sess.state !== 'closed') return res.status(409).json({ error: 'session_open', message: 'Close the session first. Then you can hide it.' });
        await store.putSession(code, { ...sess, hidden: true, hiddenAt: Date.now() });
        return res.status(200).json({ ok: true });
      }

      // Rehearse: one practice student in a running session of its own, outside the class's sessions.
      case 'practice_start': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        if (!who.platformAuth || !who.courseId || !who.ownerId) return res.status(403).json({ error: 'course_launch_required' });
        const prefix = `practice-${who.ownerId}-`;
        const people = (Array.isArray(b.students) ? b.students : []).slice(0, 3).filter(x => x &&
          typeof x.sub === 'string' && x.sub.startsWith(prefix) && /^[A-Za-z0-9_-]{1,160}$/.test(x.sub) &&
          typeof x.name === 'string' && x.name.trim());
        if (!people.length) return res.status(400).json({ error: 'practice_students_required' });
        const earlier = await store.getPracticeSession(who.courseId, who.ownerId);
        if (earlier && b.startOver !== true) {
          const existing = await store.getSession(earlier);
          if (existing && existing.practice && existing.state !== 'closed' && ownsSession(who, existing)) {
            return res.status(200).json({ code: earlier, resumed: true, ...(await practiceProgress(earlier)) });
          }
        }
        if (earlier) await store.wipe(earlier);
        const c = newCode(), now = Date.now();
        await store.putSession(c, { code: c, owner: who.name, ownerId: who.ownerId, platformAuth: true, courseId: who.courseId,
          name: 'Practice', mode: 'individual', state: 'running', paused: false, revealed: false, holdReveal: false,
          practice: true, createdAt: now, startedAt: now });
        for (const x of people) {
          const id = `platform:${x.sub}`;
          await store.addParticipant(c, id, { id, name: x.name.trim().slice(0, 60), groupId: id, source: 'practice', addedAt: now, joinedAt: null });
        }
        await store.setPracticeSession(who.courseId, who.ownerId, c);
        return res.status(200).json({ code: c, students: people.map(x => ({ participantId: `platform:${x.sub}`, name: x.name })) });
      }
      case 'practice_status': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        if (!who.courseId || !who.ownerId) return res.status(403).json({ error: 'course_launch_required' });
        const current = await store.getPracticeSession(who.courseId, who.ownerId);
        const sess = current ? await store.getSession(current) : null;
        if (!sess || !sess.practice || !ownsSession(who, sess)) return res.status(200).json({ code: null });
        return res.status(200).json({ code: current, ...(await practiceProgress(current)) });
      }
      case 'practice_finish': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        if (!who.courseId || !who.ownerId) return res.status(403).json({ error: 'course_launch_required' });
        const current = await store.getPracticeSession(who.courseId, who.ownerId);
        if (current) {
          const sess = await store.getSession(current);
          if (sess && sess.practice && ownsSession(who, sess)) await store.wipe(current);
          await store.clearPracticeSession(who.courseId, who.ownerId);
        }
        return res.status(200).json({ ok: true });
      }

      // ---------- students ----------
      // A student opening the class link lands in the class's open session (or a practice student in theirs).
      case 'course_session': {
        const p = participantLaunch(req, b);
        if (!p) return res.status(401).json({ error: 'platform_signin_required' });
        if (!p.course) return res.status(200).json({ code: null });
        if (isPracticeSub(p.sub)) {
          const owner = String(p.sub).slice('practice-'.length).replace(/-[^-]+$/, '');
          const practice = await store.getPracticeSession(p.course, owner).catch(() => null);
          return res.status(200).json({ code: practice || null });
        }
        const open = await store.getCourseSession(p.course).catch(() => null);
        const sess = open ? await store.getSession(open) : null;
        return res.status(200).json({ code: sess && sess.state !== 'closed' && sess.courseId === p.course ? open : null });
      }

      case 'join': {
        const sess = await store.getSession(code);
        if (!sess) return res.status(404).json({ error: 'no_such_session' });
        if (sess.state === 'closed') return res.status(410).json({ error: 'session_closed' });
        const p = participantLaunch(req, b);
        let id, name;
        if (sess.platformAuth || p) {
          // Platform students are their signed account: no name to type, no id to remember.
          if (!p) return res.status(401).json({ error: 'platform_signin_required' });
          if (sess.courseId && p.course !== sess.courseId) return res.status(403).json({ error: 'session_course_mismatch' });
          if (!!sess.practice !== isPracticeSub(p.sub)) return res.status(403).json({ error: 'practice_only' });
          id = `platform:${p.sub}`; name = String(p.name || 'Student').slice(0, 60);
        } else {
          name = String(b.name || '').slice(0, 60).trim();
          if (!name) return res.status(400).json({ error: 'name_required' });
          id = String(b.participantId || '') || newId();
        }
        const existing = (await store.getParticipants(code))[id];
        await store.addParticipant(code, id, {
          ...(existing || {}), id, name, launchId: p ? p.run : undefined,
          // Each student plays their own run: their run id is their participant id.
          groupId: id, joinedAt: (existing && existing.joinedAt) || Date.now()
        });
        return res.status(200).json({ participantId: id, name, session: publicSession(sess) });
      }

      // Polled by the student's browser: session state plus their own record.
      case 'state': {
        const sess = await store.getSession(code);
        if (!sess) return res.status(404).json({ error: 'no_such_session' });
        const pid = String(b.participantId || '');
        const me = (await store.getParticipants(code))[pid] || null;
        return res.status(200).json({ session: publicSession(sess), me, mates: me ? [me.name] : [] });
      }

      // A student locks a position, or finishes.
      case 'submit': {
        const sess = await store.getSession(code);
        if (!sess) return res.status(404).json({ error: 'no_such_session' });
        const groupId = String(b.groupId || '');
        if (!groupId) return res.status(400).json({ error: 'group_required' });
        const pid = String(b.participantId || '');
        const who = (await store.getParticipants(code))[pid];
        if (!who || who.groupId !== groupId) return res.status(403).json({ error: 'not_in_that_group' });
        if (pid.startsWith('platform:')) {
          const p = participantLaunch(req, b);
          if (!p || `platform:${p.sub}` !== pid) return res.status(403).json({ error: 'participant_identity_mismatch' });
        }
        const runs = await store.getRuns(code);
        const run = runs[groupId] || { groupId, positions: [], phase: 0, done: false };
        if (Array.isArray(b.positions)) run.positions = b.positions.slice(0, 3);
        if (typeof b.phase === 'number') run.phase = b.phase;
        if (b.done) run.done = true;
        if (b.coverageEarnedAt !== undefined) run.coverageEarnedAt = b.coverageEarnedAt;
        if (b.coveragePrivate !== undefined) run.coveragePrivate = !!b.coveragePrivate;
        if (b.privateCount !== undefined) run.privateCount = b.privateCount;
        for (const k of ['reflection1', 'reflection2']) if (typeof b[k] === 'string') run[k] = b[k].slice(0, 1500);
        if (b.done) run.completedAt = run.completedAt || Date.now();
        run.updatedAt = Date.now();
        await store.setRun(code, groupId, run);
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: 'unknown_action' });
    }
  } catch (e) {
    if (e.code === 'NO_STORE') return res.status(503).json({ error: 'no_store', message: e.message });
    console.error('session failure', action, e.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
