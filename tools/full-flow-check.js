#!/usr/bin/env node
'use strict';
// Real SQL and transactions, with no live database or service connections.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=full lifecycle',
  path.join(__dirname,'security/platform.test.cjs')], {stdio:'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

