'use strict';
const crypto = require('node:crypto');

function verifyLaunch(token, expectedSim, now = Date.now()) {
  const secret = process.env.LAUNCH_SECRET;
  if (!secret || typeof token !== 'string' || token.length > 32768 || !/^[\w-]+\.[\w-]+$/.test(token)) return null;
  try {
    const [body, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(body).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p?.kind !== 'launch' || !Number.isFinite(p.exp) || now >= p.exp ||
        typeof p.sub !== 'string' || !p.sub || typeof p.run !== 'string' || !p.run ||
        typeof p.sim !== 'string' || !p.sim || (expectedSim && p.sim !== expectedSim) ||
        !['student', 'faculty', 'faculty_preview'].includes(p.role)) return null;
    return p;
  } catch { return null; }
}

module.exports = { verifyLaunch };
