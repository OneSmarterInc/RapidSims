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
 lobbyControls:(s,busy)=>{const n=(s.cases||[]).length;
  return [['cases_one','One company',1],['cases_two','Two companies',2]].map(([set,label,k])=>`<button class="btn fw-cases" data-session-control="${set}" aria-pressed="${n===k}" ${busy?'disabled':''}>${label}</button>`).join('');},
 // The Live screen for the projector, and the next step for the company in play.
 controls:(s,busy)=>{const n=K.next;
  return `<a class="btn" href="${liveLink(s)}" target="_blank" rel="noopener">Live screen</a>${n?`<button class="btn" data-session-control="${n.set}" ${busy?'disabled':''}>${n.label}</button>`:''}`;},
 controlDone:{cases_one:'One company, with a longer clock.',cases_two:'Two companies, one after the other.',advance:'The clock moved on.',reveal:'Shown to every student.',start_b:'Company 2 has started.'},
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
