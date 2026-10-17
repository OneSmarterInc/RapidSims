#!/usr/bin/env node
'use strict';
// Ask Claude on every faculty page (Oct 17): the class list and Class home answer about the class and RapidSims
// (30 general questions a month), Rehearse and a sim's results answer about that sim, and a sim's own pages (in the
// frame) carry their own panel. Isolated PostgreSQL engine + the real faculty API and faculty.html in Chromium; the
// Anthropic API is stood in for. Run: node platform/tools/assist-everywhere-check.js [--browser]
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { PGlite } = require('@electric-sql/pglite');
process.env.ANTHROPIC_API_KEY = 'test-key'; process.env.LAUNCH_SECRET = 'assist-everywhere-secret'; delete process.env.ASSIST_SIMS;
(async () => {
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../lib/schema.sql'), 'utf8'));
  const s = async (strings, ...values) => { const text = strings.reduce((q, t, i) => q + (i ? '$' + i : '') + t, ''); return (await db.query(text, values)).rows; };
  s.query = async (text, values) => (await db.query(text, values)).rows;
  const dbFile = require.resolve('../lib/db.js');
  require.cache[dbFile] = { id: dbFile, filename: dbFile, loaded: true, exports: { sql: () => s, id: () => 'id' + Math.random().toString(36).slice(2) } };
  await s`INSERT INTO users(id,name,email,role) VALUES('f1','Teacher','f1@example.test','faculty')`;
  await s`INSERT INTO sessions(id,user_id,expires_at) VALUES('f1','f1',now()+interval '1 day')`;
  await s`INSERT INTO courses(id,faculty_id,title,term,join_code) VALUES('c1','f1','MIS3000','Fall','TEST01')`;
  await s`INSERT INTO sims(id,number,title,launch_url,published) VALUES('rapid-03-midland',3,'Midland Equipment','/sim03',true),('rapid-01-disaster',1,'Disaster or Breach?','/sim',true),('rapidsimplus-01',11,'Why Don''t They Have Any Patience?','/sim-plus-01',true)`;
  await s`INSERT INTO course_sims(course_id,sim_id) VALUES('c1','rapid-03-midland'),('c1','rapid-01-disaster')`;
  for (const [id, paid] of [['s1', true], ['s2', false]]) {
    await s`INSERT INTO users(id,name,email,role) VALUES(${id},${'Ana ' + id},${id + '@example.test'},'student')`;
    await s`INSERT INTO enrolments(id,course_id,student_id,paid) VALUES(${'e' + id},'c1',${id},${paid})`;
  }
  // The model, stood in for: records what it was sent.
  const sent = []; const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.anthropic.com/')) { const b = JSON.parse(opts.body); sent.push(b);
      return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Students join with the class link. **One link** covers every sim.' }], usage: { input_tokens: 100, output_tokens: 30 } }) }; }
    return realFetch(url, opts);
  };
  const handler = require('../api/faculty.js'); let n = 0; const check = (v, m) => { assert(v, m); n++; console.log('PASS:', m); };
  async function call(body) {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers: { cookie: 'fx_sess=f1', host: 'localhost' }, body }, res); return res;
  }

  let r = await call({ action: 'assist_status' });
  check(r.statusCode === 200 && r.body.available && r.body.allowance.limit === 30, 'Your classes: Ask Claude is on, 30 general questions a month');
  r = await call({ action: 'assist', courseId: 'c1', question: 'How do students join?' });
  check(r.statusCode === 200 && /class link/.test(r.body.answer), 'Class home: Claude answers about the class');
  const sys = sent[0].system[0].text, msg = sent[0].messages.at(-1).content;
  check(/Midland Equipment \(in this class\)/.test(sys) && /Why Don't They Have Any Patience\?/.test(sys), 'Claude has the catalogue and knows which sims are in the class');
  check(/Rehearse/.test(sys) && /class link/.test(sys), 'Claude has the guide to the faculty pages');
  check(/MIS3000/.test(msg) && /"students":2/.test(msg) && /"studentsWithAccess":1/.test(msg) && !/Ana s1/.test(JSON.stringify(sent[0])), 'Claude sees the class and its counts, never a student name');
  const used = await s`SELECT sim_id, course_id FROM assist_usage`;
  check(used.length === 1 && used[0].sim_id === 'general' && used[0].course_id === 'c1', 'A general question counts against the general allowance');
  r = await call({ action: 'assist_status', simId: 'rapid-03-midland', courseId: 'c1' });
  check(r.body.available && r.body.allowance.limit === 200, 'A sim keeps its own allowance (200: the class has a licensed student)');
  sent.length = 0;
  r = await call({ action: 'assist', simId: 'rapid-01-disaster', courseId: 'c1', question: 'Which of my sims suits a security unit?' });
  const simSys = sent[0].system[0].text;
  check(r.statusCode === 200 && /## The other RapidSims/.test(simSys) && /Midland Equipment \(in this class\): About an hour in all[^\n]*It fits/.test(simSys) && /Why Don't They Have Any Patience\?: About seventy minutes[^\n]*It fits/.test(simSys) && !/- Disaster or Breach\?:/.test(simSys), 'A sim’s helper knows the other sims, what each fits and which are in the class');
  check(/in the Students section/.test(simSys), 'The guide says where student access is set');
  r = await call({ action: 'assist', courseId: 'nope', question: 'Hi' });
  check(r.statusCode === 404, 'Another faculty member’s class is refused');

  if (process.argv.includes('--browser')) {
    const { chromium } = require('playwright');
    const server = http.createServer(async (req, res) => { try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) { let raw = ''; for await (const part of req) raw += part; const b = raw ? JSON.parse(raw) : {};
        if (b.action === 'me') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ user: { id: 'f1', role: 'faculty', name: 'Teacher' } })); }
        if (url.pathname !== '/api/faculty') { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}'); }
        const out = await call(b); res.writeHead(out.statusCode, { 'content-type': 'application/json' }); return res.end(JSON.stringify(out.body)); }
      const file = path.resolve(__dirname, '../public', url.pathname.slice(1));
      if (!file.startsWith(path.resolve(__dirname, '../public') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
    } catch (e) { res.writeHead(500); res.end(String(e)); } });
    await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const button = () => page.locator('.fs-helper-open');
    try {
      await page.goto(base + '/faculty.html');
      await button().waitFor();
      check((await button().innerText()) === 'Ask Claude about RapidSims', 'Your classes: the button reads Ask Claude about RapidSims');
      await page.goto(base + '/faculty.html?view=course&course=c1');
      await page.waitForFunction(() => document.querySelector('.fs-helper-open')?.textContent === 'Ask Claude about this class');
      check(true, 'Class home: the button reads Ask Claude about this class');
      await button().click(); await page.fill('#fsHelperQ', 'How do students join?'); await page.locator('#fsHelperQ').press('Enter');
      await page.locator('.fs-helper-a:not(.fs-helper-typing)').waitFor();
      check((await page.locator('.fs-helper-a b').innerText()) === 'One link', 'Class home: the answer shows, with its formatting');
      check(/28 of 30 questions left this month for questions about your classes/.test(await page.locator('.fs-helper-panel').innerText()), 'Class home: general questions left this month');
      await page.screenshot({ path: path.resolve(process.env.ARTIFACTS || 'browser-artifacts', 'assist-class-home.png') }).catch(() => {});
      await page.goto(base + '/faculty.html?view=rehearse&course=c1&sim=rapid-01-disaster');
      await page.waitForFunction(() => document.querySelector('.fs-helper-open')?.textContent === 'Ask Claude about this sim');
      check(true, 'Rehearse: Ask Claude about this sim');
      await page.goto(base + '/faculty.html?view=sim&course=c1&sim=rapid-03-midland');
      await page.locator('#simFrame').waitFor(); await page.waitForTimeout(800);
      check(await button().count() === 0, 'A sim’s own pages: the class page leaves Ask Claude to the sim’s panel');
      check(errors.length === 0, 'No browser errors ' + errors.join(' | '));
    } finally { await browser.close(); server.close(); }
  }
  console.log(`PASS assist-everywhere-check: ${n} assertions`);
})().catch(e => { console.error(e); process.exit(1); });
