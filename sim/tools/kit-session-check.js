// Disaster or Breach on the shared faculty pages: class sessions, students from the class link,
// results with bands and reviews, Rehearse, and the class debrief. Isolated storage; real handlers.
require('../../tools/security/report-fixture.cjs');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
process.env.LAUNCH_SECRET = 'sim01-kit-check-secret';
const store = require('../lib/store.js');
const handler = require('../api/session.js');
const review = require('../api/review.js');
const B = require('../lib/bands.js');
const S = require('../lib/scenario.js');
const D = require('../public/disaster-debrief.js');
const SIM = 'rapid-01-disaster';

let n = 0; const check = (a, e, m) => { assert.deepEqual(a, e, m); n++; };
function token({ sub, name, role, course, mode = 'play' }) {
  const now = Date.now();
  const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: SIM, mode, course, iat: now, exp: now + 3600000 })).toString('base64url');
  return `${body}.${createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url')}`;
}
const copy = v => v == null ? v : JSON.parse(JSON.stringify(v));
const sessions = new Map(), people = new Map(), runs = new Map(), pointers = new Map(), lists = new Map(), practice = new Map();
const hash = (m, k) => { if (!m.has(k)) m.set(k, {}); return m.get(k); };
Object.assign(store, {
  configured: () => true,
  getSession: async c => copy(sessions.get(c) || null), putSession: async (c, v) => { sessions.set(c, copy(v)); return v; },
  addParticipant: async (c, id, v) => { hash(people, c)[id] = copy(v); }, setParticipant: async (c, id, v) => { hash(people, c)[id] = copy(v); },
  getParticipants: async c => copy(hash(people, c)), setRun: async (c, id, v) => { hash(runs, c)[id] = copy(v); }, getRuns: async c => copy(hash(runs, c)),
  setCourseSession: async (course, c) => pointers.set(course, c), getCourseSession: async course => pointers.get(course) || null,
  clearCourseSession: async (course, c) => { if (pointers.get(course) === c) pointers.delete(course); },
  addCourseSession: async (course, c, at) => { const m = lists.get(course) || new Map(); m.set(c, at); lists.set(course, m); },
  listCourseSessions: async course => [...(lists.get(course) || new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
  setPracticeSession: async (course, owner, c) => practice.set(course + '|' + owner, c), getPracticeSession: async (course, owner) => practice.get(course + '|' + owner) || null,
  clearPracticeSession: async (course, owner) => practice.delete(course + '|' + owner),
  wipe: async c => { sessions.delete(c); people.delete(c); runs.delete(c); }
});
async function invoke(endpoint, body, lt) {
  const req = { method: 'POST', headers: lt ? { 'x-launch-token': lt } : {}, body };
  const res = { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(x) { this.statusCode = x; return this; }, json(v) { this.payload = v; return this; }, end() { return this; } };
  await endpoint(req, res);
  return { status: res.statusCode, body: res.payload };
}
const faculty = token({ sub: 'fac-1', name: 'Vikram', role: 'faculty', course: 'crs_A', mode: 'session' });
const other = token({ sub: 'fac-2', name: 'Other', role: 'faculty', course: 'crs_A', mode: 'session' });
const student = (sub, name, course = 'crs_A') => token({ sub, name, role: 'student', course });
const P = (r1, a1, r2, a2, r3, a3) => [{ reading: r1, action: a1, tripwire: 'If the logs show a second actor.' }, { reading: r2, action: a2, tripwire: 'If it crosses arrays.' }, { reading: r3, action: a3, tripwire: 'If the audit is clean.' }];

(async () => {
  // Bands: two facts per student (approved canvas board A).
  check([B.bandOf(P('both', 'image_first', 'both', 'isolate', 'both', 'notify')), B.bandOf(P('unknown', 'image_first', 'unknown', 'isolate', 'unknown', 'hunt')),
    B.bandOf(P('hardware', 'restore_now', 'hardware', 'image_first', 'both', 'hunt')), B.bandOf(P('hardware', 'restore_now', 'hardware', 'restore_clean', 'hardware', 'restore_clean'))],
    ['ready_both', 'held', 'late', 'gone'], 'Four bands from the two facts');
  check(B.bandOf(P('hardware', 'image_first', 'both', 'image_first', 'both', 'notify')), 'ready_both', 'Notifying on Day 3 keeps Ready for both');

  // Faculty start a session; one open session per class.
  const first = await invoke(handler, { action: 'create', name: 'Thu 9:00' }, faculty);
  check([first.status, first.body.session.mode, first.body.session.platformAuth], [200, 'individual', true], 'Faculty create an individual class session');
  const code = first.body.session.code;
  check((await invoke(handler, { action: 'create', mode: 'team' }, faculty)).status, 400, 'Team play is refused');
  check((await invoke(handler, { action: 'create', name: 'Second' }, faculty)).body.error, 'other_session_open', 'A second session asks first');
  check((await invoke(handler, { action: 'course_sessions' }, faculty)).body.sessions.map(x => x.code), [code], 'Sessions page lists the class session');
  check((await invoke(handler, { action: 'course_sessions' }, other)).body.sessions, [], 'Another faculty member sees none');

  // Students from the class link land in the open session, signed in.
  const ana = student('ana', 'Ana Lopez'), ben = student('ben', 'Ben Ode');
  check((await invoke(handler, { action: 'course_session' }, ana)).body.code, code, 'The class link finds the open session');
  check((await invoke(handler, { action: 'course_session' }, student('zed', 'Zed', 'crs_B'))).body.code, null, 'Another class has none');
  const joined = await invoke(handler, { action: 'join', code }, ana);
  check([joined.status, joined.body.participantId, joined.body.name], [200, 'platform:ana', 'Ana Lopez'], 'Joins as the signed account');
  check((await invoke(handler, { action: 'join', code, name: 'Fake' })).status, 401, 'A typed name cannot join a class session');
  check((await invoke(handler, { action: 'join', code }, student('zed', 'Zed', 'crs_B'))).status, 403, 'A student of another class cannot join');
  await invoke(handler, { action: 'join', code }, ben);
  check((await invoke(handler, { action: 'control', code, set: 'start' }, faculty)).body.session.state, 'running', 'Faculty start the session');

  // Positions lock; the run belongs to the student.
  const anaRun = P('hardware', 'image_first', 'both', 'image_first', 'both', 'notify');
  check((await invoke(handler, { action: 'submit', code, groupId: 'platform:ana', participantId: 'platform:ana', positions: anaRun, phase: 3, done: true, coverageEarnedAt: 1, coveragePrivate: true, privateCount: 2 }, ben)).status, 403, 'Nobody writes another student\'s run');
  check((await invoke(handler, { action: 'submit', code, groupId: 'platform:ana', participantId: 'platform:ana', positions: anaRun, phase: 3, done: true, coverageEarnedAt: 1, coveragePrivate: true, privateCount: 2 }, ana)).status, 200, 'The student saves their own run');
  await invoke(handler, { action: 'submit', code, groupId: 'platform:ben', participantId: 'platform:ben', positions: P('hardware', 'restore_now', 'hardware', 'restore_clean', 'hardware', 'restore_clean'), phase: 3, done: true }, ben);
  const rv = await invoke(review, { code, reflection1: 'Kate, and she had the most to lose.', reflection2: 'Image first.', positions: anaRun, coverageEarnedAt: 1, coveragePrivate: true, privateCount: 2 }, ana);
  check([rv.status, rv.body.saved], [200, true], 'The review saves on the run');
  check((await invoke(review, { code, reflection1: 'Only one', positions: anaRun }, ana)).status, 400, 'Both answers are needed');

  // The faculty session: one run per student, its band, and the debrief content.
  const fs = (await invoke(handler, { action: 'faculty_state', code }, faculty)).body;
  check(Object.keys(fs.runs).sort(), ['individual:platform:ana', 'individual:platform:ben'], 'One run per student, keyed for the shared pages');
  check([fs.runs['individual:platform:ana'].band, fs.runs['individual:platform:ben'].band], ['ready_both', 'gone'], 'Each run carries its band');
  check(fs.runs['individual:platform:ana'].reflection1, 'Kate, and she had the most to lose.', 'The review is on the run');
  check([fs.kit.reviewQuestions, fs.kit.lessonQuestions], [S.REVIEW_QUESTIONS, S.LESSON_QUESTIONS], 'The faculty session carries the questions');
  check((await invoke(handler, { action: 'faculty_state', code }, other)).status, 403, 'Only the owner sees the session');

  // Close, hide, reopen; the class link then finds nothing.
  check((await invoke(handler, { action: 'hide_session', code }, faculty)).status, 409, 'An open session cannot be hidden');
  await invoke(handler, { action: 'control', code, set: 'close' }, faculty);
  check((await invoke(handler, { action: 'course_session' }, ana)).body.code, null, 'A closed session takes no students');
  check((await invoke(handler, { action: 'join', code }, ana)).status, 410, 'Joining a closed session is refused');
  check((await invoke(handler, { action: 'control', code, set: 'reopen' }, faculty)).body.session.state, 'running', 'Reopen continues where it was');
  check((await invoke(handler, { action: 'course_session' }, ana)).body.code, code, 'A reopened session takes students again');
  await invoke(handler, { action: 'control', code, set: 'close' }, faculty);
  check((await invoke(handler, { action: 'hide_session', code }, faculty)).status, 200, 'A closed session can be hidden');
  check((await invoke(handler, { action: 'course_sessions' }, faculty)).body.sessions, [], 'A hidden session leaves the list');

  // Rehearse: one practice student, outside the class's sessions.
  const ps = await invoke(handler, { action: 'practice_start', students: [{ sub: 'practice-fac-1-ana', name: 'Practice Ana' }] }, faculty);
  check([ps.status, ps.body.students.length], [200, 1], 'Rehearse opens one practice student');
  const pa = token({ sub: 'practice-fac-1-ana', name: 'Practice Ana', role: 'student', course: 'crs_A' });
  check((await invoke(handler, { action: 'course_session' }, pa)).body.code, ps.body.code, 'The practice student finds the practice session');
  check((await invoke(handler, { action: 'join', code: ps.body.code }, ana)).status, 403, 'A real student cannot join practice');
  check((await invoke(handler, { action: 'practice_start', students: [{ sub: 'practice-fac-1-ana', name: 'Practice Ana' }] }, faculty)).body.resumed, true, 'Rehearse returns to the open practice');
  check((await invoke(handler, { action: 'course_sessions' }, faculty)).body.sessions, [], 'Practice stays out of the Sessions page');
  check((await invoke(handler, { action: 'practice_finish' }, faculty)).status, 200, 'End practice');
  check((await invoke(handler, { action: 'practice_status' }, faculty)).body.code, null, 'Practice is gone');

  // The class debrief, from the approved canvas sample class.
  const sample = [['Ana', P('hardware', 'restore_now', 'hardware', 'image_first', 'both', 'hunt'), 3], ['Ben', P('hardware', 'restore_now', 'hardware', 'restore_clean', 'hardware', 'restore_clean'), null],
    ['Cal', P('hardware', 'isolate', 'unknown', 'notify', 'both', 'hunt'), 1], ['Dev', P('hardware', 'image_first', 'both', 'image_first', 'both', 'notify'), 1],
    ['Eli', P('unknown', 'image_first', 'unknown', 'isolate', 'unknown', 'hunt'), null], ['Fay', P('both', 'image_first', 'both', 'isolate', 'both', 'notify'), 0]];
  const kit = fs.kit;
  const m = D.model({ kit, students: sample.map(([name, positions, c], i) => ({ id: 'p' + i, name, done: true, positions, band: B.bandOf(positions),
    coverageEarnedAt: c === 3 ? 2 : c, coveragePrivate: name === 'Fay', reflection1: name === 'Fay' ? 'Sophia\'s.' : '', reflection2: '' })) });
  const strip = h => String(h).replace(/<[^>]+>/g, '');
  const by = k => m.slides.find(s => s.key === k);
  check([m.ready, m.slides.length], [true, 8], 'Eight slides');
  check(strip(by('glance').headline), 'Same incident call. Same four advisers. Four different endings.', 'D0 headline');
  check(by('glance').body.tiles.map(t => t.names), [['Dev', 'Fay'], ['Eli'], ['Ana', 'Cal'], ['Ben']], 'D0 tiles by band');
  check(by('both').body.kept, ['Dev', 'Eli', 'Fay'], 'D1 kept options open');
  check(strip(by('q1').headline), 'At Hour 4, four of six took Kate\'s reading: hardware.', 'D2 headline');
  check(strip(by('q2').headline), 'Three of six did something they could not undo before Day 3.', 'D3 headline');
  check(strip(by('q3').headline), 'Three students moved to both. Two of them waited for the Day 3 audit.', 'D4 headline');
  check(strip(by('q4').headline), 'Only Fay got Sophia’s coverage gap at Hour 4, and asked in private.', 'D5 headline');
  check(m.lessons.length, 4, 'Four lessons');
  check(JSON.stringify(D.model({ kit, anonymous: true, students: [{ id: 'x', name: 'Ana Lopez', done: true, positions: sample[0][1], band: 'late' }] })).includes('Ana Lopez'), false, 'Anonymous slides carry no names');
  check(D.model({ kit, students: [{ id: 'x', name: 'Ana', done: false }] }).ready, false, 'The debrief waits for a finished run');

  // Nothing public names the outcome.
  const fsx = require('node:fs'), path = require('node:path');
  for (const f of ['disaster-faculty.js', 'disaster-debrief.js', 'instructor.html', 'index.html']) {
    const text = fsx.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8').toLowerCase();
    check(['it was both', 'ready for both', 'evidence gone', 'right, too late', 'svc-bkp-legacy'].filter(t => text.includes(t)), [], `${f} names no outcome`);
  }
  console.log(`RapidSim 01 kit session checks passed (${n} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
