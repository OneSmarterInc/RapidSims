'use strict';
process.env.PLATFORM_URL ||= process.env.PUBLIC_BASE_URL;
const { drain } = require('../shared/report-outbox');
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
async function main() {
  while (!stopping) {
    try {
      const result = await drain();
      if (result.pending || result.deadLettered) console.log(JSON.stringify({ event: 'report_outbox', ...result }));
    } catch (error) { console.error('Report worker failed:', error.code || error.message); }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 5000));
  }
  process.exit(0);
}
main().catch(error => { console.error(error.message); process.exit(1); });
