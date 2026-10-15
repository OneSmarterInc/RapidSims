/* Disaster or Breach's settings for the shared faculty pages (kit/). Everything sim-specific lives here.
   Band names, the resolution and the fork outcomes come from the server with the faculty session (state.kit),
   so nothing in this file tells a curious student how the incident ends. */
(function(global){
'use strict';
let K={bands:{},readingLabels:{},actionLabels:{},irreversible:{},phases:['Hour 4','Hour 20','Day 3'],reviewQuestions:[]};
const pos=t=>Array.isArray(t.positions)?t.positions:[];

function renderPositions(t,{esc,emptyPanel}){
 const p=pos(t);
 if(!p.length)return emptyPanel('No positions locked yet','Each position appears here as the student locks it.');
 return `<div class="section-heading"><h3>Three locked positions</h3></div><p class="section-description">What the student read, what they did, and what would change their mind, at each point.</p>
  <div class="table-wrap"><table class="decision-table"><caption class="sr-only">${esc(t.name)} positions</caption><thead><tr><th scope="col">When</th><th scope="col">Reading</th><th scope="col">Action</th><th scope="col">Would change my mind</th></tr></thead><tbody>
  ${K.phases.map((ph,i)=>{const x=p[i];return `<tr><td><strong>${esc(ph)}</strong></td><td>${x?esc(K.readingLabels[x.reading]||x.reading):'—'}</td><td>${x?`${esc(K.actionLabels[x.action]||x.action)}${K.irreversible[x.action]?' <span class="outcome-chip">Cannot be undone</span>':''}`:'—'}</td><td>${x?esc(x.tripwire||''):'—'}</td></tr>`;}).join('')}
  </tbody></table></div><p class="table-note">A dash means the student has not reached that point yet.</p>`;
}
function renderOutcome(t,{esc,emptyPanel}){
 const b=K.bands[t.band];
 if(!b)return emptyPanel('No result yet','The result appears when the student locks the Day 3 position.');
 const cov=t.coverageEarnedAt===null||t.coverageEarnedAt===undefined?'Never':K.phases[t.coverageEarnedAt]||'';
 return `<div class="result-banner"><span class="result-icon"></span><div><div class="eyebrow">Result · ${esc(b.label)}</div><h3>${esc(b.phrase)}</h3></div></div>
  <div class="event-list"><div class="event-row"><div><strong>Sophia's coverage gap</strong><p>${esc(cov==='Never'?'Never obtained.':`Obtained at ${cov}${t.coveragePrivate?', in private':''}.`)}</p></div></div>
  <div class="event-row"><div><strong>Private conversations</strong><p>${esc(String(t.privateCount||0))}</p></div></div></div>
  <p class="table-note">This is the saved result, not a score or a ranking.</p>`;
}

const DisasterSettings={
 id:'rapid-01-disaster', title:'Disaster or Breach?', code:'SIM01', modes:['individual'], defaultMode:'individual',
 storage:{token:'m01-faculty-lt',session:'m01-faculty-session',course:'m01-faculty-course'},
 questions:[
  // The prompts arrive with the faculty session (state.kit.reviewQuestions).
  {label:'Review question 1',key:'reflection1',prompt:'',followup:''},
  {label:'Review question 2',key:'reflection2',prompt:'',followup:''}
 ],
 progressNote:'Positions lock one at a time. The review comes after the debrief.',
 overviewLabel:'Result',
 bandLabel:value=>(K.bands[value]||{}).label||'Not reached',
 done:r=>!!r.done,
 started:r=>Number(r.phase||0)>0||pos(r).length>0,
 record:r=>({positions:pos(r),band:r.band||null,coverageEarnedAt:r.coverageEarnedAt??null,coveragePrivate:!!r.coveragePrivate,privateCount:r.privateCount||0}),
 tabs:[{id:'positions',label:'Positions',icon:'sliders',render:renderPositions},{id:'outcome',label:'Result',icon:'flag',render:renderOutcome}],
 csv:{columns:['Hour 4 reading','Hour 4 action','Hour 20 reading','Hour 20 action','Day 3 reading','Day 3 action','Result','Coverage gap obtained'],
  row:t=>{const p=pos(t),c=t.coverageEarnedAt;return [...[0,1,2].flatMap(i=>[p[i]?.reading||'',p[i]?.action||'']),(K.bands[t.band]||{}).label||'',c===null||c===undefined?'Never':K.phases[c]||''];}},
 // The faculty session carries the band names, review questions and debrief content.
 prompts:(state,questions)=>{if(!state.kit)return;K=state.kit;(K.reviewQuestions||[]).forEach((q,i)=>{if(questions[i])questions[i].prompt=q;});},
 // Release the debrief yourself, or let each student see it as they finish.
 createFields:()=>`<div class="field"><label style="display:flex;gap:10px;align-items:center;text-transform:none;letter-spacing:0;font:15px var(--s);color:var(--b)"><input type="checkbox" id="holdReveal" ${DisasterSettings._hold?'checked':''} onchange="DisasterSettings._hold=this.checked" style="width:auto"> Hold each student's debrief until I release it</label></div>`,
 createPayload:()=>({holdReveal:!!DisasterSettings._hold}),
 controls:(s,busy)=>s.holdReveal&&!s.revealed?`<button class="btn" data-session-control="reveal" ${busy?'disabled':''}>Release debrief to students</button>`:'',
 controlDone:{reveal:'Debrief released. Students who finished see it now.'},
 debrief:{
  mount:(root,getInput,opts)=>global.DisasterDebrief.mount(root,getInput,opts),
  input:(teams,cfg)=>({kit:cfg.state.kit||K,students:teams.map(t=>({id:t.id,name:t.name,done:t.status==='submitted',positions:t.positions,band:t.band,
   coverageEarnedAt:t.coverageEarnedAt,coveragePrivate:t.coveragePrivate,privateCount:t.privateCount,reflection1:t.reflection1,reflection2:t.reflection2}))})
 }
};
global.DisasterSettings=DisasterSettings;
if(typeof module!=='undefined'&&module.exports)module.exports=DisasterSettings;
})(typeof window!=='undefined'?window:globalThis);
