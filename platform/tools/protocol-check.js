#!/usr/bin/env node
'use strict';
// All twelve senders, signed report purposes, launch rejection, ownership and retries.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test',
  path.join(__dirname,'../../tools/security/simulations.test.cjs')], {stdio:'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

