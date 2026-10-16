#!/usr/bin/env node
'use strict';
require('../../tools/security/report-fixture.cjs');
// Who Pays for the Wire? on the shared faculty pages: one open session per class, the class link, tables split by
// faculty and seated at Start, the walkthrough gate with Start anyway, the session bar's phases, staff notices,
// bands from the signed groups, completions at the deadline and with the review, close, reopen, hide, Rehearse
// with four practice students, and the class debrief. Real handlers; in-memory store.
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
process.env.LAUNCH_SECRET = 'wire-kit-secret-not-real';
process.env.PLATFORM_URL = 'https://platform.test';
delete process.env.ACCESS_CODE; delete process.env.FACULTY_CODES;
const { store } = require('../lib/store');
const C = require('../data/config');
const { seatBriefs } = require('../data/content');
let clock = 1_800_000_000_000; Date.now = () => clock; const advance = m => { clock += m * 60000; };
const db = new Map();
Object.assign(store, {
  configured: () => true,
  get: async k => db.has(k) && db.get(k) ? JSON.parse(db.get(k)) : null,
  getMany: async ks => ks.map(k => db.has(k) && db.get(k) ? JSON.parse(db.get(k)) : null),
  cas: async (k, prev, next) => {
    const cur = db.has(k) ? db.get(k) : '';
    if (cur !== (prev == null ? '' : JSON.stringify(prev))) return false;
    db.set(k, next == null ? '' : JSON.stringify(next)); return true;
  },
});
const NAMES = ['ana', 'ben', 'cal', 'dee', 'eve', 'fay', 'gus', 'hal'];
const reports = [];
global.fetch = async (url, options = {}) => {
  const b = JSON.parse(options.body || '{}');
  if (String(url).endsWith('/api/complete')) reports.push(JSON.parse(Buffer.from(b.token.split('.')[0], 'base64url').toString('utf8')));
  if (String(url).endsWith('/api/session-enrolments')) return { ok: true, status: 200, json: async () => ({ students: NAMES.map(x => ({ participantId: `platform:${x}`, name: x[0].toUpperCase() + x.slice(1), accessReleased: true })) }) };
  return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
};
const session = require('../api/session');
const K = require('../lib/kit');
require('../../platform/public/kit/faculty-workspace.js');
const F = require('../public/wire-faculty.js');
const D = require('../public/wire-debrief.js');

const token = ({ sub, name = sub, role = 'student', mode = 'play', course = 'crs_A' }) => {
  const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: C.id, mode, course, iat: clock, exp: clock + 36e5 })).toString('base64url');
  return body + '.' + createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url');
};
async function call(b, lt, extra = {}) {
  const res = { statusCode: 200, payload: null, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(v) { this.payload = v; return this; } };
  await session({ method: 'POST', headers: { ...(lt ? { 'x-launch-token': lt } : {}), ...extra }, body: b }, res);
  return { status: res.statusCode, body: res.payload };
}
const fac = token({ sub: 'fac', name: 'Vikram', role: 'faculty', mode: 'session' });
const api = (b, lt = fac) => call(b, lt);
const st = Object.fromEntries(NAMES.map(x => [x, token({ sub: x, name: x[0].toUpperCase() + x.slice(1) })]));
let n = 0; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; }; const ok = (v, m) => { assert.ok(v, m); n++; };
const fstate = async code => { const d = (await api({ action: 'faculty_state', code })).body; F.prompts(d, F.questions); return d; };
const bar = async code => { const d = await fstate(code); return F.controls(d.session, false); };
const people = {};
const join = async (code, x, lt = st[x]) => { const r = await call({ action: 'join', code }, lt); if (r.status === 200) people[x] = { ...r.body, lt }; return r; };
const act = (code, x, b) => call({ code, participantId: people[x].participantId, ...b }, people[x].lt, { 'x-participant-key': people[x].participantKey });

(async () => {
  eq((await api({ action: 'create', mode: 'individual' })).status, 400, 'Teams only');
  const made = await api({ action: 'create', name: 'Fri 9:00', mode: 'team' });
  eq([made.status, made.body.session.state, made.body.session.mode], [200, 'lobby', 'team'], 'Faculty create a team session');
  const code = made.body.session.code;
  ok(!made.body.session.seed, 'The seating seed stays on the server');
  eq((await api({ action: 'create', mode: 'team' })).body.error, 'other_session_open', 'A second session asks first');
  eq((await api({ action: 'course_sessions' })).body.sessions.map(s => s.code), [code], 'The Sessions page lists it');
  eq((await api({ action: 'course_session' }, st.ana)).body.code, code, 'The class link finds the open session');
  eq((await call({ action: 'create', mode: 'team' }, null, { 'x-faculty-code': 'anything' })).status, 401, 'Facilitator codes open nothing');
  eq((await api({ action: 'faculty_enrolments', code })).body.students.length, 8, 'The class roster arrives for the split');
  for (const x of NAMES.slice(0, 7)) eq((await join(code, x)).status, 200, `${x} joins from the class link`);
  eq((await call({ action: 'join', code }, token({ sub: 'practice-fac-zed' }))).status, 403, 'A practice student cannot join a class session');
  eq((await api({ action: 'control', code, set: 'start' })).body.error, 'participants_required', 'Tables first');
  eq((await api({ action: 'group', code, assign: { 'platform:ana': 'Table 1', 'platform:ben': 'Table 1', 'platform:cal': 'Table 1', 'platform:dee': 'Table 2', 'platform:eve': 'Table 2', 'platform:fay': 'Table 2', 'platform:gus': 'Table 2' } })).status, 200, 'Split');
  eq((await api({ action: 'control', code, set: 'start' })).body.error, 'table_too_small', 'Each table needs four');
  await api({ action: 'group', code, assign: { 'platform:hal': 'team:table-1' } });
  eq((await api({ action: 'rename_team', code, groupId: 'team:table-1', teamLabel: 'North' })).status, 200, 'Faculty rename a table');
  for (const x of ['ana', 'ben', 'cal', 'dee', 'eve', 'fay']) for (let step = 1; step <= 4; step++) await act(code, x, { action: 'walkthrough', step });
  const lobby = (await fstate(code)).session;
  eq(lobby.walkthroughPending, ['Gus'], 'Faculty see who is still reading');
  ok(F.lobbyControls(lobby, false).includes('Start anyway (1 still reading)'), 'Before Start: Start anyway names the count');
  eq((await api({ action: 'control', code, set: 'start' })).body.error, 'walkthrough_incomplete', 'Start waits for the walkthrough');
  eq((await api({ action: 'control', code, set: 'start_anyway' })).body.session.phase, 'briefing', 'Start anyway: the briefing clock runs');
  eq((await api({ action: 'group', code, assign: { 'platform:ana': 'Table 2' } })).body.error, 'teams_locked', 'Tables are fixed once started');
  eq((await call({ action: 'join', code }, token({ sub: 'zed' }))).status, 409, 'A newcomer cannot join a started session');
  eq((await join(code, 'hal')).status, 200, 'An imported student at a table can still open it');
  const views = {};
  for (const x of NAMES) views[x] = (await act(code, x, { action: 'view' })).body;
  eq([...new Set(['ana', 'ben', 'cal', 'hal'].map(x => views[x].seat))].length, 4, 'North: four different seats');
  eq(views.gus.walkthrough, undefined, 'A student still reading goes straight to the brief');
  for (const x of NAMES) for (const [seat, b] of Object.entries(seatBriefs)) ok(JSON.stringify(views[x]).includes(b.floor) === (seat === views[x].seat), 'Each student sees only their own floor');
  ok((await bar(code)).includes('Start opening statements'), 'Session bar: Start opening statements');
  await api({ action: 'control', code, set: 'openings' });
  ok((await bar(code)).includes('Open negotiation'), 'Session bar: Open negotiation');
  await api({ action: 'control', code, set: 'negotiation' });
  const b1 = await bar(code);
  ok(b1.includes('Add 10 minutes') && b1.includes('Close the sheet now'), 'Session bar: Add 10 minutes and Close the sheet now');
  ok(F.noPause === true, 'No Pause');
  const seatOf = (tbl, seat) => NAMES.find(x => views[x].table === tbl && views[x].seat === seat);
  const north = views.ana.table, south = views.dee.table;
  const T1 = { top: 75, term: 14, exit: 0, coll: 0, threshold: 50 };
  for (const [d, v] of Object.entries(T1)) await act(code, seatOf(north, 'utility'), { action: 'move', dial: d, value: v });
  for (const seat of ['utility', 'developer', 'manufacturers', 'advocate']) for (const d of Object.keys(T1)) await act(code, seatOf(north, seat), { action: 'sign', dial: d });
  await act(code, seatOf(south, 'manufacturers'), { action: 'move', dial: 'threshold', value: 60 });
  for (const seat of ['utility', 'developer', 'manufacturers', 'advocate']) await act(code, seatOf(south, seat), { action: 'sign', dial: 'threshold' });
  const fs1 = await fstate(code);
  ok(F.advanced(fs1.session, fs1, { esc: x => String(x) }).includes(`notice__${south}__closest`), 'Staff notices for each table during negotiation');
  eq((await api({ action: 'control', code, set: `notice__${south}__closest` })).status, 200, 'Send a staff notice');
  eq((await act(code, 'dee', { action: 'view' })).body.notices.length, 1, 'The notice reaches that table');
  eq((await api({ action: 'control', code, set: 'extend' })).body.session.extended, true, 'Add 10 minutes');
  ok(!(await bar(code)).includes('Add 10 minutes'), 'Once only');
  eq(reports.length, 0, 'Nothing reported before the deadline');
  eq((await api({ action: 'control', code, set: 'close_sheet' })).body.session.phase, 'closed', 'Close the sheet now');
  eq(reports.length, 8, 'The deadline reports every student who opened the sim');
  const r1 = reports.find(r => r.sub === 'ana');
  eq([r1.metrics.revision, r1.summary.sessionCode, r1.summary.band, r1.summary.bandTone, r1.runId], [1, code, 'both', 'b', `${code}:team:table-1`], 'Revision 1 names the session and band');
  eq(reports.find(r => r.sub === 'dee').summary.band, 'threshold', 'Table 2: threshold settled');
  const fs2 = await fstate(code);
  eq([fs2.runs['team:table-1'].band, fs2.runs['team:table-2'].band], ['both', 'threshold'], 'Bands on Results');
  eq([fs2.kit.bands.both.cls, fs2.kit.bands.money.cls, fs2.kit.bands.threshold.cls, fs2.kit.bands.commission.cls], ['b', 'v', 'y', 'n'], 'Neutral tones');
  ok(!F.controls(fs2.session, false).includes('data-session-control'), 'After the deadline: the Live screen only');
  const view = (await act(code, 'ana', { action: 'view' })).body;
  eq([view.afterReveal.length, view.review.open, view.review.questions], [4, true, K.REVIEW_QUESTIONS], 'After the deadline: four questions and the review');
  eq((await act(code, 'ana', { action: 'review', reflection1: 'I gave on term to get the threshold.', reflection2: 'We would have stopped at three seats.' })).body.review.sent, true, 'The review saves');
  eq([reports.at(-1).metrics.revision, reports.at(-1).summary.reflection1], [2, 'I gave on term to get the threshold.'], 'Revision 2 carries the review');

  const fs3 = await fstate(code);
  eq(F.questions[0].prompt, K.REVIEW_QUESTIONS[0], 'Review questions from the server');
  const TEAMS = global.FacultyWorkspace.recordsFrom(fs3, F);
  const m = D.model(F.debrief.input(TEAMS, { state: fs3 }));
  eq([m.ready, m.slides.map(s => s.key)], [true, ['settled', 'pair', 'forward', 'deadline', 'reveal', 'said', 'lessons']], 'Seven slides');
  eq(m.slides[0].headline, 'One of two tables signed every term.', 'D0: how each table settled');
  eq(m.slides[1].body.cards.map(c => c.name), ['North', 'Table 2'], 'D1: the most settled beside the least');
  ok(m.slides[2].body.tables[0].misses.advocate.length > 20, 'D2: played forward');
  ok(/The Commission set 4 terms/.test(m.slides[3].headline), 'D3: what the deadline did');
  ok(D.bodyHTML(m.slides[4], { hidden: {} }).includes('Ohio'), 'D4: the real proceeding');
  eq(m.slides[5].body.cards.length, 1, 'D5: what students said');
  ok(m.slides[6].body.items.length === 4 && m.slides[6].body.items.every(x => x.evidence), 'D6: four lessons with evidence');
  ok(F.advanced(fs3.session, fs3, { esc: x => String(x) }).includes('Sources'), 'Instructor notes carry the full account and sources');

  const pre = reports.length;
  eq((await api({ action: 'control', code, set: 'close' })).body.session.state, 'closed', 'Close');
  eq(reports.length - pre, 8, 'Close reports every student again');
  eq((await api({ action: 'control', code, set: 'reopen' })).body.session.state, 'running', 'Reopen');
  await api({ action: 'control', code, set: 'close' });
  eq((await api({ action: 'hide_session', code })).status, 200, 'Hide');
  eq((await api({ action: 'course_sessions' })).body.sessions, [], 'A hidden session leaves the list');
  eq((await api({ action: 'faculty_state', code }, token({ sub: 'other', role: 'faculty', mode: 'session' }))).status, 403, 'Only the owner opens a session');

  // Rehearse: four practice students at one table, one per seat.
  const four = ['ana', 'ben', 'cal', 'dee'].map(x => ({ sub: `practice-fac-${x}`, name: 'Practice ' + x[0].toUpperCase() + x.slice(1) }));
  eq((await api({ action: 'practice_start', students: four.slice(0, 3) })).status, 400, 'Rehearse needs four');
  const ps = await api({ action: 'practice_start', students: four });
  eq([ps.status, ps.body.students.length], [200, 4], 'Rehearse opens four practice students');
  const pc = ps.body.code;
  eq((await api({ action: 'course_session' }, token({ sub: four[0].sub }))).body.code, pc, 'A practice student finds the practice run');
  for (const x of four) eq((await join(pc, x.sub, token({ sub: x.sub, name: x.name }))).status, 200, `${x.name} opens it`);
  eq((await call({ action: 'join', code: pc }, st.eve)).status, 403, 'A real student cannot join practice');
  eq((await api({ action: 'control', code: pc, set: 'start_anyway' })).body.session.phase, 'briefing', 'Faculty start the practice table');
  const pseats = [];
  for (const x of four) pseats.push((await act(pc, x.sub, { action: 'view' })).body.seat);
  eq(pseats.slice().sort(), ['advocate', 'developer', 'manufacturers', 'utility'], 'One practice student per seat');
  await api({ action: 'control', code: pc, set: 'openings' }); await api({ action: 'control', code: pc, set: 'negotiation' });
  const prev = reports.length;
  await api({ action: 'control', code: pc, set: 'close_sheet' });
  eq((await api({ action: 'practice_status' })).body.complete, true, 'Rehearse complete');
  await act(pc, four[0].sub, { action: 'review', reflection1: 'a', reflection2: 'b' });
  eq(reports.length, prev, 'Practice never reports');
  eq((await api({ action: 'course_sessions' })).body.sessions.some(s => s.code === pc), false, 'Practice stays out of the Sessions page');
  eq((await api({ action: 'practice_finish' })).status, 200, 'Finish Rehearse');
  eq((await api({ action: 'practice_status' })).body.code, null, 'The practice run is gone');
  console.log(`PASS kit-session-check: ${n} assertions`);
})().catch(e => { console.error('FAIL kit-session-check:', e.stack); process.exit(1); });
