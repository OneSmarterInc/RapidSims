#!/usr/bin/env node
// Export only authored public metadata, never the scenario module itself.
// Vercel builds platform/ in isolation, so sibling sim files are unavailable
// there. This checked-in snapshot keeps the catalogue current even before a
// simulation's next registration and supports existing Wexford course aliases.
const fs = require('node:fs');
const path = require('node:path');
const sources = [
  'sim/lib/scenario.js', 'sim-02/lib/scenario.js', 'sim03/lib/scenario.js', 'sim04/lib/meta.js',
  'sim05/config/content.js', 'sim06/lib/meta.js', 'sim07/data/config.js',
  'sim08/config/content.js', 'sim09/config/content.js', 'sim10/data/config.js',
  'sim-plus-01/lib/meta.js', 'simplus02/lib/meta.js'
];
// The faculty one-pager lives in the sim's own folder (ONE-PAGER.md), stamped with the catalogue revision it was
// reviewed for. platform/tools/one-pager-check.js keeps the stamp and the sim in step.
// The student one-pager (STUDENT-ONE-PAGER.md) sits beside it, stamped the same way.
function onePager(file, name = 'ONE-PAGER.md') {
  const page = path.join(__dirname, '../..', file.split('/')[0], name);
  if (!fs.existsSync(page)) return null;
  const raw = fs.readFileSync(page, 'utf8'), stamp = /^<!-- Reviewed for: (.+?) -->\n/.exec(raw);
  return { reviewedFor: stamp ? stamp[1] : null, text: raw.replace(/^<!--[^]*?-->\n/, '').trim() };
}
function snapshot() {
  return Object.fromEntries(sources.map(file => {
    const module = require(path.join(__dirname, '../..', file));
    const m = module.META || module;
    return [m.id || m.simId, { tagline: m.tagline, description: m.description, detail: m.detail, onePager: onePager(file), studentOnePager: onePager(file, 'STUDENT-ONE-PAGER.md') }];
  }));
}
if (require.main === module) {
  const output = path.join(__dirname, '../lib/catalogue-source.json');
  const text = JSON.stringify(snapshot(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(output, 'utf8') !== text) {
      console.error('Catalogue copy is stale. Run node platform/tools/sync-catalogue-source.js');
      process.exitCode = 1;
    } else console.log(`Catalogue source matches all ${sources.length} simulations.`);
  } else {
    fs.writeFileSync(output, text);
    console.log(`Updated public catalogue source for all ${sources.length} simulations.`);
  }
}
module.exports = { sources, snapshot, onePager };
