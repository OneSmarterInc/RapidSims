#!/usr/bin/env node
// Browser walk of Eighteen Months Later on the shared faculty pages: a faculty member starts a session, two
// students join from the class link, the session bar opens each part, the students ask, choose a vendor and a
// plan, Results shows outcomes, a student answers the review with the report, the debrief plays, and the Live
// screen opens the session. Real handlers and pages in Chromium; in-memory store.
// Run by hand (needs Playwright): node sim08/tools/kit-browser-run.js
require('../../tools/security/report-fixture.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const { chromium } = require('playwright');
process.env.LAUNCH_SECRET = 'sim08-kit-browser-secret';
delete process.env.ACCESS_CODE;
const store = require('../lib/store.js');
const S8 = require('../lib/scenario.js');
const root = path.resolve(__dirname, '..');
const artifacts = path.resolve(process.env.ARTIFACTS || 'browser-artifacts/sim08-kit');
let checks = 0; const ok = (v, m) => { assert.ok(v, m); checks++; console.log('PASS:', m); };
const runsMap = new Map();
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
  setPracticeSession: async () => {}, getPracticeSession: async () => null, clearPracticeSession: async () => {}, wipe: async c => sessions.delete(c),
  getRuns: async c => structuredClone(runsMap.get(c) || {}),
  compareAndSetRun: async (c, id, a, b, s) => { if (!same(sessions.get(c), s)) return false; const m = runsMap.get(c) || {}; if (!same(m[id], a)) return false; m[id] = structuredClone(b); runsMap.set(c, m); return true; }
});
const handlers = { session: require('../api/session.js'), config: require('../api/config.js'), finish: require('../api/finish.js') };
const token = (sub, name, role) => { const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: S8.META.id, course: 'crs_A',
  mode: role === 'student' ? 'play' : 'session', iat: Date.now(), exp: Date.now() + 36e5 })).toString('base64url');
  return body + '.' + createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url'); };

(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/session-enrolments') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ students: [] })); }
      if (url.pathname === '/api/complete' || url.pathname === '/api/register') { res.writeHead(200); return res.end('{}'); }
      const p = url.pathname.replace(/^\/sim08(?=\/|$)/, '') || '/';
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
    await fac.goto(`${origin}/sim08/instructor.html#lt=${encodeURIComponent(facLT)}`);
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
      await st[sub].goto(`${origin}/sim08/?guest=1#lt=${encodeURIComponent(token(sub, name, 'student'))}`);
      await st[sub].waitForFunction(() => /you're in/i.test(document.body.innerText));
      ok(st[sub].url().includes('session=' + code), `${name} lands in the class session from the class link`);
    }
    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('#start-session').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'running');
    ok(true, 'Start session');
    const liveHref = await fac.locator('a', { hasText: 'Live screen' }).getAttribute('href');
    ok(liveHref.startsWith('live.html?session=' + code), 'The session bar links the Live screen to this session');
    const advanceTo = async phase => {
      for (let i = 0; i < 6 && (await fac.evaluate(() => FacultySession.page.state.session.clock.phase)) !== phase; i++) {
        await fac.locator('[data-session-control="advance"]').click();
        await fac.waitForFunction(() => !document.querySelector('[data-session-control="advance"]')?.disabled);
        await fac.evaluate(() => FacultySession.page.refresh());
      }
    };
    ok((await fac.locator('#fw-startbar').innerText()).includes('Open the demonstrations now'), 'The session bar opens the next part');
    await advanceTo('questions');
    await fac.screenshot({ path: path.join(artifacts, '02-session-bar.png') });

    // Ana asks on her page; Ben through the same API the page uses.
    const ana = st.ana;
    await ana.locator('[data-q="q10"]').waitFor();
    await ana.locator('[data-q="q10"]').click(); await ana.locator('#yes').click();
    await ana.waitForFunction(() => /first three months/i.test(document.querySelector('.cols section:last-child')?.innerText || ''));
    ok(true, 'Ana asks a question and sees the three answers');
    const send = (sub, body) => st[sub].evaluate(async ([c, b, t, pid]) => (await fetch('/sim08/api/session', { method: 'POST', headers: { 'content-type': 'application/json', 'x-launch-token': t },
      body: JSON.stringify({ ...b, code: c, participantId: pid }) })).status, [code, body, token(sub, sub, 'student'), `platform:${sub}`]);
    await send('ben', { action: 'ask', question: 'q01' });
    await ana.screenshot({ path: path.join(artifacts, '02b-student-questions.png'), fullPage: true });
    await advanceTo('commit');
    await ana.locator('[data-k="kestrel"]').waitFor();
    await ana.locator('[data-k="kestrel"]').click(); await ana.locator('#yes').click();
    await send('ben', { action: 'vote', kind: 'vendor', choice: 'pawtime' });
    await advanceTo('plan');
    await ana.locator('[data-k="cover"]').waitFor();
    await ana.locator('[data-k="cover"]').click(); await ana.locator('#yes').click();
    await send('ben', { action: 'vote', kind: 'plan', choice: 'parallel' });
    await advanceTo('report');
    await fac.waitForFunction(() => FacultySession.page.state?.kit?.ended === true);
    ok(true, 'The parts run to the report from the session bar');

    await fac.locator('[data-view="results"]').first().click();
    await fac.waitForFunction(() => document.querySelectorAll('#team-list .team-item').length === 2);
    const results = await fac.locator('#results-view').innerText();
    ok(/Adopted/.test(results) && /Shadow system/.test(results), 'Results shows each outcome');
    await fac.screenshot({ path: path.join(artifacts, '03-results.png'), fullPage: true });

    await ana.waitForFunction(() => /think about it/i.test(document.body.innerText), null, { timeout: 15000 });
    ok(true, 'Four questions follow the report');
    await ana.fill('#rv1', 'The front desk question.'); await ana.fill('#rv2', 'Our LMS. A shared drive.');
    await ana.locator('#rvgo').click();
    await ana.waitForFunction(() => document.body.innerText.includes('Sent to your instructor'));
    ok(true, 'The student answers the review with the report');
    await ana.screenshot({ path: path.join(artifacts, '04-student-report.png'), fullPage: true });

    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('[data-view="debrief"]').first().click();
    await fac.locator('.md-slide').waitFor();
    ok((await fac.locator('.md-kicker').first().innerText()).toLowerCase().includes('eighteen months on'), 'Debrief opens on the outcomes');
    for (let i = 0; i < 6; i++) {
      await fac.screenshot({ path: path.join(artifacts, `0${5 + i}-debrief-${i + 1}.png`) });
      if (i < 5) await fac.locator('[data-md="next"]').click();
    }
    await fac.locator('[data-md-go="2"]').click();
    const quiet = await fac.locator('.md-slide').innerText();
    ok((await fac.locator('.lt-q').count()) < 16 && /other questions?, nobody asked/i.test(quiet), 'Where the warnings were: warning or asked questions, the rest in one line');
    await fac.locator('[data-md-go="4"]').click();
    ok((await fac.locator('.md-slide').innerText()).includes('The front desk question.'), 'What students said shows the review');

    const live = await open('live');
    await live.goto(`${origin}/sim08/${liveHref.replace(/#lt=.*/, '')}#lt=${encodeURIComponent(facLT)}`);
    await live.waitForFunction(c => document.body.innerText.includes(c), code);
    ok(!/\broom\b/i.test(await live.locator('body').innerText()), 'The Live screen opens this session, with no "room"');
    await live.screenshot({ path: path.join(artifacts, '11-live-screen.png'), fullPage: true });

    await fac.locator('[data-session-control="close"]').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'closed');
    ok(true, 'Close');
    ok(errors.length === 0, 'No browser errors ' + errors.join(' | '));
    console.log(`SIM08_KIT_BROWSER_PASSED (${checks} checks). Screenshots: ${artifacts}`);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
