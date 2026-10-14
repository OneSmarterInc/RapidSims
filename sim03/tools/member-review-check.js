// Group mode: the runner's completion reports one row per member (revision 1),
// then each member's own review for Tom updates only that member's row (revision 2).
// Real handlers, isolated storage, captured reports.
require('../../tools/security/report-fixture.cjs');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const store = require('../lib/store.js');
const launchLib = require('../lib/launch.js');
const reports = [];
launchLib.reportCompletion = async options => { reports.push(JSON.parse(JSON.stringify(options))); return { ok: true }; };
const rosterLib = require('../lib/session-roster.js');
rosterLib.syncCourseRoster = async () => ({ available: true, added: 0, students: ['ann', 'ben'].map(sub =>
  ({ participantId: `platform:${sub}`, accessReleased: true })) });
const handler = require('../api/session.js');
const finish = require('../api/finish.js');

process.env.LAUNCH_SECRET = 'member-review-check-secret';
const SIM = 'rapid-03-midland';
function token({ sub, name, role, course = 'crs_A', mode = 'play' }) {
  const now = Date.now();
  const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: SIM, mode,
    course, iat: now, exp: now + 3600000 })).toString('base64url');
  return `${body}.${createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url')}`;
}
const copy = v => v == null ? v : JSON.parse(JSON.stringify(v));
const sessions = new Map(), participants = new Map(), runs = new Map(), pointers = new Map();
store.configured = () => true;
store.getSession = async code => copy(sessions.get(code) || null);
store.putSession = async (code, value) => { sessions.set(code, copy(value)); return value; };
store.compareAndSetSession = async (code, previous, next) => {
  if (JSON.stringify(sessions.get(code)) !== JSON.stringify(previous)) return false;
  sessions.set(code, copy(next)); return true;
};
store.getParticipants = async code => copy(participants.get(code) || {});
store.getRuns = async code => copy(runs.get(code) || {});
store.setParticipant = async (code, id, value) => { participants.set(code, { ...(participants.get(code) || {}), [id]: copy(value) }); };
store.addParticipant = store.setParticipant;
require('./roster-fixture.js').installRosterTransactions(store, sessions, participants);
store.setRun = async (code, id, value) => { runs.set(code, { ...(runs.get(code) || {}), [id]: copy(value) }); };
store.compareAndSetRun = async (code, id, previous, next, session, roster) => {
  if (JSON.stringify(sessions.get(code)) !== JSON.stringify(session) ||
      JSON.stringify(participants.get(code) || {}) !== JSON.stringify(roster) ||
      JSON.stringify((runs.get(code) || {})[id] || null) !== JSON.stringify(previous)) return false;
  await store.setRun(code, id, next); return true;
};
store.setCourseTeamSession = async (course, code, onlyIfMissing) => { if (!onlyIfMissing || !pointers.has(course)) pointers.set(course, code); };
store.getCourseTeamSession = async course => pointers.get(course) || null;
store.clearCourseTeamSession = async (course, code) => { if (pointers.get(course) === code) pointers.delete(course); };

async function invoke(endpoint, body, lt) {
  const req = { method: 'POST', headers: lt ? { 'x-launch-token': lt } : {}, body };
  const res = { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; }, json(v) { this.payload = v; return this; }, end() { return this; } };
  await endpoint(req, res);
  return { status: res.statusCode, body: res.payload };
}

(async () => {
  let n = 0; const check = (a, e, m) => { assert.deepEqual(a, e, m); n++; };
  const faculty = token({ sub: 'fac-1', name: 'Faculty', role: 'faculty', mode: 'session' });
  const ann = token({ sub: 'ann', name: 'Ann', role: 'student' });
  const ben = token({ sub: 'ben', name: 'Ben', role: 'student' });
  const y1 = { run: 4, uptime: 2, capacity: 1, connect: 2, features: 0 };
  const y2 = { run: 4, uptime: 1, capacity: 1, connect: 2, features: 1 };

  const created = await invoke(handler, { action: 'create', mode: 'team', name: 'Tuesday class' }, faculty);
  check(created.status, 200, 'Faculty creates a group session');
  const code = created.body.session.code;
  for (const lt of [ann, ben]) check((await invoke(handler, { action: 'join', code }, lt)).status, 200, 'Student joins with the course launch');
  check((await invoke(handler, { action: 'group', code, assign: { 'platform:ann': 'Alpha', 'platform:ben': 'Alpha' } }, faculty)).status, 200, 'Faculty forms the team');
  check((await invoke(handler, { action: 'control', code, set: 'start' }, faculty)).status, 200, 'Faculty starts the session');

  const annState = (await invoke(handler, { action: 'state', code, participantId: 'platform:ann' }, ann)).body;
  const runnerPid = annState.runnerId, runner = runnerPid === 'platform:ann' ? ann : ben;
  const memberPid = runnerPid === 'platform:ann' ? 'platform:ben' : 'platform:ann', member = runner === ann ? ben : ann;
  const rev = annState.runnerRevision;
  for (const patch of [{ strategicView: 'Build the service platform.' }, { year1: y1 }, { year2: y2 },
    { reflection1: 'Runner review one', reflection2: 'Runner review two', done: true }]) {
    check((await invoke(handler, { action: 'submit', code, participantId: runnerPid, runnerRevision: rev, ...patch }, runner)).status, 200, 'Runner plays the team run');
  }

  const done = await invoke(finish, { sessionCode: code, participantId: runnerPid }, runner);
  check(done.status, 200, 'Runner completes the team run');
  check(reports.length, 2, 'One saved completion per team member');
  for (const r of reports) {
    check([r.summary.sessionCode, r.summary.sessionName, r.metrics.revision, r.metrics.sessionCode], [code, 'Tuesday class', 1, code], 'Each row names the session');
    check(r.summary.teamMembers.slice().sort(), ['Ann', 'Ben'], 'Each row lists the team');
  }
  const forMember = reports.find(r => r.launch.sub === memberPid.slice(9));
  const forRunner = reports.find(r => r.launch.sub === runnerPid.slice(9));
  check([forRunner.summary.reflection1, forMember.summary.reflection1], ['Runner review one', ''], 'The runner row carries the runner review; the member row waits for the member');
  check(forMember.runId, forRunner.runId, 'Both rows belong to the same team run');

  let memberState = (await invoke(handler, { action: 'state', code, participantId: memberPid }, member)).body;
  check(memberState.myReview, null, 'The member has a review to write');

  reports.length = 0;
  const review = await invoke(finish, { sessionCode: code, participantId: memberPid, reflection1: 'Member review one', reflection2: 'Member review two' }, member);
  check(review.status, 200, 'The member sends their review');
  check(reports.length, 1, 'Only the member row is reported again');
  check([reports[0].launch.sub, reports[0].metrics.revision, reports[0].summary.reflection1, reports[0].summary.reflection2, reports[0].runId],
    [memberPid.slice(9), 2, 'Member review one', 'Member review two', forRunner.runId], 'Revision 2 updates the member row with their own review');
  memberState = (await invoke(handler, { action: 'state', code, participantId: memberPid }, member)).body;
  check([memberState.myReview.reflection1, memberState.myReview.reflection2], ['Member review one', 'Member review two'], 'The member sees their saved review');
  check(memberState.closingLesson?.title, 'What this RapidSim teaches', 'A reopened final page still carries the lesson');
  check((await invoke(handler, { action: 'state', code, participantId: runnerPid }, runner)).body.closingLesson?.teaches?.length, 4, 'The runner\'s reopened page carries the four lessons');

  reports.length = 0;
  check((await invoke(finish, { sessionCode: code, participantId: memberPid, reflection1: 'Changed', reflection2: 'Changed' }, member)).status, 200, 'A repeat request succeeds');
  const again = reports.find(r => r.launch.sub === memberPid.slice(9));
  check(again?.summary.reflection1, 'Member review one', 'A sent review stays as sent');
  check(again?.metrics.revision, 1, 'A repeat request carries the lower revision, so the saved review row stays');

  console.log(`RapidSim 03 member review checks passed (${n} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
