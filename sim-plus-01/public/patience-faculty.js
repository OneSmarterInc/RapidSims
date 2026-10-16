/* Why Don't They Have Any Patience?'s settings for the shared faculty pages (kit/). Everything sim-specific lives here.
   The bands, the classifications, what was going on and the lessons arrive from the server with the faculty session
   (state.kit), so this file names none of them. */
(function(global){
'use strict';
let K={bands:{},rows:[],dispositions:{},severities:{},reveal:{},debriefNotes:[],reviewQuestions:[],observation:{}};
const RUTH={closed:'Stopped volunteering anything',opened:'Began describing what the work requires',guarded:'Stayed guarded',not_reached:'Not interviewed yet'};
const CHART={intake:['Claim intake',{longestWait:'Longest wait',faxRouting:'Fax routing',providerReceipt:'What the provider receives'}],
 log:['Receipt log',{purpose:'Purpose',receiver:'Who receives it'}],
 review:['First-pass review',{step:'What this step is',owner:'Owner',receiver:'Who receives it',catches:'What it catches',dependsOn:'What it depends on'}]};
const val=x=>x?.couldNotEstablish?'Could not establish':(x?.value||'—');

function renderInterviews(t,{esc,emptyPanel}){
 if(!t.order||!t.order.length)return emptyPanel('No interviews yet','The interviews appear here once the student chooses an order and starts.');
 const rows=(t.windows||[]).map(w=>`<tr><td><strong>${esc(w.label)}</strong></td><td>${esc(w.source)}</td><td>${w.questions}</td><td>${Math.round(w.seconds/60)} of 15 min</td></tr>`).join('');
 const turns=(t.transcript||[]).map(x=>`<div class="event-row${x.closed?' pc-closed':''}"><div><strong>${esc(x.source)} · ${esc(x.kind)} · ${Math.round(x.spent/6)/10} min${x.closed?' · Ruth stopped volunteering here':x.opened?' · Ruth opened up here':''}</strong><p>Q: ${esc(x.question)}</p><p class="table-note">A: ${esc(x.answer)}</p></div></div>`).join('');
 return `<div class="section-heading"><h3>Interview order and time</h3></div>
  <div class="table-wrap"><table class="decision-table"><thead><tr><th scope="col">Appointment</th><th scope="col">With</th><th scope="col">Questions</th><th scope="col">Time used</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="table-note">Ruth: ${esc(RUTH[t.ruth]||'')}${t.ruthClosedBy?` after “${esc(t.ruthClosedBy)}”`:''}.</p>
  <div class="section-heading"><h3>Transcript</h3></div><div class="event-list">${turns}</div>
  <p class="table-note">The kind of each question is shown here only. Students never see it.</p>`;
}
function renderReport(t,{esc,emptyPanel}){
 const chart=t.chart?Object.entries(CHART).map(([k,[title,fields]])=>`<div class="event-row"><div><strong>${esc(title)}</strong>${Object.entries(fields).map(([f,l])=>`<p>${esc(l)}: ${esc(val(t.chart[k]?.[f]))}</p>`).join('')}</div></div>`).join(''):'';
 const obs=t.observationSeconds!=null?`<div class="event-row"><div><strong>Observed pace</strong><p>${esc(t.observationSeconds)} seconds per claim. ${esc(t.observationNote||'')}</p></div></div>`:'';
 if(!t.report)return chart||obs?`<div class="event-list">${obs}${chart}</div><p class="table-note">The report appears here when the student files it.</p>`:emptyPanel('No report yet','The chart and the report appear here as the student completes them.');
 const b=K.bands[t.band];
 const calls=t.report.rows.map(r=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${esc(K.dispositions[r.disposition]||r.disposition)}</td><td>${esc(K.severities[r.severity]||'')}${r.supported?'':' · <em>without the key answer</em>'}</td><td>${esc(r.justification)}</td></tr>`).join('');
 return `${b?`<div class="result-banner"><span class="result-icon"></span><div><div class="eyebrow">Result · ${esc(b.label)}</div><h3>${esc(b.phrase)}</h3></div></div>`:''}
  <div class="event-list"><div class="event-row"><div><strong>Root cause, as written</strong><p>${esc(t.report.rootCause)}</p></div></div></div>
  <div class="section-heading"><h3>The four calls</h3></div>
  <div class="table-wrap"><table class="decision-table"><thead><tr><th scope="col">Step</th><th scope="col">Call</th><th scope="col">What follows</th><th scope="col">Reason given</th></tr></thead><tbody>${calls}</tbody></table></div>
  <div class="section-heading"><h3>Key answers heard</h3></div>
  <div class="event-list"><div class="event-row"><div><strong>Heard</strong><p>${t.evidence.held.length?t.evidence.held.map(esc).join('<br>'):'None of the key answers'}</p></div></div>
  <div class="event-row"><div><strong>Not heard</strong><p>${t.evidence.missed.map(esc).join('<br>')||'—'}</p></div></div>
  <div class="event-row"><div><strong>The repeat-copy loop</strong><p>${t.evidence.loop?'Held both halves: senders hear nothing back, and repeat copies follow days later.':'Held at most one half.'}</p></div></div></div>
  <div class="section-heading"><h3>Completed chart</h3></div><div class="event-list">${obs}${chart}</div>
  <p class="table-note">This is the filed report, not a score or a ranking.</p>`;
}

const PatienceSettings={
 id:'rapidsimplus-01', title:'Why Don\'t They Have Any Patience?', code:'SIMPLUS01', modes:['individual'], defaultMode:'individual',
 storage:{token:'patience-faculty-lt',session:'patience-kit-session',course:'patience-faculty-course'},
 // Each student moves through their own run; a practice run moves itself.
 noPause:true, practiceRunsItself:true,
 questions:[
  // The prompts arrive with the faculty session (state.kit.reviewQuestions).
  {label:'Review question 1',key:'reflection1',prompt:'',followup:''},
  {label:'Review question 2',key:'reflection2',prompt:'',followup:''}
 ],
 progressNote:'Interviews, chart and report appear as each student completes them. The review follows the report.',
 overviewLabel:'Review desk',
 bandLabel:value=>(K.bands[value]||{}).label||'Not filed',
 done:r=>!!r.done,
 started:r=>Number(r.phase||0)>0,
 record:r=>({band:r.band||null,order:r.order||[],windows:r.windows||[],ruth:r.ruth,ruthClosedBy:r.ruthClosedBy,transcript:r.transcript||[],chart:r.chart||null,
  observationSeconds:r.observationSeconds??null,observationNote:r.observationNote||'',report:r.report||null,evidence:r.evidence||null,stage:r.stage||''}),
 tabs:[{id:'interviews',label:'Interviews',icon:'users',render:renderInterviews},{id:'report',label:'Report',icon:'file',render:renderReport}],
 csv:{columns:['Order','Questions asked','Ruth','Observed seconds per claim','Intake','Receipt log','Fax vendor','First-pass review','Key answers heard','Review desk'],
  row:t=>{const calls=Object.fromEntries((t.report?.rows||[]).map(r=>[r.rowId,K.dispositions[r.disposition]||r.disposition]));
   return [(t.order||[]).join(' > '),(t.transcript||[]).length,RUTH[t.ruth]||'',t.observationSeconds??'',calls.intake||'',calls.log||'',calls.vendor||'',calls.review||'',t.evidence?t.evidence.held.length:'',(K.bands[t.band]||{}).label||''];}},
 prompts:(state,questions)=>{if(!state.kit)return;K=state.kit;(K.reviewQuestions||[]).forEach((q,i)=>{if(questions[i])questions[i].prompt=q;});},
 // The debrief prompts and what was going on. Faculty only, from the server.
 advanced:(s,state,{esc})=>{const k=state.kit||K,rv=k.reveal||{};
  return `<section class="fw-card"><h3>Debrief prompts</h3><ul>${(k.debriefNotes||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>
   <section class="fw-card"><h3>${esc(rv.heading||'What was going on')}</h3>${(rv.paragraphs||[]).map(x=>`<p>${esc(x)}</p>`).join('')}</section>`;},
 debrief:{
  mount:(root,getInput,opts)=>global.PatienceDebrief.mount(root,getInput,opts),
  input:(teams,cfg)=>({kit:cfg.state.kit||K,students:teams.map(t=>({id:t.id,name:t.name,done:t.status==='submitted',band:t.band,order:t.order,ruth:t.ruth,
   transcript:t.transcript,report:t.report,evidence:t.evidence,observationSeconds:t.observationSeconds,reflection1:t.reflection1,reflection2:t.reflection2}))})
 }
};
global.PatienceSettings=PatienceSettings;
if(typeof module!=='undefined'&&module.exports)module.exports=PatienceSettings;
})(typeof window!=='undefined'?window:globalThis);
