require('../../tools/security/report-fixture.cjs');
'use strict';
// Whose Number Is Right? on the shared faculty pages: one open session per class, approved students
// on the Teams tab, Auto split, team leads, start, numbers, bands, the review release, reviews as a
// second report, close, reopen, hide, the Sessions list, Rehearse, pause, and the class debrief.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const NOW = 1_780_000_000_000;
let now = NOW;
const realNow = Date.now, realFetch = global.fetch;
Date.now = () => now;
Object.assign(process.env, { LAUNCH_SECRET: 'kit-test-secret', PLATFORM_URL: 'https://platform.test',
  SIM_URL: 'https://rapidsims.flexee.org/sim04' });
const config = require('../data/config');
const sheets = require('../data/sheets');
const store = require('../lib/store');
const room = require('../lib/room');
const gate = require('../build');
const D = require('../public/whose-debrief.js');
const F = require('../public/whose-faculty.js');
const { signBack } = require('../lib/launch');

const reports = [], rosterCalls = [];
let roster = [];
global.fetch = async (url, options) => {
  const body = JSON.parse(options.body || '{}');
  if (String(url).endsWith('/api/session-enrolments')) {
    rosterCalls.push(body);
    return { ok: true, status: 200, json: async () => ({ students: roster }) };
  }
  if (String(url).endsWith('/api/complete')) reports.push(JSON.parse(Buffer.from(body.token.split('.')[0], 'base64url').toString('utf8')));
  return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
};
const sessions = new Map(), lists = new Map(), index = new Map(), practices = new Map();
store.configured = () => true;
store.createSession = async (code, s) => {
  if (sessions.has(code)) return false;
  sessions.set(code, structuredClone(s));
  if (!s.practice && !s.solo && s.platformAuth && s.courseId) { const set = index.get(s.courseId) || new Set(); set.add(code); index.set(s.courseId, set); }
  return true;
};
store.getSession = async code => sessions.has(code) ? structuredClone(sessions.get(code)) : null;
store.compareAndSetSession = async (code, prev, next) => {
  if (JSON.stringify(sessions.get(code)) !== JSON.stringify(prev)) return false;
  sessions.set(code, structuredClone(next)); return true;
};
store.courseSessions = async courseId => [...(index.get(courseId) || [])].map(c => sessions.get(c))
  .filter(s => s && !['complete', 'closed'].includes(s.state)).map(({ code, name, mode, state, stage }) => ({ code, name, mode, state, stage }));
store.indexCourseSession = async (courseId, code) => { const set = index.get(courseId) || new Set(); set.add(code); index.set(courseId, set); };
store.addCourseSession = async (courseId, code, at) => { const m = lists.get(courseId) || new Map(); m.set(code, at); lists.set(courseId, m); };
store.listCourseSessions = async courseId => [...(lists.get(courseId) || new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
store.setPracticeSession = async (c, o, code) => practices.set(c + '|' + o, code);
store.getPracticeSession = async (c, o) => practices.get(c + '|' + o) || null;
store.clearPracticeSession = async (c, o) => practices.delete(c + '|' + o);
store.wipe = async code => sessions.delete(code);
const handler = require('../api/session');

let n = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); n++; };
const token = (sub, role, course = 'crs_A', mode) => signBack({ kind: 'launch', run: 'lch-' + sub, sub, name: sub[0].toUpperCase() + sub.slice(1),
  role, sim: config.simId, course, mode: mode || (role === 'student' ? 'play' : 'session'), iat: now, exp: now + 3600000 });
const fac = token('fac', 'faculty'), other = token('other', 'faculty');
async function call(payload, lt = fac) {
  const out = { status: 200, body: null };
  const res = { setHeader() {}, status(x) { out.status = x; return this; }, json(b) { out.body = b; return this; } };
  await handler({ method: 'POST', body: payload, headers: lt ? { 'x-launch-token': lt } : {} }, res);
  return out;
}
const names = ['ana', 'ben', 'cal', 'dee', 'eli', 'fay'];
const st = Object.fromEntries(names.map(x => [x, token(x, 'student')]));

(async () => {
  // Create: mode required; one open session per class.
  check((await call({ action: 'create', name: 'Thu' })).status, 400, 'No mode, no session');
  const made = await call({ action: 'create', name: 'Thu 9:00', mode: 'team' });
  check([made.status, made.body.session.state, made.body.session.mode], [200, 'lobby', 'team'], 'Faculty create a team session');
  const code = made.body.session.code;
  check((await call({ action: 'create', name: 'Second', mode: 'individual' })).body.error, 'other_session_open', 'A second session asks first');
  check((await call({ action: 'course_sessions' })).body.sessions.map(x => x.code), [code], 'The Sessions page lists it');
  check((await call({ action: 'course_sessions' }, other)).body.sessions, [], 'Another faculty member sees none');
  check((await call({ action: 'faculty_state', code }, other)).status, 403, 'Only the owner opens it');

  // Approved students appear on the Teams tab before they open the sim.
  roster = names.map(x => ({ participantId: `platform:${x}`, name: x.toUpperCase(), accessReleased: true })).concat([{ participantId: 'platform:zed', name: 'Zed', accessReleased: false }]);
  const en = await call({ action: 'faculty_enrolments', code });
  check(en.status, 200, 'The class list loads');
  let fs1 = (await call({ action: 'faculty_state', code })).body;
  check(Object.keys(fs1.participants).sort(), names.map(x => `platform:${x}`), 'Approved students only, before they open the sim');

  // Auto split (the kit sends every assignment at once), team leads, rename.
  const split = Object.fromEntries(names.map((x, i) => [`platform:${x}`, `Team ${(i % 3) + 1}`]));
  check((await call({ action: 'group', code, assign: split })).status, 200, 'Auto split saves');
  fs1 = (await call({ action: 'faculty_state', code })).body;
  const teams = [...new Set(Object.values(fs1.participants).map(p => p.teamLabel))].sort();
  check(teams, ['Team 1', 'Team 2', 'Team 3'], 'Three teams');
  check(Object.values(fs1.participants).filter(p => p.isCaptain).length, 3, 'Every team has a lead');
  const t1 = Object.values(fs1.participants).find(p => p.teamLabel === 'Team 1').groupId;
  check((await call({ action: 'set_captain', code, participantId: 'platform:dee' })).status, 200, 'Choose a team lead');
  check((await call({ action: 'rename_team', code, groupId: t1, teamLabel: 'Team 1 · North' })).status, 200, 'Rename a team');
  check((await call({ action: 'control', code, set: 'review' })).status, 409, 'Review cannot open before the numbers');

  // Students from the class link land in the session; the clock starts with Start.
  const listed = await call({ action: 'course_sessions' }, st.ana);
  check(listed.body.sessions.map(x => x.code), [code], 'The class link finds the open session');
  for (const x of ['ana', 'ben', 'cal', 'dee']) check((await call({ action: 'join', code }, st[x])).status, 200, `${x} joins signed in`);
  check((await call({ action: 'join', code }, token('practice-fac-1', 'student'))).status, 403, 'A practice student cannot join a class session');
  check((await call({ action: 'control', code, set: 'start' })).body.session.state, 'running', 'Start session');
  const s0 = sessions.get(code);
  check(s0.slots.map(s => [s.label, s.sheetId]), [['Team 1 · North', 'A'], ['Team 2', 'E'], ['Team 3', 'D']], 'Sheets go out A, E, D in team order');
  const anaView = (await call({ action: 'state', code }, st.ana)).body;
  check(gate.studentLeaks(anaView, 'A'), [], 'The student response carries only its own sheet');
  check([anaView.view.afterCommit, anaView.view.review.open], [null, false], 'No questions before the number');

  // Pause holds the clock and the commit.
  now += 60000;
  check((await call({ action: 'control', code, set: 'pause' })).body.session.paused, true, 'Pause');
  now += 5 * 60000;
  check((await call({ action: 'state', code }, st.ana)).body.view.clock.remaining, 24 * 60, 'The clock stands still while paused');
  check((await call({ action: 'commit', code, number: 90, confidence: 4 }, st.ana)).status, 409, 'No commit while paused');
  await call({ action: 'control', code, set: 'resume' });
  check((await call({ action: 'state', code }, st.ana)).body.view.clock.remaining, 24 * 60, 'Resume continues the clock');

  // Numbers: Team 1 right, Team 2 off its sheet, Team 3 none (clock runs out).
  check((await call({ action: 'commit', code, number: 90, confidence: 4 }, st.dee)).status, 200, 'Any member locks the number');
  check((await call({ action: 'commit', code, number: 80, confidence: 2 }, st.ana)).status, 409, 'The team number is final');
  check((await call({ action: 'commit', code, number: 75.0, confidence: 3 }, st.ben)).status, 200, 'Team 2 locks a number');
  const afterView = (await call({ action: 'state', code }, st.ana)).body.view;
  check(afterView.afterCommit.length, 4, 'Four questions follow the number');
  check(gate.studentLeaks({ view: afterView }, 'A'), [], 'The questions carry no reveal');
  check((await call({ action: 'faculty_state', code })).body.session.locked, false, 'Not locked while Team 3 works');
  now += 30 * 60000;
  const fs2 = (await call({ action: 'faculty_state', code })).body;
  check(fs2.session.locked, true, 'The clock running out locks every team');
  check(Object.values(fs2.runs).map(r => [r.teamLabel, r.number, r.band]).sort(), [['Team 1 · North', '90.0', 'match'], ['Team 2', '75.0', 'off'], ['Team 3', null, 'none']], 'Each team has its number and band');
  check(fs2.kit.sheets.E.department, 'Investor Relations', 'The faculty session carries the definitions');
  check(fs2.kit.bands.match.label, 'Matches its sheet', 'Band names come from the server');

  // Release review: first reports go out; a review is a second report of the same run.
  const before = reports.length;
  check((await call({ action: 'control', code, set: 'review' })).status, 200, 'Release review questions');
  const first = reports.slice(before);
  check(first.map(r => r.sub).sort(), ['ana', 'ben', 'cal', 'dee'], 'Everyone who joined reports once');
  check(first.every(r => r.metrics.revision === 1 && r.summary.sessionCode === code), true, 'Revision 1 names the session');
  check(first.find(r => r.sub === 'dee').summary.teamLabel, 'Team 1 · North', 'The report names the team');
  check(first.find(r => r.sub === 'ana').runId, `${code}:${s0.slots[0].id}`, 'Team members share the run id');
  const rv = await call({ action: 'review', code, reflection1: 'The last-day line. Sales.', reflection2: 'My GPA. It leaves out what I learned.' }, st.ana);
  check([rv.status, rv.body.view.review.sent], [200, true], 'The review saves');
  const second = reports.at(-1);
  check([second.sub, second.metrics.revision, second.summary.reflection1], ['ana', 2, 'The last-day line. Sales.'], 'Revision 2 carries the review');
  check((await call({ action: 'review', code, reflection1: 'Only one' }, st.ben)).status, 400, 'Both answers are needed');
  const fs3 = (await call({ action: 'faculty_state', code })).body;
  check(fs3.runs[s0.slots[0].id].reflections['platform:ana'].reflection1, 'The last-day line. Sales.', 'The review is on the team run');

  // The class debrief from this session.
  const records = require('../../platform/public/kit/faculty-workspace.js');
  const TEAMS = global.FacultyWorkspace.recordsFrom(fs3, F);
  const m = D.model(F.debrief.input(TEAMS, { state: fs3 }));
  const strip = h => String(h).replace(/<[^>]+>/g, '');
  check([m.ready, m.slides.map(s => s.key)], [true, ['numbers', 'defend', 'definitions', 'worked', 'said', 'lessons']], 'Six slides');
  check(strip(m.slides[0].headline), 'Same records. Two numbers, from 75.0% to 90.0%.', 'D0 headline');
  check(m.slides[0].body.items.map(x => x.number), ['90.0', '75.0', null, '80.0', '85.0'], 'D0: every number, then examples for unplayed sheets');
  check(strip(m.slides[1].headline), 'Team 1 · North reported 90.0%. Team 2 reported 75.0%.', 'D1: the two furthest apart');
  check(m.slides[2].body.sheets.map(x => x.department), ['Sales', 'Investor Relations', 'Finance', 'Product', 'Customer Success'], 'D2: five definitions');
  check(JSON.stringify(m).includes('Matches its sheet') || JSON.stringify(m).includes('Off its sheet'), false, 'The projected slides never say which number is off');
  const worked = D.bodyHTML(m.slides[3], { pick: {}, hidden: {} });
  check(worked.includes('data-md-pick="first"') && worked.includes('7,514'), true, 'D3: two calculations to choose');
  check(D.bodyHTML(m.slides[3], { pick: { first: 'example-C' }, hidden: {} }).includes('Example · Product'), true, 'D3: the faculty member picks');
  check(m.slides[4].body.cards.map(c => c.name), ['ANA · Team 1 · North'], 'D4: what students said');
  check(JSON.stringify(D.model({ ...F.debrief.input(TEAMS, { state: fs3 }), anonymous: true })).includes('ANA'), false, 'Anonymous slides carry no names');
  const early = D.model({ kit: { ...fs3.kit, locked: false }, teams: [] });
  check(early.ready, false, 'The debrief waits for every number');

  // Close, the Sessions list, reopen, hide.
  const preClose = reports.length;
  check((await call({ action: 'control', code, set: 'close' })).body.session.state, 'closed', 'Close');
  check(reports.length - preClose, 4, 'Close sends the final reports again (no change on the platform)');
  check((await call({ action: 'course_sessions' }, st.ana)).body.sessions, [], 'A closed session takes no students');
  check((await call({ action: 'review', code, reflection1: 'a', reflection2: 'b' }, st.ben)).status, 200, 'A student can still send a review after close');
  check((await call({ action: 'control', code, set: 'reopen' })).body.session.state, 'running', 'Reopen');
  check((await call({ action: 'course_sessions' }, st.ana)).body.sessions.map(x => x.code), [code], 'A reopened session takes students again');
  check((await call({ action: 'hide_session', code })).status, 409, 'An open session cannot be hidden');
  await call({ action: 'control', code, set: 'close' });
  check((await call({ action: 'hide_session', code })).status, 200, 'Hide');
  check((await call({ action: 'course_sessions' })).body.sessions, [], 'A hidden session leaves the list');

  // Individual play: everyone gets a run at Start; a late student gets the next sheet.
  const solo = (await call({ action: 'create', name: 'Solo', mode: 'individual' })).body.session.code;
  for (const x of ['ana', 'ben', 'cal']) await call({ action: 'join', code: solo }, st[x]);
  await call({ action: 'control', code: solo, set: 'start' });
  await call({ action: 'join', code: solo }, st.dee);
  check(sessions.get(solo).slots.map(s => s.sheetId), ['A', 'E', 'D', 'C'], 'A late student gets the next sheet');
  const soloState = (await call({ action: 'faculty_state', code: solo })).body;
  check(Object.keys(soloState.runs).sort(), ['individual:platform:ana', 'individual:platform:ben', 'individual:platform:cal', 'individual:platform:dee'], 'One run per student');
  await call({ action: 'control', code: solo, set: 'close' });

  // Rehearse: three practice students, each on their own run, outside the class's sessions.
  const prac = [0, 1, 2].map(i => ({ sub: `practice-fac-${['ana', 'ben', 'cal'][i]}`, name: `Practice ${i}` }));
  const ps = await call({ action: 'practice_start', students: prac });
  check([ps.status, ps.body.students.length], [200, 3], 'Rehearse opens three practice students');
  const pa = token('practice-fac-ana', 'student');
  check((await call({ action: 'course_sessions' }, pa)).body.sessions.map(x => x.code), [ps.body.code], 'A practice student finds the practice session');
  check((await call({ action: 'join', code: ps.body.code }, pa)).status, 200, 'The practice student joins without an email');
  check((await call({ action: 'join', code: ps.body.code }, st.ana)).status, 403, 'A real student cannot join practice');
  check((await call({ action: 'state', code: ps.body.code }, pa)).body.view.state, 'lobby', 'Practice opens in setup, so the story comes first');
  check((await call({ action: 'practice_clock', code: ps.body.code }, st.ana)).status, 403, 'Only a practice student starts the practice clock');
  check((await call({ action: 'practice_clock', code: solo }, st.ana)).status, 403, 'A class session waits for its instructor');
  check((await call({ action: 'practice_clock', code: ps.body.code }, pa)).body.view.state, 'running', 'A practice student starts the clock');
  check((await call({ action: 'state', code: ps.body.code }, pa)).body.view.data.sheet.lines.includes(sheets.contested.A), true, 'Practice plays with a sheet');
  const pre = reports.length;
  await call({ action: 'commit', code: ps.body.code, number: 90, confidence: 5 }, pa);
  check((await call({ action: 'practice_status' })).body.students.filter(x => x.finished).length, 1, 'Rehearse shows the finished practice student');
  check((await call({ action: 'course_sessions' })).body.sessions.some(x => x.code === ps.body.code), false, 'Practice stays out of the Sessions page');
  check(reports.length, pre, 'Practice never reports to the platform');
  check((await call({ action: 'practice_finish' })).status, 200, 'End practice');

  // Nothing public names a department, a purpose or a contested line; the gate checks the new pages.
  for (const f of ['whose-faculty.js', 'whose-debrief.js', 'instructor.html', 'student.js', 'index.html']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    check(Object.values(sheets.reveal).filter(r => text.includes(r.department) || text.includes(r.purpose)).length, 0, `${f} names no department`);
  }
  check(gate.checkSpoilers(), [], 'The spoiler gate passes on the new pages');
  console.log(`${n} kit session checks passed, 0 failed`);
})().catch(e => { console.error('FAIL', e.stack); process.exitCode = 1; }).finally(() => { Date.now = realNow; global.fetch = realFetch; });
