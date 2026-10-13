#!/usr/bin/env node
'use strict';
// Registration now uses transactions: exercise PostgreSQL instead of SQL substring mocks.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test',
  '--test-name-pattern=registration|catalogue edits|oversized detail',
  path.join(__dirname,'../../tools/security/platform.test.cjs')], {stdio:'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

