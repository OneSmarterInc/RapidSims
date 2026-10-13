'use strict';
// Unit tests stub only durable storage; they still exercise report signing and
// HTTP delivery. Real outbox transport/retry behavior has its own security tests.
process.env.REPORT_SECRET = require('node:crypto').randomBytes(32).toString('hex');
delete process.env.REPORT_KEYS_JSON;
const pending = new Map();
const filename = require.resolve('../../shared/report-outbox');
require.cache[filename] = { id: filename, filename, loaded: true, exports: {
  enqueue: async report => { if (!pending.has(report.reportId)) pending.set(report.reportId, report); },
  acknowledge: async id => { pending.delete(id); }
} };
