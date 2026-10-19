'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.env.LAUNCH_SECRET=crypto.randomBytes(32).toString('hex');
process.env.REPORT_SECRET=crypto.randomBytes(32).toString('hex');
delete process.env.REPORT_KEYS_JSON;delete process.env.PLATFORM_URL;
delete process.env.ACCESS_CODE;delete process.env.FACULTY_CODE;delete process.env.FACULTY_CODES;
const memory=new Map(), queue=new Map(), hashes=new Map();
const clone=v=>v===undefined?undefined:structuredClone(v);
const transport=require.resolve('../../ec2/redis-command');
require.cache[transport]={id:transport,filename:transport,loaded:true,exports:{configured:()=>true,command:async a=>{
  if(a[0]==='SET'){memory.set(a[1],a[2]);return 'OK';}
  if(a[0]==='GET')return memory.get(a[1]) || null;
  if(a[0]==='HGETALL')return [...(hashes.get(a[1])||new Map())].flat();
  if(a[0]==='HSET'||a[0]==='HSETNX'){const h=hashes.get(a[1])||new Map();if(a[0]==='HSET'||!h.has(a[2]))h.set(a[2],a[3]);hashes.set(a[1],h);return 1;}
  if(a[0]==='HGET')return (hashes.get(a[1])||new Map()).get(a[2])||null;
  if(a[0]==='EXPIRE')return 1;
  if(a[0]==='ZCARD')return queue.size;
  if(a[0]==='ZADD'){queue.set(a[3],Number(a[2]));return 1;}
  if(a[0]==='ZRANGEBYSCORE')return [...queue].filter(([,t])=>t<=Number(a[3])).map(([id])=>id).slice(0,Number(a[6]));
  if(a[0]==='HINCRBY'){const h=hashes.get(a[1])||new Map();h.set(a[2],String(Number(h.get(a[2])||0)+Number(a[3])));hashes.set(a[1],h);return Number(h.get(a[2]));}
  // Outbox scripts (shared/report-outbox.js): enqueue has 5 keys then raw, now, id; acknowledge has 3 keys then id.
  if(a[0]==='EVAL'&&a[1].includes("'SET'")&&a[2]==='5'){if(!memory.has(a[3]))memory.set(a[3],a[8]);if(!hashes.has(a[5]))hashes.set(a[5],new Map([['first',a[9]],['attempts','0']]));queue.set(a[10],Number(a[9]));return 1;}
  if(a[0]==='EVAL'&&a[1].includes("'ZREM'")&&a[2]==='3'){queue.delete(a[6]);memory.delete(a[4]);hashes.delete(a[5]);return 1;}
  throw new Error('Unexpected Redis test command '+a[0]);
}}};
const L=require('../../platform/lib/launch');
const R=require('../../shared/report-contract');
const manifest=require('../local/manifest.cjs');
const tokenFor=(simId,userId='student',role='student',courseId='course',name=userId)=>L.launchToken({simId,userId,role,courseId,name,runId:'issued-'+userId});
function res(){return{code:200,status(n){this.code=n;return this;},json(v){this.data=v;return this;},end(){return this;},setHeader(){}};}

test('all twelve simulation verifiers accept current launch contract and reject report/registration tokens',()=>{
  for(const {folder,meta} of manifest){
    const verify=require('../../'+folder+'/lib/launch').verifyLaunch;
    assert(verify(tokenFor(meta.id)),folder+' accepts launch');
    assert.equal(verify(L.sign({kind:'register',sub:'student',sim:meta.id,exp:Date.now()+60000})),null,folder+' rejects registration');
    const p=R.makeReport('complete',{launch:{sub:'student',sim:meta.id,run:'issued-student'}});
    assert.equal(verify(R.signReport({...p,iat:Date.now(),exp:Date.now()+60000})),null,folder+' rejects report');
    const valid=L.verify(tokenFor(meta.id));
    for(const invalid of [{...valid,exp:'not-a-date'},{...valid,run:null},{...valid,role:'admin'}]) {
      assert.equal(verify(L.sign(invalid)),null,folder+' rejects malformed claims');
    }
    assert.equal(verify(tokenFor(meta.id)+'.extra'),null,folder+' rejects extra token segments');
  }
});
test('old fail-open guards now deny anonymous and wrong-simulation requests',()=>{
  for(const folder of ['sim','sim-02','sim-plus-01']){
    const guard=require('../../'+folder+'/lib/guard');
    assert.equal(guard.checkAccess({headers:{}},res()),false,folder);
    assert.equal(guard.checkAccess({headers:{'x-launch-token':tokenFor('unrelated-sim')}},res()),false,folder);
  }
});
test('Sim01/02 sessions use stable owner identity and isolated Redis keys',async()=>{
  const one=require('../../sim/lib/store'),two=require('../../sim-02/lib/store');
  await one.putSession('ABCDE',{code:'ABCDE',owner:'Shared Name',ownerId:'teacherA',courseId:'course',state:'lobby'});
  assert.equal(await two.getSession('ABCDE'),null);
  const handler=require('../../sim/api/session');
  const response=res();
  await handler({method:'POST',headers:{'x-launch-token':tokenFor('rapid-01-disaster','teacherB','faculty','course','Shared Name')},body:{action:'faculty_state',code:'ABCDE'}},response);
  assert.equal(response.code,403);
  const owner=res();
  await handler({method:'POST',headers:{'x-launch-token':tokenFor('rapid-01-disaster','teacherA','faculty','course','Changed Name')},body:{action:'faculty_state',code:'ABCDE'}},owner);
  assert.equal(owner.code,200);
  const anonymous=res();await handler({method:'POST',headers:{},body:{action:'create'}},anonymous);assert.equal(anonymous.code,401);
});
test('RapidSim+ run ownership blocks another student and another course',async()=>{
  const handler=require('../../sim-plus-01/api/run');
  async function call(token,body){const response=res();await handler({method:'POST',headers:{'x-launch-token':token},body},response);return response;}
  const own=tokenFor('rapidsimplus-01','A');
  // Students play inside their class's session, which the faculty member opens and starts.
  const session=require('../../sim-plus-01/api/session'),fac=tokenFor('rapidsimplus-01','teacherA','faculty','course');
  const created=res();await session({method:'POST',headers:{'x-launch-token':fac},body:{action:'create'}},created);assert.equal(created.code,200);
  const startedSession=res();await session({method:'POST',headers:{'x-launch-token':fac},body:{action:'control',code:created.data.code,set:'start'}},startedSession);assert.equal(startedSession.code,200);
  const started=await call(own,{action:'start',order:['terry','ray','ruth'],observationSeconds:30});
  assert.equal(started.code,200);const runId=started.data.runId;
  for(const token of [tokenFor('rapidsimplus-01','B'),tokenFor('rapidsimplus-01','A','student','other')]){
    // Another student's run is never theirs: their own session record has no run, and another class has no session.
    for(const body of [{action:'resume',runId},{action:'ask',runId,question:'Why?'}]){const r=await call(token,body);assert.ok([403,404,409].includes(r.code),String(r.code));assert.equal(r.data.state,undefined);}
  }
  assert.equal((await call(own,{action:'resume',runId})).code,200);
});
test('every simulation sender produces a valid v2 server report',async()=>{
  process.env.PLATFORM_URL='https://platform.example.test';
  const nativeFetch=global.fetch;const reports=[];
  global.fetch=async(_url,options)=>{reports.push(R.verifyReport(JSON.parse(options.body).token,'complete'));return{ok:true,status:200};};
  try{
    for(const {folder,meta} of manifest){
      const launch={sub:'student',sim:meta.id,course:'course',run:'issued-student',iat:Date.now()};
      const result=await require('../../'+folder+'/lib/launch').reportCompletion({launch,runId:'server-run',participantId:'platform:student',courseId:'course',launchId:'issued-student',summary:'Complete'});
      assert(folder==='sim04'?result:result.ok,folder);
      assert.equal(reports.at(-1)?.sim,meta.id,folder);
    }
    assert.equal(reports.length,12);assert.equal(queue.size,0);
  }finally{global.fetch=nativeFetch;delete process.env.PLATFORM_URL;}
});
test('outbox retains failed reports and retry delivers the same report identifier',async()=>{
  process.env.PLATFORM_URL='https://platform.example.test';
  const nativeFetch=global.fetch;const ids=[];
  try{
    global.fetch=async(_url,options)=>{ids.push(R.verifyReport(JSON.parse(options.body).token,'complete').reportId);return{ok:false,status:503};};
    const result=await require('../../shared/report-delivery').reportCompletion({launch:{sub:'student',sim:'rapid-01-disaster',run:'outage-run'},summary:'Saved'});
    assert.equal(result.queued,true);assert.equal(result.pending,true);assert.equal(queue.size,1);
    global.fetch=async(_url,options)=>{ids.push(R.verifyReport(JSON.parse(options.body).token,'complete').reportId);return{ok:true,status:200};};
    const result2=await require('../../shared/report-outbox').drain();
    assert.equal(result2.delivered,1);assert.equal(result2.pending,0);assert.equal(ids[0],ids[1]);
  }finally{global.fetch=nativeFetch;delete process.env.PLATFORM_URL;}
});
