// A course with an open team session routes students' direct launches into that
// session, and refuses a solo run for them. Isolated storage; real handlers.
require('../../tools/security/report-fixture.cjs');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const store = require('../lib/store.js');
const handler = require('../api/session.js');
const outcome = require('../api/outcome.js');
const finish = require('../api/finish.js');

process.env.LAUNCH_SECRET = 'course-session-check-secret';
const SIM = 'rapid-03-midland';
function token({ sub, name, role, course, mode = 'play' }) {
  const now = Date.now();
  const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: SIM, mode,
    course, iat: now, exp: now + 3600000 })).toString('base64url');
  return `${body}.${createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url')}`;
}

const copy = v => v == null ? v : JSON.parse(JSON.stringify(v));
const sessions = new Map(), pointers = new Map();
store.configured = () => true;
store.getSession = async code => copy(sessions.get(code) || null);
store.putSession = async (code, value) => { sessions.set(code, copy(value)); return value; };
store.compareAndSetSession = async (code, previous, next) => {
  if (JSON.stringify(sessions.get(code)) !== JSON.stringify(previous)) return false;
  sessions.set(code, copy(next)); return true;
};
store.getParticipants = async () => ({});
store.getRuns = async () => ({});
store.setCourseTeamSession = async (course, code, onlyIfMissing) => { if (!onlyIfMissing || !pointers.has(course)) pointers.set(course, code); };
store.getCourseTeamSession = async course => pointers.get(course) || null;
store.clearCourseTeamSession = async (course, code) => { if (pointers.get(course) === code) pointers.delete(course); };
const indexes = new Map();
store.addCourseSession = async (course, code, at) => { const m = indexes.get(course) || new Map(); m.set(code, at); indexes.set(course, m); };
store.listCourseSessions = async course => [...(indexes.get(course) || new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);

async function invoke(endpoint, body, lt) {
  const req = { method: 'POST', headers: lt ? { 'x-launch-token': lt } : {}, body };
  const res = { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; }, json(v) { this.payload = v; return this; }, end() { return this; } };
  await endpoint(req, res);
  return { status: res.statusCode, body: res.payload };
}

(async () => {
  let n = 0; const check = (a, e, m) => { assert.deepEqual(a, e, m); n++; };
  const faculty = token({ sub: 'fac-1', name: 'Faculty', role: 'faculty', course: 'crs_A', mode: 'session' });
  const student = token({ sub: 'stu-1', name: 'Student', role: 'student', course: 'crs_A' });
  const otherCourse = token({ sub: 'stu-2', name: 'Other', role: 'student', course: 'crs_B' });
  const alloc = { run: 4, uptime: 1, capacity: 1, connect: 2, features: 1 };

  check((await invoke(handler, { action: 'course_session' }, student)).body, { code: null }, 'No session yet: nothing to join');
  check((await invoke(outcome, { stage: 'year1', year1: alloc }, student)).body.error === 'team_session_open', false, 'Solo play allowed with no team session');

  const individual = await invoke(handler, { action: 'create', mode: 'individual' }, faculty);
  check(individual.status, 200, 'Faculty creates an individual session');
  check((await invoke(handler, { action: 'course_session' }, student)).body, { code: null }, 'Individual sessions do not capture direct launches');

  const team = await invoke(handler, { action: 'create', mode: 'team' }, faculty);
  const code = team.body.session.code;
  check((await invoke(handler, { action: 'course_session' }, student)).body, { code }, 'Student is routed to the course team session');
  check((await invoke(handler, { action: 'course_session' }, otherCourse)).body, { code: null }, 'Another course is not routed');
  check((await invoke(handler, { action: 'course_session' })).status, 401, 'Course routing requires a signed launch');
  check((await invoke(handler, { action: 'course_session' }, faculty)).body, { code: null }, 'Faculty launches are not routed');

  const blocked = await invoke(outcome, { stage: 'year1', year1: alloc }, student);
  check([blocked.status, blocked.body.error], [409, 'team_session_open'], 'Solo outcome refused while the team session is open');
  const blockedFinish = await invoke(finish, { year1: alloc, year2: alloc }, student);
  check([blockedFinish.status, blockedFinish.body.error], [409, 'team_session_open'], 'Solo completion refused while the team session is open');

  pointers.delete('crs_A');
  await invoke(handler, { action: 'faculty_state', code }, faculty);
  check(pointers.get('crs_A'), code, 'Opening the console restores the pointer for an older session');

  check((await invoke(handler, { action: 'control', code, set: 'close' }, faculty)).status, 200, 'Faculty closes the session');
  check(pointers.has('crs_A'), false, 'Closing clears the course pointer');
  check((await invoke(handler, { action: 'course_session' }, student)).body, { code: null }, 'Closed session no longer captures launches');
  check((await invoke(outcome, { stage: 'year1', year1: alloc }, student)).body.error === 'team_session_open', false, 'Solo play returns after close');

  check((await invoke(handler, { action: 'control', code, set: 'reopen' }, faculty)).status, 200, 'A class closed by mistake reopens');
  check([sessions.get(code).state, pointers.get('crs_A')], ['lobby', code], 'Reopened: back in setup (it was never started) and the course class again');
  check((await invoke(handler, { action: 'course_session' }, student)).body, { code }, 'Students are routed to the reopened class');
  check((await invoke(handler, { action: 'control', code, set: 'reopen' }, faculty)).status, 409, 'Only a closed class reopens');
  check((await invoke(handler, { action: 'control', code, set: 'close' }, faculty)).status, 200, 'Close it again');
  const listed = (await invoke(handler, { action: 'course_sessions' }, faculty)).body.sessions;
  check(listed.map(x => [x.code, x.mode, x.state]).sort(), [[code, 'team', 'closed'], [individual.body.session.code, 'individual', 'lobby']].sort(), 'Faculty see every session for the course');
  const otherFaculty = token({ sub: 'fac-2', name: 'Other', role: 'faculty', course: 'crs_A', mode: 'session' });
  check((await invoke(handler, { action: 'course_sessions' }, otherFaculty)).body.sessions, [], 'Another faculty member sees only their own sessions');
  check((await invoke(handler, { action: 'course_sessions' }, student)).status, 401, 'Students cannot list sessions');
  check((await invoke(handler, { action: 'control', code: individual.body.session.code, set: 'close' }, faculty)).status, 200, 'A session in setup closes');
  check((await invoke(handler, { action: 'course_sessions' }, faculty)).body.sessions.every(x => x.state === 'closed'), true, 'The list shows both sessions closed');

  console.log(`RapidSim 03 course team-session routing checks passed (${n} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
