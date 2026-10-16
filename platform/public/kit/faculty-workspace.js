/* RapidSims faculty workspace: the session page's Teams (or Students), Results and Debrief tabs.
   Shared by every sim (template: claude/RapidSims-Faculty-Template.md). Live data only; no embedded student examples.
   The sim supplies an adapter (options.sim): code, questions, bandLabel, record(run), done(run), started(run),
   tabs (detail tabs after Written answers), overview, csv, debrief, prompts. noLead: every member decides (no team lead);
   teamRule: one line on how a team decides. */
(function(global){
'use strict';
let SIM=null;
const bandLabel=value=>SIM&&SIM.bandLabel?SIM.bandLabel(value):(value||'Not reached');
function recordsFrom(snapshot,sim){
 if(sim)SIM=sim;
 const people=Object.values(snapshot.participants||{}).filter(Boolean);
 const groups=new Map(), runs=Object.values(snapshot.runs||{}).filter(Boolean);
 const individual=snapshot.session.mode==='individual';
 for(const p of people){const id=individual?`individual:${p.id}`:p.groupId;if(!id)continue;if(!groups.has(id))groups.set(id,{id,name:individual?p.name:(p.teamLabel||id.replace(/^team:/,'')),people:[]});groups.get(id).people.push(p);}
 for(const r of runs){if(!groups.has(r.runId))groups.set(r.runId,{id:r.runId,name:r.teamLabel||r.runId.replace(/^(team|individual):/,''),people:[]});}
 return [...groups.values()].map(g=>{
  const r=runs.find(x=>x.runId===g.id)||{};
  g.people.sort((a,b)=>String(a.name).localeCompare(String(b.name))||String(a.id).localeCompare(String(b.id)));
  const lead=g.people.find(p=>p.isCaptain),runner=g.people.find(p=>p.id===r.runnerId)||lead|| (individual?g.people[0]:null);
  const reflection=r.reflections?.[r.completedBy]||r.reflections?.[r.runnerId]||r.reflections?.[runner?.id]||{};
  const done=SIM&&SIM.done?SIM.done(r,individual):!!r.done;
  const status=done?'submitted':(SIM&&SIM.started?SIM.started(r):(Number(r.phase||0)>0||Number(r.screen||0)>0))?'progress':'waiting';
  const timestamp=done?(r.completedAt||r.updatedAt):null;
  const submittedAt=timestamp?new Date(timestamp).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'';
  const o=r.outcomes||{};
  const said=p=>{const x=r.reflections?.[p.id]||(p.id===runner?.id?{reflection1:r.reflection1,reflection2:r.reflection2}:null);return x?(x.reflection2||x.reflection1||''):'';};
  const reviewers=runner?[runner,...g.people.filter(p=>p.id!==runner.id)]:g.people;
  const reviews=reviewers.map(p=>({name:p.name,text:said(p)})).filter(x=>x.text);
  return {...g,individual,status,reviews,leadId:lead?.id||null,runnerId:runner?.id||null,lead:lead?.name||'Not selected',runner:runner?.name||'Not selected',members:g.people.map(p=>p.name),submittedAt,reflection1:r.reflection1||reflection.reflection1||'',reflection2:r.reflection2||reflection.reflection2||'',outcomes:o,...(SIM&&SIM.record?SIM.record(r,o):{})};
 }).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})||a.id.localeCompare(b.id));
}
function create(root,options){
 SIM=options.sim||SIM;
 const TABS=[{id:'answers',label:'Written answers',icon:'file'},...(SIM.tabs||[])];
 // Team words for team play, student words for solo play.
 const W=(team,solo)=>cfg&&cfg.state&&cfg.state.session.mode!=='team'?solo:team;
 let cfg=options,page=['manage','results','debrief'].includes(options.initialPage)?options.initialPage:options.state.session.state==='lobby'?'manage':'results',actionBusy=false,lastData='',lastManage='',pendingPaint=false;
 const draft={teamCount:'',newTeamName:'',newTeamMember:''};
 root.innerHTML="<svg xmlns=\"http://www.w3.org/2000/svg\" style=\"display:none\" aria-hidden=\"true\">\n<symbol id=\"i-grid\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/></symbol>\n<symbol id=\"i-check\" viewBox=\"0 0 24 24\"><path d=\"m5 12 4 4L19 6\"/></symbol>\n<symbol id=\"i-circle-check\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"m8 12 3 3 5-6\"/></symbol>\n<symbol id=\"i-users\" viewBox=\"0 0 24 24\"><path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"/></symbol>\n<symbol id=\"i-clock\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/></symbol>\n<symbol id=\"i-file\" viewBox=\"0 0 24 24\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/><path d=\"M14 2v6h6M8 13h8m-8 4h5\"/></symbol>\n<symbol id=\"i-download\" viewBox=\"0 0 24 24\"><path d=\"M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4\"/></symbol>\n<symbol id=\"i-compare\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"4\" width=\"7\" height=\"16\" rx=\"1.5\"/><rect x=\"14\" y=\"4\" width=\"7\" height=\"16\" rx=\"1.5\"/></symbol>\n<symbol id=\"i-search\" viewBox=\"0 0 24 24\"><circle cx=\"10.5\" cy=\"10.5\" r=\"6.5\"/><path d=\"m16 16 5 5\"/></symbol>\n<symbol id=\"i-chevron\" viewBox=\"0 0 24 24\"><path d=\"m9 5 7 7-7 7\"/></symbol>\n<symbol id=\"i-left\" viewBox=\"0 0 24 24\"><path d=\"m14 6-6 6 6 6\"/></symbol>\n<symbol id=\"i-right\" viewBox=\"0 0 24 24\"><path d=\"m10 6 6 6-6 6\"/></symbol>\n<symbol id=\"i-printer\" viewBox=\"0 0 24 24\"><path d=\"M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2\"/><path d=\"M6 14h12v8H6zM18 12h.01\"/></symbol>\n<symbol id=\"i-info\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v6m0-10h.01\"/></symbol>\n<symbol id=\"i-sliders\" viewBox=\"0 0 24 24\"><path d=\"M4 6h16M4 12h16M4 18h16\"/><rect x=\"7\" y=\"4\" width=\"3\" height=\"4\" fill=\"currentColor\" stroke=\"none\" rx=\"1\"/><rect x=\"15\" y=\"10\" width=\"3\" height=\"4\" fill=\"currentColor\" stroke=\"none\" rx=\"1\"/><rect x=\"9\" y=\"16\" width=\"3\" height=\"4\" fill=\"currentColor\" stroke=\"none\" rx=\"1\"/></symbol>\n<symbol id=\"i-flag\" viewBox=\"0 0 24 24\"><path d=\"M4 22V3m0 1c5-5 10 5 16 0v11c-6 5-11-5-16 0\"/></symbol>\n<symbol id=\"i-close\" viewBox=\"0 0 24 24\"><path d=\"m6 6 12 12M18 6 6 18\"/></symbol>\n<symbol id=\"i-shield\" viewBox=\"0 0 24 24\"><path d=\"M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z\"/><path d=\"m8 12 3 3 5-6\"/></symbol>\n</svg><div class=\"fw-session-head\"><div><h2 id=\"fw-session-name\"></h2><p id=\"fw-session-state\" class=\"section-description\"></p></div><div class=\"fw-header-actions\"><button class=\"btn\" id=\"fw-refresh\" hidden>Retry student list</button><a class=\"btn\" id=\"courseAccess\" target=\"_blank\" rel=\"noopener\" hidden>Students waiting for access</a></div></div>\n<div id=\"faculty-error\" role=\"alert\"></div><div id=\"fw-error\" role=\"alert\" hidden></div>\n<nav class=\"fw-nav\" aria-label=\"Session workspace\"><button class=\"btn\" data-view=\"manage\" id=\"manage-tab\">Teams</button><button class=\"btn\" data-view=\"results\" id=\"results-tab\">Results</button><button class=\"btn\" data-view=\"debrief\" id=\"debrief-tab\">Debrief</button></nav>\n<section id=\"manage-view\" aria-labelledby=\"manage-title\"><div id=\"manage-content\"></div><details class=\"advanced fw-advanced\" id=\"fw-advanced\"><summary>Advanced settings and instructor notes</summary><div id=\"fw-advanced-content\"></div></details></section>\n<section id=\"results-view\"> <div class=\"page-heading\">\n  <div><h1 id=\"results-title\">Team results</h1><p class=\"subtitle\">Every team, one shared result. Choose a team to read its responses.</p></div>\n  <div class=\"heading-actions\"><button class=\"btn\" id=\"compare-btn\"><svg class=\"icon icon-sm\" aria-hidden=\"true\"><use href=\"#i-compare\"/></svg>Compare teams</button><button class=\"btn btn-primary\" id=\"export-btn\" title=\"Export all saved team records as CSV\"><svg class=\"icon icon-sm\" aria-hidden=\"true\"><use href=\"#i-download\"/></svg>Export responses</button></div>\n </div>\n <section class=\"stats\" aria-label=\"Session summary\">\n  <div class=\"stat\"><span class=\"stat-icon\"><svg class=\"icon\" aria-hidden=\"true\"><use href=\"#i-users\"/></svg></span><div><div class=\"stat-number\" id=\"total-stat\">0</div><div class=\"stat-label\">Total teams</div></div></div>\n  <div class=\"stat\"><span class=\"stat-icon green\"><svg class=\"icon\" aria-hidden=\"true\"><use href=\"#i-circle-check\"/></svg></span><div><div class=\"stat-number\" id=\"submitted-stat\">0</div><div class=\"stat-label\">Submitted</div></div></div>\n  <div class=\"stat\"><span class=\"stat-icon amber\"><svg class=\"icon\" aria-hidden=\"true\"><use href=\"#i-clock\"/></svg></span><div><div class=\"stat-number\" id=\"progress-stat\">0</div><div class=\"stat-label\">In progress</div></div></div>\n  <div class=\"stat\"><span class=\"stat-icon\"><svg class=\"icon\" aria-hidden=\"true\"><use href=\"#i-file\"/></svg></span><div><div class=\"stat-number\" id=\"waiting-stat\">0</div><div class=\"stat-label\">Not started</div></div></div>\n </section>\n <div class=\"workspace\">\n  <aside class=\"team-sidebar\" aria-label=\"Choose a team\">\n   <div class=\"sidebar-top\">\n    <div class=\"sidebar-title\"><h2>Teams</h2><span class=\"count\" id=\"visible-count\">0</span></div>\n    <div class=\"search-field\"><svg class=\"icon icon-sm\" aria-hidden=\"true\"><use href=\"#i-search\"/></svg><label class=\"sr-only\" for=\"team-search\">Search by team or student name</label><input type=\"search\" id=\"team-search\" placeholder=\"Search team or student…\" autocomplete=\"off\" spellcheck=\"false\"><button class=\"search-clear\" id=\"clear-search\" aria-label=\"Clear search\" hidden><svg class=\"icon icon-sm\" aria-hidden=\"true\"><use href=\"#i-close\"/></svg></button></div>\n    <div class=\"filter-row\" role=\"group\" aria-label=\"Filter teams by submission status\"><button class=\"filter\" data-filter=\"all\" aria-pressed=\"true\">All</button><button class=\"filter\" data-filter=\"submitted\" aria-pressed=\"false\">Submitted</button><button class=\"filter\" data-filter=\"pending\" aria-pressed=\"false\">Pending</button></div>\n   </div>\n   <button class=\"btn fw-all\" id=\"all-teams-btn\">All team results</button><div class=\"team-list\" id=\"team-list\"></div>\n   <div class=\"list-footer\"><svg class=\"icon icon-sm\" aria-hidden=\"true\"><use href=\"#i-users\"/></svg>One shared response per team</div>\n  </aside>\n  <section class=\"response-panel\" aria-labelledby=\"response-heading\">\n   <div class=\"response-header\" id=\"response-header\"></div>\n   <div class=\"tabs\" role=\"tablist\" aria-label=\"Team response sections\" id=\"response-tabs\">\n    "+TABS.map((t,i)=>`<button class=\"tab\" id=\"tab-${t.id}\" role=\"tab\" aria-selected=\"${i===0}\" aria-controls=\"response-content\" data-tab=\"${t.id}\" tabindex=\"${i===0?0:-1}\"><svg class=\"icon icon-sm\" aria-hidden=\"true\"><use href=\"#i-${t.icon||'file'}\"/></svg>${t.label}${i===0?' <span class=\"tab-count\" id=\"answer-count\">0</span>':''}</button>`).join('')+"\n   </div>\n   <div class=\"panel-body\" id=\"response-content\" role=\"tabpanel\" aria-labelledby=\"tab-answers\" tabindex=\"0\"></div>\n   <div class=\"panel-footer\" id=\"response-footer\"></div>\n  </section>\n </div>\n </section>\n<section id=\"debrief-view\" aria-label=\"Class debrief\" hidden><div id=\"md-root\" class=\"md-root\"></div></section>\n<div id=\"fw-startbar\" class=\"fw-startbar\"></div>\n<dialog id=\"compare-dialog\" aria-labelledby=\"compare-heading\" aria-describedby=\"compare-description\">\n <div class=\"dialog-header\"><div><h2 id=\"compare-heading\">Compare team answers</h2><p id=\"compare-description\">The same question, every submitted team.</p></div><button class=\"icon-button\" id=\"close-compare\" aria-label=\"Close comparison\"><svg class=\"icon\" aria-hidden=\"true\"><use href=\"#i-close\"/></svg></button></div>\n <div class=\"dialog-body\"><div class=\"compare-toolbar\" role=\"group\" aria-label=\"Choose a question to compare\">"+SIM.questions.map((q,i)=>`<button class=\"compare-filter\" data-question=\"${i}\" aria-pressed=\"${i===0}\">${q.label}</button>`).join('')+"</div><div class=\"compare-question\" id=\"compare-question\"></div><div class=\"compare-grid compare-all\" id=\"compare-all\"></div></div>\n <div class=\"dialog-footer\">Saved team responses · No score, ranking, or automated judgment.</div>\n</dialog>\n<div id=\"toast\" class=\"toast\" role=\"status\" hidden></div>\n<div id=\"announcer\" class=\"sr-only\" role=\"status\" aria-live=\"polite\" aria-atomic=\"true\"></div>\n<div id=\"print-sheet\" class=\"print-sheet\"></div>\n";


const QUESTIONS = SIM.questions.map(q=>({...q}));
let TEAMS = [];
const state={selected:'all',filter:'all',query:'',tab:'answers',compareQuestion:0,compareLeft:null,compareRight:null};
const $=id=>root.querySelector(`#${id}`);
const icon=(name,cls='')=>`<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sessionClosed=false;
const statusLabel=status=>({submitted:'Submitted',progress:'In progress',waiting:sessionClosed?'Didn’t start':'Not started'}[status]||status);
const selectedTeam=()=>TEAMS.find(t=>t.id===state.selected)||null;
const visibleTeams=()=>TEAMS.filter(t=>(state.filter==='all'||(state.filter==='submitted'?t.status==='submitted':t.status!=='submitted'))&&(`${t.name} ${t.members.join(' ')} ${t.lead} ${t.runner}`).toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));
const answerCount=t=>QUESTIONS.filter(q=>Boolean(t[q.key]?.trim())).length;
const badge=t=>`<span class="badge ${t.status}">${icon(t.status==='submitted'?'check':t.status==='progress'?'clock':'file','icon-sm')}${statusLabel(t.status)}</span>`;
function announce(text){$('announcer').textContent=text;}
function showToast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>$('toast').hidden=true,4300);}
function renderList(){
 const visible=visibleTeams();
 $('visible-count').textContent=visible.length;
 $('clear-search').hidden=!$('team-search').value;
 root.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===state.filter)));
 $('team-list').innerHTML=visible.length?visible.map(t=>`<button class="team-item" data-team="${esc(t.id)}" aria-pressed="${state.selected===t.id}" aria-label="${esc(t.name)}, ${esc(t.members.join(' and '))}, ${statusLabel(t.status)}"><span class="team-line"><span class="team-name">${esc(t.name)}</span>${state.selected===t.id?`<span class="selected-mark">${icon('chevron','icon-sm')}</span>`:''}</span>${t.individual?'':`<span class="team-members" style="display:block">${esc(t.members.join(' · '))}</span>`}<span class="team-status ${t.status}"><span class="status-dot"></span>${statusLabel(t.status)}</span></button>`).join(''):'<p class="empty-list">No matching teams.<br>Try another name or clear the filters.</p>';
}
function renderHeader(t){
 if(!t){$('response-header').innerHTML=`<h2 id="response-heading" tabindex="-1">${W('All team results','All student results')}</h2>`;$('response-tabs').hidden=true;return;}
 const identity=t.people.map(person=>{ const name=person.name;
  const role=t.individual?'Student':person?.id===t.leadId&&person?.id===t.runnerId?'Lead & runner':person?.id===t.leadId?'Team lead':person?.id===t.runnerId?'Selected runner':'Member';
  return `<span class="member-chip"><span class="member-avatar" aria-hidden="true">${esc(name.slice(0,1))}</span><span>${esc(name)} <span class="member-role">${role}</span></span>`;
 }).join('');
 const time=t.status==='submitted'?`${t.individual?'Submitted':'Submitted by '+esc(t.runner)} · ${esc(t.submittedAt)}`:t.status==='progress'?'Saved work · Final response not submitted':'Waiting for the runner to start';
 const note=t.individual?'This is the student’s individual run.':t.status==='submitted'?'One submission for the whole team. All members share this result.':'Only the selected runner completes and submits the shared team response.';
 $('response-header').innerHTML=`<button class="btn btn-quiet fw-back-all" id="back-all-btn">← All ${esc(cfg.state.session.mode==='team'?'teams':'students')}</button><div class="team-header-line"><div><div class="heading-with-badge"><h2 id="response-heading" tabindex="-1">${esc(t.name)}</h2>${badge(t)}</div><p class="submitted-time">${time}</p></div><button class="btn btn-quiet" id="print-btn" aria-label="Print all sections for ${esc(t.name)}" title="Print this team’s answers, decisions, and outcomes">${icon('printer','icon-sm')}<span class="print-label">${W('Print team','Print')}</span></button></div><div class="team-identity">${identity}</div><p class="shared-note">${icon('users','icon-sm')}${note}</p>`;
 $('response-tabs').hidden=false;
 $('answer-count').textContent=answerCount(t);
 $('print-btn').onclick=()=>{buildPrintSheet();window.print();};
}
function emptyPanel(title,description,clear=false){return `<div class="empty-panel"><div class="empty-icon">${icon('file','icon-lg')}</div><h3>${esc(title)}</h3><p>${esc(description)}</p>${clear?'<button class="btn" id="reset-filters">Clear search and filters</button>':''}</div>`;}
function renderAnswers(t){
 if(t.status==='waiting')return emptyPanel('No response yet',`${t.runner} has not started the simulation. The team’s answers will appear here after they are saved. Other members do not need to submit separately.`);
 return `${t.status==='progress'?`<div class="work-in-progress">${icon('clock','icon-sm')}<span><strong>${t.individual?'This student is':'This team is'} still playing.</strong> ${esc(SIM.progressNote||'Saved answers are work in progress, not a final submission.')}</span></div>`:''}<div class="panel-intro"><span>${icon('file','icon-sm')}${answerCount(t)} of ${QUESTIONS.length} written answers ${t.status==='submitted'?'submitted':'saved'}</span><span class="sample-tag">SAVED RESPONSES</span></div>${QUESTIONS.map((q,i)=>`<article class="response-block"><div class="question-kicker"><span class="question-number">0${i+1}</span><span class="question-label">${q.label}</span></div><h3 class="question-title">${esc(q.prompt)}</h3>${q.followup?`<p class="question-followup">${esc(q.followup)}</p>`:''}<p class="answer-text ${!t[q.key]?'pending':''}">${esc(t[q.key]||(t.status==='submitted'?(t.individual?'Answers appear here when the student sends the review.':'Answers appear here when a team member sends the review.'):'Not submitted yet.'))}</p></article>`).join('')}`;
}
const helpers={esc,icon,bandLabel,emptyPanel:(a,b)=>emptyPanel(a,b)};
const renderTab=(id,t)=>{const tab=TABS.find(x=>x.id===id);return tab&&tab.render?tab.render(t,helpers):'';};
function renderContent(){
 const t=selectedTeam();
 root.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===state.tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});
 $('response-content').setAttribute('aria-labelledby',`tab-${state.tab}`);
 $('response-content').innerHTML=state.selected==='all'?renderOverview():!t?emptyPanel('No matching teams','Try a different team or student name, or clear your filters.',true):state.tab==='answers'?renderAnswers(t):renderTab(state.tab,t);
 const reset=$('reset-filters');if(reset)reset.onclick=resetFilters;
 buildPrintSheet();
}
function renderFooter(){
 const teams=visibleTeams(),index=teams.findIndex(t=>t.id===state.selected);
 $('response-footer').hidden=!teams.length||state.selected==='all';
 $('response-footer').innerHTML=`<span class="footer-position">${W('Team','Student')} ${index+1} of ${teams.length}${state.filter!=='all'||state.query?' matching':''}</span><div class="pager"><button class="btn btn-quiet" id="previous-team" ${index<=0?'disabled':''}>${icon('left','icon-sm')}Previous</button><button class="btn" id="next-team" ${index>=teams.length-1?'disabled':''}>${W('Next team','Next student')}${icon('right','icon-sm')}</button></div>`;
 $('previous-team').onclick=()=>selectTeam(teams[index-1]?.id,true);
 $('next-team').onclick=()=>selectTeam(teams[index+1]?.id,true);
}
function renderAll(){const teams=visibleTeams();if(state.selected!=='all'&&!teams.some(t=>t.id===state.selected))state.selected=teams[0]?.id||null;renderList();renderHeader(selectedTeam());renderContent();renderFooter();}
function selectTeam(id,focus=false){if(!TEAMS.some(t=>t.id===id))return;state.selected=id;renderAll();announce(`${selectedTeam().name} selected. ${statusLabel(selectedTeam().status)}. ${state.tab==='answers'?'Written answers':state.tab} displayed.`);if(focus)$('response-heading').focus({preventScroll:true});}
function resetFilters(){state.filter='all';state.query='';$('team-search').value='';renderAll();$('team-search').focus();announce('Search and filters cleared. All teams shown.');}
$('team-list').addEventListener('click',event=>{const b=event.target.closest('[data-team]');if(b)selectTeam(b.dataset.team);});
$('team-search').addEventListener('input',()=>{state.query=$('team-search').value.trim();renderAll();announce(`${visibleTeams().length} matching teams.`);});
$('clear-search').onclick=()=>{$('team-search').value='';state.query='';renderAll();$('team-search').focus();announce('Search cleared.');};
root.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;renderAll();announce(`${visibleTeams().length} teams shown with ${b.textContent.toLowerCase()} filter.`);});
function switchTab(tab,focus=false){state.tab=tab;renderContent();if(focus)$(`tab-${tab}`).focus();announce(`${tab==='answers'?'Written answers':tab} displayed for ${selectedTeam()?.name||'the selected team'}.`);}
root.querySelectorAll('[data-tab]').forEach(b=>{
 b.onclick=()=>switchTab(b.dataset.tab);
 b.onkeydown=event=>{const tabs=TABS.map(x=>x.id),n=tabs.length;let index=tabs.indexOf(state.tab);if(event.key==='ArrowRight')index=(index+1)%n;else if(event.key==='ArrowLeft')index=(index+n-1)%n;else if(event.key==='Home')index=0;else if(event.key==='End')index=n-1;else return;event.preventDefault();switchTab(tabs[index],true);};
});
// A single team record is exported once. Members do not create duplicate response rows.
function csvCell(value){let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
function makeCsv(){
 const extra=SIM.csv||{columns:[],row:()=>[]};
 const columns=['Team','Status','Team lead','Selected runner','Members','Submitted at',...QUESTIONS.map(q=>q.label),...extra.columns,'Session'];
 const rows=TEAMS.map(t=>[t.name,statusLabel(t.status),t.lead,t.runner,t.members.join('; '),t.submittedAt||'',...QUESTIONS.map(q=>t[q.key]||''),...extra.row(t),cfg.state.session.code]);
 return '\uFEFF'+[columns,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
$('export-btn').onclick=()=>{const blob=new Blob([makeCsv()],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${SIM.code}_${cfg.state.session.code}_team_responses.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast(`Exported ${TEAMS.length} records. One row per shared run.`);};
// Comparison: native, readable selects. A team cannot be compared with itself.
const completedTeams=()=>TEAMS.filter(t=>t.status==='submitted');
function renderComparison(){const q=QUESTIONS[state.compareQuestion];$('compare-question').innerHTML=`<h3>${esc(q.prompt)}</h3>${q.followup?`<p>${esc(q.followup)}</p>`:''}`;root.querySelectorAll('[data-question]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.question)===state.compareQuestion)));const list=completedTeams();$('compare-all').style.setProperty('--n',String(Math.min(list.length,4)));$('compare-all').innerHTML=list.map(t=>`<section class="compare-card"><div class="compare-card-top"><b>${esc(t.name)}</b><div class="compare-student">${esc(t.individual?'':`${t.runner} entered the decisions · ${t.members.join(', ')}`)}</div></div><p class="compare-answer">${esc(t[q.key]||'No response recorded.')}</p></section>`).join('');}
$('compare-btn').onclick=()=>{
 const submitted=completedTeams();if(submitted.length<2){showToast(W('Two submitted teams are needed for comparison.','Two finished students are needed for comparison.'));return;}
 renderComparison();$('compare-dialog').showModal();
};
$('close-compare').onclick=()=>$('compare-dialog').close();
$('compare-dialog').addEventListener('click',event=>{if(event.target!==$('compare-dialog'))return;const r=$('compare-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('compare-dialog').close();});
root.querySelectorAll('[data-question]').forEach(b=>b.onclick=()=>{state.compareQuestion=Number(b.dataset.question);renderComparison();});
function buildPrintSheet(){const selected=selectedTeam(),list=selected?[selected]:TEAMS;$('print-sheet').innerHTML=list.map(t=>`<article><p class="eyebrow">RapidSims · ${esc(SIM.code)} · Faculty report</p><h1>${esc(cfg.state.session.name)} — ${esc(t.name)}</h1><p class="print-meta">Session ${esc(cfg.state.session.code)} · ${statusLabel(t.status)}<br>Members: ${esc(t.members.join(', '))}<br>Team lead: ${esc(t.lead)} · Runner: ${esc(t.runner)}${t.submittedAt?`<br>Submitted: ${esc(t.submittedAt)}`:''}</p><section class="print-section"><h2>Written answers</h2>${QUESTIONS.map(q=>`<div class="print-card"><h3>${esc(q.prompt)}</h3>${q.followup?`<p>${esc(q.followup)}</p>`:''}<p style="white-space:pre-wrap">${esc(t[q.key]||'No response recorded.')}</p></div>`).join('')}</section>${TABS.slice(1).map(x=>`<section class="print-section"><h2>${esc(x.label)}</h2>${x.render(t,helpers)}</section>`).join('')}</article>`).join('');}
window.addEventListener('beforeprint',buildPrintSheet);

function allowedPeople(){
 const all=Object.values(cfg.state.participants||{}).filter(Boolean);
 const allowed=cfg.roster?.available?new Set(cfg.roster.students.filter(p=>p.accessReleased===true).map(p=>p.participantId)):null;
 return all.filter(p=>!allowed||allowed.has(p.id)).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
function setupStatus(){
 const s=cfg.state.session,people=allowedPeople();
 if(s.mode!=='team')return {ready:true,message:'Ready to start',detail:'Each student will run the simulation individually.'};
 if(s.platformAuth&&s.courseId&&!cfg.roster)return {ready:false,message:'Loading approved students',detail:'The course list is being checked. You do not need to ask students to start the simulation.'};
 if(s.platformAuth&&s.courseId&&(!cfg.roster?.available||cfg.rosterError))return {ready:false,message:'Refresh the approved student list',detail:cfg.rosterError||'Course approval could not be checked. Existing results are still available.'};
 const approved=new Set(people.map(p=>p.id));
 const inactive=Object.values(cfg.state.participants||{}).filter(p=>p?.groupId&&!approved.has(p.id));
 if(inactive.length)return {ready:false,message:'Review students without course access',detail:'Unassign students whose approval was removed, or restore access on the course page.'};
 if(!people.length)return {ready:false,message:s.platformAuth?'Approve students on the course page':'Share the session link',detail:s.platformAuth?'Approved names will appear here automatically. No student needs to click Start sim first.':'Students join with the session link, then you can create teams.'};
 const unassigned=people.filter(p=>!p.groupId);
 if(unassigned.length)return {ready:false,message:`Assign ${unassigned.length} student${unassigned.length===1?'':'s'} to a team`,detail:'Use Auto split teams, or assign students individually below.'};
 const groups=TEAMS.filter(t=>t.people.length);
 const noLead=SIM.noLead?[]:groups.filter(t=>!t.leadId);
 if(noLead.length)return {ready:false,message:`Choose a team lead for ${noLead.map(t=>t.name).join(', ')}`,detail:'Every team needs one lead. The lead runs by default and may select another team member.'};
 return {ready:true,message:'Teams are ready',detail:`${people.length} students assigned across ${groups.length} ${groups.length===1?'team':'teams'}. ${SIM.teamRule||'Each team has one runner.'} Students do not need to open the simulation before you start.`};
}
function renderOverview(){
 const list=visibleTeams();
 if(!TEAMS.length)return emptyPanel(W('No team results yet','No student results yet'),cfg.state.session.mode==='team'?'Create teams in Manage session. Every team will appear here, including teams that have not started.':'Students will appear here once they join this individual session.');
 if(!list.length)return emptyPanel('No matching teams','Clear the filters or search for another team or student name.',true);
 return `<p class="section-description">${W('Select a team to read its ','Select a student to read their ')}${(()=>{const parts=[...TABS.slice(1).flatMap(x=>x.label.toLowerCase().split(' and ')),'answers'];return parts.length>1?parts.slice(0,-1).join(', ')+' and '+parts[parts.length-1]:parts[0];})()}. ${W('Each shared run appears once.','Each student has one run.')}</p><div class="table-wrap"><table class="decision-table fw-overview"><thead><tr><th>${W('Team / students','Student')}</th><th>Status</th><th>${esc(SIM.overviewLabel||'Result')}</th><th><span class="sr-only">Open result</span></th></tr></thead><tbody>${list.map(t=>`<tr><td><strong>${esc(t.name)}</strong>${t.individual?'':`<span class="line-description">${esc(t.members.join(' · ')||'Saved run')}</span>`}</td><td>${badge(t)}</td><td>${esc(bandLabel(t.band))}</td><td><button class="btn" data-open-team="${esc(t.id)}" aria-label="View ${esc(t.name)} result">View</button></td></tr>`).join('')}</tbody></table></div><p class="table-note">These show where each ${W('team','student')} is in the run.</p><button class="btn" id="print-all">${icon('printer','icon-sm')}Print all results</button>`;
}
function renderManage(){
 const s=cfg.state.session,people=allowedPeople(),groups=TEAMS.filter(t=>t.people.length),editable=s.state!=='closed';
 const openDetails=[...root.querySelectorAll('#manage-content details[open]')].map(d=>d.id);
 const signature=JSON.stringify([s,people,groups.map(t=>[t.id,t.leadId,t.runnerId,t.people]),cfg.roster,cfg.rosterError]);
 if(signature===lastManage)return;
 if(root.contains(document.activeElement)&&/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)&&document.activeElement.closest('#manage-content')&&!document.activeElement.readOnly&&!document.activeElement.disabled){pendingPaint=true;return;}
 lastManage=signature;pendingPaint=false;
 const unassigned=people.filter(p=>!p.groupId),allowed=new Set(people.map(p=>p.id));
 const n=people.length,suggested=n<=1?1:Math.min(n,Math.max(2,Math.ceil(n/4)));
 const choices=(current)=>groups.filter(g=>g.id!==current).map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
 const moveRow=(p,inside)=>`<div class="fw-person" data-person-id="${esc(p.id)}"><div><strong>${esc(p.name)}</strong><small>${!allowed.has(p.id)?'Course access no longer approved':p.joinedAt?'Opened the simulation':'Approved · not opened yet'}</small></div>${s.practice?'':`<label class="sr-only" for="move-${esc(p.id)}">Assign ${esc(p.name)} to team</label><select id="move-${esc(p.id)}" class="fw-move" data-pid="${esc(p.id)}" ${!editable||actionBusy?'disabled':''}><option value="">${inside?'Move student…':'Assign to team…'}</option>${choices(p.groupId)}${inside?'<option value="__unassigned__">Unassign</option>':''}</select>`}</div>`;
 $('manage-content').innerHTML=`<h1 id="manage-title">${s.mode==='team'?'Teams':'Students'}</h1><p class="subtitle">${s.practice?'Your practice team is ready. Start the session when you are.':s.mode==='team'?(SIM.noLead?'Split students into teams, then start the session.':'Split students into teams, choose who enters each team’s decisions, then start the session.'):'Students join from the class link. Start the session when your class is ready.'}</p><section class="fw-share fw-card${s.platformAuth?' fw-slim':''}"${s.practice?' hidden':''}><div><h3>${s.platformAuth?'Students join from the class link.':'Student session link'}</h3>${s.platformAuth?'':`<p class="section-description">${s.mode==='team'?'Students open their team from this link. One member enters the team’s decisions.':'Share this link with your students.'}</p>`}</div><div class="fw-link"><label class="sr-only" for="join">Student session link</label><input id="join" readonly value="${esc(s.joinUrl||cfg.joinUrl)}"><button class="btn" id="copy">${s.platformAuth?'Copy backup link':'Copy link'}</button></div></section>
 ${s.mode==='team'?`<section class="fw-card"><div class="fw-section-head"><div><h2>Team setup</h2><p class="section-description">${s.practice?`${n} practice students.`:`${n} ${s.platformAuth?'approved':'joined'} students available. ${s.platformAuth?'Opening the simulation is not required for grouping.':''}`}</p></div><span class="badge waiting">${groups.length} ${groups.length===1?'team':'teams'}</span></div>${s.practice?'<p class="table-note">The practice students are already in their team. Start when they are ready.</p>':s.state==='lobby'?`<div class="fw-split"><div class="fw-field"><label for="teamCount">Number of teams</label><input id="teamCount" type="number" min="1" max="${Math.max(1,n)}" value="${esc(draft.teamCount||suggested)}"></div><button class="btn btn-primary" id="autoSplit" ${!n||actionBusy||!!cfg.rosterError?'disabled':''}>Auto split teams</button></div><p class="table-note">Auto split uses all approved students. Existing teams are changed only when you choose to split again.</p>`:'<p class="table-note">The session has started. Existing teams and saved work are kept; use individual assignments for any late arrivals.</p>'}
 ${unassigned.length?`<div class="fw-unassigned"><h3>Unassigned students · ${unassigned.length}</h3>${unassigned.map(p=>moveRow(p,false)).join('')}</div>`:''}
 <div class="fw-team-grid">${groups.map(t=>`<article class="fw-team-card" data-group="${esc(t.id)}"><div class="fw-section-head"><h3>${esc(t.name)}</h3>${s.practice?'':`<button class="btn btn-quiet fw-rename" data-gid="${esc(t.id)}" data-label="${esc(t.name)}" ${!editable?'disabled':''}>Rename</button>`}</div>${SIM.noLead?`<p class="table-note">${esc(SIM.teamRule||'')}</p>`:`<div class="fw-field"><label for="lead-${esc(t.id)}">Team lead (default runner)</label><select class="team-lead fw-lead" id="lead-${esc(t.id)}" data-gid="${esc(t.id)}" ${!editable||actionBusy?'disabled':''}><option value="" ${!t.leadId?'selected':''}>Choose team lead</option>${t.people.map(p=>`<option value="${esc(p.id)}" ${p.id===t.leadId?'selected':''} ${!allowed.has(p.id)?'disabled':''}>${esc(p.name)}</option>`).join('')}</select><p class="table-note">Current runner: <strong>${esc(t.runner)}</strong>. Other members participate with this person and share the result.</p></div>`}${t.people.map(p=>moveRow(p,true)).join('')}</article>`).join('')}</div>
 ${editable&&!s.practice?`<details id="fw-manual-team" class="fw-manual"><summary>Create a team manually</summary><div class="fw-split"><div class="fw-field"><label for="newTeamName">Team name</label><input id="newTeamName" maxlength="40" value="${esc(draft.newTeamName)}" placeholder="For example, Team 3"></div><div class="fw-field"><label for="newTeamMember">First student</label><select id="newTeamMember"><option value="">Choose a student</option>${unassigned.map(p=>`<option value="${esc(p.id)}" ${p.id===draft.newTeamMember?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div><button class="btn" id="createTeam" ${!unassigned.length||actionBusy?'disabled':''}>Create team</button></div></details>`:''}</section>`:`<section class="fw-card"><h2>Individual play</h2><p>Every student owns their own run. Team assignment and runner selection are not needed.</p></section>`}`;
 for(const id of openDetails){const d=$(id);if(d)d.open=true;}
}
function renderStart(){
 const s=cfg.state.session,ready=setupStatus();$('fw-startbar').hidden=false;
 // A practice run its practice student moves along: no Start, no setup choices (#53).
 if(s.practice&&SIM.practiceRunsItself){$('fw-startbar').innerHTML=`<div class="fw-start-inner"><div><strong>Practice run</strong><p>The practice student moves it along. Their answers appear under Results.</p></div><div class="fw-start-actions">${page==='debrief'?'<button class="btn btn-primary" data-view="results">Results</button>':'<button class="btn btn-primary" data-view="debrief">Open debrief</button>'}</div></div>`;return;}
 const buttons=s.state==='lobby'?`${SIM.lobbyControls?SIM.lobbyControls(s,actionBusy):''}<button class="btn btn-primary" id="start-session" data-session-control="start" ${!ready.ready||actionBusy?'disabled':''}>${actionBusy?'Saving…':'Start session →'}</button><button class="btn fw-close" data-session-control="close" ${actionBusy?'disabled':''}>Close session</button>`:s.state==='running'?`${(typeof SIM.noPause==='function'?SIM.noPause(s):SIM.noPause)||s.practice?'':`<button class="btn btn-primary" data-session-control="${s.paused?'resume':'pause'}" ${actionBusy?'disabled':''}>${s.paused?'Resume session':'Pause session'}</button>`}${page==='debrief'?'<button class="btn" data-view="results">Results</button>':'<button class="btn" data-view="debrief">Open debrief</button>'}${SIM.controls?SIM.controls(s,actionBusy):''}<button class="btn fw-close" data-session-control="close" ${actionBusy?'disabled':''}>Close session</button>`:`${page==='debrief'?'<button class="btn btn-primary" data-view="results">Results</button>':'<button class="btn btn-primary" data-view="debrief">Open debrief</button>'}<button class="btn" data-session-control="reopen" ${actionBusy?'disabled':''}>Reopen session</button>`;
 $('fw-startbar').innerHTML=`<div class="fw-start-inner"><div><strong>${esc(s.state==='lobby'?ready.message:s.state==='closed'?'Session closed':s.paused?'Session paused':'Session running')}</strong><p>${esc(s.state==='lobby'?ready.detail:s.state==='closed'?'All saved responses and outcomes are under Results.':(s.mode==='team'?(SIM.teamRule||'Each team has one runner. All members share the same result.'):'Each student plays their own run.'))}</p></div><div class="fw-start-actions">${buttons}</div></div>`;
}
// Debrief slides, written from this session's own results (midland-debrief.js).
function mountDebrief(){
 if(!SIM.debrief||!global.DebriefPlayer){$('md-root').innerHTML='<p class="md-empty">The debrief could not load. Reload the page.</p>';return;}
 SIM.debrief.mount($('md-root'),()=>SIM.debrief.input(TEAMS,cfg),{onEnd:()=>showPage('results')});
}
function showPage(p){page=p;paintPage();if(cfg.onPage)cfg.onPage(page);}
function paintPage(){
 $('manage-view').hidden=page!=='manage';$('results-view').hidden=page!=='results';$('debrief-view').hidden=page!=='debrief';
 if(page==='debrief')mountDebrief();
 root.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===page?'page':'false'));
 renderStart();if(page==='manage')renderManage();
}
async function perform(action,success){
 if(actionBusy)return;actionBusy=true;renderStart();$('fw-error').hidden=true;delete $('fw-error').dataset.source;
 try{
  await action();await cfg.refresh();if(success)showToast(success);
 }catch(error){$('fw-error').textContent=error.message||'The action could not be saved. Please try again.';$('fw-error').hidden=false;}
 finally{actionBusy=false;lastManage='';paintPage();}
}
root.addEventListener('click',event=>{
 const b=event.target.closest('button');if(!b||b.disabled)return;
 if(b.dataset.view){showPage(b.dataset.view);return;}
 if(b.dataset.openTeam){selectTeam(b.dataset.openTeam,true);return;}
 if(b.id==='all-teams-btn'||b.id==='back-all-btn'){state.selected='all';renderAll();return;}
 if(b.id==='copy'){const input=$('join');navigator.clipboard?.writeText(input.value).then(()=>showToast('Student session link copied.')).catch(()=>{input.select();showToast('Select and copy the highlighted session link.');});if(!navigator.clipboard){input.select();showToast('Select and copy the highlighted session link.');}return;}
 if(b.id==='autoSplit'){
  const people=allowedPeople(),n=Number($('teamCount').value);
  if(!Number.isInteger(n)||n<1||n>people.length){showToast(`Choose between 1 and ${people.length} teams.`);return;}
  if(people.some(p=>p.groupId)&&!window.confirm('Split the approved students again? This changes their current team assignments.'))return;
  const assign={};people.forEach((p,i)=>assign[p.id]=`Team ${(i%n)+1}`);
  perform(()=>cfg.api({action:'group',code:cfg.state.session.code,assign}),SIM.noLead?'Teams created. Use Start session below.':'Teams created. Choose each team lead, then use Start session below.');return;
 }
 if(b.id==='createTeam'){
  const name=$('newTeamName').value.trim(),id=$('newTeamMember').value;
  if(!name||!id){showToast('Enter a team name and choose its first student.');return;}
  if(TEAMS.some(t=>t.name.toLowerCase()===name.toLowerCase())){showToast('That team name is already in use.');return;}
  perform(async()=>{await cfg.api({action:'group',code:cfg.state.session.code,assign:{[id]:name}});draft.newTeamName='';draft.newTeamMember='';},'Team created.');return;
 }
 if(b.classList.contains('fw-rename')){const label=window.prompt('Team name',b.dataset.label);if(!label?.trim())return;perform(()=>cfg.api({action:'rename_team',code:cfg.state.session.code,groupId:b.dataset.gid,teamLabel:label.trim()}),'Team renamed.');return;}
 if(b.dataset.sessionControl){
  const set=b.dataset.sessionControl;if(set==='close'&&!window.confirm(cfg.state.session.mode==='team'?'Close this session? Submitted teams keep their results. Unfinished teams keep their saved decisions.':'Close this session? Students who finished keep their results.'))return;if(set==='reopen'&&!window.confirm('Reopen this session? Teams continue from their saved decisions.'))return;
  perform(async()=>{await cfg.api({action:'control',code:cfg.state.session.code,set,from:'class-page'});if(set==='start'||set==='close'){page='results';if(cfg.onPage)cfg.onPage(page);}},set==='start'?(cfg.state.session.mode==='team'?'Session started. Teams can now begin.':'Session started. Students can now begin.'):set==='close'?'Session closed. All saved team results are available.':set==='reopen'?'Session reopened. Teams continue from their saved decisions.':set==='pause'?'Session paused.':set==='resume'?'Session resumed.':(SIM.controlDone&&SIM.controlDone[set])||'Saved.');return;
 }
 if(b.id==='fw-refresh')perform(()=>cfg.refreshRoster(),'Approved student list refreshed.');
 if(b.id==='saveCal')perform(()=>{const thresholds={};root.querySelectorAll('.th').forEach(x=>thresholds[x.dataset.k]=Number(x.value));return cfg.api({action:'calibrate',code:cfg.state.session.code,thresholds});},'Session settings saved.');
 if(b.id==='export')$('export-btn').click();
 if(b.id==='print-all'){buildPrintSheet();window.print();}
});
root.addEventListener('input',event=>{if(Object.hasOwn(draft,event.target.id))draft[event.target.id]=event.target.value;});
root.addEventListener('change',event=>{
 const el=event.target;
 if(Object.hasOwn(draft,el.id))draft[el.id]=el.value;
 if(el.classList.contains('fw-lead')&&el.value)perform(()=>cfg.api({action:'set_captain',code:cfg.state.session.code,participantId:el.value}),'Team lead updated.');
 if(el.classList.contains('fw-move')&&el.value)perform(()=>cfg.api({action:'group',code:cfg.state.session.code,assign:{[el.dataset.pid]:el.value}}),'Team assignment saved.');
});
root.addEventListener('focusout',()=>{if(pendingPaint)setTimeout(()=>{renderManage();renderStart();},0);});
// Only sims with settings or notes show the panel (#52); notes are rebuilt each time it opens.
if(!SIM.advanced)$('fw-advanced').hidden=true;
$('fw-advanced').addEventListener('toggle',()=>{if($('fw-advanced').open&&(!$('fw-advanced-content').innerHTML||SIM.advancedRefresh))$('fw-advanced-content').innerHTML=cfg.advanced();});
$('compare-dialog').addEventListener('close',()=>{lastData='';update(cfg);$('compare-btn').focus();});
function update(options){
 cfg=options;const s=cfg.state.session;
 root.querySelectorAll('#fw-advanced-content .th, #fw-advanced-content #saveCal').forEach(el=>el.disabled=s.state!=='lobby'||actionBusy);
 TEAMS=recordsFrom(cfg.state);
 if(SIM.prompts)SIM.prompts(cfg.state,QUESTIONS);
 $('fw-session-name').textContent=s.name;
 sessionClosed=s.state==='closed';
 $('fw-session-state').textContent=`${s.mode==='team'?'In teams':'On their own'} · ${s.state==='lobby'?'Setting up':s.state==='closed'?'Closed':s.paused?'Paused':'Running'}`;
 const waiting=cfg.roster?.students?.filter(p=>!p.accessReleased).length||0;$('courseAccess').hidden=!cfg.courseUrl||!waiting;$('courseAccess').href=cfg.courseUrl||'#';$('courseAccess').textContent=`${waiting} student${waiting===1?'':'s'} waiting for access · open class page`;
 $('fw-refresh').hidden=!s.platformAuth||!s.courseId||!cfg.rosterError;$('fw-refresh').disabled=actionBusy;
 $('fw-refresh').textContent='Retry student list';
 $('results-title').textContent=s.mode==='team'?'Team results':'Student results';
  {const solo=s.mode!=='team';const set=(sel,t)=>{const el=root.querySelector(sel);if(el)el.lastChild.textContent=t;};set('#compare-btn',solo?'Compare students':'Compare teams');set('#all-teams-btn',solo?'All student results':'All team results');
   const h=root.querySelector('.sidebar-title h2');if(h)h.textContent=solo?'Students':'Teams';const lf=root.querySelector('.list-footer');if(lf)lf.lastChild.textContent=solo?'One response per student':'One shared response per team';
   const ch=$('compare-heading');if(ch)ch.textContent=solo?'Compare student answers':'Compare team answers';const cd=$('compare-description');if(cd)cd.textContent=solo?'The same question, every finished student.':'The same question, every submitted team.';const ts=$('team-search');if(ts)ts.placeholder=solo?'Search students…':'Search team or student…';}$('results-tab').textContent='Results';$('manage-tab').textContent=s.mode==='team'?'Teams':'Students';root.querySelector('.stat-label').textContent=s.mode==='team'?'Total teams':'Total students';root.querySelector('#results-view .subtitle').textContent=s.mode==='team'?'Every team, one shared result. Choose a team to read its responses.':'Each student has their own result. Choose a student to read their responses.';
 $('total-stat').textContent=TEAMS.length;$('submitted-stat').textContent=TEAMS.filter(t=>t.status==='submitted').length;
 $('progress-stat').textContent=TEAMS.filter(t=>t.status==='progress').length;$('waiting-stat').textContent=TEAMS.filter(t=>t.status==='waiting').length;
 $('compare-btn').disabled=completedTeams().length<2;$('export-btn').disabled=!TEAMS.length;
 const signature=JSON.stringify(TEAMS);
 if(signature!==lastData&&!$('compare-dialog').open){lastData=signature;renderAll();}
 if(!cfg.rosterError&&$('fw-error').dataset.source==='roster'){$('fw-error').hidden=true;delete $('fw-error').dataset.source;}
 if(cfg.rosterError){$('fw-error').dataset.source='roster';$('fw-error').textContent=`Student list: ${cfg.rosterError} Saved results remain available.`;$('fw-error').hidden=false;}
 paintPage();
 // Do not recreate open advanced settings, comparison selects, or debrief controls on polling.
}
return {code:cfg.state.session.code,update,show:showPage,page:()=>page,dispose(){window.removeEventListener('beforeprint',buildPrintSheet);clearTimeout(showToast.timer);}};

}
let instance=null,instanceRoot=null;
global.FacultyWorkspace={recordsFrom,show(p){if(instance)instance.show(p);},page(){return instance?instance.page():null;},render(options){let root=options.root.querySelector("#faculty-workspace");if(!root){options.root.innerHTML='<div id="faculty-workspace"></div>';root=options.root.firstElementChild;}if(instanceRoot!==root||instance?.code!==options.state.session.code){instance?.dispose();instance=create(root,options);instanceRoot=root;}instance.update(options);}};
})(typeof window!=="undefined"?window:globalThis);
