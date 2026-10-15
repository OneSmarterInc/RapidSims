'use strict';
const { body, announceOnce, checkAccess } = require('../lib/guard.js');
const { randomBytes } = require('node:crypto');
const store = require('../lib/store.js');
const { verifyLaunch, reportCompletion } = require('../lib/launch.js');
const { META } = require('../lib/meta.js');
const cfg = require('../data/config.js');
const E = require('../lib/engine.js');
const { accountJoinUrl, participantLaunch, participantError } = require('../lib/session-entry.js');
const KIT = require('../lib/kit.js');
const { courseEnrolments, moveSessionRoster } = require('../lib/course-enrolments.js');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const newId = () => randomBytes(16).toString('hex');
const now = () => (typeof module.exports._now === 'function' ? module.exports._now() : Date.now());

function facultyRoster() {
  const out = [];
  String(process.env.FACULTY_CODES || '').split(',').map(s => s.trim()).filter(Boolean).forEach(entry => {
    const i = entry.lastIndexOf(':');
    if (i > 0) out.push({ name: entry.slice(0, i).trim(), code: entry.slice(i + 1).trim() });
  });
  if (process.env.FACULTY_CODE) out.push({ name: 'Facilitator', code: process.env.FACULTY_CODE });
  return out;
}

// Signed faculty launch first; otherwise an explicitly configured facilitator code. Fails closed.
function whoIsFaculty(req, b) {
  const lt = req.headers['x-launch-token'] || b.launchToken;
  if (lt) {
    const p = verifyLaunch(String(lt));
    if (p && p.sim === META.id && (p.role === 'faculty' || p.role === 'faculty_preview')) {
      return { name: p.name || 'Facilitator', userId: p.sub || null, platformAuth: true, courseId: p.course || null };
    }
  }
  const roster = facultyRoster();
  const given = String(b.facultyCode || req.headers['x-faculty-code'] || '').trim();
  if (!roster.length || !given) return null;
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

const teamKey = label => 'team:' + String(label || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Engine state for a run. Everyone in a session shares the instructor's start time,
// so the whole room sees the same report at the same moment.
function engineState(sess, run) {
  return {
    participantId: run.runId,
    begunAt: sess.startedAt || null,
    docsOpened: run.docsOpened,
    decision: run.decision || null,
  };
}

function newRun(runId, label) {
  const p = E.createParticipant({ participantId: runId });
  return { runId, label, docsOpened: p.docsOpened, decision: null };
}

function phaseOf(sess, t) {
  if (!sess.startedAt) return 'lobby';
  return t - sess.startedAt >= E.PLAY_MS ? 'ended' : 'playing';
}

function publicSession(sess, t) {
  return { code: sess.code, mode: sess.mode, state: sess.state, phase: phaseOf(sess, t),
    solo: !!sess.solo, startedAt: sess.startedAt || null, serverNow: t, playMs: E.PLAY_MS };
}

async function ensureRun(code, runId, label) {
  const existing = await store.getRun(code, runId);
  if (existing) return existing;
  const run = newRun(runId, label);
  if (await store.compareAndSetRun(code, runId, null, run)) return run;
  return store.getRun(code, runId);
}

// Per-poll reads touch only this participant and their run, so cost does not grow with the room.
async function loadMe(code, pid) {
  if (!pid) return null;
  const me = await store.getParticipant(code, pid);
  if (!me) return null;
  return { me, run: await store.getRun(code, me.runId) };
}

async function pointCourse(fn) { try { await fn(); } catch (e) { console.error('course session pointer update failed', e.code || e.message); } }
const isPracticeSub = sub => String(sub || '').startsWith('practice-');
// Report each finished student: revision 1 at the reveal or close, revision 2 with their review.
async function reportPeople(sess, participants, runs, ids, revision) {
  if (sess.practice || !sess.platformAuth) return { sent: 0 };
  let sent = 0;
  for (const id of ids) {
    const me = participants[id];
    if (!me || !me.joinedAt || !id.startsWith('platform:') || !me.launchId || !me.runId || isPracticeSub(id.slice(9))) continue;
    const c = KIT.completion(sess, me, runs[me.runId], revision);
    if (!c) continue;
    const r = await reportCompletion({ launch: { sub: id.slice(9), sim: META.id, course: sess.courseId, run: me.launchId }, ...c }).catch(() => ({ ok: false }));
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
async function closeSessions(list, req, b, t) {
  for (const s2 of list) {
    const next = { ...s2, state: 'closed', closedAt: t, closedFrom: 'new-session' };
    await store.putSession(s2.code, next);
    if (next.courseId) await pointCourse(() => store.clearCourseSession(next.courseId, s2.code));
    const [participants, runs] = await Promise.all([store.getParticipants(s2.code), store.getRuns(s2.code)]);
    await reportPeople(next, participants, runs, Object.keys(participants), 1);
    await moveSessionRoster(req, b, next, 'archive', participants);
  }
}
function otherOpenReply(res, list, verb) {
  return res.status(409).json({ error: 'other_session_open', open: list.map(x => ({ code: x.code, name: x.name || META.title })),
    message: `${verb} closes the open session "${list[0].name || META.title}". Students who finished keep their results.` });
}
// The reveal adds the four questions and, for a signed-in student, the review.
function extras(sess, me) {
  return { afterReveal: KIT.LESSON_QUESTIONS,
    review: { open: !!sess.platformAuth && String(me.id || '').startsWith('platform:'), questions: KIT.REVIEW_QUESTIONS, sent: !!me.review } };
}

function summaryOf(run) {
  const d = run.decision;
  if (!d) return 'No decision before the clock ran out';
  return d.choice === 'switch' ? `Switched to ClearPath at report ${d.atReport}` : `Committed to Northline at report ${d.atReport}`;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  if (!store.configured()) return res.status(503).json({ error: 'no_store', message: 'Session storage is not configured for this deployment.' });
  announceOnce(req);

  const b = body(req);
  const action = String(b.action || '');
  const code = String(b.code || '').toUpperCase().trim();

  try {
    if (['join', 'state', 'open_doc', 'decide', 'reveal', 'start_solo', 'review'].includes(action)) {
      const sess = await store.getSession(code);
      if (sess) {
        const err = participantError(req, b, sess, action === 'join' ? null : String(b.participantId || ''));
        if (err) return res.status(err.status).json({ error: err.error });
      }
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const t = now();
      switch (action) {
        // Lets the join screen ask for a team name up front. Reveals nothing beyond the mode.
        case 'peek': {
          if (!/^[A-Z2-9]{5}$/.test(code)) return res.status(400).json({ error: 'invalid_session_code' });
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          if (sess.solo) return res.status(403).json({ error: 'private_session' });
          return res.status(200).json({ mode: sess.mode, phase: phaseOf(sess, t), closed: sess.state === 'closed' });
        }

        case 'solo': {
          if (!checkAccess(req, res)) return;
          const launched = req.launch || null;
          if (launched && (!participantLaunch(req, b) || launched.mode === 'session')) {
            return res.status(403).json({ error: 'use_session' });
          }
          const name = String(launched ? launched.name || 'Participant' : b.name || '').trim().slice(0, 60);
          if (!name) return res.status(400).json({ error: 'name_required' });
          const c = newCode(), id = launched ? `platform:${launched.sub}` : newId();
          const runId = `individual:${id}`;
          const sess = { code: c, solo: true, owner: id, ownerId: launched?.sub || null,
            platformAuth: !!launched, courseId: launched?.course || null,
            mode: 'individual', state: 'open', startedAt: null, createdAt: t };
          await store.putSession(c, sess);
          const me = { id, name, runId, teamLabel: name, joinedAt: t };
          if (!await store.compareAndSetParticipant(c, id, null, me)) throw new Error('solo participant write failed');
          await ensureRun(c, runId, name);
          return res.status(200).json({ participantId: id, session: publicSession(sess, t) });
        }

        case 'start_solo': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          if (!sess.solo || sess.owner !== String(b.participantId || '')) {
            return res.status(403).json({ error: 'not_your_session' });
          }
          if (sess.state === 'closed') return res.status(410).json({ error: 'session_closed' });
          if (sess.startedAt) return res.status(200).json({ session: publicSession(sess, t) });
          const next = { ...sess, startedAt: t };
          if (!await store.compareAndSetSession(code, sess, next)) continue;
          return res.status(200).json({ session: publicSession(next, t) });
        }

        case 'create': {
          const who = whoIsFaculty(req, b);
          if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
          const mode = String(b.mode || '');
          if (!cfg.modes.includes(mode)) return res.status(400).json({ error: 'play_mode_required' });
          if (who.platformAuth && who.courseId) {
            const open = await otherOpen(who.courseId, null);
            if (open.length && !b.closeOpen) return otherOpenReply(res, open, 'Starting a new session');
            if (open.length) await closeSessions(open, req, b, t);
          }
          const c = newCode();
          const sess = { code: c, owner: who.name, ownerId: who.userId || null, platformAuth: !!who.platformAuth,
            courseId: who.courseId || null, mode, state: 'open', startedAt: null, createdAt: t,
            name: String(b.name || META.title).slice(0, 80) };
          await store.putSession(c, sess);
          if (sess.platformAuth && sess.courseId) {
            await pointCourse(() => store.addCourseSession(sess.courseId, c, t));
            await pointCourse(() => store.setCourseSession(sess.courseId, c));
          }
          return res.status(200).json({ session: { ...sess, state: 'lobby', joinUrl: sess.platformAuth ? accountJoinUrl(sess) : null } });
        }

        case 'faculty_state': {
          const who = whoIsFaculty(req, b);
          if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          if (!ownsSession(who, sess)) return res.status(403).json({ error: 'not_your_session' });
          const [participants, runs] = await Promise.all([store.getParticipants(code), store.getRuns(code)]);
          // Only runs with a student in them count; a class-list student who never opened the sim is not a "no decision".
          const live = Object.values(runs).filter(r => r && Object.values(participants).some(p => p && p.runId === r.runId && p.joinedAt));
          const states = live.map(r => engineState(sess, r));
          const k = KIT.facultyKit(sess, participants, runs, t);
          // The shared pages read state as lobby, running or closed; the Live screen reads phase.
          const kitState = sess.state === 'closed' ? 'closed' : sess.startedAt ? 'running' : 'lobby';
          return res.status(200).json({
            session: { ...publicSession(sess, t), state: kitState, name: sess.name || META.title, createdAt: sess.createdAt || null,
              platformAuth: !!sess.platformAuth, courseId: sess.courseId || null, practice: !!sess.practice, ended: k.kit.ended,
              joinUrl: sess.platformAuth ? accountJoinUrl(sess) : null },
            participants: k.participants, runs: k.runs, kit: k.kit,
            joined: Object.values(participants).filter(p => p && p.joinedAt).length,
            teams: sess.mode === 'team' ? live.length : null,
            projector: sess.startedAt ? E.projector(states, t) : null,
            debrief: phaseOf(sess, t) === 'ended' ? cfg.debrief : null,
          });
        }

        case 'control': {
          const who = whoIsFaculty(req, b);
          if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          if (!ownsSession(who, sess)) return res.status(403).json({ error: 'not_your_session' });
          const next = { ...sess };
          if (b.set === 'start') {
            if (sess.startedAt) return res.status(409).json({ error: 'session_already_started' });
            if (sess.state === 'closed') return res.status(409).json({ error: 'session_closed' });
            next.startedAt = t;
          } else if (b.set === 'close') {
            next.state = 'closed'; next.closedAt = t;
          } else if (b.set === 'reopen') {
            if (sess.state !== 'closed') return res.status(409).json({ error: 'session_not_closed' });
            if (!sess.practice && sess.courseId) {
              const open = await otherOpen(sess.courseId, code);
              if (open.length && !b.closeOpen) return otherOpenReply(res, open, 'Reopening this session');
              if (open.length) await closeSessions(open, req, b, t);
            }
            next.state = 'open'; next.closedAt = null; next.reopenedAt = t;
          } else return res.status(400).json({ error: 'unknown_control' });
          if (!await store.compareAndSetSession(code, sess, next)) continue;
          if (next.courseId && !next.practice) {
            if (b.set === 'close') await pointCourse(() => store.clearCourseSession(next.courseId, code));
            if (b.set === 'reopen') await pointCourse(() => store.setCourseSession(next.courseId, code));
          }
          if (b.set === 'close' || b.set === 'reopen') {
            const [participants, runs] = await Promise.all([store.getParticipants(code), store.getRuns(code)]);
            if (b.set === 'close') await reportPeople(next, participants, runs, Object.keys(participants), 1);
            await moveSessionRoster(req, b, next, b.set === 'close' ? 'archive' : 'restore', participants);
          }
          return res.status(200).json({ session: { ...publicSession(next, t), state: next.state === 'closed' ? 'closed' : next.startedAt ? 'running' : 'lobby' } });
        }

        case 'join': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          const launched = participantLaunch(req, b);
          // A Rehearse practice run takes its own practice student only; other private runs take nobody.
          if (sess.solo && !(sess.practice && launched && sess.owner === `platform:${launched.sub}`)) return res.status(403).json({ error: 'private_session' });
          if (!sess.practice && launched && isPracticeSub(launched.sub)) return res.status(403).json({ error: 'practice_only' });
          if ((req.headers['x-launch-token'] || b.launchToken) && !launched) return res.status(401).json({ error: 'launch_token_invalid' });
          const name = String(launched ? launched.name || '' : b.name || '').slice(0, 60).trim();
          if (!name) return res.status(400).json({ error: 'name_required' });
          const all = await store.getParticipants(code);
          const id = launched ? `platform:${launched.sub}` : (all[String(b.participantId || '')] ? String(b.participantId) : newId());
          const existing = all[id] || null;
          // Returning students (a page reload) always get back in. New joiners are refused once the
          // session is closed or the clock has ended, so a late arrival cannot land in the projector
          // as a "no decision" they never had the chance to make.
          if (!existing?.joinedAt && sess.state === 'closed') return res.status(410).json({ error: 'session_closed' });
          if (!existing?.joinedAt && phaseOf(sess, t) === 'ended') return res.status(410).json({ error: 'session_ended' });
          let runId, label;
          // A student from the class list may already be on a team the instructor formed.
          if (existing && existing.runId) { runId = existing.runId; label = existing.teamLabel; }
          else if (sess.mode === 'individual') { runId = `individual:${id}`; label = name; }
          else {
            label = String(b.teamName || '').trim().slice(0, 40);
            if (!label) return res.status(400).json({ error: 'team_name_required' });
            runId = teamKey(label);
          }
          const me = { ...existing, id, name, runId, teamLabel: label, joinedAt: existing?.joinedAt || t, ...(launched ? { launchId: launched.run } : {}) };
          if (!await store.compareAndSetParticipant(code, id, existing, me)) continue;
          await ensureRun(code, runId, label);
          return res.status(200).json({ participantId: id, session: publicSession(sess, t), me });
        }

        case 'state': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          const loaded = await loadMe(code, String(b.participantId || ''));
          if (!loaded || !loaded.run) return res.status(403).json({ error: 'not_joined' });
          const { me, run } = loaded;
          const view = E.studentView(engineState(sess, run), t);
          if (run.decision && sess.mode === 'team') view.decision.by = run.decision.by || null;
          const mates = sess.mode === 'team'
            ? Object.values(await store.getParticipants(code)).filter(p => p && p.runId === me.runId).length : 1;
          return res.status(200).json({ session: publicSession(sess, t), me: { id: me.id, name: me.name, team: sess.mode === 'team' ? me.teamLabel : null, mates }, view });
        }

        case 'open_doc': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          const loaded = await loadMe(code, String(b.participantId || ''));
          if (!loaded || !loaded.run) return res.status(403).json({ error: 'not_joined' });
          const { run } = loaded;
          let st;
          try { st = E.openDoc(engineState(sess, run), String(b.docId || ''), t); }
          catch (e) { return res.status(400).json({ error: 'unknown_document' }); }
          if (st.docsOpened === run.docsOpened) return res.status(200).json({ ok: true });
          if (!await store.compareAndSetRun(code, run.runId, run, { ...run, docsOpened: st.docsOpened })) continue;
          return res.status(200).json({ ok: true });
        }

        case 'decide': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          const loaded = await loadMe(code, String(b.participantId || ''));
          if (!loaded || !loaded.run) return res.status(403).json({ error: 'not_joined' });
          const { me, run } = loaded;
          if (run.decision) return res.status(409).json({ error: 'decision_already_made', decision: { choice: run.decision.choice, atReport: run.decision.atReport, by: run.decision.by || null } });
          let st;
          try { st = E.decide(engineState(sess, run), { choice: b.choice, reason: b.reason, now: t }); }
          catch (e) { return res.status(400).json({ error: 'invalid_decision', message: e.message }); }
          const decision = { ...st.decision, by: sess.mode === 'team' ? me.name : null };
          // First press wins: the write only lands if the run is exactly as read, with no decision.
          if (!await store.compareAndSetRun(code, run.runId, run, { ...run, decision })) continue;
          return res.status(200).json({ decision: { choice: decision.choice, atReport: decision.atReport, by: decision.by } });
        }

        case 'reveal': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          const loaded = await loadMe(code, String(b.participantId || ''));
          if (!loaded || !loaded.run) return res.status(403).json({ error: 'not_joined' });
          const { me, run } = loaded;
          if (phaseOf(sess, t) !== 'ended') return res.status(409).json({ error: 'not_ended' });
          const out = E.reveal(engineState(sess, run), t);
          if (sess.mode === 'team' && run.decision?.by) out.decisionLine += ` (${run.decision.by} pressed for the team.)`;
          const launched = sess.platformAuth ? participantLaunch(req, b) : null;
          let reported = !!me.reportedAt;
          if (!launched) {
            if (!me.completedAt) await store.compareAndSetParticipant(code, me.id, me, { ...me, completedAt: t });
          } else if (!reported && (!me.reportingAt || t - me.reportingAt > 30000)) {
            const next = { ...me, completedAt: me.completedAt || t, reportingAt: t };
            if (!await store.compareAndSetParticipant(code, me.id, me, next)) continue;
            // The same report the session sends at close: revision 1, with the session, team and band.
            const c = sess.practice ? null : KIT.completion(sess, next, run, 1);
            const result = c ? await reportCompletion({ launch: launched, ...c }) : { ok: !!sess.practice };
            const saved = { ...next, reportingAt: null, ...(result.ok ? { reportedAt: t } : {}) };
            reported = result.ok && await store.compareAndSetParticipant(code, me.id, next, saved);
            if (!result.ok) await store.compareAndSetParticipant(code, me.id, next, saved);
          }
          return res.status(200).json({ reveal: { ...out, ...extras(sess, me) }, completionReported: reported, completionRequired: !!launched && !sess.practice });
        }

        // ---------- the shared faculty pages ----------
        case 'faculty_enrolments': {
          const who = whoIsFaculty(req, b);
          if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          if (!ownsSession(who, sess)) return res.status(403).json({ error: 'not_your_session' });
          if (sess.practice) {
            const people = Object.values(await store.getParticipants(code)).filter(Boolean);
            return res.status(200).json({ available: true, practice: true, students: people.map(p => ({ participantId: p.id, name: p.name, accessReleased: true })) });
          }
          let roster;
          try { roster = await courseEnrolments(req, b, sess); }
          catch (e) { return res.status(e.status || 503).json({ error: 'enrolments_unavailable', message: e.message }); }
          if (roster.available && sess.state !== 'closed') {
            const existing = await store.getParticipants(code);
            for (const st of roster.students) {
              const id = String(st.participantId || '');
              if (st.accessReleased !== true || !/^platform:[A-Za-z0-9_-]+$/.test(id) || existing[id]) continue;
              const name = String(st.name || '').trim().slice(0, 60) || 'Student';
              // Individual play: each student already has their own run. Team play: the Teams tab places them.
              const me = sess.mode === 'individual' ? { id, name, runId: `individual:${id}`, teamLabel: name, joinedAt: null, source: 'course' }
                : { id, name, runId: null, teamLabel: null, joinedAt: null, source: 'course' };
              if (await store.compareAndSetParticipant(code, id, null, me) && me.runId) await ensureRun(code, me.runId, name);
            }
          }
          return res.status(200).json(roster);
        }

        // The Teams tab: assign each student to a team by name or by team id; '__unassigned__' takes them off.
        case 'group': {
          const who = whoIsFaculty(req, b);
          if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          if (!ownsSession(who, sess)) return res.status(403).json({ error: 'not_your_session' });
          if (sess.mode !== 'team') return res.status(409).json({ error: 'not_team_mode' });
          if (sess.startedAt) return res.status(409).json({ error: 'teams_locked', message: 'Teams are fixed once the clock starts.' });
          const runs = await store.getRuns(code);
          for (const [id, value] of Object.entries(b.assign || {})) {
            const p = await store.getParticipant(code, id);
            if (!p) return res.status(404).json({ error: 'no_such_participant' });
            const v = String(value || '').trim().slice(0, 40);
            let runId = null, label = null;
            if (v && v !== '__unassigned__') {
              if (runs[v]) { runId = v; label = runs[v].label; } else { label = v; runId = teamKey(v); }
              const run = await ensureRun(code, runId, label);
              runs[runId] = run;
            }
            if (!await store.compareAndSetParticipant(code, id, p, { ...p, runId, teamLabel: label })) return res.status(409).json({ error: 'busy_retry' });
          }
          return res.status(200).json({ ok: true });
        }

        case 'rename_team': {
          const who = whoIsFaculty(req, b);
          if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
          const sess = await store.getSession(code);
          if (!sess || !ownsSession(who, sess)) return res.status(403).json({ error: 'not_your_session' });
          const run = await store.getRun(code, String(b.groupId || ''));
          const label = String(b.teamLabel || '').trim().slice(0, 40);
          if (!run || !label) return res.status(400).json({ error: 'team_name_required' });
          if (!await store.compareAndSetRun(code, run.runId, run, { ...run, label })) continue;
          return res.status(200).json({ ok: true });
        }

        // The first member to press decides for the team, so there is no team lead to choose.
        case 'set_captain': {
          const who = whoIsFaculty(req, b);
          if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
          return res.status(200).json({ ok: true });
        }

        case 'hide_session': {
          const who = whoIsFaculty(req, b);
          if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
          const sess = await store.getSession(code);
          if (!sess || !ownsSession(who, sess)) return res.status(403).json({ error: 'not_your_session' });
          if (sess.state !== 'closed') return res.status(409).json({ error: 'session_open', message: 'Close the session first. Then you can hide it.' });
          if (!await store.compareAndSetSession(code, sess, { ...sess, hidden: true, hiddenAt: t })) continue;
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
            const [participants, runs] = await Promise.all([store.getParticipants(c), store.getRuns(c)]);
            const k = KIT.facultyKit(s2, participants, runs, t);
            const list = Object.values(k.runs);
            sessions.push({ code: c, name: s2.name || META.title, mode: s2.mode, state: s2.state === 'closed' ? 'closed' : s2.startedAt ? 'running' : 'lobby',
              paused: false, createdAt: s2.createdAt || null, students: Object.values(participants).filter(p => p && p.joinedAt).length,
              teams: s2.mode === 'team' ? list.length : 0, submitted: list.filter(r => r.done).length });
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
          const progressOf = async c => {
            const [s2, participants, runs] = await Promise.all([store.getSession(c), store.getParticipants(c), store.getRuns(c)]);
            const students = Object.values(participants).filter(Boolean).map(p => {
              const run = runs[p.runId], over = s2 && s2.startedAt && t - s2.startedAt >= E.PLAY_MS;
              return { name: p.name, finished: !!over, status: p.review ? 'Sent the review' : over ? 'Saw the reveal' : run?.decision ? 'Decided' : s2?.startedAt ? 'Reading the reports' : p.joinedAt ? 'Reading the briefing' : 'Ready to start' };
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
          const c = newCode(), id = `platform:${x.sub}`, runId = `individual:${id}`, name = x.name.trim().slice(0, 60);
          // A private run like a direct launch: the practice student starts their own ten minutes.
          await store.putSession(c, { code: c, solo: true, practice: true, owner: id, ownerId: x.sub, facultyId: who.userId,
            platformAuth: true, courseId: who.courseId, name: 'Practice', mode: 'individual', state: 'open', startedAt: null, createdAt: t });
          await store.compareAndSetParticipant(c, id, null, { id, name, runId, teamLabel: name, joinedAt: null });
          await ensureRun(c, runId, name);
          await store.setPracticeSession(who.courseId, who.userId, c);
          return res.status(200).json({ code: c, students: [{ participantId: id, name: x.name }] });
        }

        // A student's two review answers, after the reveal. Revision 2 of the same completion.
        case 'review': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          const loaded = await loadMe(code, String(b.participantId || ''));
          if (!loaded || !loaded.run) return res.status(403).json({ error: 'not_joined' });
          const { me, run } = loaded;
          if (phaseOf(sess, t) !== 'ended') return res.status(409).json({ error: 'not_ended', message: 'The review opens after the reveal.' });
          const r1 = String(b.reflection1 || '').trim().slice(0, 1500), r2 = String(b.reflection2 || '').trim().slice(0, 1500);
          if (!r1 || !r2) return res.status(400).json({ error: 'answers_required', message: 'Answer both questions, then submit.' });
          const next = { ...me, review: { reflection1: r1, reflection2: r2, at: t } };
          if (!await store.compareAndSetParticipant(code, me.id, me, next)) continue;
          const participants = { [me.id]: next };
          await reportPeople(sess, participants, { [run.runId]: run }, [me.id], 2);
          return res.status(200).json({ ok: true, ...extras(sess, next) });
        }

        default:
          return res.status(400).json({ error: 'unknown_action' });
      }
    }
    return res.status(409).json({ error: 'busy_retry' });
  } catch (e) {
    console.error('session error', action, e.message);
    return res.status(500).json({ error: 'server_error' });
  }
}

module.exports = handler;
module.exports._now = null; // tests may replace with a controllable clock

