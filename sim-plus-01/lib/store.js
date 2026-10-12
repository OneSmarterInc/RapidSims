// Session storage over the Upstash/Vercel KV REST API.
// Deliberately dependency-free — it's just fetch against two environment variables,
// which Vercel's KV integration sets for you (KV_REST_API_URL, KV_REST_API_TOKEN).

const { configured, command: cmd } = require('../../ec2/redis-command');

// RapidSim+ may span multiple class meetings and devices. Keep resumable state for 30 days.
const TTL = 60 * 60 * 24 * 30;

const J = (v) => { try { return JSON.parse(v); } catch { return null; } };

module.exports = {
  configured,

  async getSession(code) { return J(await cmd(['GET', `sess:${code}`])); },

  async putSession(code, obj) {
    await cmd(['SET', `sess:${code}`, JSON.stringify(obj), 'EX', String(TTL)]);
    return obj;
  },

  // Participants and groups live in hashes so simultaneous joins can't clobber each other.
  async addParticipant(code, id, obj) {
    await cmd(['HSET', `sess:${code}:p`, id, JSON.stringify(obj)]);
    await cmd(['EXPIRE', `sess:${code}:p`, String(TTL)]);
  },
  async getParticipants(code) {
    const flat = await cmd(['HGETALL', `sess:${code}:p`]) || [];
    const out = {};
    if (Array.isArray(flat)) for (let i = 0; i < flat.length; i += 2) out[flat[i]] = J(flat[i + 1]);
    else Object.entries(flat).forEach(([k, v]) => out[k] = J(v));
    return out;
  },
  async setParticipant(code, id, obj) {
    await cmd(['HSET', `sess:${code}:p`, id, JSON.stringify(obj)]);
  },

  async setRun(code, groupId, obj) {
    await cmd(['HSET', `sess:${code}:run`, groupId, JSON.stringify(obj)]);
    await cmd(['EXPIRE', `sess:${code}:run`, String(TTL)]);
  },
  async getRuns(code) {
    const flat = await cmd(['HGETALL', `sess:${code}:run`]) || [];
    const out = {};
    if (Array.isArray(flat)) for (let i = 0; i < flat.length; i += 2) out[flat[i]] = J(flat[i + 1]);
    else Object.entries(flat).forEach(([k, v]) => out[k] = J(v));
    return out;
  },

  async getRaw(key) { return J(await cmd(['GET', key])); },
  async putRaw(key, obj) {
    await cmd(['SET', key, JSON.stringify(obj), 'EX', String(TTL)]);
    return obj;
  },

  async wipe(code) {
    await cmd(['DEL', `sess:${code}`, `sess:${code}:p`, `sess:${code}:run`]);
  }
};
