// Closing a session moves its students into Results on the class page; reopening brings them back.
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
process.env.LAUNCH_SECRET = 'class-roster-move-secret';
const { moveSessionRoster } = require('../lib/course-enrolments.js');
const token = (role, course) => {
  const now = Date.now();
  const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'r', sub: 'f1', name: 'F', role, sim: 'rapid-03-midland', mode: role === 'faculty' ? 'session' : 'play', course, iat: now, exp: now + 60000 })).toString('base64url');
  return `${body}.${createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url')}`;
};
(async () => {
  let n = 0; const check = (a, e, m) => { assert.deepEqual(a, e, m); n++; };
  const calls = [];
  global.fetch = async (url, opt) => { calls.push({ url, body: JSON.parse(opt.body), token: opt.headers['x-launch-token'] }); return { ok: true, json: async () => ({ ok: true }) }; };
  const sess = { code: 'ABCDE', name: 'Thu Oct 15, 9:40 AM', platformAuth: true, courseId: 'c1' };
  const people = { 'platform:ana': {}, 'platform:ben': {}, 'ABCD-standalone': {} };
  const req = lt => ({ headers: { 'x-launch-token': lt } });
  delete process.env.PLATFORM_URL;
  check((await moveSessionRoster(req(token('faculty', 'c1')), {}, sess, 'archive', people)).skipped, true, 'Without a configured platform nothing is sent');
  process.env.PLATFORM_URL = 'https://platform.test/';
  check((await moveSessionRoster(req(token('faculty', 'c1')), {}, sess, 'archive', people)).ok, true, 'Close sends the move');
  check([calls[0].url, calls[0].body], ['https://platform.test/api/session-enrolments', { courseId: 'c1', action: 'archive', participantIds: ['platform:ana', 'platform:ben'], sessionLabel: 'Thu Oct 15, 9:40 AM' }], 'Only platform students move, with the session name');
  await moveSessionRoster(req(token('faculty', 'c1')), {}, sess, 'restore', people);
  check(calls[1].body.action, 'restore', 'Reopen brings them back');
  check((await moveSessionRoster(req(token('faculty', 'c2')), {}, sess, 'archive', people)).skipped, true, 'A token for another class sends nothing');
  check((await moveSessionRoster(req(token('student', 'c1')), {}, sess, 'archive', people)).skipped, true, 'A student token sends nothing');
  check((await moveSessionRoster(req(token('faculty', 'c1')), {}, { ...sess, practice: true }, 'archive', people)).skipped, true, 'Practice sessions leave the class page alone');
  global.fetch = async () => { throw new Error('down'); };
  check((await moveSessionRoster(req(token('faculty', 'c1')), {}, sess, 'archive', people)).ok, false, 'If the platform is down, closing still works');
  check(calls.length, 2, 'Nothing else was sent');
  console.log(`RapidSim 03 class roster move checks passed (${n} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
