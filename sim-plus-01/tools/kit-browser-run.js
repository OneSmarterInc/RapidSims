#!/usr/bin/env node
// Browser walk of Why Don't They Have Any Patience? on the shared faculty pages: a faculty member starts a session,
// a student from the class link waits for Start, plays a run (through the real API), sees the outcome and sends the
// review; Results shows the band, the interviews and the report; the debrief plays. Real handlers and pages in
// Chromium; in-memory store. Run by hand (needs Playwright): node sim-plus-01/tools/kit-browser-run.js
'use strict';
require('../../tools/security/report-fixture.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
process.env.LAUNCH_SECRET = 'simplus01-kit-browser-secret';
delete process.env.ACCESS_CODE; delete process.env.FACULTY_CODE;
const store = require('../lib/store');
const raw = new Map(), sessions = new Map(), hashes = new Map(), hash = c => hashes.get(c) || hashes.set(c, new Map()).get(c);
Object.assign(store, {
  configured: () => true,
  getRaw: async k => raw.has(k) ? JSON.parse(raw.get(k)) : null,
  putRaw: async (k, v) => { raw.set(k, JSON.stringify(v)); return v; },
  getSession: async c => sessions.has(c) ? JSON.parse(sessions.get(c)) : null,
  putSession: async (c, v) => { sessions.set(c, JSON.stringify(v)); return v; },
  getParticipant: async (c, id) => hash(c).has(id) ? JSON.parse(hash(c).get(id)) : null,
  getParticipants: async c => Object.fromEntries([...hash(c)].map(([k, v]) => [k, JSON.parse(v)])),
  setParticipant: async (c, id, v) => { hash(c).set(id, JSON.stringify(v)); },
  addParticipant: async (c, id, v) => { hash(c).set(id, JSON.stringify(v)); },
  addParticipantIfNew: async (c, id, v) => { if (!hash(c).has(id)) hash(c).set(id, JSON.stringify(v)); },
  wipe: async c => { sessions.delete(c); hashes.delete(c); }
});
const { signBack } = require('../lib/launch');
const handlers = { '/api/run': require('../api/run'), '/api/session': require('../api/session') };
const PUBLIC = path.join(__dirname, '../public'), KIT = path.join(__dirname, '../../platform/public/kit');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const artifacts = path.resolve(process.env.ARTIFACTS || 'browser-artifacts/simplus01-kit');
let checks = 0; const ok = (v, m) => { assert.ok(v, m); checks++; console.log('PASS:', m); };
const token = (sub, name, role) => signBack({ kind: 'launch', run: 'lch-' + sub, sub, name, role, sim: 'rapidsimplus-01', course: 'crs_A',
  mode: role === 'student' ? 'play' : 'session', iat: Date.now(), exp: Date.now() + 36e5 });

async function api(lt, action, extra = {}) {
  const req = { method: 'POST', headers: { 'x-launch-token': lt }, body: { action, ...extra } };
  let status = 200, payload; const res = { status(n) { status = n; return this; }, json(v) { payload = v; return this; }, end() { return this; } };
  await handlers['/api/run'](req, res);
  assert.equal(status, 200, `${action}: ${JSON.stringify(payload)}`);
  return payload;
}

(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      let body = ''; for await (const c of req) body += c;
      req.body = body ? JSON.parse(body) : {};
      const url = new URL(req.url, 'http://x');
      res.status = n => { res.statusCode = n; return res; };
      res.json = v => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(v)); return res; };
      if (url.pathname === '/api/session-enrolments') return res.json({ students: [{ participantId: 'platform:stu1', name: 'Ana Student', accessReleased: true }] });
      // The platform's faculty helper, stubbed: available, and an answer naming "Student 1".
      if (url.pathname === '/api/faculty') return res.json(req.body.action === 'assist_status' ? { available: true, allowance: { left: 30, limit: 30 } }
        : { answer: 'Student 1 kept the review desk. Plan for **70 minutes**.\n\n- Observation\n- Interviews', names: { 'Student 1': 'Ana Student' }, allowance: { left: 29, limit: 30 } });
      if (url.pathname === '/api/one-pager') { req.query = Object.fromEntries(url.searchParams); res.setHeader = res.setHeader.bind(res); return require('../../platform/api/one-pager')(req, res); }
      if (!url.pathname.startsWith('/sim-plus-01')) return res.status(404).json({ error: 'Not found' });
      const mounted = url.pathname.slice('/sim-plus-01'.length) || '/';
      if (handlers[mounted]) return await handlers[mounted](req, res);
      const file = mounted.startsWith('/kit/') ? path.join(KIT, mounted.slice(5)) : path.join(PUBLIC, mounted === '/' ? 'index.html' : mounted.slice(1));
      if (!fs.existsSync(file)) return res.status(404).end();
      res.setHeader('content-type', TYPES[path.extname(file)] || 'text/plain'); res.end(fs.readFileSync(file));
    } catch (e) { console.error(e); res.statusCode = 500; res.end('fixture failed'); }
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
    await fac.goto(`${origin}/sim-plus-01/#lt=${encodeURIComponent(facLT)}`);
    await fac.waitForURL(/instructor\.html/);
    ok(true, 'A faculty session launch lands on the shared Sessions pages');
    await fac.locator('#aboutSim summary').click();
    await fac.locator('#aboutSimBody h2').waitFor();
    ok((await fac.locator('#aboutSimBody').innerText()).includes('Why Don\'t They Have Any Patience?'), 'Sessions page: About this sim shows the one-pager');
    await fac.screenshot({ path: path.join(artifacts, '00-about-this-sim.png'), fullPage: true });
    await fac.locator('#create').click();
    await fac.locator('#faculty-workspace').waitFor();
    const code = await fac.evaluate(() => FacultySession.page.code);
    ok(/^[A-Z2-9]{5}$/.test(code), 'Start a session: the faculty pages call the sim at /sim-plus-01');

    const stuLT = token('stu1', 'Ana Student', 'student');
    const stu = await open('student');
    await stu.goto(`${origin}/sim-plus-01/#lt=${encodeURIComponent(stuLT)}`);
    await stu.getByText('Your instructor starts the session shortly').waitFor();
    ok(true, 'Before Start, the student waits');
    await fac.evaluate(() => FacultySession.page.refresh());
    const start = fac.locator('#start-session'); await start.waitFor(); await start.click();
    await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'running');
    await stu.getByText('Participant brief').waitFor({ timeout: 20000 });
    ok(true, 'After Start, the student opens the brief');

    // The run, through the real API with the student's own launch.
    let s = await api(stuLT, 'start', { order: ['terry', 'ray', 'ruth'], observationSeconds: 30 });
    for (const q of ['Who actually reads the log?', 'Who uses it now?', 'Why does the log exist?']) await api(stuLT, 'ask', { question: q });
    await api(stuLT, 'advance');
    for (const q of ['What does the sender hear back after they fax a claim?', 'What time does the last batch go?']) await api(stuLT, 'ask', { question: q });
    await api(stuLT, 'advance');
    for (const q of ['What happens when two copies look alike?', 'Could this step be automated?']) await api(stuLT, 'ask', { question: q });
    await api(stuLT, 'advance');
    const v = (x = 'Established in the interviews') => ({ value: x, couldNotEstablish: false });
    await api(stuLT, 'save_chart', { chart: { intake: { longestWait: v(), faxRouting: { value: '', couldNotEstablish: true }, providerReceipt: v() }, log: { purpose: v(), receiver: v() },
      review: { step: v(), owner: v('Ruth Kessler'), receiver: v(), catches: v(), dependsOn: v() } } });
    const rows = {}; for (const r of ['intake', 'log', 'vendor', 'review']) rows[r] = { disposition: { intake: 'automate', log: 'eliminate', vendor: 'cannot_assess', review: 'keep' }[r], justification: 'Supported by what the interviews established.' };
    await api(stuLT, 'submit', { submission: { rootCause: 'Senders hear nothing back and send claims again days later.', rows } });

    await stu.reload();
    await stu.getByText('What your report configures').waitFor();
    ok(/Your review/.test(await stu.locator('body').innerText()), 'After the report, the review questions follow the outcome');
    await stu.fill('#rv1', 'Asking who reads the log opened Terry up.'); await stu.dispatchEvent('#rv1', 'input');
    await stu.fill('#rv2', 'I would ask Ruth about exceptions first.'); await stu.dispatchEvent('#rv2', 'input');
    await stu.getByRole('button', { name: 'Send review' }).click();
    await stu.getByText('Review sent').waitFor();
    ok(true, 'The student sends the review');
    await stu.screenshot({ path: path.join(artifacts, '01-student-outcome.png'), fullPage: true });

    await fac.evaluate(() => FacultySession.page.refresh());
    await fac.locator('[data-view="results"]').first().click();
    await fac.waitForFunction(() => document.querySelectorAll('#team-list .team-item').length === 1);
    const resultsText = await fac.locator('#results-view').innerText();
    ok(/Matching kept|Sent for a second study|Duplicates paid/.test(resultsText), 'Results shows the band');
    await fac.screenshot({ path: path.join(artifacts, '02-results.png'), fullPage: true });

    await fac.locator('[data-view="debrief"]').first().click();
    await fac.locator('.md-slide').waitFor();
    ok((await fac.locator('.md-kicker').first().innerText()).toLowerCase().includes('review desk'), 'Debrief opens on how the class filed the review desk');
    for (let i = 0; i < 7; i++) {
      await fac.screenshot({ path: path.join(artifacts, `${String(3 + i).padStart(2, '0')}-debrief-${i + 1}.png`) });
      if (i < 6) await fac.locator('[data-md="next"]').click();
    }
    await fac.locator('[data-md-go="5"]').click();
    ok((await fac.locator('.md-slide').innerText()).includes('opened Terry up'), 'What students said shows the review');
    await fac.locator('.fs-helper-open').click();
    await fac.fill('#fsHelperQ', 'Who kept the desk?');
    await fac.locator('.fs-helper-form button').click();
    await fac.locator('.fs-helper-a').waitFor();
    ok((await fac.locator('.fs-helper-a').innerText()).includes('Ana Student kept the review desk.'), 'Ask about this sim: the answer shows the real name');
    ok((await fac.locator('.fs-helper-panel').innerText()).includes('29 of 30 questions left'), 'Ask about this sim: questions left this month');
    ok(await fac.locator('.fs-helper-a b').innerText() === '70 minutes' && await fac.locator('.fs-helper-a li').count() === 2, 'Ask about this sim: bold and lists show as formatting');
    ok((await fac.locator('.fs-helper-panel').boundingBox()).height >= 700, 'Ask about this sim: the panel opens tall');
    await fac.screenshot({ path: path.join(artifacts, '10-helper.png') });
    ok(errors.length === 0, 'No browser errors ' + errors.join(' | '));
    console.log(`SIMPLUS01_KIT_BROWSER_PASSED (${checks} checks). Screenshots: ${artifacts}`);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
