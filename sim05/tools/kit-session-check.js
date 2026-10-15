#!/usr/bin/env node
require('../../tools/security/report-fixture.cjs');
// Would You Approve This? on the shared faculty pages: one open session per class, the class link,
// the shared clock moved from the session bar, endings as bands, the questions and review at the
// ending, completions with the session and band, close, reopen, hide, teams without a lead,
// Rehearse, and the class debrief. Real handlers; in-memory store with compare-and-set.
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const store = require('../lib/store.js');
const C = require('../config/content.js');

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
  clearPracticeSession: async (course, o) => practice.delete(course + '|' + o), wipe: async c => { sessions.delete(c); people.delete(c); }
});
const session = require('../api/session.js');
const finish = require('../api/finish.js');
const K = require('../lib/kit.js');
require('../../platform/public/kit/faculty-workspace.js');
const F = require('../public/approve-faculty.js');
const D = require('../public/approve-debrief.js');

const token = ({ sub, name = sub, role = 'student', mode = 'play', course = 'crs_A' }) => {
  const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: C.META.id, mode, course, iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64url');
  return body + '.' + createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url');
};
async function call(handler, body, lt) {
  const res = { statusCode: 200, payload: null, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(v) { this.payload = v; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: lt ? { 'x-launch-token': lt } : {}, body }, res);
  return { status: res.statusCode, body: res.payload };
}
const fac = token({ sub: 'fac', name: 'Vikram', role: 'faculty', mode: 'session' }), other = token({ sub: 'other', role: 'faculty', mode: 'session' });
const api = (b, lt = fac) => call(session, b, lt);
let n = 0; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const st = Object.fromEntries(['ana', 'ben', 'cal', 'dee'].map(x => [x, token({ sub: x, name: x[0].toUpperCase() + x.slice(1) })]));

// Plays every round: the faculty member opens each round, each student votes as planned.
async function playAll(code, plan) {
  for (let r = 1; r <= 5; r++) {
    let c = (await api({ action: 'faculty_state', code })).body.session.clock;
    while (c.phase !== 'decide') { await api({ action: 'control', code, set: 'advance' }); c = (await api({ action: 'faculty_state', code })).body.session.clock; }
    for (const [who, votes] of Object.entries(plan)) if (votes[r - 1]) await api({ action: 'vote', code, participantId: `platform:${who}`, round: r, decision: votes[r - 1] }, st[who]);
    c = (await api({ action: 'faculty_state', code })).body.session.clock;
    if (c.phase === 'decide') await api({ action: 'control', code, set: 'advance' });
  }
  await api({ action: 'control', code, set: 'advance' });
}

(async () => {
  // One open session per class; the Sessions page lists it.
  eq((await api({ action: 'create', name: 'Thu' })).status, 400, 'No mode, no session');
  const made = await api({ action: 'create', name: 'Thu 9:00', mode: 'individual' });
  eq([made.status, made.body.session.state], [200, 'lobby'], 'Faculty create a session');
  const code = made.body.session.code;
  eq((await api({ action: 'create', name: 'Again', mode: 'team' })).body.error, 'other_session_open', 'A second session asks first');
  eq((await api({ action: 'course_sessions' })).body.sessions.map(s => s.code), [code], 'The Sessions page lists it');
  eq((await api({ action: 'course_sessions' }, other)).body.sessions, [], 'Another faculty member sees none');

  // Students from the class link.
  eq((await api({ action: 'course_session' }, st.ana)).body.code, code, 'The class link finds the open session');
  for (const x of ['ana', 'ben', 'cal']) eq((await api({ action: 'join', code }, st[x])).status, 200, `${x} joins signed in`);
  eq((await api({ action: 'join', code }, token({ sub: 'practice-fac-zed' }))).status, 403, 'A practice student cannot join a class session');
  eq((await api({ action: 'control', code, set: 'start' })).body.session.state, 'running', 'Start session');

  // The shared clock moves from the session bar; the ending gives bands.
  await playAll(code, { ana: ['approve', 'approve', 'approve', 'approve', 'approve'], ben: ['approve', 'approve', 'decline', 'approve', 'decline'], cal: ['decline', 'decline', 'decline', 'decline', 'decline'] });
  const fs = (await api({ action: 'faculty_state', code })).body;
  eq(fs.kit.ended, true, 'The ending is reached');
  eq(Object.values(fs.runs).map(r => [r.teamLabel, r.done, r.band]).sort(), [['Ana', true, 'e1'], ['Ben', true, fs.runs['individual:platform:ben'].band], ['Cal', true, 'e6']], 'Each student has an ending band');
  eq(fs.kit.bands.e1.label, C.ENDINGS[0].label, 'Band names are the endings, from the server');
  eq(fs.kit.bands.e1.cls, 'l', 'The furthest ending is red');
  eq(Object.keys(fs.projector).includes('live'), true, 'The Round screen still gets its projector view');

  // Questions and review at the ending; completions.
  const view = (await api({ action: 'state', code, participantId: 'platform:ana' }, st.ana)).body.view;
  eq([view.afterEnding.length, view.review.open, view.review.sent], [4, true, false], 'Four questions and the review follow the ending');
  const fin = await call(finish, { code, participantId: 'platform:ana' }, st.ana);
  eq(fin.body.reported, true, 'The ending reports to the platform');
  const r1 = reports.at(-1);
  eq([r1.sub, r1.metrics.revision, r1.summary.sessionCode, r1.summary.band, r1.runId], ['ana', 1, code, 'e1', `${code}:platform:ana`], 'Revision 1 names the session and band');
  eq((await api({ action: 'review', code, participantId: 'platform:ana', reflection1: 'Sleep.', reflection2: 'My phone carrier. Where I sleep.' }, st.ana)).body.view.review.sent, true, 'The review saves');
  eq([reports.at(-1).metrics.revision, reports.at(-1).summary.reflection1, reports.at(-1).runId], [2, 'Sleep.', `${code}:platform:ana`], 'Revision 2 carries the review');
  eq((await api({ action: 'review', code, participantId: 'platform:ben', reflection1: 'One' }, st.ben)).status, 400, 'Both answers are needed');
  const fs2 = (await api({ action: 'faculty_state', code })).body;
  eq(fs2.runs['individual:platform:ana'].reflection1, 'Sleep.', 'The review is on the run');

  // The class debrief.
  const TEAMS = global.FacultyWorkspace.recordsFrom(fs2, F);
  const m = D.model(F.debrief.input(TEAMS, { state: fs2 }));
  eq([m.ready, m.slides.map(s => s.key)], [true, ['glance', 'split', 'rounds', 'terms', 'said', 'lessons']], 'Six slides');
  eq(m.slides[0].body.tiles.flatMap(t => t.names).sort(), ['Ana', 'Ben', 'Cal'], 'D0: every student under an ending');
  eq(m.slides[2].body.rounds.length, 5, 'D2: five rounds');
  eq(m.slides[4].body.cards.map(c => c.name), ['Ana'], 'D4: what students said');
  eq(m.lessons.length, 4, 'Four lessons');
  eq(JSON.stringify(D.model({ ...F.debrief.input(TEAMS, { state: fs2 }), anonymous: true })).includes('Ana'), false, 'Anonymous slides carry no names');
  eq(D.model({ kit: { ...fs2.kit, ended: false }, teams: [] }).ready, false, 'The debrief waits for the ending');

  // Close, reopen, hide.
  const pre = reports.length;
  eq((await api({ action: 'control', code, set: 'close' })).body.session.state, 'closed', 'Close');
  eq(reports.length - pre, 3, 'Close reports every finished student');
  eq((await api({ action: 'course_session' }, st.ana)).body.code, null, 'A closed session takes no students');
  eq((await api({ action: 'control', code, set: 'reopen' })).body.session.state, 'running', 'Reopen');
  eq((await api({ action: 'course_session' }, st.ana)).body.code, code, 'A reopened session takes students again');
  await api({ action: 'control', code, set: 'close' });
  eq((await api({ action: 'hide_session', code })).status, 200, 'Hide');
  eq((await api({ action: 'course_sessions' })).body.sessions, [], 'A hidden session leaves the list');

  // Teams: no lead to choose; the Teams tab moves students by team id.
  const t = (await api({ action: 'create', name: 'Teams', mode: 'team' })).body.session.code;
  for (const x of ['ana', 'ben', 'cal', 'dee']) await api({ action: 'join', code: t }, st[x]);
  eq((await api({ action: 'group', code: t, assign: { 'platform:ana': 'Team 1', 'platform:ben': 'Team 1', 'platform:cal': 'Team 2', 'platform:dee': 'Team 2' } })).status, 200, 'Auto split');
  eq((await api({ action: 'group', code: t, assign: { 'platform:dee': 'team:team-1' } })).status, 200, 'Move a student by team id');
  eq((await api({ action: 'faculty_state', code: t })).body.participants['platform:dee'].groupId, 'team:team-1', 'The move lands in the existing team');
  eq((await api({ action: 'set_captain', code: t, participantId: 'platform:ana' })).status, 200, 'No team lead is needed');
  eq((await api({ action: 'rename_team', code: t, groupId: 'team:team-1', teamLabel: 'North' })).status, 200, 'Faculty rename a team');
  eq((await api({ action: 'control', code: t, set: 'start' })).body.session.state, 'running', 'Start the team session');
  const ts = (await api({ action: 'faculty_state', code: t })).body;
  eq(Object.keys(ts.runs).sort(), ['team:team-1', 'team:team-2'], 'One run per team');
  eq(ts.runs['team:team-1'].teamLabel, 'North', 'The team keeps its name');
  await api({ action: 'control', code: t, set: 'close' });

  // Rehearse: one practice student on a private run, outside the class's sessions.
  const ps = await api({ action: 'practice_start', students: [{ sub: 'practice-fac-ana', name: 'Practice Ana' }] });
  eq([ps.status, ps.body.students.length], [200, 1], 'Rehearse opens one practice student');
  const pa = token({ sub: 'practice-fac-ana', name: 'Practice Ana' });
  eq((await api({ action: 'course_session' }, pa)).body.code, ps.body.code, 'The practice student finds the practice run');
  eq((await api({ action: 'join', code: ps.body.code }, pa)).status, 200, 'The practice student joins');
  eq((await api({ action: 'join', code: ps.body.code }, st.ben)).status, 403, 'A real student cannot join practice');
  eq((await api({ action: 'solo_start', code: ps.body.code, participantId: 'platform:practice-fac-ana' }, pa)).status, 200, 'The practice student starts their own clock');
  eq((await api({ action: 'faculty_state', code: ps.body.code })).status, 200, 'See the faculty view of the practice run');
  eq((await api({ action: 'practice_status' })).body.students[0].name, 'Practice Ana', 'Rehearse shows the practice student');
  eq((await api({ action: 'course_sessions' })).body.sessions.some(s => s.code === ps.body.code), false, 'Practice stays out of the Sessions page');
  eq((await api({ action: 'practice_finish' })).status, 200, 'End practice');
  eq(K.REVIEW_QUESTIONS[1], C.DEBRIEF.turn, 'The closing question is now the second review question');
  const one = D.model({ kit: { ...fs2.kit, aggregate: { ...fs2.kit.aggregate, mostDivided: null } }, teams: F.debrief.input(TEAMS, { state: fs2 }).teams });
  eq([one.slides[1].headline, one.slides[1].ask], ['No round divided the class.', 'Who hesitated longest, and at which round?'], 'With no split, slide 2 says so once and asks about hesitation');
  // The Lighter setting never names the inference: not on the faculty pages, not on the Round screen.
  const light = (await api({ action: 'create', name: 'Light', mode: 'individual', intensity: 'lighter', closeOpen: true })).body.session.code;
  await api({ action: 'join', code: light }, st.ana);
  await api({ action: 'control', code: light, set: 'start' });
  await playAll(light, { ana: ['approve', 'approve', 'approve', 'approve', 'approve'] });
  eq(/pregnan/i.test(JSON.stringify((await api({ action: 'faculty_state', code: light })).body)), false, 'A Lighter session never names the inference on the faculty pages');
  eq(/pregnan/i.test(JSON.stringify((await api({ action: 'state', code: light, participantId: 'platform:ana' }, st.ana)).body)), false, 'Nor on the student page');
  console.log(`PASS kit-session-check: ${n} assertions`);
})().catch(e => { console.error(e); process.exit(1); });
