#!/usr/bin/env node
require('../../tools/security/report-fixture.cjs');
// Do We Switch? on the shared faculty pages: one open session per class, the class list, the class link,
// the shared clock with no pause, decisions as bands, the questions and review after the reveal, completions
// with the session and band, close, reopen, hide, teams where the first press decides, Rehearse, and the
// class debrief. Real handlers; in-memory store with compare-and-set.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const store = require('../lib/store.js');
const cfg = require('../data/config.js');

process.env.LAUNCH_SECRET = 'kit-test-secret-not-real';
process.env.PLATFORM_URL = 'https://platform.test';
delete process.env.ACCESS_CODE;
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

const sessions = new Map(), people = new Map(), runs = new Map(), lists = new Map(), pointers = new Map(), practice = new Map();
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const field = (map, c) => { if (!map.has(c)) map.set(c, {}); return map.get(c); };
Object.assign(store, {
  configured: () => true,
  putSession: async (c, v) => { sessions.set(c, structuredClone(v)); return v; },
  getSession: async c => structuredClone(sessions.get(c) || null),
  compareAndSetSession: async (c, prev, next) => { if (!same(sessions.get(c), prev)) return false; sessions.set(c, structuredClone(next)); return true; },
  getParticipants: async c => structuredClone(people.get(c) || {}),
  getParticipant: async (c, id) => structuredClone((people.get(c) || {})[id] || null),
  compareAndSetParticipant: async (c, id, prev, next) => { if (!sessions.has(c)) return false; const m = field(people, c); if (!same(m[id], prev)) return false; m[id] = structuredClone(next); return true; },
  getRun: async (c, id) => structuredClone((runs.get(c) || {})[id] || null),
  getRuns: async c => structuredClone(runs.get(c) || {}),
  compareAndSetRun: async (c, id, prev, next) => { if (!sessions.has(c)) return false; const m = field(runs, c); if (!same(m[id], prev)) return false; m[id] = structuredClone(next); return true; },
  setCourseSession: async (course, c) => pointers.set(course, c), getCourseSession: async course => pointers.get(course) || null,
  clearCourseSession: async (course, c) => { if (pointers.get(course) === c) pointers.delete(course); },
  addCourseSession: async (course, c, at) => { const m = lists.get(course) || new Map(); m.set(c, at); lists.set(course, m); },
  listCourseSessions: async course => [...(lists.get(course) || new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
  setPracticeSession: async (course, o, c) => practice.set(course + '|' + o, c), getPracticeSession: async (course, o) => practice.get(course + '|' + o) || null,
  clearPracticeSession: async (course, o) => practice.delete(course + '|' + o),
  wipe: async c => { sessions.delete(c); people.delete(c); runs.delete(c); }
});
const session = require('../api/session.js');
session._now = () => clockMs;
const K = require('../lib/kit.js');
const E = require('../lib/engine.js');
require('../../platform/public/kit/faculty-workspace.js');
const F = require('../public/switch-faculty.js');
const D = require('../public/switch-debrief.js');

const token = ({ sub, name = sub, role = 'student', mode = 'play', course = 'crs_A' }) => {
  const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: cfg.sim.id, mode, course, iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64url');
  return body + '.' + createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url');
};
async function call(body, lt) {
  const res = { statusCode: 200, payload: null, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(v) { this.payload = v; return this; }, end() { return this; } };
  await session({ method: 'POST', headers: lt ? { 'x-launch-token': lt } : {}, body }, res);
  return { status: res.statusCode, body: res.payload };
}
const fac = token({ sub: 'fac', name: 'Vikram', role: 'faculty', mode: 'session' }), other = token({ sub: 'other', role: 'faculty', mode: 'session' });
const api = (b, lt = fac) => call(b, lt);
let n = 0; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; }; const ok = (v, m) => { assert.ok(v, m); n++; };
const st = Object.fromEntries(ROSTER.map(x => [x, token({ sub: x, name: x[0].toUpperCase() + x.slice(1) })]));
const atReport = k => cfg.reports[k - 1].atSeconds * 1000 + 1000;
const stu = (who, b) => call({ participantId: `platform:${who}`, ...b }, st[who]);

(async () => {
  // ---- Individual session from the shared Sessions page
  eq((await api({ action: 'create' })).body.error, 'play_mode_required', 'no default mode');
  const first = (await api({ action: 'create', mode: 'individual', name: 'Monday warm-up' })).body.session;
  eq(first.state, 'lobby', 'a new session is setting up');
  ok(first.joinUrl && first.joinUrl.includes('session=' + first.code), 'class join link');
  clockMs += 60_000;
  const clash = await api({ action: 'create', mode: 'individual', name: 'Tuesday' });
  eq([clash.status, clash.body.error], [409, 'other_session_open'], 'one open session per class');
  const s1 = (await api({ action: 'create', mode: 'individual', name: 'Tuesday', closeOpen: true })).body.session;
  eq(sessions.get(first.code).state, 'closed', 'starting a new one closes the open one');
  const code = s1.code;
  eq((await api({ action: 'faculty_state', code }, other)).status, 403, 'another instructor cannot read it');

  // The class list: each approved student gets their own run before they open the sim.
  const roster = await api({ action: 'faculty_enrolments', code });
  eq(roster.body.students.length, 4, 'class list arrives');
  let fs1 = (await api({ action: 'faculty_state', code })).body;
  eq(Object.keys(fs1.runs).length, 4, 'one run per student');
  eq(Object.values(fs1.runs).filter(r => r.joined).length, 0, 'nobody has opened it yet');
  eq(fs1.joined, 0, 'the Live screen counts only students who opened it');

  // The class link lands in the open session.
  eq((await call({ action: 'course_session' }, st.ana)).body.code, code, 'class link finds the session');
  for (const who of ['ana', 'ben', 'cal']) eq((await stu(who, { action: 'join', code })).status, 200, `${who} joins`);
  eq((await api({ action: 'control', code, set: 'pause' })).body.error, 'unknown_control', 'the clock has no pause');
  eq((await api({ action: 'control', code, set: 'start' })).body.session.state, 'running', 'start');
  const t0 = clockMs;

  clockMs = t0 + atReport(2);
  await stu('ana', { action: 'open_doc', code, docId: 'northline' });
  const decided = await stu('ana', { action: 'decide', code, choice: 'switch', reason: 'Every store is failing and Northline is silent.' });
  eq(decided.body.decision.atReport, 2, 'Ana switches at report 2');
  const view = await stu('ana', { action: 'state', code });
  ok(!JSON.stringify(view.body).includes('"band"') && !JSON.stringify(view.body).includes(cfg.hiddenDependency + ' Transit ·'), 'no band or map for students during play');
  clockMs = t0 + atReport(5);
  for (const d of cfg.documents) await stu('ben', { action: 'open_doc', code, docId: d.id });
  await stu('ben', { action: 'decide', code, choice: 'stay', reason: 'Both documents point at the same carrier.' });
  eq((await stu('ana', { action: 'review', code, reflection1: 'a', reflection2: 'b' })).body.error, 'not_ended', 'review waits for the reveal');

  fs1 = (await api({ action: 'faculty_state', code })).body;
  const ana = fs1.runs['individual:platform:ana'];
  eq([ana.band, ana.done, ana.atReport], ['switch', true, 2], 'the decision is a band as soon as it is made');
  eq(fs1.runs['individual:platform:cal'].done, false, 'Cal is still deciding');
  ok(fs1.kit.bands.stay && !fs1.kit.ended, 'bands from the server');

  // ---- The clock ends: the reveal, the questions and the review
  clockMs = t0 + E.PLAY_MS + 1000;
  fs1 = (await api({ action: 'faculty_state', code })).body;
  eq(['ana', 'ben', 'cal', 'dee'].map(x => fs1.runs['individual:platform:' + x].band), ['switch', 'stay', 'none', null], 'bands at the end');
  eq(fs1.runs['individual:platform:dee'].done, false, 'a student who never opened it is not a "no decision"');
  ok(fs1.kit.ended && fs1.session.ended, 'ended');
  eq(fs1.runs['individual:platform:ben'].openedBoth, true, 'Ben read both documents first');

  reports.length = 0;
  const rv = await stu('ana', { action: 'reveal', code });
  eq(rv.body.reveal.afterReveal.length, 4, 'four questions after the reveal');
  eq([rv.body.reveal.review.open, rv.body.reveal.review.questions.length], [true, 2], 'the review form');
  eq(reports.length, 1, 'revision 1 at the reveal');
  const r1 = reports[0];
  eq([r1.revision ?? r1.metrics?.revision, r1.summary.band, r1.summary.bandLabel, r1.summary.bandTone], [1, 'switch', 'Switched', 'o'], 'band in the completion');
  eq([r1.summary.sessionCode, r1.summary.sessionName], [code, 'Tuesday'], 'session in the completion');
  eq(r1.runId, `${code}:individual:platform:ana`, 'one run per student per session');
  await stu('ana', { action: 'reveal', code });
  eq(reports.length, 1, 'reported once');
  eq((await stu('ana', { action: 'review', code, reflection1: 'Report 2.', reflection2: '' })).body.error, 'answers_required', 'both answers needed');
  const sent = await stu('ana', { action: 'review', code, reflection1: 'Report 2. The map.', reflection2: 'Our LMS runs on a cloud host.' });
  eq(sent.body.review.sent, true, 'review sent');
  eq([reports.length, reports[1].summary.reflection1, (reports[1].revision ?? reports[1].metrics.revision)], [2, 'Report 2. The map.', 2], 'revision 2 with the review');
  fs1 = (await api({ action: 'faculty_state', code })).body;
  eq(fs1.runs['individual:platform:ana'].reflection1, 'Report 2. The map.', 'the review reaches the faculty pages');

  // ---- Close, the Sessions list, reopen, hide
  reports.length = 0;
  eq((await api({ action: 'control', code, set: 'close' })).body.session.state, 'closed', 'close');
  eq(reports.map(r => r.summary.band).sort(), ['none', 'stay', 'switch'], 'close reports everyone who played; Dee never opened it');
  eq(pointers.get('crs_A'), undefined, 'the class link no longer lands here');
  let list = (await api({ action: 'course_sessions' })).body.sessions;
  eq(list.map(x => x.code), [code, first.code], 'Sessions page, newest first');
  eq([list[0].students, list[0].submitted, list[0].state], [3, 3, 'closed'], 'counts on the Sessions page');
  eq((await api({ action: 'hide_session', code: first.code })).body.ok, true, 'hide a closed session');
  list = (await api({ action: 'course_sessions' })).body.sessions;
  eq(list.map(x => x.code), [code], 'hidden session leaves the list');
  eq((await api({ action: 'control', code, set: 'reopen' })).body.session.state, 'running', 'reopen');
  eq(pointers.get('crs_A'), code, 'the class link lands here again');

  // ---- Team session: the instructor forms teams; the first press decides
  const team = (await api({ action: 'create', mode: 'team', name: 'Teams', closeOpen: true })).body.session;
  await api({ action: 'faculty_enrolments', code: team.code });
  eq((await api({ action: 'group', code: team.code, assign: { 'platform:ana': 'Red', 'platform:ben': 'Red', 'platform:cal': 'Blue' } })).body.ok, true, 'teams formed');
  let tf = (await api({ action: 'faculty_state', code: team.code })).body;
  const red = Object.values(tf.runs).find(r => r.teamLabel === 'Red');
  eq(tf.participants['platform:ben'].groupId, red.runId, 'Ben is on Red');
  eq((await api({ action: 'rename_team', code: team.code, groupId: red.runId, teamLabel: 'Crimson' })).body.ok, true, 'rename');
  eq((await api({ action: 'set_captain', code: team.code, participantId: 'platform:ana' })).body.ok, true, 'no lead to choose');
  ok(F.noLead && F.noPause && /first member/i.test(F.teamRule), 'settings: no lead, no pause');
  for (const who of ['ana', 'ben', 'cal']) eq((await stu(who, { action: 'join', code: team.code })).body.me.teamLabel, who === 'cal' ? 'Blue' : 'Red', `${who} lands on the team`);
  await api({ action: 'control', code: team.code, set: 'start' });
  eq((await api({ action: 'group', code: team.code, assign: { 'platform:cal': 'Crimson' } })).body.error, 'teams_locked', 'teams fixed after the start');
  const t1 = clockMs;
  clockMs = t1 + atReport(3);
  await stu('ben', { action: 'decide', code: team.code, choice: 'stay', reason: 'Hold.' });
  eq((await stu('ana', { action: 'decide', code: team.code, choice: 'switch', reason: 'Go.' })).body.error, 'decision_already_made', 'first press decides');
  clockMs = t1 + E.PLAY_MS + 1000;
  tf = (await api({ action: 'faculty_state', code: team.code })).body;
  const crimson = tf.runs[red.runId];
  eq([crimson.teamLabel, crimson.band, crimson.by], ['Crimson', 'stay', 'Ben'], 'team band and who pressed');
  reports.length = 0;
  await stu('ana', { action: 'reveal', code: team.code });
  eq([reports[0].summary.teamLabel, reports[0].summary.band, reports[0].runId], ['Crimson', 'stay', `${team.code}:${red.runId}`], 'team completion');

  // ---- Rehearse: one practice student on a private run
  const pSub = 'practice-fac-1', pTok = token({ sub: pSub, name: 'Practice student' });
  eq((await api({ action: 'practice_start', students: [] })).body.error, 'practice_students_required', 'needs a practice student');
  const pr = (await api({ action: 'practice_start', students: [{ sub: pSub, name: 'Practice student' }] })).body;
  ok(pr.code && pr.students.length === 1, 'practice run created');
  eq((await call({ action: 'course_session' }, pTok)).body.code, pr.code, 'the practice link finds the practice run');
  eq((await call({ action: 'join', code: pr.code }, pTok)).status, 200, 'practice student joins');
  eq((await call({ action: 'join', code: team.code }, pTok)).body.error, 'practice_only', 'a practice student stays out of class sessions');
  eq((await call({ action: 'join', code: pr.code }, st.ana)).body.error, 'private_session', 'a class student stays out of the practice run');
  eq((await api({ action: 'practice_status' })).body.students[0].status, 'Reading the briefing', 'status: briefing');
  eq((await call({ action: 'start_solo', code: pr.code, participantId: 'platform:' + pSub }, pTok)).status, 200, 'the practice student starts their own clock');
  const tp = clockMs;
  clockMs = tp + atReport(4);
  await call({ action: 'decide', code: pr.code, participantId: 'platform:' + pSub, choice: 'switch', reason: 'Try it.' }, pTok);
  eq((await api({ action: 'practice_status' })).body.students[0].status, 'Decided', 'status: decided');
  clockMs = tp + E.PLAY_MS + 1000;
  reports.length = 0;
  const prv = await call({ action: 'reveal', code: pr.code, participantId: 'platform:' + pSub }, pTok);
  eq([prv.status, prv.body.completionRequired, reports.length], [200, false, 0], 'practice never reports');
  eq(prv.body.reveal.review.open, true, 'the practice student sees the review');
  await call({ action: 'review', code: pr.code, participantId: 'platform:' + pSub, reflection1: 'x', reflection2: 'y' }, pTok);
  eq(reports.length, 0, 'not even the review');
  const ps = (await api({ action: 'practice_status' })).body;
  eq([ps.complete, ps.students[0].status], [true, 'Sent the review'], 'Rehearse complete');
  const pfs = (await api({ action: 'faculty_state', code: pr.code })).body;
  eq(pfs.runs['individual:platform:' + pSub].band, 'switch', 'the instructor can open the practice run');
  list = (await api({ action: 'course_sessions' })).body.sessions;
  ok(!list.some(x => x.code === pr.code), 'practice stays off the Sessions page');
  await api({ action: 'practice_finish' });
  eq(sessions.has(pr.code), false, 'practice finish clears the run');

  // ---- The class debrief, from the first session's own decisions
  const cfgState = { state: (await api({ action: 'faculty_state', code })).body };
  F.prompts(cfgState.state, F.questions);
  eq(F.questions[0].prompt, K.REVIEW_QUESTIONS[0], 'review questions from the server');
  const teams = Object.values(cfgState.state.runs).map(r => ({ id: r.runId, name: r.teamLabel, joined: r.joined, people: [{ id: r.runnerId, name: r.teamLabel }], ...F.record(r) }));
  const m = D.model(F.debrief.input(teams, cfgState));
  eq(m.slides.map(s => s.key), ['glance', 'split', 'reveal', 'reading', 'said', 'lessons'], 'D0 to D5');
  ok(/One switched\. One held\. One made no decision\./.test(m.slides[0].headline), 'D0 counts');
  eq(m.slides[1].body.sw[0].reason, 'Every store is failing and Northline is silent.', 'D1 quotes the reasons');
  ok(m.slides[2].headline.includes(cfg.hiddenDependency), 'D2 names the hidden company, from the server');
  ok(m.slides[3].headline.startsWith('One of three'), 'D3 reading');
  eq(m.slides[4].body.cards.length, 1, 'D4 the review');
  eq(m.slides[5].body.items.length, 4, 'D5 four lessons');
  ok(m.slides[5].body.items.every(x => x.evidence), 'each lesson has evidence from this class');
  ok(D.bodyHTML(m.slides[2], { hidden: {} }).includes('<svg'), 'D2 draws the map');
  eq(F.csv.row({ band: 'switch', atReport: 2, storyTime: '11:17', reason: 'r', openedBoth: false, lost: 1234.4 }), ['Switched', 2, '11:17', 'r', 'No', 1234], 'CSV row');

  // ---- Nothing public names the outcome
  for (const f of ['instructor.html', 'switch-faculty.js', 'switch-debrief.js']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    ok(!text.includes(cfg.hiddenDependency) && !text.includes(cfg.reveal.caption), `${f} carries no spoiler`);
  }
  console.log(`sim06 kit session check: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
