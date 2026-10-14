'use strict';

const crypto = require('node:crypto');

function secret(sim) {
  // The platform can use per-simulation keys; each simulation only needs its own.
  const keys = process.env.REPORT_KEYS_JSON ? JSON.parse(process.env.REPORT_KEYS_JSON) : null;
  const value = keys ? keys[sim] : process.env.REPORT_SECRET;
  if (!value || value === process.env.LAUNCH_SECRET) throw new Error('A distinct report signing key is required');
  return value;
}

function signReport(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', secret(payload.sim)).update(body).digest('base64url');
}

function verifyReport(token, kind) {
  try {
    if (typeof token !== 'string' || token.length > 750000 || !/^[\w-]+\.[\w-]+$/.test(token)) return null;
    const [body, signature] = token.split('.');
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p.kind !== kind || p.version !== 2 || typeof p.sim !== 'string' || !p.sim ||
        typeof p.sub !== 'string' || !p.sub || !Number.isFinite(p.exp) || p.exp <= Date.now() ||
        !Number.isFinite(p.iat) || p.iat > Date.now() + 30000 || p.exp - p.iat > 600000 ||
        typeof p.runId !== 'string' || !p.runId || p.runId.length > 200 ||
        typeof p.launchId !== 'string' || !p.launchId || p.launchId.length > 200 ||
        !/^[a-f0-9]{64}$/.test(p.reportId || '')) return null;
    const expected = crypto.createHmac('sha256', secret(p.sim)).update(body).digest();
    const actual = Buffer.from(signature, 'base64url');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) &&
      p.reportId === reportId(p) ? p : null;
  } catch { return null; }
}

function reportId(p) {
  return crypto.createHash('sha256').update(JSON.stringify([p.kind, p.sim, p.sub, p.course || null, p.runId])).digest('hex');
}

function makeReport(kind, { launch, runId, summary, metrics, envelope }) {
  if (!launch?.sub || !launch.sim || !launch.run) throw new Error('Report requires an issued launch and run identity');
  const p = {
    version: 2, kind, sub: launch.sub, sim: launch.sim, course: launch.course || null,
    launchId: launch.run || null, runId: String(runId || launch.run),
    duration: launch.iat ? Math.max(0, Math.round((Date.now() - launch.iat) / 1000)) : null,
    summary: summary ?? null, metrics: metrics ?? null,
    ...(kind === 'transcript' ? { envelope: { ...envelope, simId: launch.sim } } : {})
  };
  p.reportId = reportId(p);
  return p;
}

module.exports = { signReport, verifyReport, makeReport, reportId };
