/* Show or hide a password as it is typed. Adds a Show/Hide button to every
   password box on the page, including boxes a page draws later. */
(() => {
  'use strict';
  const css = '.pw-wrap{position:relative;display:block}.pw-wrap>input{width:100%;box-sizing:border-box;padding-right:72px}' +
    '.pw-toggle{position:absolute;right:6px;top:50%;transform:translateY(-50%);min-height:32px;min-width:52px;padding:0 10px;' +
    'border:1px solid currentColor;border-radius:3px;background:transparent;color:inherit;opacity:.8;cursor:pointer;' +
    'font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase}' +
    '.pw-toggle:hover,.pw-toggle:focus-visible{opacity:1}';
  function enhance(input) {
    if (input.dataset.pwToggle) return;
    input.dataset.pwToggle = '1';
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pw-toggle';
    const set = shown => {
      input.type = shown ? 'text' : 'password';
      button.textContent = shown ? 'Hide' : 'Show';
      button.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
      button.setAttribute('aria-pressed', String(shown));
    };
    set(false);
    button.addEventListener('click', () => { set(input.type === 'password'); input.focus(); });
    wrap.appendChild(button);
  }
  function scan() { document.querySelectorAll('input[type="password"]:not([data-pw-toggle])').forEach(enhance); }
  function start() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
