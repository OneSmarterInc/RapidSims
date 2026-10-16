#!/usr/bin/env node
// Browser walk of Infrastructure or Bubble? on the shared faculty pages: a faculty member starts a session with one
// company, two students join from the class link and make their calls, the session bar opens and closes the calls
// and shows the company, the next four quarters and what happened, Results shows the bands, a student answers the
// review, the debrief plays, and the Live screen opens the session. Real handlers and pages in Chromium;
// in-memory store. Run by hand (needs Playwright): node sim10/tools/kit-browser-run.js
'use strict';
require('../../tools/security/report-fixture.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const { chromium } = require('playwright');
process.env.LAUNCH_SECRET = 'sim10-kit-browser-secret';
process.env.BASE_PATH = '/sim10/';
delete process.env.ACCESS_CODE; delete process.env.DEV_OPEN;
const config = require('../data/config');
const { memoryStore } = require('../lib/store');
const { createApp } = require('../lib/app');
const artifacts = path.resolve(process.env.ARTIFACTS || 'browser-artifacts/sim10-kit');
let checks = 0; const ok = (v, m) => { assert.ok(v, m); checks++; console.log('PASS:', m); };
const app = createApp({ store: memoryStore() });
const token = (sub, name, role) => { const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: config.simId, course: 'crs_A',
  mode: role === 'student' ? 'play' : 'session', iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64url');
  return body + '.' + createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url'); };
const MIND = 'I would need to see like-for-like revenue growing faster than capital spending for two quarters in a row, with cash steady.';

(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    // The platform's own endpoints, on the same origin.
    if (url.pathname === '/api/session-enrolments') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ students: [] })); }
    if (url.pathname.startsWith('/api/') || url.pathname.endsWith('faculty-menu.js')) { res.writeHead(url.pathname.startsWith('/api/') ? 200 : 404, { 'content-type': 'application/json' }); return res.end('{}'); }
    return app(req, res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.env.PLATFORM_URL = origin;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  const open = async name => { const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.route(/https:\/\/fonts\./, r => r.abort()); const pg = await ctx.newPage(); pg.setDefaultTimeout(15000);
    pg.on('pageerror', e => errors.push(name + ': ' + e.message)); pg.on('dialog', d => d.accept()); return pg; };
  try {
    const facLT = token('fac', 'Vikram', 'faculty');
    const fac = await open('faculty');
    await fac.goto(`${origin}/sim10/#lt=${encodeURIComponent(facLT)}`);
    await fac.waitForURL(/instructor\.html/);
    ok(true, 'A faculty launch lands on the shared Sessions pages');
    await fac.locator('#create').waitFor();
    ok(await fac.locator('#create').isDisabled(), 'Start session waits for a play mode (no default)');
    await fac.locator('[data-mode="individual"]').click();
    await fac.screenshot({ path: path.join(artifacts, '01-sessions.png'), fullPage: true });
    await fac.locator('#create').click();
    await fac.locator('#faculty-workspace').waitFor();
    const code = await fac.evaluate(() => FacultySession.page.code);
    ok(await fac.locator('.fw-cases[aria-pressed="true"]', { hasText: 'Two companies' }).count() === 1, 'Before Start: two companies by default');
    await fac.locator('.fw-cases', { hasText: 'One company' }).click();
    await fac.waitForFunction(() => document.querySelector('.fw-cases[aria-pressed="true"]')?.textContent === 'One company');
    ok(true, 'Faculty choose one company');
    await fac.locator('#fw-advanced summary').click();
    await fac.waitForFunction(() => document.getElementById('fw-advanced-content').textContent.trim().length > 0);
    ok(/instructor notes/i.test(await fac.locator('#fw-advanced-content').innerText()), 'Advanced settings and instructor notes shows the notes');
    ok(await fac.locator('.fw-cases[aria-pressed="true"]', { hasText: 'Longer' }).count() === 1, 'Reading time: Longer by default');
    await fac.screenshot({ path: path.join(artifacts, '02-lobby.png') });

    const st = {};
    for (const [sub, name] of [['ana', 'Ana Lopez'], ['ben', 'Ben Ode']]) {
      st[sub] = await open(sub);
      await st[sub].goto(`${origin}/sim10/#lt=${encodeURIComponent(token(sub, name, 'student'))}`);
      await st[sub].waitForFunction(() => /you're in/i.test(document.body.innerText));
      ok(st[sub].url().includes('play?code=' + code), `${name} lands in the class session from the class link`);
    }
    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('#start-session').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'running');
    ok(true, 'Start session');
    const liveHref = await fac.locator('a', { hasText: 'Live screen' }).getAttribute('href');
    ok(liveHref.startsWith('live.html?session=' + code), 'The session bar links the Live screen to this session');
    const press = async label => {
      const b = fac.locator('[data-session-control]', { hasText: label });
      await b.waitFor(); await b.click();
      await fac.waitForFunction(() => !document.querySelector('[data-session-control]:not(.fw-close)')?.disabled);
      await fac.evaluate(() => FacultySession.page.refresh());
    };
    await press('Add 2 minutes');
    ok(true, 'Add 2 minutes while reading');
    await press('Open the calls now');
    await st.ana.waitForFunction(() => document.querySelector('#dock') && !document.querySelector('#dock').hidden);
    ok(true, 'Students see the call form');
    const send = (sub, fields) => st[sub].evaluate(async ([c, f, pid]) => (await fetch('/sim10/api/verdict', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-launch-token': launchToken(), 'x-pid': pid }, body: JSON.stringify({ code: c, caseId: 'A', fields: f }) })).status, [code, fields, `platform:${sub}`]);
    ok(await send('ana', { call: 'bubble', line: 'hl.adj_ebitda', lineWhy: 'Most of it is cash paid in advance.', mind: MIND }) === 200
      && await send('ben', { call: 'infra', line: 'hl.adj_ebitda', lineWhy: 'The profit measure is positive.', mind: MIND }) === 200, 'Both make their calls');
    await fac.screenshot({ path: path.join(artifacts, '03-session-bar.png') });
    await press('Close the calls now');
    for (const label of ['Show the company', 'Show the next four quarters', 'Show what happened']) await press(label);
    ok(true, 'The session bar opens the calls and shows each part');

    await fac.locator('[data-view="results"]').first().click();
    await fac.waitForFunction(() => document.querySelectorAll('#team-list .team-item').length === 2);
    const results = await fac.locator('#results-view').innerText();
    ok(/Infrastructure/.test(results) && /Bubble/.test(results), 'Results shows each band');
    ok(/calls and answers/i.test(results), 'The Results sentence lists calls and answers');
    await fac.screenshot({ path: path.join(artifacts, '04-results.png'), fullPage: true });

    const ana = st.ana;
    await ana.waitForSelector('#rv1', { timeout: 15000 });
    ok(/Questions to discuss/.test(await ana.locator('#review').innerText()), 'Four questions follow the last outcome');
    await ana.fill('#rv1', 'It did: cash kept falling.'); await ana.fill('#rv2', 'Capital spending first.');
    await ana.locator('#review-send').click();
    await ana.waitForFunction(() => document.body.innerText.includes('Review sent'));
    ok(true, 'The student answers the review after the outcome');
    await ana.screenshot({ path: path.join(artifacts, '05-student-review.png'), fullPage: true });

    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('[data-view="debrief"]').first().click();
    await fac.locator('.md-slide').waitFor();
    ok((await fac.locator('.md-kicker').first().innerText()).toLowerCase().includes('the calls'), 'Debrief opens on the calls');
    for (let i = 0; i < 6; i++) {
      await fac.screenshot({ path: path.join(artifacts, `0${6 + i}-debrief-${i + 1}.png`.replace(/^0(\d\d)/, '$1')) });
      if (i < 5) await fac.locator('[data-md="next"]').click();
    }
    await fac.locator('[data-md-go="4"]').click();
    ok((await fac.locator('.md-slide').innerText()).includes('It did: cash kept falling.'), 'What students said shows the review');

    const live = await open('live');
    await live.goto(`${origin}/sim10/${liveHref.replace(/#lt=.*/, '')}#lt=${encodeURIComponent(facLT)}`);
    await live.waitForFunction(() => document.body.innerText.includes('Company 1'));
    ok(!/\broom\b/i.test(await live.locator('body').innerText()), 'The Live screen opens this session, with no "room"');
    await live.screenshot({ path: path.join(artifacts, '12-live-screen.png'), fullPage: true });

    await fac.locator('[data-session-control="close"]').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'closed');
    ok(true, 'Close');
    ok(errors.length === 0, 'No browser errors ' + errors.join(' | '));
    console.log(`SIM10_KIT_BROWSER_PASSED (${checks} checks). Screenshots: ${artifacts}`);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
