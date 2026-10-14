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

// Sends the instructor transcript to its dedicated platform endpoint. Await this
// before responding: a serverless function may freeze as soon as it returns.
async function reportTranscript(options) {
  return require('../../shared/report-delivery').reportTranscript(options);
}

// Tells the platform this simulation exists, once per cold start. The platform
// creates a catalogue entry — unpublished, so nobody sees it until an
// administrator decides — and thereafter only refreshes the technical facts,
// leaving anything they have edited alone.
//
// Registration is best-effort and must never become a participant-facing
// failure. If the platform is temporarily slow or unavailable, clear the
// cold-start latch so the next request can retry rather than pinning a rejected
// promise for the lifetime of the function instance.
let announced = null;
function announce(meta, selfUrl) {
  if (announced) return announced;
  announced = Promise.resolve();
  const base = (process.env.PLATFORM_URL || '').replace(/\/$/, '');
  if (!base || !meta) return announced;
  const token = signBack({
    kind: 'register', protocolVersion: 2,
    sim: meta.id,
    number: 101,
    title: meta.title,
    tagline: meta.tagline,
    description: meta.description,
    minutes: meta.minutes,
    catalogueRevision: meta.catalogueRevision || null,
    replaces: Array.isArray(meta.replaces) ? meta.replaces.slice(0, 5) : [],
    detail: meta.detail || null,
    launchUrl: String(selfUrl || '').replace(/\/+$/, ''),
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
    if (r.ok) {
      console.log('announced', meta.id, 'to', base);
      return;
    }
    announced = null;
    console.warn('announce deferred; platform refused registration', r.status);
  }).catch((e) => {
    announced = null;
    const timedOut = /timeout|aborted/i.test(String(e && e.message));
    if (timedOut) console.warn('announce deferred; platform registration timed out');
    else console.warn('announce deferred; platform registration failed', e && e.message);
  });
  return announced;
}

module.exports = { verifyLaunch, signBack, reportCompletion, reportTranscript, announce };

