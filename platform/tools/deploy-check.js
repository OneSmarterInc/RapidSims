#!/usr/bin/env node
'use strict';
// AWS is the release target. Retained Vercel manifests are not deployment authority.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname,'../..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const workflow = read('.github/workflows/deploy-ec2.yml');
assert.match(workflow,/needs: verify/);
assert.match(workflow,/DEPLOY_COMMIT: \$\{\{ github.sha \}\}/);
assert.match(workflow,/npm test/);
assert(!workflow.includes('git pull'));
const deploy = read('ec2/deploy.sh');
for(const requirement of ['npm ci','git_repo archive "$sha"','trap rollback ERR','check-ready.js','systemctl enable "rapidsims@$app.service"','systemctl restart "rapidsims@$app.service"','systemctl disable "rapidsims@$app.service"','[[ -d "$release/$dir" && -f "$release/$dir/package.json" ]]']) assert(deploy.includes(requirement),requirement);
assert(deploy.includes('changed+=("$app")'), 'every registered app must be deployed');
assert(!deploy.includes('git_repo diff --quiet'), 'do not skip unchanged services');
const routes = execFileSync(process.execPath,[path.join(root,'ec2/render-nginx.js'),'--locations'],{encoding:'utf8'});
for(const app of Object.values(require('../../ec2/apps.json'))) {
  assert(routes.includes('127.0.0.1:'+app.port));
  for(const prefix of [app.prefix,...(app.aliases||[])].filter(Boolean))assert(routes.includes('location = '+prefix));
}
assert(!routes.includes('listen 80'),'managed include must not replace TLS');
// RapidSim+ 01's legacy paths reach RapidSim+ 01, not Midland (the old Vercel project behind /simplus01 was
// named flexee-rapid-sim-03-vercel but ran RapidSim+ 01).
const appsCfg = require('../../ec2/apps.json');
for (const alias of ['/rapidsims01', '/simplus01']) {
  const owners = Object.entries(appsCfg).filter(([, a]) => (a.aliases || []).includes(alias)).map(([id]) => id);
  assert.deepEqual(owners, ['simplus01'], alias + ' belongs to simplus01');
  const block = routes.split('location ^~ ' + alias + '/ {')[1].split('}')[0];
  assert(block.includes('127.0.0.1:' + appsCfg.simplus01.port + '/'), alias + ' proxies to the RapidSim+ 01 service');
}
assert.equal(appsCfg.simplus01.prefix, '/sim-plus-01', 'RapidSim+ 01 SIM_URL is PUBLIC_BASE_URL + /sim-plus-01');
assert(/'rapidsimplus-01': '\/sim-plus-01\/'/.test(read('platform/public/open.js')), 'Guest link for RapidSim+ 01 opens /sim-plus-01/');
console.log('AWS release checks passed: tested SHA, locked dependencies, all registered services restarted, new service rollback, manifest routes.');

