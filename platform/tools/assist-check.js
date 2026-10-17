#!/usr/bin/env node
// The faculty helper (platform/lib/assist.js): students reach the model as numbers only, the monthly limits
// (30 trying, 200 once a class is licensed), the platform ceiling, cost per question, and the pilot gate.
'use strict';
const assert = require('node:assert/strict');
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ASSIST_SIMS = 'rapidsimplus-01';
const H = require('../lib/assist.js');
let n = 0; const ok = (v, m) => { assert.ok(v, m); n++; };

// A small stand-in for the database: answers the four queries the helper makes.
function fakeDb({ paid = false, used = 0, spent = 0 } = {}) {
  const rows = [];
  const s = (strings, ...vals) => {
    const q = strings.join('?');
    if (/FROM course_sims/.test(q)) return Promise.resolve(paid ? [{ 1: 1 }] : []);
    if (/count\(\*\)/.test(q)) return Promise.resolve([{ n: used }]);
    if (/sum\(cost_usd\)/.test(q)) return Promise.resolve([{ c: spent }]);
    if (/INSERT INTO assist_usage/.test(q)) { rows.push(vals); return Promise.resolve([]); }
    if (/UPDATE assist_usage/.test(q)) return Promise.resolve([]);
    throw new Error('unexpected query ' + q);
  };
  s.rows = rows; return s;
}
const sim = { id: 'rapidsimplus-01', title: "Why Don't They Have Any Patience?", detail: null };
const me = { id: 'fac1', role: 'faculty' };
const state = { session: { code: 'ABCDE', state: 'running', mode: 'individual' },
  participants: { 'platform:a': { id: 'platform:a', name: 'Maria Lopez' }, 'platform:b': { id: 'platform:b', name: 'Dev Patel' } },
  runs: { 'individual:platform:a': { teamLabel: 'Maria Lopez', band: 'kept', transcript: [{ question: 'Who uses the log?', answer: 'A long scripted answer the model does not need.' }] } },
  kit: { bands: { kept: { label: 'Matching kept, without the evidence' } }, lessons: [{ head: 'A lesson' }] } };

(async () => {
  let sent = null;
  const fetchImpl = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Student 1 kept the review desk.' }], usage: { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 18000 } }) }; };
  let s = fakeDb();
  let r = await H.ask({ s, me, course: { id: 'c1' }, sim, question: 'Who kept the desk?', history: [], sessionState: state, fetchImpl });
  ok(r.status === 200 && r.body.answer.includes('Student 1'), 'The helper answers');
  const wire = JSON.stringify(sent);
  ok(!wire.includes('Maria') && !wire.includes('Dev Patel'), 'No student name reaches the model');
  ok(wire.includes('Student 1') && wire.includes('Student 2'), 'Students reach the model as numbers');
  ok(!wire.includes('A long scripted answer'), 'The characters’ answer text stays on the platform');
  ok(r.body.names['Student 1'] === 'Maria Lopez', 'The faculty page gets the names back to restore them');
  ok(sent.model === 'claude-haiku-5-5' && sent.max_tokens <= 600, 'Claude Haiku 5.5, short answers');
  ok(sent.system[0].cache_control && sent.system[0].text.includes('one-pager'), 'The sim material is sent once and cached');
  ok(wire.length < 400000, 'The prompt stays well under the 100,000-token price step');
  const cost = s.rows[0][8];
  ok(Math.abs(cost - (2000 * 0.10 + 300 * 0.50 + 18000 * 0.01) / 1e6) < 1e-12, 'Cost per question is recorded');
  ok(cost < 0.01, 'A question costs well under one cent');

  r = await H.ask({ s: fakeDb({ used: 30 }), me, sim, question: 'More?', sessionState: null, fetchImpl });
  ok(r.status === 429 && /30 questions/.test(r.body.message) && /200/.test(r.body.message), 'Trying a sim: 30 questions a month');
  r = await H.ask({ s: fakeDb({ used: 30, paid: true }), me, sim, question: 'More?', sessionState: null, fetchImpl });
  ok(r.status === 200, 'A licensed class raises the limit');
  r = await H.ask({ s: fakeDb({ used: 200, paid: true }), me, sim, question: 'More?', sessionState: null, fetchImpl });
  ok(r.status === 429, 'Licensed: 200 questions a month');
  r = await H.ask({ s: fakeDb({ spent: 25 }), me, sim, question: 'More?', sessionState: null, fetchImpl });
  ok(r.status === 429 && r.body.error === 'helper_paused', 'The helper pauses at the $25 monthly ceiling');
  r = await H.ask({ s: fakeDb(), me, sim: { ...sim, id: 'rapid-01-disaster' }, question: 'Hi', sessionState: null, fetchImpl });
  ok(r.status === 404, 'Only the pilot sim has the helper for now');
  r = await H.ask({ s: fakeDb(), me, sim, question: '   ', sessionState: null, fetchImpl });
  ok(r.status === 400, 'A question is required');
  console.log(`PASS assist-check: ${n} assertions`);
})().catch(e => { console.error(e); process.exit(1); });
