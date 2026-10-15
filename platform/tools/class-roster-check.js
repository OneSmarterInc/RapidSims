#!/usr/bin/env node
'use strict';
// Students belong to the session at hand. When a session closes its students move into
// Results; the next session starts with an empty class page. A student comes back by
// opening the class link or a sim again; reopening a session brings its students back.
// Real handlers; PGlite.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
process.env.LAUNCH_SECRET = process.env.LAUNCH_SECRET || 'class-roster-check-secret';
(async () => {
  let n = 0; const check = (a, e, m) => { assert.deepEqual(a, e, m); n++; };
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../lib/schema.sql'), 'utf8'));
  const s = async (strings, ...values) => (await db.query(strings.reduce((q, t, i) => q + (i ? '$' + i : '') + t, ''), values)).rows;
  s.query = async (text, values) => (await db.query(text, values)).rows;
  s.transaction = async fn => { await db.exec('BEGIN'); try { const r = await fn(s); await db.exec('COMMIT'); return r; } catch (e) { await db.exec('ROLLBACK'); throw e; } };
  const dbFile = require.resolve('../lib/db.js');
  require.cache[dbFile] = { id: dbFile, filename: dbFile, loaded: true, exports: { sql: () => s, id: p => p + '_' + Math.random().toString(36).slice(2) } };
  await s`INSERT INTO users(id,name,email,role) VALUES('f1','Faculty One','f1@example.test','faculty')`;
  await s`INSERT INTO sessions(id,user_id,expires_at) VALUES('f1','f1',now()+interval '1 day')`;
  for (const [id, name] of [['ana', 'Ana'], ['ben', 'Ben'], ['cal', 'Cal']]) {
    await s`INSERT INTO users(id,name,email,role) VALUES(${id},${name},${id + '@example.test'},'student')`;
    await s`INSERT INTO sessions(id,user_id,expires_at) VALUES(${'s-' + id},${id},now()+interval '1 day')`;
  }
  await s`INSERT INTO sims(id,title,launch_url,published) VALUES('rapid-03-midland','Midland Equipment','https://example.test/sim03',true)`;
  await s`INSERT INTO courses(id,faculty_id,title,join_code) VALUES('c1','f1','MIS3000','JOIN01')`;
  await s`INSERT INTO course_sims(course_id,sim_id) VALUES('c1','rapid-03-midland')`;
  await s`INSERT INTO enrolments(id,course_id,student_id,paid,dropped) VALUES('e-ana','c1','ana',true,false),('e-ben','c1','ben',true,false),('e-cal','c1','cal',true,false)`;

  const { launchToken } = require('../lib/launch.js');
  const lt = launchToken({ userId: 'f1', name: 'Faculty One', role: 'faculty', simId: 'rapid-03-midland', courseId: 'c1', mode: 'session', runId: 'x', minutes: 5 });
  const roster = require('../api/session-enrolments.js'), faculty = require('../api/faculty.js'), student = require('../api/student.js');
  async function call(handler, body, { cookie, token } = {}) {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, end() { return this; }, redirect() { return this; } };
    await handler({ method: 'POST', query: {}, headers: { cookie: cookie ? 'fx_sess=' + cookie : '', host: 'rapidsims.test', ...(token ? { 'x-launch-token': token } : {}) }, body }, res);
    return res;
  }
  const names = async () => (await call(roster, { courseId: 'c1' }, { token: lt })).body.students.map(x => x.name);
  const page = async () => (await call(faculty, { action: 'course_detail', courseId: 'c1' }, { cookie: 'f1' })).body.roster;

  check(await names(), ['Ana', 'Ben', 'Cal'], 'Before any session closes, every student is on the class page');
  let r = await call(roster, { courseId: 'c1', action: 'archive', participantIds: ['platform:ana', 'platform:ben', 'bad id'], sessionLabel: 'Thu Oct 15, 9:40 AM' }, { token: lt });
  check([r.statusCode, r.body.changed], [200, 2], 'Closing a session moves its students into Results');
  check(await names(), ['Cal'], 'The next session starts with only students who were not in it');
  const rows = await page();
  check(rows.filter(x => x.archived_at).map(x => [x.name, x.archived_session]).sort(), [['Ana', 'Thu Oct 15, 9:40 AM'], ['Ben', 'Thu Oct 15, 9:40 AM']], 'The class page knows which session they moved with');
  check(rows.length, 3, 'Nobody is deleted');

  r = await call(roster, { courseId: 'c1', action: 'restore', participantIds: ['platform:ben'] }, { token: lt });
  check(r.body.changed, 1, 'Reopening the session brings its students back');
  check(await names(), ['Ben', 'Cal'], 'Ben is on the class page again');

  r = await call(student, { action: 'enrol', joinCode: 'JOIN01' }, { cookie: 's-ana' });
  check(r.statusCode, 200, 'Ana opens the class link again');
  check(await names(), ['Ana', 'Ben', 'Cal'], 'and is back on the class page');

  await call(roster, { courseId: 'c1', action: 'archive', participantIds: ['platform:cal'] }, { token: lt });
  check((await call(faculty, { action: 'restore_student', courseId: 'c1', enrolmentId: 'e-cal' }, { cookie: 'f1' })).statusCode, 200, 'Faculty can bring a student back by hand');
  check(await names(), ['Ana', 'Ben', 'Cal'], 'Cal is back');

  const other = launchToken({ userId: 'f1', name: 'Faculty One', role: 'faculty', simId: 'rapid-03-midland', courseId: 'c9', mode: 'session', runId: 'y', minutes: 5 });
  check((await call(roster, { courseId: 'c1', action: 'archive', participantIds: ['platform:ana'] }, { token: other })).statusCode, 403, 'A token for another class cannot move these students');
  const studentLt = launchToken({ userId: 'ana', name: 'Ana', role: 'student', simId: 'rapid-03-midland', courseId: 'c1', mode: 'play', runId: 'z', minutes: 5 });
  check((await call(roster, { courseId: 'c1', action: 'archive', participantIds: ['platform:ben'] }, { token: studentLt })).statusCode, 401, 'A student cannot move anyone');
  console.log(`Class roster checks passed (${n} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
