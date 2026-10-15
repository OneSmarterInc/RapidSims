#!/usr/bin/env node
// Browser walk of Disaster or Breach on the shared faculty pages: a faculty member starts a class session,
// a student joins from the class link, positions and a review arrive, and the faculty Results and Debrief
// tabs show them. Real sim handlers and pages in Chromium; in-memory session storage; signed test tokens.
// Run by hand (needs Playwright): node sim/tools/kit-browser-run.js
require('../../tools/security/report-fixture.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const { chromium } = require('playwright');
process.env.LAUNCH_SECRET = 'sim01-kit-browser-secret';
const store = require('../lib/store.js');
const root = path.resolve(__dirname, '..');
const artifacts = path.resolve(process.env.ARTIFACTS || 'browser-artifacts/sim01-kit');
const SIM = 'rapid-01-disaster';
let checks = 0; const ok = (v, m) => { assert.ok(v, m); checks++; console.log('PASS:', m); };

const copy = v => v == null ? v : JSON.parse(JSON.stringify(v));
const sessions = new Map(), people = new Map(), runs = new Map(), pointers = new Map(), lists = new Map(), practice = new Map();
const hash = (m, k) => { if (!m.has(k)) m.set(k, {}); return m.get(k); };
Object.assign(store, {
  configured: () => true,
  getSession: async c => copy(sessions.get(c) || null), putSession: async (c, v) => { sessions.set(c, copy(v)); return v; },
  addParticipant: async (c, id, v) => { hash(people, c)[id] = copy(v); }, setParticipant: async (c, id, v) => { hash(people, c)[id] = copy(v); },
  getParticipants: async c => copy(hash(people, c)), setRun: async (c, id, v) => { hash(runs, c)[id] = copy(v); }, getRuns: async c => copy(hash(runs, c)),
  setCourseSession: async (course, c) => pointers.set(course, c), getCourseSession: async course => pointers.get(course) || null,
  clearCourseSession: async (course, c) => { if (pointers.get(course) === c) pointers.delete(course); },
  addCourseSession: async (course, c, at) => { const m = lists.get(course) || new Map(); m.set(c, at); lists.set(course, m); },
  listCourseSessions: async course => [...(lists.get(course) || new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
  setPracticeSession: async (course, owner, c) => practice.set(course + '|' + owner, c), getPracticeSession: async (course, owner) => practice.get(course + '|' + owner) || null,
  clearPracticeSession: async (course, owner) => practice.delete(course + '|' + owner), wipe: async c => { sessions.delete(c); }
});
const handlers = { session: require('../api/session.js'), scene: require('../api/scene.js'), review: require('../api/review.js') };
function token({ sub, name, role, course, mode = 'play' }) {
  const now = Date.now();
  const body = Buffer.from(JSON.stringify({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: SIM, mode, course, iat: now, exp: now + 3600000 })).toString('base64url');
  return `${body}.${createHmac('sha256', process.env.LAUNCH_SECRET).update(body).digest('base64url')}`;
}

(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let p = url.pathname.replace(/^\/sim01(?=\/|$)/, '') || '/';
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
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const errors = [];
  const open = async name => { const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.route(/https:\/\/fonts\./, r => r.abort()); const pg = await ctx.newPage(); pg.setDefaultTimeout(12000);
    pg.on('pageerror', e => errors.push(name + ': ' + e.message)); return pg; };
  try {
    const fac = await open('faculty');
    await fac.goto(`${origin}/sim01/instructor.html#lt=${encodeURIComponent(token({ sub: 'fac-1', name: 'Vikram', role: 'faculty', course: 'crs_A', mode: 'session' }))}`);
    await fac.locator('#create').waitFor();
    ok((await fac.locator('[data-mode]').count()) === 0, 'Sessions page: no Team choice for a solo sim');
    ok((await fac.locator('body').innerText()).includes('Every student plays on their own.'), 'Sessions page says students play on their own');
    await fac.screenshot({ path: path.join(artifacts, '01-sessions.png'), fullPage: true });
    await fac.locator('#create').click();
    await fac.locator('#faculty-workspace').waitFor();
    const code = await fac.evaluate(() => FacultySession.page.code);
    ok(/^[A-Z2-9]{5}$/.test(code), 'Session created');

    // A student from the class link lands in it, signed in.
    const stu = await open('student');
    await stu.goto(`${origin}/sim01/#lt=${encodeURIComponent(token({ sub: 'ana', name: 'Ana Lopez', role: 'student', course: 'crs_A' }))}`);
    await stu.getByRole('heading', { name: /You're in, Ana Lopez/ }).waitFor();
    ok(true, 'Student joins from the class link with no code or name');
    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('#start-session').click();
    await stu.locator('#nx').waitFor({ timeout: 15000 });
    const brief = await stu.locator('body').innerText();
    ok(/four questions to keep in mind/i.test(brief) && brief.includes('Whose answer did you trust'), 'Student sees the four lesson questions at the start');
    ok(!/bridge/i.test(brief), 'The student brief says call, not bridge');
    await stu.screenshot({ path: path.join(artifacts, '02-student-brief.png'), fullPage: true });

    // Two finished runs arrive (positions and reviews), as the student pages send them.
    const ana = token({ sub: 'ana', name: 'Ana Lopez', role: 'student', course: 'crs_A' }), ben = token({ sub: 'ben', name: 'Ben Ode', role: 'student', course: 'crs_A' });
    const post = (ep, body, lt) => fetch(`${origin}/sim01/api/${ep}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-launch-token': lt }, body: JSON.stringify(body) }).then(r => r.json());
    await post('session', { action: 'join', code }, ben);
    const P = (r1, a1, r2, a2, r3, a3) => [{ reading: r1, action: a1, tripwire: 'If a second array fails.' }, { reading: r2, action: a2, tripwire: 'If it crosses arrays.' }, { reading: r3, action: a3, tripwire: 'If the audit is clean.' }];
    const anaRun = P('hardware', 'image_first', 'both', 'isolate', 'both', 'notify'), benRun = P('hardware', 'restore_now', 'hardware', 'restore_clean', 'hardware', 'restore_clean');
    await post('session', { action: 'submit', code, groupId: 'platform:ana', participantId: 'platform:ana', positions: anaRun, phase: 3, done: true, coverageEarnedAt: 0, coveragePrivate: true, privateCount: 1 }, ana);
    await post('session', { action: 'submit', code, groupId: 'platform:ben', participantId: 'platform:ben', positions: benRun, phase: 3, done: true }, ben);
    await post('review', { code, reflection1: 'Sophia, once she said where she could not see.', reflection2: 'Image first at Hour 4.', positions: anaRun, coverageEarnedAt: 0, coveragePrivate: true, privateCount: 1 }, ana);
    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('[data-view="results"]').first().click();
    await fac.waitForFunction(() => document.querySelectorAll('#team-list .team-item').length === 2);
    const results = await fac.locator('#results-view').innerText();
    ok(results.includes('Ready for both') && results.includes('Evidence gone'), 'Results tab shows each student\'s band');
    await fac.screenshot({ path: path.join(artifacts, '03-results.png'), fullPage: true });
    await fac.locator('[data-open-team]').first().click();
    const answers = await fac.locator('#response-content').innerText();
    ok(answers.includes('Sophia, once she said where she could not see.') && answers.includes('At Hour 4, whose account did you trust most'), 'Each review shows under its question');
    await fac.locator('#tab-positions').click();
    ok((await fac.locator('#response-content').innerText()).includes('Isolate and hold'), 'Positions tab shows the locked actions');
    await fac.screenshot({ path: path.join(artifacts, '04-student-detail.png'), fullPage: true });

    // The class debrief.
    await fac.locator('[data-view="debrief"]').first().click();
    await fac.locator('.md-slide').waitFor();
    ok((await fac.locator('.md-head').innerText()).startsWith('Same incident call. Same four advisers.'), 'Debrief opens on the glance slide');
    await fac.screenshot({ path: path.join(artifacts, '05-debrief-glance.png') });
    for (let i = 0; i < 5; i++) await fac.locator('[data-md="next"]').click();
    ok((await fac.locator('.md-head').innerText()).includes('coverage gap'), 'Question 4 slide');
    await fac.screenshot({ path: path.join(artifacts, '06-debrief-q4.png') });
    await fac.locator('[data-md="next"]').click();
    ok((await fac.locator('.md-slide').innerText()).includes('Sophia, once she said where she could not see.'), 'What students said shows the review');

    // Close: the class link no longer finds the session.
    fac.on('dialog', d => d.accept());
    await fac.locator('[data-session-control="close"]').click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'closed');
    ok((await post('session', { action: 'course_session' }, ana)).code === null, 'A closed session takes no students');
    ok(errors.length === 0, 'No browser errors ' + errors.join(' | '));
    console.log(`SIM01_KIT_BROWSER_PASSED (${checks} checks). Screenshots: ${artifacts}`);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
