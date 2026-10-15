#!/usr/bin/env node
require('../../tools/security/report-fixture.cjs');
// Would You Have Bought It? on the shared faculty pages: one open session per class, the class list, the class
// link, decisions as neutral bands, close decisions and release each stage from the session bar, the questions
// and review after 2010, completions with the session and band, close, reopen, hide, teams where the majority
// decides, Rehearse, and the class debrief. Real handlers; the in-memory store.
process.env.W07_MEMORY_STORE = '1';
process.env.LAUNCH_SECRET = 'kit-test-secret-not-real';
process.env.PLATFORM_URL = 'https://platform.test';
delete process.env.ACCESS_CODE;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const store = require('../lib/store.js');
const { META, REVEAL, FORBIDDEN_PRE_REVEAL } = require('../data/config.js');

let clockMs = 1_800_000_000_000;
Date.now = () => clockMs;
const reports = [];
const ROSTER = ['ana', 'ben', 'cal', 'dee'];
global.fetch = async (url, options) => {
  const b = JSON.parse(options.body || '{}');
  if (String(url).endsWith('/api/complete')) reports.push(JSON.parse(Buffer.from(b.token.split('.')[0], 'base64url').toString('utf8')));
  if (String(url).endsWith('/api/session-enrolments')) return { ok: true, status: 200, json: async () => ({ students: ROSTER.map(x => ({ participantId: `platform:${x}`, name: x[0].toUpperCase() + x.slice(1), accessReleased: true })) }) };
  return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
};
const session = require('../api/session.js');
const finish = require('../api/finish.js');
const K = require('../lib/kit.js');
require('../../platform/public/kit/faculty-workspace.js');
const F = require('../public/bought-faculty.js');
const D = require('../public/bought-debrief.js');

const token = ({ sub, name = sub, role = 'student', mode = 'play', course = 'crs_A' }) => {
  const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: META.id, mode, course, iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64url');
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
const st = Object.fromEntries(ROSTER.map(x => [x, token({ sub: x, name: x[0].toUpperCase() + x.slice(1) })]));
const stu = (who, b) => call(session, { participantId: `platform:${who}`, ...b }, st[who]);
const why = 'Fifty million is a small price for a business we do not know how to build ourselves.';
const no = 'They lost thirty million last year and nobody would buy their shares in July.';

(async () => {
  // ---- Individual session from the shared Sessions page
  eq((await api({ action: 'create' })).body.error, 'play_mode_required', 'no default mode');
  const first = (await api({ action: 'create', mode: 'individual', name: 'Warm-up' })).body.session;
  ok(first.joinUrl && first.joinUrl.includes('session=' + first.code), 'class join link');
  clockMs += 60_000;
  eq((await api({ action: 'create', mode: 'individual', name: 'Main' })).body.error, 'other_session_open', 'one open session per class');
  const code = (await api({ action: 'create', mode: 'individual', name: 'Main', closeOpen: true })).body.session.code;
  eq((await store.getSession(first.code)).state, 'closed', 'starting a new one closes the open one');
  eq((await api({ action: 'faculty_state', code }, other)).status, 403, 'another instructor cannot read it');

  eq((await api({ action: 'faculty_enrolments', code })).body.students.length, 4, 'class list arrives');
  let fs1 = (await api({ action: 'faculty_state', code })).body;
  eq(Object.keys(fs1.runs).length, 4, 'one run per student from the class list');
  eq(Object.values(fs1.runs).filter(r => r.joined).length, 0, 'nobody has opened it yet');

  eq((await call(session, { action: 'course_session' }, st.ana)).body.code, code, 'class link finds the session');
  for (const who of ['ana', 'ben', 'cal']) eq((await stu(who, { action: 'join', code })).status, 200, `${who} joins`);
  eq((await api({ action: 'control', code, set: 'start' })).body.session.state, 'running', 'start');
  ok(F.noPause && F.noLead, 'settings: no pause, no lead');
  ok(F.controls({ code, phase: 'deciding', stage: 0 }, false).includes('data-session-control="end_decisions"'), 'session bar: Close decisions now');

  eq((await stu('ana', { action: 'decide', code, choice: 'buy', justification: why })).body.me.choice, 'buy', 'Ana buys');
  await stu('ben', { action: 'decide', code, choice: 'decline', justification: no });
  await stu('ana', { action: 'recognise', code, answer: 'no' });
  await stu('ben', { action: 'recognise', code, answer: 'yes' });
  const view = (await stu('ana', { action: 'state', code })).body;
  ok(!JSON.stringify(view).match(/Blockbuster|Netflix/) && !view.afterReveal, 'no names or questions before the stages');
  fs1 = (await api({ action: 'faculty_state', code })).body;
  eq([fs1.runs['individual:platform:ana'].band, fs1.runs['individual:platform:ben'].band, fs1.runs['individual:platform:cal'].band], ['bought', 'declined', null], 'bands as each decision is made');
  eq(K.BANDS.bought.cls + K.BANDS.declined.cls + K.BANDS.lapsed.cls, 'bvn', 'neutral tones: no verdict');

  // ---- Close decisions, release each stage from the session bar
  eq((await api({ action: 'control', code, set: 'next_stage' })).body.error, 'decisions_still_open', 'stages wait for the close');
  await api({ action: 'control', code, set: 'end_decisions' });
  clockMs += 21_000;
  fs1 = (await api({ action: 'faculty_state', code })).body;
  eq([fs1.session.phase, fs1.session.stage, fs1.runs['individual:platform:cal'].band], ['decided', 0, 'lapsed'], 'Cal lapsed at the close');
  eq(fs1.runs['individual:platform:dee'].done, false, 'a student who never opened it has no band');
  ok(F.controls(fs1.session, false).includes('Release 2002'), 'session bar: Release 2002');
  ok(fs1.kit.ended && fs1.kit.stages.length === 3, 'ended, with the stages for the debrief');
  for (const year of ['2002', '2005', '2010']) {
    const s = (await api({ action: 'faculty_state', code })).body.session;
    ok(F.controls(s, false).includes('Release ' + year), `session bar offers ${year}`);
    await api({ action: 'control', code, set: 'next_stage' });
  }
  fs1 = (await api({ action: 'faculty_state', code })).body;
  eq(fs1.session.stage, 3, 'all three stages released');
  ok(!F.controls(fs1.session, false).includes('Release'), 'nothing left to release');

  // ---- After 2010: questions, review, completions
  const after = (await stu('ana', { action: 'state', code })).body;
  eq([after.stage, after.afterReveal.length, after.review.open], [3, 4, true], 'four questions and the review after 2010');
  ok(JSON.stringify(after.stages).includes('Netflix'), 'names at the 2010 stage');
  reports.length = 0;
  const fin = await call(finish, { sessionCode: code, participantId: 'platform:ana' }, st.ana);
  eq([fin.body.reported, reports.length], [true, 1], 'revision 1 at 2010');
  const r1 = reports[0];
  eq([r1.summary.band, r1.summary.bandLabel, r1.summary.bandTone, r1.summary.sessionCode, r1.summary.sessionName, r1.metrics.revision], ['bought', 'Bought', 'b', code, 'Main', 1], 'band and session in the completion');
  eq(r1.runId, `${code}:platform:ana`, 'one run per student per session');
  eq((await stu('ana', { action: 'review', code, reflection1: 'x', reflection2: '' })).body.error, 'answers_required', 'both answers needed');
  const sent = await stu('ana', { action: 'review', code, reflection1: 'The price against our revenue.', reflection2: 'Choosing a major.' });
  eq([sent.body.review.sent, reports.length, reports[1].metrics.revision, reports[1].summary.reflection1], [true, 2, 2, 'The price against our revenue.'], 'revision 2 with the review');

  // ---- Close, the Sessions list, reopen, hide
  reports.length = 0;
  await api({ action: 'control', code, set: 'close' });
  eq(reports.map(r => r.summary.band).sort(), ['bought', 'declined', 'lapsed'], 'close reports everyone who played; Dee never opened it');
  eq(await store.getCourseSession('crs_A'), null, 'the class link no longer lands here');
  let list = (await api({ action: 'course_sessions' })).body.sessions;
  eq(list.map(x => x.code), [code, first.code], 'Sessions page, newest first');
  eq([list[0].students, list[0].submitted, list[0].state], [3, 3, 'closed'], 'counts on the Sessions page');
  eq((await api({ action: 'hide_session', code: first.code })).body.ok, true, 'hide a closed session');
  eq((await api({ action: 'course_sessions' })).body.sessions.map(x => x.code), [code], 'hidden session leaves the list');
  eq((await api({ action: 'control', code, set: 'reopen' })).body.session.state, 'running', 'reopen');
  eq(await store.getCourseSession('crs_A'), code, 'the class link lands here again');

  // ---- The class debrief
  const state = (await api({ action: 'faculty_state', code })).body;
  F.prompts(state, F.questions);
  eq(F.questions[1].prompt, K.REVIEW_QUESTIONS[1], 'review questions from the server');
  const teams = Object.values(state.runs).map(r => ({ id: r.runId, name: r.teamLabel, joined: r.joined, individual: true, people: [{ id: r.runnerId, name: r.teamLabel }], ...F.record(r) }));
  const m = D.model(F.debrief.input(teams, { state }));
  eq(m.slides.map(s => s.key), ['glance', 'pair', 'stages', 'recognition', 'said', 'lessons'], 'D0 to D5');
  eq(m.slides[0].headline, 'One bought. One declined. One let the offer lapse.', 'D0 counts');
  const pairHtml = D.bodyHTML(m.slides[1], { pick: {}, hidden: {} });
  ok(pairHtml.includes(why) && pairHtml.includes(no) && pairHtml.includes('data-md-pick="bought"'), 'D1 pairs a bought and a declined reason');
  ok(D.bodyHTML(m.slides[2], { pick: {}, hidden: {} }).includes('Netflix'), 'D2 carries the names, from the server');
  ok(m.slides[3].headline.startsWith('One said'), 'D3 recognition');
  eq(m.slides[4].body.cards.length, 1, 'D4 the review');
  ok(m.slides[5].body.items.length === 4 && m.slides[5].body.items.every(x => x.evidence), 'D5 four lessons with class evidence');
  await api({ action: 'control', code, set: 'close' });

  // ---- Team session: majority decides, a tie declines
  const team = (await api({ action: 'create', mode: 'team', name: 'Teams', closeOpen: true })).body.session.code;
  await api({ action: 'faculty_enrolments', code: team });
  eq((await api({ action: 'group', code: team, assign: { 'platform:ana': 'Red', 'platform:ben': 'Red', 'platform:cal': 'Blue', 'platform:dee': 'Blue' } })).body.ok, true, 'teams formed');
  let tf = (await api({ action: 'faculty_state', code: team })).body;
  eq((await api({ action: 'rename_team', code: team, groupId: 'team:red', teamLabel: 'Crimson' })).body.ok, true, 'rename');
  eq((await api({ action: 'set_captain', code: team, participantId: 'platform:ana' })).body.ok, true, 'no lead to choose');
  for (const who of ROSTER) await stu(who, { action: 'join', code: team });
  tf = (await api({ action: 'faculty_state', code: team })).body;
  eq(tf.participants['platform:ben'].teamLabel, 'Crimson', 'Ben is on Crimson');
  await api({ action: 'control', code: team, set: 'start' });
  eq((await api({ action: 'group', code: team, assign: { 'platform:cal': 'team:red' } })).body.error, 'teams_locked', 'teams fixed after the start');
  await stu('ana', { action: 'decide', code: team, choice: 'buy', justification: why });
  await stu('ben', { action: 'decide', code: team, choice: 'buy', justification: why });
  await stu('cal', { action: 'decide', code: team, choice: 'buy', justification: why });
  await stu('dee', { action: 'decide', code: team, choice: 'decline', justification: no });
  await api({ action: 'control', code: team, set: 'end_decisions' });
  clockMs += 21_000;
  tf = (await api({ action: 'faculty_state', code: team })).body;
  eq([tf.runs['team:red'].band, tf.runs['team:blue'].band, tf.runs['team:blue'].votes], ['bought', 'declined', { buy: 1, decline: 1 }], 'majority decides; a tie declines');

  // ---- Rehearse: one practice student; the stages follow on their own
  const pSub = 'practice-fac-1', pTok = token({ sub: pSub, name: 'Practice student' }), pid = 'platform:' + pSub;
  const pr = (await api({ action: 'practice_start', students: [{ sub: pSub, name: 'Practice student' }] })).body;
  ok(pr.code, 'practice run created');
  eq((await call(session, { action: 'course_session' }, pTok)).body.code, pr.code, 'the practice link finds the practice run');
  eq((await call(session, { action: 'join', code: pr.code }, pTok)).status, 200, 'practice student joins');
  eq((await call(session, { action: 'join', code: team }, pTok)).body.error, 'practice_only', 'a practice student stays out of class sessions');
  eq((await call(session, { action: 'join', code: pr.code }, st.ana)).body.error, 'private_session', 'a class student stays out of the practice run');
  eq((await call(session, { action: 'solo_start', code: pr.code, participantId: pid }, pTok)).body.session.state, 'running', 'the practice student starts the clock');
  await call(session, { action: 'decide', code: pr.code, participantId: pid, choice: 'decline', justification: no }, pTok);
  await call(session, { action: 'recognise', code: pr.code, participantId: pid, answer: 'unsure' }, pTok);
  eq((await api({ action: 'practice_status' })).body.students[0].status, 'Waiting for the first stage', 'status after the decision');
  await api({ action: 'faculty_state', code: pr.code });
  clockMs += 3 * 46_000;
  const pv = (await call(session, { action: 'state', code: pr.code, participantId: pid }, pTok)).body;
  eq(pv.stage, 3, 'the stages advance on their own, even with the faculty view open');
  reports.length = 0;
  eq((await call(finish, { sessionCode: pr.code, participantId: pid }, pTok)).body.reason, 'practice', 'practice never reports');
  await call(session, { action: 'review', code: pr.code, participantId: pid, reflection1: 'a', reflection2: 'b' }, pTok);
  eq(reports.length, 0, 'not even the review');
  const ps = (await api({ action: 'practice_status' })).body;
  eq([ps.complete, ps.students[0].status], [true, 'Sent the review'], 'Rehearse complete');
  eq((await api({ action: 'faculty_state', code: pr.code })).body.runs['individual:' + pid].band, 'declined', 'the instructor can open the practice run');
  ok(!(await api({ action: 'course_sessions' })).body.sessions.some(x => x.code === pr.code), 'practice stays off the Sessions page');
  await api({ action: 'practice_finish' });
  eq(await store.getSession(pr.code), null, 'practice finish clears the run');

  // ---- Nothing public names the outcome
  for (const f of ['instructor.html', 'bought-faculty.js', 'bought-debrief.js']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    ok(!FORBIDDEN_PRE_REVEAL.some(w => text.toLowerCase().includes(w.toLowerCase())) && !REVEAL.stages.some(s => s.body.some(p => text.includes(p))), `${f} carries no spoiler`);
  }
  console.log(`sim07 kit session check: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
