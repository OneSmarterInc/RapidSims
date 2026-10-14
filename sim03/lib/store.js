// Upstash/Vercel KV REST storage for facilitated RapidSim 03 sessions.
// Sessions expire automatically after 48 hours.
const { configured, command: cmd } = require('../../ec2/redis-command');

const TTL = 60 * 60 * 48;
const J = (v) => { try { return JSON.parse(v); } catch { return null; } };

async function hgetall(key) {
  const flat = await cmd(['HGETALL', key]) || [];
  const out = {};
  if (Array.isArray(flat)) {
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = J(flat[i + 1]);
  } else {
    Object.entries(flat).forEach(([k, v]) => { out[k] = J(v); });
  }
  return out;
}

// Compare the run, session state and roster in one Redis operation. A handoff,
// pause or reassignment invalidates an in-flight write; callers reread/revalidate.
// Reflections share this path so concurrent member saves cannot erase each other.
const CAS_RUN = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
if (redis.call('HGET', KEYS[3], ARGV[2]) or '') ~= ARGV[3] then return 0 end
local count = tonumber(ARGV[6])
if redis.call('HLEN', KEYS[2]) ~= count then return 0 end
for i = 1, count do
  local offset = 7 + (i - 1) * 2
  if (redis.call('HGET', KEYS[2], ARGV[offset]) or '') ~= ARGV[offset + 1] then return 0 end
end
redis.call('HSET', KEYS[3], ARGV[2], ARGV[4])
redis.call('EXPIRE', KEYS[3], ARGV[5])
return 1
`;

// Create roster entries without changing existing assignments. The session
// comparison prevents an in-flight import from modifying a closed session.
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
const CAS_PARTICIPANT = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
if (redis.call('HGET', KEYS[2], ARGV[2]) or '') ~= ARGV[3] then return 0 end
redis.call('HSET', KEYS[2], ARGV[2], ARGV[4])
local ttl = redis.call('TTL', KEYS[1])
if ttl > 0 then redis.call('EXPIRE', KEYS[2], ttl) end
return 1
`;

// Roster edits are atomic too: a concurrent join/import invalidates the edit
// snapshot instead of losing attendance, assigning twice or replacing a lead.
const CAS_ROSTER = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
local count = tonumber(ARGV[2])
if redis.call('HLEN', KEYS[2]) ~= count then return 0 end
for i = 1, count do
  local offset = 3 + (i - 1) * 3
  if (redis.call('HGET', KEYS[2], ARGV[offset]) or '') ~= ARGV[offset + 1] then return 0 end
end
for i = 1, count do
  local offset = 3 + (i - 1) * 3
  redis.call('HSET', KEYS[2], ARGV[offset], ARGV[offset + 2])
end
return 1
`;

const CAS_SESSION = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;

module.exports = {
  configured,
  async compareAndSetSession(code, previous, next) {
    return Number(await cmd(['EVAL', CAS_SESSION, '1', `m03:sess:${code}`,
      JSON.stringify(previous), JSON.stringify(next), String(TTL)])) === 1;
  },
  async compareAndSetRoster(code, previous, next, session) {
    const entries = Object.entries(previous);
    return Number(await cmd(['EVAL', CAS_ROSTER, '2',
      `m03:sess:${code}`, `m03:sess:${code}:p`, JSON.stringify(session), String(entries.length),
      ...entries.flatMap(([id, p]) => [id, JSON.stringify(p), JSON.stringify(next[id])])])) === 1;
  },
  async ensureParticipants(code, people, session) {
    return Number(await cmd(['EVAL', ENSURE_PARTICIPANTS, '2',
      `m03:sess:${code}`, `m03:sess:${code}:p`, JSON.stringify(session),
      ...people.flatMap(p => [p.id, JSON.stringify(p)])]));
  },
  async compareAndSetParticipant(code, id, previous, next, session) {
    return Number(await cmd(['EVAL', CAS_PARTICIPANT, '2',
      `m03:sess:${code}`, `m03:sess:${code}:p`, JSON.stringify(session), id,
      previous ? JSON.stringify(previous) : '', JSON.stringify(next)])) === 1;
  },
  async getSession(code) { return J(await cmd(['GET', `m03:sess:${code}`])); },
  async putSession(code, obj) {
    await cmd(['SET', `m03:sess:${code}`, JSON.stringify(obj), 'EX', String(TTL)]);
    return obj;
  },
  async addParticipant(code, id, obj) {
    await cmd(['HSET', `m03:sess:${code}:p`, id, JSON.stringify(obj)]);
    await cmd(['EXPIRE', `m03:sess:${code}:p`, String(TTL)]);
  },
  async setParticipant(code, id, obj) {
    await cmd(['HSET', `m03:sess:${code}:p`, id, JSON.stringify(obj)]);
  },
  async getParticipants(code) { return hgetall(`m03:sess:${code}:p`); },

  async setRun(code, runId, obj) {
    await cmd(['HSET', `m03:sess:${code}:run`, runId, JSON.stringify(obj)]);
    await cmd(['EXPIRE', `m03:sess:${code}:run`, String(TTL)]);
  },
  async getRuns(code) { return hgetall(`m03:sess:${code}:run`); },
  async compareAndSetRun(code, runId, previous, next, session, participants) {
    const roster = Object.entries(participants).flatMap(([id, p]) => [id, JSON.stringify(p)]);
    const result = await cmd(['EVAL', CAS_RUN, '3',
      `m03:sess:${code}`, `m03:sess:${code}:p`, `m03:sess:${code}:run`,
      JSON.stringify(session), runId, previous ? JSON.stringify(previous) : '',
      JSON.stringify(next), String(TTL), String(roster.length / 2), ...roster]);
    return Number(result) === 1;
  },

  // One pointer per course to its open team session, so a student's direct
  // launch joins the team session instead of starting a solo run.
  async setCourseTeamSession(courseId, code, onlyIfMissing = false) {
    await cmd(['SET', `m03:course:${courseId}`, code, 'EX', String(TTL), ...(onlyIfMissing ? ['NX'] : [])]);
  },
  async getCourseTeamSession(courseId) { return (await cmd(['GET', `m03:course:${courseId}`])) || null; },
  async clearCourseTeamSession(courseId, code) {
    if ((await cmd(['GET', `m03:course:${courseId}`])) === code) await cmd(['DEL', `m03:course:${courseId}`]);
  },

  // Every session created for a course, newest first, so faculty can find and close them.
  async addCourseSession(courseId, code, createdAt) {
    const key = `m03:course:${courseId}:sessions`;
    await cmd(['ZADD', key, String(Number(createdAt) || Date.now()), code]);
    await cmd(['EXPIRE', key, String(60 * 60 * 24 * 30)]);
  },
  async listCourseSessions(courseId) {
    return (await cmd(['ZREVRANGE', `m03:course:${courseId}:sessions`, '0', '19'])) || [];
  },

  // One practice session per faculty member and course.
  async setPracticeSession(courseId, ownerId, code) {
    await cmd(['SET', `m03:practice:${courseId}:${ownerId}`, code, 'EX', String(TTL)]);
  },
  async getPracticeSession(courseId, ownerId) { return (await cmd(['GET', `m03:practice:${courseId}:${ownerId}`])) || null; },
  async clearPracticeSession(courseId, ownerId) { await cmd(['DEL', `m03:practice:${courseId}:${ownerId}`]); },

  async wipe(code) {
    await cmd(['DEL', `m03:sess:${code}`, `m03:sess:${code}:p`, `m03:sess:${code}:run`]);
  }
};
