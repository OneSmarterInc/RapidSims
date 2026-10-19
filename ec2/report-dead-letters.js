#!/usr/bin/env node
'use strict';
// Dead-lettered result reports: list them, or put one back on the queue.
//
//   node ec2/report-dead-letters.js                 list (sim, student id, launch id, reason, dates)
//   node ec2/report-dead-letters.js --json          the same list as JSON
//   node ec2/report-dead-letters.js requeue <id>    put one report back on the queue for delivery now
//
// On the server, run it with the worker's environment (REPORT_REDIS_URL, APP_ENV):
//   sudo -u rapidsims bash -c 'set -a; . /etc/rapidsims.env; [ -f /etc/rapidsims/platform.env ] && . /etc/rapidsims/platform.env;
//     cd /var/www/rapidsims-services/platform && node ec2/report-dead-letters.js'
//
// The list shows identifiers only. Summaries and transcripts stay in Redis and are never printed.
// Nothing is deleted: the dead-letter list falls under the same retention and privacy rules as the queue.
const outbox = require('../shared/report-outbox');

const iso = ms => (ms ? new Date(ms).toISOString().replace('.000Z', 'Z') : '-');

async function main(argv) {
  if (argv[0] === 'requeue') {
    const id = String(argv[1] || '');
    if (!/^[a-f0-9]{64}$/.test(id)) { console.error('Give the full 64-character report id from the list.'); return 2; }
    const done = await outbox.requeue(id);
    console.log(done ? `Re-queued ${id}. The worker sends it within a few seconds.` : `No dead-lettered report ${id}.`);
    return done ? 0 : 1;
  }
  if (argv[0] && argv[0] !== '--json') { console.error('Use: report-dead-letters.js [--json] | requeue <reportId>'); return 2; }
  const rows = await outbox.listDead();
  if (argv[0] === '--json') { console.log(JSON.stringify(rows, null, 2)); return 0; }
  if (!rows.length) { console.log('No dead-lettered reports.'); return 0; }
  const cols = [['reportId', r => r.reportId], ['kind', r => r.kind || '-'], ['sim', r => r.sim || '-'], ['student', r => r.studentId || '-'],
    ['launch', r => r.launchId || '-'], ['reason', r => r.reason || '-'], ['status', r => r.status ?? '-'], ['error', r => r.error || '-'],
    ['attempts', r => r.attempts], ['first queued', r => iso(r.firstQueuedAt)], ['dead-lettered', r => iso(r.deadAt)]];
  const table = [cols.map(c => c[0]), ...rows.map(r => cols.map(c => String(c[1](r))))];
  const w = cols.map((_, i) => Math.max(...table.map(row => row[i].length)));
  for (const row of table) console.log(row.map((v, i) => v.padEnd(w[i])).join('  '));
  console.log(`\n${rows.length} dead-lettered report${rows.length === 1 ? '' : 's'}.`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => { console.error(error.code || error.message); process.exit(1); });
}
module.exports = { main };
