'use strict';
// Upstash Redis over REST, command form (POST ["CMD", ...args] to the root URL), 30-day TTL.
// Three kinds of key per session: the session, the roster, and one key per table,
// so four seats writing one table never contend with other tables.
const TTL = 30 * 24 * 3600;

// Compare-and-set: write only if the stored JSON still equals what the caller read.
const CAS = `local cur = redis.call('GET', KEYS[1])
if (cur == false and ARGV[1] == '') or cur == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]) return 1 end
return 0`;

const { configured: redisConfigured, command: redisCommand } = require('../../ec2/redis-command');
async function cmd(...args) {
  if (!redisConfigured()) throw Object.assign(new Error('Session storage is not configured.'), { code: 'NO_STORE' });
  return redisCommand(args);
}

const k = {
  session: c => `wire:${c}`,
  roster: c => `wire:${c}:roster`,
  table: (c, t) => `wire:${c}:t:${t}`,
  course: c => `wire:course:${c}`,
  report: (c, p) => `wire:${c}:report:${p}`,
};
const ser = v => (v === null || v === undefined) ? '' : JSON.stringify(v);

const store = {
  configured: redisConfigured,
  async get(key) { const raw = await cmd('GET', key); return raw ? JSON.parse(raw) : null; },
  async cas(key, prev, next) { return (await cmd('EVAL', CAS, 1, key, ser(prev), ser(next), TTL)) === 1; },
  async getMany(keys) { if (!keys.length) return []; const raws = await cmd('MGET', ...keys); return raws.map(r => r ? JSON.parse(r) : null); },
};

module.exports = { store, keys: k };
