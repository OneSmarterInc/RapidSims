/* Where Does the Money Land?'s settings for the shared faculty pages (kit/). Everything sim-specific lives here.
   The companies, picks, stages, values, names and lessons arrive from the server with the faculty session
   (state.kit), so this file names none of them. The class view for the projector is the Live screen (live.html). */
(function(global){
'use strict';
let K={bands:{},companies:[],picks:[],stages:[],reviewQuestions:[],ended:false,released:0,stagesTotal:3};
const usd=n=>'$'+Math.round(Number(n)||0).toLocaleString('en-US');
const pickText=k=>(K.picks.find(p=>p.key===k)||{}).text||'';

function renderFund(t,{esc,emptyPanel}){
 if(!t.joined)return emptyPanel('Not started','Nobody in this '+(t.individual?'run':'team')+' has opened the simulation yet.');
 const s=t.statements,a=t.allocation,b=K.bands[t.band];
 const st=s?`<div class="event-row"><div><strong>Direction</strong><p>${esc(s.direction)}</p></div></div>
  <div class="event-row"><div><strong>Destination · ${esc(pickText(s.pick))}</strong><p>${esc(s.reason)}</p>${t.statementsBy&&!t.individual?`<p class="table-note">Written for the team by ${esc(t.statementsBy)}</p>`:''}</div></div>`
  :'<div class="event-row"><div><strong>Statements</strong><p>None written yet.</p></div></div>';
 const fund=a?`<div class="event-row"><div><strong>The fund</strong><p>${K.companies.filter(c=>a[c.key]>0).map(c=>`${esc(c.descriptor)}: ${usd(a[c.key])}`).join(' · ')}${a.cash>0?` · ${esc(K.cashLabel||'Cash')}: ${usd(a.cash)}`:''}</p>${t.finalValue&&K.released>=K.stagesTotal?`<p class="table-note">Worth ${esc(t.finalValue)} by the last stage.</p>`:''}</div></div>`:'';
 return `${b?`<div class="result-banner"><span class="result-icon"></span><div><div class="eyebrow">The fund · ${esc(b.label)}</div><h3>${esc(b.phrase)}</h3></div></div>`:''}
  <div class="event-list">${st}${fund}</div><p class="table-note">This shows the statements and the fund, not a score or a ranking.</p>`;
}
const liveLink=s=>{const lt=global.FacultySession&&FacultySession.page?FacultySession.page.LT:'';return `live.html?session=${encodeURIComponent(s.code)}${lt?'#lt='+encodeURIComponent(lt):''}`;};
// The shared clock's next step, from the session bar.
function nextStep(s){
 const ph=(s.clock||{}).phase;
 if(s.paused)return null;
 if(ph==='briefing')return {set:'advance',label:'Open the statements now'};
 if(ph==='wall')return {set:'advance',label:'Open the fund now'};
 if(ph==='allocate')return {set:'close_fund',label:'Close the fund now'};
 if((ph==='held'||ph==='reveal')&&K.nextYear)return {set:'release',label:'Release '+K.nextYear};
 return null;
}

const MoneySettings={
 id:'rapid-09-money-land', title:'Where Does the Money Land?', code:'SIM09', modes:['team','individual'], defaultMode:null,
 storage:{token:'m09-faculty-lt',session:'m09-kit-session',course:'m09-faculty-course'},
 // History waits for you, so there is nothing to pause once the fund has closed.
 noPause:s=>['held','reveal'].includes((s.clock||{}).phase),
 noLead:true, teamRule:'The team shares one screen. The first member to press writes the statements or places the fund for everyone.',
 questions:[
  // The prompts arrive with the faculty session (state.kit.reviewQuestions).
  {label:'Review question 1',key:'reflection1',prompt:'',followup:''},
  {label:'Review question 2',key:'reflection2',prompt:'',followup:''}
 ],
 progressNote:'The statements and the fund appear as each is locked. The review follows the 2010 stage.',
 overviewLabel:'Fund',
 bandLabel:value=>(K.bands[value]||{}).label||'Not yet',
 done:r=>!!r.done,
 started:r=>Number(r.phase||0)>0,
 record:r=>({band:r.band||null,statements:r.statements||null,statementsBy:r.statementsBy||null,allocation:r.allocation||null,finalValue:r.finalValue||null,
  joined:!!r.joined,reflection1:r.reflection1||'',reflection2:r.reflection2||''}),
 tabs:[{id:'fund',label:'Statements and fund',icon:'flag',render:renderFund}],
 csv:{columns:['Destination pick','Direction','Destination reason','Fund','Band'],
  row:t=>[pickText(t.statements?.pick),t.statements?.direction||'',t.statements?.reason||'',
   t.allocation?K.companies.filter(c=>t.allocation[c.key]>0).map(c=>`${c.descriptor} ${t.allocation[c.key]}`).concat(t.allocation.cash>0?['cash '+t.allocation.cash]:[]).join('; '):'',(K.bands[t.band]||{}).label||'']},
 prompts:(state,questions)=>{if(!state.kit)return;K=state.kit;(K.reviewQuestions||[]).forEach((q,i)=>{if(questions[i])questions[i].prompt=q;});},
 controls:(s,busy)=>{const n=nextStep(s);
  return `<a class="btn" href="${liveLink(s)}" target="_blank" rel="noopener">Live screen</a>${n?`<button class="btn" data-session-control="${n.set}" ${busy?'disabled':''}>${n.label}</button>`:''}`;},
 controlDone:{advance:'The clock moved on.',close_fund:'The fund is closed. History waits for you.',release:'Stage released to every student.'},
 debrief:{
  mount:(root,getInput,opts)=>global.MoneyDebrief.mount(root,getInput,opts),
  input:(teams,cfg)=>({kit:cfg.state.kit||K,team:cfg.state.session.mode==='team',
   teams:teams.filter(t=>t.joined).map(t=>({id:t.id,name:t.name,band:t.band,statements:t.statements,allocation:t.allocation,finalValue:t.finalValue,
    reviews:(t.people||[]).map(p=>{const r=(cfg.state.runs[t.id]||{}).reflections||{};const x=r[p.id];return x?{name:p.name,a1:x.reflection1,a2:x.reflection2}:null}).filter(Boolean)}))})
 }
};
global.MoneySettings=MoneySettings;
if(typeof module!=='undefined'&&module.exports)module.exports=MoneySettings;
})(typeof window!=='undefined'?window:globalThis);
