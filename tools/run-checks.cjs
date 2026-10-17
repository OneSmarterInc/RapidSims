'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function run(args, cwd = root) {
  console.log('\nCHECK ' + path.relative(root, cwd) + ' ' + args.join(' '));
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run(['--test', ...fs.readdirSync(path.join(__dirname, 'security'))
  .filter(name => name.endsWith('.test.cjs')).map(name => 'tools/security/' + name)]);
for (const name of ['sim-identity-check','session-sims-check','new-sims-entry-check',
  'catalogue-content-check','health-contract-check','catalogue-number-check','deploy-check',
  'catalogue-check','sim-detail-check','address-check.test','address-check','contact-check',
  'prose-check','check-faculty-student-results','faculty-sim-results-check','midland-practice-check','student-reset-check','class-roster-check','course-catalogue-check']) {
  run(['platform/tools/' + name + '.js']);
}
run(['platform/tools/sync-catalogue-source.js', '--check']);
run(['platform/tools/one-pager-check.js']);
run(['platform/tools/assist-check.js']);
run(['tools/test-entry-flow.js']);
run(['tools/health-security-check.js']);
for (const app of Object.values(require('../ec2/apps.json')).filter(app => app.dir !== 'platform')) {
  const cwd = path.join(root, app.dir);
  const script = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts?.test;
  if (script) {
    // Existing test scripts are Node commands separated by &&, not arbitrary shell input.
    for (const part of script.split('&&')) {
      const [command, ...args] = part.trim().split(/\s+/);
      if (command !== 'node') throw new Error('Unsupported test command in ' + app.dir);
      run(args, cwd);
    }
  } else {
    for (const file of fs.readdirSync(path.join(cwd, 'tools')).filter(name => name.endsWith('-check.js'))) run(['tools/' + file], cwd);
  }
}
console.log('\nAll platform, security, AWS contract and simulation regression checks passed.');
