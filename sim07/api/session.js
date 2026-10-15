const { body } = require('../lib/guard.js');
const store = require('../lib/store.js');
const { verifyLaunch, reportCompletion } = require('../lib/launch.js');
const KIT = require('../lib/kit.js');
const { syncCourseRoster, approvedIds } = require('../lib/session-roster.js');
const { courseEnrolments, moveSessionRoster } = require('../lib/course-enrolments.js');
const { META, SETTINGS } = require('../data/config.js');
const E = require('../lib/engine.js');
const { accountJoinUrl, participantLaunch, participantError } = require('../lib/session-entry.js');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const newId = () => require('crypto').randomBytes(16).toString('hex');
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

function whoIsFaculty(req, b) {
  const lt = req.headers['x-launch-token'] || (b && b.launchToken);
  if (lt) {
    const p = verifyLaunch(String(lt));
    if (p && p.sim === META.id && (p.role === 'faculty' || p.role === 'faculty_preview')) {
      return { name: p.name || 'Facilitator', userId: p.sub || null, platformAuth: true, courseId: p.course || null };
    }
  }
  // Fail closed: an empty roster is not authorization.
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
  return { code: sess.code, name: sess.name, mode: sess.mode, state: sess.state, startedAt: sess.startedAt || null, solo: !!sess.solo, practice: !!sess.practice };
}
// A practice run has no console: its stages always advance on their own.
const beatFor = (sess, lastBeat) => (sess && sess.practice ? 0 : lastBeat);

async function pointCourse(fn) { try { await fn(); } catch (e) { console.error('course session pointer update failed', e.code || e.message); } }
const isPracticeSub = sub => String(sub || '').startsWith('practice-');
// Report each student with a position: revision 1 at the 2010 stage or close, revision 2 with their review.
async function reportPeople(sess, participants, ids, t, revision) {
  if (sess.practice || !sess.platformAuth) return { sent: 0 };
  let sent = 0;
  for (const id of ids) {
    const me = participants[id];
    if (!me || !id.startsWith('platform:') || !me.launchId || isPracticeSub(id.slice(9))) continue;
    const c = KIT.completion(sess, participants, id, t, revision);
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
    const participants = await store.getParticipants(s2.code).catch(() => ({}));
    await reportPeople(next, participants, Object.keys(participants), t, 1);
    await moveSessionRoster(req, b, next, 'archive', participants);
  }
}
function otherOpenReply(res, list, verb) {
  return res.status(409).json({ error: 'other_session_open', open: list.map(x => ({ code: x.code, name: x.name || META.title })),
    message: `${verb} closes the open session "${list[0].name || META.title}". Students who decided keep their results.` });
}

function clampSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const n = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d; };
  return {
    decisionMinutes: n(r.decisionMinutes, 3, 30, SETTINGS.decisionMinutes),
    justificationMinWords: n(r.justificationMinWords, 3, 40, SETTINGS.justificationMinWords),
    autoAdvanceSeconds: n(r.autoAdvanceSeconds, 30, 300, SETTINGS.autoAdvanceSeconds)
  };
}

// Student-facing state. Reveal content is included only once this participant
// has a recorded position and has answered the recognition question.
function studentView(sess, participants, me, lastBeat, t) {
  lastBeat = beatFor(sess, lastBeat);
  const phase = E.phaseOf(sess, t);
  const out = {
    session: publicSession(sess), phase, now: t, closesAt: E.closedAt(sess),
    decisionMinutes: E.settingsOf(sess).decisionMinutes,
    acceptsDecision: E.acceptsDecision(sess, t),
    me: { name: me.name, team: me.teamLabel || '', choice: me.choice || null, lapsed: !!me.lapsed,
      justification: me.justification || '', recognised: me.recognised || null },
    needsLapseLine: !me.choice && sess.state !== 'lobby' && !E.acceptsDecision(sess, t),
    stage: 0, stages: []
  };
  const ready = !!me.choice && !!me.recognised;
  if (sess.mode === 'team' && me.groupId && ready) {
    const t2 = E.teamOutcomes(participants, sess, t).find(x => x.groupId === me.groupId);
    if (t2 && t2.outcome) out.team = { label: t2.label, outcome: t2.outcome, tie: t2.tie, buy: t2.buy, decline: t2.decline };
  }
  if (ready) {
    out.stage = E.effectiveStage(sess, lastBeat, t);
    out.stages = E.stageContent(out.stage);
  }
  // After the 2010 stage: four questions and, for a signed-in student, the review.
  if (out.stage >= 3) {
    out.afterReveal = KIT.LESSON_QUESTIONS;
    out.review = { open: !!sess.platformAuth && String(me.id || '').startsWith('platform:'), questions: KIT.REVIEW_QUESTIONS, sent: !!me.review };
  }
  return out;
}

async function persistAutoStage(code, sess) {
  const lastBeat = beatFor(sess, await store.lastBeat(code));
  const eff = E.effectiveStage(sess, lastBeat, now());
  if (eff <= (Number(sess.stage) || 0)) return 'ok';
  return await store.compareAndSetSession(code, sess, { ...sess, stage: eff }) ? 'ok' : 'retry';
}

async function facultySession(req, res, b, code) {
  const who = whoIsFaculty(req, b);
  if (!who) { res.status(401).json({ error: 'faculty_authorization_required' }); return null; }
  const sess = await store.getSession(code);
  if (!sess) { res.status(404).json({ error: 'no_such_session' }); return null; }
  if (!ownsSession(who, sess)) { res.status(403).json({ error: 'not_your_session', message: `That session belongs to ${sess.owner}.` }); return null; }
  return { who, sess };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!store.configured()) return res.status(503).json({ error: 'no_store', message: 'Session storage is not configured for this deployment.' });

  const b = body(req);
  const action = String(b.action || '');
  const code = String(b.code || '').toUpperCase().trim();

  try {
    const facultyRename = action === 'rename_team' && !!whoIsFaculty(req, b);
    if (['join', 'state', 'decide', 'lapse', 'recognise', 'solo_start', 'review'].includes(action)) {
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
          // Mode is a required choice with no default.
          if (!['individual', 'team'].includes(mode)) return res.status(400).json({ error: 'play_mode_required' });
          const t0 = now();
          if (who.platformAuth && who.courseId) {
            const open = await otherOpen(who.courseId, null);
            if (open.length && !b.closeOpen) return otherOpenReply(res, open, 'Starting a new session');
            if (open.length) await closeSessions(open, req, b, t0);
          }
          const c = newCode();
          const sess = {
            code: c, owner: who.name, ownerId: who.userId || null, platformAuth: !!who.platformAuth,
            courseId: who.courseId || null, name: String(b.name || META.title).slice(0, 80),
            mode, state: 'lobby', settings: clampSettings(b.settings), stage: 0, pinned: [],
            showPrompts: false, teamSize: 4, createdAt: now()
          };
          await store.putSession(c, sess);
          if (sess.platformAuth && sess.courseId) {
            await pointCourse(() => store.addCourseSession(sess.courseId, c, sess.createdAt));
            await pointCourse(() => store.setCourseSession(sess.courseId, c));
          }
          return res.status(200).json({ session: { ...sess, joinUrl: sess.platformAuth ? accountJoinUrl(sess) : null }, you: who.name });
        }

        case 'faculty_state': {
          const f = await facultySession(req, res, b, code); if (!f) return;
          // Persist any stage the fallback released while the console was away,
          // before this poll marks the console present again.
          if (await persistAutoStage(code, f.sess) === 'retry') continue;
          const sess = await store.getSession(code);
          // The session page counts as the console: while it is open, the instructor releases each stage.
          if (!sess.practice) await store.beat(code);
          const [participants, rawBeat] = await Promise.all([store.getParticipants(code), store.lastBeat(code)]);
          const lastBeat = beatFor(sess, rawBeat);
          const t = now();
          f.sess = sess;
          const k = KIT.facultyKit(sess, participants, lastBeat, t);
          return res.status(200).json({
            session: { ...f.sess, paused: false, ended: k.kit.ended, stage: k.kit.stage, phase: E.phaseOf(f.sess, t),
              joinUrl: f.sess.platformAuth ? accountJoinUrl(f.sess) : null },
            participants: k.participants, runs: k.runs, kit: k.kit,
            phase: E.phaseOf(f.sess, t), now: t, closesAt: E.closedAt(f.sess),
            stage: E.effectiveStage(f.sess, lastBeat, t),
            responses: E.responseList(f.sess, participants, t),
            teams: f.sess.mode === 'team' ? E.teamOutcomes(participants, f.sess, t) : null,
            projector: E.projectorView(f.sess, participants, lastBeat, t),
            you: f.who.name
          });
        }

        case 'projector': {
          const f = await facultySession(req, res, b, code); if (!f) return;
          if (await persistAutoStage(code, f.sess) === 'retry') continue;
          const sess = await store.getSession(code);
          if (!sess.practice) await store.beat(code);
          const [participants, lastBeat] = await Promise.all([store.getParticipants(code), store.lastBeat(code)]);
          return res.status(200).json(E.projectorView(sess, participants, beatFor(sess, lastBeat), now()));
        }

        case 'control': {
          const f = await facultySession(req, res, b, code); if (!f) return;
          const sess = f.sess, prev = structuredClone(sess), t = now();
          const set = String(b.set || '');
          if (set === 'start') {
            if (sess.state !== 'lobby') return res.status(409).json({ error: 'session_already_started' });
            if (sess.mode === 'team') {
              const people = await store.getParticipants(code);
              if (!Object.values(people).some(p => p && p.joinedAt)) {
                return res.status(409).json({ error: 'participants_required', message: 'Assign at least one student to a team before starting.' });
              }
              if (Object.values(people).some(p => p && p.joinedAt && !p.groupId)) {
                return res.status(409).json({ error: 'unassigned_participants', message: 'Split or assign every student into a team before starting.' });
              }
            }
            sess.state = 'running'; sess.startedAt = t;
          } else if (set === 'end_decisions') {
            if (sess.state !== 'running' || !E.decisionsOpen(sess, t)) return res.status(409).json({ error: 'decisions_not_open' });
            sess.closedEarlyAt = t;
          } else if (set === 'next_stage' || set === 'release') {
            const lastBeat0 = await store.lastBeat(code);
            const n = set === 'next_stage' ? E.effectiveStage(sess, lastBeat0, t) + 1 : Number(b.stage);
            if (![1, 2, 3].includes(n)) return res.status(400).json({ error: 'invalid_stage' });
            if (E.phaseOf(sess, t) !== 'decided') return res.status(409).json({ error: 'decisions_still_open' });
            const lastBeat = await store.lastBeat(code);
            const current = E.effectiveStage(sess, lastBeat, t);
            if (n !== current + 1 && n !== current) return res.status(409).json({ error: 'stage_out_of_order' });
            sess.stage = Math.max(current, n);
          } else if (set === 'prompts') {
            sess.showPrompts = !!b.on;
          } else if (set === 'close') {
            if (sess.state === 'closed') return res.status(409).json({ error: 'session_closed' });
            sess.state = 'closed'; sess.closedAt = t;
          } else if (set === 'reopen') {
            if (sess.state !== 'closed') return res.status(409).json({ error: 'session_not_closed' });
            if (!sess.practice && sess.courseId) {
              const open = await otherOpen(sess.courseId, code);
              if (open.length && !b.closeOpen) return otherOpenReply(res, open, 'Reopening this session');
              if (open.length) await closeSessions(open, req, b, t);
            }
            sess.state = sess.startedAt ? 'running' : 'lobby'; sess.closedAt = null; sess.reopenedAt = t;
          } else if (set === 'settings') {
            if (sess.state !== 'lobby') return res.status(409).json({ error: 'session_already_started' });
            sess.settings = clampSettings({ ...sess.settings, ...(b.settings || {}) });
          } else return res.status(400).json({ error: 'unknown_control' });
          if (!await store.compareAndSetSession(code, prev, sess)) continue;
          if (sess.courseId && !sess.practice) {
            if (set === 'close') await pointCourse(() => store.clearCourseSession(sess.courseId, code));
            if (set === 'reopen') await pointCourse(() => store.setCourseSession(sess.courseId, code));
          }
          if (set === 'close' || set === 'reopen') {
            const participants = await store.getParticipants(code).catch(() => ({}));
            if (set === 'close') await reportPeople(sess, participants, Object.keys(participants), t, 1);
            await moveSessionRoster(req, b, sess, set === 'close' ? 'archive' : 'restore', participants);
          }
          return res.status(200).json({ session: sess });
        }

        case 'pin': {
          const f = await facultySession(req, res, b, code); if (!f) return;
          const sess = f.sess, prev = structuredClone(sess);
          const people = await store.getParticipants(code);
          const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 2) : [];
          if (ids.some(id => !people[id])) return res.status(404).json({ error: 'no_such_response' });
          sess.pinned = ids;
          if (!await store.compareAndSetSession(code, prev, sess)) continue;
          return res.status(200).json({ pinned: ids });
        }

        case 'suggest_pair': {
          const f = await facultySession(req, res, b, code); if (!f) return;
          const people = await store.getParticipants(code);
          const pair = E.suggestPair(E.responseList(f.sess, people, now()));
          return res.status(200).json({ pair });
        }

        case 'teams': {
          const f = await facultySession(req, res, b, code); if (!f) return;
          if (f.sess.mode !== 'team') return res.status(409).json({ error: 'not_team_mode' });
          if (f.sess.state !== 'lobby') return res.status(409).json({ error: 'session_already_started' });
          const people = await store.getParticipants(code);
          const prev = structuredClone(people);
          const plan = E.autoTeams(people, b.size);
          for (const [id, g] of Object.entries(plan)) Object.assign(people[id], g);
          if (!await store.compareAndSetRoster(code, prev, people, f.sess)) continue;
          return res.status(200).json({ ok: true });
        }

        case 'assign': {
          const f = await facultySession(req, res, b, code); if (!f) return;
          if (f.sess.mode !== 'team') return res.status(409).json({ error: 'not_team_mode' });
          if (f.sess.state === 'closed') return res.status(409).json({ error: 'session_closed' });
          const people = await store.getParticipants(code);
          const pid = String(b.participantId || '');
          const n = Number(b.team);
          if (!people[pid]) return res.status(404).json({ error: 'no_such_participant' });
          if (!Number.isInteger(n) || n < 1 || n > 60) return res.status(400).json({ error: 'invalid_team' });
          const prev = structuredClone(people[pid]);
          const next = { ...prev, groupId: `team:${n}`, teamLabel: `Team ${n}` };
          if (!await store.compareAndSetParticipant(code, pid, prev, next, f.sess)) continue;
          return res.status(200).json({ ok: true });
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
          if (!launched && (!id || !all[id])) {
            const match = Object.values(all).find(p => p && !p.id.startsWith('platform:') && key(p.name) === key(name));
            id = match ? match.id : (id || newId());
          }
          if (!launched && id.startsWith('platform:')) return res.status(401).json({ error: 'platform_signin_required' });
          const existing = all[id] || null;
          let group = existing ? { groupId: existing.groupId, teamLabel: existing.teamLabel } : { groupId: null, teamLabel: '' };
          if (sess.mode === 'individual') group = { groupId: `individual:${id}`, teamLabel: '' };
          // Late arrivals to a running team session join the smallest team.
          else if (!existing && sess.state === 'running') group = E.smallestTeam(all);
          // A class-list student keeps the team the instructor gave them; a running team session puts a newcomer on the smallest team.
          if (sess.mode === 'team' && existing && !existing.joinedAt && !existing.groupId && sess.state === 'running') group = E.smallestTeam(all);
          const participant = { ...(existing || {}), id, name, ...group, joinedAt: existing?.joinedAt || now(), ...(launched ? { launchId: launched.run } : {}) };
          if (!await store.compareAndSetParticipant(code, id, existing, participant, sess)) continue;
          return res.status(200).json({ participantId: id, session: publicSession(sess) });
        }

        case 'state': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          const pid = String(b.participantId || '');
          const [participants, lastBeat] = await Promise.all([store.getParticipants(code), store.lastBeat(code)]);
          const me = participants[pid];
          if (!me) return res.status(403).json({ error: 'not_joined' });
          return res.status(200).json(studentView(sess, participants, me, lastBeat, now()));
        }

        case 'decide':
        case 'lapse':
        case 'recognise': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          if (sess.state === 'lobby') return res.status(409).json({ error: 'session_not_running' });
          if (sess.state === 'closed') return res.status(409).json({ error: 'session_closed' });
          const pid = String(b.participantId || '');
          const participants = await store.getParticipants(code);
          const me = participants[pid];
          if (!me) return res.status(403).json({ error: 'not_joined' });
          if (sess.mode === 'team' && !me.groupId) return res.status(409).json({ error: 'team_not_assigned' });
          const t = now(), s = E.settingsOf(sess), next = { ...me };
          if (action === 'decide') {
            if (me.choice) return res.status(409).json({ error: 'decision_locked' });
            if (!E.acceptsDecision(sess, t)) return res.status(409).json({ error: 'offer_lapsed' });
            const choice = String(b.choice || '');
            if (!['buy', 'decline'].includes(choice)) return res.status(400).json({ error: 'choice_required' });
            const text = String(b.justification || '').trim().slice(0, 1200);
            if (E.words(text) < s.justificationMinWords) return res.status(400).json({ error: 'justification_too_short', min: s.justificationMinWords });
            Object.assign(next, { choice, lapsed: false, justification: text, decidedAt: t });
          } else if (action === 'lapse') {
            if (me.choice) return res.status(409).json({ error: 'decision_locked' });
            if (E.acceptsDecision(sess, t)) return res.status(409).json({ error: 'decisions_still_open' });
            const text = String(b.justification || '').trim().slice(0, 600);
            if (E.words(text) < s.lapseMinWords) return res.status(400).json({ error: 'lapse_line_too_short', min: s.lapseMinWords });
            Object.assign(next, { choice: 'decline', lapsed: true, justification: text, decidedAt: t });
          } else {
            if (!me.choice) return res.status(409).json({ error: 'decision_required' });
            if (me.recognised) return res.status(409).json({ error: 'recognition_locked' });
            const answer = String(b.answer || '');
            if (!['yes', 'no', 'unsure'].includes(answer)) return res.status(400).json({ error: 'answer_required' });
            next.recognised = answer;
          }
          if (!await store.compareAndSetParticipant(code, pid, me, next, sess)) continue;
          let current = sess;
          // A practice run closes its decisions once its one student has decided, so the stages follow.
          if (sess.practice && action === 'recognise' && E.decisionsOpen(sess, t)) {
            const closed = { ...sess, closedEarlyAt: t };
            if (await store.compareAndSetSession(code, sess, closed)) current = closed;
          }
          const lastBeat = await store.lastBeat(code);
          const fresh = await store.getParticipants(code);
          return res.status(200).json(studentView(current, fresh, next, lastBeat, now()));
        }

        // ---------- the shared faculty pages ----------
        case 'faculty_enrolments': {
          const f = await facultySession(req, res, b, code); if (!f) return;
          if (f.sess.practice) {
            const people = Object.values(await store.getParticipants(code)).filter(Boolean);
            return res.status(200).json({ available: true, practice: true, students: people.map(p => ({ participantId: p.id, name: p.name, accessReleased: true })) });
          }
          try {
            const roster = f.sess.mode === 'team' ? await syncCourseRoster(req, b, f.sess) : await courseEnrolments(req, b, f.sess);
            // Individual play: every approved student gets their own run before they open the sim.
            if (f.sess.mode === 'individual' && roster.available && f.sess.state !== 'closed') {
              const records = roster.students.filter(x => x.accessReleased === true && /^platform:[A-Za-z0-9_-]+$/.test(String(x.participantId || '')))
                .map(x => ({ id: x.participantId, name: String(x.name || 'Student').trim().slice(0, 60), groupId: `individual:${x.participantId}`, teamLabel: '', source: 'course', joinedAt: null }));
              if (records.length && await store.ensureParticipants(code, records, f.sess) < 0) continue;
            }
            return res.status(200).json(roster);
          } catch (e) {
            return res.status(e.status || 503).json({ error: 'enrolments_unavailable', message: e.message });
          }
        }

        // The Teams tab: assign each student by team name or team id; '__unassigned__' takes them off.
        case 'group': {
          const f = await facultySession(req, res, b, code); if (!f) return;
          const sess = f.sess;
          if (sess.mode !== 'team') return res.status(409).json({ error: 'not_team_mode' });
          if (sess.state !== 'lobby') return res.status(409).json({ error: 'teams_locked', message: 'Teams are fixed once the session starts.' });
          const roster = sess.platformAuth && sess.courseId ? await syncCourseRoster(req, b, sess) : null;
          const allowed = approvedIds(roster);
          const participants = await store.getParticipants(code);
          const previous = structuredClone(participants);
          for (const [id, value] of Object.entries(b.assign && typeof b.assign === 'object' ? b.assign : {})) {
            const p = participants[id];
            if (!p) return res.status(404).json({ error: 'no_such_participant' });
            const clean = String(value || '').trim().slice(0, 40);
            if (!clean || clean === '__unassigned__') { p.groupId = null; p.teamLabel = ''; continue; }
            if (allowed && !allowed.has(id)) return res.status(403).json({ error: 'student_not_approved' });
            const mate = Object.values(participants).find(x => x && x.groupId === clean);
            if (clean.startsWith('team:') && mate) { p.groupId = clean; p.teamLabel = mate.teamLabel || clean.slice(5); continue; }
            const norm = clean.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
            if (!norm) return res.status(400).json({ error: 'team_name_required' });
            p.groupId = `team:${norm}`; p.teamLabel = clean;
          }
          if (!await store.compareAndSetRoster(code, previous, participants, sess)) continue;
          return res.status(200).json({ ok: true });
        }

        case 'rename_team': {
          if (!facultyRename) return res.status(401).json({ error: 'faculty_authorization_required' });
          const f = await facultySession(req, res, b, code); if (!f) return;
          const gid = String(b.groupId || '');
          const label = String(b.teamLabel || '').replace(/\s+/g, ' ').trim().slice(0, 40);
          if (!gid.startsWith('team:') || !label) return res.status(400).json({ error: 'team_name_required' });
          const participants = await store.getParticipants(code);
          const previous = structuredClone(participants);
          let hit = 0;
          for (const p of Object.values(participants)) if (p && p.groupId === gid) { p.teamLabel = label; hit++; }
          if (!hit) return res.status(404).json({ error: 'no_such_team' });
          if (!await store.compareAndSetRoster(code, previous, participants, f.sess)) continue;
          return res.status(200).json({ ok: true });
        }

        // Every member votes, so there is no team lead to choose.
        case 'set_captain': {
          const f = await facultySession(req, res, b, code); if (!f) return;
          return res.status(200).json({ ok: true });
        }

        case 'hide_session': {
          const f = await facultySession(req, res, b, code); if (!f) return;
          if (f.sess.state !== 'closed') return res.status(409).json({ error: 'session_open', message: 'Close the session first. Then you can hide it.' });
          if (!await store.compareAndSetSession(code, f.sess, { ...f.sess, hidden: true, hiddenAt: now() })) continue;
          return res.status(200).json({ ok: true });
        }

        // The class's sessions, newest first, for the Sessions page.
        case 'course_sessions': {
          const who = whoIsFaculty(req, b);
          if (!who) return res.status(401).json({ error: 'faculty_authorization_required' });
          if (!who.platformAuth || !who.courseId) return res.status(200).json({ sessions: [] });
          let codes = [];
          try { codes = await store.listCourseSessions(who.courseId); const p = await store.getCourseSession(who.courseId); if (p && !codes.includes(p)) codes.unshift(p); } catch (e) { codes = []; }
          const t = now(), sessions = [];
          for (const c of codes.slice(0, 20)) {
            const s2 = await store.getSession(c);
            if (!s2 || s2.practice || s2.hidden || !ownsSession(who, s2)) continue;
            const participants = await store.getParticipants(c);
            const k = KIT.facultyKit(s2, participants, 0, t);
            const runs = Object.values(k.runs);
            sessions.push({ code: c, name: s2.name, mode: s2.mode, state: s2.state, paused: false, createdAt: s2.createdAt || null,
              students: Object.values(participants).filter(p => p && p.joinedAt).length, teams: s2.mode === 'team' ? runs.length : 0,
              submitted: runs.filter(r => r.done).length });
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
          const t = now();
          const current = await store.getPracticeSession(who.courseId, who.userId);
          const existing = current ? await store.getSession(current) : null;
          const mine = existing && ownsSession(who, existing) ? existing : null;
          const progressOf = async c => {
            const [s2, participants] = await Promise.all([store.getSession(c), store.getParticipants(c)]);
            const students = Object.values(participants).filter(Boolean).map(p => {
              const v = s2 ? studentView(s2, participants, p, 0, t) : null;
              const finished = !!(v && v.stage >= 3);
              return { name: p.name, finished, status: p.review ? 'Sent the review' : finished ? 'Read the 2010 stage' : p.recognised ? (v && v.stage ? `Reading the ${['', '2002', '2005', '2010'][v.stage]} stage` : 'Waiting for the first stage') : p.choice ? 'Decided' : s2 && s2.startedAt ? 'Reading the briefing' : p.joinedAt ? 'Reading the setting' : 'Ready to start' };
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
          // A private run: the practice student starts their own clock, and the stages follow on their own.
          await store.putSession(c, { code: c, solo: true, practice: true, owner: id, ownerId: x.sub, facultyId: who.userId,
            platformAuth: true, courseId: who.courseId, name: 'Practice', mode: 'individual', state: 'lobby',
            settings: clampSettings({ autoAdvanceSeconds: 45 }), stage: 0, pinned: [], showPrompts: false, createdAt: t });
          await store.addParticipant(c, id, { id, name: x.name.trim().slice(0, 60), groupId: `individual:${id}`, teamLabel: '', joinedAt: null });
          await store.setPracticeSession(who.courseId, who.userId, c);
          return res.status(200).json({ code: c, students: [{ participantId: id, name: x.name }] });
        }

        // A private run's student starts their own clock.
        case 'solo_start': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          if (!sess.solo || sess.owner !== String(b.participantId || '')) return res.status(403).json({ error: 'not_your_session' });
          if (sess.state !== 'lobby') return res.status(200).json({ session: publicSession(sess) });
          const next = { ...sess, state: 'running', startedAt: now() };
          if (!await store.compareAndSetSession(code, sess, next)) continue;
          return res.status(200).json({ session: publicSession(next) });
        }

        // A student's two review answers, after the 2010 stage. Revision 2 of the same completion.
        case 'review': {
          const sess = await store.getSession(code);
          if (!sess) return res.status(404).json({ error: 'no_such_session' });
          const pid = String(b.participantId || '');
          const [participants, lastBeat] = await Promise.all([store.getParticipants(code), store.lastBeat(code)]);
          const me = participants[pid];
          if (!me) return res.status(403).json({ error: 'not_joined' });
          const t = now();
          if (studentView(sess, participants, me, lastBeat, t).stage < 3) return res.status(409).json({ error: 'not_finished', message: 'The review opens after the 2010 stage.' });
          const r1 = String(b.reflection1 || '').trim().slice(0, 1500), r2 = String(b.reflection2 || '').trim().slice(0, 1500);
          if (!r1 || !r2) return res.status(400).json({ error: 'answers_required', message: 'Answer both questions, then submit.' });
          const next = { ...me, review: { reflection1: r1, reflection2: r2, at: t } };
          if (!await store.compareAndSetParticipant(code, pid, me, next, sess)) continue;
          participants[pid] = next;
          await reportPeople(sess, participants, [pid], t, 2);
          return res.status(200).json(studentView(sess, participants, next, lastBeat, t));
        }

        default:
          return res.status(400).json({ error: 'unknown_action' });
      }
    }
    return res.status(409).json({ error: 'busy_retry', message: 'The session changed while saving. Please try again.' });
  } catch (e) {
    console.error('session error', action, e.message);
    return res.status(e.code === 'NO_STORE' ? 503 : 500).json({ error: 'session_error' });
  }
};

module.exports.studentView = studentView;
