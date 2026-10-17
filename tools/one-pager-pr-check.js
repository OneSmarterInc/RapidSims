#!/usr/bin/env node
// Pull-request check: a change to what faculty or students see in a sim comes with that sim's ONE-PAGER.md updated,
// or with a line in the PR description saying why the one-pager needs no change:
//   One-pager: no change needed — <reason>
// Changes to the shared faculty pages (platform/public/kit/) need the same line or an updated one-pager.
// Run in CI with BASE_SHA and PR_BODY set; locally: BASE_SHA=origin/master node tools/one-pager-pr-check.js
'use strict';
const { execFileSync } = require('node:child_process');
const base = process.env.BASE_SHA || 'origin/master', body = String(process.env.PR_BODY || '');
const SIMS = ['sim', 'sim-02', 'sim03', 'sim04', 'sim05', 'sim06', 'sim07', 'sim08', 'sim09', 'sim10', 'sim-plus-01', 'simplus02'];
// What faculty or students see: pages, content, outcomes and debriefs. Tests, tools and notes are left out.
const visible = (folder, file) => file.startsWith(folder + '/') && !/\/(test|tools|docs)\//.test(file) && !/\.md$/i.test(file) &&
  /\/(public|data|config|lib|api|engine|src)\//.test(file);
const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).split('\n').filter(Boolean);
const waived = /One-pager:\s*no change needed\s*[—–-]\s*\S/i.test(body);
const missing = [];
for (const folder of SIMS) {
  if (!changed.some(f => visible(folder, f))) continue;
  if (changed.includes(`${folder}/ONE-PAGER.md`)) { console.log(`PASS ${folder}: one-pager updated`); continue; }
  if (waived) { console.log(`PASS ${folder}: PR says no one-pager change is needed`); continue; }
  missing.push(folder);
}
if (changed.some(f => f.startsWith('platform/public/kit/')) && !waived && !changed.some(f => /\/ONE-PAGER\.md$/.test(f))) missing.push('platform/public/kit (shared faculty pages)');
if (missing.length) {
  console.error(`One-pager not dealt with for: ${missing.join(', ')}.\nUpdate the sim's ONE-PAGER.md, or add to the PR description:\n  One-pager: no change needed — <reason>`);
  process.exit(1);
}
console.log('One-pagers are in step with this pull request.');
