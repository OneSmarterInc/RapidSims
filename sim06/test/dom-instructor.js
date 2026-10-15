// DOM smoke test for the Live screen (live.html), opened from the session page. Needs jsdom: npm i --no-save jsdom@24
const {session,call,fs,path,assert,SIM,addClock}=require('./dom-common.js');
const {JSDOM}=require('jsdom');
(async()=>{
  const made=await call(session,'POST',{action:'create',mode:'individual',facultyCode:'f'},{});
  const code=made.body.session.code;assert.ok(/^[A-Z2-9]{5}$/.test(code),'session created');
  const html=fs.readFileSync(path.join(SIM,'public/live.html'),'utf8').replace(/@import url\([^)]*\);/,'');
  const dom=new JSDOM(html,{url:'https://x.test/live.html?session='+code,runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
    w.sessionStorage.setItem('m06-fc','f');
    w.fetch=async(u,o={})=>{const hd={};Object.entries(o.headers||{}).forEach(([k,v])=>hd[k.toLowerCase()]=v);const r=await call(session,'POST',JSON.parse(o.body),hd);return {ok:r.status<400,status:r.status,json:async()=>r.body}};
  }});
  const w=dom.window,$=s=>w.document.querySelector(s),text=()=>w.document.getElementById('app').textContent,wait=ms=>new Promise(r=>setTimeout(r,ms));
  await wait(300);
  assert.strictEqual($('.code').textContent,code,'code shown');
  assert.ok(!$('#start'),'the session page starts the clock, not the Live screen');
  $('#pres').click();await wait(50);assert.ok($('.join-big'),'join code projection');$('#exit').click();await wait(50);
  await call(session,'POST',{action:'join',code,name:'Ana'},{});
  await call(session,'POST',{action:'control',code,set:'start',facultyCode:'f'},{});
  addClock(100000);await wait(2200);
  assert.ok(text().includes('Decisions by report'),'projector live');
  assert.ok(!text().includes('Debrief, in this order'),'no debrief during play');
  addClock(600000);await wait(2200);
  assert.ok(text().includes('Debrief, in this order')&&text().includes('Disagreement'),'debrief after clock');
  assert.ok(!text().includes('Ana'),'no names on the Live screen');
  console.log('Live screen DOM smoke passed');process.exit(0);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
