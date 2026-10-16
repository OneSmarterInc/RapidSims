#!/usr/bin/env node
'use strict';
require('../../tools/security/report-fixture.cjs');
// Infrastructure or Bubble? on the shared faculty pages: one open session per class, the class link, one or two
// companies chosen before Start, the session bar's next step, bands from the calls, the reveal from the bar,
// the questions and review after the last outcome, completions with the session and band, close, reopen, hide,
// teams split by faculty with a shared answer and no lead, Rehearse, and the class debrief. Real handlers;
// in-memory store.
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
process.env.LAUNCH_SECRET = 'kit-test-secret-not-real';
process.env.PLATFORM_URL = 'https://platform.test';
delete process.env.ACCESS_CODE; delete process.env.DEV_OPEN;
const config = require('../data/config');
const { memoryStore } = require('../lib/store');
const { createApp } = require('../lib/app');
const K = require('../lib/kit');
require('../../platform/public/kit/faculty-workspace.js');
const F = require('../public/bubble-faculty.js');
const D = require('../public/bubble-debrief.js');

let clockMs = 1_800_000_000_000;
const MIN = 60000;
const reports = [];
const realFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  const b = JSON.parse(options.body || '{}');
  if (String(url).endsWith('/api/complete')) reports.push(JSON.parse(Buffer.from(b.token.split('.')[0], 'base64url').toString('utf8')));
  if (String(url).endsWith('/api/session-enrolments')) return { ok: true, status: 200, json: async () => ({ students: ['ana', 'ben', 'cal', 'dee'].map(x => ({ participantId: `platform:${x}`, name: x[0].toUpperCase() + x.slice(1), accessReleased: true })) }) };
  if (String(url).startsWith('https://platform.test')) return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  return realFetch(url, options);
};
const store = memoryStore();
const app = createApp({ store, clock: () => clockMs });
async function call(method, path, body, headers = {}) {
  let status = 200, text = '';
  const req = { method, url: path, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), body: body || {} };
  const res = { writeHead(s) { status = s; }, end(t) { text = t || ''; } };
  await app(req, res);
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status, body: parsed };
}
const token = ({ sub, name = sub, role = 'student', mode = 'play', course = 'crs_A' }) => {
  const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: config.simId, mode, course, iat: clockMs, exp: clockMs + 36e5 })).toString('base64url');
  return body + '.' + createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url');
};
const fac = token({ sub: 'fac', name: 'Vikram', role: 'faculty', mode: 'session' });
const api = (b, lt = fac) => call('POST', '/api/session', b, { 'x-launch-token': lt });
const st = Object.fromEntries(['ana', 'ben', 'cal', 'dee'].map(x => [x, token({ sub: x, name: x[0].toUpperCase() + x.slice(1) })]));
const as = (who, extra = {}) => ({ 'x-launch-token': st[who], 'x-pid': `platform:${who}`, ...extra });
const answer = (call2, line, why, mind) => ({ call: call2, line, lineWhy: why, mind });
const MIND = 'I would need to see like-for-like revenue growing faster than capital spending for two quarters in a row, with cash steady.';
let n = 0; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; }; const ok = (v, m) => { assert.ok(v, m); n++; };
const fstate = async (code) => { const d = (await api({ action: 'faculty_state', code })).body; F.prompts(d, F.questions); return d; };
const bar = async (code) => { const d = await fstate(code); return F.controls(d.session, false); };

(async () => {
  eq((await api({ action: 'create', name: 'Thu' })).status, 400, 'No mode, no session');
  const made = await api({ action: 'create', name: 'Thu 9:00', mode: 'individual' });
  eq([made.status, made.body.session.state, made.body.session.cases], [200, 'lobby', ['A', 'B']], 'Faculty create a session; two companies by default');
  ok(!made.body.session.hostKey, 'No host key leaves the server');
  const code = made.body.session.code;
  eq((await api({ action: 'create', name: 'Again', mode: 'team' })).body.error, 'other_session_open', 'A second session asks first');
  eq((await api({ action: 'course_sessions' })).body.sessions.map(s => s.code), [code], 'The Sessions page lists it');
  eq((await api({ action: 'course_session' }, st.ana)).body.code, code, 'The class link finds the open session');
  for (const x of ['ana', 'ben', 'cal']) eq((await call('POST', '/api/join', { code }, as(x))).status, 200, `${x} joins signed in`);
  eq((await call('POST', '/api/join', { code }, { 'x-launch-token': token({ sub: 'practice-fac-zed' }) })).status, 403, 'A practice student cannot join a class session');

  let fs1 = await fstate(code);
  ok(/aria-pressed="true"\s*>Two companies/.test(F.lobbyControls(fs1.session, false)), 'Before Start: two companies chosen');
  eq((await api({ action: 'control', code, set: 'cases_one' })).body.session.cases, ['A'], 'One company');
  eq((await api({ action: 'control', code, set: 'cases_two' })).body.session.clock, { ...config.clock['2-individual'], read: 10 }, 'Two companies; reading is Longer by default (#51)');
  ok(/aria-pressed="true"\s*>Longer · 10 min/.test(F.lobbyControls((await fstate(code)).session, false)), 'Before Start: the reading time, Longer chosen');
  eq((await api({ action: 'control', code, set: 'read_longest' })).body.session.clock.read, 15, 'Longest: 15 minutes per company');
  eq((await api({ action: 'control', code, set: 'read_standard' })).body.session.clock, config.clock['2-individual'], 'Standard keeps the original clock');
  await api({ action: 'control', code, set: 'read_longer' });
  eq((await api({ action: 'control', code, set: 'start' })).body.session.state, 'running', 'Start session');
  eq((await api({ action: 'control', code, set: 'cases_one' })).status, 409, 'The number of companies is fixed once started');
  ok(F.noPause === true, 'No Pause: one clock for every student');
  ok((await bar(code)).includes('Open the calls now'), 'Session bar: Open the calls now');
  const end0 = (await call('GET', `/api/state?code=${code}`, null, as('ana'))).body.endsAt;
  ok((await bar(code)).includes('Add 2 minutes'), 'Session bar: Add 2 minutes while reading');
  await api({ action: 'control', code, set: 'add_time' });
  eq((await call('GET', `/api/state?code=${code}`, null, as('ana'))).body.endsAt - end0, 2 * MIN, 'Every student gets two more minutes');
  await api({ action: 'control', code, set: 'advance' });
  eq((await call('GET', `/api/state?code=${code}`, null, as('ana'))).body.phase, 'verdict', 'The calls are open');
  await call('POST', '/api/verdict', { code, caseId: 'A', fields: answer('bubble', 'hl.adj_ebitda', 'The company measure is cash in advance.', MIND) }, as('ana'));
  await call('POST', '/api/verdict', { code, caseId: 'A', fields: answer('infra', 'hl.adj_ebitda', 'Profit measure is positive and growing.', MIND) }, as('ben'));
  fs1 = await fstate(code);
  eq(fs1.runs['individual:platform:ana'].calls.A.closed, false, 'Saved calls show as work in progress');
  eq(fs1.runs['individual:platform:ana'].band, null, 'No band before the clock runs out');
  ok((await bar(code)).includes('Close the calls now'), 'Session bar: Close the calls now');
  ok(!(await bar(code)).includes('Add 2 minutes'), 'Add 2 minutes is for reading only');
  eq((await api({ action: 'control', code, set: 'add_time' })).status, 409, 'Reading has ended');
  await api({ action: 'control', code, set: 'advance' });
  fs1 = await fstate(code);
  eq(['ana', 'ben', 'cal'].map(x => fs1.runs['individual:platform:' + x].band), ['bubble', 'infra', 'none'], 'Bands after company 1: Bubble, Infrastructure, No call');
  eq([fs1.kit.bands.infra.cls, fs1.kit.bands.bubble.cls, fs1.kit.bands.mixed.cls, fs1.kit.bands.none.cls], ['b', 'v', 'y', 'n'], 'Neutral tones');
  ok(!JSON.stringify(fs1.kit.byCase.A.reveal || '').length || fs1.kit.byCase.A.reveal === null, 'Nothing revealed yet');
  const labels = [];
  for (let i = 0; i < 3; i++) { const b = await bar(code); labels.push(b.match(/data-session-control="reveal"[^>]*>([^<]+)/)[1]); await api({ action: 'control', code, set: 'reveal' }); }
  eq(labels, ['Show the company', 'Show the next four quarters', 'Show what happened'], 'The reveal from the session bar, one part at a time');
  eq((await call('GET', `/api/state?code=${code}`, null, as('ana'))).body.reveal.stage, 3, 'Students see each part');
  eq(reports.length, 0, 'Company 2 still to play: nothing reported');
  ok((await bar(code)).includes('Start company 2'), 'Session bar: Start company 2');
  await api({ action: 'control', code, set: 'start_b' });
  eq((await call('GET', `/api/state?code=${code}`, null, as('ana'))).body.caseId, 'B', 'Company 2 is in play');
  await api({ action: 'control', code, set: 'advance' });
  await call('POST', '/api/verdict', { code, caseId: 'B', fields: answer('bubble', 'bs.cash', 'Cash is falling fast.', MIND) }, as('ana'));
  await call('POST', '/api/verdict', { code, caseId: 'B', fields: answer('bubble', 'bs.cash', 'Debt is larger than cash.', MIND) }, as('ben'));
  await api({ action: 'control', code, set: 'advance' });
  fs1 = await fstate(code);
  eq(['ana', 'ben', 'cal'].map(x => fs1.runs['individual:platform:' + x].band), ['bubble', 'mixed', 'none'], 'Two companies: Mixed when the calls differ');
  for (let i = 0; i < 2; i++) await api({ action: 'control', code, set: 'reveal' });
  const pre = (await call('GET', `/api/state?code=${code}`, null, as('ana'))).body;
  ok(!pre.afterReveal && !pre.review, 'No review before the last outcome');
  await api({ action: 'control', code, set: 'reveal' });
  eq(reports.length, 3, 'The last outcome reports every student who joined');
  const r1 = reports.find(r => r.sub === 'ben');
  eq([r1.metrics.revision, r1.summary.sessionCode, r1.summary.band, r1.summary.bandTone, r1.runId], [1, code, 'mixed', 'y', `${code}:platform:ben`], 'Revision 1 names the session and band');
  ok(!JSON.stringify(r1).includes(fs1.kit.byCase.A.reveal ? fs1.kit.byCase.A.reveal.identity.name : 'zzz'), 'The completion names companies by number only');
  const view = (await call('GET', `/api/state?code=${code}`, null, as('ana'))).body;
  eq([view.afterReveal.length, view.review.open, view.review.questions], [4, true, K.REVIEW_QUESTIONS], 'After the last outcome: four questions and the review');
  eq((await api({ action: 'review', code, reflection1: 'It did, the cash fell.', reflection2: 'Capital spending first.' }, st.ana)).status, 200, 'The review saves');
  eq([reports.at(-1).metrics.revision, reports.at(-1).summary.reflection1], [2, 'It did, the cash fell.'], 'Revision 2 carries the review');
  const fs2 = await fstate(code);
  eq(F.questions[0].prompt, K.REVIEW_QUESTIONS[0], 'Review questions from the server');
  const notes = F.advanced(fs2.session, fs2, { esc: x => String(x) });
  ok(notes.includes('Company 1: instructor notes') && notes.includes('Company 2: instructor notes') && notes.includes(fs2.kit.byCase.A.turn), 'Instructor notes for each company (#52)');
  ok(F.practiceRunsItself === true, 'A practice run moves itself along (#53)');
  ok(F.controls(fs2.session, false).includes('Live screen') && !F.controls(fs2.session, false).includes('data-session-control'), 'At the end: the Live screen only');

  // The class debrief.
  const TEAMS = global.FacultyWorkspace.recordsFrom(fs2, F);
  const m = D.model(F.debrief.input(TEAMS, { state: fs2 }));
  eq([m.ready, m.slides.map(s => s.key)], [true, ['calls', 'pairs', 'lines', 'reveal-A', 'reveal-B', 'said', 'lessons']], 'Seven slides with two companies');
  eq(m.slides[0].headline, 'Company 1: one infrastructure, one bubble. Company 2: two bubble calls.', 'D0: only the calls made (#58)');
  eq(m.slides[0].evidence, '1 of 3 students called the two companies differently.', 'D0: counted as calls that differ (#60)');
  const solo = D.model({ kit: fs2.kit, teams: [{ name: 'Pat', band: 'mixed', calls: { A: { status: 'recorded', closed: true, call: 'infra', line: 'hl.cash_revenue', lineLabel: 'Cash revenue', lineWhy: 'w', mind: 'm' }, B: { status: 'recorded', closed: true, call: 'bubble', line: 'bs.cash', lineLabel: 'Cash', lineWhy: 'w', mind: 'm' } } }] });
  eq([solo.slides[1].headline, solo.slides[1].body.pairs.map(p => p.cards.length)], ['No pair this time. One answer for each call.', [1, 1]], 'D1: with no pair, one answer for each call (#59)');
  eq(m.slides[1].body.pairs[0].cards.map(c => c.name), ['Ben', 'Ana'], 'D1: the same line with opposite calls');
  ok(m.slides[2].headline.startsWith('Everyone called company 2 a bubble'), 'D2: the case for the other call when the class agreed');
  ok(m.slides[2].body.views[1].minority.length > 40, 'D2: the written case from the notes');
  ok(m.slides[3].headline.endsWith(`${fs2.kit.byCase.A.reveal.identity.name.replace(/\.$/, "")}.`) && D.bodyHTML(m.slides[3], { hidden: {} }).includes('<table'), 'D3: the reveal, as far as students have seen it');
  eq(m.slides[5].body.cards.map(c => c.name), ['Ana'], 'D4: what students said');
  ok(m.slides[6].body.items.length === 4 && m.slides[6].body.items.every(x => x.evidence), 'D5: four lessons with evidence');
  eq(m.slides[6].body.items[0].evidence, '2 of 3 students cited one of the company\'s own measures.', 'D5: company measures, in this class');
  const early = D.model(F.debrief.input(TEAMS, { state: { ...fs2, kit: { ...fs2.kit, byCase: { ...fs2.kit.byCase, A: { ...fs2.kit.byCase.A, stage: 0, reveal: null } } } } }));
  ok(!D.bodyHTML(early.slides[3], { hidden: {} }).includes(fs2.kit.byCase.A.reveal.identity.name) && !early.slides[3].headline.includes(fs2.kit.byCase.A.reveal.identity.name), 'D3 never runs ahead of the class');

  const before = reports.length;
  eq((await api({ action: 'control', code, set: 'close' })).body.session.state, 'closed', 'Close');
  eq(reports.length - before, 3, 'Close reports every student who joined');
  eq((await api({ action: 'control', code, set: 'reopen' })).body.session.state, 'running', 'Reopen');
  await api({ action: 'control', code, set: 'close' });
  eq((await api({ action: 'hide_session', code })).status, 200, 'Hide');
  eq((await api({ action: 'course_sessions' })).body.sessions, [], 'A hidden session leaves the list');

  // Teams: faculty split; each member's private call; one shared answer; any member commits it.
  const t = (await api({ action: 'create', name: 'Teams', mode: 'team' })).body.session.code;
  eq((await api({ action: 'faculty_enrolments', code: t })).body.students.length, 4, 'The class roster arrives for the split');
  for (const x of ['ana', 'ben', 'cal']) await call('POST', '/api/join', { code: t }, as(x));
  eq((await call('GET', `/api/state?code=${t}`, null, as('ana'))).body.teamLabel, '', 'No team before the split');
  eq((await api({ action: 'control', code: t, set: 'start' })).body.error, 'participants_required', 'Teams first');
  eq((await api({ action: 'group', code: t, assign: { 'platform:ana': 'Team 1', 'platform:ben': 'Team 1', 'platform:cal': 'Team 2', 'platform:dee': 'Team 2' } })).status, 200, 'Split');
  eq((await api({ action: 'group', code: t, assign: { 'platform:dee': 'team:team-1' } })).status, 200, 'Move a student by team id');
  eq((await api({ action: 'set_captain', code: t, participantId: 'platform:ana' })).status, 200, 'No team lead is needed');
  eq((await api({ action: 'rename_team', code: t, groupId: 'team:team-1', teamLabel: 'North' })).status, 200, 'Faculty rename a team');
  await api({ action: 'control', code: t, set: 'cases_one' });
  eq((await api({ action: 'control', code: t, set: 'start' })).body.session.state, 'running', 'Start the team session');
  eq((await api({ action: 'group', code: t, assign: { 'platform:cal': 'Team 1' } })).body.error, 'teams_locked', 'Teams are fixed once started');
  eq((await call('POST', '/api/join', { code: t }, { 'x-launch-token': token({ sub: 'eve' }) })).status, 409, 'A newcomer cannot join a started team session');
  eq((await call('GET', `/api/state?code=${t}`, null, as('ana'))).body.teamLabel, 'North', 'Students see their team name');
  ok((await bar(t)).includes('Open the private calls now'), 'Session bar: Open the private calls now');
  await api({ action: 'control', code: t, set: 'advance' });
  await call('POST', '/api/private', { code: t, caseId: 'A', call: 'infra' }, as('ana'));
  await call('POST', '/api/private', { code: t, caseId: 'A', call: 'bubble' }, as('ben'));
  ok((await bar(t)).includes('Open the team call now'), 'Session bar: Open the team call now');
  await api({ action: 'control', code: t, set: 'advance' });
  const fields = answer('bubble', 'recon.deferred_cash', 'Cash paid in advance is most of it.', MIND);
  eq((await call('POST', '/api/team/draft', { code: t, caseId: 'A', fields }, as('ben'))).status, 200, 'Ben drafts for North');
  eq((await call('POST', '/api/team/commit', { code: t, caseId: 'A', expected: fields }, as('ana'))).status, 200, 'Ana commits for North: no lead');
  eq((await call('POST', '/api/team/commit', { code: t, caseId: 'A', expected: fields }, as('ben'))).status, 409, 'One commit per team');
  ok((await bar(t)).includes('Close the team calls now'), 'Session bar: Close the team calls now');
  await api({ action: 'control', code: t, set: 'advance' });
  const ts = await fstate(t);
  eq([Object.keys(ts.runs).sort(), ts.runs['team:team-1'].teamLabel, ts.runs['team:team-1'].band, ts.runs['team:team-2'].band], [['team:team-1', 'team:team-2'], 'North', 'bubble', 'none'], 'One run per team, with its band');
  eq(ts.runs['team:team-1'].privates.A.map(p => p.name + ':' + p.call), ['Ana:infra', 'Ben:bubble'], 'Each member\'s private call');
  await api({ action: 'control', code: t, set: 'close' });

  // Rehearse: one practice student; the clock starts when they open it; they move it along.
  const ps = await api({ action: 'practice_start', students: [{ sub: 'practice-fac-ana', name: 'Practice Ana' }] });
  eq([ps.status, ps.body.students[0].status], [200, 'Ready to start'], 'Rehearse opens one practice student, ready to start');
  const pa = token({ sub: 'practice-fac-ana', name: 'Practice Ana' }), pid = 'platform:practice-fac-ana', pc = ps.body.code;
  const me = { 'x-launch-token': pa, 'x-pid': pid };
  eq((await api({ action: 'course_session' }, pa)).body.code, pc, 'The practice student finds the practice run');
  eq((await call('GET', `/api/session?code=${pc}`, null, { 'x-launch-token': pa })).body.pid, pid, 'The practice student opens the run');
  eq((await api({ action: 'practice_status' })).body.students[0].status, 'Ready to start', 'The clock waits for the play page (#50)');
  eq((await call('GET', `/api/state?code=${pc}`, null, me)).body.phase, 'read', 'The play page starts the clock');
  eq((await call('GET', `/api/session?code=${pc}`, null, { 'x-launch-token': st.ben })).status, 403, 'A real student cannot open practice');
  eq((await api({ action: 'practice_status' })).body.students[0].status, 'Reading: company 1', 'Rehearse shows the part in play');
  let pv0 = (await call('GET', `/api/state?code=${pc}`, null, me)).body;
  eq(pv0.nextPart, 'I’m ready to make my call', 'A practice student can end the reading early (#48)');
  eq((await call('POST', '/api/solo/advance', { code: pc, caseId: 'A', phase: 'read' }, me)).status, 200, 'Ready to make the call');
  pv0 = (await call('GET', `/api/state?code=${pc}`, null, me)).body;
  eq([pv0.phase, pv0.nextPart], ['verdict', 'Lock my call'], 'The call opens at once');
  await call('POST', '/api/verdict', { code: pc, caseId: 'A', fields: answer('bubble', 'bs.cash', 'Cash is falling fast.', MIND) }, me);
  eq((await call('POST', '/api/solo/advance', { code: pc, caseId: 'A', phase: 'verdict' }, me)).status, 200, 'Lock my call');
  eq((await call('GET', `/api/state?code=${pc}`, null, me)).body.result.call, 'bubble', 'The locked call is recorded');
  eq((await call('POST', '/api/solo/advance', { code: pc, caseId: 'A', phase: 'verdict' }, me)).status, 409, 'A repeated press does nothing');
  for (let stage = 0; stage < 4; stage++) await call('POST', '/api/solo/advance', { code: pc, caseId: 'A', stage }, me);
  for (const cs of ['B']) {
    clockMs += 10 * MIN;
    await call('POST', '/api/verdict', { code: pc, caseId: cs, fields: answer('infra', 'bs.cash', 'Cash covers the build.', MIND) }, me);
    clockMs += 4 * MIN;
    for (let stage = 0; stage < 3; stage++) eq((await call('POST', '/api/solo/advance', { code: pc, caseId: cs, stage }, me)).status, 200, `Practice: next part (${cs} ${stage})`);
  }
  const pv = (await call('GET', `/api/state?code=${pc}`, null, me)).body;
  ok(pv.afterReveal && pv.review.open, 'The practice student reaches the review');
  eq((await api({ action: 'practice_status' })).body.complete, true, 'Rehearse complete');
  const prev = reports.length;
  await api({ action: 'review', code: pc, reflection1: 'a', reflection2: 'b' }, pa);
  eq(reports.length, prev, 'Practice never reports');
  eq((await api({ action: 'faculty_state', code: pc })).body.runs['individual:' + pid].band, 'mixed', 'See the faculty view of the practice run');
  eq((await api({ action: 'course_sessions' })).body.sessions.some(s => s.code === pc), false, 'Practice stays out of the Sessions page');
  eq((await api({ action: 'practice_finish' })).status, 200, 'Finish Rehearse');
  eq((await api({ action: 'practice_status' })).body.code, null, 'The practice run is gone');

  // Another faculty member cannot open this class's session.
  eq((await api({ action: 'faculty_state', code: t }, token({ sub: 'other', role: 'faculty', mode: 'session' }))).status, 403, 'Only the owner opens a session');
  console.log(`PASS kit-session-check: ${n} assertions`);
})().catch(e => { console.error('FAIL kit-session-check:', e.message); process.exit(1); });
