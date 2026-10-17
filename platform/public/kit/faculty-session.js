/* RapidSims faculty sessions pages: the Sessions page and the session page (Teams or Students, Results, Debrief).
   Shared by every sim (template: claude/RapidSims-Faculty-Template.md). The sim's instructor.html loads this with
   its settings: FacultySession.start(settings). Settings: id, title, code, modes, defaultMode, storage, advanced(),
   and the workspace adapter fields read by /kit/faculty-workspace.js. */
(function(global){
'use strict';
// The signed launch token arrives in the hash (#lt=) or, from older links, the query.
function launchToken(loc){return new URLSearchParams(String(loc.hash||'').slice(1)).get('lt')||new URLSearchParams(loc.search||'').get('lt')||null}
const MODE_TEXT={team:"<b>Team</b><span>One member enters the team's decisions. Everyone writes their own review.</span>",individual:'<b>Individual</b><span>Every student makes every decision.</span>'};
function start(SIM){
const app=document.getElementById('app');function esc(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML}
const BASE=(location.pathname.match(/^\/sim(?:-?plus)?-?\d+/)||[''])[0];
const FACULTY_TOKEN_KEY=SIM.storage.token;
const incomingLT=launchToken(location);
let LT=incomingLT||sessionStorage.getItem(FACULTY_TOKEN_KEY)||null;
if(incomingLT)sessionStorage.setItem(FACULTY_TOKEN_KEY,incomingLT);
if(incomingLT){let p=new URLSearchParams(location.search);p.delete('lt');history.replaceState(null,'',location.pathname+(p.toString()?'?'+p:''))}
const savedCode=(location.hash||'').replace('#','')||localStorage.getItem(SIM.storage.session)||'';let facultyCode='',mode='',code='',state=null,poll=null,error='',aSel='',bSel='',presentIndex=0;
let draftName=new Date().toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}),draftResume=savedCode,busy=false,authProblem=false,courseChoices=[],renewing=null;
const launchPreference=new URLSearchParams(location.search).get('play');
// A sim with defaultMode null makes faculty choose the mode (no default).
if(SIM.modes.includes(launchPreference))mode=launchPreference;else mode=SIM.defaultMode===null?'':(SIM.defaultMode||SIM.modes[0]);
const FACULTY_COURSE_KEY=SIM.storage.course;
const PLATFORM_LAUNCH_PATH='/api/launch';
function attr(value){return esc(value).replaceAll('"','&quot;')}
let facultyDashboard=BASE?'/faculty.html':'';
function tokenInfo(token){try{return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))))}catch{return null}}
// This metadata only selects a class for reauthorization. The platform checks
// its signed-in user and course ownership; the sim still verifies the signature.
let facultyCourse=new URLSearchParams(location.search).get('course')||tokenInfo(LT)?.course||sessionStorage.getItem(FACULTY_COURSE_KEY)||'';
function rememberCourse(value){facultyCourse=String(value||'');if(facultyCourse)sessionStorage.setItem(FACULTY_COURSE_KEY,facultyCourse);else sessionStorage.removeItem(FACULTY_COURSE_KEY);const u=new URL(location.href);if(facultyCourse)u.searchParams.set('course',facultyCourse);else u.searchParams.delete('course');history.replaceState(null,'',u.pathname+u.search+u.hash)}
if(incomingLT)rememberCourse(tokenInfo(incomingLT)?.course||'');
function captureDraft(){draftName=document.getElementById('name')?.value??draftName;draftResume=document.getElementById('resumeCode')?.value??draftResume;facultyCode=document.getElementById('fc')?.value.trim()??facultyCode}
function recoveryLink(){if(!facultyDashboard)return notice('Open your RapidSims faculty dashboard to renew access.');return `<div class="actions"><a class="btn" id="facultyRecovery" href="${esc(facultyDashboard+(facultyCourse?'?course='+encodeURIComponent(facultyCourse):''))}" target="_blank" rel="noopener">Open faculty dashboard</a></div>`}
async function renewFaculty(){
  if(renewing)return renewing;
  renewing=(async()=>{
    if(!BASE)throw new Error('Open this session from your RapidSims faculty dashboard, or enter your configured standalone facilitator code.');
    const q=new URLSearchParams({sim:SIM.id,mode:'session',format:'json'});if(facultyCourse)q.set('course',facultyCourse);
    const r=await fetch(PLATFORM_LAUNCH_PATH+'?'+q,{credentials:'same-origin',cache:'no-store'});let d={};try{d=await r.json()}catch{}
    if(d.error==='course_selection_required'){courseChoices=Array.isArray(d.courses)?d.courses:[];throw new Error('Choose the course for this session, then try again.')}
    if(r.status===401)throw new Error('Sign in to your faculty account from the dashboard, then return here and try again. Your session details have been kept.');
    if(!r.ok)throw new Error(d.message||'Unable to renew faculty access. Open your faculty dashboard and try again.');
    let token=null;try{const u=new URL(d.url,location.origin);token=new URLSearchParams(u.hash.slice(1)).get('lt')||u.searchParams.get('lt')}catch{}
    const info=tokenInfo(token);
    if(!info||info.sim!==SIM.id||!['faculty','faculty_preview'].includes(info.role)||info.mode!=='session')throw new Error('Sign in with a faculty account to create or manage a class session.');
    LT=token;sessionStorage.setItem(FACULTY_TOKEN_KEY,LT);rememberCourse(info.course||'');courseChoices=[];
  })();
  try{return await renewing}finally{renewing=null}
}
function showAuthProblem(message){authProblem=true;error=message;clearInterval(poll);const box=document.getElementById('faculty-error');if(box)box.innerHTML=notice(message,true)+recoveryLink()}

function safeToRerender(){const el=document.activeElement;return !el||el.readOnly||el.disabled||!['INPUT','TEXTAREA','SELECT'].includes(el.tagName)}
let stateRequest=0;
async function api(x){
  if(!['faculty_state','faculty_enrolments'].includes(x.action))stateRequest++;
  async function send(){const usedToken=LT,h={'Content-Type':'application/json'};if(usedToken)h['x-launch-token']=usedToken;const r=await fetch(BASE+'/api/session',{method:'POST',headers:h,body:JSON.stringify({...x,facultyCode,launchToken:usedToken})});let d={};try{d=await r.json()}catch{}return {r,d,usedToken}}
  if(!facultyCode&&(!LT||(BASE&&tokenInfo(LT)?.mode!=='session'))){try{await renewFaculty()}catch(e){showAuthProblem(e.message);throw e}}
  let result=await send();
  if(result.d.error==='faculty_authorization_required'&&!facultyCode){
    try{
      // Another overlapping poll may already have renewed this token.
      if(LT===result.usedToken){await renewFaculty()}
      result=await send();
    }catch(e){showAuthProblem(e.message);throw e}
  }
  // One open session per course: confirm, then close the open one and carry on.
  if(result.d.error==='other_session_open'&&!x.closeOpen){
    if(window.confirm(result.d.message||'This closes the open session. Submitted teams keep their results.'))return api({...x,closeOpen:true});
    const err=new Error('The open session stays open.');err.code='kept_open';throw err;
  }
  const {r,d}=result;
  if(!r.ok){
    if(d.error==='faculty_authorization_required'){
      const message=facultyCode?'That facilitator code was not accepted. Check the code, or open the session from your faculty dashboard.':'The simulation could not verify your renewed faculty access. Open your faculty dashboard and try again. If it continues, the platform and simulation launch configuration needs checking.';
      sessionStorage.removeItem(FACULTY_TOKEN_KEY);LT=null;showAuthProblem(message);throw new Error(message);
    }
    const err=new Error(d.message||d.error||`Server error ${r.status}`);err.code=d.error;err.data=d;throw err;
  }
  if(authProblem){authProblem=false;error='';const box=document.getElementById('faculty-error');if(box)box.innerHTML=''}
  return d;
}
const notice=(s,b=false)=>`<div class="notice ${b?'bad':''}">${esc(s)}</div>`;const vals=o=>Object.values(o||{}).filter(Boolean);function stablePeople(list){return list.slice().sort((a,b)=>(a.joinedAt||0)-(b.joinedAt||0)||String(a.name||'').localeCompare(String(b.name||''))||String(a.id||'').localeCompare(String(b.id||'')))}const participants=()=>stablePeople(vals(state?.participants)),runs=()=>vals(state?.runs).sort((a,b)=>String(a.runId||'').localeCompare(String(b.runId||'')));
// Breadcrumb and left menu: Class › sim › Sessions › this session.
const SIM_ID=SIM.id;
// Inside the class page's frame, the class page draws the menu; this page tells it where it is.
const FRAMED=(()=>{try{return window.parent!==window&&window.parent.location.origin===location.origin}catch{return false}})();
if(FRAMED){document.documentElement.classList.add('framed');window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent||e.data?.type!=='rs-nav')return;const to=e.data.to;if(to==='sessions'){if(code)goSessions();return}if(code&&['teams','results','debrief'].includes(to))window.FacultyWorkspace.show(to==='teams'?'manage':to)})}
let classTitle='',classTitleFor='';
function sessionWhen(x){return x?.name||(x?.createdAt?new Date(x.createdAt).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Session')}
async function loadClassTitle(course){
  if(!course||classTitleFor===course||!BASE)return;classTitleFor=course;
  try{const cached=sessionStorage.getItem('rs-class-'+course);if(cached){classTitle=cached;renderNav();return}}catch{}
  try{const r=await fetch((facultyDashboard||'/faculty.html').replace(/faculty\.html.*$/,'')+'api/faculty',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'overview'})});const d=r.ok?await r.json():{};
    const c=(d.courses||[]).find(x=>x.id===course);if(c){classTitle=c.title;try{sessionStorage.setItem('rs-class-'+course,c.title)}catch{}renderNav()}}catch{}
}
function goSessions(){clearInterval(poll);code='';state=null;courseSessions=null;error='';history.replaceState(null,'',location.pathname+location.search.replace(/([?&])(session|tab)=[^&]*/g,'$1').replace(/[?&]+$/,'').replace(/\?&/,'?'));render()}
function sessionTab(){return window.FacultyWorkspace?.page?.()||null}
function renderNav(){
  const course=state?.session?.courseId||facultyCourse;loadClassTitle(course);
  const courseHref=facultyDashboard&&course?facultyDashboard+'?view=course&course='+encodeURIComponent(course):'';
  const st=state?.session,crumbs=document.getElementById('crumbs');
  if(crumbs){crumbs.innerHTML=(courseHref?`<a id="crumbClass" href="${attr(courseHref)}">${esc(classTitle||'Class')}</a><span aria-hidden="true">›</span>`:'')+`<span>${esc(SIM.title)}</span><span aria-hidden="true">›</span>`+
    (code?`<button type="button" id="allSessions">Sessions</button><span aria-hidden="true">›</span><b>${esc(sessionWhen(st))}</b>`:`<b>Sessions</b>`);
    const all=document.getElementById('allSessions');if(all)all.onclick=goSessions;const cc=document.getElementById('crumbClass');if(cc&&FRAMED)cc.target='_top'}
  const hs=document.getElementById('hs');if(hs){hs.textContent=st?(st.state==='closed'?'Closed':st.state==='lobby'?'Setting up':st.paused?'Paused':'Running'):'';hs.dataset.state=st?(st.state==='running'&&!st.paused?'run':st.state==='closed'?'off':'set'):''}
  if(FRAMED){const tab=sessionTab();window.parent.postMessage({type:'rs-frame',course,session:code&&st?{code,label:sessionWhen(st),state:st.paused?'paused':st.state,team:st.mode==='team'}:null,tab:code?(tab==='manage'||!tab?'teams':tab):'sessions'},location.origin);return}
  if(!window.FacultyMenu&&BASE&&!document.getElementById('rs-menu-script')){const sc=document.createElement('script');sc.id='rs-menu-script';sc.src=(facultyDashboard||'/faculty.html').replace(/faculty\.html.*$/,'')+'faculty-menu.js';sc.onload=()=>renderNav();document.head.appendChild(sc)}
  if(!window.FacultyMenu||!course)return;
  const dash=facultyDashboard||'/faculty.html',tab=sessionTab();
  FacultyMenu.mount({classesHref:dash,current:code?`${SIM_ID}:${tab==='manage'?'teams':tab||'teams'}`:`${SIM_ID}:sessions`,
    course:{id:course,title:classTitle||'Class',href:courseHref},
    sims:[{id:SIM_ID,title:SIM.title,links:{sessions:'#sessions',results:`${dash}?view=sim-results&course=${encodeURIComponent(course)}&sim=${SIM_ID}`,
      rehearse:`${dash}?view=rehearse&course=${encodeURIComponent(course)}`,play:`/api/launch?sim=${SIM_ID}&course=${encodeURIComponent(course)}`},
      session:code&&st?{label:sessionWhen(st),state:st.paused?'paused':st.state,team:st.mode==='team',links:{teams:'#teams',results:'#results',debrief:'#debrief'}}:null}],
    onNavigate:key=>{const k=key.split(':')[1];if(k==='sessions'){goSessions();return true}
      if(['teams','results','debrief'].includes(k)&&code){window.FacultyWorkspace.show(k==='teams'?'manage':k);return true}return false}});
}
async function topControl(set,btn){
  if(set==='close'&&!window.confirm('Close this session? Submitted teams keep their results. Unfinished teams keep their saved decisions. You can reopen it.'))return;
  if(set==='reopen'&&!window.confirm('Reopen this session? Teams continue from their saved decisions.'))return;
  btn.disabled=true;
  try{await api({action:'control',code,set,from:'top-bar'});courseSessions=null;await refresh()}
  catch(e){window.alert(e.message||'That did not go through. Try again.')}
  finally{btn.disabled=false}
}
function render(){code?consoleView():createView();renderNav()}
let courseSessions=null,courseSessionsBusy=false;
const sessionState=x=>x.state==='closed'?'Closed':x.state==='lobby'?'Setting up':x.paused?'Paused':'Running';
async function loadCourseSessions(){if(courseSessionsBusy||!LT||tokenInfo(LT)?.mode!=='session')return;courseSessionsBusy=true;try{const r=await fetch(BASE+'/api/session',{method:'POST',headers:{'Content-Type':'application/json','x-launch-token':LT},body:JSON.stringify({action:'course_sessions'})});const d=r.ok?await r.json():{};courseSessions=Array.isArray(d.sessions)?d.sessions:[]}catch{courseSessions=courseSessions||[]}finally{courseSessionsBusy=false;if(!code)render()}}
// Sessions page: the open session or Start a session first, then today's sessions, then earlier ones (closed section).
const isToday=t=>{if(!t)return false;const d=new Date(t),n=new Date();return d.getFullYear()===n.getFullYear()&&d.getMonth()===n.getMonth()&&d.getDate()===n.getDate()};
const whenLabel=t=>t?new Date(t).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
// Older sessions were named after the sim; show their date instead, so each row has its own name.
function sessionName(x){const n=String(x.name||'').trim();return !n||n===SIM.title?whenLabel(x.createdAt)||'Session':n}
function finishedLine(x){if(x.mode==='team'){if(!x.teams)return 'No teams';if(!x.submitted)return 'No team finished';return x.submitted===x.teams?(x.teams===1?'The team finished':x.teams===2?'Both teams finished':`All ${x.teams} teams finished`):`${x.submitted} of ${x.teams} teams finished`}return x.submitted?`${x.submitted} of ${x.students} finished`:'Nobody finished'}
function sessionRow(x){const named=sessionName(x),when=whenLabel(x.createdAt),open=x.state!=='closed';
  return `<li class="srow${open?' srow-open':''}"><div class="srow-main"><b>${esc(named)}</b>${when&&when!==named?`<span class="mono">${esc(when)}</span>`:''}</div>
    <div class="srow-facts"><span class="srow-state" data-state="${open?(x.state==='lobby'?'set':x.paused?'set':'run'):'off'}">${esc(sessionState(x))}</span>${x.mode==='individual'?'<span>Individual</span>':''}<span>${x.students} student${x.students===1?'':'s'}</span><span>${esc(finishedLine(x))}</span></div>
    <div class="srow-acts">${open?`<button class="btn pri" data-open-session="${attr(x.code)}" ${busy?'disabled':''}>Open</button>`:`<button class="btn" data-results-session="${attr(x.code)}" ${busy?'disabled':''}>Results</button><details class="smore"><summary class="btn">More</summary><div class="smore-menu"><button class="btn" data-reopen-session="${attr(x.code)}" ${busy?'disabled':''}>Reopen</button><span>Teams continue from their saved decisions.</span><button class="btn" data-hide-session="${attr(x.code)}" ${busy?'disabled':''}>Hide session</button><span>Removes it from this list. Results stay under Past sessions.</span></div></details>`}</div></li>`}
function sessionsLists(){
  if(courseSessions===null)return '<p class="help">Checking for sessions…</p>';
  const list=courseSessions||[],open=list.filter(x=>x.state!=='closed'),today=list.filter(x=>x.state==='closed'&&isToday(x.createdAt)),earlier=list.filter(x=>x.state==='closed'&&!isToday(x.createdAt));
  return {open:open.length?`<section class="card full sopen"><h3>Session in progress</h3><ul class="slist">${open.map(sessionRow).join('')}</ul></section>`:'',
    today:`<section class="card full"><h3>Today</h3>${today.length?`<ul class="slist">${today.map(sessionRow).join('')}</ul>`:'<p class="help">No other sessions today.</p>'}</section>`,
    earlier:earlier.length?`<details class="card full searlier"><summary><h3>Earlier sessions (${earlier.length})</h3></summary><ul class="slist">${earlier.map(sessionRow).join('')}</ul></details>`:''};
}
async function reopenListed(c){if(busy||!window.confirm('Reopen this session? Teams continue from their saved decisions.'))return;busy=true;error='';render();try{await api({action:'control',code:c,set:'reopen'});courseSessions=null;busy=false;draftResume=c;const box=document.getElementById('resumeCode');if(box)box.value=c;resumeSession();return}catch(e){error=e.message}finally{if(busy){busy=false;render()}}}
async function hideListed(c){if(busy||!window.confirm('Hide this session? It leaves this list. Its results stay under Past sessions.'))return;busy=true;error='';render();try{await api({action:'hide_session',code:c});courseSessions=null}catch(e){error=e.message}finally{busy=false;render()}}
async function closeListed(c){if(busy||!window.confirm('Close this session? Submitted teams keep their results. Unfinished teams keep their saved decisions.'))return;busy=true;error='';render();try{await api({action:'control',code:c,set:'close',from:'list'});courseSessions=null}catch(e){error=e.message}finally{busy=false;render()}}
// About this sim: the faculty one-pager from the sim's own ONE-PAGER.md, served by the platform (/api/one-pager).
// The platform's own endpoint, on purpose (not under the sim's prefix).
const PLATFORM_ONE_PAGER='/api/one-pager?sim=';
let onePager=null,onePagerFor='';
function onePagerHTML(text){return String(text||'').split(/\n{2,}/).map(b=>b.startsWith('# ')?`<h2>${esc(b.slice(2))}</h2>`:b.startsWith('## ')?`<h3>${esc(b.slice(3))}</h3>`:`<p>${esc(b).replace(/\n/g,' ')}</p>`).join('')}
function aboutCard(){return `<details class="card about-sim" id="aboutSim"><summary>About this sim</summary><div id="aboutSimBody">${onePager&&onePagerFor===SIM.id?onePagerHTML(onePager.text)+'<p><button class="btn" id="printAbout" type="button">Print one-pager</button></p>':'<p class="help">Loading…</p>'}</div></details>`}
async function loadOnePager(){if(onePager&&onePagerFor===SIM.id)return;try{const r=await fetch(PLATFORM_ONE_PAGER+encodeURIComponent(SIM.id));if(!r.ok)throw 0;onePager=await r.json();onePagerFor=SIM.id}catch{onePager={text:'The one-pager for this sim is not available right now.'};onePagerFor=SIM.id}const box=document.getElementById('aboutSimBody');if(box){box.innerHTML=onePagerHTML(onePager.text)+'<p><button class="btn" id="printAbout" type="button">Print one-pager</button></p>';bindAbout()}}
function bindAbout(){const d=document.getElementById('aboutSim');if(d)d.ontoggle=()=>{if(d.open)loadOnePager()};const pb=document.getElementById('printAbout');if(pb)pb.onclick=()=>{const w=window.open('','_blank');if(!w)return;w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(SIM.title)}</title><style>body{font:15px/1.55 Georgia,serif;max-width:680px;margin:32px auto;padding:0 16px}h2{font-size:24px}h3{font-size:17px;margin-top:20px}</style>${onePagerHTML(onePager.text)}`);w.document.close();w.focus();w.print()}}
function createView(){if(courseSessions===null)loadCourseSessions();const L=sessionsLists(),lists=typeof L==='string'?{open:'',today:L,earlier:''}:L;
app.innerHTML=`<h2>Sessions</h2><p class="lede">${lists.open?'A session is in progress. Open it, or start a new one.':'Start a session when your class is ready.'}</p>${error?notice(error,true):''}${authProblem?recoveryLink():''}
<div class="grid">${lists.open}<section class="card"><h3>Start a session</h3><div class="field"><label for="name">Session name</label><input id="name" value="${attr(draftName)}"></div>${SIM.modes.length>1?`<div class="field"><label>How students play</label><div class="modes">${SIM.modes.map(m=>`<div class="mode ${mode===m?'on':''}" data-mode="${m}" role="button" tabindex="0">${MODE_TEXT[m]}</div>`).join('')}</div></div>`:`<p class="help">${SIM.modes[0]==='individual'?'Every student plays on their own.':'Students play in teams.'}</p>`}${courseChoices.length?`<div class="field"><label for="facultyCourse">Class for this session</label><select id="facultyCourse"><option value="">Choose class</option>${courseChoices.map(c=>`<option value="${attr(c.id)}" ${facultyCourse===c.id?'selected':''}>${esc(c.title)}</option>`).join('')}</select></div>`:''}${LT?'':`${notice(BASE?'Your signed-in faculty account will be checked when you create or resume a session. A separate code is not needed.':'Open the faculty dashboard to use your account, or enter your configured standalone facilitator code.')}<div class="field"><label for="fc">Standalone facilitator code (code-based access only)</label><input id="fc" type="password" value="${attr(facultyCode)}" autocomplete="off"></div>`}${SIM.createFields?SIM.createFields():''}<div class="actions"><button class="btn pri" id="create" ${mode&&!busy?'':'disabled'}>${busy?'Please wait…':'Start session'}</button></div>${LT?'':`<div class="field"><label>Resume session code</label><input id="resumeCode" maxlength="5" value="${attr(draftResume)}" placeholder="ABCDE"></div><div class="actions"><button class="btn" id="resumeBtn" ${busy?'disabled':''}>Resume session</button></div>`}</section><section class="card"><h3>How a session runs</h3><ol class="steps"><li>Start a session.</li><li>${mode==='team'?'Split students into teams. Students join from the class link.':mode?'Students join from the class link and play their own run.':'Choose how students play, then students join from the class link.'}</li><li>Click Start session.</li></ol>${lists.open?notice('Starting a new session closes the one in progress. Submitted teams keep their results.'):''}</section>${lists.today}${lists.earlier}</div>${aboutCard()}${LT?`<p class="sysmsg">System message: ${esc(SIM.title)} confirmed you as faculty for this class.</p>`:''}`;
document.querySelectorAll('[data-mode]').forEach(x=>{const pick=()=>{if(busy)return;captureDraft();mode=x.dataset.mode;render()};x.onclick=pick;x.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick()}}});document.getElementById('create').onclick=create;bindAbout();{const rb=document.getElementById('resumeBtn');if(rb)rb.onclick=resumeSession}document.querySelectorAll('[data-open-session]').forEach(b=>b.onclick=()=>{captureDraft();draftResume=b.dataset.openSession;resumeSession()});document.querySelectorAll('[data-results-session]').forEach(b=>b.onclick=()=>{const u=new URL(location.href);u.searchParams.set('tab','results');history.replaceState(null,'',u.pathname+u.search+u.hash);captureDraft();draftResume=b.dataset.resultsSession;resumeSession()});document.querySelectorAll('[data-reopen-session]').forEach(b=>b.onclick=()=>reopenListed(b.dataset.reopenSession));document.querySelectorAll('[data-hide-session]').forEach(b=>b.onclick=()=>hideListed(b.dataset.hideSession));const choice=document.getElementById('facultyCourse');if(choice)choice.onchange=()=>rememberCourse(choice.value)}
async function create(){if(busy)return;captureDraft();busy=true;error='';render();try{const d=await api({action:'create',name:draftName.trim(),mode,...(SIM.createPayload?SIM.createPayload(document):{})});code=d.session.code;location.hash=code;localStorage.setItem(SIM.storage.session,code);state={session:d.session,participants:{},runs:{},defaultThresholds:d.session.thresholds};startPoll()}catch(e){error=e.message}finally{busy=false;render()}}
async function resumeSession(){if(busy)return;captureDraft();const v=(draftResume||'').trim().toUpperCase();if(!v){error='Enter the five-character session code to resume.';render();return}busy=true;error='';render();try{const next=await api({action:'faculty_state',code:v});code=v;state=next;location.hash=code;localStorage.setItem(SIM.storage.session,code);startPoll()}catch(e){error=e.message;code=''}finally{busy=false;render()}}

let enrolmentData=null,enrolmentError='',enrolmentBusy=false,enrolmentFetched=0,enrolmentCode='';

function startPoll(){clearInterval(poll);poll=setInterval(refresh,3000);refresh()}
async function refresh(){
  if(!code)return;
  const requestedCode=code,seq=++stateRequest;
  try{
    const next=await api({action:'faculty_state',code:requestedCode});
    if(code!==requestedCode||seq!==stateRequest)return;
    state=next;error='';const errorBox=document.getElementById('faculty-error');if(errorBox)errorBox.innerHTML='';
    if(!document.body.classList.contains('present'))render();
    if(Date.now()-enrolmentFetched>6000)refreshEnrolments();
  }catch(e){error=e.message;const box=document.getElementById('faculty-error');if(box)box.innerHTML=notice(error,true)}
}
let enrolmentTask=null;
async function refreshEnrolments(force=false){
  if(enrolmentTask){await enrolmentTask;if(!force)return;}
  if(!code||!state?.session.platformAuth||!state.session.courseId)return;
  const requestedCode=code;enrolmentBusy=true;
  enrolmentTask=(async()=>{
    try{
      const data=await api({action:'faculty_enrolments',code:requestedCode});
      if(code!==requestedCode)return;
      enrolmentData=data;enrolmentCode=code;enrolmentError='';enrolmentFetched=Date.now();
      // Re-read state AFTER the approved roster import. Do not overwrite an
      // assignment with a participants snapshot captured before another write.
      await refresh();
    }catch(e){if(code===requestedCode)enrolmentError=e.message;}
    finally{enrolmentBusy=false;enrolmentFetched=Date.now();if(code===requestedCode&&!document.body.classList.contains('present'))render();}
  })();
  try{await enrolmentTask;}finally{enrolmentTask=null;}
}
window.addEventListener('focus',()=>{enrolmentFetched=0;refresh()});

function consoleView(){
  if(!state)return;
  const asked=new URLSearchParams(location.search).get('tab');
  window.FacultyWorkspace.render({root:app,sim:SIM,state,roster:enrolmentCode===code?enrolmentData:null,rosterError:enrolmentError,
    initialPage:asked==='teams'?'manage':asked,onPage:p=>{const u=new URL(location.href);u.searchParams.set('tab',p==='manage'?'teams':p);history.replaceState(null,'',u.pathname+u.search+u.hash);renderNav()},
    courseUrl:state.session.courseId?(enrolmentData?.manageUrl||(facultyDashboard?facultyDashboard+'?course='+encodeURIComponent(state.session.courseId):'')):'',
    joinUrl:state.session.joinUrl||location.origin+BASE+'/api/join?session='+encodeURIComponent(code),
    api,refresh,refreshRoster:async()=>{await refreshEnrolments(true);if(enrolmentError)throw new Error(enrolmentError);await refresh()},
    advanced:()=>SIM.advanced?SIM.advanced(state.session,state,{esc,notice}):'',
    selectDebrief:(side,value)=>{if(side==='left')aSel=value;else bSel=value;}
  });
}
render();
// The course page opens one session directly: ?session=CODE with a signed faculty launch.
{const fromHash=(location.hash||'').replace('#','');const asked=((new URLSearchParams(location.search).get('session')||'')||(/^[A-Za-z2-9]{5}$/.test(fromHash)?fromHash:'')).toUpperCase();if(/^[A-Z2-9]{5}$/.test(asked)&&LT){draftResume=asked;const box=document.getElementById('resumeCode');if(box)box.value=asked;resumeSession()}}
if(!BASE)fetch(BASE+'/api/platform').then(r=>r.ok?r.json():null).then(d=>{
  if(d&&/^https?:\/\//.test(d.platformUrl||'')){
    facultyDashboard=d.platformUrl.replace(/\/$/,'')+'/faculty.html';
    if(authProblem)render();
  }
}).catch(()=>{});

// One handle on the live page, for checks and support: FacultySession.page.state and the like.
// Ask about this sim: the faculty helper, answered by the platform (/api/faculty, action assist). Shown only where the
// platform has it switched on for this sim. Students appear to the helper as "Student 1, 2, 3"; names are put back here.
const PLATFORM_FACULTY_API='/api/faculty';
const helper={open:false,turns:[],busy:false,allowance:null,error:'',qHeight:0};
async function helperCall(x){const r=await fetch(PLATFORM_FACULTY_API,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({simId:SIM.id,courseId:facultyCourse||undefined,...x})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.message||'The helper could not answer just now.'),{data:d});return d}
const restoreNames=(text,names)=>Object.entries(names||{}).sort((a,b)=>b[0].length-a[0].length).reduce((t,[label,name])=>t.split(label).join(name),String(text||''));
// The helper's answer, escaped first, then its light formatting shown: bold, short lists and paragraphs.
function helperText(text){
 const inline=x=>esc(x).replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
 return String(text||'').trim().split(/\n\s*\n/).map(block=>{
  const lines=block.split('\n').filter(l=>l.trim());
  if(lines.length&&lines.every(l=>/^\s*[-*•]\s+/.test(l)))return `<ul>${lines.map(l=>`<li>${inline(l.replace(/^\s*[-*•]\s+/,''))}</li>`).join('')}</ul>`;
  if(lines.length&&lines.every(l=>/^\s*\d+[.)]\s+/.test(l)))return `<ol>${lines.map(l=>`<li>${inline(l.replace(/^\s*\d+[.)]\s+/,''))}</li>`).join('')}</ol>`;
  return `<p>${lines.map(inline).join('<br>')}</p>`;
 }).join('');
}
function helperPaint(){let box=document.getElementById('fs-helper');if(!box){box=document.createElement('div');box.id='fs-helper';document.body.appendChild(box)}
 const a=helper.allowance;box.innerHTML=helper.open?`<section class="fs-helper-panel" aria-label="Ask about this sim"><div class="fs-helper-head"><b>Ask about this sim</b><button type="button" class="btn" data-helper="close">Close</button></div>
  <div class="fs-helper-log">${helper.turns.length?helper.turns.map(t=>`<p class="fs-helper-q">${esc(t.q)}</p><div class="fs-helper-a">${helperText(t.shown)||'<p>No answer came back. Please ask again.</p>'}</div>`).join(''):'<p class="help">Ask how to run it, what a screen means, why a student got a result, or what to ask in the debrief. With a session open, the helper reads it with students shown as numbers; you see their names here.</p>'}</div>
  ${helper.error?`<p class="fs-helper-err">${esc(helper.error)}</p>`:''}<form class="fs-helper-form"><textarea id="fsHelperQ" rows="6"${helper.qHeight?` style="height:${helper.qHeight}px"`:''} maxlength="1500" placeholder="Ask a question about this sim…" ${helper.busy?'disabled':''}></textarea><button class="btn btn-primary" type="submit" ${helper.busy?'disabled':''}>${helper.busy?'Thinking…':'Ask'}</button></form>
  ${a?`<p class="help">${a.left} of ${a.limit} questions left this month for this sim.</p>`:''}</section>`:`<button type="button" class="fs-helper-open" data-helper="open">Ask about this sim</button>`;
 box.querySelectorAll('[data-helper]').forEach(x=>x.onclick=()=>{helper.open=x.dataset.helper==='open';helperPaint()});
 const f=box.querySelector('form');if(f)f.onsubmit=async e=>{e.preventDefault();const ta=document.getElementById('fsHelperQ');if(ta)helper.qHeight=Math.round(ta.getBoundingClientRect().height);const q=document.getElementById('fsHelperQ').value.trim();if(!q||helper.busy)return;helper.busy=true;helper.error='';helperPaint();
  try{const d=await helperCall({action:'assist',question:q,sessionCode:code||undefined,history:helper.turns.slice(-4).map(t=>({q:t.q,a:t.a}))});helper.turns.push({q,a:d.answer,shown:restoreNames(d.answer,d.names)});helper.allowance=d.allowance||helper.allowance}
  catch(err){helper.error=err.message;if(err.data&&err.data.allowance)helper.allowance=err.data.allowance}finally{helper.busy=false;helperPaint();const log=document.querySelector('.fs-helper-log');if(log)log.scrollTop=log.scrollHeight}}}
helperCall({action:'assist_status'}).then(d=>{if(d&&d.available){helper.allowance=d.allowance;helperPaint()}}).catch(()=>{});
global.FacultySession.page={get state(){return state},get code(){return code},get LT(){return LT},set LT(v){LT=v},get enrolmentData(){return enrolmentData},api,refresh,refreshEnrolments};
}
global.FacultySession={start,launchToken};
if(typeof module!=='undefined'&&module.exports)module.exports=global.FacultySession;
})(typeof window!=='undefined'?window:globalThis);
