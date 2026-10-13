'use strict';
const crypto = require('node:crypto');
const WINDOW = 15 * 60 * 1000;
let lastCleanup = 0;

async function allow(s, req, identity) {
  const socket = req.socket?.remoteAddress || 'unknown';
  // Trust only the direct local reverse proxy, never arbitrary forwarded headers.
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(socket);
  const ip = local ? (req.headers['x-real-ip'] || socket) : socket;
  const now = Date.now();
  const window = new Date(Math.floor(now / WINDOW) * WINDOW);
  for (const [kind, value, limit] of [['ip', ip, 60], ['account', String(identity).toLowerCase(), 10]]) {
    const key = crypto.createHash('sha256').update(kind + ':' + value).digest('hex');
    const rows = await s`INSERT INTO auth_attempts (key, window_start, attempts) VALUES (${key}, ${window}, 1)
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN auth_attempts.window_start = EXCLUDED.window_start THEN auth_attempts.attempts + 1 ELSE 1 END,
        window_start = EXCLUDED.window_start RETURNING attempts`;
    if (rows[0].attempts > limit) return false;
  }
  if (now - lastCleanup > WINDOW) {
    await s`DELETE FROM auth_attempts WHERE window_start < ${new Date(now - WINDOW * 2)}`;
    lastCleanup = now;
  }
  return true;
}
module.exports = { allow };
