// Session storage over the Upstash/Vercel KV REST API.
// Deliberately dependency-free — it's just fetch against two environment variables,
// which Vercel's KV integration sets for you (KV_REST_API_URL, KV_REST_API_TOKEN).

const { configured, command: cmd } = require('../../ec2/redis-command');

// RapidSim+ may span multiple class meetings and devices. Keep resumable state for 30 days.
const NS = `rapidsims:${process.env.APP_ENV || 'production'}:sim-plus-01:`;
const TTL = 60 * 60 * 24 * 30;

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

  async getRaw(key) { return J(await cmd(['GET', NS + key])); },
  async putRaw(key, obj) {
    await cmd(['SET', NS + key, JSON.stringify(obj), 'EX', String(TTL)]);
    return obj;
  },

  async wipe(code) {
    await cmd(['DEL', `${NS}sess:${code}`, `${NS}sess:${code}:p`, `${NS}sess:${code}:run`]);
  }
};

