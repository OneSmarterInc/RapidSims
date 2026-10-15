/* Would You Approve This?'s settings for the shared faculty pages (kit/). Everything sim-specific lives here.
   The endings, round titles, lessons and questions arrive from the server with the faculty session (state.kit).
   The live rounds run on the Round screen (rounds.html), opened from the session bar. */
(function(global){
'use strict';
let K={bands:{},rounds:[],reviewQuestions:[],ended:false};
const WORD={approve:'Approved',decline:'Declined',timeout:'Shipped when the clock ran out'};

function renderDecisions(t,{esc,emptyPanel}){
 const d=t.decisions||[];
 if(!d.some(Boolean))return emptyPanel('No decisions yet','Each decision appears here when its round closes.');
 return `<div class="section-heading"><h3>Five decisions</h3></div><p class="section-description">${t.individual?'What this student decided':'What the team decided by majority vote'} in each round.</p>
  <div class="table-wrap"><table class="decision-table"><thead><tr><th scope="col">Round</th><th scope="col">Request</th><th scope="col">Decision</th></tr></thead><tbody>
  ${(K.rounds||[]).map((r,i)=>`<tr><td><strong>${r.n}</strong></td><td>${esc(r.title)}</td><td>${d[i]?esc(WORD[d[i]]||d[i]):'—'}</td></tr>`).join('')}</tbody></table></div>
  <p class="table-note">A dash means the round has not closed yet.</p>`;
}
function renderEnding(t,{esc,emptyPanel}){
 const b=K.bands[t.band];
 if(!b)return emptyPanel('No ending yet','The ending appears when round five closes.');
 return `<div class="result-banner"><span class="result-icon"></span><div><div class="eyebrow">Ending · ${esc(b.label)}</div><h3>${esc(b.phrase)}</h3></div></div>
  <div class="event-list">${(t.knows||[]).length?(t.knows||[]).map(k=>`<div class="event-row"><div><strong>${esc(k.label)}</strong><p>${esc(k.level)}</p></div></div>`).join(''):'<div class="event-row"><div><p>Nothing beyond what Dana enters herself.</p></div></div>'}</div>
  <p class="table-note">This is where the decisions led, not a score or a ranking.</p>`;
}
const roundLink=s=>{const lt=global.FacultySession&&FacultySession.page?FacultySession.page.LT:'';return `rounds.html?session=${encodeURIComponent(s.code)}${lt?'#lt='+encodeURIComponent(lt):''}`;};

const ApproveSettings={
 id:'rapid-05-approve', title:'Would You Approve This?', code:'SIM05', modes:['individual','team'], defaultMode:null,
 storage:{token:'m05-faculty-lt',session:'m05-kit-session',course:'m05-faculty-course'},
 noLead:true, teamRule:'Every member votes. The majority decides, and a tie ships.',
 questions:[
  // The prompts arrive with the faculty session (state.kit.reviewQuestions).
  {label:'Review question 1',key:'reflection1',prompt:'',followup:''},
  {label:'Review question 2',key:'reflection2',prompt:'',followup:''}
 ],
 progressNote:'Decisions appear as each round closes. The review follows the ending.',
 overviewLabel:'Ending',
 bandLabel:value=>(K.bands[value]||{}).label||'Not reached',
 done:r=>!!r.done,
 started:r=>Number(r.phase||0)>0,
 record:r=>({band:r.band||null,decisions:r.decisions||[],knows:r.knows||[],joined:!!r.joined,late:!!r.late,reflection1:r.reflection1||'',reflection2:r.reflection2||''}),
 tabs:[{id:'decisions',label:'Decisions',icon:'sliders',render:renderDecisions},{id:'ending',label:'Ending',icon:'flag',render:renderEnding}],
 csv:{columns:['Round 1','Round 2','Round 3','Round 4','Round 5','Ending'],row:t=>[0,1,2,3,4].map(i=>(t.decisions||[])[i]||'').concat([(K.bands[t.band]||{}).label||''])},
 prompts:(state,questions)=>{if(!state.kit)return;K=state.kit;(K.reviewQuestions||[]).forEach((q,i)=>{if(questions[i])questions[i].prompt=q;});},
 // How far round five goes, chosen at creation.
 createFields:()=>`<div class="field"><label>How far round five goes</label><div class="modes">
   <div class="mode ${ApproveSettings._intensity!=='lighter'?'on':''}" data-intensity="standard" role="button" tabindex="0" onclick="ApproveSettings._pick('standard')"><b>Standard</b><span>The final reveal names the inference plainly.</span></div>
   <div class="mode ${ApproveSettings._intensity==='lighter'?'on':''}" data-intensity="lighter" role="button" tabindex="0" onclick="ApproveSettings._pick('lighter')"><b>Lighter</b><span>The final reveal describes a change in her health without naming it.</span></div></div></div>`,
 _intensity:'standard',
 _pick:v=>{ApproveSettings._intensity=v;document.querySelectorAll('[data-intensity]').forEach(x=>x.classList.toggle('on',x.dataset.intensity===v));},
 createPayload:()=>({intensity:ApproveSettings._intensity}),
 // The live rounds: the Round screen for the projector, and the shared clock's next step.
 controls:(s,busy)=>{const c=s.clock||{},ph=c.phase;
  const step=s.paused?'':ph==='decide'?`Close round ${c.round} now`:ph==='reveal'?(c.round===5?'Open the endings now':`Open round ${c.round+1} now`):ph==='briefing'?'Open round 1 now':'';
  return `<a class="btn" href="${roundLink(s)}" target="_blank" rel="noopener">Round screen</a>${step?`<button class="btn" data-session-control="advance" ${busy?'disabled':''}>${step}</button>`:''}`;},
 controlDone:{advance:'The clock moved on.'},
 debrief:{
  mount:(root,getInput,opts)=>global.ApproveDebrief.mount(root,getInput,opts),
  input:(teams,cfg)=>({kit:cfg.state.kit||K,team:cfg.state.session.mode==='team',
   teams:teams.filter(t=>t.joined).map(t=>({id:t.id,name:t.name,band:t.band,late:t.late,decisions:t.decisions,
    reviews:(t.people||[]).map(p=>{const r=(cfg.state.runs[t.id]||{}).reflections||{};const x=r[p.id];return x?{name:p.name,a1:x.reflection1,a2:x.reflection2}:null}).filter(Boolean)}))})
 }
};
global.ApproveSettings=ApproveSettings;
if(typeof module!=='undefined'&&module.exports)module.exports=ApproveSettings;
})(typeof window!=='undefined'?window:globalThis);
