require('../../tools/security/report-fixture.cjs');
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { store, keys } = require('../lib/store');
const L = require('../lib/launch');
const C = require('../data/config');
const meta = require('../lib/meta');
process.env.LAUNCH_SECRET = 'integration-secret';
process.env.HEALTH_SECRET = 'diagnostics-secret';
process.env.PLATFORM_URL = 'https://platform.test';
process.env.SIM_URL = 'https://platform.test/simplus02';
let now = 1800000000000;
Date.now = () => now;
const db = new Map();
Object.assign(store, {
  configured: () => true,
  get: async k => db.has(k) && db.get(k) ? JSON.parse(db.get(k)) : null,
  getMany: async ks => ks.map(k => db.has(k) && db.get(k) ? JSON.parse(db.get(k)) : null),
  cas: async (k, prev, next) => {
    if ((db.get(k) || '') !== (prev == null ? '' : JSON.stringify(prev))) return false;
    db.set(k, next == null ? '' : JSON.stringify(next)); return true;
  },
});
const session = require('../api/session'), finish = require('../api/finish'), health = require('../api/health');
function token(p) {
  const raw = Buffer.from(JSON.stringify({ kind: 'launch', run: 'fixture-launch', sim: C.id, role: 'student', sub: 'student', course: 'c1', iat: now, exp: now + 3600000, ...p })).toString('base64url');
  return raw + '.' + crypto.createHmac('sha256', process.env.LAUNCH_SECRET).update(raw).digest('base64url');
}
const auth = p => ({ 'x-launch-token': token(p) });
async function call(handler, body = {}, headers = {}, method = 'POST') {
  const res = { code: 200, payload: null, headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(v) { this.payload = v; return this; } };
  await handler({ method, headers, body }, res);
  return { status: res.code, body: res.payload, headers: res.headers };
}
let assertions = 0;
function eq(a,b,message) { assert.deepEqual(a,b,message); assertions++; }
const callbacks = [];
let registrationOk = false, completionOk = false, releaseCallback, callbackStarted;
global.fetch = async (url, options) => {
  assert.ok(url.startsWith(process.env.PLATFORM_URL + '/api/'));
  const token = JSON.parse(options.body).token;
  const payload = url.endsWith('/register') ? require('../../platform/lib/launch').verify(token) : require('../../shared/report-contract').verifyReport(token, 'complete');
  assert.ok(payload, 'all callbacks are signed');
  callbacks.push({ url, payload });
  if (url.endsWith('/register')) return { ok: registrationOk, status: registrationOk ? 200 : 503, text: async () => 'fixture unavailable' };
  if (callbackStarted) { const started = callbackStarted; callbackStarted = null; started(); await new Promise(resolve => { releaseCallback = resolve; }); }
  return { ok: completionOk, status: completionOk ? 200 : 503, text: async () => 'fixture unavailable' };
};

(async () => {
  eq((await call(health, {}, {}, 'GET')).body, { ok: true, sim: C.id }, 'public liveness exposes no diagnostics');
  eq(callbacks.length, 0, 'health never registers or calls the platform');
  const diagnostic = await call(health, {}, { 'x-health-key': process.env.HEALTH_SECRET }, 'GET');
  eq(diagnostic.body.diagnostic, true);
  eq(diagnostic.body.registersAs, process.env.SIM_URL);
  eq(diagnostic.body.features.includes('self-register'), true);
  assert.ok(!JSON.stringify(diagnostic.body).includes(process.env.LAUNCH_SECRET));

  await Promise.all([L.announce(), L.announce()]);
  eq(callbacks.length, 1, 'concurrent announcements share one request');
  registrationOk = true;
  await L.announce(); await L.announce();
  eq(callbacks.length, 2, 'a failed registration retries, success is cached');
  eq([callbacks[1].payload.sim, callbacks[1].payload.number, callbacks[1].payload.title, callbacks[1].payload.minutes], [C.id, 102, meta.title, 65]);
  eq(callbacks[1].payload.detail, meta.detail);

  const owner = auth({ sub: 'teacher', role: 'faculty', mode: 'session' });
  for (const invalid of [{ sim: 'rapid-05-approve', role: 'faculty' }, { role: 'admin' }, { sub: null, role: 'faculty' }, { role: 'faculty', exp: now - 1 }]) {
    eq((await call(session, { action: 'create', mode: 'team' }, auth(invalid))).status, 401, 'wrong sim, role, account or expiry cannot create a session');
  }
  eq((await call(session, { action: 'create', mode: 'team' }, { 'x-faculty-code': 'faculty-code' })).status, 401, 'facilitator codes open nothing');
  const made = await call(session, { action: 'create', mode: 'team' }, owner);
  eq(made.status, 200);
  const code = made.body.session.code;
  eq((await store.get(keys.session(code))).courseId, 'c1');
  eq((await call(session, { action: 'entry' }, auth({ sub: 'student0' }))).body, { code }, 'course account finds its open session');
  eq((await call(session, { action: 'entry' }, auth({ course: 'c2' }))).body, { code: null });
  const before = await store.get(keys.session(code));
  const stranger = auth({ sub: 'other-teacher', role: 'faculty', mode: 'session' });
  for (const [action, extra] of [['faculty_state', {}], ['group', { assign: {} }], ['control', { set: 'start_anyway' }], ['control', { set: 'close' }], ['hide_session', {}]]) {
    eq((await call(session, { action, code, ...extra }, stranger)).status, 403, action + ' belongs to the creating instructor');
  }
  eq((await call(session, { action: 'faculty_state', code }, auth({ sub: 'teacher', role: 'faculty', course: 'c2' }))).status, 403);
  eq(await store.get(keys.session(code)), before, 'unauthorised faculty requests do not change the session');
  eq((await call(session, { action: 'join', code }, { 'x-access-code': 'guest-code' })).status, 401, 'an access code cannot enter a class session');
  eq((await call(session, { action: 'join', code }, auth({ course: 'c2' }))).status, 403, 'other course cannot join');
  const people = [];
  for (let i = 0; i < 4; i++) {
    const headers = auth({ sub: 'student' + i, name: 'Student ' + i });
    const joined = await call(session, { action: 'join', code }, headers);
    eq(joined.status, 200);
    people.push({ ...joined.body, headers: { ...headers, 'x-participant-key': joined.body.participantKey } });
  }
  const me = people[0], input = { code, participantId: me.participantId };
  const rejoined = await call(session, { action: 'join', code }, auth({ sub: 'student0', name: 'Student 0' }));
  eq([rejoined.body.participantId, rejoined.body.participantKey], [me.participantId, me.participantKey], 'account rejoin returns the same participant');
  eq(Object.keys(await store.get(keys.roster(code))).length, 4, 'account rejoin does not duplicate students');
  for (const headers of [{ 'x-participant-key': me.participantKey }, { ...auth({ sub: 'intruder' }), 'x-participant-key': me.participantKey },
    { ...auth({ sub: 'student0', course: 'c2' }), 'x-participant-key': me.participantKey }]) {
    eq((await call(session, { action: 'view', ...input }, headers)).status, 403, 'a leaked key cannot replace account and course identity');
    eq((await call(session, { action: 'walkthrough', ...input, step: 1 }, headers)).status, 403, 'walkthrough acknowledgements require the participant identity');
  }
  eq((await call(session, { action: 'group', code, assign: Object.fromEntries(people.map(p => [p.participantId, 'Table 1'])) }, owner)).status, 200);
  eq((await call(session, { action: 'control', code, set: 'start' }, owner)).body.error, 'walkthrough_incomplete', 'briefing waits for the untimed walkthrough');
  eq((await store.get(keys.session(code))).phaseEndsAt, null, 'waiting for readers does not start a clock');
  eq((await call(session, { action: 'walkthrough', ...input, step: 4 }, me.headers)).status, 400, 'cannot skip to the last screen');
  for (let step = 1; step <= 2; step++) eq((await call(session, { action: 'walkthrough', ...input, step }, me.headers)).status, 200);
  await call(session, { action: 'join', code }, auth({ sub: 'student0', name: 'Student 0' }));
  eq((await call(session, { action: 'view', ...input }, me.headers)).body.walkthrough.step, 2, 'fresh account rejoin retains walkthrough progress');
  eq((await call(session, { action: 'walkthrough', ...input, step: 1 }, me.headers)).body.walkthrough.step, 2, 'retrying an earlier screen never rolls back progress');
  for (const person of people.slice(1, 3)) for (let step = 1; step <= 4; step++) eq((await call(session, { action: 'walkthrough', code, participantId: person.participantId, step }, person.headers)).status, 200);
  const waiting = await store.get(keys.session(code));
  eq((await call(session, { action: 'control', code, set: 'start_anyway' }, people[1].headers)).status, 401, 'students cannot override readiness');
  eq(await store.get(keys.session(code)), waiting, 'a refused start does not change the session');
  eq((await call(session, { action: 'control', code, set: 'start_anyway' }, owner)).status, 200);
  const started = await store.get(keys.session(code));
  eq(started.phaseEndsAt, now + C.timing.briefing * 60000, 'Start anyway starts the normal briefing clock');
  eq(started.walkthroughOverride.participants.map(p => p.name).sort(), ['Student 0', 'Student 3'], 'audit record names only the unfinished students');
  for (const person of [me, people[3]]) {
    const v = (await call(session, { action: 'view', code, participantId: person.participantId }, person.headers)).body;
    eq([v.phase, v.walkthrough], ['briefing', undefined], 'unfinished readers enter their brief immediately');
    assert.ok(v.brief && v.brief.person);
  }
  eq((await store.get(keys.roster(code)))[me.participantId].walkthroughStep, 2, 'Start anyway does not claim the student finished reading');
  eq((await call(session, { action: 'control', code, set: 'start_anyway' }, owner)).status, 409, 'Start cannot restart the briefing clock');
  eq((await call(session, { action: 'walkthrough', ...input, step: 3 }, me.headers)).status, 409, 'timed play does not reopen the walkthrough');
  for (const set of ['openings', 'negotiation']) eq((await call(session, { action: 'control', code, set }, owner)).status, 200);
  eq((await call(finish, input, me.headers)).status, 409, 'nothing to report before the outcome');
  completionOk = true;
  now += 45 * 60000;
  eq((await call(finish, input, me.headers)).body.reported, true, 'finish settles an expired negotiation before any poll');
  eq((await store.get(keys.session(code))).phase, 'closed');
  const reports = callbacks.filter(c => c.url.endsWith('/complete'));
  eq(reports.length, 4, 'the deadline reports each student once');
  const mine = reports.find(r => r.payload.sub === 'student0');
  eq([mine.payload.course, mine.payload.sim, mine.payload.summary.seat], ['c1', C.id, (await store.get(keys.roster(code)))[me.participantId].seat]);
  eq((await call(finish, input, me.headers)).body.reported, true);
  eq(callbacks.filter(c => c.url.endsWith('/complete')).length, 4, 'asking again reports nothing new');
  console.log(`All integration tests pass (${assertions} assertions).`);
})().catch(e => { console.error('FAIL', e.stack); process.exit(1); });
