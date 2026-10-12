#!/usr/bin/env node
'use strict';
// Isolated PostgreSQL engine + actual API/HTML. Never reads a connection string.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), http=require('node:http');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const db=new PGlite();await db.exec(fs.readFileSync(path.join(__dirname,'../lib/schema.sql'),'utf8'));
 let readOnly=false;
 const s=async(strings,...values)=>{const text=strings.reduce((q,t,i)=>q+(i?'$'+i:'')+t,'');if(readOnly)assert(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i.test(text),'Results must not mutate data');return (await db.query(text,values)).rows;};
 s.query=async(text,values)=>(await db.query(text,values)).rows;
 const dbFile=require.resolve('../lib/db.js');require.cache[dbFile]={id:dbFile,filename:dbFile,loaded:true,exports:{sql:()=>s,id:()=>{throw Error('No writes allowed');}}};
 for(const [id,role] of [['f1','faculty'],['f2','faculty'],['a1','admin']]){await s`INSERT INTO users(id,name,email,role) VALUES(${id},${id},${id+'@example.test'},${role})`;await s`INSERT INTO sessions(id,user_id,expires_at) VALUES(${id},${id},now()+interval '1 day')`;}
 await s`INSERT INTO courses(id,faculty_id,title,join_code) VALUES('c1','f1','Test','TEST01'),('c2','f2','Other course','TEST02')`;
 await s`INSERT INTO sims(id,number,title,launch_url,published) VALUES('rapid-03-midland',3,'Midland Equipment','/sim03',true),('other',4,'Other simulation','/other',true)`;
 await s`INSERT INTO course_sims(course_id,sim_id) VALUES('c1','rapid-03-midland'),('c1','other'),('c2','rapid-03-midland')`;
 for(let i=0;i<23;i++){const id='s'+String(i).padStart(2,'0');await s`INSERT INTO users(id,name,email,role) VALUES(${id},${i<2?'Alex Morgan':'Student '+String(i).padStart(2,'0')},${id+'@example.test'},'student')`;await s`INSERT INTO enrolments(id,course_id,student_id,paid,dropped) VALUES(${id},'c1',${id},${i!==5},${i===3})`;}
 await s`INSERT INTO sessions(id,user_id,expires_at) VALUES('student','s00',now()+interval '1 day')`;
 for(const id of ['s00','s01','s02','s03','s04','s06'])await s`INSERT INTO launches(id,user_id,sim_id,course_id,as_role) VALUES(${id},${id},'rapid-03-midland','c1','student')`;
 await s`INSERT INTO launches(id,user_id,sim_id,course_id,as_role) VALUES('ambiguous','s02','rapid-03-midland','c2','student')`;
 for(let i=0;i<26;i++)await s`INSERT INTO completions(id,user_id,sim_id,course_id,completed_at,duration_seconds,summary,metrics) VALUES(${String(i).padStart(3,'0')},'s00','rapid-03-midland','c1',${new Date(Date.UTC(2026,9,1,0,i)).toISOString()},${i===25?0:60},${i===25?JSON.stringify({result:{overall:'<img src=x onerror=alert(1)>'},teamRunId:'team1',teamLabel:'Cedar',completedBy:'Alex',reflection:'Line one\nLine two'}):'Older outcome'},${JSON.stringify({score:0,passed:false,nested:{items:['a','b']}})}::jsonb)`;
 await s`UPDATE completions SET completed_at='2026-10-01T00:16:00.123456Z' WHERE id='016'`;
 await s`UPDATE completions SET completed_at='2026-10-01T00:16:00.123455Z' WHERE id='015'`;
 for(const [id,user,course,sim] of [['legacy','s01',null,'rapid-03-midland'],['ambiguous','s02',null,'rapid-03-midland'],['removed','s03','c1','rapid-03-midland'],['other-course','s00','c2','rapid-03-midland'],['other-sim','s00','c1','other']])await s`INSERT INTO completions(id,user_id,course_id,sim_id,summary) VALUES(${id},${user},${course},${sim},'History')`;
 for(let i=0;i<12;i++)await s`INSERT INTO transcripts(id,user_id,sim_id,course_id,recorded_at,sim_version,envelope) VALUES(${'t'+i},'s00','rapid-03-midland','c1',${new Date(Date.UTC(2026,9,1,1,i)).toISOString()},'v1',${JSON.stringify({events:[{input:'<script>unsafe</script>',ordinal:i}],phases:[],simId:'rapid-03-midland'})}::jsonb)`;
 readOnly=true;
 const handler=require('../api/faculty.js');let assertions=0;
 async function call(body,cookie='f1',method='POST') {const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(data){this.body=data;return this;}};await handler({method,headers:{cookie:cookie?'fx_sess='+cookie:'',host:'localhost'},body},res);return res;}
 const check=(value,message)=>{assert(value,message);assertions++;};
 const input={action:'sim_results',courseId:'c1',simId:'rapid-03-midland'};
 for(const [role,code] of [['',401],['student',403],['a1',403],['f2',404]])check((await call(input,role)).statusCode===code,'Role/ownership '+role);
 check((await call(input,'f1','GET')).statusCode===405,'POST only');
 check((await call({...input,simId:'missing'})).statusCode===404,'Unassigned simulation');
 const response=await call(input);check(response.statusCode===200,'Results status '+JSON.stringify(response.body));check(response.headers['Cache-Control'].includes('no-store'),'Private results are not cached');
 const data=response.body;check(data.total===23&&data.rows.length===20&&data.pages===2,'Roster pagination');check(data.rows[0].student_id!==data.rows[1].student_id&&data.rows[0].name===data.rows[1].name,'Duplicate names remain separate');
 check(Number(data.stats.students)===22&&Number(data.stats.completed)===2&&Number(data.stats.completions)===27,'Active-only stats, course/sim scoping');
 check(data.rows[0].attempts.length===3&&data.rows[0].attempts[0].ordinal===26,'Newest three and lifetime ordinal');check(data.rows[1].attempts[0].legacy_course,'Unambiguous legacy retained');check(data.ambiguous_legacy&&!data.rows.find(r=>r.student_id==='s02').completions,'Ambiguous legacy excluded');
 check(data.rows.find(r=>r.student_id==='s03').completions===1,'Removed enrolment retains history');check(data.rows.find(r=>r.student_id==='s05').status==='not-released','Access waiting');check(data.rows.find(r=>r.student_id==='s04').status==='started','Launch-only state');
 check((await call({...input,search:'Alex'})).body.total===2,'Search accounts');check((await call({...input,filter:'repeated'})).body.total===1,'Repeat filter');check((await call({...input,page:999})).body.page===2,'Out-of-range page clamped');check((await call({...input,search:"%' OR 1=1 --"})).body.total===0,'Search is literal and parameterized');
 const history={...input,action:'sim_result_history',studentId:'s00',kind:'attempts'};
 check((await call({...history,studentId:'f2'})).statusCode===404,'History enrolment check');check((await call(history,'f2')).statusCode===404,'History ownership');check((await call({...history,cursor:'not-json'})).statusCode===400,'Invalid cursor');
 let cursor=null,ids=[];do{const r=await call({...history,cursor});check(r.statusCode===200,'History page status');ids.push(...r.body.items.map(x=>x.id));cursor=r.body.next;}while(cursor);
 check(ids.length===26&&new Set(ids).size===26,'All completions available exactly once across pages');check(!ids.includes('other-course')&&!ids.includes('other-sim'),'Other course and SIM excluded');
 let t=await call({...history,kind:'transcripts'});check(t.body.items.length===10&&!!t.body.next,'Transcript pagination');t=await call({...history,kind:'transcripts',cursor:t.body.next});check(t.body.items.length===2&&!t.body.next,'Remaining transcripts');
 const before=await s`SELECT (SELECT count(*) FROM completions)::int AS completions,(SELECT count(*) FROM transcripts)::int AS transcripts`;
 if(process.argv.includes('--browser')){
  const {chromium}=require('playwright');let forceFailure=false,delay=0;
  const server=http.createServer(async(req,res)=>{try{
   const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/')){let raw='';for await(const part of req)raw+=part;const b=JSON.parse(raw);if(delay)await new Promise(r=>setTimeout(r,delay));if(b.action==='me'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({user:{id:'f1',role:'faculty',name:'Teacher'}}));}if(forceFailure&&b.action==='sim_results'){res.writeHead(503);return res.end('{}');}const r=await call(b);res.writeHead(r.statusCode,{'content-type':'application/json'});return res.end(JSON.stringify(r.body));}
   const file=path.resolve(__dirname,'../public',url.pathname.slice(1));if(!file.startsWith(path.resolve(__dirname,'../public')+path.sep)){res.writeHead(404);return res.end();}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
  }catch(e){res.writeHead(500);res.end(String(e));}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  try{
   const loaded=()=>page.locator('.fr-name').first().waitFor();
   await page.goto(base+'/faculty.html?view=course&course=c1');await page.locator('[data-sim-results="rapid-03-midland"]').click();await loaded();check(page.url().includes('view=sim-results'),'Button route');if(process.env.FACULTY_RESULTS_SCREENSHOT)await page.screenshot({path:process.env.FACULTY_RESULTS_SCREENSHOT});check(await page.locator('.fr-table tbody>tr').count()===20,'One row per account');check(await page.locator('.fr-outcome img').count()===0,'Summary HTML escaped');
   await page.getByRole('button',{name:'Expand loaded details'}).click();check((await page.locator('.fr-fields').first().innerText()).includes('false'),'False metrics preserved');check((await page.locator('.fr-meta').allTextContents()).some(x=>x.includes('0 seconds')),'Zero duration preserved');
   await page.locator('[data-fr-more="0"]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-fr-attempts="0"] .fr-attempt').length===13);check(await page.locator('.fr-table tbody>tr').count()===20,'Loading history does not duplicate students');
   await page.locator('[data-fr-transcripts="0"] summary').first().click();await page.locator('[data-fr-transcript-load="0"]').click();await page.waitForFunction(()=>document.querySelectorAll('.fr-transcript-record').length===10);check((await page.locator('.fr-transcripts').first().innerText()).includes('cannot be reliably matched'),'Transcripts not misattributed');
   await page.locator('input[name=search]').fill('Alex');await page.getByRole('button',{name:'Apply',exact:true}).click();await loaded();check(await page.locator('.fr-table tbody>tr').count()===2,'Browser search');await page.reload();await loaded();check(await page.locator('input[name=search]').inputValue()==='Alex','Search restored');
   await page.locator('.fr-back').click();await page.locator('[data-sim-results]').first().waitFor();await page.goBack();await loaded();check(page.url().includes('view=sim-results'),'Back restores results');await page.goForward();await page.locator('[data-sim-results]').first().waitFor();
   await page.goto(base+'/faculty.html?view=sim-results&course=c1&sim=rapid-03-midland');await loaded();await page.locator('#frNext').click();await loaded();check(await page.locator('.fr-table tbody>tr').count()===3,'Next page');await page.reload();await loaded();check(await page.locator('.fr-table tbody>tr').count()===3,'Pagination refresh');
   for(const width of [1440,768,390]){await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow '+width);check(await page.evaluate(()=>!Array.from(document.querySelectorAll('.faculty-results *')).some(e=>['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight)),'No internal scrollbar '+width);}
   await page.locator('input[name=search]').fill('Not a student');await page.getByRole('button',{name:'Apply',exact:true}).click();await page.getByText('No matching students',{exact:true}).waitFor();check(true,'Empty filter state');
   forceFailure=true;await page.reload();await page.getByRole('heading',{name:'Unable to open this page'}).waitFor();check(true,'Error state');forceFailure=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByText('No matching students',{exact:true}).waitFor();check(true,'Retry preserves route');
   check(errors.length===0,'No browser errors '+errors.join(','));
  }finally{await browser.close();await new Promise(r=>server.close(r));}
 }
 const after=await s`SELECT (SELECT count(*) FROM completions)::int AS completions,(SELECT count(*) FROM transcripts)::int AS transcripts`;assert.deepEqual(after,before);
 await db.close();console.log(`Faculty simulation results: ${assertions} checks passed; existing records unchanged.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
