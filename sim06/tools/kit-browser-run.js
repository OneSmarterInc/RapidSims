#!/usr/bin/env node
// Browser walk of Do We Switch? on the shared faculty pages: a faculty member starts a session, two students
// join from the class link, the clock starts from the session bar (no pause), each student decides, Results
// shows the bands, a student answers the review under the reveal, the debrief plays, and the Live screen
// opens the session. Real handlers and pages in Chromium; in-memory store; the server clock is moved forward.
// Run by hand (needs Playwright): node sim06/tools/kit-browser-run.js
require('../../tools/security/report-fixture.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const { chromium } = require('playwright');
process.env.LAUNCH_SECRET = 'sim06-kit-browser-secret';
delete process.env.ACCESS_CODE;
const store = require('../lib/store.js');
const cfg = require('../data/config.js');
const root = path.resolve(__dirname, '..');
const artifacts = path.resolve(process.env.ARTIFACTS || 'browser-artifacts/sim06-kit');
let checks = 0; const ok = (v, m) => { assert.ok(v, m); checks++; console.log('PASS:', m); };
const sessions = new Map(), people = new Map(), runs = new Map(), lists = new Map(), pointers = new Map();
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const field = (map, c) => { if (!map.has(c)) map.set(c, {}); return map.get(c); };
Object.assign(store, {
  configured: () => true,
  putSession: async (c, v) => { sessions.set(c, structuredClone(v)); return v; }, getSession: async c => structuredClone(sessions.get(c) || null),
  compareAndSetSession: async (c, a, b) => { if (!same(sessions.get(c), a)) return false; sessions.set(c, structuredClone(b)); return true; },
  getParticipants: async c => structuredClone(people.get(c) || {}), getParticipant: async (c, id) => structuredClone((people.get(c) || {})[id] || null),
  compareAndSetParticipant: async (c, id, a, b) => { const m = field(people, c); if (!same(m[id], a)) return false; m[id] = structuredClone(b); return true; },
  getRun: async (c, id) => structuredClone((runs.get(c) || {})[id] || null), getRuns: async c => structuredClone(runs.get(c) || {}),
  compareAndSetRun: async (c, id, a, b) => { const m = field(runs, c); if (!same(m[id], a)) return false; m[id] = structuredClone(b); return true; },
  setCourseSession: async (k, c) => pointers.set(k, c), getCourseSession: async k => pointers.get(k) || null, clearCourseSession: async (k, c) => { if (pointers.get(k) === c) pointers.delete(k); },
  addCourseSession: async (k, c, at) => { const m = lists.get(k) || new Map(); m.set(c, at); lists.set(k, m); },
  listCourseSessions: async k => [...(lists.get(k) || new Map()).keys()],
  setPracticeSession: async () => {}, getPracticeSession: async () => null, clearPracticeSession: async () => {}, wipe: async c => sessions.delete(c)
});
const handlers = { session: require('../api/session.js'), config: require('../api/config.js') };
// The server clock: real time plus whatever the walk skips ahead.
let skip = 0;
handlers.session._now = () => Date.now() + skip;
const token = (sub, name, role) => { const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: cfg.sim.id, course: 'crs_A',
  mode: role === 'student' ? 'play' : 'session', iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64url');
  return body + '.' + createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url'); };

(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/session-enrolments') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ students: [] })); }
      if (url.pathname === '/api/complete' || url.pathname === '/api/register') { res.writeHead(200); return res.end('{}'); }
      const p = url.pathname.replace(/^\/sim06(?=\/|$)/, '') || '/';
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
    await fac.goto(`${origin}/sim06/instructor.html#lt=${encodeURIComponent(facLT)}`);
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
      await st[sub].goto(`${origin}/sim06/#lt=${encodeURIComponent(token(sub, name, 'student'))}`);
      await st[sub].waitForFunction(() => /what is going on/i.test(document.body.innerText));
      ok(st[sub].url().includes('session=' + code), `${name} lands in the class session from the class link`);
      await st[sub].locator('#skip').click();
      await st[sub].waitForFunction(() => document.body.innerText.includes('Waiting for your instructor'));
    }
    ok(!/\broom\b/i.test(await st.ana.locator('body').innerText()), 'No "room" on the student page');
    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('#start-session').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'running');
    ok(true, 'Start session');
    const bar = await fac.locator('#fw-startbar').innerText();
    ok(!/pause/i.test(bar), 'No Pause button: the clock runs ten minutes for every student');
    const liveHref = await fac.locator('a', { hasText: 'Live screen' }).getAttribute('href');
    ok(liveHref.startsWith('live.html?session=' + code), 'The session bar links the Live screen to this session');
    await fac.screenshot({ path: path.join(artifacts, '02-running.png') });

    // Each student decides on their own page.
    const decide = async (sub, choice, reason) => {
      const pg = st[sub];
      await pg.locator(`[data-c="${choice}"]`).click();
      await pg.fill('#why', reason);
      await pg.locator('#ok').click();
      await pg.waitForFunction(() => /decision recorded/i.test(document.body.innerText));
    };
    skip = cfg.reports[1].atSeconds * 1000 + 2000;
    await st.ana.waitForFunction(() => /report 2 of/i.test(document.body.innerText));
    await decide('ana', 'switch', 'Every store is failing.');
    skip = cfg.reports[4].atSeconds * 1000 + 2000;
    await st.ben.waitForFunction(() => /report 5 of/i.test(document.body.innerText));
    await decide('ben', 'stay', 'Both documents name the same carrier.');
    ok(true, 'Both students decide');

    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('[data-view="results"]').first().click();
    await fac.waitForFunction(() => document.querySelectorAll('#team-list .team-item').length === 2);
    const results = await fac.locator('#results-view').innerText();
    ok(/Switched/.test(results) && /Held/.test(results), 'Results shows each decision as a band');
    await fac.screenshot({ path: path.join(artifacts, '03-results.png'), fullPage: true });

    // The clock ends: the reveal, the questions, the review.
    skip = 600_000 + 3000;
    const ana = st.ana;
    await ana.waitForFunction(() => /think about it/i.test(document.body.innerText), null, { timeout: 15000 });
    ok(true, 'Four questions follow the reveal');
    await ana.fill('#rv1', 'Report 2. A map of who carries what.'); await ana.fill('#rv2', 'Our LMS. Its cloud host.');
    await ana.locator('#review-send').click();
    await ana.waitForFunction(() => document.body.innerText.includes('Sent to your instructor'));
    ok(true, 'The student answers the review under the reveal');
    await ana.screenshot({ path: path.join(artifacts, '04-student-reveal.png'), fullPage: true });

    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('[data-view="debrief"]').first().click();
    await fac.locator('.md-slide').waitFor();
    ok((await fac.locator('.md-kicker').first().innerText()).toLowerCase().includes('where the class decided'), 'Debrief opens on the decisions');
    await fac.screenshot({ path: path.join(artifacts, '05-debrief-glance.png') });
    await fac.locator('[data-md="next"]').click();
    ok((await fac.locator('.md-slide').innerText()).includes('Every store is failing.'), 'The split quotes the reasons');
    await fac.screenshot({ path: path.join(artifacts, '06-debrief-split.png') });
    await fac.locator('[data-md="next"]').click();
    ok((await fac.locator('.sw-map').count()) === 1, 'The reveal slide draws the map');
    await fac.screenshot({ path: path.join(artifacts, '07-debrief-reveal.png') });
    await fac.locator('[data-md-go="4"]').click();
    ok((await fac.locator('.md-slide').innerText()).includes('Report 2. A map of who carries what.'), 'What students said shows the review');
    await fac.locator('[data-md-go="5"]').click();
    await fac.screenshot({ path: path.join(artifacts, '08-debrief-lessons.png') });

    // The Live screen opens the same session.
    const live = await open('live');
    await live.goto(`${origin}/sim06/${liveHref.replace(/#lt=.*/, '')}#lt=${encodeURIComponent(facLT)}`);
    await live.waitForFunction(c => document.body.innerText.includes(c), code);
    ok(/decisions by report/i.test(await live.locator('body').innerText()), 'The Live screen opens this session');
    await live.screenshot({ path: path.join(artifacts, '09-live-screen.png'), fullPage: true });

    await fac.locator('[data-session-control="close"]').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'closed');
    ok(true, 'Close');
    ok(errors.length === 0, 'No browser errors ' + errors.join(' | '));
    console.log(`SIM06_KIT_BROWSER_PASSED (${checks} checks). Screenshots: ${artifacts}`);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
