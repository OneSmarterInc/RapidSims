/* Would You Have Bought It?'s settings for the shared faculty pages (kit/). Everything sim-specific lives here.
   The bands, stages, lessons and questions arrive from the server with the faculty session (state.kit),
   so this file names none of them. The class view for the projector is the Live screen (live.html). */
(function(global){
'use strict';
let K={bands:{},stages:[],recognitionOptions:[],reviewQuestions:[],ended:false,stage:0};
const CHOICE={buy:'Buy',decline:'Decline'};
const recLabel=v=>((K.recognitionOptions||[]).find(x=>x[0]===v)||[])[1]||'No answer';

function renderDecision(t,{esc,emptyPanel}){
 if(!t.joined)return emptyPanel('Not started','Nobody in this '+(t.individual?'run':'team')+' has opened the simulation yet.');
 const b=K.bands[t.band];
 const people=(t.reasons||[]);
 const rows=people.map(r=>`<div class="event-row"><div><strong>${esc(t.individual?'Reason':r.name)} · ${esc(r.choice?(r.lapsed?'Lapsed':CHOICE[r.choice]):'Still deciding')}</strong><p>${esc(r.text||'No reason yet.')}</p><p class="table-note">Recognised the companies: ${esc(recLabel(r.recognised))}</p></div></div>`).join('');
 if(!b)return `<div class="section-heading"><h3>${t.individual?'Not decided yet':'Votes so far'}</h3></div><div class="event-list">${rows}</div>`;
 return `<div class="result-banner"><span class="result-icon"></span><div><div class="eyebrow">Decision · ${esc(b.label)}</div><h3>${esc(b.phrase)}</h3></div></div>
  ${t.votes&&!t.individual?`<p class="section-description">${t.votes.buy} voted to buy and ${t.votes.decline} to decline. The majority decides; a tie declines.</p>`:''}
  <div class="event-list">${rows}</div>
  <p class="table-note">This is the choice and the reasoning, written before any of the stages.</p>`;
}
const liveLink=s=>{const lt=global.FacultySession&&FacultySession.page?FacultySession.page.LT:'';return `live.html?session=${encodeURIComponent(s.code)}${lt?'#lt='+encodeURIComponent(lt):''}`;};
const YEARS=['2002','2005','2010'];

const BoughtSettings={
 id:'rapid-07-bought', title:'Would You Have Bought It?', code:'SIM07', modes:['individual','team'], defaultMode:null,
 storage:{token:'w07-faculty-lt',session:'w07-kit-session',course:'w07-faculty-course'},
 // One decision clock for every student, then the stages you release.
 noPause:true,
 noLead:true, teamRule:'Every member votes privately and writes their own reason. The majority decides; a tie declines.',
 questions:[
  // The prompts arrive with the faculty session (state.kit.reviewQuestions).
  {label:'Review question 1',key:'reflection1',prompt:'',followup:''},
  {label:'Review question 2',key:'reflection2',prompt:'',followup:''}
 ],
 progressNote:'Each decision appears when it is made. The review follows the 2010 stage.',
 overviewLabel:'Decision',
 bandLabel:value=>(K.bands[value]||{}).label||'Not yet',
 done:r=>!!r.done,
 started:r=>Number(r.phase||0)>0,
 record:r=>({band:r.band||null,reasons:r.reasons||[],votes:r.votes||null,joined:!!r.joined,choice:r.choice||null,lapsed:!!r.lapsed,
  justification:r.justification||'',recognised:r.recognised||null,reflection1:r.reflection1||'',reflection2:r.reflection2||''}),
 tabs:[{id:'decision',label:'Decision',icon:'flag',render:renderDecision}],
 csv:{columns:['Decision','Reason','Recognised the companies'],
  row:t=>[(K.bands[t.band]||{}).label||'',(t.reasons||[]).map(r=>(t.individual?'':r.name+': ')+(r.text||'')).join(' | '),(t.reasons||[]).map(r=>recLabel(r.recognised)).join(' | ')]},
 prompts:(state,questions)=>{if(!state.kit)return;K=state.kit;(K.reviewQuestions||[]).forEach((q,i)=>{if(questions[i])questions[i].prompt=q;});},
 // The Live screen for the projector; close the decisions, then release each stage in order.
 controls:(s,busy)=>{
  const next=s.phase==='deciding'?`<button class="btn" data-session-control="end_decisions" ${busy?'disabled':''}>Close decisions now</button>`
   :s.phase==='decided'&&Number(s.stage||0)<3?`<button class="btn" data-session-control="next_stage" ${busy?'disabled':''}>Release ${YEARS[Number(s.stage||0)]}</button>`:'';
  return `<a class="btn" href="${liveLink(s)}" target="_blank" rel="noopener">Live screen</a>${next}`;},
 controlDone:{end_decisions:'Decisions closed. Students answer one question, then wait for the first stage.',next_stage:'Stage released to every student.'},
 debrief:{
  mount:(root,getInput,opts)=>global.BoughtDebrief.mount(root,getInput,opts),
  input:(teams,cfg)=>({kit:cfg.state.kit||K,team:cfg.state.session.mode==='team',
   teams:teams.filter(t=>t.joined).map(t=>({id:t.id,name:t.name,band:t.band,reasons:t.reasons||[],votes:t.votes,
    reviews:(t.people||[]).map(p=>{const r=(cfg.state.runs[t.id]||{}).reflections||{};const x=r[p.id];return x?{name:p.name,a1:x.reflection1,a2:x.reflection2}:null}).filter(Boolean)}))})
 }
};
global.BoughtSettings=BoughtSettings;
if(typeof module!=='undefined'&&module.exports)module.exports=BoughtSettings;
})(typeof window!=='undefined'?window:globalThis);
