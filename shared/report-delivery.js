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
  // The receiver names a refusal in its error field (for example no_matching_launch); the outbox
  // reads it to tell a final refusal from one worth retrying.
  let error = null;
  if (!response.ok) {
    try { const body = await response.json(); if (body && typeof body.error === 'string') error = body.error.slice(0, 100); } catch {}
  }
  return { ok: response.ok, status: response.status, error };
}

async function report(kind, options) {
  if (!options.launch?.sub) return { ok: false, skipped: true };
  let queued = false;
  try {
    const payload = makeReport(kind, options);
    // Persist before attempting delivery. The AWS worker retries after process restarts.
    const outbox = require('./report-outbox');
    await outbox.enqueue(payload);
    queued = true;
    const result = await deliver(payload);
    // Delivered: acknowledged. Final refusal (404 no_matching_launch, 400, 413): dead-lettered.
    // Anything else stays queued for the worker to retry.
    const outcome = outbox.settle ? await outbox.settle(payload.reportId, result)
      : (result.ok ? (await outbox.acknowledge(payload.reportId), 'delivered') : 'retry');
    return { ...result, queued, pending: outcome === 'retry', deadLettered: outcome === 'final' };
  } catch (error) {
    console.error('Result delivery deferred:', error.code || error.message);
    return { ok: false, queued, pending: queued };
  }
}

module.exports = { deliver, reportCompletion: options => report('complete', options),
  reportTranscript: options => report('transcript', options) };
