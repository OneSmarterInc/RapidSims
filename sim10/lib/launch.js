'use strict';
// Launch contract, copied from the platform (platform/lib/launch.js) and sim08.
// The platform signs base64url(JSON).base64url(HMAC-SHA256(LAUNCH_SECRET)).
// The sim verifies it on every request (X-Launch-Token), keeps no record of the
// person, and signs its own messages back with the same secret.
const crypto = require('crypto');
const config = require('../data/config');

const ROLES = ['student', 'faculty', 'faculty_preview'];

function verifyLaunch(token, now = Date.now()) {
  return require('../../shared/launch-contract').verifyLaunch(token, undefined, now);
}

// A valid token for THIS sim, with a person and a known role. Tokens for other
// sims must never work here just because the deployments share the secret.
function launchFor(token, now) {
  const p = verifyLaunch(token, now);
  return p && p.sim === config.simId && p.sub && ROLES.includes(p.role) ? p : null;
}
const isFaculty = (p) => !!p && (p.role === 'faculty' || p.role === 'faculty_preview');

function signBack(payload) {
  const secret = process.env.LAUNCH_SECRET;
  if (!secret) return null;
  const bodyPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return bodyPart + '.' + crypto.createHmac('sha256', secret).update(bodyPart).digest('base64url');
}

async function post(path, token) {
  const base = (process.env.PLATFORM_URL || '').replace(/\/$/, '');
  if (!base || !token) return { ok: false, skipped: true };
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(6000) });
  if (!r.ok) { console.error(`${path} refused`, r.status, await r.text().catch(() => '')); return { ok: false, status: r.status }; }
  return { ok: true };
}

// Best effort: the student has already finished when this runs.
async function reportCompletion(options) {
  return require('../../shared/report-delivery').reportCompletion(options);
}

// One catalogue announcement per cold start; a failure resets so a later request retries.
let announced = null;
function announce() {
  if (announced) return announced;
  const selfUrl = (process.env.SIM_URL || '').replace(/\/+$/, '');
  if (!process.env.PLATFORM_URL || !selfUrl) return Promise.resolve();
  announced = post('/api/register', signBack({
    kind: 'register', protocolVersion: 2, sim: config.simId, number: 10, title: config.title, tagline: config.tagline,
    description: config.description, minutes: config.minutes, detail: config.detail,
    catalogueRevision: config.catalogueRevision, launchUrl: selfUrl,
    iat: Date.now(), exp: Date.now() + 5 * 60000,
  })).then((r) => { if (!r.ok && !r.skipped) throw new Error('refused'); })
    .catch((e) => { console.error('announce failed', e.message); announced = null; });
  return announced;
}
function resetAnnounce() { announced = null; }

module.exports = { verifyLaunch, launchFor, isFaculty, signBack, reportCompletion, announce, resetAnnounce, ROLES };

