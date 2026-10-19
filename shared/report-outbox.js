'use strict';

const transport = require('../ec2/redis-command');
// All services and the worker must use the same durable outbox, even when
// simulation session databases are isolated from one another.
const command = args => transport.command(args, process.env.REPORT_REDIS_URL);

// Keys, all under rapidsims:<env>:reports
//   reports            sorted set of pending report ids (score = next attempt time)
//   reports:<id>       the pending report (JSON)
//   reports:meta:<id>  hash: first (first-queued time, ms), attempts
//   reports:dead       sorted set of dead-lettered report ids (score = dead-letter time)
//   reports:dead:<id>  hash: report (JSON as queued), reportId, status, error, reason, first, attempts, deadAt
// Nothing here expires or is deleted automatically: pending and dead-lettered reports are
// student work and fall under the same retention and privacy rules.
const prefix = () => `rapidsims:${process.env.APP_ENV || 'production'}:reports`;
const key = id => `${prefix()}:${id}`;
const metaKey = id => `${prefix()}:meta:${id}`;
const deadIndex = () => `${prefix()}:dead`;
const deadKey = id => `${prefix()}:dead:${id}`;

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_LEASE_MS = 60000;

// What the receiver's answer means. Final refusals cannot be fixed by sending again.
function verdict(result) {
  if (result && result.ok) return 'delivered';
  const status = Number(result && result.status);
  if (status === 404 && result.error === 'no_matching_launch') return 'final';
  if (status === 400 || status === 413) return 'final';
  return 'retry'; // 401, 5xx (including no_secret), other 404s, network failures, no platform URL
}

const REV = `local function rev(raw) local ok, v = pcall(cjson.decode, raw or '')
  if ok and type(v) == 'table' and type(v.metrics) == 'table' and tonumber(v.metrics.revision) then return tonumber(v.metrics.revision) end
  return 0 end`;

async function enqueue(report) {
  // A later revision of the same report (higher metrics.revision) replaces a pending one and keeps
  // the first-queued time. If the report was dead-lettered, the new revision returns to the queue
  // with the original first-queued time and attempt count, and the dead-letter entry is cleared.
  await command(['EVAL', `${REV}
local cur = redis.call('GET', KEYS[1])
local dead = redis.call('HMGET', KEYS[5], 'report', 'first', 'attempts')
if (not cur) and dead[1] then cur = dead[1] end
if (not cur) or rev(ARGV[1]) > rev(cur) then cur = ARGV[1] end
redis.call('SET', KEYS[1], cur)
if redis.call('HEXISTS', KEYS[3], 'first') == 0 then
  redis.call('HSET', KEYS[3], 'first', dead[2] or ARGV[2], 'attempts', dead[3] or '0')
end
redis.call('DEL', KEYS[5]); redis.call('ZREM', KEYS[4], ARGV[3])
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3]) return 1`,
    '5', key(report.reportId), prefix(), metaKey(report.reportId), deadIndex(), deadKey(report.reportId),
    JSON.stringify(report), String(Date.now()), report.reportId]);
}

async function acknowledge(id) {
  await command(['EVAL', "redis.call('ZREM',KEYS[1],ARGV[1]); redis.call('DEL',KEYS[2]); redis.call('DEL',KEYS[3]); return 1",
    '3', prefix(), key(id), metaKey(id), id]);
}

// Moves one report to the dead-letter list, unless a newer revision replaced it meanwhile.
async function deadLetter(id, { reason, status = null, error = null }, expectedRaw = null) {
  return Number(await command(['EVAL', `local raw = redis.call('GET', KEYS[2])
if not raw then redis.call('ZREM', KEYS[1], ARGV[1]); redis.call('DEL', KEYS[3]); return 0 end
if ARGV[6] ~= '' and raw ~= ARGV[6] then return -1 end
local m = redis.call('HMGET', KEYS[3], 'first', 'attempts')
redis.call('HSET', KEYS[5], 'report', raw, 'reportId', ARGV[1], 'reason', ARGV[3], 'status', ARGV[4], 'error', ARGV[5],
  'first', m[1] or ARGV[2], 'attempts', m[2] or '0', 'deadAt', ARGV[2])
redis.call('ZADD', KEYS[4], ARGV[2], ARGV[1])
redis.call('ZREM', KEYS[1], ARGV[1]); redis.call('DEL', KEYS[2]); redis.call('DEL', KEYS[3]) return 1`,
    '5', prefix(), key(id), metaKey(id), deadIndex(), deadKey(id),
    id, String(Date.now()), reason, status == null ? '' : String(status), error == null ? '' : String(error).slice(0, 100), expectedRaw || '']));
}

// After a delivery attempt: count it, then acknowledge, dead-letter, or leave it for the next retry.
async function settle(id, result, raw = null) {
  await command(['HINCRBY', metaKey(id), 'attempts', '1']);
  const v = verdict(result);
  if (v === 'delivered') await acknowledge(id);
  else if (v === 'final') await deadLetter(id, { reason: 'refused', status: result.status ?? null, error: result.error ?? null }, raw);
  return v;
}

async function drain(limit = 25) {
  const ids = await command(['ZRANGEBYSCORE', prefix(), '-inf', String(Date.now()), 'LIMIT', '0', String(limit)]) || [];
  const { deliver } = require('./report-delivery');
  let delivered = 0, deadLettered = 0;
  for (const id of ids) {
    // Lease by score; duplicate workers are harmless because the receiver deduplicates.
    await command(['ZADD', prefix(), String(Date.now() + RETRY_LEASE_MS), id]);
    const raw = await command(['GET', key(id)]);
    if (!raw) { await acknowledge(id); continue; }
    // Reports queued before first-queued times were kept start their clock now.
    await command(['HSETNX', metaKey(id), 'first', String(Date.now())]);
    const first = Number(await command(['HGET', metaKey(id), 'first']));
    if (Date.now() - first > MAX_AGE_MS) {
      if (await deadLetter(id, { reason: 'expired' }, raw) === 1) deadLettered++;
      continue;
    }
    let result;
    try { result = await deliver(JSON.parse(raw)); }
    catch (error) { console.error('Report retry deferred:', error.code || error.message); result = { ok: false, status: null, error: error.code || 'network' }; }
    const v = await settle(id, result, raw);
    if (v === 'delivered') delivered++;
    else if (v === 'final') deadLettered++;
  }
  return { delivered, deadLettered, pending: Number(await command(['ZCARD', prefix()])) };
}

// For ec2/report-dead-letters.js: list dead-lettered reports (identifiers only) and re-queue one.
async function listDead(limit = 200) {
  const ids = await command(['ZRANGE', deadIndex(), '0', String(limit - 1)]) || [];
  const out = [];
  for (const id of ids) {
    const f = await command(['HMGET', deadKey(id), 'report', 'reason', 'status', 'error', 'first', 'attempts', 'deadAt']) || [];
    let r = {}; try { r = JSON.parse(f[0] || '{}'); } catch {}
    out.push({ reportId: id, kind: r.kind || null, sim: r.sim || null, studentId: r.sub || null, courseId: r.course || null,
      launchId: r.launchId || null, reason: f[1] || null, status: f[2] ? Number(f[2]) : null, error: f[3] || null,
      firstQueuedAt: f[4] ? Number(f[4]) : null, attempts: Number(f[5] || 0), deadAt: f[6] ? Number(f[6]) : null });
  }
  return out;
}

// Puts one dead-lettered report back on the queue for delivery now. The retry window starts again
// from this moment; the attempt count carries on.
async function requeue(id) {
  return Number(await command(['EVAL', `local d = redis.call('HMGET', KEYS[5], 'report', 'attempts')
if not d[1] then return 0 end
redis.call('SET', KEYS[2], d[1])
redis.call('DEL', KEYS[3]); redis.call('HSET', KEYS[3], 'first', ARGV[2], 'attempts', d[2] or '0', 'requeuedAt', ARGV[2])
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('ZREM', KEYS[4], ARGV[1]); redis.call('DEL', KEYS[5]) return 1`,
    '5', prefix(), key(id), metaKey(id), deadIndex(), deadKey(id), id, String(Date.now())]));
}

module.exports = { enqueue, acknowledge, settle, deadLetter, drain, listDead, requeue, verdict, MAX_AGE_MS };
