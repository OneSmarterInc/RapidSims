// Shared launch contract for RapidSim 07.
// The sim verifies platform tokens; it never mints platform launch tokens itself.
const crypto = require('crypto');

function verifyLaunch(token) {
  return require('../../shared/launch-contract').verifyLaunch(token);
}

function signBack(payload) {
  const secret = process.env.LAUNCH_SECRET;
  if (!secret) return null;
  const bodyPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(bodyPart).digest('base64url');
  return bodyPart + '.' + mac;
}

async function reportCompletion(options) {
  return require('../../shared/report-delivery').reportCompletion(options);
}

// One catalogue announcement per cold start. A failed announcement is reset so a
// later request can retry rather than pinning the cold start to a failed promise.
let announced = null;
function announce(meta, selfUrl) {
  if (announced) return announced;
  const base = (process.env.PLATFORM_URL || '').replace(/\/$/, '');
  if (!base || !meta) return Promise.resolve();

  const token = signBack({
    kind: 'register', protocolVersion: 2,
    sim: meta.id,
    number: 7,
    title: meta.title,
    tagline: meta.tagline,
    description: meta.description,
    minutes: meta.minutes,
    detail: meta.detail || null,
    replaces: Array.isArray(meta.replaces) ? meta.replaces.slice(0, 5) : undefined,
    catalogueRevision: meta.catalogueRevision || undefined,
    launchUrl: selfUrl || '',
    iat: Date.now(),
    exp: Date.now() + 5 * 60000
  });
  if (!token) return Promise.resolve();

  announced = fetch(base + '/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(6000)
  }).then(async (r) => {
    if (!r.ok) throw new Error(`announce refused ${r.status}: ${await r.text().catch(() => '')}`);
    console.log('announced', meta.id, 'to', base);
  }).catch((e) => {
    console.error('announce failed', e.message);
    announced = null;
  });
  return announced;
}

module.exports = { verifyLaunch, signBack, reportCompletion, announce };

