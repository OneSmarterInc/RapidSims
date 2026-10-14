#!/usr/bin/env node
'use strict';
// The course page reads Midland's sessions through the platform, signed as the
// faculty member, and closes one. Real platform and Midland handlers; PGlite
// for the platform database; in-memory Midland storage.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
process.env.LAUNCH_SECRET = 'midland-course-row-secret';
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
  await s`INSERT INTO sims(id,number,title,launch_url,published) VALUES('rapid-03-midland',3,'Midland Equipment','https://midland.test/sim03',true)`;
  await s`INSERT INTO course_sims(course_id,sim_id) VALUES('c1','rapid-03-midland'),('c2','rapid-03-midland')`;

  // Midland with in-memory storage, reached through fetch.
  const store = require('../../sim03/lib/store.js');
  const copy = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const sessions = new Map(), index = new Map();
  store.configured = () => true;
  store.getSession = async c => copy(sessions.get(c) || null);
  store.putSession = async (c, v) => { sessions.set(c, copy(v)); return v; };
  store.compareAndSetSession = async (c, prev, next) => { if (JSON.stringify(sessions.get(c)) !== JSON.stringify(prev)) return false; sessions.set(c, copy(next)); return true; };
  store.getParticipants = async () => ({}); store.getRuns = async () => ({});
  store.setCourseTeamSession = async () => {}; store.getCourseTeamSession = async () => null; store.clearCourseTeamSession = async () => {};
  store.addCourseSession = async (course, c, at) => { const m = index.get(course) || new Map(); m.set(c, at); index.set(course, m); };
  store.listCourseSessions = async course => [...(index.get(course) || new Map()).keys()];
  const midland = require('../../sim03/api/session.js');
  const seen = [];
  global.fetch = async (url, opt) => {
    seen.push(url);
    const req = { method: 'POST', headers: { 'x-launch-token': opt.headers['x-launch-token'] }, body: JSON.parse(opt.body) };
    const res = { statusCode: 200, payload: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(v) { this.payload = v; return this; }, end() { return this; } };
    await midland(req, res);
    return { ok: res.statusCode < 300, status: res.statusCode, json: async () => res.payload };
  };
  process.env.SIM03_SESSION_URL = 'http://midland.internal/api/session';

  const faculty = require('../api/faculty.js');
  async function call(body, cookie = 'f1') {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
    await faculty({ method: 'POST', headers: { cookie: 'fx_sess=' + cookie, host: 'localhost' }, body }, res);
    return res;
  }

  let r = await call({ action: 'midland_sessions', courseId: 'c1' });
  check([r.statusCode, r.body.available, r.body.sessions], [200, true, []], 'No sessions yet');
  check(seen[0], 'http://midland.internal/api/session', 'The platform asks Midland directly');

  // Faculty create a group session in Midland the usual way.
  const { launchToken } = require('../lib/launch.js');
  const lt = launchToken({ userId: 'f1', name: 'Faculty f1', role: 'faculty', simId: 'rapid-03-midland', courseId: 'c1', mode: 'session', runId: 'x' });
  const created = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(v) { this.payload = v; return this; } };
  await midland({ method: 'POST', headers: { 'x-launch-token': lt }, body: { action: 'create', mode: 'team', name: 'Tuesday class' } }, created);
  const code = created.payload.session.code;

  r = await call({ action: 'midland_sessions', courseId: 'c1' });
  check(r.body.sessions.map(x => [x.code, x.name, x.mode, x.state]), [[code, 'Tuesday class', 'team', 'lobby']], 'The course row sees the open session');
  check((await call({ action: 'midland_sessions', courseId: 'c2' }, 'f2')).body.sessions, [], 'Another course and faculty member see only their own');
  check((await call({ action: 'midland_sessions', courseId: 'c1' }, 'f2')).statusCode, 404, 'A faculty member cannot read another course');
  check((await call({ action: 'midland_session_close', courseId: 'c1', code }, 'f2')).statusCode, 404, 'A faculty member cannot close another course\'s session');
  check((await call({ action: 'midland_session_close', courseId: 'c1', code: 'bad' })).statusCode, 400, 'A malformed code is refused');

  r = await call({ action: 'midland_session_close', courseId: 'c1', code });
  check([r.statusCode, r.body], [200, { ok: true }], 'Faculty close the session from the course page');
  r = await call({ action: 'midland_sessions', courseId: 'c1' });
  check(r.body.sessions[0].state, 'closed', 'The row shows it closed');

  global.fetch = async () => { throw new Error('down'); };
  r = await call({ action: 'midland_sessions', courseId: 'c1' });
  check([r.statusCode, r.body.available], [200, false], 'If Midland cannot be reached, the course page still loads');
  console.log(`Midland course row checks passed (${n} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
