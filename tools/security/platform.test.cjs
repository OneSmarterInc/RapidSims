'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
// In-memory PostgreSQL only. Never reads connection strings or real credentials.
delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL; delete process.env.REPORT_KEYS_JSON;
delete process.env.PLATFORM_URL;
process.env.LAUNCH_SECRET = crypto.randomBytes(32).toString('hex');
process.env.REPORT_SECRET = crypto.randomBytes(32).toString('hex');
const db = new PGlite();
function adapter(database) {
  const s = async (parts, ...values) => (await database.query(parts.reduce((q,p,i)=>q+(i?'$'+i:'')+p,''), values)).rows;
  s.query = async (q,v=[]) => (await database.query(q,v)).rows;
  s.transaction = work => database.transaction(tx => work(adapter(tx)));
  return s;
}
const s = adapter(db);
const dbPath = require.resolve('../../platform/lib/db');
require.cache[dbPath] = { id:dbPath, filename:dbPath, loaded:true, exports:{sql:()=>s,id:p=>p+'_'+crypto.randomUUID(),joinCode:()=>crypto.randomBytes(4).toString('hex').toUpperCase()} };
const A = require('../../platform/lib/auth');
const L = require('../../platform/lib/launch');
const R = require('../../shared/report-contract');
const handlers = Object.fromEntries(['auth','admin','faculty','student','launch','complete','transcript','register','session-enrolments'].map(name=>[name,require('../../platform/api/'+name)]));
async function call(name, body={}, cookie='admin', query={}) {
  const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.data=v;return this;},send(v){this.data=v;return this;},end(){return this;},redirect(n,url){this.code=n;this.url=url;return this;}};
  await handlers[name]({method:'POST',body,query,headers:{host:'localhost',cookie:'fx_sess='+cookie},socket:{remoteAddress:'127.0.0.1'}},res);
  return res;
}
const reportToken = (kind, extra={}) => R.signReport({...R.makeReport(kind,{launch:{sub:'student',sim:'rapid-01-disaster',course:'course',run:'launch'},runId:'run-one',summary:'Finished',...extra}),iat:Date.now(),exp:Date.now()+300000});
before(async()=>{
  await db.exec(fs.readFileSync(path.join(__dirname,'../../platform/lib/schema.sql'),'utf8'));
  // Migration is repeatable and does not clear data.
  for (const statement of require('../../platform/lib/schema')) await s.query(statement);
  for (const [id,role] of [['admin','admin'],['faculty','faculty'],['student','student']]) {
    await s`INSERT INTO users(id,name,email,role) VALUES(${id},${id},${id+'@example.test'},${role})`;
    await s`INSERT INTO sessions(id,user_id,expires_at) VALUES(${id},${id},now()+interval '1 day')`;
  }
  await s`INSERT INTO courses(id,faculty_id,title,join_code) VALUES('course','faculty','Class','ABCDEF')`;
  await s`INSERT INTO sims(id,title,launch_url,minutes,published) VALUES('rapid-01-disaster','Disaster','https://example.test/sim',20,true)`;
  await s`INSERT INTO course_sims(course_id,sim_id) VALUES('course','rapid-01-disaster')`;
  await s`INSERT INTO enrolments(id,student_id,course_id,paid) VALUES('enrol','student','course',true)`;
  await s`INSERT INTO launches(id,user_id,sim_id,course_id,as_role) VALUES('launch','student','rapid-01-disaster','course','student')`;
});
after(()=>db.close());

test('launch token is not a completion or transcript credential',async()=>{
  const token=L.launchToken({userId:'student',simId:'rapid-01-disaster',role:'student',courseId:'course',runId:'launch'});
  assert.equal((await call('complete',{token})).code,401);
  assert.equal((await call('transcript',{token,envelope:{simId:'rapid-01-disaster',simVersion:'1',events:[],phases:[]}})).code,401);
  assert.equal((await s`SELECT count(*)::int AS n FROM completions`)[0].n,0);
});
test('signed completions are bound to launch and deduplicated in PostgreSQL',async()=>{
  const token=reportToken('complete');
  const results=await Promise.all([call('complete',{token}),call('complete',{token})]);
  assert.deepEqual(results.map(r=>r.code),[200,200]);
  assert.equal((await s`SELECT count(*)::int AS n FROM completions`)[0].n,1);
  const invalid=reportToken('complete',{launch:{sub:'student',sim:'rapid-01-disaster',course:'wrong-course',run:'launch'},runId:'bad'});
  assert.equal((await call('complete',{token:invalid})).code,404);
  const unbound={...R.makeReport('complete',{launch:{sub:'student',sim:'rapid-01-disaster',course:'course',run:'launch'}}),launchId:null,iat:Date.now(),exp:Date.now()+60000};
  assert.equal((await call('complete',{token:R.signReport(unbound)})).code,401,'past launches are not a substitute for an exact launch reference');
});
test('transcript content is authenticated and duplicate delivery is harmless',async()=>{
  const envelope={simId:'rapid-01-disaster',simVersion:'1',events:[{ordinal:1,phase:'done',input:'authentic'}],phases:[]};
  const token=reportToken('transcript',{envelope});
  assert.equal((await call('transcript',{token,envelope:{...envelope,events:[]}})).code,200);
  assert.equal((await call('transcript',{token})).code,200);
  const rows=await s`SELECT envelope FROM transcripts`;
  assert.equal(rows.length,1);assert.equal(rows[0].envelope.events[0].input,'authentic');
  const [body,mac]=token.split('.');const p=JSON.parse(Buffer.from(body,'base64url'));p.envelope.events=[];
  assert.equal((await call('transcript',{token:Buffer.from(JSON.stringify(p)).toString('base64url')+'.'+mac})).code,401);
});
test('replacement invitation revokes old link and consumption is single-use',async()=>{
  const issue={action:'invite_faculty',name:'Faculty',email:'faculty@example.test'};
  const first=await call('admin',issue),second=await call('admin',issue);
  assert.equal(first.code,200);assert.equal(second.code,200);
  const token=r=>new URL(r.data.inviteUrl).searchParams.get('t');
  const password=crypto.randomBytes(24).toString('hex');
  assert.equal((await call('auth',{action:'invite_accept',token:token(first),password})).code,410);
  const results=await Promise.all([1,2].map(()=>call('auth',{action:'invite_accept',token:token(second),password})));
  assert.deepEqual(results.map(r=>r.code).sort(),[200,410]);
  assert(await A.verifyPasswordAsync(password,(await s`SELECT password_hash FROM users WHERE id='faculty'`)[0].password_hash));
});
test('catalogue edits, address and capabilities survive registration and revision changes',async()=>{
  const saved=await call('admin',{action:'save_sim',id:'rapid-01-disaster',title:'My title',number:1,tagline:'My tagline',description:'My description',minutes:35,launchUrl:'https://example.test/custom',published:true,sessionSupported:true});
  assert.equal(saved.code,200,JSON.stringify(saved.data));
  const token=L.sign({kind:'register',sim:'rapid-01-disaster',title:'Deployment title',tagline:'Deployment tagline',description:'Deployment description',minutes:20,launchUrl:'https://example.test/old',catalogueRevision:'new',detail:{world:'New world'},exp:Date.now()+300000});
  assert.equal((await call('register',{token})).code,200);
  const row=(await s`SELECT * FROM sims WHERE id='rapid-01-disaster'`)[0];
  const shown=require('../../platform/lib/catalogue').present(row);
  assert.equal(shown.title,'My title');assert.equal(shown.tagline,'My tagline');assert.equal(row.minutes,35);
  assert.equal(row.launch_url,'https://example.test/custom');assert.equal(shown.sessionSupported,true);
  assert.equal(shown.detail.world,'New world','registered copy wins over an older bundled snapshot');
});
test('oversized detail rejects without partial field updates',async()=>{
  const before=(await s`SELECT * FROM sims WHERE id='rapid-01-disaster'`)[0];
  const input={action:'save_detail',id:before.id,tagline:'Must not save'};
  for(const key of ['world','seat','clock','teaches','tangle','turn','activity'])input[key]='x'.repeat(2000);
  assert.equal((await call('admin',input)).code,413);
  const after=(await s`SELECT * FROM sims WHERE id=${before.id}`)[0];
  assert.equal(after.tagline,before.tagline);assert.deepEqual(after.detail,before.detail);
});
test('student cannot undo instructor removal',async()=>{
  await s`UPDATE enrolments SET dropped=true WHERE id='enrol'`;
  assert.equal((await call('student',{action:'enrol',joinCode:'ABCDEF'},'student')).code,403);
  assert.equal((await s`SELECT dropped FROM enrolments WHERE id='enrol'`)[0].dropped,true);
  await s`UPDATE enrolments SET dropped=false WHERE id='enrol'`;
});
test('launch denial escapes course titles and 70-minute sim gets sufficient lifetime',async()=>{
  const marker='<script>window.bad=1</script>';
  await s`UPDATE courses SET title=${marker} WHERE id='course'`;
  await s`INSERT INTO sims(id,title,launch_url,minutes) VALUES('long-sim','Long','https://example.test/long',70)`;
  const denied=await call('launch',{},'student',{sim:'long-sim',course:'course'});
  assert.equal(denied.code,403);assert(!denied.data.includes(marker));assert(denied.data.includes('&lt;script&gt;'));
  await s`INSERT INTO course_sims(course_id,sim_id) VALUES('course','long-sim')`;
  const launched=await call('launch',{},'student',{sim:'long-sim',course:'course',format:'json'});
  assert.equal(launched.code,200,JSON.stringify(launched.data));
  const payload=L.verify(new URLSearchParams(new URL(launched.data.url).hash.slice(1)).get('lt'));
  assert.equal(payload.kind,'launch');assert(payload.exp-payload.iat>=160*60000);
  assert.equal((await s`SELECT id FROM launches WHERE id=${payload.run}`).length,1);
});
test('authentication hashing is asynchronous and throttles repeated attempts',async()=>{
  const password=crypto.randomBytes(24).toString('hex');
  const hash=await A.hashPasswordAsync(password);assert(await A.verifyPasswordAsync(password,hash));
  assert(!await A.verifyPasswordAsync(password+'bad',hash));
  await s`DELETE FROM auth_attempts`;
  for(let i=0;i<10;i++)assert.equal((await call('auth',{action:'signin',email:'nobody@example.test',password})).code,401);
  assert.equal((await call('auth',{action:'signin',email:'nobody@example.test',password})).code,429);
});

test('registration never deletes aliases or rewrites academic history',async()=>{
  const register = payload => call('register',{token:L.sign({kind:'register',exp:Date.now()+60000,...payload})});
  const before=(await s`SELECT * FROM sims WHERE id='rapid-01-disaster'`)[0];
  const announcement={sim:'new-independent-sim',title:'New independent simulation',minutes:30,launchUrl:'https://new.example.test',replaces:['rapid-01-disaster'],detail:{_edited:['title'],_sessionSupported:true,world:'Original world'}};
  const created=await register(announcement);
  assert.equal(created.code,200);assert.equal(created.data.created,true);
  assert.deepEqual(created.data.aliasesRemoved,[]);assert.deepEqual(created.data.aliasesRetained,['rapid-01-disaster']);
  assert.deepEqual((await s`SELECT * FROM sims WHERE id='rapid-01-disaster'`)[0],before);
  assert.equal((await s`SELECT count(*)::int AS n FROM launches WHERE sim_id='rapid-01-disaster'`)[0].n,1);
  let row=(await s`SELECT * FROM sims WHERE id='new-independent-sim'`)[0];
  assert.equal(row.published,false);assert.equal(row.detail._sessionSupported,undefined);
  assert.equal((await register({...announcement,title:'Updated title',catalogueRevision:'2'})).code,200);
  row=(await s`SELECT * FROM sims WHERE id='new-independent-sim'`)[0];assert.equal(row.title,'Updated title');
  const oversized=await register({...announcement,title:'Do not save',detail:{world:'x'.repeat(13000)}});
  assert.equal(oversized.code,413);assert.equal((await s`SELECT title FROM sims WHERE id='new-independent-sim'`)[0].title,'Updated title');
});

test('full lifecycle: invitation, draft review, enrolment, entitlement, launches and faculty results',async()=>{
  const simIds=['flow-published','flow-draft'];
  for(const [index,id] of simIds.entries()) {
    const saved=await call('admin',{action:'save_sim',id,title:id,launchUrl:'https://example.test/'+id,minutes:20,published:index===0});
    assert.equal(saved.code,200,JSON.stringify(saved.data));
  }
  const invite=await call('admin',{action:'invite_faculty',name:'Course owner',email:'owner@example.test'});
  assert.equal(invite.code,200);
  const password=crypto.randomBytes(24).toString('hex');
  const accepted=await call('auth',{action:'invite_accept',token:new URL(invite.data.inviteUrl).searchParams.get('t'),password});
  assert.equal(accepted.code,200);
  const cookie=res=>String(res.headers['Set-Cookie']).match(/fx_sess=([^;]+)/)[1];
  const facultyCookie=cookie(accepted);
  let overview=await call('faculty',{action:'overview'},facultyCookie);
  assert(!overview.data.catalogue.some(sim=>sim.id==='flow-draft'));
  assert.equal((await call('admin',{action:'grant_sim_access',simId:'flow-draft',email:'owner@example.test',note:'Review'})).code,200);
  overview=await call('faculty',{action:'overview'},facultyCookie);
  assert(overview.data.catalogue.some(sim=>sim.id==='flow-draft'));
  const created=await call('faculty',{action:'create_course',title:'Lifecycle test',term:'Test'},facultyCookie);
  assert.equal(created.code,200,JSON.stringify(created.data));
  const courseId=created.data.courseId;
  for(const simId of simIds)assert.equal((await call('faculty',{action:'add_sim',courseId,simId,expectedSeats:24},facultyCookie)).code,200);
  const joined=await call('student',{action:'signup_and_enrol',joinCode:created.data.joinCode,name:'Test learner',email:'learner@example.test',password});
  assert.equal(joined.code,200,JSON.stringify(joined.data));
  const studentCookie=cookie(joined);
  assert.equal((await call('launch',{},studentCookie,{sim:simIds[0],course:courseId,format:'json'})).code,403);
  assert.equal((await call('faculty',{action:'set_paid',courseId,all:true,paid:true,note:'Test access'},facultyCookie)).code,200);
  for(const simId of simIds) {
    const launched=await call('launch',{},studentCookie,{sim:simId,course:courseId,format:'json'});
    assert.equal(launched.code,200,JSON.stringify(launched.data));
    const launch=L.verify(new URLSearchParams(new URL(launched.data.url).hash.slice(1)).get('lt'));
    assert.equal(launch.kind,'launch');assert.equal(launch.role,'student');assert.equal(launch.course,courseId);
    const token=R.signReport({...R.makeReport('complete',{launch,summary:'Finished the test run',metrics:{result:'Complete'}}),iat:Date.now(),exp:Date.now()+60000});
    assert.equal((await call('complete',{token})).code,200);
  }
  assert.equal((await s`SELECT count(*)::int AS n FROM completions WHERE course_id=${courseId}`)[0].n,2);
  const course=await call('faculty',{action:'sim_progress',courseId,simId:simIds[0]},facultyCookie);
  assert.equal(course.code,200,JSON.stringify(course.data));
  assert.match(JSON.stringify(course.data),/Finished the test run/);
  const unissued=reportToken('complete',{launch:{sub:'nobody',sim:simIds[0],course:courseId,run:'not-issued'},runId:'unissued'});
  assert.equal((await call('complete',{token:unissued})).code,404);
});
