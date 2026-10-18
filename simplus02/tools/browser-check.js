'use strict';
// Disposable HTTP/platform fixture; runs the shipped pages in Chromium. A faculty member starts a session on the
// shared faculty pages, four students join from the class link and read the walkthrough, the table is split and
// started (Start anyway for the one still reading), the session bar moves the phases on, the table signs the
// threshold, a staff notice reaches it, the sheet closes, Results shows the band, a student answers the review,
// the debrief plays and the Live screen opens. Run: NODE_PATH=<playwright> node simplus02/tools/browser-check.js
require('../../tools/security/report-fixture.cjs');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { store, keys } = require('../lib/store');
const C = require('../data/config');
const L = require('../lib/launch');
process.env.LAUNCH_SECRET = 'browser-fixture-secret';
delete process.env.ACCESS_CODE; delete process.env.FACULTY_CODES;
const db = new Map(), reports = new Map(), errors = [];
Object.assign(store, {
  configured: () => true,
  get: async k => db.has(k) && db.get(k) ? JSON.parse(db.get(k)) : null,
  getMany: async ks => ks.map(k => db.has(k) && db.get(k) ? JSON.parse(db.get(k)) : null),
  cas: async (k, previous, next) => {
    if ((db.get(k) || '') !== (previous == null ? '' : JSON.stringify(previous))) return false;
    db.set(k, next == null ? '' : JSON.stringify(next)); return true;
  },
});
const handlers = { '/api/session': require('../api/session'), '/api/finish': require('../api/finish'), '/api/health': require('../api/health') };
const PUBLIC = path.join(__dirname, '../public'), KIT = path.join(__dirname, '../../platform/public/kit');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    req.body = raw ? JSON.parse(raw) : {};
    const url = new URL(req.url, 'http://fixture');
    res.status = n => { res.statusCode = n; return res; };
    res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (url.pathname === '/platform/api/session-enrolments') return res.json({ students: [0, 1, 2, 3].map(i => ({ participantId: 'platform:student' + i, name: 'Student ' + i, accessReleased: true })) });
    if (url.pathname.startsWith('/platform/api/')) {
      if (url.pathname.endsWith('/complete')) {
        const p = require('../../shared/report-contract').verifyReport(req.body.token, 'complete'); assert.ok(p, 'completion reports are signed');
        reports.set(p.sub, (reports.get(p.sub) || 0) + 1);
      }
      return res.json({ ok: true });
    }
    const mounted = url.pathname.replace(/^\/simplus02(?=\/|$)/, '') || '/';
    // The platform's own pages and APIs answer Not found, so every sim call must carry the /simplus02 prefix.
    if (!url.pathname.startsWith('/simplus02')) return res.status(404).json({ error: 'Not found' });
    if (handlers[mounted]) return await handlers[mounted](req, res);
    const file = mounted.startsWith('/kit/') ? path.join(KIT, mounted.slice(5)) : path.join(PUBLIC, mounted === '/' ? 'index.html' : mounted.slice(1));
    if (!fs.existsSync(file)) return res.status(404).end();
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'text/plain');
    res.end(fs.readFileSync(file));
  } catch (e) { errors.push(e.message); res.statusCode = 500; res.end('fixture failed'); }
});
function token(sub, role = 'student', mode = 'play', name = sub) {
  const raw = Buffer.from(JSON.stringify({ kind: 'launch', run: 'run-' + sub, sim: C.id, sub, role, mode, course: 'class1', name, iat: Date.now(), exp: Date.now() + 3600000 })).toString('base64url');
  return raw + '.' + crypto.createHmac('sha256', process.env.LAUNCH_SECRET).update(raw).digest('base64url');
}
let browser, checks = 0;
const fitsPhone = async pg => { const vp = pg.viewportSize(); await pg.setViewportSize({ width: 390, height: 844 }); await pg.waitForTimeout(100);
  const w = await pg.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); await pg.setViewportSize(vp); return w[0] <= w[1]; };
const ok = (v, m) => { assert.ok(v, m); checks++; console.log('PASS:', m); };
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.env.PLATFORM_URL = origin + '/platform'; process.env.SIM_URL = origin + '/simplus02';
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  async function page(name) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.route(/https:\/\/fonts\./, route => route.fulfill({ status: 200, body: '' }));
    const p = await context.newPage(); p.setDefaultTimeout(15000);
    p.on('pageerror', error => errors.push(name + ': ' + error.message)); p.on('dialog', d => d.accept());
    return p;
  }
  const facLT = token('teacher', 'faculty', 'session', 'Vikram');
  const fac = await page('faculty');
  await fac.goto(origin + '/simplus02/#lt=' + facLT);
  await fac.waitForURL(/instructor\.html/);
  await fac.locator('#create').waitFor();
  ok(await fac.locator('#create').isEnabled(), 'Team play needs no mode choice');
  await fac.locator('#create').click();
  await fac.locator('#faculty-workspace').waitFor();
  const code = await fac.evaluate(() => FacultySession.page.code);
  ok(/^[A-Z2-9]{5}$/.test(code), 'A faculty launch starts a session on the shared pages');

  const students = [];
  for (let i = 0; i < 4; i++) {
    const s = await page('student' + i); students.push(s);
    await s.goto(origin + '/simplus02/#lt=' + token('student' + i, 'student', 'play', 'Student ' + i));
    await s.getByRole('heading', { name: 'What this proceeding decides' }).waitFor();
  }
  ok(Object.keys(await store.get(keys.roster(code))).length === 4, 'Four students land in the session from the class link');
  for (const s of students.slice(0, 3)) {
    for (let step = 1; step <= 4; step++) { await s.locator('#walk-next').click(); await s.waitForFunction(n => view.walkthrough.step >= n, step); }
    await s.getByText('Walkthrough complete.', { exact: false }).waitFor();
  }
  ok(true, 'Three students finish the walkthrough');

  await fac.evaluate(() => FacultySession.page.refresh());
  await fac.locator('#teamCount').fill('1');
  await fac.locator('#autoSplit').click();
  await fac.waitForFunction(() => document.querySelectorAll('.fw-team-card').length === 1);
  ok(true, 'Auto split: one table of four');
  await fac.evaluate(() => FacultySession.page.refresh());
  const anyway = fac.locator('[data-session-control="start_anyway"]');
  await anyway.waitFor();
  ok((await anyway.innerText()).includes('1 still reading'), 'Start anyway names how many are still reading');
  await fac.screenshot({ path: path.join(artifacts(), '01-lobby.png') });
  await anyway.click();
  await fac.waitForFunction(() => FacultySession.page.state?.session?.phase === 'briefing');
  ok(true, 'Start anyway: the briefing runs');
  await students[3].getByRole('heading', { name: 'Your seat' }).waitFor();
  ok(true, 'The student still reading goes straight to the brief');

  const press = async label => {
    const b = fac.locator('[data-session-control]', { hasText: label });
    await b.waitFor(); await b.click();
    await fac.waitForFunction(() => !document.querySelector('[data-session-control]:not(.fw-close)')?.disabled);
    await fac.evaluate(() => FacultySession.page.refresh());
  };
  await press('Start opening statements');
  await press('Open negotiation');
  for (const s of students) { await s.locator('[data-sign="threshold"]').waitFor(); await s.locator('[data-sign="threshold"]').click(); await s.waitForFunction(() => view.sheet.signatures.threshold.includes(view.seat)); }
  await students[0].waitForFunction(() => view.sheet.locked.threshold);
  ok(true, 'All four seats sign the threshold; it locks');
  ok(await fitsPhone(students[0]), 'At 390px the term sheet does not scroll sideways (its table scrolls)');
  await fac.evaluate(() => FacultySession.page.refresh());
  await fac.locator('#fw-advanced summary').click();
  const notice = fac.locator('#fw-advanced-content [data-session-control^="notice__"]').first();
  await notice.waitFor(); await notice.click();
  await students[0].waitForFunction(() => view.notices.length === 1);
  ok(true, 'A staff notice reaches the table');
  await press('Add 10 minutes');
  await fac.screenshot({ path: path.join(artifacts(), '02-session-bar.png') });
  await press('Close the sheet now');
  await fac.waitForFunction(() => FacultySession.page.state?.kit?.phase === 'closed');
  ok([...reports.keys()].length === 4, 'The deadline reports all four students');

  await fac.locator('[data-view="results"]').first().click();
  await fac.waitForFunction(() => document.querySelectorAll('#team-list .team-item').length === 1);
  ok(/Threshold settled/.test(await fac.locator('#results-view').innerText()), 'Results shows the band');
  await fac.screenshot({ path: path.join(artifacts(), '03-results.png'), fullPage: true });

  const s0 = students[0];
  await s0.locator('#rv1').waitFor();
  ok(/Questions to discuss/.test(await s0.locator('main').innerText()), 'Four questions follow the deadline');
  await s0.fill('#rv1', 'I gave on the threshold and got the term.'); await s0.evaluate(() => document.getElementById('rv1').dispatchEvent(new Event('input')));
  await s0.fill('#rv2', 'We would have stopped at three signatures.'); await s0.evaluate(() => document.getElementById('rv2').dispatchEvent(new Event('input')));
  await s0.locator('#rvgo').click();
  await s0.getByText('Review sent').waitFor();
  ok(true, 'The student answers the review');
  await s0.screenshot({ path: path.join(artifacts(), '04-student-outcome.png'), fullPage: true });

  await fac.evaluate(() => FacultySession.page.refresh());
  await fac.locator('[data-view="debrief"]').first().click();
  await fac.locator('.md-slide').waitFor();
  ok((await fac.locator('.md-kicker').first().innerText()).toLowerCase().includes('how each team settled'), 'Debrief opens on how each table settled');
  for (let i = 0; i < 7; i++) {
    await fac.screenshot({ path: path.join(artifacts(), `${String(5 + i).padStart(2, '0')}-debrief-${i + 1}.png`) });
    if (i < 6) await fac.locator('[data-md="next"]').click();
  }
  await fac.locator('[data-md-go="5"]').click();
  ok((await fac.locator('.md-slide').innerText()).includes('I gave on the threshold'), 'What students said shows the review');

  const liveHref = await fac.locator('a', { hasText: 'Live screen' }).getAttribute('href');
  const live = await page('live');
  await live.goto(`${origin}/simplus02/${liveHref.replace(/#lt=.*/, '')}#lt=${encodeURIComponent(facLT)}`);
  await live.getByText('Shaded terms were set by the Commission.').waitFor();
  ok(!/floor/i.test(await live.locator('body').innerText()), 'The Live screen shows the terms and no seat floor');
  await live.screenshot({ path: path.join(artifacts(), '12-live-screen.png'), fullPage: true });

  await fac.locator('[data-session-control="close"]').click();
  await fac.waitForFunction(() => FacultySession.page.state?.session?.state === 'closed');
  ok(true, 'Close');
  ok(errors.length === 0, 'No browser or fixture errors ' + errors.join(' | '));
  console.log(`SIMPLUS02_KIT_BROWSER_PASSED (${checks} checks). Screenshots: ${artifacts()}`);
  await browser.close(); server.close();
})().catch(async e => { console.error(e); if (browser) await browser.close(); server.close(); process.exit(1); });
function artifacts() { const d = path.resolve(process.env.ARTIFACTS || 'browser-artifacts/simplus02-kit'); fs.mkdirSync(d, { recursive: true }); return d; }
