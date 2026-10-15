// Session storage over the Upstash/Vercel KV REST API.
// Deliberately dependency-free — it's just fetch against two environment variables,
// which Vercel's KV integration sets for you (KV_REST_API_URL, KV_REST_API_TOKEN).

const { configured, command: cmd } = require('../../ec2/redis-command');

// Sessions expire on their own so nothing accumulates. Two days is plenty for a class.
const NS = `rapidsims:${process.env.APP_ENV || 'production'}:sim-02:`;
const TTL = 60 * 60 * 48;

const J = (v) => { try { return JSON.parse(v); } catch { return null; } };

module.exports = {
  configured,

  async getSession(code) { return J(await cmd(['GET', `${NS}sess:${code}`])); },

  async putSession(code, obj) {
    await cmd(['SET', `${NS}sess:${code}`, JSON.stringify(obj), 'EX', String(TTL)]);
    return obj;
  },

  // Participants and groups live in hashes so simultaneous joins can't clobber each other.
  async addParticipant(code, id, obj) {
    await cmd(['HSET', `${NS}sess:${code}:p`, id, JSON.stringify(obj)]);
    await cmd(['EXPIRE', `${NS}sess:${code}:p`, String(TTL)]);
  },
  async getParticipants(code) {
    const flat = await cmd(['HGETALL', `${NS}sess:${code}:p`]) || [];
    const out = {};
    if (Array.isArray(flat)) for (let i = 0; i < flat.length; i += 2) out[flat[i]] = J(flat[i + 1]);
    else Object.entries(flat).forEach(([k, v]) => out[k] = J(v));
    return out;
  },
  async setParticipant(code, id, obj) {
    await cmd(['HSET', `${NS}sess:${code}:p`, id, JSON.stringify(obj)]);
  },

  async setRun(code, groupId, obj) {
    await cmd(['HSET', `${NS}sess:${code}:run`, groupId, JSON.stringify(obj)]);
    await cmd(['EXPIRE', `${NS}sess:${code}:run`, String(TTL)]);
  },
  async getRuns(code) {
    const flat = await cmd(['HGETALL', `${NS}sess:${code}:run`]) || [];
    const out = {};
    if (Array.isArray(flat)) for (let i = 0; i < flat.length; i += 2) out[flat[i]] = J(flat[i + 1]);
    else Object.entries(flat).forEach(([k, v]) => out[k] = J(v));
    return out;
  },

  // One pointer per class to its open session, so a student's class link lands in it.
  async setCourseSession(courseId, code) { await cmd(['SET', `${NS}course:${courseId}`, code, 'EX', String(TTL)]); },
  async getCourseSession(courseId) { return (await cmd(['GET', `${NS}course:${courseId}`])) || null; },
  async clearCourseSession(courseId, code) {
    if ((await cmd(['GET', `${NS}course:${courseId}`])) === code) await cmd(['DEL', `${NS}course:${courseId}`]);
  },
  // Every session created for a class, newest first, for the Sessions page.
  async addCourseSession(courseId, code, createdAt) {
    const key = `${NS}course:${courseId}:sessions`;
    await cmd(['ZADD', key, String(Number(createdAt) || Date.now()), code]);
    await cmd(['EXPIRE', key, String(60 * 60 * 24 * 30)]);
  },
  async listCourseSessions(courseId) {
    return (await cmd(['ZREVRANGE', `${NS}course:${courseId}:sessions`, '0', '19'])) || [];
  },
  // One practice session per faculty member and class (Rehearse).
  async setPracticeSession(courseId, ownerId, code) { await cmd(['SET', `${NS}practice:${courseId}:${ownerId}`, code, 'EX', String(TTL)]); },
  async getPracticeSession(courseId, ownerId) { return (await cmd(['GET', `${NS}practice:${courseId}:${ownerId}`])) || null; },
  async clearPracticeSession(courseId, ownerId) { await cmd(['DEL', `${NS}practice:${courseId}:${ownerId}`]); },

  async wipe(code) {
    await cmd(['DEL', `${NS}sess:${code}`, `${NS}sess:${code}:p`, `${NS}sess:${code}:run`]);
  }
};

