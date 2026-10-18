/* Light or dark, for the RapidSims student screens, live screens and the faculty debrief (Oct 18, 2026).
   Load it in <head> before the stylesheets' first paint: <script src="kit/theme.js?v=…"></script>
   It sets <html data-theme="light|dark"> at once: the reader's own choice if they made one (kept in this browser,
   shared by every RapidSims page), otherwise their device setting, otherwise dark. A sun/moon button switches it.
   Each sim's CSS keeps its dark colours as the default and adds :root[data-theme="light"] { … } for light.
   Script attributes: data-place="bottom-left|bottom-right|top-right|top-left" (default bottom-left),
   data-label="Slides" names what switches on pages where only part of the page changes (the faculty debrief). */
(function (global) {
'use strict';
const KEY = 'rs-theme', root = document.documentElement;
const me = document.currentScript;
let button = null;
const saved = () => { try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : null; } catch { return null; } };
const device = () => { try { return global.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch { return 'dark'; } };
const current = () => root.dataset.theme === 'light' ? 'light' : 'dark';
// Native controls follow the theme only where the whole page switches (no data-label).
function apply(t) { root.dataset.theme = t; if (!(me && me.dataset.label)) root.style.colorScheme = t; paint(); try { global.dispatchEvent(new CustomEvent('rs-theme', { detail: t })); } catch {} }
apply(saved() || device());

// The device setting changes the theme only while the reader has made no choice of their own.
try { global.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (!saved()) apply(device()); }); } catch {}
// A choice made in another RapidSims tab applies here too.
global.addEventListener('storage', e => { if (e.key === KEY && (e.newValue === 'light' || e.newValue === 'dark')) apply(e.newValue); });

const SUN = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
function paint() {
  if (!button) return;
  const t = current(), next = t === 'light' ? 'dark' : 'light', label = (me && me.dataset.label) || '';
  button.innerHTML = (t === 'light' ? MOON : SUN) + `<span>${label ? label + ': ' : ''}${next === 'dark' ? 'Dark' : 'Light'}</span>`;
  button.setAttribute('aria-label', `${label ? label + ': ' : ''}switch to the ${next} theme`);
  button.title = button.getAttribute('aria-label');
}
function mount() {
  if (button || !document.body) return;
  const css = document.createElement('style');
  css.textContent = `.rs-theme-btn{position:fixed;z-index:45;display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:18px;
    font:600 12px/1 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.02em;cursor:pointer;
    background:rgba(20,26,38,.86);color:#F2EFE8;border:1px solid rgba(255,255,255,.22);box-shadow:0 2px 10px rgba(0,0,0,.18)}
  :root[data-theme="light"] .rs-theme-btn{background:rgba(255,255,255,.94);color:#1F2A33;border-color:#C9D1D8}
  .rs-theme-btn:focus-visible{outline:2px solid #F0A63C;outline-offset:2px}
  .rs-theme-btn[data-place="bottom-left"]{left:14px;bottom:14px}.rs-theme-btn[data-place="bottom-right"]{right:14px;bottom:14px}
  .rs-theme-btn[data-place="top-right"]{right:14px;top:14px}.rs-theme-btn[data-place="top-left"]{left:14px;top:14px}
  @media print{.rs-theme-btn{display:none}}`;
  document.head.appendChild(css);
  button = document.createElement('button');
  button.type = 'button'; button.className = 'rs-theme-btn';
  button.dataset.place = (me && me.dataset.place) || 'bottom-left';
  button.onclick = () => { const next = current() === 'light' ? 'dark' : 'light'; try { localStorage.setItem(KEY, next); } catch {} apply(next); };
  document.body.appendChild(button); paint();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
global.RapidSimsTheme = { get: current, set: t => { try { localStorage.setItem(KEY, t); } catch {} apply(t === 'light' ? 'light' : 'dark'); } };
})(typeof window !== 'undefined' ? window : globalThis);
