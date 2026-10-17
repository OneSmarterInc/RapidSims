/* Ask Claude: the faculty helper panel, on every faculty page. Answers come from the platform (/api/faculty, actions
   assist_status and assist). On a sim's pages it answers about that sim (with its open session, students shown to
   Claude as "Student 1, 2, 3" and their names put back here). Elsewhere it answers about the class and RapidSims.
   Use: AssistPanel.mount({ context: () => ({ simId, courseId, sessionCode }) | null }) and call .update() when the
   page changes. A null context hides the panel. */
(function (global) {
'use strict';
const API = '/api/faculty';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The panel's own styles, from beside this script (same version).
(function addStyles() {
  if (typeof document === 'undefined' || document.getElementById('assist-panel-css')) return;
  const me = document.currentScript || [...document.scripts].find(x => /assist-panel\.js/.test(x.src));
  if (!me) return;
  const link = document.createElement('link');
  link.id = 'assist-panel-css'; link.rel = 'stylesheet'; link.href = me.src.replace(/assist-panel\.js/, 'assist-panel.css');
  document.head.appendChild(link);
})();

// The answer, escaped first, then its light formatting shown: bold, lists and paragraphs. A block can mix a lead-in
// sentence with list lines; each run of lines becomes its own paragraph or list.
function text(t) {
  const inline = x => esc(x).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const kind = l => /^\s*[-*•]\s+/.test(l) ? 'ul' : /^\s*\d+[.)]\s+/.test(l) ? 'ol' : 'p';
  const out = [];
  for (const line of String(t || '').split('\n')) {
    if (!line.trim()) { out.push(null); continue; }
    const k = kind(line), last = out[out.length - 1];
    const body = k === 'p' ? line.trim() : line.replace(/^\s*([-*•]|\d+[.)])\s+/, '');
    if (last && last.k === k) last.lines.push(body); else out.push({ k, lines: [body] });
  }
  return out.filter(Boolean).map(g => g.k === 'p' ? `<p>${g.lines.map(inline).join('<br>')}</p>`
    : `<${g.k}>${g.lines.map(l => `<li>${inline(l)}</li>`).join('')}</${g.k}>`).join('');
}
const restoreNames = (t, names) => Object.entries(names || {}).sort((a, b) => b[0].length - a[0].length)
  .reduce((acc, [label, name]) => acc.split(label).join(name), String(t || ''));

function mount({ context }) {
  const h = { key: null, ctx: null, available: false, open: false, turns: [], busy: false, allowance: null, error: '', qHeight: 0, pending: '', retry: '' };
  const words = () => h.ctx && h.ctx.simId
    ? { title: 'Ask Claude about this sim', intro: 'Ask how to run it, what a screen means, why a student got a result, or what to ask in the debrief. With a session open, Claude reads it with students shown as numbers; you see their names here.', left: 'for this sim' }
    : { title: h.ctx && h.ctx.courseId ? 'Ask Claude about this class' : 'Ask Claude about RapidSims',
        intro: 'Ask which sims suit a course, how students join, how to set up a class, or where to find something. For one sim in depth, ask from that sim’s pages.', left: 'for questions about your classes' };

  async function call(x) {
    let c = h.ctx || {}; try { c = context() || c; } catch {}
    const r = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simId: c.simId || undefined, courseId: c.courseId || undefined, sessionCode: c.sessionCode || undefined, ...x }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.message || 'Claude could not answer just now.'), { data: d });
    return d;
  }

  function paint() {
    let box = document.getElementById('fs-helper');
    if (!box) { box = document.createElement('div'); box.id = 'fs-helper'; document.body.appendChild(box); }
    if (!h.ctx || !h.available) { box.innerHTML = ''; return; }
    const w = words(), a = h.allowance;
    box.innerHTML = h.open ? `<section class="fs-helper-panel" aria-label="${esc(w.title)}"><div class="fs-helper-head"><div><b>${esc(w.title)}</b><span class="fs-helper-by">Answers come from Claude, Anthropic’s AI</span></div><button type="button" class="btn" data-helper="close">Close</button></div>
  <div class="fs-helper-log">${h.turns.length || h.pending ? h.turns.map(t => `<p class="fs-helper-q">${esc(t.q)}</p><div class="fs-helper-a">${text(t.shown) || '<p>No answer came back. Please ask again.</p>'}</div>`).join('')
    + (h.pending ? `<p class="fs-helper-q">${esc(h.pending)}</p><div class="fs-helper-a fs-helper-typing" role="status" aria-label="Claude is writing an answer"><span></span><span></span><span></span></div>` : '')
    : `<p class="help">${esc(w.intro)}</p>`}</div>
  ${h.error ? `<p class="fs-helper-err">${esc(h.error)}</p>` : ''}<form class="fs-helper-form"><textarea id="fsHelperQ" rows="6"${h.qHeight ? ` style="height:${h.qHeight}px"` : ''} maxlength="1500" placeholder="Ask a question… Enter sends; Shift+Enter starts a new line." ${h.busy ? 'disabled' : ''}></textarea><button class="btn btn-primary" type="submit" ${h.busy ? 'disabled' : ''}>Ask</button></form>
  ${a ? `<p class="help">${a.left} of ${a.limit} questions left this month ${esc(w.left)}.</p>` : ''}</section>`
      : `<button type="button" class="fs-helper-open" data-helper="open">${esc(w.title)}</button>`;
    box.querySelectorAll('[data-helper]').forEach(x => x.onclick = () => { h.open = x.dataset.helper === 'open'; paint(); });
    const f = box.querySelector('form'), qa = document.getElementById('fsHelperQ');
    if (qa && f) qa.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); f.requestSubmit(); } };
    if (f) f.onsubmit = async e => {
      e.preventDefault();
      if (qa) h.qHeight = Math.round(qa.getBoundingClientRect().height);
      const q = (qa ? qa.value : '').trim(); if (!q || h.busy) return;
      const key = h.key; h.busy = true; h.pending = q; h.error = ''; paint(); scroll();
      try {
        const d = await call({ action: 'assist', question: q,  history: h.turns.slice(-4).map(t => ({ q: t.q, a: t.a })) });
        if (key === h.key) { h.turns.push({ q, a: d.answer, shown: restoreNames(d.answer, d.names) }); h.allowance = d.allowance || h.allowance; }
      } catch (err) { if (key === h.key) { h.error = err.message; h.retry = q; if (err.data && err.data.allowance) h.allowance = err.data.allowance; } }
      finally { h.busy = false; h.pending = ''; paint(); if (h.retry) { const t = document.getElementById('fsHelperQ'); if (t) t.value = h.retry; h.retry = ''; } scroll(); }
    };
  }
  const scroll = () => { const log = document.querySelector('.fs-helper-log'); if (log) log.scrollTop = log.scrollHeight; };

  // A new sim or class starts a new conversation; the same one keeps it (a session opening keeps the conversation).
  function update() {
    let c = null; try { c = context() || null; } catch { c = null; }
    const key = c ? `${c.simId || 'general'}|${c.courseId || ''}` : null;
    h.ctx = c;
    if (key === h.key) { paint(); return; }
    h.key = key; h.turns = []; h.error = ''; h.allowance = null; h.available = false; paint();
    if (!key) return;
    call({ action: 'assist_status' }).then(d => { if (key !== h.key) return; h.available = !!(d && d.available); h.allowance = d && d.allowance; paint(); })
      .catch(() => {});
  }
  update();
  return { update, get state() { return h; } };
}

global.AssistPanel = { mount, text };
})(typeof window !== 'undefined' ? window : globalThis);
