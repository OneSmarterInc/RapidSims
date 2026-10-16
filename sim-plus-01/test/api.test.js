require('../../tools/security/report-fixture.cjs');
'use strict';

const assert = require('assert');
process.env.ACCESS_CODE = 'standalone-fixture';
process.env.LAUNCH_SECRET = 'fixture-launch-key';
process.env.KV_REST_API_URL = 'memory://test';
process.env.KV_REST_API_TOKEN = 'test';

const store = require('../lib/store');
const memory = new Map();
store.configured = () => true;
store.getRaw = async (key) => memory.get(key) || null;
store.putRaw = async (key, value) => { memory.set(key, value); return value; };
// Faculty sessions and their students, in memory.
const sessions = new Map(), hashes = new Map(), hash = c => hashes.get(c) || hashes.set(c, new Map()).get(c);
store.getSession = async c => sessions.get(c) || null;
store.putSession = async (c, v) => { sessions.set(c, v); return v; };
store.getParticipant = async (c, id) => hash(c).get(id) || null;
store.getParticipants = async c => Object.fromEntries(hash(c));
store.setParticipant = async (c, id, v) => { hash(c).set(id, v); };
store.addParticipant = store.setParticipant;
store.addParticipantIfNew = async (c, id, v) => { if (!hash(c).has(id)) hash(c).set(id, v); };
store.wipe = async c => { sessions.delete(c); hashes.delete(c); };
const run = require('../api/run');
const session = require('../api/session');
async function kit(action, extra, launch) {
  const req = { method: 'POST', headers: { 'x-launch-token': require('../lib/launch').signBack(launch) }, body: { action, ...extra } };
  let status = 200, payload;
  const res = { status(n) { status = n; return this; }, json(v) { payload = v; return this; }, end() { return this; } };
  await session(req, res);
  return { status, payload };
}

let activeLaunch = null;
async function call(action, extra = {}, launch = activeLaunch, headers = {}) {
  const req = { method: 'POST', headers: { 'x-access-code': 'standalone-fixture', ...headers }, body: { action, ...extra } };
  if (launch) req.headers['x-launch-token'] = require('../lib/launch').signBack(launch);
  let status = 200, payload;
  const res = { status(n) { status = n; return this; }, json(v) { payload = v; return this; }, end() { return this; } };
  await run(req, res);
  return { status, payload };
}

(async () => {
  let r = await call('brief');
  assert.equal(r.status, 200);
  assert.equal(r.payload.faculty, false);
  assert.equal(r.payload.orderings.length, 2);
  assert.deepEqual(r.payload.starters, [
    "What happens when something doesn't go the way it should?",
    'Who receives this after you?',
    'What would happen if this stopped?',
    'Why is it done this way?',
    'What does the person on the other end see?'
  ]);
  for (const source of Object.values(r.payload.sources)) assert.equal(source.suggestions, undefined, 'starters must not be tailored to a source');
  assert.match(r.payload.observation.instruction, /when it is done/i);
  assert.doesNotMatch(r.payload.observation.instruction, /per-claim timing/i);

  const launch = activeLaunch = { kind:'launch', run:'issued-run', sim:'rapidsimplus-01', exp:Date.now()+3600000, sub: 'participant-1', name: 'Split Session Tester', course: 'course-1', role: 'student' };
  // No session yet: the class link says so.
  r = await call('entry', {}, launch);
  assert.equal(r.payload.error, 'no_open_session');
  const fac = { kind:'launch', run:'course-page', sim:'rapidsimplus-01', exp:Date.now()+3600000, sub:'teacher', name:'Vikram', course:'course-1', role:'faculty', mode:'session' };
  const created = await kit('create', { name: 'Tuesday' }, fac);
  assert.equal(created.status, 200);
  const code = created.payload.code;
  r = await call('entry', {}, launch);
  assert.deepEqual([r.payload.code, r.payload.state], [code, 'lobby'], 'the class link finds the open session');
  r = await call('start', { order: ['terry', 'ray', 'ruth'], observationSeconds: 30 }, launch);
  assert.equal(r.payload.error, 'session_not_started', 'interviews wait for the instructor');
  assert.equal((await kit('control', { code, set: 'start' }, fac)).payload.session.state, 'running');
  r = await call('start', { order: ['terry', 'ray', 'ruth'], observationSeconds: 30 }, launch);
  assert.equal(r.status, 200);
  const runId = r.payload.runId;
  assert.equal(r.payload.state.source.id, 'terry');
  assert.equal(r.payload.state.observationSeconds, 30);
  assert.equal(r.payload.state.chartCompleted, false);

  // Simulate Thursday on another browser/device: no runId is supplied.
  r = await call('resume', {}, launch);
  assert.equal(r.status, 200);
  assert.equal(r.payload.runId, runId);
  assert.equal(r.payload.state.observationSeconds, 30);
  assert.equal(r.payload.state.source.id, 'terry');

  r = await call('ask', { runId, question: 'Why does the log exist?' });
  assert.equal(r.status, 200);
  assert.match(r.payload.answer, /ten years/i);
  assert.equal(r.payload.state.remaining, 810);

  await call('advance', { runId });
  await call('advance', { runId });
  r = await call('advance', { runId });
  assert.equal(r.payload.state.finishedInterviews, true);
  assert.equal(r.payload.state.observationSeconds, 30);

  const rows = {};
  for (const row of ['intake', 'log', 'vendor', 'review']) rows[row] = { disposition: row === 'vendor' ? 'cannot_assess' : 'keep', justification: 'This is supported by interview evidence.' };
  r = await call('submit', { runId, submission: { rootCause: 'The process creates repeat submissions through delayed feedback.', rows } });
  assert.equal(r.status, 409);
  assert.equal(r.payload.error, 'chart_not_complete');

  const chart = {
    intake: {
      longestWait: { value: 'Overnight after the last release', couldNotEstablish: false },
      faxRouting: { value: '', couldNotEstablish: true },
      providerReceipt: { value: 'No acknowledgement was established', couldNotEstablish: false }
    },
    log: {
      purpose: { value: 'Created for an old address problem', couldNotEstablish: false },
      receiver: { value: '', couldNotEstablish: true }
    },
    review: {
      step: { value: 'First-pass review', couldNotEstablish: false },
      owner: { value: 'Ruth Kessler', couldNotEstablish: false },
      receiver: { value: 'Adjudication', couldNotEstablish: false },
      catches: { value: 'Repeat copies and same-day legitimate procedures', couldNotEstablish: false },
      dependsOn: { value: 'Undocumented matching judgment', couldNotEstablish: false }
    }
  };
  r = await call('save_chart', { runId, chart });
  assert.equal(r.status, 200);
  assert.equal(r.payload.state.chartCompleted, true);
  assert.equal(r.payload.state.completedChart.review.timingSeconds, 30);

  r = await call('submit', { runId, submission: { rootCause: 'The process creates repeat submissions through delayed feedback.', rows } });
  assert.equal(r.status, 200);
  assert.ok(r.payload.outcome);
  assert.equal(r.payload.outcome.observationSeconds, 30);
  assert.equal(r.payload.outcome.completedChart.review.timingSeconds, 30);
  assert.equal(r.payload.outcome.evidence, undefined, 'participant response must not expose instructor evidence');
  assert.equal(r.payload.outcome.support, undefined, 'participant response must not expose instructor support scoring');
  assert.equal(r.payload.review, undefined, 'full instructor review must not be returned to participant');
  assert.deepEqual([r.payload.studentReview.open, r.payload.studentReview.sent], [true, false], 'the review questions follow the report');
  let fs = await kit('faculty_state', { code }, fac);
  const rec = fs.payload.runs['individual:platform:participant-1'];
  assert.deepEqual([rec.done, rec.band, rec.order.length], [true, 'kept', 3], 'Results: the filed report and its band');
  assert.ok(rec.transcript.length >= 1 && rec.transcript[0].answer, 'Results: the transcript with answers, for faculty only');
  r = await call('review_answers', { reflection1: 'Asking why the log exists.', reflection2: 'I would ask Ruth about exceptions.' });
  assert.equal(r.payload.studentReview.sent, true);
  fs = await kit('faculty_state', { code }, fac);
  assert.equal(fs.payload.runs['individual:platform:participant-1'].reflection1, 'Asking why the log exists.');
  assert.equal((await kit('control', { code, set: 'close' }, fac)).payload.session.state, 'closed');
  assert.equal((await call('ask', { runId, question: 'Anything else?' })).payload.error, 'session_closed', 'a closed session freezes the run');
  assert.equal((await call('review', { runId })).status, 200, 'the outcome stays readable');
  assert.equal((await kit('control', { code, set: 'reopen' }, fac)).payload.session.state, 'running');

  r = await call('review', { runId });
  assert.equal(r.status, 200);
  assert.ok(r.payload.outcome);
  assert.equal(r.payload.outcome.evidence, undefined);

  r = await call('resume', { runId });
  assert.equal(r.payload.submitted, true);
  assert.equal(r.payload.state.chartCompleted, true);

  process.env.LAUNCH_SECRET='faculty-capability-test';
  const { signBack }=require('../lib/launch');
  const token=(role,extra={})=>signBack({kind:'launch',run:'fixture-launch',sub:'test-user',sim:'rapidsimplus-01',role,exp:Date.now()+60000,...extra});
  r=await call('brief',{faculty:true,role:'faculty'},null,{'x-launch-token':token('student')});
  assert.equal(r.payload.faculty,undefined,'student input cannot grant playback controls');
  assert.equal(r.payload.error,'no_open_session','a student outside a class session is sent back to the class page');
  for(const role of ['faculty','faculty_preview']){
    r=await call('brief',{},null,{'x-launch-token':token(role)});
    assert.equal(r.payload.faculty,true,'verified faculty receives playback controls');
  }
  r=await call('brief',{},null,{'x-launch-token':token('faculty',{sim:'rapid-03-bench'})});
  assert.equal(r.payload.faculty,true,'legacy faculty launches still work');
  assert.equal((await call('brief',{},null,{'x-launch-token':'forged.token'})).status,401);
  assert.equal((await call('brief',{},null,{'x-launch-token':token('faculty',{sim:'rapid-09-money-land'})})).status,403);
  assert.equal((await call('brief',{},null,{'x-launch-token':token('faculty',{exp:1})})).status,401);
  assert.equal((await call('brief',{},null,{'x-faculty-code':'unconfigured'})).payload.faculty,false);
  process.env.FACULTY_CODE='explicit-faculty-code';
  assert.equal((await call('brief',{},null,{'x-faculty-code':'wrong'})).payload.faculty,false);
  assert.equal((await call('brief',{},null,{'x-faculty-code':process.env.FACULTY_CODE})).payload.faculty,true);
  console.log('api integration: passed');
})().catch((e) => { console.error(e); process.exit(1); });

