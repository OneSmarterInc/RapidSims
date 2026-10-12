'use strict';
// Optional real-browser suite. See README for browser/runtime setup.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.SIM10_PLAYWRIGHT_PATH || 'playwright');
const { createApp } = require('../lib/app');
const { memoryStore } = require('../lib/store');
const E = require('../lib/engine');
process.env.DEV_OPEN = '1';
const MIN = 60000;
(async () => {
  const store = memoryStore(); let now = Date.now();
  const server = http.createServer(createApp({ store, clock: () => now }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  let browser;
  const artifactDir = process.env.SIM10_SCREENSHOTS;
  if (artifactDir) fs.mkdirSync(artifactDir, { recursive: true });
  const shot = async (page, file) => { if (artifactDir) await page.screenshot({ path: path.join(artifactDir, file) }); };
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.SIM10_CHROMIUM_PATH ? { executablePath: process.env.SIM10_CHROMIUM_PATH } : {}),
      args: process.env.SIM10_BROWSER_ARGS ? process.env.SIM10_BROWSER_ARGS.split(',') : []
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.locator('#entry-options').waitFor({ state: 'visible' });
    await shot(page, 'entry.png');
    const s = await E.createSession(store, { mode: 'individual', cases: ['A'] }, now);
    const p = await E.join(store, s.code, {}, now);
    await E.startCase(store, s.code, s.hostKey, 'A', now - 13 * MIN);
    await page.evaluate(({code,pid}) => sessionStorage.setItem(`s10:${code}`, pid), {code:s.code,pid:p.pid});
    await page.goto(`${base}/play?code=${s.code}`);
    await page.locator('#f-mind').waitFor();
    const desktop = await page.evaluate(() => ({ figures: document.querySelector('#pack-wrap').getBoundingClientRect().toJSON(), answer: document.querySelector('#dock').getBoundingClientRect().toJSON(), position: getComputedStyle(document.querySelector('#dock')).position }));
    assert(desktop.figures.right <= desktop.answer.left, 'desktop answer must not cover figures');
    assert.notEqual(desktop.position, 'fixed');
    await shot(page, 'student-desktop.png');
    await page.locator('[data-call="infra"]').click();
    await page.locator('#f-line').selectOption('is.revenue');
    await page.locator('#f-why').fill('Revenue increased between the reported quarters.');
    await page.locator('#f-mind').fill('I would change my call if cash collection weakened while debt and construction costs kept rising without evidence of sustainable demand.');
    await page.waitForFunction(() => !document.querySelector('#commit').disabled);
    await page.locator('#dock-toggle').click(); await page.locator('#dock-toggle').click();
    assert.equal(await page.locator('#f-why').inputValue(), 'Revenue increased between the reported quarters.', 'hide/show retains text');
    await page.locator('#f-why').focus();
    await page.evaluate(() => poll());
    assert.equal(await page.locator('#f-why').evaluate(el => el === document.activeElement), true);
    await page.locator('#commit').click(); await page.locator('#commit-dialog').waitFor({state:'visible'});
    await page.locator('#commit-confirm').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0,0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile page must not overflow horizontally');
    const stacked = await page.evaluate(() => { const a=document.querySelector('#dock').getBoundingClientRect(), f=document.querySelector('#pack-wrap').getBoundingClientRect();return a.top>=f.bottom; });
    assert(stacked, 'mobile form must follow figures without an overlay');
    await shot(page,'student-mobile-figures.png');
    await page.locator('#dock').scrollIntoViewIfNeeded(); await shot(page,'student-mobile-answer.png');

    // Failed write and retry through the actual shipped page and HTTP handler.
    await page.route('**/api/verdict', route => route.fulfill({ status: 503, contentType:'application/json', body:JSON.stringify({message:'Temporary save failure'}) }));
    await page.locator('#f-why').fill('The newest explanation must remain available after a failed save.');
    await page.locator('#retry-save').waitFor({state:'visible'});
    assert(await page.locator('#commit').isDisabled());
    await page.unroute('**/api/verdict'); await page.locator('#retry-save').click();
    await page.waitForFunction(() => !document.querySelector('#commit').disabled);
    const saved = await E.studentState(store,s.code,p.pid,now);
    assert.equal(saved.mine.lineWhy,'The newest explanation must remain available after a failed save.');
    const before = saved.startsAt; await page.reload(); await page.locator('#f-mind').waitFor();
    assert.equal((await E.studentState(store,s.code,p.pid,now)).startsAt,before);

    // Real team validation, confirmation, commit and late-write protection.
    const team = await E.createSession(store,{mode:'team',cases:['A'],teams:2},now);
    const member = await E.join(store,team.code,{team:1},now);

    await page.evaluate(({code,pid,host})=>{sessionStorage.setItem(`s10:${code}`,pid);localStorage.setItem(`s10host:${code}`,host)}, {code:team.code,pid:member.pid,host:team.hostKey});
    await page.goto(`${base}/play?code=${team.code}`); await page.locator('#waiting').waitFor({state:'visible'});
    await E.startCase(store,team.code,team.hostKey,'A',now-11*MIN); await page.evaluate(()=>poll());
    await page.locator('[data-private="infra"]').click();
    await page.waitForFunction(()=>document.querySelector('#saved').textContent==='All changes saved.');
    now += 2*MIN; await page.evaluate(()=>poll()); await page.locator('#f-mind').waitFor();
    assert(await page.locator('#commit').isDisabled());
    await page.locator('[data-call="bubble"]').click(); await page.locator('#f-line').selectOption('bs.cash');
    await page.locator('#f-why').fill('Cash is needed for continued investment and funding.');
    await page.locator('#f-mind').fill('I would need to see sustainable cash generation and customer demand without additional debt or higher construction spending over several quarters.');
    await page.waitForFunction(()=>!document.querySelector('#commit').disabled);
    await page.locator('#commit').click(); await page.locator('#commit-confirm').click();
    await page.waitForFunction(()=>document.querySelector('#dock').innerText.includes('committed'));
    assert((await E.studentState(store,team.code,member.pid,now)).teamCommitted);

    // Host mode preselection, stable focus, join URL and notes-free projector.
    await page.goto(`${base}/host?play=individual`); await page.locator('#setup').waitFor({state:'visible'});
    assert(await page.locator('input[name=mode][value=individual]').isChecked());
    await page.setViewportSize({width:1440,height:1000}); await shot(page,'faculty-setup.png');
    await page.goto(`${base}/console?code=${team.code}`); await page.locator('#notes-body h3').first().waitFor({state:'attached'});
    assert((await page.locator('#join-url').getAttribute('href')).includes('session='+team.code));
    now += 10*MIN; await page.evaluate(()=>poll());
    await page.locator('[data-act=reveal]').focus(); await page.evaluate(()=>poll());
    assert(await page.locator('[data-act=reveal]').evaluate(el=>el===document.activeElement));
    await shot(page,'faculty-console.png');
    await page.goto(`${base}/console?code=${team.code}&projector=1`); await page.locator('#board .panel').first().waitFor();
    assert.equal(await page.locator('#notes').count(),0); assert.equal(await page.locator('#notes-body').count(),0);
    await shot(page,'projector.png');
    await page.route('**/api/console?*', route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({message:'Expired'})}));
    await page.evaluate(()=>poll()); await page.locator('#recovery').waitFor({state:'visible'});
    assert((await page.locator('#err').innerText()).includes('Sign-in expired'));
    await page.unroute('**/api/console?*');
    await page.goto(`${base}/play?code=${team.code}`);
    await page.locator('#result').waitFor({state:'visible'});
    for (let stage=1;stage<=3;stage++) {
      await E.advanceReveal(store,team.code,team.hostKey,'A',now);
      await page.evaluate(()=>poll());
      if(stage===1) await page.locator('#reveal .reveal-name').waitFor();
      if(stage===2) await page.locator('#reveal table').waitFor();
      if(stage===3) await page.locator('#reveal .outcome').waitFor();
    }
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'reveal tables must scroll within their panel');
    await page.locator('#reveal').scrollIntoViewIfNeeded(); await shot(page,'reveal-mobile.png');
    assert.deepEqual(errors,[]);
    console.log('Browser checks passed: desktop/mobile layout, saved answers, hide/show, failed save/retry, team confirmation, host mode, focus, join link, projector and expired sign-in.');
  } finally { if(browser)await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1});
