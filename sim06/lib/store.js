'use strict';
// Upstash/Vercel KV REST storage for Sim-06 sessions. Keys expire after 48 hours.
// Every write that can race is a compare-and-set in one Lua call; callers retry on false.
const { configured, command: cmd } = require('../../ec2/redis-command');

const TTL = 60 * 60 * 48;
const J = v => { try { return JSON.parse(v); } catch { return null; } };
const K = code => `m06:sess:${code}`;

async function hgetall(key) {
  const flat = await cmd(['HGETALL', key]) || [];
  const out = {};
  if (Array.isArray(flat)) for (let i = 0; i < flat.length; i += 2) out[flat[i]] = J(flat[i + 1]);
  else Object.entries(flat).forEach(([k, v]) => { out[k] = J(v); });
  return out;
}

const CAS_SESSION = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;

// Hash-field compare-and-set, guarded by the session still existing unchanged-or-open.
// Used for participants and for runs. An empty ARGV[2] means "field must not exist yet",
// which is what makes a team's first Switch/Stay press win.
const CAS_FIELD = `
if not redis.call('GET', KEYS[1]) then return 0 end
if (redis.call('HGET', KEYS[2], ARGV[1]) or '') ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 1
`;

module.exports = {
  configured,
  async getSession(code) { return J(await cmd(['GET', K(code)])); },
  async putSession(code, obj) { await cmd(['SET', K(code), JSON.stringify(obj), 'EX', String(TTL)]); return obj; },
  async compareAndSetSession(code, previous, next) {
    return Number(await cmd(['EVAL', CAS_SESSION, '1', K(code),
      JSON.stringify(previous), JSON.stringify(next), String(TTL)])) === 1;
  },
  async getParticipants(code) { return hgetall(`${K(code)}:p`); },
  async compareAndSetParticipant(code, id, previous, next) {
    return Number(await cmd(['EVAL', CAS_FIELD, '2', K(code), `${K(code)}:p`,
      id, previous ? JSON.stringify(previous) : '', JSON.stringify(next), String(TTL)])) === 1;
  },
  async getParticipant(code, id) { return J(await cmd(['HGET', `${K(code)}:p`, id])); },
  async getRun(code, runId) { return J(await cmd(['HGET', `${K(code)}:run`, runId])); },
  async getRuns(code) { return hgetall(`${K(code)}:run`); },
  async compareAndSetRun(code, runId, previous, next) {
    return Number(await cmd(['EVAL', CAS_FIELD, '2', K(code), `${K(code)}:run`,
      runId, previous ? JSON.stringify(previous) : '', JSON.stringify(next), String(TTL)])) === 1;
  },
  // One open session per class: the class link lands in it.
  async setCourseSession(courseId, code) { await cmd(['SET', `m06:course:${courseId}`, code, 'EX', String(TTL)]); },
  async getCourseSession(courseId) { return (await cmd(['GET', `m06:course:${courseId}`])) || null; },
  async clearCourseSession(courseId, code) {
    if ((await cmd(['GET', `m06:course:${courseId}`])) === code) await cmd(['DEL', `m06:course:${courseId}`]);
  },
  // Every session created for a class, newest first, for the faculty Sessions page.
  async addCourseSession(courseId, code, createdAt) {
    const key = `m06:course:${courseId}:sessions`;
    await cmd(['ZADD', key, String(Number(createdAt) || Date.now()), code]);
    await cmd(['EXPIRE', key, String(60 * 60 * 24 * 30)]);
  },
  async listCourseSessions(courseId) { return (await cmd(['ZREVRANGE', `m06:course:${courseId}:sessions`, '0', '19'])) || []; },
  // One practice run per faculty member and class (Rehearse).
  async setPracticeSession(courseId, ownerId, code) { await cmd(['SET', `m06:practice:${courseId}:${ownerId}`, code, 'EX', String(TTL)]); },
  async getPracticeSession(courseId, ownerId) { return (await cmd(['GET', `m06:practice:${courseId}:${ownerId}`])) || null; },
  async clearPracticeSession(courseId, ownerId) { await cmd(['DEL', `m06:practice:${courseId}:${ownerId}`]); },
  async wipe(code) { await cmd(['DEL', K(code), `${K(code)}:p`, `${K(code)}:run`]); },
};
