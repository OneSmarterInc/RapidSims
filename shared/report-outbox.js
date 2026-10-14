'use strict';

const transport = require('../ec2/redis-command');
// All services and the worker must use the same durable outbox, even when
// simulation session databases are isolated from one another.
const command = args => transport.command(args, process.env.REPORT_REDIS_URL);
const prefix = () => `rapidsims:${process.env.APP_ENV || 'production'}:reports`;
const key = id => `${prefix()}:${id}`;
async function enqueue(report) {
  // No TTL: pending academic records must not silently expire during an outage.
  await command(['EVAL', "redis.call('SET',KEYS[1],ARGV[1],'NX'); redis.call('ZADD',KEYS[2],ARGV[2],ARGV[3]); return 1",
    '2', key(report.reportId), prefix(), JSON.stringify(report), String(Date.now()), report.reportId]);
}
async function acknowledge(id) {
  await command(['EVAL', "redis.call('ZREM',KEYS[1],ARGV[1]); redis.call('DEL',KEYS[2]); return 1", '2', prefix(), key(id), id]);
}
async function drain(limit = 25) {
  const ids = await command(['ZRANGEBYSCORE', prefix(), '-inf', String(Date.now()), 'LIMIT', '0', String(limit)]) || [];
  const { deliver } = require('./report-delivery');
  let delivered = 0;
  for (const id of ids) {
    // Lease by score; duplicate workers are harmless because the receiver deduplicates.
    await command(['ZADD', prefix(), String(Date.now() + 60000), id]);
    const raw = await command(['GET', key(id)]);
    if (!raw) { await acknowledge(id); continue; }
    try {
      if ((await deliver(JSON.parse(raw))).ok) { await acknowledge(id); delivered++; }
    } catch (error) { console.error('Report retry deferred:', error.code || error.message); }
  }
  return { delivered, pending: Number(await command(['ZCARD', prefix()])) };
}
module.exports = { enqueue, acknowledge, drain };
