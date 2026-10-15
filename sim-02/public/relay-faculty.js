/* What Did It Tell Them?'s settings for the shared faculty pages (kit/). Everything sim-specific lives here.
   Band names, the resolution and the fork outcomes come from the server with the faculty session (state.kit),
   so nothing in this file tells a curious student how the incident ends. */
(function(global){
'use strict';
let K={bands:{},readingLabels:{},actionLabels:{},irreversible:{},phases:['Hour 1','Hour 7','Day 2'],reviewQuestions:[]};
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
 if(!b)return emptyPanel('No result yet','The result appears when the student locks the Day 2 position.');
 const when=v=>v===null||v===undefined?'Never':K.phases[v]||'';
 const lad=when(t.ladderEarnedAt),kept=t.band==='ready_both'||t.band==='held';
 return `<div class="result-banner"><span class="result-icon"></span><div><div class="eyebrow">Result · ${esc(b.label)}</div><h3>${esc(b.phrase)}</h3></div></div>
  <div class="event-list"><div class="event-row"><div><strong>The search index</strong><p>${esc(kept?`Preserved at ${when(t.preservedAt)}${t.preservedByTalk?', in conversation':''}.`:`Lost to ${K.rebuild||'the rebuild'}.`)}</p></div></div>
  <div class="event-row"><div><strong>What Devin's change was for</strong><p>${esc(lad==='Never'?'Never obtained.':`Obtained at ${lad}${t.ladderPrivate?', in private':''}.`)}</p></div></div>
  <div class="event-row"><div><strong>Private conversations</strong><p>${esc(String(t.privateCount||0))}</p></div></div></div>
  <p class="table-note">This is the saved result, not a score or a ranking.</p>`;
}

const RelaySettings={
 id:'rapid-02-relay', title:'What Did It Tell Them?', code:'SIM02', modes:['individual'], defaultMode:'individual',
 storage:{token:'m02-faculty-lt',session:'m02-faculty-session',course:'m02-faculty-course'},
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
 record:r=>({positions:pos(r),band:r.band||null,ladderEarnedAt:r.ladderEarnedAt??null,ladderPrivate:!!r.ladderPrivate,preservedAt:r.preservedAt??null,preservedByTalk:!!r.preservedByTalk,privateCount:r.privateCount||0}),
 tabs:[{id:'positions',label:'Positions',icon:'sliders',render:renderPositions},{id:'outcome',label:'Result',icon:'flag',render:renderOutcome}],
 csv:{columns:['Hour 1 reading','Hour 1 action','Hour 7 reading','Hour 7 action','Day 2 reading','Day 2 action','Result','Index preserved','Change reason obtained'],
  row:t=>{const p=pos(t),w=v=>v===null||v===undefined?'Never':K.phases[v]||'';return [...[0,1,2].flatMap(i=>[p[i]?.reading||'',p[i]?.action||'']),(K.bands[t.band]||{}).label||'',w(t.preservedAt),w(t.ladderEarnedAt)];}},
 // The faculty session carries the band names, review questions and debrief content.
 prompts:(state,questions)=>{if(!state.kit)return;K=state.kit;(K.reviewQuestions||[]).forEach((q,i)=>{if(questions[i])questions[i].prompt=q;});},
 // Release the debrief yourself, or let each student see it as they finish.
 createFields:()=>`<div class="field"><label style="display:flex;gap:10px;align-items:center;text-transform:none;letter-spacing:0;font:15px var(--s);color:var(--b)"><input type="checkbox" id="holdReveal" ${RelaySettings._hold?'checked':''} onchange="RelaySettings._hold=this.checked" style="width:auto"> Hold each student's debrief until I release it</label></div>`,
 createPayload:()=>({holdReveal:!!RelaySettings._hold}),
 controls:(s,busy)=>s.holdReveal&&!s.revealed?`<button class="btn" data-session-control="reveal" ${busy?'disabled':''}>Release debrief to students</button>`:'',
 controlDone:{reveal:'Debrief released. Students who finished see it now.'},
 debrief:{
  mount:(root,getInput,opts)=>global.RelayDebrief.mount(root,getInput,opts),
  input:(teams,cfg)=>({kit:cfg.state.kit||K,students:teams.map(t=>({id:t.id,name:t.name,done:t.status==='submitted',positions:t.positions,band:t.band,
   ladderEarnedAt:t.ladderEarnedAt,ladderPrivate:t.ladderPrivate,preservedAt:t.preservedAt,privateCount:t.privateCount,reflection1:t.reflection1,reflection2:t.reflection2}))})
 }
};
global.RelaySettings=RelaySettings;
if(typeof module!=='undefined'&&module.exports)module.exports=RelaySettings;
})(typeof window!=='undefined'?window:globalThis);
