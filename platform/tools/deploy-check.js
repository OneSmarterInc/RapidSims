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
for(const requirement of ['npm ci','git_repo archive "$sha"','shared ec2 package.json package-lock.json','trap rollback ERR','check-ready.js']) assert(deploy.includes(requirement),requirement);
const routes = execFileSync(process.execPath,[path.join(root,'ec2/render-nginx.js'),'--locations'],{encoding:'utf8'});
for(const app of Object.values(require('../../ec2/apps.json'))) {
  assert(routes.includes('127.0.0.1:'+app.port));
  for(const prefix of [app.prefix,...(app.aliases||[])].filter(Boolean))assert(routes.includes('location = '+prefix));
}
assert(!routes.includes('listen 80'),'managed include must not replace TLS');
console.log('AWS release checks passed: tested SHA, locked dependencies, scoped service promotion, rollback, manifest routes.');

