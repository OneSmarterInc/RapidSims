// Upstash/Vercel KV REST storage for RapidSim 07 sessions (48-hour expiry).
// W07_MEMORY_STORE=1 swaps in an in-process store for the dependency-free checks.
const { configured: redisConfigured, command: redisCommand } = require('../../ec2/redis-command');
const TTL = 60 * 60 * 48;
const J = (v) => { if (v == null) return null; try { return JSON.parse(v); } catch { return null; } };
const K = {
  sess: (c) => `w07:sess:${c}`,
  people: (c) => `w07:sess:${c}:p`,
  beat: (c) => `w07:sess:${c}:hb`
};
const MEMORY = () => process.env.W07_MEMORY_STORE === '1';
function configured() { return MEMORY() || redisConfigured(); }

async function cmd(args) {
  if (MEMORY()) throw new Error('Memory backend commands are not used');
  return redisCommand(args);
}

const CAS_SESSION = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;
// Participant writes are compared against both the session and the record, so
// a decision cannot land on a session that closed or restarted mid-request.
const CAS_PARTICIPANT = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
if (redis.call('HGET', KEYS[2], ARGV[2]) or '') ~= ARGV[3] then return 0 end
redis.call('HSET', KEYS[2], ARGV[2], ARGV[4])
local ttl = redis.call('TTL', KEYS[1])
if ttl > 0 then redis.call('EXPIRE', KEYS[2], ttl) end
return 1
`;
const CAS_ROSTER = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
local count = tonumber(ARGV[2])
if redis.call('HLEN', KEYS[2]) ~= count then return 0 end
for i = 1, count do
  local o = 3 + (i - 1) * 3
  if (redis.call('HGET', KEYS[2], ARGV[o]) or '') ~= ARGV[o + 1] then return 0 end
end
for i = 1, count do
  local o = 3 + (i - 1) * 3
  redis.call('HSET', KEYS[2], ARGV[o], ARGV[o + 2])
end
return 1
`;

// Create class-list entries without changing existing ones. -1 when the session changed.
const ENSURE_PARTICIPANTS = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return -1 end
local added = 0
for i = 2, #ARGV, 2 do
  added = added + redis.call('HSETNX', KEYS[2], ARGV[i], ARGV[i + 1])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl > 0 then redis.call('EXPIRE', KEYS[2], ttl) end
return added
`;
const COURSE = (id) => `w07:course:${id}`;
const COURSE_LIST = (id) => `w07:course:${id}:sessions`;
const PRACTICE = (id, owner) => `w07:practice:${id}:${owner}`;

// ---- in-memory backend (tests only) ----
const mem = { kv: new Map(), h: new Map() };
const memApi = {
  async getSession(c) { return J(mem.kv.get(K.sess(c))); },
  async putSession(c, o) { mem.kv.set(K.sess(c), JSON.stringify(o)); return o; },
  async compareAndSetSession(c, prev, next) {
    if ((mem.kv.get(K.sess(c)) || '') !== JSON.stringify(prev)) return false;
    mem.kv.set(K.sess(c), JSON.stringify(next)); return true;
  },
  async getParticipants(c) {
    const h = mem.h.get(K.people(c)) || new Map(); const out = {};
    for (const [k, v] of h) out[k] = J(v); return out;
  },
  async compareAndSetParticipant(c, id, prev, next, sess) {
    if ((mem.kv.get(K.sess(c)) || '') !== JSON.stringify(sess)) return false;
    const h = mem.h.get(K.people(c)) || new Map(); mem.h.set(K.people(c), h);
    if ((h.get(id) || '') !== (prev ? JSON.stringify(prev) : '')) return false;
    h.set(id, JSON.stringify(next)); return true;
  },
  async compareAndSetRoster(c, prev, next, sess) {
    if ((mem.kv.get(K.sess(c)) || '') !== JSON.stringify(sess)) return false;
    const h = mem.h.get(K.people(c)) || new Map(); mem.h.set(K.people(c), h);
    const ids = Object.keys(prev);
    if (h.size !== ids.length) return false;
    for (const id of ids) if ((h.get(id) || '') !== JSON.stringify(prev[id])) return false;
    for (const id of ids) h.set(id, JSON.stringify(next[id]));
    return true;
  },
  async beat(c) { mem.kv.set(K.beat(c), String(Date.now())); },
  async lastBeat(c) { return Number(mem.kv.get(K.beat(c)) || 0); },
  async wipe(c) { mem.kv.delete(K.sess(c)); mem.kv.delete(K.beat(c)); mem.h.delete(K.people(c)); },
  async ensureParticipants(c, people, sess) {
    if ((mem.kv.get(K.sess(c)) || '') !== JSON.stringify(sess)) return -1;
    const h = mem.h.get(K.people(c)) || new Map(); mem.h.set(K.people(c), h);
    let added = 0;
    for (const p of people) if (!h.has(p.id)) { h.set(p.id, JSON.stringify(p)); added++; }
    return added;
  },
  async addParticipant(c, id, obj) { const h = mem.h.get(K.people(c)) || new Map(); mem.h.set(K.people(c), h); h.set(id, JSON.stringify(obj)); },
  async setCourseSession(id, c) { mem.kv.set(COURSE(id), c); },
  async getCourseSession(id) { return mem.kv.get(COURSE(id)) || null; },
  async clearCourseSession(id, c) { if (mem.kv.get(COURSE(id)) === c) mem.kv.delete(COURSE(id)); },
  async addCourseSession(id, c, at) { const m = J(mem.kv.get(COURSE_LIST(id))) || {}; m[c] = Number(at) || Date.now(); mem.kv.set(COURSE_LIST(id), JSON.stringify(m)); },
  async listCourseSessions(id) { const m = J(mem.kv.get(COURSE_LIST(id))) || {}; return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([c]) => c); },
  async setPracticeSession(id, o, c) { mem.kv.set(PRACTICE(id, o), c); },
  async getPracticeSession(id, o) { return mem.kv.get(PRACTICE(id, o)) || null; },
  async clearPracticeSession(id, o) { mem.kv.delete(PRACTICE(id, o)); },
  _reset() { mem.kv.clear(); mem.h.clear(); }
};

// ---- Upstash backend ----
const kvApi = {
  async getSession(c) { return J(await cmd(['GET', K.sess(c)])); },
  async putSession(c, o) { await cmd(['SET', K.sess(c), JSON.stringify(o), 'EX', String(TTL)]); return o; },
  async compareAndSetSession(c, prev, next) {
    return Number(await cmd(['EVAL', CAS_SESSION, '1', K.sess(c), JSON.stringify(prev), JSON.stringify(next), String(TTL)])) === 1;
  },
  async getParticipants(c) {
    const flat = await cmd(['HGETALL', K.people(c)]) || [];
    const out = {};
    if (Array.isArray(flat)) for (let i = 0; i < flat.length; i += 2) out[flat[i]] = J(flat[i + 1]);
    else Object.entries(flat).forEach(([k, v]) => { out[k] = J(v); });
    return out;
  },
  async compareAndSetParticipant(c, id, prev, next, sess) {
    return Number(await cmd(['EVAL', CAS_PARTICIPANT, '2', K.sess(c), K.people(c),
      JSON.stringify(sess), id, prev ? JSON.stringify(prev) : '', JSON.stringify(next)])) === 1;
  },
  async compareAndSetRoster(c, prev, next, sess) {
    const entries = Object.entries(prev);
    return Number(await cmd(['EVAL', CAS_ROSTER, '2', K.sess(c), K.people(c), JSON.stringify(sess),
      String(entries.length), ...entries.flatMap(([id, p]) => [id, JSON.stringify(p), JSON.stringify(next[id])])])) === 1;
  },
  async beat(c) { await cmd(['SET', K.beat(c), String(Date.now()), 'EX', String(TTL)]); },
  async lastBeat(c) { return Number(await cmd(['GET', K.beat(c)]) || 0); },
  async wipe(c) { await cmd(['DEL', K.sess(c), K.people(c), K.beat(c)]); },
  async ensureParticipants(c, people, sess) {
    return Number(await cmd(['EVAL', ENSURE_PARTICIPANTS, '2', K.sess(c), K.people(c), JSON.stringify(sess),
      ...people.flatMap(p => [p.id, JSON.stringify(p)])]));
  },
  async addParticipant(c, id, obj) {
    await cmd(['HSET', K.people(c), id, JSON.stringify(obj)]);
    await cmd(['EXPIRE', K.people(c), String(TTL)]);
  },
  // One open session per class: the class link lands in it.
  async setCourseSession(id, c) { await cmd(['SET', COURSE(id), c, 'EX', String(TTL)]); },
  async getCourseSession(id) { return (await cmd(['GET', COURSE(id)])) || null; },
  async clearCourseSession(id, c) { if ((await cmd(['GET', COURSE(id)])) === c) await cmd(['DEL', COURSE(id)]); },
  // Every session created for a class, newest first, for the faculty Sessions page.
  async addCourseSession(id, c, at) {
    await cmd(['ZADD', COURSE_LIST(id), String(Number(at) || Date.now()), c]);
    await cmd(['EXPIRE', COURSE_LIST(id), String(60 * 60 * 24 * 30)]);
  },
  async listCourseSessions(id) { return (await cmd(['ZREVRANGE', COURSE_LIST(id), '0', '19'])) || []; },
  // One practice run per faculty member and class (Rehearse).
  async setPracticeSession(id, o, c) { await cmd(['SET', PRACTICE(id, o), c, 'EX', String(TTL)]); },
  async getPracticeSession(id, o) { return (await cmd(['GET', PRACTICE(id, o)])) || null; },
  async clearPracticeSession(id, o) { await cmd(['DEL', PRACTICE(id, o)]); }
};

const pick = (name) => (...a) => (MEMORY() ? memApi : kvApi)[name](...a);
module.exports = {
  configured,
  getSession: pick('getSession'),
  putSession: pick('putSession'),
  compareAndSetSession: pick('compareAndSetSession'),
  getParticipants: pick('getParticipants'),
  compareAndSetParticipant: pick('compareAndSetParticipant'),
  compareAndSetRoster: pick('compareAndSetRoster'),
  beat: pick('beat'),
  lastBeat: pick('lastBeat'),
  wipe: pick('wipe'),
  ensureParticipants: pick('ensureParticipants'),
  addParticipant: pick('addParticipant'),
  setCourseSession: pick('setCourseSession'),
  getCourseSession: pick('getCourseSession'),
  clearCourseSession: pick('clearCourseSession'),
  addCourseSession: pick('addCourseSession'),
  listCourseSessions: pick('listCourseSessions'),
  setPracticeSession: pick('setPracticeSession'),
  getPracticeSession: pick('getPracticeSession'),
  clearPracticeSession: pick('clearPracticeSession'),
  _resetMemory: () => memApi._reset()
};
