/* Midland Equipment's settings for the shared faculty pages (/kit/). Everything sim-specific lives here. */
(function(global){
'use strict';
const BAND_LABEL={strong:'Strong',middle:'Middle',pilot:'Pilot',weak:'Limited',data_no_room:'Data without room to run it'};
const LINES = [
 ['run','Run','Keep existing systems running'],
 ['uptime','Uptime','Protect dispatch and availability'],
 ['capacity','Capacity','Create processing headroom'],
 ['connect','Connect','Bring back data from field units'],
 ['features','Features','Deliver visible new capabilities']
];
const total=a=>a?LINES.reduce((n,[key])=>n+(a[key]||0),0):null;
function renderDecisions(t,{esc,icon,emptyPanel}){
 if(!t.year1&&!t.year2)return emptyPanel('No decisions saved yet','The annual allocations will appear here once the runner commits them.');
 const val=(a,key)=>a?`$${a[key]}M`:'—';
 return `<div class="section-heading"><h3>Annual budget allocations</h3></div><p class="section-description">What the team committed in each decision year.</p><div class="budget-note">${icon('info','icon-sm')}Each year has a $9M budget. There is no new allocation in Year 3.</div><div class="table-wrap"><table class="decision-table"><caption class="sr-only">${esc(t.name)} budget allocations in millions of dollars</caption><thead><tr><th scope="col">Investment area</th><th class="numeric" scope="col">Year 1</th><th class="numeric" scope="col">Year 2</th></tr></thead><tbody>${LINES.map(([key,label,desc])=>`<tr><td><strong>${label}</strong><span class="line-description">${desc}</span></td><td class="numeric">${val(t.year1,key)}</td><td class="numeric">${val(t.year2,key)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total allocated</td><td class="numeric">${t.year1?`$${total(t.year1)}M`:'—'}</td><td class="numeric">${t.year2?`$${total(t.year2)}M`:'—'}</td></tr></tfoot></table></div><p class="table-note">${!t.year2?'Year 2 has not been committed. A dash means “not submitted,” not zero.':'Both annual allocations are shown exactly as committed.'}</p><p class="table-note">Allocations belong to the team’s shared run, not to separate attempts by each member.</p>`;
}
function renderOutcomes(t,{esc,icon,bandLabel,emptyPanel}){
 const o=t.outcomes||{};
 if(!Object.keys(o).length)return emptyPanel('No outcomes recorded yet','Outcomes appear here as the runner reaches them. Other team members do not need to submit separately.');
 const y3=o.year3;
 const events=[['Year 1 · Customer reporting',o.year1],['Year 2 · Heat wave',o.year2?.heat],['Year 2 · Competitor response',o.year2?.competitor]].filter(([,v])=>v);
 return `${y3?`<div class="result-banner"><span class="result-icon">${icon('flag')}</span><div><div class="eyebrow">Year 3 · ${esc(bandLabel(y3.band))}</div><h3>${esc(y3.title)}</h3><p>${esc(y3.narrative)}</p></div></div>`:'<p class="budget-note">Year 3 has not been reached yet. Earlier outcomes are shown below.</p>'}<h3>What happened along the way</h3><div class="event-list">${events.map(([label,v])=>`<div class="event-row"><div><strong>${esc(label)} · ${esc(v.title)}</strong><p>${esc(v.narrative)}</p></div><span class="outcome-chip">${esc(bandLabel(v.band))}</span></div>`).join('')}</div>${o.buyers?`<h3>Buyer interest</h3><div class="buyer-list">${['carrolton','ridge_hollow','corven'].map(k=>o.buyers[k]).filter(Boolean).map(b=>`<div class="buyer-row"><div><strong>${esc(b.name)}</strong><small>${esc(b.reason)}</small></div><span class="outcome-chip">${esc(b.interest)}</span></div>`).join('')}</div>`:''}<p class="table-note">These are the saved simulation outcomes, not a score, ranking or winner.</p>`;
}


// Advanced settings on the Teams tab: Midland's budget thresholds and classroom notes.
function calibrate(s,state,{esc,notice}){const t=s.thresholds||state.defaultThresholds||{},L={budgetPerYear:'Annual budget ($M)',runFloor:'Run minimum ($M)',perLineCap:'Other-line annual cap ($M)',year1ConnectStrong:'Year 1 Connect strong ≥',heatUptimeStrong:'Heat wave Uptime strong ≥',heatUptimeMiddle:'Heat wave middle starts at ≥',competitorConnectStrong:'Competitor strong ≥',competitorConnectPilotMin:'Competitor pilot min',competitorConnectPilotMax:'Competitor pilot max',year3ConnectStrong:'Year 3 Connect strong ≥',year3CapacityStrong:'Year 3 Capacity strong ≥',year3ConnectPilotMin:'Year 3 pilot Connect min',year3ConnectPilotMax:'Year 3 pilot Connect max'};return `<section class="card full"><div class="meta">Calibration</div><h3>Budget and outcome thresholds</h3><p>Stored with this session and locked when it starts. Change these between sections without a deploy; existing sessions keep their own rules.</p><div class="thresholds">${Object.keys(L).map(k=>`<div class="field"><label>${esc(L[k])}</label><input class="th" data-k="${k}" type="number" step="1" min="0" max="${k==='budgetPerYear'||k==='runFloor'?30:k==='perLineCap'?6:12}" value="${Number(t[k]??0)}" ${s.state!=='lobby'?'disabled':''}></div>`).join('')}</div><div class="actions"><button class="btn" id="saveCal" ${s.state!=='lobby'?'disabled':''}>Save calibration</button></div>${notice('Year 3 treats strong Connect with sub-strong Capacity as its own authored outcome: Data without room to run it.')}</section>`}
function readiness(s,state){const t=s.thresholds||state.defaultThresholds||{};return `<section class="card full"><div class="meta">Classroom readiness</div><h3>Pilot calibration and debrief notes</h3><p>This session: $${t.budgetPerYear}M a year, Run minimum $${t.runFloor}M, other-line cap $${t.perLineCap}M. New sessions start with the provisional 9 / 4 / 3 pilot settings.</p><p>Ask students what they could justify from the briefing, which priorities they protected, and what they would change after the outcomes. A rare all-top-outcome allocation is not a correct answer or a grade.</p><p>The distribution across all mathematically legal allocations is not a prediction of this class. Judge the calibration after a facilitated pilot, not by assuming students choose randomly.</p><div class="notice"><b>Before class:</b> post the briefing packet and rehearse one Team-mode run with 2–3 devices, including runner handoff, completion reporting and the instructor console.</div></section>`}
const BUYERS=['carrolton','ridge_hollow','corven'];
const MidlandSettings={
 id:'rapid-03-midland', title:'Midland Equipment', code:'SIM03', modes:['team','individual'], defaultMode:'team',
 storage:{token:'m03-faculty-lt',session:'m03-faculty-session',course:'m03-faculty-course'},
 questions:[
  {label:'Reason for Year 1 budget', key:'strategicView', prompt:'In one sentence, what is this budget for?', followup:''},
  {label:'Review question 1', key:'reflection1', prompt:'Dale, Renata, Tom and Sam each wanted more money. Whose line got the least from you, and why?', followup:''},
  {label:'Review question 2', key:'reflection2', prompt:'Now that you have seen Year 3, which line would you move $1M into in Year 1, and where would you take it from?', followup:''}
 ],
 progressNote:'The reason for the Year 1 budget is saved work, not a final submission. Reflections are not yet submitted.',
 overviewLabel:'Year 3 outcome',
 bandLabel:value=>BAND_LABEL[value]||value||'Not reached',
 // A team run reaching phase 3 is complete (older team results saved before "done").
 done:(r,individual)=>!!r.done||(!individual&&Number(r.phase||0)>=3),
 started:r=>Number(r.phase||0)>0||!!r.strategicView||!!r.year1||!!r.year2||Number(r.screen||0)>0,
 record:(r,o)=>({strategicView:r.strategicView||'',year1:r.year1||null,year2:r.year2||null,band:o.year3?o.year3.band:null,
  result:o.year3?{band:o.year3.band,buyers:Object.fromEntries(BUYERS.map(k=>[k,o.buyers?.[k]?.interest||'']))}:null}),
 tabs:[{id:'decisions',label:'Decisions',icon:'sliders',render:renderDecisions},{id:'outcomes',label:'Outcomes',icon:'flag',render:renderOutcomes}],
 csv:{columns:[...LINES.map(([,l])=>'Year 1 '+l+' ($M)'),...LINES.map(([,l])=>'Year 2 '+l+' ($M)'),'Year 3 band','Carrolton interest','Ridge Hollow interest','Corven interest'],
  row:t=>[...LINES.map(([key])=>t.year1?.[key]??''),...LINES.map(([key])=>t.year2?.[key]??''),t.result?.band||'',t.result?.buyers.carrolton||'',t.result?.buyers.ridge_hollow||'',t.result?.buyers.corven||'']},
 // The server sends the prompts students saw; show those.
 advanced:(s,state,h)=>calibrate(s,state,h)+readiness(s,state),
 prompts:(state,questions)=>{const p=state.responsePrompts;if(!p)return;questions[0].prompt=p.opening;questions[1].prompt=p.reflections[0];questions[2].prompt=p.reflections[1];questions[1].followup=p.followups?.[0]||'';},
 debrief:{
  mount:(root,getInput,opts)=>global.MidlandDebrief.mount(root,getInput,opts),
  input:(teams,cfg)=>({mode:cfg.state.session.mode,thresholds:cfg.state.session.thresholds||cfg.state.defaultThresholds||{},
   teams:teams.map(t=>({id:t.id,name:t.name,members:t.members,year1:t.year1,year2:t.year2,outcomes:t.outcomes,strategicView:t.strategicView,reviews:t.reviews}))})
 }
};
global.MidlandSettings=MidlandSettings;
if(typeof module!=='undefined'&&module.exports)module.exports=MidlandSettings;
})(typeof window!=='undefined'?window:globalThis);
