'use strict';
const crypto = require('node:crypto');
const { META } = require('./meta');

function signBack(payload) {
  if (!process.env.LAUNCH_SECRET) return null;
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', process.env.LAUNCH_SECRET).update(b).digest('base64url');
}
function verifyLaunch(token) {
  return require('../../shared/launch-contract').verifyLaunch(token, META.id);
}

let announced = null;
async function announce() {
  const base = process.env.PLATFORM_URL?.replace(/\/+$/, '');
  const self = process.env.SIM_URL?.replace(/\/+$/, '');
  if (!base || !self || !process.env.LAUNCH_SECRET) return false;
  if (announced) return announced;
  const now = Date.now();
  const token = signBack({
    kind: 'register', protocolVersion: 2, sim: META.id, number: META.number, title: META.title,
    tagline: META.tagline, description: META.description, detail: META.detail,
    minutes: META.minutes, catalogueRevision: META.catalogueRevision,
    launchUrl: self, iat: now, exp: now + 5 * 60000
  });
  announced = fetch(base + '/api/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }), signal: AbortSignal.timeout(6000)
  }).then(async r => {
    if (!r.ok) throw new Error(`Registration returned ${r.status}`);
    return true;
  }).catch(e => { console.error('Sim 04 registration failed:', e.message); announced = null; return false; });
  return announced;
}

async function reportCompletion({ participantId, courseId, runId, launchId, summary, metrics }) {
  if (!participantId?.startsWith('platform:')) return false;
  const result = await require('../../shared/report-delivery').reportCompletion({
    launch: { sub: participantId.slice(9), sim: META.id, course: courseId, run: launchId }, runId, summary, metrics });
  return result.ok;
}
module.exports = { signBack, verifyLaunch, announce, reportCompletion };

