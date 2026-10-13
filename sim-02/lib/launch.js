// Verifies launch tokens issued by the platform. The sim never mints one and
// checks a scoped launch signature; result callbacks use a separate report key.
const crypto = require('crypto');

function verifyLaunch(token) {
  return require('../../shared/launch-contract').verifyLaunch(token);
}

// Signs a message back to the platform — same secret, opposite direction.
function signBack(payload) {
  const secret = process.env.LAUNCH_SECRET;
  if (!secret) return null;
  const bodyPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(bodyPart).digest('base64url');
  return bodyPart + '.' + mac;
}

// Persist server-signed results before delivery; the AWS outbox worker retries outages.
async function reportCompletion(options) {
  return require('../../shared/report-delivery').reportCompletion(options);
}

// Tells the platform this simulation exists, once per cold start. The platform
// creates a catalogue entry — unpublished, so nobody sees it until an
// administrator decides — and thereafter only refreshes the technical facts,
// leaving anything they have edited alone.
//
// Returns a promise. A serverless function can be frozen the moment it
// responds, so anything fire-and-forget may never leave the machine — the
// completion report had exactly this fault. Callers that can afford to wait
// should await it; it happens once per cold start and costs one round trip.
let announced = null;
function announce(meta, selfUrl) {
  if (announced) return announced;
  announced = Promise.resolve();
  const base = (process.env.PLATFORM_URL || '').replace(/\/$/, '');
  if (!base || !meta) return announced;
  const token = signBack({
    kind: 'register', protocolVersion: 2,
    sim: meta.id,
    number: 2,
    title: meta.title,
    tagline: meta.tagline,
    description: meta.description,
    minutes: meta.minutes,
    detail: meta.detail || null,
    catalogueRevision: meta.catalogueRevision || undefined,
    launchUrl: selfUrl || '',
    iat: Date.now(),
    exp: Date.now() + 5 * 60000
  });
  if (!token) return announced;
  announced = fetch(base + '/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(6000)
  }).then(async (r) => {
    if (r.ok) console.log('announced', meta.id, 'to', base);
    else console.error('announce refused', r.status, await r.text().catch(() => ''));
  }).catch(e => console.error('announce failed', e.message));
  return announced;
}

module.exports = { verifyLaunch, signBack, reportCompletion, announce };

