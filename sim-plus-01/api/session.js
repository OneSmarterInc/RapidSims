'use strict';
// The shared faculty pages (platform/public/kit/) call POST /api/session. Faculty sign in with the platform launch only.
const { body } = require('../lib/guard');
const store = require('../lib/store');
const KA = require('../lib/kit-api');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!store.configured()) return res.status(503).json({ error: 'no_store', message: 'Session storage is not configured.' });
  const b = body(req), a = String(b.action || '');
  if (!KA.KIT_ACTIONS.has(a)) return res.status(400).json({ error: 'unknown_action' });
  try {
    const r = await KA.kitAction(a, req, b, Date.now());
    return res.status(r.status).json(r.body);
  } catch (e) {
    console.error('simplus01 session', e.code || e.message);
    return res.status(500).json({ error: e.code === 'NO_STORE' ? 'no_store' : 'server_error' });
  }
};
