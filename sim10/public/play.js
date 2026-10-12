'use strict';
const params = new URLSearchParams(location.search);
const CODE = (params.get('code') || '').toUpperCase();
const PID = sessionStorage.getItem(participantKey(CODE));
if (!CODE || !PID) location.replace(CODE ? `./?session=${encodeURIComponent(CODE)}` : './');

let view = null;          // last state from the server
let skew = 0;             // server clock minus local clock
let packCase = null;      // case whose pack is on screen
let dockKey = null;       // phase/mode signature of the dock as built
let phaseStart = null;    // for the progress track
let revealKey = null;
let dockMin = false;
let draftQueue = null;
const queues = new Map();
let draftEpoch = 0;
let connected = true;
let committing = false;
const headers = { 'X-Pid': PID };
let polling = false;
$('#solo-next').addEventListener('click', async () => {
  const button = $('#solo-next');
  if (button.disabled || !view?.nextPart) return;
  button.disabled = true;
  try {
    await api('POST', 'api/solo/advance', { code: CODE, caseId: view.caseId, stage: view.soloStage }, headers);
    await poll();
  } catch (e) { $('#err').textContent = e.message; }
  finally { button.disabled = false; }
});

// ---------- polling and clock ----------
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const epoch = draftEpoch;
    const v = await api('GET', `api/state?code=${encodeURIComponent(CODE)}`, null, headers);
    skew = v.serverNow - Date.now();
    if (epoch !== draftEpoch && view?.caseId === v.caseId) { v.mine = view.mine; v.teamDraft = view.teamDraft; }
    connected = true; clearRecovery();
    render(v);
    $('#err').textContent = '';
  } catch (e) {
    connected = false; showRecovery(e); updateSaveStatus();
    if (e.status === 401) { $('#err').textContent = 'Sign-in expired. Reopen this simulation from your courses.'; return; }
    if (e.status === 403 || e.status === 404) {
      sessionStorage.removeItem(participantKey(CODE));
      let saved = null; try { saved = JSON.parse(sessionStorage.getItem(soloKey()) || 'null'); } catch {}
      if (saved?.code === CODE) { sessionStorage.removeItem(soloKey()); location.href = './'; }
      else location.href = `./?session=${encodeURIComponent(CODE)}`;
      return;
    }
    $('#err').textContent = 'Connection lost. Retrying…';
  } finally { polling = false; }
}
setInterval(poll, 2500);
poll();

function updateClock() {
  if (!view || !view.endsAt || view.phase === 'closed') { $('#time').textContent = ''; return; }
  const left = view.endsAt - (Date.now() + skew);
  $('#time').textContent = clockText(left);
  $('#time').classList.toggle('low', left < 60000);
  if (phaseStart && view.endsAt > phaseStart) {
    const progress = Math.max(0, Math.min(100, 100 * (1 - left / (view.endsAt - phaseStart))));
    $('#track').style.width = `${progress}%`;
    $('.track').setAttribute('aria-valuenow', String(Math.round(progress)));
  }
  if (left > 0 && left < 1500 && draftQueue?.unsettled && !draftQueue.error) draftQueue.flush().catch(() => {});
  if (left <= 0) poll();
}
setInterval(updateClock, 500);

// ---------- render ----------
function render(v) {
  const phaseChanged = !view || view.phase !== v.phase || view.caseId !== v.caseId;
  if (phaseChanged) phaseStart = v.startsAt;
  if (phaseChanged) { draftQueue?.pause(); $('#commit-dialog').close(); }
  view = v;
  prepareQueue(v);
  $('#solo-next').hidden = !v.solo || !v.nextPart;
  $('#solo-next').textContent = v.nextPart || 'Show next part';
  $('#solo-done').hidden = !(v.caseId === v.cases[v.cases.length - 1] && v.reveal?.stage >= 3);
  const nth = v.cases.indexOf(v.caseId) + 1;
  $('#case-label').textContent = v.cases.length > 1 ? `Company ${nth} of ${v.cases.length}` : 'Company 1';
  $('#phase-label').textContent = v.phase === 'read' ? `${PHASE_NAMES.read}: ${v.mode === 'team' ? 'private calls' : 'calls'} open when it ends` : (v.reveal?.stage >= 3 ? 'Review complete' : PHASE_NAMES[v.phase]);

  $('#waiting').hidden = v.phase !== 'waiting';
  $('#waiting-team').textContent = v.team ? `You're in Team ${v.team}.` : '';
  $('#pack-wrap').hidden = v.phase === 'waiting';
  if (v.phase === 'waiting') { $('#dock').hidden = true; $('#result').hidden = true; $('#reveal').hidden = true; return; }

  if (packCase !== v.caseId) {
    renderPack(v.pack); packCase = v.caseId; dockKey = null; revealKey = null; dockMin = false;
    $('#pack-wrap').open = true; $('#result').innerHTML = ''; $('#reveal').innerHTML = '';
    window.scrollTo(0, 0);
  }

  const closed = v.phase === 'closed';
  if (closed) { $('#track').style.width = '100%'; $('.track').setAttribute('aria-valuenow', '100'); }
  $('#pack-summary').hidden = !closed;
  if (closed && phaseChanged) $('#pack-wrap').open = false;
  renderResult(v);
  renderReveal(v);
  renderDock(v);
  $('#workspace').classList.toggle('no-answer', $('#dock').hidden);
  $('#workspace-links').hidden = $('#dock').hidden;
  showUnsaved();
  updateClock();
  maybeFinish(v);
  document.body.classList.toggle('citing', canCite(v));
  markCited(currentLine(v));
}

function canCite(v) {
  if (v.mode === 'individual') return v.phase === 'verdict';
  return v.phase === 'team' && !v.teamCommitted;
}
function currentLine(v) {
  if (canCite(v) && $('#f-line')) return $('#f-line').value;
  if (v.result && v.result.line) return v.result.line;
  if (v.mode === 'individual') return (v.mine && v.mine.line) || null;
  if (v.teamCommitted) return v.teamCommitted.line;
  return (v.teamDraft && v.teamDraft.line) || null;
}

function renderPack(pack) {
  const g = pack.glossary;
  wireGlossaryOnce(g);
  $('#briefing').innerHTML = `<div class="briefing"><p>${esc(pack.briefing[0])}</p><details><summary>Read the full brief</summary>${pack.briefing.slice(1).map((p) => `<p>${esc(p)}</p>`).join('')}</details>
    <div class="gloss"><span class="muted">Tap a term for its meaning:</span> ${Object.keys(g).map((t) => `<button type="button" class="term" data-term="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`;
  const qh = pack.quarters.map((q) => `<th scope="col">${esc(q)}</th>`).join('');
  const rowHtml = (r, cls = '') => `<tr class="line ${cls}" data-tag="${esc(r.tag)}" tabindex="0" aria-label="Cite: ${esc(r.label)}"><td>${withTerms(r.label, g)}</td>${r.values.map((v, i) => `<td class="v">${esc(v)}${r.periods ? `<small>${esc(r.periods[i])}</small>` : ''}</td>`).join('')}</tr>`
    + (r.note ? `<tr class="note"><td colspan="3">${withTerms(r.note, g)}</td></tr>` : '');
  $('#doc').innerHTML = pack.sections.map((s) => {
    let html = `<section><h2>${esc(s.title)}</h2>`;
    if (s.blocks.length) {
      html += `<div class="scroll"><table class="fig"><thead><tr><th scope="col">Line</th>${qh}</tr></thead><tbody>`;
      for (const b of s.blocks) {
        if (b.kind === 'row') html += rowHtml(b.row);
        else html += rowHtml(b.rows[0], 'pair-first') + rowHtml(b.rows[1]) + (b.note ? `<tr class="note"><td colspan="3">${withTerms(b.note, g)}</td></tr>` : '');
      }
      html += '</tbody></table></div>';
    }
    if (s.statements) html += `<div class="statements"><h3>What management said</h3>${s.statements.map((t) => `<p class="textline" tabindex="0" data-tag="${esc(t.tag)}">${withTerms(t.text, g)}</p>`).join('')}</div>`;
    if (s.text) html += `<div class="textlines">${s.text.map((t) => `<p class="textline" tabindex="0" data-tag="${esc(t.tag)}">${withTerms(t.text, g)}</p>`).join('')}</div>`;
    return html + '</section>';
  }).join('');
}

let glossWired = false;
function wireGlossaryOnce(g) { if (!glossWired) { wireGlossary(g); glossWired = true; } }

// Tap a line in the pack to cite it.
document.addEventListener('click', (e) => {
  if (!view || !canCite(view) || e.target.closest('.term')) return;
  const el = e.target.closest('[data-tag]');
  if (!el || !$('#doc').contains(el)) return;
  if (dockMin) { dockMin = false; $('#dock-body').hidden = false; $('#dock-toggle').textContent = 'Hide'; }
  const sel = $('#f-line');
  if (!sel) return;
  sel.value = el.dataset.tag;
  sel.dispatchEvent(new Event('change'));
});

document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-tag]') && canCite(view)) {
    e.preventDefault(); e.target.click();
  }
});

function markCited(tag) {
  document.querySelectorAll('#doc .cited').forEach((el) => el.classList.remove('cited'));
  if (tag) document.querySelectorAll(`#doc [data-tag="${CSS.escape(tag)}"]`).forEach((el) => el.classList.add('cited'));
}

// ---------- dock ----------
function pickerHtml(pack, value) {
  const groups = {};
  for (const p of pack.picker) (groups[p.section] ||= []).push(p);
  return `<select id="f-line"><option value="">Choose the line that drove your call</option>${Object.entries(groups).map(([sec, items]) =>
    `<optgroup label="${esc(sec)}">${items.map((p) => `<option value="${esc(p.tag)}"${p.tag === value ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</optgroup>`).join('')}</select>`;
}

function formHtml(v, data, opts) {
  const r = v.rules;
  return `
    <div class="calls" role="group" aria-label="Your call">
      ${['infra', 'bubble'].map((c) => `<button type="button" class="call" data-call="${c}" aria-pressed="${data.call === c}">${CALL_NAMES[c]}</button>`).join('')}
    </div>
    <div class="field"><label for="f-line">Which line drove your call? You can also tap a line in the figures.</label>${pickerHtml(v.pack, data.line)}</div>
    <div class="field"><label for="f-why">In one sentence, why that line?</label>
      <textarea id="f-why" rows="2" maxlength="400" aria-describedby="reason-count">${esc(data.lineWhy || '')}</textarea><span class="count" id="reason-count"></span></div>
    <div class="field"><label for="f-mind">What would you have needed to see to make the opposite call?</label>
      <textarea id="f-mind" maxlength="2000" aria-describedby="mind-count">${esc(data.mind || '')}</textarea>
      <span class="count" id="mind-count"></span></div>
    <p class="saved" id="saved" role="status"></p><button type="button" class="btn quiet" id="retry-save" hidden>Retry saving</button>
    <p class="validation" id="validation"></p>
    <button type="button" class="btn" id="commit">${opts.commit ? 'Review & commit team answer' : 'Review saved answer'}</button>
    <p class="helper">${opts.commit ? 'Anyone on your team can commit. A committed answer cannot be changed.' : 'Your saved answer is recorded when the timer ends. You can edit it until then.'}</p>`;
}

function renderDock(v) {
  const dock = $('#dock'), inner = $('#dock-inner');
  let key; let body = ''; let title = '';
  if (v.phase === 'closed') { dock.hidden = true; dockKey = null; return; }
  if (v.phase === 'read') { dock.hidden = true; dockKey = null; return; }
  if (v.phase === 'verdict') {
    key = 'verdict'; title = 'Your call';
    body = formHtml(v, { ...(v.mine || {}), ...draftQueue?.dirty }, {});
  } else if (v.phase === 'private') {
    key = 'private'; title = 'Your private call';
    body = `<p class="muted">Only you see this. Your team agrees one call next.</p>
      <div class="calls">${['infra', 'bubble'].map((c) => `<button type="button" class="call" data-private="${c}" aria-pressed="${(draftQueue?.dirty.private || v.mine.private) === c}">${CALL_NAMES[c]}</button>`).join('')}</div><p id="saved" class="saved" role="status"></p><button id="retry-save" type="button" class="btn quiet" hidden>Retry saving</button>`;
  } else if (v.phase === 'team') {
    if (v.teamCommitted) {
      key = 'team:committed'; title = 'Your team\u2019s call is committed';
      body = `<p>${esc(CALL_NAMES[v.teamCommitted.call])}</p>`;
    } else {
      key = 'team:draft'; title = `Team ${v.team}: agree one call`;
      body = formHtml(v, { ...(v.teamDraft || {}), ...draftQueue?.dirty }, { commit: true });
    }
  }
  dock.hidden = false;
  if (key !== dockKey) {
    inner.innerHTML = `<div class="dock-head"><h2>${esc(title)}</h2><button type="button" class="btn quiet" id="dock-toggle">${dockMin ? 'Show' : 'Hide'}</button></div><div id="dock-body"${dockMin ? ' hidden' : ''}>${body}</div>`;
    dockKey = key;
    wireDock(v);
  } else if (canCite(v)) {
    syncDraft(v.mode === 'team' ? (v.teamDraft || {}) : (v.mine || {}));
  } else if (v.phase === 'private') {
    document.querySelectorAll('[data-private]').forEach(b => b.setAttribute('aria-pressed', String((draftQueue?.dirty.private || v.mine.private) === b.dataset.private)));
  }
  updateMindCount(); updateSaveStatus();
}

function syncDraft(d) {
  // Teammates' edits flow in, except into the field this person is typing in.
  const active = document.activeElement;
  document.querySelectorAll('.call[data-call]').forEach((b) => b.setAttribute('aria-pressed', String((draftQueue?.dirty.call || d.call) === b.dataset.call)));
  const set = (id, val) => { const el = $(id); if (el && el !== active && !Object.hasOwn(draftQueue?.dirty || {}, ({ '#f-line': 'line', '#f-why': 'lineWhy', '#f-mind': 'mind' })[id]) && el.value !== (val || '')) el.value = val || ''; };
  set('#f-line', d.line); set('#f-why', d.lineWhy); set('#f-mind', d.mind);
}

function prepareQueue(v) {
  if (!['verdict', 'team', 'private'].includes(v.phase) || v.teamCommitted) { draftQueue?.pause(); if (v.teamCommitted) $('#commit-dialog').close(); return; }
  const key = `${v.caseId}:${v.phase}`;
  if (!queues.has(key)) {
    const storageKey = `s10-draft:${CODE}:${PID}:${key}`;
    let initial = {}; try { initial = JSON.parse(sessionStorage.getItem(storageKey) || '{}'); } catch {}
    const path = v.phase === 'private' ? 'api/private' : v.mode === 'team' ? 'api/team/draft' : 'api/verdict';
    const queue = new DraftQueue({ initial,
      write: async fields => {
        draftEpoch++;
        const body = { code: CODE, caseId: v.caseId, ...(v.phase === 'private' ? { call: fields.private } : { fields }) };
        try {
          const rec = await api('POST', path, body, headers);
          draftEpoch++;
          if (view?.caseId === v.caseId) {
            if (v.phase === 'team') view.teamDraft = rec; else view.mine = rec;
          }
          connected = true; clearRecovery();
        } catch (e) { if (e.status === 401 || !e.status) { connected = false; showRecovery(e); } throw e; }
      },
      changed: () => {
        try { if (Object.keys(queue.dirty).length) sessionStorage.setItem(storageKey, JSON.stringify(queue.dirty)); else sessionStorage.removeItem(storageKey); } catch {}
        if (draftQueue === queue) updateSaveStatus();
        showUnsaved();
      }
    });
    queues.set(key, queue);
  }
  const next = queues.get(key), changed = draftQueue !== next;
  draftQueue = next;
  if (changed && Object.keys(next.dirty).length) next.flush().catch(() => {});
}
function showUnsaved() {
  if (!view) return;
  const editableKey = canCite(view) || view.phase === 'private' ? `${view.caseId}:${view.phase}` : null;
  const ended = [...queues.entries()].filter(([key, q]) => q.unsettled && key !== editableKey);
  for (const cs of view.cases) for (const phase of ['verdict', 'team', 'private']) {
    const key = `${cs}:${phase}`;
    if (key === editableKey || queues.has(key)) continue;
    try {
      const dirty = JSON.parse(sessionStorage.getItem(`s10-draft:${CODE}:${PID}:${key}`) || '{}');
      if (Object.keys(dirty).length) ended.push([key, { dirty }]);
    } catch {}
  }
  $('#unsaved-warning').hidden = !ended.length;
  $('#unsaved-copy').hidden = !ended.length;
  if (ended.length) {
    $('#unsaved-warning').textContent = 'Some changes were not saved before the answer was locked. They are not part of your recorded answer. You can copy them below.';
    $('#unsaved-text').textContent = ended.map(([key, q]) => `${key}\n${Object.entries(q.dirty).map(([k, val]) => `${k}: ${val}`).join('\n')}`).join('\n\n');
  }
}
function formFields() {
  return { call: $('.call[data-call][aria-pressed="true"]')?.dataset.call || '', line: $('#f-line')?.value || '', lineWhy: $('#f-why')?.value || '', mind: $('#f-mind')?.value || '' };
}
function missingFields(d) {
  const missing = [];
  if (!d.call) missing.push('choose a call');
  if (!d.line) missing.push('cite a line');
  if (d.lineWhy.trim().length < view.rules.minReason) missing.push('complete your reason');
  if (d.mind.trim().length < view.rules.minMind) missing.push('explain what would change your mind');
  return missing;
}
function updateMindCount() {
  for (const [id, count, need] of [['#f-mind', '#mind-count', view?.rules.minMind], ['#f-why', '#reason-count', view?.rules.minReason]]) {
    const el = $(id), counter = $(count); if (!el || !counter) continue;
    const n = el.value.trim().length;
    counter.textContent = `${n}/${need} minimum characters${n >= need ? ' · requirement met' : ''}`;
    counter.classList.toggle('ok', n >= need);
  }
}
function updateSaveStatus() {
  if (!view) return;
  updateMindCount();
  const q = draftQueue, status = $('#saved');
  if (status && q) {
    status.className = 'saved' + (q.error ? ' error' : q.unsettled ? ' pending' : '');
    status.textContent = q.error ? `Changes not saved. ${q.error.message}` : q.unsettled ? 'Saving latest changes…' : (view.phase === 'private' ? view.mine?.private : (view.mode === 'team' ? view.teamDraft?.call : view.mine?.call)) ? 'All changes saved.' : 'Your changes save automatically.';
  }
  if ($('#retry-save')) $('#retry-save').hidden = !q?.error;
  const button = $('#commit');
  if (button) {
    const missing = missingFields(formFields());
    $('#validation').textContent = missing.length ? `To finish: ${missing.join(', ')}.` : 'Your answer is complete.';
    button.disabled = committing || !connected || !!q?.unsettled || !!q?.error || missing.length > 0;
  }
}
function wireDock() {
  $('#dock-toggle').onclick = () => {
    dockMin = !dockMin; $('#dock-body').hidden = dockMin;
    $('#dock-toggle').textContent = dockMin ? 'Show' : 'Hide';
    $('#dock-toggle').setAttribute('aria-expanded', String(!dockMin));
  };
  for (const [id, field] of [['#f-why', 'lineWhy'], ['#f-mind', 'mind'], ['#f-line', 'line']]) {
    const el = $(id); if (!el) continue;
    el.addEventListener(id === '#f-line' ? 'change' : 'input', () => {
      draftEpoch++; draftQueue.edit({ [field]: field === 'line' ? (el.value || null) : el.value });
      if (id === '#f-line') markCited(el.value);
    });
    el.addEventListener('blur', () => draftQueue.flush().catch(() => {}));
  }
  document.querySelectorAll('.call[data-call]').forEach(b => b.onclick = () => {
    document.querySelectorAll('.call[data-call]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    draftEpoch++; draftQueue.edit({ call: b.dataset.call });
  });
  document.querySelectorAll('.call[data-private]').forEach(b => b.onclick = () => {
    document.querySelectorAll('.call[data-private]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    draftEpoch++; draftQueue.edit({ private: b.dataset.private });
  });
  if ($('#retry-save')) $('#retry-save').onclick = () => draftQueue.flush().catch(() => {});
  if ($('#commit')) $('#commit').onclick = reviewAnswer;
}
async function reviewAnswer() {
  if (committing || !canCite(view)) return;
  try {
    await draftQueue.flush();
    const expected = formFields();
    if (missingFields(expected).length || !connected) { updateSaveStatus(); return; }
    const team = view.mode === 'team', caseId = view.caseId;
    $('#commit-title').textContent = team ? 'Commit your team’s answer?' : 'Your saved answer';
    $('#commit-summary').innerHTML = `<p><b>${esc(CALL_NAMES[expected.call])}</b></p><p>${esc(view.pack.picker.find(p => p.tag === expected.line)?.label)}</p><p>${esc(expected.lineWhy)}</p><p>${esc(expected.mind)}</p><p class="muted">${team ? 'This is the final team answer. It cannot be changed after commitment.' : 'You can edit this answer until the timer ends.'}</p>`;
    const confirm = $('#commit-confirm'); confirm.textContent = team ? 'Commit final answer' : 'Done'; confirm.disabled = false;
    confirm.onclick = async () => {
      if (!team) { $('#commit-dialog').close(); return; }
      if (committing) return;
      committing = true; confirm.disabled = true; updateSaveStatus();
      try {
        await draftQueue.flush();
        if (!connected || view.caseId !== caseId || !canCite(view)) throw new Error('The decision window has ended.');
        await api('POST', 'api/team/commit', { code: CODE, caseId, expected }, headers);
        $('#commit-dialog').close(); await poll();
      } catch (e) { $('#commit-dialog').close(); $('#err').textContent = e.message; if (e.status === 401) showRecovery(e); }
      finally { committing = false; confirm.disabled = false; updateSaveStatus(); }
    };
    $('#commit-dialog').showModal(); $('#commit-cancel').focus();
  } catch { updateSaveStatus(); }
}
$('#commit-cancel').onclick = () => $('#commit-dialog').close();
window.addEventListener('beforeunload', e => {
  if ([...queues.values()].some(q => q.unsettled)) { e.preventDefault(); e.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && draftQueue && (canCite(view) || view.phase === 'private')) draftQueue.flush().catch(() => {});
});
configureChrome();

// ---------- result and reveal ----------
function renderResult(v) {
  const el = $('#result');
  if (v.phase !== 'closed' || !v.result) { el.hidden = true; return; }
  const r = v.result; const who = v.mode === 'team' ? 'Your team\u2019s' : 'Your';
  const label = (tag) => (v.pack.picker.find((p) => p.tag === tag) || {}).label || tag;
  let html = '<div class="panel">';
  if (r.status === 'no_verdict') {
    html += `<h2>No verdict recorded</h2><p>${v.mode === 'team' ? 'Your team did not commit a call before the clock ran out.' : 'The clock ran out before a call was made.'}</p>`;
  } else {
    const blank = (b, text) => (r.blanks.includes(b) ? `<span class="blank">${text}</span>` : null);
    html += `<h2>${who} call: ${esc(CALL_NAMES[r.call])}</h2>
      <p><b>Line:</b> ${r.line ? esc(label(r.line)) : blank('line', 'left blank')}</p>
      <p><b>Why:</b> ${blank('reason', r.lineWhy ? `too short: \u201c${esc(r.lineWhy)}\u201d` : 'left blank') || esc(r.lineWhy)}</p>
      <p><b>What would have changed ${v.mode === 'team' ? 'your' : 'your'} mind:</b> ${blank('mind', r.mind ? `too short: \u201c${esc(r.mind)}\u201d` : 'left blank') || esc(r.mind)}</p>`;
  }
  if (!v.reveal) html += '<p class="muted">Your host will lead the discussion, then reveal what happened.</p>';
  html += '</div>';
  if (el.innerHTML !== html) el.innerHTML = html;
  el.hidden = false;
}

function shortPeriod(s) {
  const m = String(s).match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  return m ? `${m[2].slice(0, 3)} ${m[3]}` : s;
}

function renderReveal(v) {
  const el = $('#reveal');
  const r = v.reveal;
  if (!r) { el.hidden = true; return; }
  const key = `${v.caseId}:${r.stage}`;
  if (key === revealKey) return;
  revealKey = key;
  let html = `<div class="panel"><p class="muted">The company was</p><p class="reveal-name">${esc(r.identity.name)}</p>
    <p class="reveal-period">${esc(r.identity.period)}</p><p>${esc(r.identity.asset)}</p></div>`;
  if (r.table) {
    const t = r.table;
    const row = (x) => `<tr class="${x.yours ? 'yours' : ''}"><td>${esc(x.label)}${x.yours ? ' <span class="muted">(your line)</span>' : ''}</td>${x.values.map((val) => `<td class="v">${esc(val)}</td>`).join('')}</tr>`;
    html += `<section class="panel"><h2>The next four quarters</h2><p class="muted">${esc(t.unitNote)} The first two columns are the quarters you read, now unscaled.</p>
      <p class="helper">Scroll horizontally to compare all quarters. The line names stay visible.</p><div class="scroll" tabindex="0" role="region" aria-label="Financial results across quarters"><table class="fig"><thead><tr><th scope="col">Line</th>${t.quarters.map((q, i) => `<th scope="col" class="${i < 2 ? 'seen' : ''}">${esc(shortPeriod(q))}${i < 2 ? '<br>(you read)' : ''}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map(row).join('')}${t.extra ? row(t.extra) + `<tr class="note"><td colspan="7">${esc(t.extra.note)}</td></tr>` : ''}</tbody></table></div>
      <h3>What the company reported along the way</h3><ul class="facts">${r.facts.map((f) => `<li><span class="mono muted">${esc(shortPeriod(f.period))}</span> ${esc(f.text)}</li>`).join('')}</ul>
      <div class="basis">${t.basis.map((b) => `<p>${esc(b)}</p>`).join('')}</div></section>`;
  }
  if (r.outcome) {
    html += `<section class="panel"><h2>What happened</h2><ul class="outcome">${r.outcome.map((o) => `<li>${esc(o.text)}${o.secondary ? ' <span class="muted">(from a secondary source)</span>' : ''}</li>`).join('')}</ul></section>`;
  }
  el.innerHTML = html;
  el.hidden = false;
}

// Tell RapidSims this person finished, once the last company's outcome is shown.
let finishSent = false;
function maybeFinish(v) {
  const last = v.cases[v.cases.length - 1];
  if (finishSent || !launchToken() || v.caseId !== last || !v.reveal || v.reveal.stage < 3) return;
  finishSent = true;
  api('POST', 'api/finish', { code: CODE }, headers)
    .then(r => { finishSent = !!r.reported; $('#completion-status').textContent = r.reported ? 'Your answers are recorded and progress is updated.' : 'Your answers are recorded. Progress is still syncing; keep this tab open.'; })
    .catch(() => { finishSent = false; $('#completion-status').textContent = 'Your answers are recorded. Progress has not synced yet; retrying.'; });
}
