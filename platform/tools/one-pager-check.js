#!/usr/bin/env node
// Every sim keeps a faculty one-pager in its own folder (ONE-PAGER.md), stamped "Reviewed for: <catalogue revision>".
// A change faculty or students would notice moves the sim's catalogue revision forward, and this check then fails
// until the one-pager is reread and its stamp updated. Pull requests are also checked by tools/one-pager-pr-check.js.
const assert = require('node:assert/strict');
const path = require('node:path');
const { sources, onePager } = require('./sync-catalogue-source');
const STUDENT_SECTIONS = [/^## The situation$/m, /^## Your role$/m, /^## What you'll do$/m, /^## What you hand in$/m];
const SECTIONS = [/^## The situation$/m, /^## Why it['’]s hard$/m, /^## What students take away$/m, /^## Running it$/m];
for (const file of sources) {
  const m = require(path.join(__dirname, '../..', file)), meta = m.META || m, folder = file.split('/')[0];
  const page = onePager(file);
  assert.ok(page, `${folder}/ONE-PAGER.md is missing`);
  assert.equal(page.reviewedFor, meta.catalogueRevision, `${folder}/ONE-PAGER.md was reviewed for "${page.reviewedFor}" but the sim is now "${meta.catalogueRevision}". Reread the one-pager, update it if needed, and set its stamp.`);
  assert.ok(page.text.startsWith('# '), `${folder}/ONE-PAGER.md starts with its title`);
  for (const h of SECTIONS) assert.ok(h.test(page.text), `${folder}/ONE-PAGER.md has the section ${h.source}`);
  // The student page: same stamp, four sections, short, in the words students read (no outcome is named here).
  const sp = onePager(file, 'STUDENT-ONE-PAGER.md');
  assert.ok(sp, `${folder}/STUDENT-ONE-PAGER.md is missing`);
  assert.equal(sp.reviewedFor, meta.catalogueRevision, `${folder}/STUDENT-ONE-PAGER.md was reviewed for "${sp.reviewedFor}" but the sim is now "${meta.catalogueRevision}". Reread it and update its stamp.`);
  for (const h of STUDENT_SECTIONS) assert.ok(h.test(sp.text), `${folder}/STUDENT-ONE-PAGER.md has the section ${h.source}`);
  const words = sp.text.split(/\s+/).length;
  assert.ok(words <= 200, `${folder}/STUDENT-ONE-PAGER.md is ${words} words; keep it to about 150`);
  const banned = sp.text.match(/\b(room|rooms|bridge|table|tables|score|scored|ranking|ranked|winner|right answer|wrong answer)\b/i);
  assert.ok(!banned, `${folder}/STUDENT-ONE-PAGER.md uses "${banned && banned[0]}"`);
  console.log(`PASS ${folder}: one-pager reviewed for ${meta.catalogueRevision}`);
}

// Admin edits hold for the sim's current release only; matching or empty text restores the sim's own page.
const { onePagerFor, overrideFrom } = require('../lib/one-pager');
const id = 'rapidsimplus-02', own = onePagerFor(id, null);
assert.equal(own.edited, false, 'With no edit, the sim\'s own page shows');
assert.equal(overrideFrom(id, own.text, 't'), null, 'Saving the same text stores no edit');
assert.equal(overrideFrom(id, '   ', 't'), null, 'Clearing the box restores the sim\'s own page');
const edit = overrideFrom(id, 'Edited page', 't');
assert.equal(onePagerFor(id, { onePagerOverride: edit }).text, 'Edited page', 'An Admin edit shows for this release');
assert.equal(onePagerFor(id, { onePagerOverride: { ...edit, revision: 'an-older-release' } }).edited, false, 'A new sim release brings back its own page');
console.log('PASS Admin edits of one-pagers');
