/* Do We Switch?'s settings for the shared faculty pages (kit/). Everything sim-specific lives here.
   The bands, reports, map, lessons and questions arrive from the server with the faculty session (state.kit),
   so this file names none of them. The clock and the decisions by report run on the Live screen (live.html). */
(function(global){
'use strict';
let K={bands:{},reports:[],documents:[],reviewQuestions:[],ended:false};
const money=n=>'$'+Math.round(Number(n)||0).toLocaleString('en-US');

function renderDecision(t,{esc,emptyPanel}){
 if(!t.joined)return emptyPanel('Not started','Nobody in this '+(t.individual?'run':'team')+' has opened the simulation yet.');
 const b=K.bands[t.band];
 if(!b)return emptyPanel('No decision yet','The decision appears here when it is made, or when the clock runs out.');
 const rep=(K.reports||[]).find(r=>r.n===t.atReport);
 return `<div class="result-banner"><span class="result-icon"></span><div><div class="eyebrow">Decision · ${esc(b.label)}</div><h3>${esc(b.phrase)}</h3></div></div>
  <div class="event-list">${t.atReport?`<div class="event-row"><div><strong>When</strong><p>${esc(`Report ${t.atReport} of ${(K.reports||[]).length} · ${t.storyTime||''}`)}</p></div></div>
  ${rep?`<div class="event-row"><div><strong>The report on screen</strong><p>${esc(rep.source+': '+rep.text)}</p></div></div>`:''}
  <div class="event-row"><div><strong>Reason given</strong><p>${esc(t.reason||'None')}${t.by&&!t.individual?esc(` (${t.by} pressed for the team)`):''}</p></div></div>`:''}
  <div class="event-row"><div><strong>Opened both documents first</strong><p>${t.openedBoth?'Yes':'No'}</p></div></div>
  <div class="event-row"><div><strong>Card sales lost by the end</strong><p>${esc(money(t.lost))}</p></div></div></div>
  <p class="table-note">This is what the run decided, not a score or a ranking.</p>`;
}
const liveLink=s=>{const lt=global.FacultySession&&FacultySession.page?FacultySession.page.LT:'';return `live.html?session=${encodeURIComponent(s.code)}${lt?'#lt='+encodeURIComponent(lt):''}`;};

const SwitchSettings={
 id:'rapid-06-switch', title:'Do We Switch?', code:'SIM06', modes:['individual','team'], defaultMode:null,
 storage:{token:'m06-faculty-lt',session:'m06-kit-session',course:'m06-faculty-course'},
 // One shared clock with no pause: every report reaches every student at the same moment.
 noPause:true,
 noLead:true, teamRule:'The first member to press Switch or Stay decides for the team.',
 questions:[
  // The prompts arrive with the faculty session (state.kit.reviewQuestions).
  {label:'Review question 1',key:'reflection1',prompt:'',followup:''},
  {label:'Review question 2',key:'reflection2',prompt:'',followup:''}
 ],
 progressNote:'Each decision appears when it is made. The review follows the reveal at the end of the clock.',
 overviewLabel:'Decision',
 bandLabel:value=>(K.bands[value]||{}).label||'Not yet',
 done:r=>!!r.done,
 started:r=>Number(r.phase||0)>0,
 record:r=>({band:r.band||null,atReport:r.atReport||null,storyTime:r.storyTime||'',reason:r.reason||'',by:r.by||null,
  openedBoth:!!r.openedBoth,lost:r.lost||0,joined:!!r.joined,reflection1:r.reflection1||'',reflection2:r.reflection2||''}),
 tabs:[{id:'decision',label:'Decision',icon:'flag',render:renderDecision}],
 csv:{columns:['Decision','At report','Store time','Reason','Opened both documents','Card sales lost'],
  row:t=>[(K.bands[t.band]||{}).label||'',t.atReport||'',t.storyTime||'',t.reason||'',t.openedBoth?'Yes':'No',Math.round(t.lost||0)]},
 prompts:(state,questions)=>{if(!state.kit)return;K=state.kit;(K.reviewQuestions||[]).forEach((q,i)=>{if(questions[i])questions[i].prompt=q;});},
 // The Live screen shows the clock and the decisions by report for the projector.
 controls:s=>`<a class="btn" href="${liveLink(s)}" target="_blank" rel="noopener">Live screen</a>`,
 debrief:{
  mount:(root,getInput,opts)=>global.SwitchDebrief.mount(root,getInput,opts),
  input:(teams,cfg)=>({kit:cfg.state.kit||K,team:cfg.state.session.mode==='team',
   teams:teams.filter(t=>t.joined).map(t=>({id:t.id,name:t.name,band:t.band,atReport:t.atReport,reason:t.reason,openedBoth:t.openedBoth,lost:t.lost,
    reviews:(t.people||[]).map(p=>{const r=(cfg.state.runs[t.id]||{}).reflections||{};const x=r[p.id];return x?{name:p.name,a1:x.reflection1,a2:x.reflection2}:null}).filter(Boolean)}))})
 }
};
global.SwitchSettings=SwitchSettings;
if(typeof module!=='undefined'&&module.exports)module.exports=SwitchSettings;
})(typeof window!=='undefined'?window:globalThis);
