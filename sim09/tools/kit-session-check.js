#!/usr/bin/env node
require('../../tools/security/report-fixture.cjs');
// Where Does the Money Land? on the shared faculty pages: one open session per class, the class link, the shared
// clock moved from the session bar, bands from each fund against its own statement, the stages released from the
// bar, the questions and review after 2010, completions with the session and band, close, reopen, hide, teams
// where the first press decides, Rehearse, and the class debrief. Real handlers; in-memory store.
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
const F = require('../public/money-faculty.js');
const D = require('../public/money-debrief.js');

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



const ok_ = (v, m) => ok(v, m);
const stmt = pick => ({ direction: 'Business purchasing moves online, and most large buyers will run it through software.', pick, reason: 'The forecast says the marketplaces in the middle will take a fee on every order that passes through them.' });
const fund = parts => ({ RA: 0, IC: 0, LS: 0, MS: 0, PS: 0, cash: 0, ...parts });
const sAct = (code, who, body) => api({ ...body, code, participantId: `platform:${who}` }, st[who]);
const phaseOf = async (code, lt = fac) => (await api({ action: 'faculty_state', code }, lt)).body.session.clock.phase;

(async () => {
  eq((await api({ action: 'create', name: 'Thu' })).status, 400, 'No mode, no session');
  const made = await api({ action: 'create', name: 'Thu 9:00', mode: 'individual' });
  eq([made.status, made.body.session.state], [200, 'lobby'], 'Faculty create a session');
  const code = made.body.session.code;
  eq((await api({ action: 'create', name: 'Again', mode: 'team' })).body.error, 'other_session_open', 'A second session asks first');
  eq((await api({ action: 'course_sessions' })).body.sessions.map(s => s.code), [code], 'The Sessions page lists it');

  eq((await api({ action: 'course_session' }, st.ana)).body.code, code, 'The class link finds the open session');
  for (const x of ['ana', 'ben', 'cal']) eq((await api({ action: 'join', code }, st[x])).status, 200, `${x} joins signed in`);
  eq((await api({ action: 'join', code }, token({ sub: 'practice-fac-zed' }))).status, 403, 'A practice student cannot join a class session');
  eq((await api({ action: 'control', code, set: 'start' })).body.session.state, 'running', 'Start session');
  let fs1 = (await api({ action: 'faculty_state', code })).body;
  F.prompts(fs1, F.questions);
  ok(F.controls(fs1.session, false).includes('Open the statements now'), 'The session bar opens the statements');
  await api({ action: 'control', code, set: 'advance' });
  eq(await phaseOf(code), 'wall', 'Statements open');
  eq((await sAct(code, 'ana', { action: 'statements', statements: stmt('marketplaces') })).status, 200, 'Ana writes her statements');
  await sAct(code, 'ben', { action: 'statements', statements: stmt('buyers') });
  await sAct(code, 'cal', { action: 'statements', statements: stmt('software') });
  fs1 = (await api({ action: 'faculty_state', code })).body; F.prompts(fs1, F.questions);
  ok(F.controls(fs1.session, false).includes('Open the fund now'), 'The session bar opens the fund');
  await api({ action: 'control', code, set: 'advance' });
  eq((await sAct(code, 'ana', { action: 'allocate', allocation: fund({ RA: 1000000 }) })).status, 200, 'Ana places her fund');
  eq((await sAct(code, 'ben', { action: 'allocate', allocation: fund({ RA: 600000, cash: 400000 }) })).status, 200, 'Ben places his');
  fs1 = (await api({ action: 'faculty_state', code })).body; F.prompts(fs1, F.questions);
  eq(fs1.runs['individual:platform:ana'].band, 'followed', 'A placed fund gets its band at once');
  ok(F.controls(fs1.session, false).includes('Close the fund now'), 'The session bar closes the fund');
  eq((await api({ action: 'control', code, set: 'close_fund' })).status, 200, 'Close the fund with one still unplaced');
  fs1 = (await api({ action: 'faculty_state', code })).body; F.prompts(fs1, F.questions);
  eq(['ana', 'ben', 'cal'].map(x => fs1.runs['individual:platform:' + x].band), ['followed', 'against', 'unplaced'], 'Bands: followed, against, unplaced');
  eq([fs1.kit.bands.followed.cls, fs1.kit.bands.against.cls, fs1.kit.bands.cash.cls], ['b', 'v', 'n'], 'Neutral tones');
  ok(F.noPause(fs1.session), 'No Pause while history waits');
  for (const year of ['2002', '2004', '2010']) {
    fs1 = (await api({ action: 'faculty_state', code })).body; F.prompts(fs1, F.questions);
    ok(F.controls(fs1.session, false).includes('Release ' + year), `Session bar: Release ${year}`);
    const before = (await sAct(code, 'ana', { action: 'state' })).body.view;
    ok(!JSON.stringify(before).includes(year === '2010' ? 'FreeMarkets' : '\u0000'), 'No names before 2010');
    await api({ action: 'control', code, set: 'release' });
  }
  const view = (await sAct(code, 'ana', { action: 'state' })).body.view;
  eq([view.stages.length, view.afterReveal.length, view.review.open], [3, 4, true], 'After 2010: three stages, four questions, the review');
  const fin = await call(finish, { code, participantId: 'platform:ana' }, st.ana);
  eq(fin.body.reported, true, 'The 2010 stage reports to the platform');
  const r1 = reports.at(-1);
  eq([r1.sub, r1.metrics.revision, r1.summary.sessionCode, r1.summary.band, r1.summary.bandTone, r1.runId], ['ana', 1, code, 'followed', 'b', `${code}:platform:ana`], 'Revision 1 names the session and band');
  eq((await sAct(code, 'ana', { action: 'review', reflection1: 'Buyers kept it.', reflection2: 'AI in accounting.' })).body.view.review.sent, true, 'The review saves');
  eq([reports.at(-1).metrics.revision, reports.at(-1).summary.reflection1], [2, 'Buyers kept it.'], 'Revision 2 carries the review');
  const fs2 = (await api({ action: 'faculty_state', code })).body;

  F.prompts(fs2, F.questions);
  eq(F.questions[0].prompt, K.REVIEW_QUESTIONS[0], 'Review questions from the server');
  const TEAMS = global.FacultyWorkspace.recordsFrom(fs2, F);
  const m = D.model(F.debrief.input(TEAMS, { state: fs2 }));
  eq([m.ready, m.slides.map(s => s.key)], [true, ['money', 'pair', 'history', 'statements', 'said', 'lessons']], 'Six slides');
  ok(m.slides[0].headline.startsWith('$2M placed'), 'D0: the money placed');
  eq(m.slides[1].body.cards.length, 2, 'D1: concentrated beside spread');
  ok(D.bodyHTML(m.slides[2], { pick: {}, hidden: {} }).includes('<small>'), 'D2: the names once every stage is out');
  ok(m.slides[3].headline.startsWith('One student put the money against'), 'D3: against its own destination');
  eq(m.slides[4].body.cards.map(c => c.name), ['Ana'], 'D4: what students said');
  ok(m.slides[5].body.items.length === 4 && m.slides[5].body.items.every(x => x.evidence), 'D5: four lessons with evidence');
  const early = D.model(F.debrief.input(TEAMS, { state: { ...fs2, kit: { ...fs2.kit, released: 1 } } }));
  ok(!/FreeMarkets|Ariba|Commerce One/.test(D.bodyHTML(early.slides[2], { pick: {}, hidden: {} })), 'D2 never runs ahead of the class');

  const pre = reports.length;
  eq((await api({ action: 'control', code, set: 'close' })).body.session.state, 'closed', 'Close');
  eq(reports.length - pre, 3, 'Close reports every student who joined');
  eq((await api({ action: 'control', code, set: 'reopen' })).body.session.state, 'running', 'Reopen');
  await api({ action: 'control', code, set: 'close' });
  eq((await api({ action: 'hide_session', code })).status, 200, 'Hide');
  eq((await api({ action: 'course_sessions' })).body.sessions, [], 'A hidden session leaves the list');

  // Teams: the first press decides; no lead.
  const t = (await api({ action: 'create', name: 'Teams', mode: 'team' })).body.session.code;
  for (const x of ['ana', 'ben', 'cal', 'dee']) await api({ action: 'join', code: t }, st[x]);
  eq((await api({ action: 'group', code: t, assign: { 'platform:ana': 'Team 1', 'platform:ben': 'Team 1', 'platform:cal': 'Team 2', 'platform:dee': 'Team 2' } })).status, 200, 'Split');
  eq((await api({ action: 'group', code: t, assign: { 'platform:dee': 'team:team-1' } })).status, 200, 'Move a student by team id');
  eq((await api({ action: 'set_captain', code: t, participantId: 'platform:ana' })).status, 200, 'No team lead is needed');
  eq((await api({ action: 'rename_team', code: t, groupId: 'team:team-1', teamLabel: 'North' })).status, 200, 'Faculty rename a team');
  eq((await api({ action: 'control', code: t, set: 'start' })).body.session.state, 'running', 'Start the team session');
  await api({ action: 'control', code: t, set: 'advance' });
  eq((await sAct(t, 'ana', { action: 'statements', statements: stmt('software') })).status, 200, 'Ana writes for North');
  eq((await sAct(t, 'ben', { action: 'statements', statements: stmt('buyers') })).body.error, 'statements_locked', 'The first press decides');
  const ts = (await api({ action: 'faculty_state', code: t })).body;
  eq([Object.keys(ts.runs).sort(), ts.runs['team:team-1'].teamLabel, ts.runs['team:team-1'].statementsBy], [['team:team-1', 'team:team-2'], 'North', 'Ana'], 'One run per team, with who wrote it');
  await api({ action: 'control', code: t, set: 'close' });

  // Rehearse: one practice student; the clock starts on joining; they move it along.
  const ps = await api({ action: 'practice_start', students: [{ sub: 'practice-fac-ana', name: 'Practice Ana' }] });
  eq([ps.status, ps.body.students[0].status], [200, 'Ready to start'], 'Rehearse opens one practice student, ready to start');
  const pa = token({ sub: 'practice-fac-ana', name: 'Practice Ana' }), pid = 'platform:practice-fac-ana', pc = ps.body.code;
  const pAct = b => api({ ...b, code: pc, participantId: pid }, pa);
  eq((await api({ action: 'course_session' }, pa)).body.code, pc, 'The practice student finds the practice run');
  eq((await api({ action: 'join', code: pc }, pa)).status, 200, 'The practice student joins');
  eq((await api({ action: 'join', code: pc }, st.ben)).status, 403, 'A real student cannot join practice');
  eq((await pAct({ action: 'state' })).body.view.canAdvance, true, 'The clock starts on joining; the briefing moves on');
  await pAct({ action: 'advance' });
  await pAct({ action: 'statements', statements: stmt('nobody') });
  await pAct({ action: 'advance' });
  await pAct({ action: 'allocate', allocation: fund({ cash: 1000000 }) });
  for (let i = 0; i < 3; i++) await pAct({ action: 'advance' });
  const pv = (await pAct({ action: 'state' })).body.view;
  ok(pv.closing && pv.review.open, 'The practice student reaches 2010 and the review');
  eq((await api({ action: 'practice_status' })).body.complete, true, 'Rehearse complete');
  const before = reports.length;
  eq((await call(finish, { code: pc, participantId: pid }, pa)).body.reason, 'practice', 'Practice never reports');
  await pAct({ action: 'review', reflection1: 'a', reflection2: 'b' });
  eq(reports.length, before, 'Not even the review');
  eq((await api({ action: 'faculty_state', code: pc })).body.runs['individual:' + pid].band, 'cash', 'See the faculty view of the practice run');
  ok((await api({ action: 'faculty_state', code: pc })).body.session.practice && F.controls((await api({ action: 'faculty_state', code: pc })).body.session, false), 'The practice run opens on the faculty pages');
  eq((await api({ action: 'course_sessions' })).body.sessions.some(s => s.code === pc), false, 'Practice stays out of the Sessions page');
  eq((await api({ action: 'practice_finish' })).status, 200, 'End practice');
  eq(K.REVIEW_QUESTIONS[1], C.DEBRIEF.turn, 'The closing question is the second review question');
  console.log(`PASS kit-session-check: ${n} assertions`);
})().catch(e => { console.error(e); process.exit(1); });
