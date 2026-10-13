'use strict';

const { signReport, makeReport } = require('./report-contract');

async function deliver(report) {
  const base = (process.env.PLATFORM_URL || '').replace(/\/+$/, '');
  if (!base) return { ok: false, reason: 'no_platform_url' };
  const now = Date.now();
  const token = signReport({ ...report, iat: now, exp: now + 300000 });
  const response = await fetch(base + (report.kind === 'transcript' ? '/api/transcript' : '/api/complete'), {
    method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }), signal: AbortSignal.timeout(8000)
  });
  return { ok: response.ok, status: response.status };
}

async function report(kind, options) {
  if (!options.launch?.sub) return { ok: false, skipped: true };
  let queued = false;
  try {
    const payload = makeReport(kind, options);
    // Persist before attempting delivery. The AWS worker retries after process restarts.
    const { enqueue, acknowledge } = require('./report-outbox');
    await enqueue(payload);
    queued = true;
    const result = await deliver(payload);
    if (result.ok) await acknowledge(payload.reportId);
    return { ...result, queued, pending: !result.ok };
  } catch (error) {
    console.error('Result delivery deferred:', error.code || error.message);
    return { ok: false, queued, pending: queued };
  }
}

module.exports = { deliver, reportCompletion: options => report('complete', options),
  reportTranscript: options => report('transcript', options) };
