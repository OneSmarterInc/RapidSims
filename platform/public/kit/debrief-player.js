/* RapidSims debrief player, shared by every sim (template: claude/RapidSims-Faculty-Template.md).
   DebriefPlayer.mount(root, getInput, { model, body, onEnd }):
   model(input) returns { ready, submitted, total, unit, units, lessons, slides:[{ key, kicker, headline, sub, body, note, ask, lesson, evidence }] };
   body(slide, ui) returns that slide's body HTML; ui.pick holds any choice made with a select[data-md-pick]. Slides stay dark for the projector. */
(function (global) {
'use strict';
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;

function slideHTML(m, s, i, ui, body) {
  const lesson = s.lesson != null ? m.lessons[s.lesson] : null;
  const revealed = lesson && ui.revealed[s.key];
  const last = i === m.slides.length - 1;
  const extraBtn = s.key === 'said' ? `<button type="button" class="md-btn" data-md="reviews">${ui.allReviews ? 'First review only' : 'All reviews'}</button>` : '';
  return `<section class="md-slide" aria-roledescription="slide" aria-label="${i + 1} of ${m.slides.length}">
  <div class="md-top"><span class="md-kicker">${esc(s.kicker)}</span><div class="md-tools"><span class="md-count">${m.submitted < m.total ? `${m.submitted} of ${m.total} ${m.units} submitted · ` : ''}${i + 1} / ${m.slides.length}</span></div></div>
  <div class="md-headwrap"><div class="md-head" role="heading" aria-level="2">${s.headline}</div>${s.sub ? `<div class="md-sub">${s.sub}</div>` : ''}</div>
  <div class="md-main${revealed ? ' md-with-lesson' : ''}"><div class="md-body">${body(s, { ...ui, unit: m.unit, unitTitle: cap1(m.unit) })}${s.note ? `<p class="md-note">${s.note}</p>` : ''}</div>
  ${revealed ? `<div class="md-lesson"><span class="md-k amber">Lesson ${s.lesson + 1}</span><b>${esc(lesson.head)}</b><p>${esc(lesson.text)}</p><p class="md-lev">In this class: ${s.evidence}</p></div>` : ''}</div>
  <div class="md-foot">${s.ask ? `<div class="md-ask"><span>Ask the class</span><p>${s.ask}</p></div>` : `<div class="md-ask md-closing-ask"><p>${esc(s.body.closing || '')}</p></div>`}
  ${lesson ? `<button type="button" class="md-btn${revealed ? '' : ' md-amber'}" data-md="lesson">${revealed ? 'Hide lesson' : 'Show lesson'}</button>` : ''}${extraBtn}
  <button type="button" class="md-btn" data-md="prev" ${i === 0 ? 'disabled' : ''} aria-label="Previous slide">←</button>${last ? '<button type="button" class="md-btn md-light" data-md="end">End debrief</button>' : '<button type="button" class="md-btn md-pri" data-md="next">Next →</button>'}</div></section>`;
}

// One debrief per root. getInput() returns the latest session data; UI state survives polling.
// opts.model(input) builds the slides; opts.body(slide, ui) draws a slide's body; opts.onEnd() runs on End debrief.
function mount(root, getInput, opts) {
  if (root._md) { root._md.opts = { ...root._md.opts, ...(opts || {}) }; root._md.refresh(); return root._md; }
  const ui = { index: 0, anonymous: false, revealed: {}, allReviews: false, hidden: {}, pick: {} };
  let last = '', slides = [];
  const api = { refresh: () => paint(false), ui, opts: opts || {} };
  function paint(force) {
    const m = api.opts.model({ ...getInput(), anonymous: ui.anonymous });
    const sig = JSON.stringify([m, ui]);
    if (!force && sig === last) return;
    last = sig; slides = m.slides;
    if (!m.ready) {
      root.innerHTML = `<div class="md-empty"><h2>The debrief fills in as ${m.units} submit.</h2><p>${m.total ? `${m.submitted} of ${m.total} ${m.units} have submitted so far.` : `No ${m.units} yet.`} Each slide is written from this session’s own results.</p></div>`;
      return;
    }
    ui.index = Math.min(ui.index, m.slides.length - 1);
    root.innerHTML = `<div class="md-bar"><div class="md-dots" role="tablist" aria-label="Debrief slides">${m.slides.map((s, i) => `<button type="button" role="tab" aria-selected="${i === ui.index}" data-md-go="${i}" title="${esc(s.kicker)}">${i + 1}</button>`).join('')}</div>
      <div class="md-bar-actions"><button type="button" class="md-btn" data-md="anon" aria-pressed="${ui.anonymous}">${ui.anonymous ? 'Anonymous · show names' : `${cap1(m.unit || 'team')} names · hide names`}</button><button type="button" class="md-btn md-pri" data-md="present">Present</button></div></div>
      <div class="md-stage" tabindex="0">${slideHTML(m, m.slides[ui.index], ui.index, ui, api.opts.body)}</div>`;
  }
  function go(i) {
    ui.index = Math.max(0, Math.min(slides.length - 1, i)); paint(true);
    // Keep the whole slide in view below the page's top bar.
    if (!document.fullscreenElement && !root.classList.contains('md-presenting') && root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: 'start' });
  }
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || !root.contains(b)) return;
    if (b.dataset.mdGo) return go(Number(b.dataset.mdGo));
    if (b.dataset.mdHide) { ui.hidden[b.dataset.mdHide] = true; return paint(true); }
    const a = b.dataset.md;
    if (a === 'next') return go(ui.index + 1);
    if (a === 'prev') return go(ui.index - 1);
    if (a === 'anon') { ui.anonymous = !ui.anonymous; return paint(true); }
    if (a === 'reviews') { ui.allReviews = !ui.allReviews; return paint(true); }
    if (a === 'unhide') { ui.hidden = {}; return paint(true); }
    if (a === 'lesson') { const k = slides[ui.index] && slides[ui.index].key; if (k) ui.revealed[k] = !ui.revealed[k]; return paint(true); }
    if (a === 'end') {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
      root.classList.remove('md-presenting');
      if (api.opts.onEnd) api.opts.onEnd();
      return;
    }
    if (a === 'present') {
      if (document.fullscreenElement) document.exitFullscreen && document.exitFullscreen();
      else if (root.requestFullscreen) root.requestFullscreen().then(() => { const st = root.querySelector('.md-stage'); if (st) st.focus(); }).catch(() => root.classList.toggle('md-presenting'));
      else root.classList.toggle('md-presenting');
    }
  });
  // A slide may offer a choice (a select with data-md-pick="name"); the choice survives polling.
  root.addEventListener('change', e => {
    const k = e.target && e.target.dataset && e.target.dataset.mdPick;
    if (k) { ui.pick[k] = e.target.value; paint(true); }
  });
  // Arrow keys move slides while the debrief has focus, so typing elsewhere on the page is untouched.
  root.addEventListener('keydown', e => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(ui.index + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(ui.index - 1); }
    if (e.key === 'Escape') root.classList.remove('md-presenting');
  });
  root._md = api;
  paint(true);
  return api;
}

const DebriefPlayer = { mount, esc };
if (typeof module !== 'undefined' && module.exports) module.exports = DebriefPlayer;
global.DebriefPlayer = DebriefPlayer;
})(typeof window !== 'undefined' ? window : globalThis);
