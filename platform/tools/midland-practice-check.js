#!/usr/bin/env node
'use strict';
// Rehearse: the course page starts a practice class of three practice students,
// each signed for that practice class only. Real platform and Midland handlers;
// PGlite for the platform database; in-memory Midland storage.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
process.env.LAUNCH_SECRET = 'midland-practice-secret';
process.env.SIM03_SESSION_URL = 'http://midland.internal/api/session';
(async () => {
  let n = 0; const check = (a, e, m) => { assert.deepEqual(a, e, m); n++; };
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../lib/schema.sql'), 'utf8'));
  const s = async (strings, ...values) => (await db.query(strings.reduce((q, t, i) => q + (i ? '$' + i : '') + t, ''), values)).rows;
  s.query = async (text, values) => (await db.query(text, values)).rows;
  const dbFile = require.resolve('../lib/db.js');
  require.cache[dbFile] = { id: dbFile, filename: dbFile, loaded: true, exports: { sql: () => s, id: p => p + '_' + Math.random().toString(36).slice(2) } };
  for (const id of ['f1', 'f2']) {
    await s`INSERT INTO users(id,name,email,role) VALUES(${id},${'Faculty ' + id},${id + '@example.test'},'faculty')`;
    await s`INSERT INTO sessions(id,user_id,expires_at) VALUES(${id},${id},now()+interval '1 day')`;
  }
  await s`INSERT INTO courses(id,faculty_id,title,join_code) VALUES('c1','f1','MIS3000','JOIN01'),('c2','f2','Other','JOIN02')`;
  await s`INSERT INTO sims(id,number,title,launch_url,published) VALUES('rapid-03-midland',3,'Midland Equipment','https://rapidsims.test/sim03',true)`;
  await s`INSERT INTO course_sims(course_id,sim_id) VALUES('c1','rapid-03-midland'),('c2','rapid-03-midland')`;

  // Midland with in-memory storage, reached through fetch; reports captured.
  const store = require('../../sim03/lib/store.js');
  const copy = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const sessions = new Map(), participants = new Map(), runs = new Map(), keys = new Map(), pointers = new Map();
  store.configured = () => true;
  store.getSession = async c => copy(sessions.get(c) || null);
  store.putSession = async (c, v) => { sessions.set(c, copy(v)); return v; };
  store.getParticipants = async c => copy(participants.get(c) || {});
  store.getRuns = async c => copy(runs.get(c) || {});
  store.setParticipant = async (c, id, v) => { participants.set(c, { ...(participants.get(c) || {}), [id]: copy(v) }); };
  require('../../sim03/tools/roster-fixture.js').installRosterTransactions(store, sessions, participants);
  store.setRun = async (c, id, v) => { runs.set(c, { ...(runs.get(c) || {}), [id]: copy(v) }); };
  store.compareAndSetRun = async (c, id, prev, next, sess, roster) => {
    if (JSON.stringify(sessions.get(c)) !== JSON.stringify(sess) || JSON.stringify(participants.get(c) || {}) !== JSON.stringify(roster) ||
        JSON.stringify((runs.get(c) || {})[id] || null) !== JSON.stringify(prev)) return false;
    await store.setRun(c, id, next); return true;
  };
  store.setCourseTeamSession = async (course, c) => { pointers.set(course, c); };
  store.getCourseTeamSession = async course => pointers.get(course) || null;
  store.clearCourseTeamSession = async () => {};
  store.addCourseSession = async () => {}; store.listCourseSessions = async () => [];
  store.setPracticeSession = async (course, owner, c) => { keys.set(course + ':' + owner, c); };
  store.getPracticeSession = async (course, owner) => keys.get(course + ':' + owner) || null;
  store.clearPracticeSession = async (course, owner) => { keys.delete(course + ':' + owner); };
  store.wipe = async c => { sessions.delete(c); participants.delete(c); runs.delete(c); };
  const reports = [];
  const sim03Launch = require('../../sim03/lib/launch.js');
  sim03Launch.reportCompletion = async o => { reports.push(o); return { ok: true }; };
  const midland = require('../../sim03/api/session.js');
  const finish = require('../../sim03/api/finish.js');
  async function invoke(endpoint, body, lt) {
    const res = { statusCode: 200, payload: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(v) { this.payload = v; return this; }, end() { return this; } };
    await endpoint({ method: 'POST', headers: lt ? { 'x-launch-token': lt } : {}, body }, res);
    return { status: res.statusCode, body: res.payload };
  }
  global.fetch = async (url, opt) => {
    const r = await invoke(midland, JSON.parse(opt.body), opt.headers['x-launch-token']);
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  };

  const faculty = require('../api/faculty.js');
  async function call(body, cookie = 'f1') {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
    await faculty({ method: 'POST', headers: { cookie: 'fx_sess=' + cookie, host: 'localhost' }, body }, res);
    return res;
  }
  const tokenOf = url => decodeURIComponent(new URL(url).hash.slice(1).split('lt=')[1]);
  const { launchToken } = require('../lib/launch.js');

  // A real class is open for the course.
  const facultyLt = launchToken({ userId: 'f1', name: 'Faculty f1', role: 'faculty', simId: 'rapid-03-midland', courseId: 'c1', mode: 'session', runId: 'x' });
  const realClass = (await invoke(midland, { action: 'create', mode: 'team', name: 'Thursday' }, facultyLt)).body.session.code;

  const row = (await call({ action: 'midland_status', courseId: 'c1' })).body;
  check([row.available, row.open && row.open.code, row.open && row.open.state, row.open && row.open.name], [true, realClass, 'lobby', 'Thursday'], 'The course row sees the open session');
  check((await call({ action: 'midland_status', courseId: 'c1' }, 'nobody')).statusCode >= 400, true, 'Only the signed-in faculty member sees it');
  let r = await call({ action: 'midland_practice_start', courseId: 'c1' });
  check(r.statusCode, 200, 'Faculty start a practice class');
  const { code, students, classUrl } = r.body;
  check(students.map(x => [x.name, x.entersDecisions]), [['Practice Ana', true], ['Practice Ben', false], ['Practice Cal', false]], 'Three practice students; Ana enters the decisions');
  check(new URL(students[0].url).searchParams.get('session'), code, 'Each link opens the practice class');
  check(classUrl.includes('session=' + code), true, 'The class page link opens the practice class');
  const sess = sessions.get(code);
  check([sess.practice, sess.state, sess.mode, sess.courseId], [true, 'running', 'team', 'c1'], 'The practice class is running in teams');
  check(Object.values(participants.get(code)).map(p => p.groupId), ['team:practice', 'team:practice', 'team:practice'], 'All three are on one team');
  check(pointers.get('c1'), realClass, 'The real class stays the course\'s class');

  const [ana, ben] = students.map(x => tokenOf(x.url));
  const anaId = (await invoke(midland, { action: 'join', code }, ana)).body.participantId;
  const benId = (await invoke(midland, { action: 'join', code }, ben)).body.participantId;
  const st = (await invoke(midland, { action: 'state', code, participantId: anaId }, ana)).body;
  check([st.canSubmit, st.mates.length], [true, 3], 'Ana enters the decisions and sees her team');
  check((await invoke(midland, { action: 'state', code, participantId: benId }, ben)).body.canSubmit, false, 'Ben follows each step');
  check((await invoke(midland, { action: 'course_session' }, ana)).body, { code: null }, 'A practice student is never routed to the real class');
  check((await invoke(midland, { action: 'join', code: realClass }, ana)).status, 403, 'A practice student cannot join the real class');
  const realStudent = launchToken({ userId: 'stu1', name: 'Real', role: 'student', simId: 'rapid-03-midland', courseId: 'c1', mode: 'play', runId: 'y' });
  check((await invoke(midland, { action: 'join', code }, realStudent)).status, 403, 'A real student cannot join a practice class');
  const roster = (await invoke(midland, { action: 'faculty_enrolments', code }, facultyLt)).body;
  check([roster.available, roster.students.length, Object.keys(roster.participants).length], [true, 3, 3], 'The practice class page lists only the practice students');

  // Ana plays through; Ben sends his review. Nothing reaches course results.
  const y = { run: 4, uptime: 2, capacity: 1, connect: 2, features: 0 };
  for (const patch of [{ strategicView: 'Practice view.' }, { year1: y }, { year2: y }, { reflection1: 'A', reflection2: 'B', done: true }]) {
    check((await invoke(midland, { action: 'submit', code, participantId: anaId, runnerRevision: st.runnerRevision, ...patch }, ana)).status, 200, 'Ana plays the practice run');
  }
  check((await invoke(finish, { sessionCode: code, participantId: anaId }, ana)).status, 200, 'Ana completes the practice run');
  check((await invoke(finish, { sessionCode: code, participantId: benId, reflection1: 'Ben one', reflection2: 'Ben two' }, ben)).status, 200, 'Ben sends his practice review');
  check(reports.length, 0, 'Practice runs stay out of course results');
  let status = (await call({ action: 'midland_practice_status', courseId: 'c1' })).body;
  check([status.complete, status.students.map(x => x.status)], [false, ['Submitted for the team', 'Review sent', 'Writing the review']], 'The panel shows each practice student\'s progress');
  const calId = (await invoke(midland, { action: 'join', code }, tokenOf(students[2].url))).body.participantId;
  await invoke(finish, { sessionCode: code, participantId: calId, reflection1: 'Cal one', reflection2: 'Cal two' }, tokenOf(students[2].url));
  status = (await call({ action: 'midland_practice_status', courseId: 'c1' })).body;
  check([status.complete, status.students.every(x => x.finished)], [true, true], 'The panel says when the practice class is complete');

  check((await call({ action: 'midland_practice_finish', courseId: 'c1' }, 'f2')).statusCode, 404, 'Another faculty member cannot reach this course');
  r = await call({ action: 'midland_practice_start', courseId: 'c1' });
  check([r.statusCode, r.body.code, r.body.resumed, sessions.has(code)], [200, code, true, true], 'Rehearse again returns to the practice class already running');
  check(runs.get(code)['team:practice'].done, true, 'The finished practice run is still there');
  check(r.body.students.map(x => [x.name, x.entersDecisions]), [['Practice Ana', true], ['Practice Ben', false], ['Practice Cal', false]], 'The same three practice students');
  r = await call({ action: 'midland_practice_start', courseId: 'c1', startOver: true });
  check([r.statusCode, r.body.resumed, sessions.has(code)], [200, false, false], 'Start over replaces the practice class');
  const second = r.body.code;
  r = await call({ action: 'midland_practice_finish', courseId: 'c1' });
  check([r.statusCode, sessions.has(second), sessions.has(realClass)], [200, false, true], 'Finish practice removes the practice class and keeps the real class');

  global.fetch = async () => { throw new Error('down'); };
  check((await call({ action: 'midland_status', courseId: 'c1' })).body.available, false, 'If Midland cannot be reached, the row says it is checking, not that nothing is open');
  check((await call({ action: 'midland_practice_start', courseId: 'c1' })).statusCode, 503, 'If Midland cannot be reached, the course page says so');
  console.log(`Midland practice checks passed (${n} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
