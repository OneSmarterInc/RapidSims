#!/usr/bin/env node
// Browser walk of Would You Have Bought It? on the shared faculty pages: a faculty member starts a session, two
// students join from the class link and decide, the session bar closes the decisions and releases 2002, 2005 and
// 2010, Results shows the bands, a student answers the review after 2010, the debrief plays, and the Live screen
// opens the session. Real handlers and pages in Chromium; the in-memory store.
// Run by hand (needs Playwright): node sim07/tools/kit-browser-run.js
require('../../tools/security/report-fixture.cjs');
process.env.W07_MEMORY_STORE = '1';
process.env.LAUNCH_SECRET = 'sim07-kit-browser-secret';
delete process.env.ACCESS_CODE;
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const { chromium } = require('playwright');
const { META } = require('../data/config.js');
const root = path.resolve(__dirname, '..');
const artifacts = path.resolve(process.env.ARTIFACTS || 'browser-artifacts/sim07-kit');
let checks = 0; const ok = (v, m) => { assert.ok(v, m); checks++; console.log('PASS:', m); };
const handlers = { session: require('../api/session.js'), config: require('../api/config.js'), finish: require('../api/finish.js') };
const token = (sub, name, role) => { const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: META.id, course: 'crs_A',
  mode: role === 'student' ? 'play' : 'session', iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64url');
  return body + '.' + createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url'); };

(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/session-enrolments') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ students: [] })); }
      if (url.pathname === '/api/complete' || url.pathname === '/api/register') { res.writeHead(200); return res.end('{}'); }
      const p = url.pathname.replace(/^\/sim07(?=\/|$)/, '') || '/';
      const api = p.match(/^\/api\/([a-z]+)$/);
      if (api && handlers[api[1]]) {
        const chunks = []; for await (const c of req) chunks.push(c);
        req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        req.query = Object.fromEntries(url.searchParams);
        res.status = n => { res.statusCode = n; return res; };
        res.json = v => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(v)); return res; };
        return handlers[api[1]](req, res);
      }
      if (p.startsWith('/api/')) { res.writeHead(404); return res.end('{}'); }
      const kit = /^\/kit\/[a-z-]+\.(js|css)$/.test(p);
      const file = kit ? path.join(root, '..', 'platform', 'public', p) : path.join(root, 'public', p === '/' ? 'index.html' : p.slice(1));
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
      res.end(body);
    } catch (e) { res.writeHead(404); res.end(''); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.env.PLATFORM_URL = origin;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  const open = async name => { const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.route(/https:\/\/fonts\./, r => r.abort()); const pg = await ctx.newPage(); pg.setDefaultTimeout(12000);
    pg.on('pageerror', e => errors.push(name + ': ' + e.message)); pg.on('dialog', d => d.accept()); return pg; };
  try {
    const facLT = token('fac', 'Vikram', 'faculty');
    const fac = await open('faculty');
    await fac.goto(`${origin}/sim07/instructor.html#lt=${encodeURIComponent(facLT)}`);
    await fac.locator('#create').waitFor();
    ok(await fac.locator('#create').isDisabled(), 'Start session waits for a play mode (no default)');
    await fac.locator('[data-mode="individual"]').click();
    await fac.screenshot({ path: path.join(artifacts, '01-sessions.png'), fullPage: true });
    await fac.locator('#create').click();
    await fac.locator('#faculty-workspace').waitFor();
    const code = await fac.evaluate(() => FacultySession.page.code);

    const st = {};
    for (const [sub, name] of [['ana', 'Ana Lopez'], ['ben', 'Ben Ode']]) {
      st[sub] = await open(sub);
      await st[sub].goto(`${origin}/sim07/#lt=${encodeURIComponent(token(sub, name, 'student'))}`);
      await st[sub].waitForFunction(() => /starts the clock when the class is ready/i.test((document.body?.innerText || "")));
      ok(st[sub].url().includes('session=' + code), `${name} lands in the class session from the class link`);
    }
    ok(!/\broom\b/i.test(await st.ana.locator('body').innerText()), 'No "room" on the student page');
    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('#start-session').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'running');
    ok(true, 'Start session');
    const bar = await fac.locator('#fw-startbar').innerText();
    ok(!/pause/i.test(bar) && /close decisions now/i.test(bar), 'Session bar: Close decisions now, and no Pause');
    const liveHref = await fac.locator('a', { hasText: 'Live screen' }).getAttribute('href');
    ok(liveHref.startsWith('live.html?session=' + code), 'The session bar links the Live screen to this session');

    // Each student decides on their own page, then answers the recognition question.
    const decide = async (sub, choice, reason, rec) => {
      const pg = st[sub];
      await pg.waitForFunction(() => typeof S !== 'undefined' && S.state?.phase === 'deciding');
      await pg.evaluate(() => { S.view = 'decision'; render(); });
      await pg.locator(`[data-choice="${choice}"]`).click();
      await pg.fill('#why', reason);
      await pg.locator('#review').click();
      await pg.locator('#submit').click();
      await pg.locator(`[data-rec="${rec}"]`).click();
      await pg.waitForFunction(() => /wait for your instructor/i.test((document.body?.innerText || "")));
    };
    await decide('ana', 'buy', 'Fifty million is a small price for a business we cannot build ourselves.', 'no');
    await decide('ben', 'decline', 'They lost thirty million last year and nobody would buy their shares.', 'yes');
    ok(true, 'Both students decide and answer the recognition question');

    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('[data-session-control="end_decisions"]').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.phase === 'decided');
    for (const year of ['2002', '2005', '2010']) {
      const btn = fac.locator('[data-session-control="next_stage"]');
      await btn.waitFor();
      ok((await btn.innerText()).includes(year), `Session bar releases ${year}`);
      await btn.click();
      await fac.waitForFunction(y => FacultySession.page.state?.session?.stage === ['2002', '2005', '2010'].indexOf(y) + 1, year);
      if (year === '2002') await fac.screenshot({ path: path.join(artifacts, '02-release.png') });
    }

    await fac.locator('[data-view="results"]').first().click();
    await fac.waitForFunction(() => document.querySelectorAll('#team-list .team-item').length === 2);
    const results = await fac.locator('#results-view').innerText();
    ok(/Bought/.test(results) && /Declined/.test(results), 'Results shows each decision as a band');
    await fac.screenshot({ path: path.join(artifacts, '03-results.png'), fullPage: true });

    // After 2010: the names, the questions, the review.
    const ana = st.ana;
    await ana.waitForFunction(() => /think about it/i.test((document.body?.innerText || "")), null, { timeout: 15000 });
    ok(/Netflix/.test(await ana.locator('body').innerText()), 'The 2010 stage names the companies');
    const current = await ana.$('.stage.current');
    await ana.waitForTimeout(4000);
    ok(await current.evaluate(e => e.isConnected), 'The page keeps the current stage between polls, so it fades in once');
    await ana.fill('#rv1', 'The price against our revenue.'); await ana.fill('#rv2', 'Choosing a major.');
    await ana.locator('#review-send').click();
    await ana.waitForFunction(() => (document.body?.innerText || "").includes('Sent to your instructor'));
    ok(true, 'The student answers the review after 2010');
    await ana.screenshot({ path: path.join(artifacts, '04-student-2010.png'), fullPage: true });

    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('[data-view="debrief"]').first().click();
    await fac.locator('.md-slide').waitFor();
    ok((await fac.locator('.md-kicker').first().innerText()).toLowerCase().includes('how the class decided'), 'Debrief opens on how the class decided');
    await fac.screenshot({ path: path.join(artifacts, '05-debrief-glance.png') });
    await fac.locator('[data-md="next"]').click();
    ok((await fac.locator('.md-slide').innerText()).includes('nobody would buy their shares'), 'The pair shows a declined reason');
    await fac.screenshot({ path: path.join(artifacts, '06-debrief-pair.png') });
    await fac.locator('[data-md="next"]').click();
    ok((await fac.locator('.bt-stage').count()) === 3, 'What happened next: three stages');
    await fac.screenshot({ path: path.join(artifacts, '07-debrief-stages.png') });
    await fac.locator('[data-md="next"]').click();
    await fac.screenshot({ path: path.join(artifacts, '08-debrief-recognition.png') });
    await fac.locator('[data-md-go="4"]').click();
    ok((await fac.locator('.md-slide').innerText()).includes('The price against our revenue.'), 'What students said shows the review');
    await fac.locator('[data-md-go="5"]').click();
    await fac.screenshot({ path: path.join(artifacts, '09-debrief-lessons.png') });

    const live = await open('live');
    await live.goto(`${origin}/sim07/${liveHref.replace(/#lt=.*/, '')}#lt=${encodeURIComponent(facLT)}`);
    await live.waitForFunction(c => (document.body?.innerText || "").includes(c), code);
    ok(/ten years later/i.test(await live.locator('body').innerText()), 'The Live screen opens this session at 2010');
    await live.screenshot({ path: path.join(artifacts, '10-live-screen.png'), fullPage: true });

    await fac.locator('[data-session-control="close"]').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'closed');
    ok(true, 'Close');
    ok(errors.length === 0, 'No browser errors ' + errors.join(' | '));
    console.log(`SIM07_KIT_BROWSER_PASSED (${checks} checks). Screenshots: ${artifacts}`);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
