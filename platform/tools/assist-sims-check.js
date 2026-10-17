#!/usr/bin/env node
// The faculty helper on all twelve sims: for each sim's faculty session (fixtures captured from each sim's own
// browser walk), no student name reaches the model, the prompt stays well under the price step, and every sim has
// its one-pager.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
process.env.ANTHROPIC_API_KEY = 'test-key'; delete process.env.ASSIST_SIMS;
const H = require('../lib/assist.js');
const { onePagerFor } = require('../lib/one-pager');
let n = 0; const ok = (v, m) => { assert.ok(v, m); n++; };
const dir = path.join(__dirname, 'fixtures', 'faculty-states');
const fakeDb = () => { const rows = []; const s = (str, ...vals) => { const q = str.join('?');
  if (/FROM course_sims/.test(q)) return Promise.resolve([]); if (/count\(\*\)/.test(q)) return Promise.resolve([{ n: 0 }]);
  if (/sum\(cost_usd\)/.test(q)) return Promise.resolve([{ c: 0 }]); if (/INSERT/.test(q)) { rows.push(vals); return Promise.resolve([]); }
  return Promise.resolve([]); }; return s; };
(async () => {
  ok(H.ALL_SIMS.length === 12 && H.ALL_SIMS.every(H.enabled), 'The helper is on for all twelve sims');
  for (const id of H.ALL_SIMS) ok(onePagerFor(id, null) && onePagerFor(id, null).text.length > 500, `${id}: one-pager available`);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  ok(files.length >= 11, 'A faculty session fixture for each sim');
  for (const f of files) {
    const { simId, state } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const names = [...Object.values(state.participants || {}), ...(state.roster || [])].map(p => p && p.name).filter(Boolean);
    let sent = null;
    const fetchImpl = async (u, o) => { sent = o.body; return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Student 1 did well.' }], usage: {} }) }; };
    const r = await H.ask({ s: fakeDb(), me: { id: 'f' }, course: { id: 'c' }, sim: { id: simId, title: simId, detail: null }, question: 'Who did well?', sessionState: state, fetchImpl });
    ok(r.status === 200, `${simId}: answers`);
    ok(names.length > 0 && names.every(nm => !sent.includes(nm)), `${simId}: no student name reaches the model`);
    ok(!/ownerKey|platformAuth|"you"/.test(sent), `${simId}: no faculty keys or names reach the model`);
    ok(sent.length < 400000, `${simId}: the prompt stays well under the 100,000-token price step`);
  }
  console.log(`PASS assist-sims-check: ${n} assertions`);
})().catch(e => { console.error(e); process.exit(1); });
