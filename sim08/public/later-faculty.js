/* Eighteen Months Later's settings for the shared faculty pages (kit/). Everything sim-specific lives here.
   The vendors, questions, plans, outcomes and lessons arrive from the server with the faculty session
   (state.kit), so this file names none of them. The class view for the projector is the Live screen (live.html). */
(function(global){
'use strict';
let K={bands:{},vendors:[],questions:[],plans:[],reviewQuestions:[],ended:false};
const NEXT={briefing:'Open the demonstrations now',demos:'Open the questions now',questions:'Close the questions now',commit:'Open the go-live plan now',plan:'Open the report now'};

function renderOutcome(t,{esc,emptyPanel}){
 if(!t.joined)return emptyPanel('Not started','Nobody in this '+(t.individual?'run':'team')+' has opened the simulation yet.');
 const b=K.bands[t.band];
 const asked=(t.questionIds||[]).map(id=>(K.questions.find(q=>q.id===id)||{}));
 const route=q=>q.routes&&t.vendor?q.routes[t.vendor]:null;
 const plan=(K.plans.find(p=>p.key===t.plan)||{}).text;
 const qs=asked.length?`<ol>${asked.map(q=>`<li>${esc(q.text||'')}${route(q)?` <strong>· ${route(q)==='direct'?'warning':'partial warning'}</strong>`:''}</li>`).join('')}</ol>`:'<p>No questions spent.</p>';
 if(!b)return `<div class="section-heading"><h3>${esc(t.vendorName?'Bought '+t.vendorName:'Still deciding')}</h3></div><div class="event-list"><div class="event-row"><div><strong>Questions so far</strong>${qs}</div></div></div>`;
 return `<div class="result-banner"><span class="result-icon"></span><div><div class="eyebrow">Eighteen months on · ${esc(b.label)}</div><h3>${esc(t.headline||b.phrase)}</h3></div></div>
  <div class="event-list">
   <div class="event-row"><div><strong>Vendor</strong><p>${esc(t.vendorName)}${t.boardChose?' (the board chose on price)':''}</p></div></div>
   <div class="event-row"><div><strong>Found the risk</strong><p>${t.found?'Yes':'No'}</p></div></div>
   <div class="event-row"><div><strong>Questions spent</strong>${qs}</div></div>
   <div class="event-row"><div><strong>Go-live plan</strong><p>${esc(plan||'None funded')}</p></div></div>
   ${t.reportText?`<div class="event-row"><div><strong>The report they read</strong><p>${esc(t.reportText)}</p></div></div>`:''}</div>
  <p class="table-note">This is where the choices led, not a score or a ranking.</p>`;
}
const liveLink=s=>{const lt=global.FacultySession&&FacultySession.page?FacultySession.page.LT:'';return `live.html?session=${encodeURIComponent(s.code)}${lt?'#lt='+encodeURIComponent(lt):''}`;};

const LaterSettings={
 id:'rapid-08-later', title:'Eighteen Months Later', code:'SIM08', modes:['individual','team'], defaultMode:null,
 storage:{token:'m08-faculty-lt',session:'m08-kit-session',course:'m08-faculty-course'},
 // A practice run, or a session at the report, has nothing left to pause.
 noPause:s=>(s.clock||{}).phase==='report',
 noLead:true, teamRule:'The team shares six questions. The vendor and the go-live plan are private votes; the majority decides.',
 questions:[
  // The prompts arrive with the faculty session (state.kit.reviewQuestions).
  {label:'Review question 1',key:'reflection1',prompt:'',followup:''},
  {label:'Review question 2',key:'reflection2',prompt:'',followup:''}
 ],
 progressNote:'Questions, the vendor and the plan appear as each part closes. The review follows the report.',
 overviewLabel:'Outcome',
 bandLabel:value=>(K.bands[value]||{}).label||'Not yet',
 done:r=>!!r.done,
 started:r=>Number(r.phase||0)>0,
 record:r=>({band:r.band||null,vendor:r.vendor||null,vendorName:r.vendorName||'',boardChose:!!r.boardChose,questionIds:r.questionIds||[],plan:r.plan||null,
  found:!!r.found,headline:r.headline||'',reportText:r.reportText||'',votes:r.votes||null,joined:!!r.joined,late:!!r.late,reflection1:r.reflection1||'',reflection2:r.reflection2||''}),
 tabs:[{id:'outcome',label:'Outcome',icon:'flag',render:renderOutcome}],
 csv:{columns:['Vendor','Questions spent','Found the risk','Go-live plan','Outcome'],
  row:t=>[t.vendorName||'',(t.questionIds||[]).length,t.found?'Yes':'No',t.plan||'',(K.bands[t.band]||{}).label||'']},
 prompts:(state,questions)=>{if(!state.kit)return;K=state.kit;(K.reviewQuestions||[]).forEach((q,i)=>{if(questions[i])questions[i].prompt=q;});},
 // The Live screen for the projector, and the shared clock's next part.
 controls:(s,busy)=>{const ph=(s.clock||{}).phase,step=s.paused?'':NEXT[ph]||'';
  return `<a class="btn" href="${liveLink(s)}" target="_blank" rel="noopener">Live screen</a>${step?`<button class="btn" data-session-control="advance" ${busy?'disabled':''}>${step}</button>`:''}`;},
 controlDone:{advance:'The clock moved on.'},
 debrief:{
  mount:(root,getInput,opts)=>global.LaterDebrief.mount(root,getInput,opts),
  input:(teams,cfg)=>({kit:cfg.state.kit||K,team:cfg.state.session.mode==='team',
   teams:teams.filter(t=>t.joined).map(t=>({id:t.id,name:t.name,band:t.band,late:t.late,vendor:t.vendor,vendorName:t.vendorName,boardChose:t.boardChose,
    questionIds:t.questionIds,plan:t.plan,found:t.found,headline:t.headline,
    reviews:(t.people||[]).map(p=>{const r=(cfg.state.runs[t.id]||{}).reflections||{};const x=r[p.id];return x?{name:p.name,a1:x.reflection1,a2:x.reflection2}:null}).filter(Boolean)}))})
 }
};
global.LaterSettings=LaterSettings;
if(typeof module!=='undefined'&&module.exports)module.exports=LaterSettings;
})(typeof window!=='undefined'?window:globalThis);
