/* Infrastructure or Bubble?'s settings for the shared faculty pages (kit/). Everything sim-specific lives here.
   The companies, the reveal, the notes and the lessons arrive from the server with the faculty session
   (state.kit), so this file names none of them. The class view for the projector is the Live screen (live.html). */
(function(global){
'use strict';
let K={bands:{},cases:[],byCase:{},callNames:{},reviewQuestions:[],ended:false};
const callName=c=>(K.callNames||{})[c]||'';

function renderCalls(t,{esc,emptyPanel}){
 if(!t.joined)return emptyPanel('Not started','Nobody in this '+(t.individual?'run':'team')+' has opened the simulation yet.');
 const b=K.bands[t.band];
 const rows=(K.cases||[]).map(c=>{
  const x=(t.calls||{})[c.id]||{},priv=((t.privates||{})[c.id]||[]);
  const privLine=priv.length?`<p class="table-note">Private calls: ${priv.map(p=>`${esc(p.name)} · ${esc(callName(p.call))}`).join(' · ')}</p>`:'';
  if(x.status!=='recorded')return `<div class="event-row"><div><strong>${esc(c.label)}</strong><p>${x.closed?'No call recorded.':'No call yet.'}</p>${privLine}</div></div>`;
  return `<div class="event-row"><div><strong>${esc(c.label)} · ${esc(callName(x.call))}${x.closed?'':' (saved so far)'}</strong>
   <p><b>Line:</b> ${esc(x.lineLabel||'None cited')}</p><p><b>Why:</b> ${esc(x.lineWhy||'Left blank')}</p><p><b>Would have switched if:</b> ${esc(x.mind||'Left blank')}</p>${privLine}</div></div>`;
 }).join('');
 return `${b?`<div class="result-banner"><span class="result-icon"></span><div><div class="eyebrow">The calls · ${esc(b.label)}</div><h3>${esc(b.phrase)}</h3></div></div>`:''}
  <div class="event-list">${rows}</div><p class="table-note">This shows the calls and the reasons, not a score or a ranking.</p>`;
}
const liveLink=s=>{const lt=global.FacultySession&&FacultySession.page?FacultySession.page.LT:'';return `live.html?session=${encodeURIComponent(s.code)}${lt?'#lt='+encodeURIComponent(lt):''}`;};
const caseCsv=(t,id)=>{const x=(t.calls||{})[id]||{};return x.status==='recorded'?[callName(x.call),x.lineLabel||'',x.lineWhy||'',x.mind||'']:['','','',''];};

const BubbleSettings={
 id:'rapid-10-bubble', title:'Infrastructure or Bubble?', code:'SIM10', modes:['team','individual'], defaultMode:null,
 storage:{token:'s10-faculty-lt',session:'s10-kit-session',course:'s10-faculty-course'},
 // Each company has one clock for every student; the session bar moves it on.
 noPause:true,
 // A practice run is moved along by its practice student.
 practiceRunsItself:true,
 // The instructor notes for each company, from the old console (#52). Faculty only, from the server.
 advancedRefresh:true,
 advanced:(s,state,{esc})=>{const k=state.kit||K;
  return (k.cases||[]).map(c=>{const n=(k.byCase||{})[c.id]||{};
   return `<section class="fw-card"><h3>${esc(c.label)}: instructor notes</h3>
    <h4>Before the company is shown</h4><ul>${(n.disagreement||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>
    <h4>Terms to name, and the line that shows each</h4><ul>${(n.naming||[]).map(x=>`<li><b>${esc(x.term)}</b>: ${esc(x.line)}</li>`).join('')}</ul>
    <h4>The closing question</h4><p>${esc(n.turn||'')}</p>
    ${n.minorityCase?`<h4>If the class agrees: the case for each call</h4><p><b>${esc(callName('infra'))}:</b> ${esc(n.minorityCase.infra)}</p><p><b>${esc(callName('bubble'))}:</b> ${esc(n.minorityCase.bubble)}</p>`:''}
    ${n.afterNotes?`<h4>After the reveal</h4><ul>${n.afterNotes.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p class="table-note">The after-reveal notes appear here once the company is shown.</p>'}</section>`;}).join('');},
 noLead:true, teamRule:'Each member makes a private call. Then the team writes one answer, and any member commits it.',
 questions:[
  // The prompts arrive with the faculty session (state.kit.reviewQuestions).
  {label:'Review question 1',key:'reflection1',prompt:'',followup:''},
  {label:'Review question 2',key:'reflection2',prompt:'',followup:''}
 ],
 progressNote:'Calls appear as each company’s clock runs out. The review follows the last company’s outcome.',
 overviewLabel:'Calls',
 bandLabel:value=>(K.bands[value]||{}).label||'Not yet',
 done:r=>!!r.done,
 started:r=>Number(r.phase||0)>0,
 record:r=>({band:r.band||null,calls:r.calls||{},privates:r.privates||{},joined:!!r.joined,reflection1:r.reflection1||'',reflection2:r.reflection2||''}),
 tabs:[{id:'calls',label:'Calls',icon:'flag',render:renderCalls}],
 csv:{columns:['Company 1 call','Company 1 line','Company 1 reason','Company 1 would switch if','Company 2 call','Company 2 line','Company 2 reason','Company 2 would switch if','Band'],
  row:t=>[...caseCsv(t,'A'),...caseCsv(t,'B'),(K.bands[t.band]||{}).label||'']},
 prompts:(state,questions)=>{if(!state.kit)return;K=state.kit;(K.reviewQuestions||[]).forEach((q,i)=>{if(questions[i])questions[i].prompt=q;});},
 // Before Start: one company or two. Each sets that company's clock.
 // Before Start: one company or two, and the reading time per company (#51).
 lobbyControls:(s,busy)=>{const n=(s.cases||[]).length,b=(set,label,on)=>`<button class="btn fw-cases" data-session-control="${set}" aria-pressed="${on}" ${busy?'disabled':''}>${label}</button>`;
  return `<span class="fw-cases-group" role="group" aria-label="Companies">${b('cases_one','One company',n===1)}${b('cases_two','Two companies',n===2)}</span>`
   +`<span class="fw-cases-group" role="group" aria-label="Reading time per company"><span class="fw-cases-label">Reading per company</span>${(s.readOptions||[]).map(o=>b(o.set,`${o.label} · ${o.minutes} min`,o.on)).join('')}</span>`;},
 // The Live screen for the projector, and the next step for the company in play.
 controls:(s,busy)=>{const n=K.next;
  return `<a class="btn" href="${liveLink(s)}" target="_blank" rel="noopener">Live screen</a>${n&&n.addTime?`<button class="btn" data-session-control="add_time" ${busy?'disabled':''}>Add 2 minutes</button>`:''}${n?`<button class="btn" data-session-control="${n.set}" ${busy?'disabled':''}>${n.label}</button>`:''}`;},
 controlDone:{read_standard:'Reading time set.',read_longer:'Reading time set.',read_longest:'Reading time set.',add_time:'Two more minutes of reading for every student.',cases_one:'One company.',cases_two:'Two companies, one after the other.',advance:'The clock moved on.',reveal:'Shown to every student.',start_b:'Company 2 has started.'},
 debrief:{
  mount:(root,getInput,opts)=>global.BubbleDebrief.mount(root,getInput,opts),
  input:(teams,cfg)=>({kit:cfg.state.kit||K,team:cfg.state.session.mode==='team',
   teams:teams.filter(t=>t.joined).map(t=>({id:t.id,name:t.name,band:t.band,calls:t.calls,
    reviews:(t.people||[]).map(p=>{const r=(cfg.state.runs[t.id]||{}).reflections||{};const x=r[p.id];return x?{name:p.name,a1:x.reflection1,a2:x.reflection2}:null}).filter(Boolean)}))})
 }
};
global.BubbleSettings=BubbleSettings;
if(typeof module!=='undefined'&&module.exports)module.exports=BubbleSettings;
})(typeof window!=='undefined'?window:globalThis);
