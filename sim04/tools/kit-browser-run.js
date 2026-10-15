#!/usr/bin/env node
// Browser walk of Whose Number Is Right? on the shared faculty pages: a faculty member starts a team session,
// splits the approved students into teams, starts the clock; students join from the class link and lock
// numbers; Results shows bands; the debrief plays; the review is released and answered.
// Real sim handlers and pages in Chromium; in-memory session storage; a stand-in platform for the class list.
// Run by hand (needs Playwright): node sim04/tools/kit-browser-run.js
require('../../tools/security/report-fixture.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
process.env.LAUNCH_SECRET = 'sim04-kit-browser-secret';
const store = require('../lib/store.js');
const { signBack } = require('../lib/launch.js');
const root = path.resolve(__dirname, '..');
const artifacts = path.resolve(process.env.ARTIFACTS || 'browser-artifacts/sim04-kit');
const SIM = 'rapid-04-whose-number';
let checks = 0; const ok = (v, m) => { assert.ok(v, m); checks++; console.log('PASS:', m); };

const sessions = new Map();
Object.assign(store, {
  configured: () => true,
  createSession: async (c, s) => { if (sessions.has(c)) return false; sessions.set(c, structuredClone(s)); return true; },
  getSession: async c => sessions.has(c) ? structuredClone(sessions.get(c)) : null,
  compareAndSetSession: async (c, a, b) => { if (JSON.stringify(sessions.get(c)) !== JSON.stringify(a)) return false; sessions.set(c, structuredClone(b)); return true; },
  courseSessions: async course => [...sessions.values()].filter(s => !s.practice && !s.solo && s.courseId === course && !['closed', 'complete'].includes(s.state))
    .map(({ code, name, mode, state, stage }) => ({ code, name, mode, state, stage })),
  indexCourseSession: async () => {}, addCourseSession: async () => {},
  listCourseSessions: async course => [...sessions.values()].filter(s => s.courseId === course && !s.practice).map(s => s.code),
  setPracticeSession: async () => {}, getPracticeSession: async () => null, clearPracticeSession: async () => {}, wipe: async c => sessions.delete(c)
});
const handlers = { session: require('../api/session.js'), config: require('../api/config.js') };
const people = [['ana', 'Ana Lopez'], ['ben', 'Ben Ode'], ['cal', 'Cal Wu']];
const token = (sub, name, role) => signBack({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: SIM, course: 'crs_A',
  mode: role === 'student' ? 'play' : 'session', iat: Date.now(), exp: Date.now() + 3600000 });

(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/session-enrolments') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ students: people.map(([s, n]) => ({ participantId: `platform:${s}`, name: n, accessReleased: true })) }));
      }
      if (url.pathname === '/api/complete') { res.writeHead(200); return res.end('{}'); }
      let p = url.pathname.replace(/^\/sim04(?=\/|$)/, '') || '/';
      const api = p.match(/^\/api\/([a-z]+)$/);
      if (api && handlers[api[1]]) {
        const chunks = []; for await (const c of req) chunks.push(c);
        req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
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
    const fac = await open('faculty');
    await fac.goto(`${origin}/sim04/instructor.html#lt=${encodeURIComponent(token('fac', 'Vikram', 'faculty'))}`);
    await fac.locator('#create').waitFor();
    ok(await fac.locator('#create').isDisabled(), 'Start session waits for a play mode (no default)');
    ok((await fac.locator('body').innerText()).includes('Whose Number Is Right? confirmed you as faculty'), 'The page names this sim, not Midland');
    await fac.locator('[data-mode="team"]').click();
    await fac.screenshot({ path: path.join(artifacts, '01-sessions.png'), fullPage: true });
    await fac.locator('#create').click();
    await fac.locator('#faculty-workspace').waitFor();
    await fac.locator('#autoSplit').waitFor();
    await fac.waitForFunction(() => document.querySelectorAll('.fw-person').length === 3);
    ok(true, 'Approved students appear on the Teams tab');
    await fac.fill('#teamCount', '3');
    await fac.locator('#autoSplit').click();
    await fac.waitForFunction(() => document.querySelectorAll('.fw-team-card').length === 3);
    ok(true, 'Auto split makes three teams, each with a lead');
    await fac.screenshot({ path: path.join(artifacts, '02-teams.png'), fullPage: true });
    await fac.locator('#start-session').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'running');
    ok(true, 'Start session starts the clock');

    // Students from the class link, signed in, land in their team with their own sheet.
    const pages = {};
    for (const [sub, name] of people) {
      const pg = pages[sub] = await open(sub);
      await pg.goto(`${origin}/sim04/#lt=${encodeURIComponent(token(sub, name, 'student'))}`);
      await pg.locator('#introDone').waitFor({ state: 'visible' });
      if (sub === 'ana') {
        ok(await pg.locator('#materials').isHidden(), 'A student who arrives after Start reads the story first');
        await pg.screenshot({ path: path.join(artifacts, '02b-story-first.png') });
      }
      await pg.locator('#introDone').click();
      await pg.locator('#materials').waitFor({ state: 'visible' });
    }
    ok(true, 'Each student opens the class link, reads the story, then sees the data and a sheet');
    const ana = pages.ana;
    ok(!/disagree|different (definitions|numbers)/i.test(await ana.locator('body').innerText()), 'The student page gives nothing away');
    await ana.fill('#number', '90.0'); await ana.selectOption('#confidence', '4');
    await ana.locator('#commitForm button[type=submit]').click();
    await ana.locator('#afterCommit').waitFor({ state: 'visible' });
    ok((await ana.locator('#afterCommit').innerText()).includes('What did your definition count'), 'Four questions follow the number');
    await ana.screenshot({ path: path.join(artifacts, '03-student-after-commit.png'), fullPage: true });
    for (const [sub, n] of [['ben', '69.6'], ['cal', '80.0']]) {
      await pages[sub].fill('#number', n); await pages[sub].selectOption('#confidence', '3');
      await pages[sub].locator('#commitForm button[type=submit]').click();
      await pages[sub].locator('#locked').waitFor({ state: 'visible' });
    }
    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('[data-view="results"]').first().click();
    await fac.waitForFunction(() => document.querySelectorAll('#team-list .team-item').length === 3);
    const results = await fac.locator('#results-view').innerText();
    ok(results.includes('Matches its sheet') && results.includes('Off its sheet'), 'Results shows each team\'s band');
    await fac.screenshot({ path: path.join(artifacts, '04-results.png'), fullPage: true });

    // The debrief, then the review.
    await fac.locator('[data-view="debrief"]').first().click();
    await fac.locator('.md-slide').waitFor();
    ok((await fac.locator('.md-head').innerText()).startsWith('Same records. Three numbers'), 'Debrief opens on every number');
    await fac.screenshot({ path: path.join(artifacts, '05-debrief-numbers.png') });
    await fac.locator('[data-md="next"]').click();
    ok((await fac.locator('.md-head').innerText()).includes('reported 90.0%'), 'Defend your number: the two furthest apart');
    await fac.locator('[data-md="next"]').click();
    ok((await fac.locator('.md-slide').innerText()).includes('Investor Relations'), 'The definitions slide names each department');
    await fac.locator('[data-md="lesson"]').click();
    const fit = await fac.evaluate(() => { const rows = [...document.querySelectorAll('.wd-def')], foot = document.querySelector('.md-foot');
      return rows.length === 5 && rows.at(-1).getBoundingClientRect().bottom <= foot.getBoundingClientRect().top + 1; });
    ok(fit, 'All five definitions fit with the lesson open');
    await fac.screenshot({ path: path.join(artifacts, '06-debrief-definitions.png') });
    await fac.locator('[data-md="next"]').click();
    await fac.locator('select[data-md-pick="first"]').selectOption({ index: 2 });
    ok((await fac.locator('select[data-md-pick="first"]').inputValue()) !== '', 'The worked calculation slide lets you choose');
    await fac.screenshot({ path: path.join(artifacts, '07-debrief-worked.png') });
    ok(!/Matches its sheet|Off its sheet/.test(await fac.locator('#md-root').innerText()), 'The projected slides never say which number is off');

    await fac.locator('[data-session-control="review"]').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.reviewOpen === true);
    await ana.locator('#reviewForm').waitFor({ state: 'visible', timeout: 15000 });
    await ana.fill('#rv1', 'The last-day line decided it.'); await ana.fill('#rv2', 'My grade. It leaves out effort.');
    await ana.locator('#rvgo').click();
    await ana.locator('#reviewSent').waitFor({ state: 'visible' });
    ok(true, 'Release review questions, and a student answers them');
    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('[data-md-go="4"]').click();
    await fac.waitForFunction(() => document.querySelector('.md-slide')?.innerText.includes('The last-day line decided it.'));
    ok(true, 'What students said shows the review');

    await fac.locator('[data-session-control="close"]').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'closed');
    ok(true, 'Close');
    ok(errors.length === 0, 'No browser errors ' + errors.join(' | '));
    console.log(`SIM04_KIT_BROWSER_PASSED (${checks} checks). Screenshots: ${artifacts}`);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
