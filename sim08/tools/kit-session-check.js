#!/usr/bin/env node
require('../../tools/security/report-fixture.cjs');
// Eighteen Months Later on the shared faculty pages: one open session per class, the class link, the shared
// clock moved from the session bar, outcomes as bands, the questions and review with the report, completions
// with the session and band, close, reopen, hide, teams without a lead, Rehearse with skipping, and the class
// debrief with its answer key. Real handlers; in-memory store with compare-and-set.
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const store = require('../lib/store.js');
const C = require('../config/content.js');
const S8 = require('../lib/scenario.js');

process.env.LAUNCH_SECRET = 'kit-test-secret-not-real';
process.env.PLATFORM_URL = 'https://platform.test';
delete process.env.ACCESS_CODE;
let clockMs = 1_800_000_000_000;
Date.now = () => clockMs;
const reports = [];
global.fetch = async (url, options) => {
  const b = JSON.parse(options.body || '{}');
  if (String(url).endsWith('/api/complete')) reports.push(JSON.parse(Buffer.from(b.token.split('.')[0], 'base64url').toString('utf8')));
  if (String(url).endsWith('/api/session-enrolments')) return { ok: true, status: 200, json: async () => ({ students: ['ana', 'ben', 'cal', 'dee'].map(x => ({ participantId: `platform:${x}`, name: x, accessReleased: true })) }) };
  return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
};

const runsMap = new Map();
const sessions = new Map(), people = new Map(), lists = new Map(), pointers = new Map(), practice = new Map();
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
Object.assign(store, {
  configured: () => true,
  putSession: async (c, v) => { sessions.set(c, structuredClone(v)); return v; },
  getSession: async c => structuredClone(sessions.get(c) || null),
  getParticipants: async c => structuredClone(people.get(c) || {}),
  addParticipant: async (c, id, v) => { const m = people.get(c) || {}; m[id] = structuredClone(v); people.set(c, m); },
  compareAndSetSession: async (c, prev, next) => { if (!same(sessions.get(c), prev)) return false; sessions.set(c, structuredClone(next)); return true; },
  compareAndSetParticipant: async (c, id, prev, next, sess) => {
    if (!same(sessions.get(c), sess)) return false;
    const m = people.get(c) || {}; if (!same(m[id], prev)) return false; m[id] = structuredClone(next); people.set(c, m); return true;
  },
  compareAndSetRoster: async (c, prev, next, sess) => { if (!same(sessions.get(c), sess) || !same(people.get(c) || {}, prev)) return false; people.set(c, structuredClone(next)); return true; },
  ensureParticipants: async (c, list) => { const m = people.get(c) || {}; let added = 0; for (const p of list) if (!m[p.id]) { m[p.id] = structuredClone(p); added++; } people.set(c, m); return added; },
  setCourseSession: async (course, c) => pointers.set(course, c), getCourseSession: async course => pointers.get(course) || null,
  clearCourseSession: async (course, c) => { if (pointers.get(course) === c) pointers.delete(course); },
  addCourseSession: async (course, c, at) => { const m = lists.get(course) || new Map(); m.set(c, at); lists.set(course, m); },
  listCourseSessions: async course => [...(lists.get(course) || new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
  setPracticeSession: async (course, o, c) => practice.set(course + '|' + o, c), getPracticeSession: async (course, o) => practice.get(course + '|' + o) || null,
  clearPracticeSession: async (course, o) => practice.delete(course + '|' + o), wipe: async c => { sessions.delete(c); people.delete(c); runsMap.delete(c); },
  getRuns: async c => structuredClone(runsMap.get(c) || {}),
  setRun: async (c, id, v) => { const m = runsMap.get(c) || {}; m[id] = structuredClone(v); runsMap.set(c, m); },
  compareAndSetRun: async (c, id, prev, next, sess) => { if (!same(sessions.get(c), sess)) return false; const m = runsMap.get(c) || {}; if (!same(m[id], prev)) return false; m[id] = structuredClone(next); runsMap.set(c, m); return true; }
});
const session = require('../api/session.js');
const finish = require('../api/finish.js');
const K = require('../lib/kit.js');
require('../../platform/public/kit/faculty-workspace.js');
const F = require('../public/later-faculty.js');
const D = require('../public/later-debrief.js');

const token = ({ sub, name = sub, role = 'student', mode = 'play', course = 'crs_A' }) => {
  const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: S8.META.id, mode, course, iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64url');
  return body + '.' + createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url');
};
async function call(handler, body, lt) {
  const res = { statusCode: 200, payload: null, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(v) { this.payload = v; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: lt ? { 'x-launch-token': lt } : {}, body }, res);
  return { status: res.statusCode, body: res.payload };
}
const fac = token({ sub: 'fac', name: 'Vikram', role: 'faculty', mode: 'session' }), other = token({ sub: 'other', role: 'faculty', mode: 'session' });
const api = (b, lt = fac) => call(session, b, lt);
let n = 0; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; }; const ok = (v, m) => { assert.ok(v, m); n++; };
const st = Object.fromEntries(['ana', 'ben', 'cal', 'dee'].map(x => [x, token({ sub: x, name: x[0].toUpperCase() + x.slice(1) })]));


// Moves the shared clock to `phase` from the session bar.
async function moveTo(code, phase, lt = fac) {
  for (let i = 0; i < 8; i++) {
    const c = (await api({ action: 'faculty_state', code }, lt)).body.session.clock;
    if (c.phase === phase) return c;
    const r = await api({ action: 'control', code, set: 'advance' }, lt);
    if (r.status !== 200) throw new Error('advance failed: ' + JSON.stringify(r.body));
  }
  throw new Error('never reached ' + phase);
}
const sAsk = (code, who, q) => api({ action: 'ask', code, participantId: `platform:${who}`, question: q }, st[who]);
const sVote = (code, who, kind, choice) => api({ action: 'vote', code, participantId: `platform:${who}`, kind, choice }, st[who]);

(async () => {
  eq((await api({ action: 'create', name: 'Thu' })).status, 400, 'No mode, no session');
  const made = await api({ action: 'create', name: 'Thu 9:00', mode: 'individual' });
  eq([made.status, made.body.session.state], [200, 'lobby'], 'Faculty create a session');
  const code = made.body.session.code;
  eq((await api({ action: 'create', name: 'Again', mode: 'team' })).body.error, 'other_session_open', 'A second session asks first');
  eq((await api({ action: 'course_sessions' })).body.sessions.map(s => s.code), [code], 'The Sessions page lists it');
  eq((await api({ action: 'course_sessions' }, other)).body.sessions, [], 'Another faculty member sees none');

  eq((await api({ action: 'course_session' }, st.ana)).body.code, code, 'The class link finds the open session');
  for (const x of ['ana', 'ben', 'cal']) eq((await api({ action: 'join', code }, st[x])).status, 200, `${x} joins signed in`);
  eq((await api({ action: 'join', code }, token({ sub: 'practice-fac-zed' }))).status, 403, 'A practice student cannot join a class session');
  eq((await api({ action: 'control', code, set: 'start' })).body.session.state, 'running', 'Start session');
  ok(F.controls({ code, clock: { phase: 'briefing' } }, false).includes('Open the demonstrations now'), 'The session bar opens the next part');

  await moveTo(code, 'questions');
  eq((await sAsk(code, 'ana', 'q10')).status, 200, 'Ana asks about the front desk');
  await sAsk(code, 'ben', 'q01');
  await sAsk(code, 'cal', 'q15');
  let fs1 = (await api({ action: 'faculty_state', code })).body;
  eq(fs1.runs['individual:platform:ana'].questionIds, ['q10'], 'Questions appear as they are spent');
  eq(fs1.runs['individual:platform:ana'].band, null, 'No band before the report');
  await moveTo(code, 'commit');
  await sVote(code, 'ana', 'vendor', 'kestrel'); await sVote(code, 'ben', 'vendor', 'tailwind'); await sVote(code, 'cal', 'vendor', 'pawtime');
  await moveTo(code, 'plan');
  await sVote(code, 'ana', 'plan', 'cover'); await sVote(code, 'ben', 'plan', 'owner'); await sVote(code, 'cal', 'plan', 'parallel');
  await moveTo(code, 'report');
  ok(!F.controls((await api({ action: 'faculty_state', code })).body.session, false).includes('data-session-control'), 'Nothing left to open');
  const fs = (await api({ action: 'faculty_state', code })).body;
  eq(fs.kit.ended, true, 'The report is reached');
  eq(['ana', 'ben', 'cal'].map(x => fs.runs['individual:platform:' + x].band), ['adopted', 'lucky', 'knew'], 'Each student has an outcome band');
  eq([fs.kit.bands.adopted.cls, fs.kit.bands.shadow.cls], ['g', 'l'], 'Adopted is green, a shadow system red');
  ok(fs.kit.questions.find(q => q.id === 'q10').routes.kestrel === 'direct', 'The answer key reaches the faculty pages');
  ok(Object.keys(fs.projector).includes('live'), 'The Live screen still gets its projector view');

  const view = (await api({ action: 'state', code, participantId: 'platform:ana' }, st.ana)).body.view;
  eq([view.afterReport.length, view.review.open, view.review.sent], [4, true, false], 'Four questions and the review follow the report');
  const fin = await call(finish, { code, participantId: 'platform:ana' }, st.ana);
  eq(fin.body.reported, true, 'The report reaches the platform');
  const r1 = reports.at(-1);
  eq([r1.sub, r1.metrics.revision, r1.summary.sessionCode, r1.summary.band, r1.summary.bandTone, r1.runId], ['ana', 1, code, 'adopted', 'g', `${code}:platform:ana`], 'Revision 1 names the session and band');
  eq((await api({ action: 'review', code, participantId: 'platform:ana', reflection1: 'The front desk one.', reflection2: 'Our LMS. A shared drive.' }, st.ana)).body.view.review.sent, true, 'The review saves');
  eq([reports.at(-1).metrics.revision, reports.at(-1).summary.reflection1], [2, 'The front desk one.'], 'Revision 2 carries the review');
  eq((await api({ action: 'review', code, participantId: 'platform:ben', reflection1: 'One' }, st.ben)).status, 400, 'Both answers are needed');
  const fs2 = (await api({ action: 'faculty_state', code })).body;

  // The class debrief.
  F.prompts(fs2, F.questions);
  const TEAMS = global.FacultyWorkspace.recordsFrom(fs2, F);
  const m = D.model(F.debrief.input(TEAMS, { state: fs2 }));
  eq([m.ready, m.slides.map(s => s.key)], [true, ['glance', 'split', 'questions', 'plans', 'said', 'lessons']], 'Six slides');
  eq(m.slides[0].body.tiles.length, 3, 'D0: three outcomes');
  eq(m.slides[1].body.cards.length, 0, 'D1: nobody bought the same vendor, so no pair');
  ok(m.slides[2].headline.startsWith('Two of three'), 'D2: two found their vendor\'s risk');
  eq(m.slides[3].body.grid.find(g => g.name === C.VENDORS[0].name).cells.find(c => c.fit).n, 1, 'D3: Ana funded the plan that fitted');
  eq(m.slides[4].body.cards.map(c => c.name), ['Ana'], 'D4: what students said');
  ok(m.slides[5].body.items.length === 4 && m.slides[5].body.items.every(x => x.evidence), 'D5: four lessons with evidence');
  eq(JSON.stringify(D.model({ ...F.debrief.input(TEAMS, { state: fs2 }), anonymous: true }).slides[0]).includes('Ana'), false, 'Anonymous slides carry no names');
  const pairUp = D.model({ ...F.debrief.input(TEAMS, { state: fs2 }), teams: F.debrief.input(TEAMS, { state: fs2 }).teams.map(t => ({ ...t, vendor: 'kestrel' })) });
  eq(pairUp.slides[1].body.cards.length, 2, 'D1: the same vendor, two outcomes, side by side');

  // Close, reopen, hide.
  const pre = reports.length;
  eq((await api({ action: 'control', code, set: 'close' })).body.session.state, 'closed', 'Close');
  eq(reports.length - pre, 3, 'Close reports every finished student');
  eq((await api({ action: 'course_session' }, st.ana)).body.code, null, 'A closed session takes no students');
  eq((await api({ action: 'control', code, set: 'reopen' })).body.session.state, 'running', 'Reopen');
  eq((await api({ action: 'faculty_state', code })).body.session.clock.phase, 'report', 'Reopen keeps the clock where it was');
  await api({ action: 'control', code, set: 'close' });
  eq((await api({ action: 'hide_session', code })).status, 200, 'Hide');
  eq((await api({ action: 'course_sessions' })).body.sessions, [], 'A hidden session leaves the list');

  // Teams: no lead; majority votes.
  const t = (await api({ action: 'create', name: 'Teams', mode: 'team' })).body.session.code;
  for (const x of ['ana', 'ben', 'cal', 'dee']) await api({ action: 'join', code: t }, st[x]);
  eq((await api({ action: 'group', code: t, assign: { 'platform:ana': 'Team 1', 'platform:ben': 'Team 1', 'platform:cal': 'Team 2', 'platform:dee': 'Team 2' } })).status, 200, 'Split');
  eq((await api({ action: 'group', code: t, assign: { 'platform:dee': 'team:team-1' } })).status, 200, 'Move a student by team id');
  eq((await api({ action: 'set_captain', code: t, participantId: 'platform:ana' })).status, 200, 'No team lead is needed');
  eq((await api({ action: 'rename_team', code: t, groupId: 'team:team-1', teamLabel: 'North' })).status, 200, 'Faculty rename a team');
  eq((await api({ action: 'control', code: t, set: 'start' })).body.session.state, 'running', 'Start the team session');
  const ts = (await api({ action: 'faculty_state', code: t })).body;
  eq(Object.keys(ts.runs).sort(), ['team:team-1', 'team:team-2'], 'One run per team');
  eq(ts.runs['team:team-1'].teamLabel, 'North', 'The team keeps its name');
  await api({ action: 'control', code: t, set: 'close' });

  // Rehearse: one practice student; the clock starts on joining; parts skip once done.
  const ps = await api({ action: 'practice_start', students: [{ sub: 'practice-fac-ana', name: 'Practice Ana' }] });
  eq([ps.status, ps.body.students[0].status], [200, 'Ready to start'], 'Rehearse opens one practice student, ready to start');
  const pa = token({ sub: 'practice-fac-ana', name: 'Practice Ana' }), pid = 'platform:practice-fac-ana', pc = ps.body.code;
  eq((await api({ action: 'course_session' }, pa)).body.code, pc, 'The practice student finds the practice run');
  eq((await api({ action: 'join', code: pc }, pa)).status, 200, 'The practice student joins');
  eq((await api({ action: 'join', code: pc }, st.ben)).status, 403, 'A real student cannot join practice');
  let pv = (await api({ action: 'state', code: pc, participantId: pid }, pa)).body.view;
  eq([pv.clock.phase, pv.canSkip], ['briefing', true], 'The clock starts on joining; the briefing can be skipped');
  await api({ action: 'skip', code: pc, participantId: pid }, pa);
  await api({ action: 'skip', code: pc, participantId: pid }, pa);
  await api({ action: 'ask', code: pc, participantId: pid, question: 'q12' }, pa);
  await api({ action: 'skip', code: pc, participantId: pid }, pa);
  eq((await api({ action: 'skip', code: pc, participantId: pid }, pa)).body.error, 'decide_first', 'Choose a vendor before skipping on');
  await api({ action: 'vote', code: pc, participantId: pid, kind: 'vendor', choice: 'tailwind' }, pa);
  await api({ action: 'skip', code: pc, participantId: pid }, pa);
  await api({ action: 'vote', code: pc, participantId: pid, kind: 'plan', choice: 'owner' }, pa);
  pv = (await api({ action: 'skip', code: pc, participantId: pid }, pa)).body.view;
  ok(pv.report && pv.review.open, 'The practice student reaches the report and the review');
  eq((await api({ action: 'practice_status' })).body.complete, true, 'Rehearse complete');
  const before = reports.length;
  eq((await call(finish, { code: pc, participantId: pid }, pa)).body.reason, 'practice', 'Practice never reports');
  await api({ action: 'review', code: pc, participantId: pid, reflection1: 'a', reflection2: 'b' }, pa);
  eq(reports.length, before, 'Not even the review');
  eq((await api({ action: 'faculty_state', code: pc })).body.runs['individual:' + pid].band, 'adopted', 'See the faculty view of the practice run');
  eq((await api({ action: 'course_sessions' })).body.sessions.some(s => s.code === pc), false, 'Practice stays out of the Sessions page');
  eq((await api({ action: 'practice_finish' })).status, 200, 'End practice');
  eq(K.REVIEW_QUESTIONS[1], C.DEBRIEF.turn, 'The closing question is the second review question');
  console.log(`PASS kit-session-check: ${n} assertions`);
})().catch(e => { console.error(e); process.exit(1); });
