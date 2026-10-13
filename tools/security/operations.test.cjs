'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {execFileSync}=require('node:child_process');
test('telemetry prunes without polling and caps latency samples',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../../ec2/server.js'),'utf8');
  const code=source.slice(source.indexOf('const TRAFFIC_RETENTION_MS'),source.indexOf('function hasTrafficAccess'));
  let now=0;
  const context=vm.createContext({Date:class extends Date{static now(){return now;}}});
  const metrics=vm.runInContext(code+';({beginTraffic,finishTraffic,trafficBuckets})',context);
  for(let i=0;i<1000;i++){now=i*1000;const m=metrics.beginTraffic({url:'/'});metrics.finishTraffic(m,200);}
  assert(metrics.trafficBuckets.size<=121);
  for(let i=0;i<5000;i++)metrics.finishTraffic(metrics.beginTraffic({url:'/'}),200);
  assert([...metrics.trafficBuckets.values()].every(b=>b.latencies.length<=2048));
});
test('AWS route generation covers every service and preserves legacy aliases',()=>{
  const root=path.resolve(__dirname,'../..');
  const generated=execFileSync(process.execPath,['ec2/render-nginx.js','--locations'],{cwd:root,encoding:'utf8'});
  for(const app of Object.values(require('../../ec2/apps.json'))){assert(generated.includes('127.0.0.1:'+app.port));if(app.prefix)assert(generated.includes('location = '+app.prefix+' '));}
  assert(generated.includes('/simplus01/'));assert(!generated.includes('listen 80'));
  assert(generated.includes('limit_req zone=rapid_auth'));
});
test('diagnostic probe rejects unapproved destinations and never follows redirects',async()=>{
  const {probeHealth}=require('../../platform/lib/health-probe');
  let requests=0,secretReceived=false;
  const server=http.createServer((req,res)=>{requests++;secretReceived=!!req.headers['x-health-key'];if(req.url.startsWith('/redirect/')){res.writeHead(302,{location:'/unexpected/api/health'});res.end();}else{res.setHeader('content-type','application/json');res.end(JSON.stringify({sim:'test'}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  delete process.env.PUBLIC_BASE_URL;delete process.env.HEALTH_ALLOWED_ORIGINS;delete process.env.HEALTH_PRIVATE_ORIGINS;
  process.env.HEALTH_SECRET=require('node:crypto').randomBytes(24).toString('hex');
  try{
    await assert.rejects(probeHealth(origin),/not approved/);assert.equal(requests,0);
    process.env.HEALTH_ALLOWED_ORIGINS=origin;
    await assert.rejects(probeHealth(origin),/HTTPS/);assert.equal(requests,0);
    process.env.HEALTH_PRIVATE_ORIGINS=origin;
    assert.equal((await probeHealth(origin)).status,200);assert(secretReceived);
    await assert.rejects(probeHealth(origin+'/redirect'),/redirects/);assert.equal(requests,2);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('readiness fails closed for PostgreSQL, Redis, and missing report configuration',async()=>{
  const dbPath=require.resolve('../../platform/lib/db');
  const redisPath=require.resolve('../../ec2/redis-command');
  const oldDb=require.cache[dbPath],oldRedis=require.cache[redisPath],env={...process.env};
  let dbBroken=false,redisBroken=false,queries=0,pings=0;
  require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{sql:()=>({query:async()=>{queries++;if(dbBroken)throw new Error('PostgreSQL unavailable');return[];}})}};
  require.cache[redisPath]={id:redisPath,filename:redisPath,loaded:true,exports:{command:async()=>{pings++;if(redisBroken)throw new Error('Redis unavailable');return'PONG';}}};
  process.env.LAUNCH_SECRET='readiness-launch-fixture';process.env.REPORT_SECRET='readiness-report-fixture';delete process.env.REPORT_KEYS_JSON;
  process.env.RELEASE_SHA='fixture-build';
  try {
    const {check}=require('../../ec2/readiness');
    assert.equal((await check('platform')).build,'fixture-build');assert.equal(queries,4);assert.equal(pings,2);
    dbBroken=true;await assert.rejects(check('platform'),/PostgreSQL/);dbBroken=false;
    redisBroken=true;await assert.rejects(check('platform'),/Redis/);redisBroken=false;
    delete process.env.REPORT_SECRET;await assert.rejects(check('platform'),/Report signing/);
    process.env.REPORT_SECRET=process.env.LAUNCH_SECRET;await assert.rejects(check('platform'),/must differ/);
  }finally{
    if(oldDb)require.cache[dbPath]=oldDb;else delete require.cache[dbPath];
    if(oldRedis)require.cache[redisPath]=oldRedis;else delete require.cache[redisPath];
    for(const key of ['LAUNCH_SECRET','REPORT_SECRET','REPORT_KEYS_JSON','RELEASE_SHA']) {
      if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];
    }
  }
});
