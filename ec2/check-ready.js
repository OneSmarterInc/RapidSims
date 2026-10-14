'use strict';
const apps = require('./apps.json');
async function main() {
  const app = apps[process.argv[2]];
  if (!app || !process.env.HEALTH_SECRET) throw new Error('App or diagnostic key missing');
  for (let attempt=0; attempt<15; attempt++) {
    try {
      const r = await fetch(`http://127.0.0.1:${app.port}/_ops/ready`, {
        headers:{'x-health-key':process.env.HEALTH_SECRET},redirect:'error',signal:AbortSignal.timeout(7000)
      });
      const status = await r.json();
      if (r.ok && status.ok && (!process.env.RELEASE_SHA || status.build === process.env.RELEASE_SHA)) return;
    } catch {}
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error('Readiness did not pass for '+process.argv[2]);
}
main().catch(error=>{console.error(error.message);process.exit(1);});
