'use strict';
const apps = require('./apps.json');
// RapidSim+ 01 must register at PUBLIC_BASE_URL + its own prefix (/sim-plus-01), so the platform
// never sends its students to another sim's path. Logged in the deploy output; a mismatch fails the deploy.
async function checkSimUrl(app) {
  if (process.argv[2] !== 'simplus01') return;
  const want = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '') + app.prefix;
  const r = await fetch(`http://127.0.0.1:${app.port}/api/health`, { headers:{'x-health-key':process.env.HEALTH_SECRET}, redirect:'error', signal:AbortSignal.timeout(7000) });
  const got = (await r.json()).registersAs || null;
  console.log(`simplus01 SIM_URL: ${got} (expected ${want})`);
  if (got !== want) throw Object.assign(new Error(`simplus01 registers as ${got}, expected ${want}`), { final: true });
}
async function main() {
  const app = apps[process.argv[2]];
  if (!app || !process.env.HEALTH_SECRET) throw new Error('App or diagnostic key missing');
  for (let attempt=0; attempt<15; attempt++) {
    try {
      const r = await fetch(`http://127.0.0.1:${app.port}/_ops/ready`, {
        headers:{'x-health-key':process.env.HEALTH_SECRET},redirect:'error',signal:AbortSignal.timeout(7000)
      });
      const status = await r.json();
      if (r.ok && status.ok && (!process.env.RELEASE_SHA || status.build === process.env.RELEASE_SHA)) return await checkSimUrl(app);
    } catch (error) { if (error.final) throw error; }
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error('Readiness did not pass for '+process.argv[2]);
}
main().catch(error=>{console.error(error.message);process.exit(1);});
