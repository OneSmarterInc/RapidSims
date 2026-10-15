/* Whose Number Is Right?'s settings for the shared faculty pages (kit/). Everything sim-specific lives here.
   The definitions, departments, bands and lessons arrive from the server with the faculty session (state.kit),
   so this file carries none of them. */
(function(global){
'use strict';
let K={bands:{},sheets:{},assignmentOrder:[],reviewQuestions:[],locked:false};

function renderNumber(t,{esc,emptyPanel}){
 if(!t.joined)return emptyPanel('Not started','Nobody in this '+(t.individual?'run':'team')+' has opened the simulation yet.');
 const b=K.bands[t.band];
 if(!b)return emptyPanel('No number yet','The number appears here when it is locked, or when the clock runs out.');
 const sh=K.sheets[t.sheetId]||{};
 return `<div class="result-banner"><span class="result-icon"></span><div><div class="eyebrow">Result · ${esc(b.label)}</div><h3>${esc(b.phrase)}</h3></div></div>
  <div class="event-list"><div class="event-row"><div><strong>Number reported</strong><p>${esc(t.number?t.number+'% · confidence '+t.confidence+'/5':'None')}</p></div></div>
  <div class="event-row"><div><strong>Definition sheet</strong><p>${esc((t.sheetId||'')+(sh.department?' · '+sh.department:''))}</p></div></div>
  <div class="event-row"><div><strong>Number its definition gives</strong><p>${esc(sh.value?sh.value+'%':'')}</p></div></div></div>
  <p class="table-note">Only you see this tab. The debrief shows every number, and never says which ones are off.</p>`;
}
function renderSheet(t,{esc,emptyPanel}){
 const sh=K.sheets[t.sheetId];
 if(!sh)return emptyPanel('No sheet yet','Each '+(t.individual?'student':'team')+' gets a definition sheet when the session starts.');
 return `<div class="section-heading"><h3>Definition sheet ${esc(t.sheetId)} · ${esc(sh.department)}</h3></div><p class="section-description">${esc(sh.purpose)}</p>
  <ol>${sh.lines.map((l,i)=>`<li${i===sh.contestedIndex?' style="font-weight:600"':''}>${esc(l)}</li>`).join('')}</ol>
  <h4>Worked calculation</h4><ol>${(sh.derivation||[]).map(l=>`<li>${esc(l)}</li>`).join('')}</ol>`;
}

const WhoseSettings={
 id:'rapid-04-whose-number', title:'Whose Number Is Right?', code:'SIM04', modes:['team','individual'], defaultMode:null,
 storage:{token:'m04-faculty-lt',session:'m04-faculty-session',course:'m04-faculty-course'},
 questions:[
  // The prompts arrive with the faculty session (state.kit.reviewQuestions).
  {label:'Review question 1',key:'reflection1',prompt:'',followup:''},
  {label:'Review question 2',key:'reflection2',prompt:'',followup:''}
 ],
 progressNote:'The number is locked once, by any member. The review questions open when you release them.',
 overviewLabel:'Result',
 bandLabel:value=>(K.bands[value]||{}).label||'Not reached',
 done:r=>!!r.done,
 started:r=>Number(r.phase||0)>0,
 record:r=>({band:r.band||null,number:r.number||null,confidence:r.confidence||null,sheetId:r.sheetId||null,joined:!!r.joined,
  reflection1:r.reflection1||'',reflection2:r.reflection2||''}),
 tabs:[{id:'number',label:'Number',icon:'flag',render:renderNumber},{id:'sheet',label:'Definition',icon:'file',render:renderSheet}],
 csv:{columns:['Sheet','Number','Confidence','Result'],row:t=>[t.sheetId||'',t.number||'',t.confidence||'',(K.bands[t.band]||{}).label||'']},
 prompts:(state,questions)=>{if(!state.kit)return;K=state.kit;(K.reviewQuestions||[]).forEach((q,i)=>{if(questions[i])questions[i].prompt=q;});},
 // Students see the review questions when you release them, after every number is locked.
 controls:(s,busy)=>s.locked&&!s.reviewOpen?`<button class="btn" data-session-control="review" ${busy?'disabled':''}>Release review questions</button>`:'',
 controlDone:{review:'Review questions released. Students see them now.'},
 debrief:{
  mount:(root,getInput,opts)=>global.WhoseDebrief.mount(root,getInput,opts),
  input:(teams,cfg)=>({kit:cfg.state.kit||K,team:cfg.state.session.mode==='team',
   teams:teams.filter(t=>t.joined).map(t=>({id:t.id,name:t.name,members:t.members,sheetId:t.sheetId,number:t.number,confidence:t.confidence,band:t.band,
    reviews:(t.people||[]).map(p=>{const r=(cfg.state.runs[t.id]||{}).reflections||{};const x=r[p.id];return x?{name:p.name,a1:x.reflection1,a2:x.reflection2}:null}).filter(Boolean)}))})
 }
};
global.WhoseSettings=WhoseSettings;
if(typeof module!=='undefined'&&module.exports)module.exports=WhoseSettings;
})(typeof window!=='undefined'?window:globalThis);
