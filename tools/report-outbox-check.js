#!/usr/bin/env node
'use strict';
// The result queue against a real Redis: final refusals go to the dead-letter list, everything
// else keeps retrying, reports older than 7 days expire to the dead-letter list, a later revision
// keeps the first-queued time, and ec2/report-dead-letters.js lists without content and re-queues.
// Needs a disposable Redis: TEST_REDIS_URL, or a local redis-server binary (started on a free port).
// Run: node tools/report-outbox-check.js
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');

process.env.REPORT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.LAUNCH_SECRET = crypto.randomBytes(32).toString('hex');
delete process.env.REPORT_KEYS_JSON;
process.env.APP_ENV = 'outboxcheck' + crypto.randomBytes(3).toString('hex');
process.env.PLATFORM_URL = 'https://platform.example.test';

let n = 0;
const check = (v, m) => { assert(v, m); n++; console.log('PASS:', m); };

async function redisUrl() {
  if (process.env.TEST_REDIS_URL) return { url: process.env.TEST_REDIS_URL, stop: () => {} };
  if (spawnSync('redis-server', ['--version']).status !== 0) {
    console.log('SKIP report-outbox-check: set TEST_REDIS_URL or install redis-server'); process.exit(0);
  }
  const port = await new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
  const child = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise(r => { const c = net.connect(port, '127.0.0.1', () => { c.end(); r(true); }).on('error', () => r(false)); });
    if (ok) break; await new Promise(r => setTimeout(r, 100));
  }
  return { url: `redis://127.0.0.1:${port}`, stop: () => child.kill() };
}

(async () => {
  const redis = await redisUrl();
  process.env.REPORT_REDIS_URL = redis.url;
  const transport = require('../ec2/redis-command');
  const cmd = args => transport.command(args, redis.url);
  const outbox = require('../shared/report-outbox');
  const { reportCompletion } = require('../shared/report-delivery');
  const P = `rapidsims:${process.env.APP_ENV}:reports`;
  const nativeFetch = global.fetch;
  // The receiver, stood in for: answers as set per call.
  let answer = { status: 200 }, calls = 0;
  global.fetch = async () => { calls++; if (answer.throw) throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body || {} }; };
  const launch = run => ({ sub: 'student-' + run, sim: 'rapid-01-disaster', course: 'course-1', run: 'launch-' + run, iat: Date.now() });
  const send = (run, extra = {}) => reportCompletion({ launch: launch(run), summary: 'SECRET-SUMMARY-' + run, metrics: { revision: extra.revision || 1 } });
  const idOf = run => require('../shared/report-contract').makeReport('complete', { launch: launch(run), summary: null, metrics: null }).reportId;
  const pending = async () => (await cmd(['ZRANGE', P, '0', '-1'])) || [];
  const dead = async () => (await cmd(['ZRANGE', P + ':dead', '0', '-1'])) || [];
  const due = async id => cmd(['ZADD', P, '0', id]); // skip the retry lease
  try {
    // 1. Delivered: acknowledged, nothing left.
    answer = { status: 200 };
    let r = await send('ok');
    check(r.ok && !(await pending()).length && !(await dead()).length, 'A delivered report leaves the queue');

    // 2. Final refusals: dead-lettered at once, with status and error.
    answer = { status: 404, body: { error: 'no_matching_launch' } };
    r = await send('nolaunch');
    const idNo = idOf('nolaunch');
    check(r.deadLettered && !(await pending()).includes(idNo) && (await dead()).includes(idNo), '404 no_matching_launch goes to the dead-letter list, not the queue');
    let rec = await cmd(['HGETALL', P + ':dead:' + idNo]); rec = Object.fromEntries(rec.reduce((a, v, i, x) => i % 2 ? a : [...a, [v, x[i + 1]]], []));
    check(rec.status === '404' && rec.error === 'no_matching_launch' && rec.reason === 'refused' && rec.attempts === '1' && Number(rec.first) > 0 && Number(rec.deadAt) >= Number(rec.first) && JSON.parse(rec.report).reportId === idNo,
      'The dead-letter record keeps the report, status, error code, first-queued time, attempts and dead-letter time');
    for (const status of [400, 413]) {
      answer = { status, body: { error: 'bad_report' } };
      await send('final' + status);
      check((await dead()).includes(idOf('final' + status)), `${status} is final: dead-lettered`);
    }

    // 3. Retried: 500 no_secret, 401, other 5xx, other 404, network failure.
    const retryCases = [['no_secret', { status: 500, body: { error: 'no_secret' } }], ['401', { status: 401 }], ['503', { status: 503 }],
      ['404other', { status: 404, body: { error: 'not_found' } }], ['network', { throw: true }]];
    for (const [name, a] of retryCases) {
      answer = a; await send('retry-' + name);
      check((await pending()).includes(idOf('retry-' + name)) && !(await dead()).includes(idOf('retry-' + name)), `${name} stays on the queue for retry`);
    }
    // The worker retries them: still failing keeps them queued and counts attempts.
    answer = { status: 500, body: { error: 'no_secret' } };
    for (const [name] of retryCases) await due(idOf('retry-' + name));
    let d = await outbox.drain();
    check(d.delivered === 0 && d.deadLettered === 0 && d.pending === retryCases.length, 'The worker keeps retrying while the receiver answers 500');
    check((await cmd(['HGET', P + ':meta:' + idOf('retry-no_secret'), 'attempts'])) === '2', 'Each attempt is counted');
    // A refusal on retry is final.
    answer = { status: 404, body: { error: 'no_matching_launch' } };
    await due(idOf('retry-401'));
    d = await outbox.drain();
    check(d.deadLettered === 1 && (await dead()).includes(idOf('retry-401')), 'A final refusal during a retry dead-letters the report');
    // Recovery: delivered on the next retry.
    answer = { status: 200 };
    await due(idOf('retry-503'));
    d = await outbox.drain();
    check(d.delivered === 1 && !(await pending()).includes(idOf('retry-503')), 'A retried report is delivered once the receiver recovers');

    // 4. Seven days: the first-queued time survives a later revision; older than 7 days expires.
    answer = { status: 503 };
    await send('old');
    const idOld = idOf('old'), firstOld = await cmd(['HGET', P + ':meta:' + idOld, 'first']);
    await new Promise(res => setTimeout(res, 5));
    await send('old', { revision: 2 });
    check((await cmd(['HGET', P + ':meta:' + idOld, 'first'])) === firstOld && JSON.parse(await cmd(['GET', P + ':' + idOld])).metrics.revision === 2,
      'A later revision replaces the report and keeps the first-queued time');
    await cmd(['HSET', P + ':meta:' + idOld, 'first', String(Date.now() - outbox.MAX_AGE_MS - 1000)]);
    await due(idOld); calls = 0;
    d = await outbox.drain();
    rec = await cmd(['HMGET', P + ':dead:' + idOld, 'reason', 'first']);
    check(d.deadLettered === 1 && rec[0] === 'expired' && rec[1] !== firstOld && calls === 0 && (await dead()).includes(idOld), 'A report older than 7 days goes to the dead-letter list as expired, without another attempt');
    // A report queued before this change (no first-queued time) starts its clock at the next attempt.
    answer = { status: 503 };
    await send('legacy'); await cmd(['DEL', P + ':meta:' + idOf('legacy')]); await due(idOf('legacy'));
    await outbox.drain();
    check(Number(await cmd(['HGET', P + ':meta:' + idOf('legacy'), 'first'])) > Date.now() - 60000, 'A report without a first-queued time gets one and keeps retrying');
    // A new revision of a dead-lettered report returns to the queue with its original time.
    const firstNo = await cmd(['HGET', P + ':dead:' + idNo, 'first']);
    answer = { status: 503 };
    await send('nolaunch', { revision: 2 });
    check((await pending()).includes(idNo) && !(await dead()).includes(idNo) && (await cmd(['HGET', P + ':meta:' + idNo, 'first'])) === firstNo,
      'A new revision of a dead-lettered report is queued again with its original first-queued time');

    // 5. The script: lists identifiers without content; re-queues one report.
    const tool = require('../ec2/report-dead-letters.js');
    const lines = []; const log = console.log; console.log = (...a) => lines.push(a.join(' '));
    try { await tool.main([]); await tool.main(['--json']); } finally { console.log = log; }
    const printed = lines.join('\n');
    check(printed.includes(idOld) && printed.includes('rapid-01-disaster') && printed.includes('student-old') && printed.includes('launch-old') && printed.includes('expired') && printed.includes('refused'),
      'The script lists sim, student id, launch id, reason and dates');
    check(!/SECRET-SUMMARY/.test(printed) && !/"summary"|"metrics"|"envelope"/.test(printed), 'The script never prints summaries, metrics or transcripts');
    const before = (await dead()).length;
    lines.length = 0; console.log = (...a) => lines.push(a.join(' '));
    let code; try { code = await tool.main(['requeue', idOld]); } finally { console.log = log; }
    check(code === 0 && (await pending()).includes(idOld) && !(await dead()).includes(idOld) && (await dead()).length === before - 1, 'requeue puts one dead-lettered report back on the queue');
    answer = { status: 200 }; await due(idOld);
    d = await outbox.drain();
    check(!(await pending()).includes(idOld), 'The re-queued report is delivered by the worker');
    check((await tool.main(['requeue', 'nope'])) === 2, 'requeue needs a full report id');

    // Nothing expires on its own.
    const ttls = await Promise.all((await dead()).map(id => cmd(['TTL', P + ':dead:' + id])));
    check(ttls.every(t => Number(t) === -1) && Number(await cmd(['TTL', P + ':dead'])) === -1, 'Dead-letter records have no expiry; nothing is deleted automatically');
  } finally {
    global.fetch = nativeFetch;
    const keys = await cmd(['KEYS', P + '*']); if (keys && keys.length) await cmd(['DEL', ...keys]);
    redis.stop();
  }
  console.log(`PASS report-outbox-check: ${n} assertions`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
