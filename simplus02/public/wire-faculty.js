/* Who Pays for the Wire?'s settings for the shared faculty pages (kit/). Everything sim-specific lives here.
   The seats, terms, outcomes, the real proceeding and the lessons arrive from the server with the faculty session
   (state.kit), so this file names none of them. The class view for the projector is the Live screen (live.html). */
(function(global){
'use strict';
let K={bands:{},seatNames:{},dials:{},groups:{},staffNotices:[],reveal:{},debriefNotes:[],reviewQuestions:[],ended:false};
const UNIT={top:'%',term:' yr',exit:' yr',coll:' mo',threshold:' MW'};
const term=(d,v)=>`${v}${UNIT[d]||''}`;

function renderTable(t,{esc,emptyPanel}){
 if(!t.joined)return emptyPanel('Not started','Nobody in this team has opened the simulation yet.');
 const b=K.bands[t.band],seats=(t.seats||[]).map(p=>`${esc(p.name)} · ${esc(K.seatNames[p.seat]||'Seat at Start')}${p.joined?'':' (not opened)'}`).join('<br>');
 const r=t.result,sheet=t.sheet;
 const terms=r?Object.keys(K.dials).map(d=>`<div class="event-row"><div><strong>${esc(K.dials[d].short)}</strong><p>${esc(term(d,r.terms[d]))}${r.imposed.includes(d)?' · set by the Commission':' · signed'}</p></div></div>`).join('')
  :sheet?`<div class="event-row"><div><strong>Term sheet so far</strong><p>${Object.keys(K.dials).map(d=>`${esc(K.dials[d].short)} ${esc(term(d,sheet.dials[d]))}`).join(' · ')}</p><p class="table-note">Money ${sheet.locked.money?'locked':'open'} · Threshold ${sheet.locked.threshold?'locked':'open'} · ${sheet.moves} changes${sheet.stalled?' · quiet for '+sheet.minutesSinceActivity+' min':''}</p></div></div>`:'';
 const pf=t.playForward,col=(title,sc)=>`<div class="event-row"><div><strong>${title}</strong>${Object.keys(K.seatNames).map(k=>`<p>${esc(sc[k])}</p>`).join('')}</div></div>`;
 return `${b?`<div class="result-banner"><span class="result-icon"></span><div><div class="eyebrow">The team · ${esc(b.label)}</div><h3>${esc(b.phrase)}</h3></div></div>`:''}
  <div class="event-list"><div class="event-row"><div><strong>Seats</strong><p>${seats}</p></div></div>${terms}
  ${r?`<div class="event-row"><div><strong>Connection freeze</strong><p>${r.freezeMonths?`${r.freezeMonths} more months`:'Connections reopen now'}</p></div></div>`:''}
  ${pf?col('If the forecast demand arrives',pf.arrives)+col('If it does not',pf.misses):''}</div>
  <p class="table-note">This shows the terms and who pays, not a score or a ranking.</p>`;
}
const liveLink=s=>{const lt=global.FacultySession&&FacultySession.page?FacultySession.page.LT:'';return `live.html?session=${encodeURIComponent(s.code)}${lt?'#lt='+encodeURIComponent(lt):''}`;};
const csvTerms=t=>t.result?Object.keys(K.dials).map(d=>`${term(d,t.result.terms[d])}${t.result.imposed.includes(d)?' (Commission)':''}`):Object.keys(K.dials).map(()=>'');

const WireSettings={
 id:'rapidsimplus-02', title:'Who Pays for the Wire?', code:'SIMPLUS02', modes:['team'], defaultMode:'team',
 storage:{token:'wire-faculty-lt',session:'wire-kit-session',course:'wire-faculty-course'},
 // The phases are timed for the whole class; the session bar moves them on.
 noPause:true,
 noLead:true, teamRule:'Each team has four seats; extra members share a seat as co-counsel. Every seat signs each term itself.',
 questions:[
  // The prompts arrive with the faculty session (state.kit.reviewQuestions).
  {label:'Review question 1',key:'reflection1',prompt:'',followup:''},
  {label:'Review question 2',key:'reflection2',prompt:'',followup:''}
 ],
 progressNote:'The term sheet appears as the team negotiates. The outcome and the review follow the deadline.',
 overviewLabel:'Outcome',
 bandLabel:value=>(K.bands[value]||{}).label||'Not yet',
 done:r=>!!r.done,
 started:r=>Number(r.phase||0)>0,
 record:r=>({band:r.band||null,seats:r.seats||[],sheet:r.sheet||null,result:r.result||null,playForward:r.playForward||null,joined:!!r.joined,reflection1:r.reflection1||'',reflection2:r.reflection2||''}),
 tabs:[{id:'table',label:'Term sheet',icon:'flag',render:renderTable}],
 csv:{columns:['Take-or-pay','Term','Exit fee','Collateral','Threshold','Freeze months','Band'],
  row:t=>[...csvTerms(t),t.result?t.result.freezeMonths:'',(K.bands[t.band]||{}).label||'']},
 prompts:(state,questions)=>{if(!state.kit)return;K=state.kit;(K.reviewQuestions||[]).forEach((q,i)=>{if(questions[i])questions[i].prompt=q;});},
 // Before Start: when students are still on the walkthrough, Start anyway names them.
 lobbyControls:(s,busy)=>(s.walkthroughPending||[]).length?`<button class="btn" data-session-control="start_anyway" title="${(s.walkthroughPending||[]).join(', ')}" ${busy?'disabled':''}>Start anyway (${s.walkthroughPending.length} still reading)</button>`:'',
 // The Live screen for the projector, and the next step.
 controls:(s,busy)=>{const n=K.next;
  return `<a class="btn" href="${liveLink(s)}" target="_blank" rel="noopener">Live screen</a>${n&&n.addTime?`<button class="btn" data-session-control="extend" ${busy?'disabled':''}>Add 10 minutes</button>`:''}${n?`<button class="btn" data-session-control="${n.set}" ${busy?'disabled':''}>${n.label}</button>`:''}`;},
 controlDone:{start_anyway:'Briefing started. Students still reading go straight to their brief.',openings:'Opening statements started.',negotiation:'Negotiation is open.',extend:'Ten more minutes for every team.',close_sheet:'The sheet is closed. The Commission set every open term.'},
 // Staff notices during negotiation, and the instructor notes (debrief prompts, the real proceeding in full).
 advancedRefresh:true,
 advanced:(s,state,{esc})=>{const k=state.kit||K,runs=Object.values(state.runs||{}).filter(r=>r.tableId),list=k.staffNotices||[];
  const notices=k.phase==='negotiation'?`<section class="fw-card"><h3>Staff notices</h3><p class="table-note">Each one appears on that team's screen. The ten-minute notice is offered when twelve minutes or fewer remain.</p>
   <dl class="wr-notices">${list.map(n=>`<dt>${esc(n.label)}</dt><dd>${esc(n.text||'')}</dd>`).join('')}</dl>
   ${runs.map(r=>`<p><strong>${esc(r.teamLabel)}</strong> ${list.map(n=>`<button class="btn" title="${esc(n.text||'')}" data-session-control="notice__${esc(r.tableId)}__${esc(n.id)}">${esc(n.label)}</button>`).join(' ')}</p>`).join('')}</section>`:'';
  const rv=k.reveal||{};
  return `${notices}<section class="fw-card"><h3>Debrief prompts</h3><ul>${(k.debriefNotes||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>
   <section class="fw-card wr-account"><h3>${esc(rv.heading||'What actually happened')}</h3><details><summary>Show the full account</summary>${(rv.paragraphs||[]).map(x=>`<p>${esc(x)}</p>`).join('')}<p class="table-note">${esc(rv.note||'')}</p>
   <h4>Sources</h4>${(rv.sources||[]).map(x=>`<p><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.label)}</a><br><span class="table-note">${esc(x.locator)}</span></p>`).join('')}</details></section>`;},
 debrief:{
  mount:(root,getInput,opts)=>global.WireDebrief.mount(root,getInput,opts),
  input:(teams,cfg)=>({kit:cfg.state.kit||K,team:true,
   teams:teams.filter(t=>t.joined).map(t=>({id:t.id,name:t.name,band:t.band,seats:t.seats,result:t.result,playForward:t.playForward,
    reviews:(t.people||[]).map(p=>{const r=(cfg.state.runs[t.id]||{}).reflections||{};const x=r[p.id];return x?{name:p.name,a1:x.reflection1,a2:x.reflection2}:null}).filter(Boolean)}))})
 }
};
global.WireSettings=WireSettings;
if(typeof module!=='undefined'&&module.exports)module.exports=WireSettings;
})(typeof window!=='undefined'?window:globalThis);
