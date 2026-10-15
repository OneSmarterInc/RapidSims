/* Faculty simulation results. Data is fetched by the faculty controller; no demo data. */
(() => {
  'use strict';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label = key => String(key).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ').replace(/^./,s=>s.toUpperCase());
  const date = value => {const d=new Date(value);return value && Number.isFinite(+d)?d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Not reported';};
  const parse = value => {if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return value;}};
  // Render every saved field, including arrays, false and zero. Values are text, never HTML.
  function fields(value) {
    if (value == null) return '<span class="fr-muted">Not reported</span>';
    if (typeof value !== 'object') return `<span class="fr-text">${esc(value === '' ? '(blank)' : value)}</span>`;
    if (Array.isArray(value)) return value.length ? '<ol>'+value.map(v=>`<li>${fields(v)}</li>`).join('')+'</ol>' : '<span class="fr-muted">None reported</span>';
    return '<dl class="fr-fields">'+Object.entries(value).map(([k,v])=>`<dt>${esc(label(k))}</dt><dd>${fields(v)}</dd>`).join('')+'</dl>';
  }
  function summary(attempt) {
    const v=parse(attempt.summary);
    if(typeof v==='string' && v.trim()) return v;
    for(const item of [v?.result?.overall,v?.outcome?.summary,v?.summary,v?.overall]) if(typeof item==='string' && item.trim()) return item;
    if(v!=null || (attempt.metrics && Object.keys(attempt.metrics).length))return 'Completed · recorded decisions and results available below.';
    return 'Completed · no result details reported.';
  }
  function attemptHTML(attempt, latestId) {
    const saved=parse(attempt.summary), team=saved && typeof saved==='object' && saved.teamRunId;
    const metrics=attempt.metrics;
    return `<article class="fr-attempt"><div class="fr-attempt-meta"><b>Completion ${esc(attempt.ordinal)}</b>${attempt.id===latestId?'<span class="fr-latest">Latest</span>':''}<time>${esc(date(attempt.completed_at))}</time></div>
      <p class="fr-outcome">${esc(summary(attempt))}</p>
      <div class="fr-meta">${attempt.duration_seconds != null ? esc(Number(attempt.duration_seconds))+' seconds' : 'Duration not reported'}${team?` · ${esc(teamName(saved.teamLabel || saved.teamRunId))}${saved.completedBy?' · Submitted by '+esc(saved.completedBy):''} · Shared outcome`:''}</div>
      ${attempt.legacy_course?'<p class="fr-small">Legacy record · associated through this student’s only recorded course for this SIM.</p>':''}
      <details class="fr-attempt-details"><summary>View completion ${esc(attempt.ordinal)} details</summary><div class="fr-details">
        <h3>Reported metrics</h3>${metrics && Object.keys(metrics).length?fields(metrics):'<p class="fr-small">No metrics reported. This is not a zero score.</p>'}
        <h3>Simulation summary</h3>${saved!=null?fields(saved):'<p class="fr-small">No summary reported.</p>'}
        <div class="fr-meta">Record ${esc(attempt.id)}</div>
      </div></details></article>`;
  }
  // Class sessions, newest first. Each team shows its shared result and each member's own review.
  // Each sim's two review questions, shown above each member's answers.
  const REVIEW_QUESTIONS={'rapid-03-midland':[
    'Dale, Renata, Tom and Sam each wanted more money. Whose line got the least from you, and why?',
    'Now that you have seen Year 3, which line would you move $1M into in Year 1, and where would you take it from?']};
  let questions=[];
  function reviewHTML(m) {
    const answers=[m.reflection1,m.reflection2];
    if(!answers.some(t=>typeof t==='string'&&t.trim()))return '<p class="fr-small">Review on its way.</p>';
    return answers.map((t,i)=>typeof t==='string'&&t.trim()?`<p class="fr-review"><span class="fr-q">${esc(questions[i]||'Question '+(i+1))}</span>${esc(t)}</p>`:'').join('');
  }
  // Midland's Year 3 result names and colours, as the debrief shows them.
  const BANDS={strong:'Strong',pilot:'Pilot',middle:'Middle',data_no_room:'Data without room',weak:'Limited'};
  // A saved team label already reads "Team 1"; a bare number gets the word.
  const teamName=l=>{const x=String(l==null?'':l).replace(/^team:/,'');return /^team\b/i.test(x)?x:'Team '+x;};
  const firstSentence=t=>{const m=String(t||'').match(/^.*?[.!?](\s|$)/);return m?m[0].trim():String(t||'');};
  const when=t=>t?new Date(t).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
  // Older sessions were named after the sim; their date names them instead.
  const sessionName=(s,sim)=>{const n=String(s.name||'').trim();return !n||n===sim.title?when(s.createdAt||s.latestAt)||'Class session':n;};
  const TONE={strong:'g',pilot:'y',middle:'y',data_no_room:'o',weak:'l'};
  function resultHTML(t) {
    const band=t.bandLabel||BANDS[t.year3Band], tone=t.bandTone||TONE[t.year3Band]||'', text=t.overall||'Result saved.', short=firstSentence(text);
    return `${band?`<div class="fr-band fr-tone-${esc(tone)}">${esc(band)}</div>`:''}<p class="fr-outcome">${esc(short)}</p>${short.length<text.length?`<details class="fr-more-text"><summary>More</summary><p class="fr-outcome">${esc(text)}</p></details>`:''}`;
  }
  function sessionsHTML(sessions, sim, links) {
    if(!Array.isArray(sessions)||!sessions.length)return '';
    return `<div class="fr-section"><div><h2>Sessions</h2><p>Newest first. Click a session to see its teams, their results and each member’s review.</p></div></div>
      ${sessions.map(s=>{questions=s.questions||REVIEW_QUESTIONS[sim.id]||[];const name=sessionName(s,sim),stamp=when(s.createdAt||s.latestAt),n=s.teams.length,word=s.teams.some(t=>t.team)?'team':'student';
        return `<details class="fr-panel fr-session"><summary class="fr-session-head"><span class="fr-session-name"><b>${esc(name)}</b>${stamp&&stamp!==name?` <span class="fr-meta">${esc(stamp)}</span>`:''} · ${n} ${word}${n===1?'':'s'}</span>
          ${links?`<span class="fr-session-links"><a class="btn sm" data-fr-open="${esc(s.code)}" data-fr-tab="results" href="${esc(links(s.code,'results'))}">Results</a><a class="btn sm" data-fr-open="${esc(s.code)}" data-fr-tab="debrief" href="${esc(links(s.code,'debrief'))}">Debrief</a></span>`:''}</summary>
        <table class="fr-table fr-session-table"><caption class="fr-sr">${esc(name)} results</caption><thead><tr><th scope="col">${word==='team'?'Team':'Student'}</th><th scope="col">Result</th><th scope="col">Members and reviews</th></tr></thead><tbody>
        ${s.teams.map(t=>`<tr><td data-label="Team"><div class="fr-name">${esc(t.team?teamName(t.label):t.label)}</div>${t.completedBy?`<div class="fr-meta">Decisions entered by ${esc(t.completedBy)}</div>`:''}${t.roster?`<div class="fr-meta">${t.roster.length} member${t.roster.length===1?'':'s'}</div>`:''}</td>
          <td data-label="Result">${resultHTML(t)}</td>
          <td data-label="Members and reviews">${t.members.map(m=>`<div class="fr-member"><b>${esc(m.name)}</b> <span class="fr-meta">${esc(date(m.completedAt))}</span>${reviewHTML(m)}</div>`).join('')}</td></tr>`).join('')}
        </tbody></table></details>`;}).join('')}`;
  }
  const statuses={'completed':'Completed','started':'Started','not-started':'Not started','not-released':'Not released','removed':'Removed'};
  const badge = status => `<span class="fr-badge ${status==='completed'?'fr-ok':status==='started'?'fr-warn':''}">${statuses[status] || 'Unknown'}</span>`;
  function mount(root, data, actions) {
    const {course,sim,rows,stats}=data;
    const active=()=>root.querySelector('.faculty-results')===surface;
    const back='/faculty.html?view=course&course='+encodeURIComponent(course.id);
    questions=REVIEW_QUESTIONS[sim.id]||[];
    const sessions=Array.isArray(data.sessions)?data.sessions:[];
    root.innerHTML=`<section class="faculty-results"><div class="crumb fr-crumb"><a class="fr-back" href="${esc(back)}">${esc(course.title)}</a> › ${esc(sim.title)} › Past sessions</div>
      <header class="fr-heading"><h1>Past sessions</h1><p>Every ${esc(sim.title)} session in ${esc(course.title)}, newest first. Each student’s results are further down.</p></header>
      <div class="fr-stats fr-stats-3">${[[sessions.length,'Sessions'],[stats.students,'Students'],[stats.completed,'Finished']].map(([n,text])=>`<div><b>${esc(n)}</b><span>${text}</span></div>`).join('')}</div>
      ${data.ambiguous_legacy?'<p class="fr-notice">Some older records have no unambiguous course association and are excluded from these course results. Existing records have not been changed.</p>':''}
      ${sessionsHTML(sessions, sim, actions.sessionLink)}
      <div class="fr-section"><div><h2>Student results</h2><p>One row per account · completions stay together</p></div><button class="btn sm" id="frExpand" aria-pressed="false">Expand loaded details</button></div>
      <div class="fr-panel"><form class="fr-toolbar" id="frSearch"><label>Find a student<input name="search" type="search" maxlength="200" placeholder="Search name or email" value="${esc(data.search)}"></label>
      <label>Progress<select name="filter">${[['all','All students'],['completed','Completed'],['started','Started'],['not-started','Not started'],['not-released','Not released'],['repeated','Repeat completers'],['removed','Removed enrolments']].map(([v,l])=>`<option value="${v}" ${data.filter===v?'selected':''}>${l}</option>`).join('')}</select></label>
      <label>Sort by<select name="sort"><option value="name" ${data.sort==='name'?'selected':''}>Student name A–Z</option><option value="attempts" ${data.sort==='attempts'?'selected':''}>Most completions</option></select></label><button class="btn sm pri" type="submit">Apply</button></form>
      <table class="fr-table"><caption class="fr-sr">${esc(sim.title)} results in ${esc(course.title)}</caption><thead><tr><th scope="col">Student</th><th scope="col">Progress</th><th scope="col">Results · newest first</th></tr></thead><tbody>
      ${rows.map((r,i)=>`<tr><td data-label="Student"><div class="fr-name">${esc(r.name)}</div><div class="fr-meta fr-email">${esc(r.email)}</div><div class="fr-meta">${esc(r.student_id)}</div><p class="fr-small">${r.attempts.length?'Latest: '+esc(date(r.attempts[0].completed_at)):'No completion recorded'}</p></td>
        <td data-label="Progress">${badge(r.status)}<div class="fr-meta">${r.completions} recorded completion${r.completions===1?'':'s'} · ${r.starts} launch${r.starts===1?'':'es'}</div>${r.dropped?'<p class="fr-small">Historical results retained.</p>':''}${!r.completions&&r.starts?'<p class="fr-small">Launched, but no completion has arrived. Active play is not confirmed.</p>':''}</td>
        <td data-label="Results"><div data-fr-attempts="${i}">${r.attempts.map(a=>attemptHTML(a,r.attempts[0]?.id)).join('') || `<p class="fr-small">${r.status==='not-released'?'Waiting for course access.':r.starts?'No completed result yet.':'No completed result recorded.'}</p>`}</div>
        ${r.completions>r.attempts.length?`<button class="btn sm fr-more" data-fr-more="${i}">Show more completions (${r.completions-r.attempts.length} remaining)</button>`:''}
        ${r.transcript_count?`<details class="fr-transcripts" data-fr-transcripts="${i}"><summary>Instructor transcript history · ${r.transcript_count}</summary><p class="fr-small">Transcripts are separate records. They cannot be reliably matched to a completion; no association is inferred from their dates.</p><div data-fr-transcript-items="${i}"></div><button class="btn sm" data-fr-transcript-load="${i}">Load transcripts</button></details>`:''}
        <div class="fr-history-status" data-fr-status="${i}" aria-live="polite"></div></td></tr>`).join('') || `<tr><td colspan="3"><div class="fr-empty"><h2>${data.search||data.filter!=='all'?'No matching students':'No students enrolled yet'}</h2><p>${data.search||data.filter!=='all'?'Try another name or progress filter.':'Results will appear here as students enrol and complete this simulation.'}</p>${data.search||data.filter!=='all'?'<button id="frClear" class="btn sm">Clear filters</button>':''}</div></td></tr>`}
      </tbody></table><div class="fr-footer"><span>${data.total} student account${data.total===1?'':'s'} · Page ${data.page} of ${data.pages}</span><div><button class="btn sm" id="frPrevious" ${data.page<=1?'disabled':''}>Previous</button><button class="btn sm" id="frNext" ${data.page>=data.pages?'disabled':''}>Next</button></div></div></div>
      <p class="fr-small fr-notes">Summary counts include active students only. Removed enrolments retain their history. Dates use your browser’s local timezone. Launches and recorded completions are separate counts; callback retries may create separate completion records. No universal score is inferred.</p></section>`;
    const surface=root.querySelector('.faculty-results');
    root.querySelector('.fr-back').onclick=event=>{event.preventDefault();actions.back();};
    // Results and Debrief open that session's page in the class page, without reloading.
    root.querySelectorAll('[data-fr-open]').forEach(a=>a.onclick=event=>{if(!actions.openSession||event.metaKey||event.ctrlKey)return;event.preventDefault();event.stopPropagation();actions.openSession(a.dataset.frOpen,a.dataset.frTab);});
    const form=root.querySelector('#frSearch');
    const change = page => actions.change({search:form.elements.search.value,filter:form.elements.filter.value,sort:form.elements.sort.value,page});
    form.onsubmit=e=>{e.preventDefault();change(1);};
    root.querySelector('#frPrevious').onclick=()=>change(data.page-1);
    root.querySelector('#frNext').onclick=()=>change(data.page+1);
    root.querySelector('#frClear')?.addEventListener('click',()=>actions.change({search:'',filter:'all',sort:'name',page:1}));
    const expand=root.querySelector('#frExpand');expand.onclick=()=>{
      const open=expand.getAttribute('aria-pressed')!=='true';expand.setAttribute('aria-pressed',String(open));
      expand.textContent=open?'Collapse loaded details':'Expand loaded details';
      root.querySelectorAll('.fr-attempt-details').forEach(d=>{d.open=open;});
    };
    const states=rows.map(r=>({attemptIds:new Set(r.attempts.map(a=>a.id)),transcriptIds:new Set(),attemptCursor:r.attempts.length?btoa(JSON.stringify({at:r.attempts.at(-1).completed_at,id:r.attempts.at(-1).id})):null,transcriptCursor:null}));
    async function load(i,kind,button) {
      const r=rows[i], state=states[i], isAttempt=kind==='attempts';
      const status=root.querySelector(`[data-fr-status="${i}"]`), was=button.textContent;
      button.disabled=true;button.textContent='Loading…';status.textContent='';
      try {
        const response=await actions.history({studentId:r.student_id,kind,cursor:isAttempt?state.attemptCursor:state.transcriptCursor});
        if(!active())return;
        const target=root.querySelector(isAttempt?`[data-fr-attempts="${i}"]`:`[data-fr-transcript-items="${i}"]`);
        const ids=isAttempt?state.attemptIds:state.transcriptIds;
        for(const item of response.items) {
          if(ids.has(item.id))continue;ids.add(item.id);
          const html=isAttempt?attemptHTML(item,r.attempts[0]?.id):`<details class="fr-transcript-record"><summary>Transcript ${esc(item.ordinal)} · ${esc(date(item.recorded_at))}</summary><div class="fr-details"><div class="fr-meta">Version ${esc(item.sim_version || 'not reported')} · Record ${esc(item.id)}</div>${item.legacy_course?'<p class="fr-small">Legacy course association.</p>':''}${fields(item.envelope)}</div></details>`;
          target.insertAdjacentHTML('beforeend',html);
        }
        if(isAttempt){state.attemptCursor=response.next;if(expand.getAttribute('aria-pressed')==='true')target.querySelectorAll('.fr-attempt-details').forEach(d=>d.open=true);}
        else state.transcriptCursor=response.next;
        button.hidden=!response.next;button.textContent=isAttempt?'Show more completions':'Load more transcripts';
        status.textContent=`${response.items.length} ${isAttempt?'completion':'transcript'} records loaded.`;
      }catch(e){if(e.stale||!active())return;status.textContent='History could not be loaded. Your results are unchanged. Try again.';button.textContent=was;}
      finally{button.disabled=false;}
    }
    root.querySelectorAll('[data-fr-more]').forEach(b=>b.onclick=()=>load(Number(b.dataset.frMore),'attempts',b));
    root.querySelectorAll('[data-fr-transcript-load]').forEach(b=>b.onclick=()=>load(Number(b.dataset.frTranscriptLoad),'transcripts',b));
  }
  window.FacultyResults={mount};
})();
