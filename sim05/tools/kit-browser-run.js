#!/usr/bin/env node
// Browser walk of Would You Approve This? on the shared faculty pages: a faculty member starts a session,
// two students join from the class link, the rounds run from the session bar, Results shows endings,
// the debrief plays, a student answers the review at the ending, and the Round screen opens the session.
// Real handlers and pages in Chromium; in-memory store. Run by hand (needs Playwright): node sim05/tools/kit-browser-run.js
require('../../tools/security/report-fixture.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const { chromium } = require('playwright');
process.env.LAUNCH_SECRET = 'sim05-kit-browser-secret';
delete process.env.ACCESS_CODE;
const store = require('../lib/store.js');
const C = require('../config/content.js');
const root = path.resolve(__dirname, '..');
const artifacts = path.resolve(process.env.ARTIFACTS || 'browser-artifacts/sim05-kit');
let checks = 0; const ok = (v, m) => { assert.ok(v, m); checks++; console.log('PASS:', m); };
const sessions = new Map(), people = new Map(), lists = new Map(), pointers = new Map();
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
Object.assign(store, {
  configured: () => true,
  putSession: async (c, v) => { sessions.set(c, structuredClone(v)); return v; }, getSession: async c => structuredClone(sessions.get(c) || null),
  getParticipants: async c => structuredClone(people.get(c) || {}),
  addParticipant: async (c, id, v) => { const m = people.get(c) || {}; m[id] = structuredClone(v); people.set(c, m); },
  compareAndSetSession: async (c, a, b) => { if (!same(sessions.get(c), a)) return false; sessions.set(c, structuredClone(b)); return true; },
  compareAndSetParticipant: async (c, id, a, b, s) => { if (!same(sessions.get(c), s)) return false; const m = people.get(c) || {}; if (!same(m[id], a)) return false; m[id] = structuredClone(b); people.set(c, m); return true; },
  compareAndSetRoster: async (c, a, b, s) => { if (!same(sessions.get(c), s) || !same(people.get(c) || {}, a)) return false; people.set(c, structuredClone(b)); return true; },
  ensureParticipants: async (c, list) => { const m = people.get(c) || {}; let n = 0; for (const p of list) if (!m[p.id]) { m[p.id] = structuredClone(p); n++; } people.set(c, m); return n; },
  setCourseSession: async (k, c) => pointers.set(k, c), getCourseSession: async k => pointers.get(k) || null, clearCourseSession: async (k, c) => { if (pointers.get(k) === c) pointers.delete(k); },
  addCourseSession: async (k, c, at) => { const m = lists.get(k) || new Map(); m.set(c, at); lists.set(k, m); },
  listCourseSessions: async k => [...(lists.get(k) || new Map()).keys()],
  setPracticeSession: async () => {}, getPracticeSession: async () => null, clearPracticeSession: async () => {}, wipe: async c => sessions.delete(c)
});
const handlers = { session: require('../api/session.js'), config: require('../api/config.js'), finish: require('../api/finish.js') };
const token = (sub, name, role) => { const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: C.META.id, course: 'crs_A',
  mode: role === 'student' ? 'play' : 'session', iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64url');
  return body + '.' + createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url'); };

(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/session-enrolments') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ students: [] })); }
      if (url.pathname === '/api/complete') { res.writeHead(200); return res.end('{}'); }
      const p = url.pathname.replace(/^\/sim05(?=\/|$)/, '') || '/';
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
    await fac.goto(`${origin}/sim05/instructor.html#lt=${encodeURIComponent(facLT)}`);
    await fac.locator('#create').waitFor();
    ok(await fac.locator('#create').isDisabled(), 'Start session waits for a play mode (no default)');
    ok(/how far round five goes/i.test(await fac.locator('body').innerText()), 'The Standard or Lighter choice is on the Sessions page');
    await fac.locator('[data-mode="individual"]').click();
    await fac.locator('[data-intensity="lighter"]').click();
    await fac.screenshot({ path: path.join(artifacts, '01-sessions.png'), fullPage: true });
    await fac.locator('#create').click();
    await fac.locator('#faculty-workspace').waitFor();
    const code = await fac.evaluate(() => FacultySession.page.code);
    ok([...sessions.values()][0].intensity === 'lighter', 'The session uses the Lighter setting');

    const st = {};
    for (const [sub, name] of [['ana', 'Ana Lopez'], ['ben', 'Ben Ode']]) {
      st[sub] = await open(sub);
      await st[sub].goto(`${origin}/sim05/#lt=${encodeURIComponent(token(sub, name, 'student'))}`);
      await st[sub].waitForFunction(() => document.body.innerText.includes("You're the product manager"));
    }
    ok(true, 'Students land in the class session from the class link and see the walkthrough');
    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('#start-session').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'running');
    ok(true, 'Start session');
    const roundHref = await fac.locator('a', { hasText: 'Round screen' }).getAttribute('href');
    ok(roundHref.startsWith('rounds.html?session=' + code), 'The session bar links the Round screen to this session');

    // Votes go in as the student pages send them; the session bar moves the clock.
    const vote = (sub, round, decision) => st[sub].evaluate(async ([c, r, d, t, pid]) => (await fetch('/sim05/api/session', { method: 'POST', headers: { 'content-type': 'application/json', 'x-launch-token': t },
      body: JSON.stringify({ action: 'vote', code: c, participantId: pid, round: r, decision: d }) })).status, [code, round, decision, token(sub, sub, 'student'), `platform:${sub}`]);
    const plan = { ana: ['approve', 'approve', 'approve', 'approve', 'approve'], ben: ['approve', 'decline', 'decline', 'approve', 'decline'] };
    for (let r = 1; r <= 5; r++) {
      for (let i = 0; i < 4 && (await fac.evaluate(() => FacultySession.page.state.session.clock.phase)) !== 'decide'; i++) {
        await fac.locator('[data-session-control="advance"]').click();
        await fac.waitForFunction(() => !document.querySelector('[data-session-control="advance"]')?.disabled);
        await fac.evaluate(() => FacultySession.page.refresh());
      }
      if (r === 1) { await fac.screenshot({ path: path.join(artifacts, '02-round-bar.png') }); ok((await fac.locator('#fw-startbar').innerText()).includes('Close round 1 now'), 'The session bar closes the open round, by number'); }
      for (const s of ['ana', 'ben']) await vote(s, r, plan[s][r - 1]);
      await fac.evaluate(() => FacultySession.page.refresh());
    }
    await fac.evaluate(() => FacultySession.page.refresh());
    if ((await fac.evaluate(() => FacultySession.page.state.session.clock.phase)) !== 'ending') { await fac.locator('[data-session-control="advance"]').click(); await fac.evaluate(() => FacultySession.page.refresh()); }
    await fac.waitForFunction(() => FacultySession.page.state?.kit?.ended === true);
    ok(true, 'The rounds run to the ending from the session bar');

    await fac.locator('[data-view="results"]').first().click();
    await fac.waitForFunction(() => document.querySelectorAll('#team-list .team-item').length === 2);
    const results = await fac.locator('#results-view').innerText();
    ok(results.includes('Health change, high confidence'), 'Results shows each ending, in the Lighter wording');
    ok(!/pregnan/i.test(results), 'The Lighter setting never names the inference on Results');
    await fac.screenshot({ path: path.join(artifacts, '03-results.png'), fullPage: true });

    // The student ending: questions and the review.
    const ana = st.ana;
    await ana.waitForFunction(() => document.body.innerText.includes('Four questions to keep in mind'), null, { timeout: 15000 });
    ok(true, 'Four questions follow the ending');
    await ana.fill('#rv1', 'Sleep tracking.'); await ana.fill('#rv2', 'My bank. Where I shop.');
    await ana.locator('#rvgo').click();
    await ana.waitForFunction(() => document.body.innerText.includes('Your review is saved'));
    ok(true, 'The student answers the review at the ending');
    await ana.screenshot({ path: path.join(artifacts, '04-student-ending.png'), fullPage: true });

    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('[data-view="debrief"]').first().click();
    await fac.locator('.md-slide').waitFor();
    ok((await fac.locator('.md-kicker').first().innerText()).toLowerCase().includes('where the class ended'), 'Debrief opens on the endings');
    await fac.screenshot({ path: path.join(artifacts, '05-debrief-glance.png') });
    await fac.locator('[data-md="next"]').click();
    await fac.screenshot({ path: path.join(artifacts, '06-debrief-split.png') });
    await fac.locator('[data-md="next"]').click();
    ok((await fac.locator('.ap-row').count()) === 5, 'What shipped: five rounds');
    await fac.screenshot({ path: path.join(artifacts, '07-debrief-rounds.png') });
    await fac.locator('[data-md-go="4"]').click();
    ok((await fac.locator('.md-slide').innerText()).includes('Sleep tracking.'), 'What students said shows the review');

    // The Round screen opens the same session.
    const rounds = await open('rounds');
    await rounds.goto(`${origin}/sim05/${roundHref.replace(/#lt=.*/, '')}#lt=${encodeURIComponent(facLT)}`);
    await rounds.waitForFunction(c => document.body.innerText.includes(c), code);
    ok(true, 'The Round screen opens this session');
    await rounds.screenshot({ path: path.join(artifacts, '08-round-screen.png'), fullPage: true });

    await fac.locator('[data-session-control="close"]').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'closed');
    ok(true, 'Close');
    ok(errors.length === 0, 'No browser errors ' + errors.join(' | '));
    console.log(`SIM05_KIT_BROWSER_PASSED (${checks} checks). Screenshots: ${artifacts}`);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
