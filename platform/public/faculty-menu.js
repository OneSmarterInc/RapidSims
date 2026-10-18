/* Faculty left menu, shared by the class pages and every sim's session pages.
   FacultyMenu.mount({ classes, course, sims, current, onNavigate }) draws it; call again to update.
   course: { id, title }   sims: [{ id, title, links:{ sessions, results, play, rehearse }, session:{ label, state, links:{ teams, results, debrief } } }]
   current: 'classes' | 'guide' | 'class' | '<simId>:sessions' | '<simId>:teams' | '<simId>:results' | '<simId>:debrief' | '<simId>:all-results' | '<simId>:rehearse'
   onNavigate(key): optional; return true when the page handles the link itself. */
(function (global) {
'use strict';
const KEY = 'rs-faculty-menu-collapsed';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATE = { lobby: ['Setting up', 'set'], running: ['Running', 'run'], paused: ['Paused', 'set'], closed: ['Closed', 'off'] };
const CSS = `
.rs-menu-toggle{position:fixed;top:10px;left:10px;z-index:1001;width:44px;height:44px;border-radius:6px;border:1px solid #3A4659;background:#0E1524;color:#E8E4DA;display:flex;align-items:center;justify-content:center;cursor:pointer}
.rs-menu-toggle:focus-visible,.rs-menu a:focus-visible{outline:3px solid #F0A63C;outline-offset:2px}
.rs-menu-toggle svg{width:20px;height:20px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round}
.rs-menu{position:fixed;top:0;left:0;bottom:0;width:248px;z-index:1000;background:#0E1524;color:#E8E4DA;border-right:1px solid #2B3548;overflow-y:auto;padding:64px 0 24px;font:14px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;box-sizing:border-box}
.rs-menu *{box-sizing:border-box}
.rs-menu .rs-h{padding:14px 18px 6px;font:600 10.5px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#9EA6B5}
.rs-menu .rs-class{padding:4px 18px 10px;font:500 20px/1.2 'Newsreader',Georgia,serif;color:#E8E4DA}
.rs-menu a{display:flex;align-items:center;gap:8px;min-height:40px;padding:8px 18px;color:#C9CED8;text-decoration:none;border-left:3px solid transparent}
.rs-menu a:hover{background:#161E2E;color:#fff}
.rs-menu a[aria-current=page]{background:#1D2637;color:#F0A63C;border-left-color:#F0A63C;font-weight:600}
.rs-menu .rs-sub a{padding-left:34px;min-height:36px;font-size:13.5px}
.rs-menu .rs-sub2 a{padding-left:50px;min-height:34px;font-size:13px}
.rs-menu .rs-sim{padding:12px 18px 4px;font:500 16px 'Newsreader',Georgia,serif;color:#E8E4DA;border-top:1px solid #2B3548;margin-top:8px}
.rs-menu .rs-dot{width:8px;height:8px;border-radius:50%;flex:none}
.rs-menu .rs-dot.run{background:#3DDC97}.rs-menu .rs-dot.set{background:#F2C14E}.rs-menu .rs-dot.off{background:#6B7385}
.rs-menu .rs-state{margin-left:auto;font:600 10px 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:#9EA6B5}
.rs-menu .rs-foot{border-top:1px solid #2B3548;margin-top:12px;padding-top:6px}
body.rs-has-menu{padding-left:248px}
body.rs-has-menu.rs-menu-collapsed{padding-left:0}
body.rs-menu-collapsed .rs-menu{transform:translateX(-100%);visibility:hidden}
body.rs-has-menu .top,body.rs-has-menu>header{padding-left:64px}
@media (max-width:900px){
  body.rs-has-menu{padding-left:0}
  body.rs-has-menu .rs-menu{transform:translateX(-100%);visibility:hidden;box-shadow:none}
  body.rs-menu-open .rs-menu{transform:none;visibility:visible;box-shadow:0 0 0 100vmax rgba(5,8,14,.55)}
}
@media print{.rs-menu,.rs-menu-toggle{display:none}body.rs-has-menu{padding-left:0}}`;

let opts = null;
function read() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
function save(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* menu still works */ } }
const phone = () => global.matchMedia && global.matchMedia('(max-width:900px)').matches;

function link(key, href, label, extra = '', attrs = '') {
  return `<a href="${esc(href || '#')}" data-rs-key="${esc(key)}"${opts.current === key ? ' aria-current="page"' : ''}${attrs}>${extra}${esc(label)}</a>`;
}

function html() {
  const c = opts.course;
  let out = '';
  if (c) {
    out += `<div class="rs-h">Class</div><div class="rs-class">${esc(c.title || 'Your class')}</div>`;
    out += link('class', c.href, 'Class home');
    for (const s of opts.sims || []) {
      const L = s.links || {};
      out += `<div class="rs-sim">${esc(s.title)}</div><div class="rs-sub">`;
      if (L.sessions) out += link(`${s.id}:sessions`, L.sessions, 'Sessions');
      if (s.session) {
        const st = STATE[s.session.state] || ['', 'off'];
        out += `<a href="${esc(s.session.links?.teams || L.sessions || '#')}" data-rs-key="${esc(s.id)}:session"${String(opts.current).startsWith(s.id + ':') && ['teams', 'results', 'debrief'].includes(String(opts.current).split(':')[1]) ? ' class="rs-open"' : ''}><span class="rs-dot ${st[1]}" aria-hidden="true"></span>${esc(s.session.label)}<span class="rs-state">${esc(st[0])}</span></a>`;
        const SL = s.session.links || {};
        out += '<div class="rs-sub2">';
        if (SL.teams) out += link(`${s.id}:teams`, SL.teams, s.session.team === false ? 'Students' : 'Teams');
        if (SL.results) out += link(`${s.id}:results`, SL.results, 'Results');
        if (SL.debrief) out += link(`${s.id}:debrief`, SL.debrief, 'Debrief');
        out += '</div>';
      }
      if (L.results) out += link(`${s.id}:all-results`, L.results, 'Past sessions');
      if (L.rehearse) out += link(`${s.id}:rehearse`, L.rehearse, 'Rehearse');
      // Play it yourself opens in a new tab, so the console stays open.
      if (L.play) out += link(`${s.id}:play`, L.play, 'Play it yourself', '', ' target="_blank" rel="noopener"');
      out += '</div>';
    }
  }
  const others = (opts.classes || []).filter(k => !c || k.id !== c.id);
  if (others.length) {
    out += `<div class="rs-h">${c ? 'Other classes' : 'Your classes'}</div>`;
    for (const k of others) out += link(`class:${k.id}`, k.href, k.title);
  }
  out += `<div class="rs-foot">${link('classes', opts.classesHref || '/faculty.html', 'Your classes')}${opts.guideHref ? link('guide', opts.guideHref, 'Getting started') : ''}</div>`;
  return out;
}

function mount(next) {
  opts = { ...(opts || {}), ...next };
  const doc = global.document;
  if (!doc.getElementById('rs-menu-style')) { const st = doc.createElement('style'); st.id = 'rs-menu-style'; st.textContent = CSS; doc.head.appendChild(st); }
  let nav = doc.getElementById('rs-menu');
  if (!nav) {
    const btn = doc.createElement('button');
    btn.type = 'button'; btn.className = 'rs-menu-toggle'; btn.id = 'rs-menu-toggle'; btn.setAttribute('aria-controls', 'rs-menu');
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    nav = doc.createElement('nav'); nav.id = 'rs-menu'; nav.className = 'rs-menu'; nav.setAttribute('aria-label', 'Faculty menu');
    doc.body.prepend(nav); doc.body.prepend(btn);
    doc.body.classList.add('rs-has-menu');
    if (read()) doc.body.classList.add('rs-menu-collapsed');
    const sync = () => {
      const open = phone() ? doc.body.classList.contains('rs-menu-open') : !doc.body.classList.contains('rs-menu-collapsed');
      btn.setAttribute('aria-expanded', String(open)); btn.setAttribute('aria-label', open ? 'Hide menu' : 'Show menu');
    };
    btn.onclick = () => {
      if (phone()) doc.body.classList.toggle('rs-menu-open');
      else { const c = !doc.body.classList.contains('rs-menu-collapsed'); doc.body.classList.toggle('rs-menu-collapsed', c); save(c); }
      sync();
    };
    nav.addEventListener('click', e => {
      const a = e.target.closest('a[data-rs-key]'); if (!a) return;
      if (phone()) { doc.body.classList.remove('rs-menu-open'); sync(); }
      if (opts.onNavigate && opts.onNavigate(a.dataset.rsKey, a) === true) e.preventDefault();
    });
    doc.addEventListener('keydown', e => { if (e.key === 'Escape' && doc.body.classList.contains('rs-menu-open')) { doc.body.classList.remove('rs-menu-open'); sync(); btn.focus(); } });
    global.addEventListener('resize', sync);
    sync();
  }
  nav.innerHTML = html();
}

global.FacultyMenu = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
