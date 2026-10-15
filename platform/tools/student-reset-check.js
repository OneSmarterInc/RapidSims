#!/usr/bin/env node
'use strict';
// Faculty create a one-time password reset link for a student on their own
// course; the student sets a new password with it and signs in. Real handlers; PGlite.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
(async () => {
  let n = 0; const check = (a, e, m) => { assert.deepEqual(a, e, m); n++; };
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../lib/schema.sql'), 'utf8'));
  const s = async (strings, ...values) => (await db.query(strings.reduce((q, t, i) => q + (i ? '$' + i : '') + t, ''), values)).rows;
  s.query = async (text, values) => (await db.query(text, values)).rows;
  s.transaction = async fn => { await db.exec('BEGIN'); try { const r = await fn(s); await db.exec('COMMIT'); return r; } catch (e) { await db.exec('ROLLBACK'); throw e; } };
  const dbFile = require.resolve('../lib/db.js');
  require.cache[dbFile] = { id: dbFile, filename: dbFile, loaded: true, exports: { sql: () => s, id: p => p + '_' + Math.random().toString(36).slice(2) } };
  for (const id of ['f1', 'f2']) {
    await s`INSERT INTO users(id,name,email,role) VALUES(${id},${'Faculty ' + id},${id + '@example.test'},'faculty')`;
    await s`INSERT INTO sessions(id,user_id,expires_at) VALUES(${id},${id},now()+interval '1 day')`;
  }
  await s`INSERT INTO users(id,name,email,role,password_hash) VALUES('stu','Ana Real','ana@example.test','student','old')`;
  await s`INSERT INTO courses(id,faculty_id,title,join_code) VALUES('c1','f1','MIS3000','JOIN01'),('c2','f2','Other','JOIN02')`;
  await s`INSERT INTO enrolments(id,course_id,student_id,paid,dropped) VALUES('e1','c1','stu',true,false)`;
  const faculty = require('../api/faculty.js'), auth = require('../api/auth.js');
  async function call(handler, body, cookie) {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers: { cookie: cookie ? 'fx_sess=' + cookie : '', host: 'rapidsims.test', 'x-forwarded-for': '203.0.113.9' }, socket: { remoteAddress: '203.0.113.9' }, body }, res);
    return res;
  }
  let r = await call(faculty, { action: 'student_reset_link', courseId: 'c1', enrolmentId: 'e1' }, 'f1');
  check([r.statusCode, r.body.who, /\/reset\.html\?t=[\w-]+$/.test(r.body.resetUrl)], [200, 'Ana Real', true], 'Faculty create a reset link for their student');
  check((await call(faculty, { action: 'student_reset_link', courseId: 'c1', enrolmentId: 'e1' }, 'f2')).statusCode, 404, 'Another faculty member cannot');
  check((await call(faculty, { action: 'student_reset_link', courseId: 'c2', enrolmentId: 'e1' }, 'f2')).statusCode, 404, 'A student on another course cannot be reached');
  const token = new URL(r.body.resetUrl).searchParams.get('t');
  r = await call(auth, { action: 'reset_accept', token, password: 'a-new-password-123' });
  check(r.statusCode, 200, 'The student sets a new password with the link');
  check((await call(auth, { action: 'reset_accept', token, password: 'another-password-456' })).statusCode >= 400, true, 'The link works once');
  r = await call(auth, { action: 'signin', email: 'ana@example.test', password: 'a-new-password-123' });
  check(r.statusCode, 200, 'The student signs in with the new password');
  check((await s`SELECT count(*)::int AS n FROM enrolments WHERE student_id='stu' AND dropped=false`)[0].n, 1, 'The enrolment stays as it is');
  console.log(`Student password reset checks passed (${n} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
