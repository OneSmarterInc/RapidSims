const { body } = require('../lib/guard.js');
const enrolmentsLib = require('../lib/course-enrolments.js');
const { syncCourseRoster, approvedIds } = require('../lib/session-roster.js');
const store = require('../lib/store.js');
const { verifyLaunch } = require('../lib/launch.js');
const S = require('../lib/scenario.js');
const { buildClosingLesson } = require('../lib/closingLesson.js');
const { accountJoinUrl, participantLaunch, participantError, openTeamSessionFor, isPracticeSub } = require('../lib/session-entry.js');

async function pointCourse(fn) {
  try { await fn(); } catch (e) { console.error('course session pointer update failed', e.code || e.message); }
}

// One open session per course. Finds the course's other open sessions (practice excluded).
async function otherOpenSessions(courseId, except) {
  if (!courseId) return [];
  let codes = [];
  try {
    codes = (await store.listCourseSessions(courseId)) || [];
    const pointer = await store.getCourseTeamSession(courseId);
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

// Close those sessions after faculty confirmed. Teams keep their saved decisions and results.
async function closeSessions(list, who, from, req, b) {
  for (const s of list) {
    for (let i = 0; i < 5; i++) {
      const prev = await store.getSession(s.code);
      if (!prev || prev.state === 'closed') break;
      const next = { ...structuredClone(prev), state: 'closed', closedAt: Date.now(), closedBy: who.name || null, closedFrom: from };
      if (await store.compareAndSetSession(s.code, prev, next)) {
        if (next.courseId) await pointCourse(() => store.clearCourseTeamSession(next.courseId, s.code));
        if (req) await enrolmentsLib.moveSessionRoster(req, b, next, 'archive', await store.getParticipants(s.code).catch(() => ({})));
        break;
      }
    }
  }
}

function otherOpenReply(res, list, verb) {
  const first = list[0];
  return res.status(409).json({ error: 'other_session_open', open: list.map(s => ({ code: s.code, name: s.name || 'Midland Equipment' })),
    message: `${verb} closes the open session "${first.name || 'Midland Equipment'}". Submitted teams keep their results. Unfinished teams keep their saved decisions.` });
}
const { leadOf, runnerOf, revisionOf, screenOf } = require('../lib/team-runner.js');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const newId = () => Math.random().toString(36).slice(2, 10);

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
    if (p && p.sim === S.META.id && (p.role === 'faculty' || p.role === 'faculty_preview')) {
      return { name: p.name || 'Facilitator', userId: p.sub || null, platformAuth: true, courseId: p.course || null };
    }
  }

  // Fail closed. An empty standalone faculty roster is not authorization.
  // Platform-launched faculty use the signed launch token above; direct
  // standalone faculty access requires an explicitly configured code.
  const roster = facultyRoster();
  if (!roster.length) return null;
  const given = String((b && b.facultyCode) || req.headers['x-faculty-code'] || '').trim();
  if (!given) return null;
  const hit = roster.find(r => r.code === given);
  return hit ? { name: hit.name } : null;
}

function ownsSession(who, sess) {
  if (!who) return false;
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
  return {
    code: sess.code,
    name: sess.name,
    mode: sess.mode,
    state: sess.state,
    paused: !!sess.paused,
    createdAt: sess.createdAt,
    startedAt: sess.startedAt || null,
    allocationRules: S.publicRules(S.sessionThresholds(sess))
  };
}

function captainMap(participants, explicit) {
  const groups = {};
  Object.values(participants).filter(Boolean).forEach(p => {
    if (!p.groupId) return;
    (groups[p.groupId] ||= []).push(p);
  });
  const result = {};
  for (const [gid, members] of Object.entries(groups)) {
    const requested = explicit && explicit[gid];
    const chosen = requested && members.find(m => m.id === requested)
      ? requested
      : members.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))[0].id;
    result[gid] = chosen;
  }
  return result;
}

function runIdFor(sess, participant) {
  if (!participant) return null;
  return sess.mode === 'individual' ? `individual:${participant.id}` : participant.groupId;
}

function publicRun(run) {
  if (!run) return null;
  const teamRunComplete = !!run.runId && !String(run.runId).startsWith('individual:') && Number(run.phase || 0) >= 3;
  return {
    runId: run.runId,
    phase: run.phase || 0,
    screen: screenOf(run),
    year2Event: run.year2Event || 0,
    runnerId: run.runnerId || null,
    runnerRevision: revisionOf(run),
    year1: run.year1 || null,
    year2: run.year2 || null,
    strategicView: run.strategicView || '',
    reflection1: run.reflection1 || '',
    reflection2: run.reflection2 || '',
    outcomes: run.outcomes || null,
    done: !!run.done || teamRunComplete,
    finishedBy: run.finishedBy || {},
    updatedAt: run.updatedAt || null
  };
}

function visibleFacultyRuns(sess, runs) {
  if (!sess || sess.mode !== 'team') return runs;
  return Object.fromEntries(Object.entries(runs || {}).map(([id, run]) => {
    const complete = !!run?.done || Number(run?.phase || 0) >= 3;
    return [id, complete ? { ...run, done: true, completedAt: run.completedAt || run.updatedAt || null } : run];
  }));
}

function sameAllocation(a, b) {
  return !!a && !!b && S.LINES.every(k => Number(a[k]) === Number(b[k]));
}

// Where each practice student is, for the course page's practice panel.
const STEP_NAMES = ['Brief', 'People', 'Position', 'Year 1', 'Year 1', 'Year 1 outcome', 'Year 2', 'Events', 'Year 3', 'Buyers', 'Close'];
async function practiceProgress(code) {
  const people = Object.values(await store.getParticipants(code) || {}).filter(Boolean)
    .sort((a, b) => Number(b.isCaptain) - Number(a.isCaptain) || a.name.localeCompare(b.name));
  const run = (await store.getRuns(code) || {})['team:practice'] || null;
  const done = !!run && (!!run.done || Number(run.phase || 0) >= 3);
  const runner = runOwner(people, run);
  const step = STEP_NAMES[Math.max(0, Math.min(10, screenOf(run)))];
  const students = people.map(p => {
    const isRunner = runner && p.id === runner.id;
    const reviewed = !!(run && run.reflections && run.reflections[p.id]);
    const status = done ? (isRunner || reviewed ? (isRunner ? 'Submitted for the team' : 'Review sent') : 'Writing the review')
      : !run ? (isRunner ? 'Ready to start' : `Waiting for ${runner ? runner.name.replace(/^Practice /, '') : 'the team'}`) : (isRunner ? `Playing · ${step}` : `Following · ${step}`);
    return { participantId: p.id, name: p.name, entersDecisions: !!p.isCaptain, status, finished: done && (isRunner || reviewed) };
  });
  return { students, complete: done && students.every(x => x.finished) };
}
function runOwner(people, run) {
  const chosen = run && run.runnerId && people.find(p => p.id === run.runnerId);
  return chosen || people.find(p => p.isCaptain) || null;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!store.configured()) {
    return res.status(503).json({
      error: 'no_store',
      message: 'Session storage is not configured for this deployment.'
    });
  }

  const b = body(req);
  const action = String(b.action || '');
  const code = String(b.code || '').toUpperCase().trim();

  try {
    if (['join', 'state', 'submit', 'set_runner'].includes(action)) {
      const sess = await store.getSession(code);
      if (sess) {
        const error = participantError(req, b, sess, action === 'join' ? null : String(b.participantId || ''));
        if (error) return res.status(error.status).json({ error: error.error });
      }
    }
    for (let attempt = 0; attempt < 5; attempt++) {
    switch (action) {
      case 'course_session': {
        const launched = participantLaunch(req, b);
        if (!launched) return res.status(401).json({ error: 'platform_signin_required' });
        const open = await openTeamSessionFor(launched);
        return res.status(200).json({ code: open ? open.code : null });
      }

      case 'hide_session': {
        // A closed session leaves the Sessions list. Its results stay on the platform under Past sessions.
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        const code = String(b.code || '').toUpperCase();
        const sess = /^[A-Z2-9]{5}$/.test(code) ? await store.getSession(code) : null;
        if (!sess || !ownsSession(who, sess)) return res.status(404).json({ error: 'no_such_session' });
        if (sess.state !== 'closed') return res.status(409).json({ error: 'session_open', message: 'Close the session first. Then you can hide it.' });
        await store.putSession(code, { ...sess, hidden: true, hiddenAt: Date.now() });
        return res.status(200).json({ ok: true });
      }

      case 'course_sessions': {
        // The course's sessions, newest first, with what faculty need to open or close each one.
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        if (!who.platformAuth || !who.courseId) return res.status(200).json({ sessions: [] });
        let codes = [];
        try {
          codes = await store.listCourseSessions(who.courseId);
          const open = await store.getCourseTeamSession(who.courseId);
          if (open && !codes.includes(open)) codes.unshift(open);
        } catch (e) { console.error('course session list failed', e.code || e.message); }
        const sessions = [];
        for (const c of codes.slice(0, 20)) {
          const sess = await store.getSession(c);
          if (!sess || sess.practice || sess.hidden || !ownsSession(who, sess)) continue;
          const [people, teamRuns] = await Promise.all([store.getParticipants(c), store.getRuns(c)]);
          const list = Object.values(people || {}).filter(Boolean);
          const runs = Object.values(teamRuns || {}).filter(Boolean);
          sessions.push({ code: c, name: sess.name, mode: sess.mode, state: sess.state, paused: !!sess.paused,
            createdAt: sess.createdAt || null, students: list.length,
            teams: sess.mode === 'team' ? new Set(list.map(p => p.groupId).filter(Boolean)).size : 0,
            submitted: runs.filter(r => r.done || Number(r.phase || 0) >= 3).length });
        }
        sessions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return res.status(200).json({ sessions });
      }

      // Rehearse: a running team session with practice students only, outside
      // the course's real classes. The platform names the practice students.
      case 'practice_start': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        if (!who.platformAuth || !who.courseId || !who.userId) return res.status(403).json({ error: 'course_launch_required' });
        const prefix = `practice-${who.userId}-`;
        const people = (Array.isArray(b.students) ? b.students : []).slice(0, 6).filter(x => x &&
          typeof x.sub === 'string' && x.sub.startsWith(prefix) && /^[A-Za-z0-9_-]{1,160}$/.test(x.sub) &&
          typeof x.name === 'string' && x.name.trim());
        if (people.length < 2) return res.status(400).json({ error: 'practice_students_required' });
        // Rehearse returns to the practice class already running; Start over replaces it.
        const earlier = await store.getPracticeSession(who.courseId, who.userId);
        if (earlier && b.startOver !== true) {
          const existing = await store.getSession(earlier);
          const roster = existing && existing.practice ? Object.values(await store.getParticipants(earlier) || {}).filter(Boolean) : [];
          if (existing && existing.practice && existing.state !== 'closed' && ownsSession(who, existing) &&
              people.every(x => roster.some(p => p.id === `platform:${x.sub}`))) {
            return res.status(200).json({ code: earlier, resumed: true, ...(await practiceProgress(earlier)) });
          }
        }
        if (earlier) await store.wipe(earlier);
        const c = newCode(), now = Date.now();
        const sess = { code: c, owner: who.name, ownerId: who.userId, platformAuth: true, courseId: who.courseId,
          name: 'Practice', mode: 'team', state: 'running', paused: false, practice: true,
          thresholds: S.validateThresholds(undefined).thresholds, createdAt: now, startedAt: now };
        await store.putSession(c, sess);
        const records = people.map((x, i) => ({ id: `platform:${x.sub}`, name: x.name.trim().slice(0, 60),
          groupId: 'team:practice', teamLabel: 'Practice team', isCaptain: i === 0,
          source: 'practice', addedAt: now, joinedAt: null }));
        if (await store.ensureParticipants(c, records, sess) < 0) return res.status(409).json({ error: 'practice_busy' });
        await store.setPracticeSession(who.courseId, who.userId, c);
        return res.status(200).json({ code: c, students: records.map(p => ({ participantId: p.id, name: p.name, entersDecisions: p.isCaptain })) });
      }

      case 'practice_status': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        if (!who.courseId || !who.userId) return res.status(403).json({ error: 'course_launch_required' });
        const current = await store.getPracticeSession(who.courseId, who.userId);
        const sess = current ? await store.getSession(current) : null;
        if (!sess || !sess.practice || !ownsSession(who, sess)) return res.status(200).json({ code: null });
        return res.status(200).json({ code: current, ...(await practiceProgress(current)) });
      }

      case 'practice_finish': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        if (!who.courseId || !who.userId) return res.status(403).json({ error: 'course_launch_required' });
        const current = await store.getPracticeSession(who.courseId, who.userId);
        if (current) {
          const sess = await store.getSession(current);
          if (sess && sess.practice && ownsSession(who, sess)) await store.wipe(current);
          await store.clearPracticeSession(who.courseId, who.userId);
        }
        return res.status(200).json({ ok: true });
      }

      case 'create': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        const mode = String(b.mode || '');
        if (!['individual', 'team'].includes(mode)) {
          return res.status(400).json({ error: 'play_mode_required' });
        }
        const thresholdCheck = S.validateThresholds(b.thresholds);
        if (!thresholdCheck.ok) return res.status(400).json(thresholdCheck);
        if (who.platformAuth && who.courseId) {
          const open = await otherOpenSessions(who.courseId, null);
          if (open.length && !b.closeOpen) return otherOpenReply(res, open, 'Starting a new session');
          if (open.length) await closeSessions(open, who, 'new-session', req, b);
        }
        const c = newCode();
        const sess = {
          code: c,
          owner: who.name,
          ownerId: who.userId || null,
          platformAuth: !!who.platformAuth,
          courseId: who.courseId || null,
          name: String(b.name || 'Midland Equipment').slice(0, 80),
          mode,
          state: 'lobby',
          paused: false,
          thresholds: thresholdCheck.thresholds,
          createdAt: Date.now()
        };
        await store.putSession(c, sess);
        if (sess.courseId) await pointCourse(() => store.addCourseSession(sess.courseId, c, sess.createdAt));
        if (sess.mode === 'team' && sess.courseId) await pointCourse(() => store.setCourseTeamSession(sess.courseId, c));
        return res.status(200).json({ session: sess, you: who.name });
      }

      case 'faculty_state': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        const sess = await store.getSession(code);
        if (!sess) return res.status(404).json({ error: 'no_such_session' });
        if (!ownsSession(who, sess)) {
          return res.status(403).json({ error: 'not_your_session', message: `That session belongs to ${sess.owner}.` });
        }
        // Sessions created before course routing existed get their pointer here.
        if (!sess.practice && sess.mode === 'team' && sess.courseId && sess.state !== 'closed') {
          await pointCourse(() => store.setCourseTeamSession(sess.courseId, code, true));
        }
        if (!sess.practice && sess.courseId) await pointCourse(() => store.addCourseSession(sess.courseId, code, sess.createdAt));
        const [participants, runs] = await Promise.all([
          store.getParticipants(code),
          store.getRuns(code)
        ]);
        return res.status(200).json({
          session: { ...sess, thresholds: S.sessionThresholds(sess), joinUrl: sess.platformAuth ? accountJoinUrl(sess) : null },
          participants,
          runs: visibleFacultyRuns(sess, runs),
          you: who.name,
          defaultThresholds: S.DEFAULT_THRESHOLDS,
          responsePrompts: { opening: S.publicConfig().viewPrompt,
            reflections: S.publicConfig().reflectionPrompts, followups: S.publicConfig().reflectionFollowups }
        });
      }

      case 'faculty_enrolments': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        const sess = await store.getSession(code);
        if (!sess) return res.status(404).json({ error: 'no_such_session' });
        if (!ownsSession(who, sess)) return res.status(403).json({ error: 'not_your_session' });
        try {
          const roster = await syncCourseRoster(req, b, sess);
          return res.status(200).json({ ...roster, participants: await store.getParticipants(code) });
        }
        catch (error) {
          return res.status(error.status || 503).json({ error: 'course_roster_unavailable',
            message: error.message || 'Course enrolment could not be refreshed.' });
        }
      }

      case 'calibrate': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        const sess = await store.getSession(code);
        if (!sess) return res.status(404).json({ error: 'no_such_session' });
        if (!ownsSession(who, sess)) return res.status(403).json({ error: 'not_your_session' });
        if (sess.state !== 'lobby') {
          return res.status(409).json({ error: 'session_already_started', message: 'Calibration is locked once the session starts.' });
        }
        if (b.thresholds != null && (typeof b.thresholds !== 'object' || Array.isArray(b.thresholds))) {
          return res.status(400).json({ error: 'invalid_thresholds', errors: ['Calibration must be an object.'] });
        }
        const thresholdCheck = S.validateThresholds({ ...S.sessionThresholds(sess), ...(b.thresholds || {}) });
        if (!thresholdCheck.ok) return res.status(400).json(thresholdCheck);
        const next = { ...sess, thresholds: thresholdCheck.thresholds };
        if (!await store.compareAndSetSession(code, sess, next)) continue;
        return res.status(200).json({ session: next });
      }

      case 'group': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        const sess = await store.getSession(code);
        if (!sess) return res.status(404).json({ error: 'no_such_session' });
        if (!ownsSession(who, sess)) return res.status(403).json({ error: 'not_your_session' });
        if (sess.mode !== 'team') return res.status(409).json({ error: 'not_team_mode' });

        if (sess.state === 'closed') return res.status(409).json({ error: 'session_closed' });
        const roster = sess.platformAuth && sess.courseId ? await syncCourseRoster(req, b, sess) : null;
        const allowed = approvedIds(roster);
        const participants = await store.getParticipants(code);
        const previousParticipants = structuredClone(participants);
        const previousCaptains = {};
        for (const p of Object.values(participants)) if (p && p.groupId && p.isCaptain) previousCaptains[p.groupId] = p.id;
        const rawAssign = b.assign && typeof b.assign === 'object' ? b.assign : {};
        for (const [id, label] of Object.entries(rawAssign)) {
          if (!participants[id]) return res.status(404).json({ error: 'no_such_participant', message: 'Refresh students before assigning this person.' });
          if (allowed && !allowed.has(id) && label !== '__unassigned__' && label) {
            return res.status(403).json({ error: 'student_not_approved', message: 'Only currently approved course students can be assigned to teams.' });
          }
        }
        for (const p of Object.values(participants)) {
          if (!p || !Object.prototype.hasOwnProperty.call(rawAssign, p.id)) continue;
          const label = String(rawAssign[p.id] || '').trim().slice(0, 40);
          if (label === '__unassigned__' || !label) {
            p.groupId = null;
            p.teamLabel = '';
            p.isCaptain = false;
          } else if (label.startsWith('team:')) {
            const target = Object.values(participants).find(x => x && x.groupId === label);
            if (!target) return res.status(404).json({ error: 'no_such_team' });
            p.groupId = label;
            p.teamLabel = target.teamLabel || label.slice(5);
          } else if (label === '__solo__') {
            p.groupId = `solo:${p.id}`;
            p.teamLabel = p.name;
          } else {
            const norm = label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
            if (!norm) return res.status(400).json({ error: 'team_name_required' });
            p.groupId = `team:${norm}`;
            p.teamLabel = label;
          }
        }
        const caps = captainMap(participants, { ...previousCaptains, ...(b.captains || {}) });
        for (const p of Object.values(participants)) {
          if (!p) continue;
          p.isCaptain = !!(p.groupId && caps[p.groupId] === p.id);
        }
        if (!await store.compareAndSetRoster(code, previousParticipants, participants, sess)) continue;
        return res.status(200).json({ ok: true, captains: caps });
      }

      case 'rename_team': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        const sess = await store.getSession(code);
        if (!sess) return res.status(404).json({ error: 'no_such_session' });
        if (!ownsSession(who, sess)) return res.status(403).json({ error: 'not_your_session' });
        if (sess.mode !== 'team') return res.status(409).json({ error: 'not_team_mode' });
        if (sess.state === 'closed') return res.status(409).json({ error: 'session_closed' });
        const groupId = String(b.groupId || '').trim();
        const teamLabel = String(b.teamLabel || '').trim().slice(0, 40);
        if (!groupId || !teamLabel) return res.status(400).json({ error: 'team_name_required' });
        const participants = await store.getParticipants(code);
        const previousParticipants = structuredClone(participants);
        const members = Object.values(participants).filter(p => p && p.groupId === groupId);
        if (!members.length) return res.status(404).json({ error: 'no_such_team' });
        for (const p of members) {
          p.teamLabel = teamLabel;
        }
        if (!await store.compareAndSetRoster(code, previousParticipants, participants, sess)) continue;
        return res.status(200).json({ ok: true, groupId, teamLabel });
      }

      // Older clients must not silently change team leadership to take control.
      case 'claim_lead':
        return res.status(409).json({ error: 'runner_assignment_required', message: 'Reload this page. Your team lead can select a simulation runner without changing team leadership.' });

      case 'set_runner': {
        const sess = await store.getSession(code);
        if (!sess) return res.status(404).json({ error: 'no_such_session' });
        if (sess.mode !== 'team') return res.status(409).json({ error: 'not_team_mode' });
        if (sess.state === 'closed') return res.status(409).json({ error: 'session_closed' });
        const participants = await store.getParticipants(code);
        const me = participants[String(b.participantId || '')];
        if (!me) return res.status(403).json({ error: 'not_joined' });
        if (!me.groupId) return res.status(409).json({ error: 'team_not_assigned' });
        if (leadOf(participants, me.groupId)?.id !== me.id) {
          return res.status(403).json({ error: 'team_lead_only', message: 'Agree as a team, then ask your team lead to assign the runner.' });
        }
        const chosen = participants[String(b.runnerId || '')];
        if (!chosen || chosen.groupId !== me.groupId) {
          return res.status(400).json({ error: 'runner_must_be_teammate' });
        }
        const previous = (await store.getRuns(code))[me.groupId] || null;
        if (Number(previous?.phase || 0) >= 3 || previous?.done) {
          return res.status(409).json({ error: 'run_already_completed' });
        }
        const runner = runnerOf(participants, me.groupId, previous);
        if (b.expectedRunnerId !== (runner?.id || null) || b.runnerRevision !== revisionOf(previous)) {
          return res.status(409).json({ error: 'runner_changed', message: 'The runner changed. Review the current selection and try again.' });
        }
        const next = {
          ...(previous || { runId: me.groupId, phase: 0, done: false, createdAt: Date.now() }),
          runnerId: chosen.id,
          runnerRevision: revisionOf(previous) + 1,
          runnerAssignedBy: me.id,
          runnerAssignedAt: Date.now(),
          updatedAt: Date.now()
        };
        if (!await store.compareAndSetRun(code, me.groupId, previous, next, sess, participants)) continue;
        return res.status(200).json({ ok: true, runnerId: chosen.id, runnerRevision: next.runnerRevision });
      }

      case 'set_captain': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        const sess = await store.getSession(code);
        if (!sess) return res.status(404).json({ error: 'no_such_session' });
        if (!ownsSession(who, sess)) return res.status(403).json({ error: 'not_your_session' });
        if (sess.mode !== 'team') return res.status(409).json({ error: 'not_team_mode' });
        if (sess.state === 'closed') return res.status(409).json({ error: 'session_closed' });
        const participants = await store.getParticipants(code);
        const previousParticipants = structuredClone(participants);
        const pid = String(b.participantId || '');
        const chosen = participants[pid];
        if (!chosen || !chosen.groupId) return res.status(404).json({ error: 'no_such_participant' });
        for (const p of Object.values(participants)) {
          if (!p || p.groupId !== chosen.groupId) continue;
          p.isCaptain = p.id === pid;
        }
        if (!await store.compareAndSetRoster(code, previousParticipants, participants, sess)) continue;
        return res.status(200).json({ ok: true, groupId: chosen.groupId, captainId: pid });
      }

      case 'control': {
        const who = whoIsFaculty(req, b);
        if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
        const sess = await store.getSession(code);
        if (!sess) return res.status(404).json({ error: 'no_such_session' });
        if (!ownsSession(who, sess)) return res.status(403).json({ error: 'not_your_session' });

        const previousSession = structuredClone(sess);
        if (b.set === 'start' && sess.state !== 'lobby') {
          return res.status(409).json({ error: 'session_already_started', message: 'This session has already started. Use Resume for a paused session.' });
        }
        if (b.set === 'start') {
          if (sess.mode === 'team') {
            const roster = sess.platformAuth && sess.courseId ? await syncCourseRoster(req, b, sess) : null;
            const allowed = approvedIds(roster);
            const participants = await store.getParticipants(code);
            const inactiveAssigned = Object.values(participants).filter(p => p && p.groupId && allowed && !allowed.has(p.id));
            if (inactiveAssigned.length) return res.status(409).json({ error: 'student_not_approved',
              message: 'Some assigned students no longer have course access. Unassign them or restore approval before starting.' });
            const all = Object.values(participants).filter(p => p && (!allowed || allowed.has(p.id)));
            if (!all.length) {
              return res.status(409).json({ error: 'participants_required', message: 'Approve at least one course student and assign a team before starting. Standalone students join using the session link.' });
            }
            const unassigned = all.filter(p => !p.groupId);
            if (unassigned.length) {
              return res.status(409).json({
                error: 'unassigned_participants',
                count: unassigned.length,
                participantIds: unassigned.map(p => p.id),
                message: `${unassigned.length} student${unassigned.length === 1 ? ' is' : 's are'} still unassigned. Assign every student to a team before starting.`
              });
            }
            const groups = {};
            for (const p of all) (groups[p.groupId] ||= []).push(p);
            const missingLead = Object.entries(groups).filter(([, members]) => !members.some(p => p.isCaptain)).map(([gid]) => gid);
            if (missingLead.length) {
              return res.status(409).json({ error: 'team_lead_required', groupIds: missingLead, message: 'Every team must have one team lead before the session starts.' });
            }
          }
          sess.state = 'running';
          sess.startedAt = Date.now();
        }
        if (b.set === 'pause') sess.paused = true;
        if (b.set === 'resume') sess.paused = false;
        // Reopen a class closed by mistake: teams continue from their saved decisions.
        if (b.set === 'reopen') {
          if (sess.state !== 'closed') return res.status(409).json({ error: 'session_not_closed' });
          if (!sess.practice && sess.courseId) {
            const open = await otherOpenSessions(sess.courseId, code);
            if (open.length && !b.closeOpen) return otherOpenReply(res, open, 'Reopening this session');
            if (open.length) await closeSessions(open, who, 'reopen-other', req, b);
          }
          sess.state = sess.startedAt ? 'running' : 'lobby';
          sess.paused = false;
          sess.reopenedAt = Date.now();
        }
        if (b.set === 'close') { sess.state = 'closed'; sess.closedAt = Date.now(); sess.closedBy = who.name || null; sess.closedFrom = String(b.from || '').slice(0, 20) || null; }
        if (!await store.compareAndSetSession(code, previousSession, sess)) continue;
        if (sess.state === 'closed' && sess.courseId) await pointCourse(() => store.clearCourseTeamSession(sess.courseId, code));
        if (b.set === 'reopen' && !sess.practice && sess.mode === 'team' && sess.courseId) {
          await pointCourse(() => store.setCourseTeamSession(sess.courseId, code));
        }
        // The class page lists this session's students again while it is open; they move into Results when it closes.
        if (b.set === 'close' || b.set === 'reopen') await enrolmentsLib.moveSessionRoster(req, b, sess, b.set === 'close' ? 'archive' : 'restore', await store.getParticipants(code).catch(() => ({})));
        return res.status(200).json({ session: sess });
      }

      case 'join': {
        const sess = await store.getSession(code);
        if (!sess) return res.status(404).json({ error: 'no_such_session' });
        if (sess.state === 'closed') return res.status(410).json({ error: 'session_closed' });

        const launched = participantLaunch(req, b);
        if ((req.headers['x-launch-token'] || b.launchToken) && !launched) {
          return res.status(401).json({ error: 'launch_token_invalid' });
        }
        if (launched && sess.courseId && launched.course !== sess.courseId) {
          return res.status(403).json({ error: 'session_course_mismatch' });
        }
        // Practice students join only their own faculty member's practice session,
        // and a practice session admits only those practice students.
        if (launched && (isPracticeSub(launched.sub) || sess.practice) &&
            !(sess.practice && String(launched.sub).startsWith(`practice-${sess.ownerId}-`))) {
          return res.status(403).json({ error: 'practice_only' });
        }
        const name = String(launched ? launched.name || '' : b.name || '').slice(0, 60).trim();
        if (!name) return res.status(400).json({ error: 'name_required' });
        const all = await store.getParticipants(code);
        const key = x => String(x || '').trim().toLowerCase();
        let id = launched ? `platform:${launched.sub}` : String(b.participantId || '').trim();
        if (!launched && (!id || !all[id])) {
          const match = Object.values(all).find(p => p && !p.id.startsWith('platform:') && key(p.name) === key(name));
          id = match ? match.id : (id || newId());
        }
        if (!launched && id.startsWith('platform:')) {
          return res.status(401).json({ error: 'platform_signin_required' });
        }
        const existing = all[id];

        let groupId = existing ? existing.groupId : null;
        let teamLabel = existing ? (existing.teamLabel || '') : '';
        if (sess.mode === 'individual') {
          groupId = `individual:${id}`;
          teamLabel = name;
        } else if (!existing) {
          // Team sessions are instructor-managed. New students always enter the
          // unassigned pool; the faculty console creates teams and chooses leads.
          groupId = null;
          teamLabel = '';
        }

        const participant = {
          ...existing,
          launchId: launched?.run || existing?.launchId || null,
          id,
          name,
          groupId,
          teamLabel,
          isCaptain: existing ? !!existing.isCaptain : sess.mode === 'individual',
          joinedAt: existing?.joinedAt || Date.now()
        };
        if (!await store.compareAndSetParticipant(code, id, existing, participant, sess)) continue;
        return res.status(200).json({ participantId: id, session: publicSession(sess), me: participant });
      }

      case 'state': {
        const sess = await store.getSession(code);
        if (!sess) return res.status(404).json({ error: 'no_such_session' });
        const pid = String(b.participantId || '');
        const participants = await store.getParticipants(code);
        const me = participants[pid] || null;
        if (!me) return res.status(403).json({ error: 'not_joined' });

        const runs = await store.getRuns(code);
        const rid = runIdFor(sess, me);
        const rawRun = rid ? runs[rid] : null;
        const runner = runnerOf(participants, me.groupId, rawRun);
        const canSubmit = sess.mode === 'individual' || runner?.id === me.id;
        const mates = Object.values(participants).filter(p => p && me.groupId && p.groupId === me.groupId)
          .map(p => ({ id: p.id, name: p.name, isCaptain: !!p.isCaptain, isRunner: p.id === runner?.id }));
        const run = publicRun(rawRun);
        if (run && sess.mode === 'team') {
          const runnerReflection = rawRun.reflections?.[runner?.id] || {};
          run.reflection1 = rawRun.reflection1 || runnerReflection.reflection1 || '';
          run.reflection2 = rawRun.reflection2 || runnerReflection.reflection2 || '';
          run.done = !!rawRun.done || Number(rawRun.phase || 0) >= 3;
        }
        const own = rawRun?.reflections?.[pid];
        // A finished run's final page always carries the lesson, including after a reload.
        let closingLesson = null;
        const finished = rawRun && (rawRun.done || (sess.mode === 'team' && Number(rawRun.phase || 0) >= 3));
        if (finished && rawRun.year1 && rawRun.year2) {
          try {
            const thresholds = S.sessionThresholds(sess);
            closingLesson = buildClosingLesson(rawRun.year1, rawRun.year2,
              rawRun.outcomes && rawRun.outcomes.year3 ? rawRun.outcomes : S.evaluateAll(rawRun.year1, rawRun.year2, thresholds), thresholds);
          } catch (e) { console.error('closing lesson unavailable', e.message); }
        }
        return res.status(200).json({
          closingLesson,
          myReview: own ? { reflection1: own.reflection1 || '', reflection2: own.reflection2 || '', at: own.at || null } : null,
          session: publicSession(sess),
          me: { ...me, isRunner: canSubmit },
          mates,
          canSubmit,
          canAssignRunner: sess.mode === 'team' && leadOf(participants, me.groupId)?.id === me.id && sess.state !== 'closed' && Number(rawRun?.phase || 0) < 3,
          runnerId: sess.mode === 'team' ? runner?.id || null : me.id,
          runnerRevision: revisionOf(rawRun),
          run
        });
      }

      case 'submit': {
        const sess = await store.getSession(code);
        if (!sess) return res.status(404).json({ error: 'no_such_session' });
        if (sess.state !== 'running') return res.status(409).json({ error: 'session_not_running' });
        if (sess.paused) return res.status(409).json({ error: 'session_paused' });

        const pid = String(b.participantId || '');
        const participants = await store.getParticipants(code);
        const me = participants[pid];
        if (!me) return res.status(403).json({ error: 'not_joined' });
        if (sess.mode === 'team' && !me.groupId) return res.status(409).json({ error: 'team_not_assigned' });
        const wantsSharedDecision = ['strategicView', 'year1', 'year2', 'screen', 'year2Event'].some(k => b[k] !== undefined);
        const rid = runIdFor(sess, me);
        const runs = await store.getRuns(code);
        const previous = runs[rid] || null;
        const current = previous || { runId: rid, phase: 0, done: false, createdAt: Date.now() };
        const isRunner = sess.mode === 'individual' || runnerOf(participants, me.groupId, current)?.id === pid;
        if (sess.mode === 'team' && (wantsSharedDecision || b.done) && !isRunner) {
          return res.status(403).json({ error: 'runner_only', message: 'Only the selected simulation runner can submit or advance the shared run.' });
        }
        if (sess.mode === 'team' && (wantsSharedDecision || (b.done && Number(current.phase || 0) < 3)) &&
            b.runnerRevision !== revisionOf(current)) {
          return res.status(409).json({ error: 'runner_changed', message: 'Runner control changed. Refresh before continuing.' });
        }
        if ((current.done || (sess.mode === 'team' && Number(current.phase || 0) >= 3)) && wantsSharedDecision ||
            (current.done && sess.mode === 'individual')) {
          return res.status(409).json({ error: 'run_already_completed' });
        }

        const next = { ...current };
        if (sess.mode === 'team') {
          next.runnerId = runnerOf(participants, me.groupId, current)?.id || null;
          next.runnerRevision = revisionOf(current);
        }
        if (b.strategicView !== undefined) {
          const proposed = String(b.strategicView || '').slice(0, 500);
          if (current.strategicView && current.strategicView !== proposed) {
            return res.status(409).json({ error: 'strategic_view_locked' });
          }
          next.strategicView = current.strategicView || proposed;
          if (!current.strategicView) next.screen = 4;
        }
        if (b.year1 !== undefined) {
          const v = S.validateAllocation(b.year1, S.sessionThresholds(sess));
          if (!v.ok) return res.status(400).json(v);
          if (current.year1 && !sameAllocation(current.year1, v.allocation)) {
            return res.status(409).json({ error: 'year1_locked' });
          }
          next.year1 = current.year1 || v.allocation;
          if (!current.year1) next.screen = 5;
          next.phase = Math.max(next.phase || 0, 1);
        }
        if (b.year2 !== undefined) {
          if (!next.year1) return res.status(409).json({ error: 'year1_required' });
          const v = S.validateAllocation(b.year2, S.sessionThresholds(sess));
          if (!v.ok) return res.status(400).json(v);
          if (current.year2 && !sameAllocation(current.year2, v.allocation)) {
            return res.status(409).json({ error: 'year2_locked' });
          }
          next.year2 = current.year2 || v.allocation;
          if (!current.year2) next.screen = 7;
          next.phase = Math.max(next.phase || 0, 2);
        }
        if (b.reflection1 !== undefined || b.reflection2 !== undefined) {
          const map = { ...(current.reflections || {}) };
          const mine = map[pid] || {};
          map[pid] = {
            participantId: pid,
            name: me.name,
            reflection1: b.reflection1 !== undefined ? String(b.reflection1 || '').slice(0, 1500) : (mine.reflection1 || ''),
            reflection2: b.reflection2 !== undefined ? String(b.reflection2 || '').slice(0, 1500) : (mine.reflection2 || ''),
            at: Date.now()
          };
          next.reflections = map;
          if (isRunner) {
            next.reflection1 = map[pid].reflection1;
            next.reflection2 = map[pid].reflection2;
          }
        }

        if (b.screen !== undefined) {
          if (!Number.isInteger(b.screen) || b.screen < 0 || b.screen > 10) return res.status(400).json({ error: 'invalid_screen' });
          if (b.screen >= 5 && !next.year1) return res.status(409).json({ error: 'year1_required' });
          if (b.screen >= 7 && !next.year2) return res.status(409).json({ error: 'year2_required' });
          next.screen = b.screen;
        }
        if (b.year2Event !== undefined) {
          if (![0, 1].includes(b.year2Event)) return res.status(400).json({ error: 'invalid_year2_event' });
          if (!next.year2) return res.status(409).json({ error: 'year2_required' });
          next.year2Event = b.year2Event;
        }
        if (next.year1 && next.year2) {
          next.outcomes = S.evaluateAll(next.year1, next.year2, S.sessionThresholds(sess));
        } else if (next.year1) {
          next.outcomes = { year1: S.evaluateYear1(next.year1, S.sessionThresholds(sess)) };
        }
        if (b.done) {
          if (!next.year1 || !next.year2) return res.status(409).json({ error: 'allocations_incomplete' });
          if (sess.mode === 'team') {
            if (!isRunner) return res.status(403).json({ error: 'runner_only', message: 'Only the selected simulation runner can complete the shared team run.' });
            const finishedAt = Date.now();
            const members = Object.values(participants).filter(p => p && p.groupId === rid);
            next.finishedBy = { ...(current.finishedBy || {}) };
            for (const m of members) next.finishedBy[m.id] = finishedAt;
            next.done = true;
            next.completedBy = pid;
            next.completedByName = me.name;
          } else {
            next.done = true;
          }
          next.phase = 3;
          next.screen = 10;
          if (next.done) next.completedAt = Date.now();
        }
        next.updatedAt = Date.now();
        if (sess.mode === 'team') {
          if (!await store.compareAndSetRun(code, rid, previous, next, sess, participants)) continue;
        } else {
          await store.setRun(code, rid, next);
        }
        return res.status(200).json({ ok: true, run: publicRun(next) });
      }

      default:
        return res.status(400).json({ error: 'unknown_action' });
    }
    }
    return res.status(409).json({ error: 'run_changed', message: 'The team state changed. Refresh and try again.' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: 'course_roster_unavailable', message: e.message });
    if (e.code === 'NO_STORE') return res.status(503).json({ error: 'no_store', message: e.message });
    console.error('session failure', action, e.message);
    return res.status(500).json({ error: 'server_error' });
  }
};

