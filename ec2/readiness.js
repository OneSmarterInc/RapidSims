'use strict';
async function check(app) {
  if (app === 'platform') {
    const { sql } = require('../platform/lib/db');
    await sql().query('SELECT 1');
    await sql().query('SELECT report_id, launch_id FROM completions LIMIT 0');
    await sql().query('SELECT report_id, launch_id FROM transcripts LIMIT 0');
    await sql().query('SELECT attempts FROM auth_attempts LIMIT 0');
  }
  const { command } = require('./redis-command');
  if (await command(['PING']) !== 'PONG') throw new Error('Redis unavailable');
  if (await command(['PING'], process.env.REPORT_REDIS_URL) !== 'PONG') throw new Error('Report outbox unavailable');
  if (!process.env.LAUNCH_SECRET) throw new Error('Launch signing is not configured');
  if (!process.env.REPORT_SECRET && !process.env.REPORT_KEYS_JSON) throw new Error('Report signing is not configured');
  if (process.env.REPORT_SECRET === process.env.LAUNCH_SECRET) throw new Error('Report and launch secrets must differ');
  if (process.env.REPORT_KEYS_JSON) {
    const keys = JSON.parse(process.env.REPORT_KEYS_JSON);
    if (!keys || typeof keys !== 'object' || !Object.keys(keys).length ||
        Object.values(keys).some(key => typeof key !== 'string' || !key || key === process.env.LAUNCH_SECRET)) {
      throw new Error('Invalid per-simulation report signing keys');
    }
  }
  if (app !== 'platform' && !process.env.PLATFORM_URL) throw new Error('Report destination missing');
  if (['sim01', 'sim02'].includes(app) && !process.env.ANTHROPIC_API_KEY) throw new Error('AI provider key missing');
  return { ok: true, service: app, build: process.env.RELEASE_SHA || 'local' };
}
module.exports = { check };
