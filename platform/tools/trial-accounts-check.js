#!/usr/bin/env node
'use strict';
// Trial accounts (Oct 18, Plan C): Admin invites a facilitator as a trial (10 days by default). A trial
// creates classes, adds sims, rehearses and plays them; students join and sessions with students open once
// the account is full. An ended trial shows one message and keeps everything. Admin extends a trial or
// makes the account full. Real platform handlers on an isolated PostgreSQL engine (PGlite); the sim's
// session API is stood in for. Run: node platform/tools/trial-accounts-check.js [--browser]
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { PGlite } = require('@electric-sql/pglite');
process.env.LAUNCH_SECRET = 'trial-accounts-secret';
process.env.SIM03_SESSION_URL = 'http://midland.internal/api/session';
delete process.env.ANTHROPIC_API_KEY;
const DAY = 86400000;
(async () => {
  let n = 0; const check = (v, m) => { assert(v, m); n++; console.log('PASS:', m); };
  const db = new PGlite(); await db.exec(fs.readFileSync(path.join(__dirname, '../lib/schema.sql'), 'utf8'));
  const s = async (strings, ...values) => (await db.query(strings.reduce((q, t, i) => q + (i ? '$' + i : '') + t, ''), values)).rows;
  s.query = async (text, values) => (await db.query(text, values)).rows;
  s.transaction = async work => work(s);
  const dbFile = require.resolve('../lib/db.js');
  require.cache[dbFile] = { id: dbFile, filename: dbFile, loaded: true, exports: { sql: () => s, id: p => p + '_' + Math.random().toString(36).slice(2, 10), joinCode: () => Math.random().toString(36).slice(2, 8).toUpperCase() } };

  // The sim's session API, stood in for: this faculty member's practice session is PRAC2.
  const asked = [];
  global.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body || '{}'); asked.push(body.action);
    const data = body.action === 'practice_status' ? { code: 'PRAC2', complete: false, students: [] }
      : body.action === 'course_sessions' ? { sessions: [] } : {};
    return { ok: true, status: 200, json: async () => data };
  };

  const T = require('../lib/trial.js');
  const handlers = { admin: require('../api/admin.js'), faculty: require('../api/faculty.js'), student: require('../api/student.js'),
    launch: require('../api/launch.js'), auth: require('../api/auth.js'), guide: require('../api/guide.js'), 'one-pager': require('../api/one-pager.js') };
  const response = () => ({ statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; },
    redirect(c, u) { this.statusCode = c; this.headers.Location = u; return this; }, end() { return this; } });
  async function call(name, body, cookie) {
    const res = response();
    await handlers[name]({ method: 'POST', headers: { cookie: cookie ? 'fx_sess=' + cookie : '', host: 'localhost' }, body }, res);
    return res;
  }
  async function launch(query, cookie) {
    const res = response();
    await handlers.launch({ method: 'GET', query, headers: { cookie: 'fx_sess=' + cookie, host: 'localhost' } }, res);
    return res;
  }

  await s`INSERT INTO users(id,name,email,role,password_hash) VALUES('a1','Admin','admin@example.test','admin','x'),('f1','Full Faculty','full@example.test','faculty','x'),('s1','Ana Student','ana@example.test','student','x')`;
  for (const id of ['a1', 'f1', 's1']) await s`INSERT INTO sessions(id,user_id,expires_at) VALUES(${id},${id},now()+interval '1 day')`;
  await s`INSERT INTO sims(id,number,title,launch_url,published) VALUES('rapid-03-midland',3,'Midland Equipment','https://rapidsims.test/sim03',true),('rapid-01-disaster',1,'Disaster or Breach?','https://rapidsims.test/sim01',true)`;

  // 1. Admin creates a trial invitation; the trial runs ten days from now.
  let r = await call('admin', { action: 'invite_faculty', name: 'Tess Trial', email: 'tess@example.test', accountKind: 'trial' }, 'a1');
  check(r.statusCode === 200 && r.body.accountKind === 'trial' && /accept\.html\?t=/.test(r.body.inviteUrl), 'Admin creates a trial invitation');
  const tid = r.body.facultyId;
  let row = (await s`SELECT account_kind, trial_ends_at FROM users WHERE id = ${tid}`)[0];
  const tenDays = new Date(row.trial_ends_at) - Date.now();
  check(row.account_kind === 'trial' && tenDays > 10 * DAY - 60000 && tenDays <= 10 * DAY, 'The trial ends ten days after the invitation is created');
  r = await call('admin', { action: 'invite_faculty', name: 'Fay Full', email: 'fay@example.test' }, 'a1');
  row = (await s`SELECT account_kind, trial_ends_at FROM users WHERE id = ${r.body.facultyId}`)[0];
  check(row.account_kind === 'full' && row.trial_ends_at === null, 'An invitation without a choice is a full account');
  r = await call('admin', { action: 'invite_faculty', name: 'Tim Trial', email: 'tim@example.test', accountKind: 'trial', trialDays: '3' }, 'a1');
  const tim = r.body.facultyId;
  row = (await s`SELECT trial_ends_at FROM users WHERE id = ${tim}`)[0];
  check(Math.abs(new Date(row.trial_ends_at) - Date.now() - 3 * DAY) < 60000, 'Trial length (days) sets the end date');
  check((await call('admin', { action: 'invite_faculty', name: 'Bad', email: 'bad@example.test', accountKind: 'trial', trialDays: '0' }, 'a1')).statusCode === 400, 'A trial length outside 1 to 365 days is refused');
  r = await call('admin', { action: 'invite_faculty', name: 'Tess Trial', email: 'tess@example.test' }, 'a1');
  check((await s`SELECT account_kind FROM users WHERE id = ${tid}`)[0].account_kind === 'trial', 'Re-invite keeps a trial account a trial');
  check((await call('admin', { action: 'invite_faculty', name: 'X', email: 'x@example.test', accountKind: 'trial' }, 'f1')).statusCode === 403, 'Only an administrator creates invitations');
  await s`UPDATE users SET password_hash = 'x' WHERE id = ${tid}`;
  await s`INSERT INTO sessions(id,user_id,expires_at) VALUES('tr',${tid},now()+interval '1 day')`;

  // 2. The trial account works like a full one for classes, sims, Rehearse and Play it yourself.
  r = await call('faculty', { action: 'overview' }, 'tr');
  check(r.statusCode === 200 && r.body.account.trial && !r.body.account.ended && r.body.account.daysLeft === 10 && r.body.catalogue.length === 2, 'The trial overview has every published sim and ten days left');
  r = await call('faculty', { action: 'create_course', title: 'MIS 3000', term: 'Fall' }, 'tr');
  check(r.statusCode === 200 && r.body.courseId, 'A trial account creates a class');
  const tc = r.body.courseId, tcode = r.body.joinCode;
  r = await call('faculty', { action: 'add_sim', courseId: tc, simId: 'rapid-03-midland' }, 'tr');
  check(r.statusCode === 200, 'A trial account adds a simulation to the class');
  r = await call('faculty', { action: 'course_detail', courseId: tc }, 'tr');
  check(r.statusCode === 200 && r.body.enrolUrl === null && r.body.studentsOpen === false && r.body.classNote === T.CLASS_NOTE, 'The trial class page has the class note in place of the class link');
  r = await call('faculty', { action: 'practice_status', courseId: tc, simId: 'rapid-03-midland' }, 'tr');
  check(r.statusCode === 200 && r.body.code === 'PRAC2', 'A trial account reaches Rehearse');
  r = await call('faculty', { action: 'set_paid', courseId: tc, all: true, paid: true }, 'tr');
  check(r.statusCode === 403 && r.body.error === 'trial_account', 'Give access is refused on a trial account');
  r = await launch({ sim: 'rapid-03-midland', course: tc, format: 'json' }, 'tr');
  check(r.statusCode === 200 && /^https:\/\/rapidsims\.test\/sim03#lt=/.test(r.body.url), 'Play it yourself opens on a trial account');

  // 3. Students cannot join a trial account's class.
  r = await call('student', { action: 'course_lookup', joinCode: tcode });
  check(r.statusCode === 403 && r.body.error === 'class_not_open' && r.body.message === T.JOIN_CLOSED && r.body.course.title === 'MIS 3000', 'The join page lookup answers with the plain message');
  r = await call('student', { action: 'enrol', joinCode: tcode }, 's1');
  check(r.statusCode === 403 && r.body.message === "This class opens to students once your instructor's account is confirmed.", 'A signed-in student cannot enrol in a trial class');
  r = await call('student', { action: 'signup_and_enrol', joinCode: tcode, name: 'New', email: 'new@example.test', password: 'password123' });
  check(r.statusCode === 403 && r.body.error === 'class_not_open' && !(await s`SELECT 1 FROM users WHERE email = 'new@example.test'`).length, 'Sign up and join refuses before making an account');
  check(!(await s`SELECT 1 FROM enrolments WHERE course_id = ${tc}`).length, 'Nobody is enrolled in the trial class');

  // 4. Session launch on a trial: only its own practice session.
  r = await launch({ sim: 'rapid-03-midland', course: tc, mode: 'session', format: 'json' }, 'tr');
  check(r.statusCode === 403 && r.body.error === 'trial_account' && r.body.message === T.SESSION_MESSAGE, 'Starting a real session is refused on a trial');
  r = await launch({ sim: 'rapid-03-midland', course: tc, mode: 'session', session: 'ABCDE', format: 'json' }, 'tr');
  check(r.statusCode === 403 && r.body.error === 'trial_account', 'Another session code is refused on a trial');
  r = await launch({ sim: 'rapid-03-midland', course: tc, mode: 'session', session: 'PRAC2', format: 'json' }, 'tr');
  check(r.statusCode === 200 && /session=PRAC2/.test(r.body.url), 'See the faculty view opens the trial account’s own practice session');
  r = await launch({ sim: 'rapid-03-midland', course: tc, mode: 'session' }, 'tr');
  check(r.statusCode === 403 && r.body.includes('Your trial covers Rehearse and Play it yourself. Sessions with students open when your account is full.') && r.body.includes(`/faculty.html?view=course&amp;course=${tc}`), 'The plain page says what the trial covers, with a link back to the class');
  check(await T.practiceSessionMatches({ me: {}, course: {}, sim: {}, session: 'PRAC2', practiceStatus: async () => ({ status: 503, data: {} }) }) === false, 'If the sim cannot answer, the session page stays closed');

  // 5. A full account is unaffected.
  r = await call('faculty', { action: 'create_course', title: 'Full class' }, 'f1');
  const fc = r.body.courseId, fcode = r.body.joinCode;
  await call('faculty', { action: 'add_sim', courseId: fc, simId: 'rapid-03-midland' }, 'f1');
  r = await call('faculty', { action: 'course_detail', courseId: fc }, 'f1');
  check(r.body.account.kind === 'full' && r.body.studentsOpen && /join\.html\?c=/.test(r.body.enrolUrl), 'A full account’s class has its class link');
  r = await call('student', { action: 'enrol', joinCode: fcode }, 's1');
  check(r.statusCode === 200, 'Students join a full account’s class');
  check((await call('faculty', { action: 'set_paid', courseId: fc, all: true, paid: true }, 'f1')).statusCode === 200, 'Give access works on a full account');
  r = await launch({ sim: 'rapid-03-midland', course: fc, mode: 'session', format: 'json' }, 'f1');
  check(r.statusCode === 200 && /#lt=/.test(r.body.url), 'A full account starts a session');

  // 6. Admin Trials: Extend and Make full, admin only.
  const ends = row => new Date(row.trial_ends_at).getTime();
  const before = ends((await s`SELECT trial_ends_at FROM users WHERE id = ${tid}`)[0]);
  check((await call('admin', { action: 'extend_trial', facultyId: tid, days: 7 }, 'tr')).statusCode === 403, 'A faculty member cannot extend a trial');
  check((await call('admin', { action: 'make_full', facultyId: tid }, 'f1')).statusCode === 403, 'A faculty member cannot make an account full');
  r = await call('admin', { action: 'extend_trial', facultyId: tid, days: 7 }, 'a1');
  check(r.statusCode === 200 && Math.abs(ends((await s`SELECT trial_ends_at FROM users WHERE id = ${tid}`)[0]) - before - 7 * DAY) < 2000, 'Extend adds days to a running trial from its end date');
  check((await call('admin', { action: 'extend_trial', facultyId: tid, days: 'x' }, 'a1')).statusCode === 400, 'Extend takes a whole number of days');
  check((await call('admin', { action: 'extend_trial', facultyId: 'f1', days: 7 }, 'a1')).statusCode === 404, 'Extend applies only to trial accounts');
  r = await call('admin', { action: 'overview' }, 'a1');
  const listed = r.body.faculty.filter(f => f.account_kind === 'trial').map(f => f.name).sort();
  check(JSON.stringify(listed) === JSON.stringify(['Tess Trial', 'Tim Trial']) && r.body.faculty.find(f => f.id === tid).trial_ends_at, 'Admin overview lists the trial accounts with their end dates');

  // 7. A trial that has ended: one message; nothing is deleted.
  await s`UPDATE users SET trial_ends_at = now() - interval '1 day' WHERE id = ${tid}`;
  r = await call('faculty', { action: 'overview' }, 'tr');
  const ended = r.body.account;
  check(r.statusCode === 200 && ended.ended && r.body.courses.length === 0, 'The faculty overview answers with the ended state');
  check(ended.message === `Your trial ended on ${T.longDate(ended.endsAt)}. To keep going, write to support@flexee.org and we'll move your account to full.`, 'The ended message names the date and support@flexee.org');
  r = await call('faculty', { action: 'course_detail', courseId: tc }, 'tr');
  check(r.statusCode === 403 && r.body.error === 'trial_ended' && r.body.message === ended.message, 'Every other faculty action answers with the ended message');
  r = await launch({ sim: 'rapid-03-midland', course: tc, format: 'json' }, 'tr');
  check(r.statusCode === 403 && r.body.error === 'trial_ended', 'Play it yourself closes when the trial ends');
  check((await s`SELECT 1 FROM courses WHERE id = ${tc}`).length === 1 && (await s`SELECT 1 FROM course_sims WHERE course_id = ${tc}`).length === 1, 'The class and its sims are kept');
  const guide = response(); await handlers.guide({ method: 'GET', url: '/api/guide', headers: { cookie: 'fx_sess=tr' } }, guide);
  check(guide.statusCode === 200 && /On a trial account, Rehearse and Play it yourself are open; students can join once your account is full\./.test(guide.body.text), 'Getting started stays readable and says what a trial covers');
  r = await call('admin', { action: 'extend_trial', facultyId: tid, days: 7 }, 'a1');
  const after = ends((await s`SELECT trial_ends_at FROM users WHERE id = ${tid}`)[0]);
  check(r.statusCode === 200 && Math.abs(after - Date.now() - 7 * DAY) < 60000, 'Extend on an ended trial counts from today');
  check((await call('faculty', { action: 'course_detail', courseId: tc }, 'tr')).statusCode === 200, 'An extended trial opens again');
  r = await call('admin', { action: 'make_full', facultyId: tid }, 'a1');
  row = (await s`SELECT account_kind, trial_ends_at FROM users WHERE id = ${tid}`)[0];
  check(r.statusCode === 200 && row.account_kind === 'full' && row.trial_ends_at === null, 'Make full sets a full account with no end date');
  r = await call('faculty', { action: 'course_detail', courseId: tc }, 'tr');
  check(/join\.html\?c=/.test(r.body.enrolUrl) && r.body.studentsOpen, 'The class link appears once the account is full');
  check((await call('student', { action: 'enrol', joinCode: tcode }, 's1')).statusCode === 200, 'Students join once the account is full');
  r = await launch({ sim: 'rapid-03-midland', course: tc, mode: 'session', format: 'json' }, 'tr');
  check(r.statusCode === 200, 'Sessions with students open once the account is full');

  // 8. The per-sim seven-day preview is retired from the faculty pages.
  const facultyHtml = fs.readFileSync(path.join(__dirname, '../public/faculty.html'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
  check(!/Preview for 7 days|data-prev=|start_preview|Start a preview/.test(facultyHtml + adminHtml), 'Nothing in the faculty or admin pages offers the seven-day preview');
  check(facultyHtml.includes(T.CLASS_NOTE) && facultyHtml.includes(T.SESSION_MESSAGE), 'The faculty page carries the trial wording');

  if (process.argv.includes('--browser')) {
    const { chromium } = require('playwright');
    // Fresh state for the screens: Tess on a running trial with a class; Tim on a trial too.
    await s`UPDATE users SET account_kind = 'trial', trial_ends_at = now() + interval '9 days 1 hour' WHERE id = ${tid}`;
    await s`DELETE FROM enrolments WHERE course_id = ${tc}`;
    const server = http.createServer(async (req, res) => { try {
      const url = new URL(req.url, 'http://localhost');
      const cookie = req.headers.cookie || '';
      if (url.pathname === '/api/launch') { const out = response();
        await handlers.launch({ method: 'GET', query: Object.fromEntries(url.searchParams), headers: { cookie, host: 'localhost' } }, out);
        res.writeHead(out.statusCode, { 'content-type': typeof out.body === 'string' ? 'text/html' : 'application/json', ...(out.headers.Location ? { location: out.headers.Location } : {}) });
        return res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body || {})); }
      if (url.pathname.startsWith('/api/')) {
        const name = url.pathname.slice(5); if (!handlers[name]) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}'); }
        let raw = ''; for await (const part of req) raw += part;
        const out = response();
        await handlers[name]({ method: req.method, url: req.url, query: Object.fromEntries(url.searchParams), headers: { cookie, host: 'localhost' }, body: raw ? JSON.parse(raw) : {} }, out);
        res.writeHead(out.statusCode, { 'content-type': 'application/json' }); return res.end(JSON.stringify(out.body || {}));
      }
      const file = path.resolve(__dirname, '../public', url.pathname.slice(1) || 'index.html');
      if (!file.startsWith(path.resolve(__dirname, '../public') + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
    } catch (e) { console.error(e); res.writeHead(500); res.end(String(e)); } });
    await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
    const shots = path.resolve(process.env.ARTIFACTS || 'browser-artifacts'); fs.mkdirSync(shots, { recursive: true });
    const errors = [];
    const as = async who => { const ctx = await browser.newContext({ viewport: { width: 1360, height: 960 } });
      await ctx.addCookies([{ name: 'fx_sess', value: who, url: base }]); const page = await ctx.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', e => errors.push(e.message)); return page; };
    try {
      // The trial class page: the class note in place of the class link; no Give access.
      let page = await as('tr');
      await page.goto(base + '/faculty.html?view=course&course=' + encodeURIComponent(tc));
      await page.locator('[data-trial-class-note]').waitFor();
      check((await page.locator('[data-trial-class-note]').innerText()).includes(T.CLASS_NOTE), 'Browser: the trial class page shows the class note');
      check(await page.locator('#eurl').count() === 0 && await page.locator('[data-give],#p_all').count() === 0, 'Browser: no class link and no Give access on a trial');
      await page.screenshot({ path: path.join(shots, 'trial-class-page.png'), fullPage: true });
      await page.locator('a[data-frame]').first().click();
      await page.locator('[data-trial-sessions]').waitFor();
      check((await page.locator('[data-trial-sessions]').innerText()).includes(T.SESSION_MESSAGE), 'Browser: Start a session on a trial opens the page that says what the trial covers');
      await page.goto(base + '/faculty.html');
      await page.locator('[data-trial-home]').waitFor();
      check(/Trial account until/.test(await page.locator('[data-trial-home]').innerText()) && !/Preview for 7 days/.test(await page.content()), 'Browser: Your classes says how long the trial runs, and offers no preview');

      // The trial has ended: one message on every faculty page.
      await s`UPDATE users SET trial_ends_at = now() - interval '2 days' WHERE id = ${tid}`;
      await page.goto(base + '/faculty.html?view=course&course=' + encodeURIComponent(tc));
      await page.locator('[data-trial-ended]').waitFor();
      const endedText = await page.locator('[data-trial-ended]').innerText();
      check(/Your trial ended on .+\. To keep going, write to support@flexee\.org and we'll move your account to full\./.test(endedText), 'Browser: an ended trial shows the ended message');
      await page.screenshot({ path: path.join(shots, 'trial-ended.png'), fullPage: true });
      await page.goto(base + '/faculty.html?view=guide');
      await page.locator('[data-guide] h1').waitFor();
      check(true, 'Browser: Getting started stays readable after the trial ends');
      await page.context().close();

      // Admin: the Trials list with Extend and Make full.
      page = await as('a1');
      await page.goto(base + '/admin.html');
      await page.locator('[data-trials]').waitFor();
      const trialsText = await page.locator('[data-trials]').innerText();
      check(/Tess Trial/.test(trialsText) && /Ended /i.test(trialsText) && /Tim Trial/.test(trialsText) && /\d+ days? left/i.test(trialsText), 'Browser: Admin Trials lists each trial with days left or ended');
      check(await page.locator('[data-trials] [data-extend]').count() === 2 && await page.locator('[data-trials] [data-make-full]').count() === 2, 'Browser: each trial row has Extend and Make full');
      await page.locator('#inv').click();
      await page.locator('input[name="ikind"][value="trial"]').check();
      check(await page.locator('#idays').inputValue() === '10' && /starts today, when you create the invitation/.test(await page.locator('[data-trial-choice] + .hint').innerText()), 'Browser: the invite form offers a trial of 10 days and says when it starts');
      await page.screenshot({ path: path.join(shots, 'trial-admin-trials.png'), fullPage: true });
      page.once('dialog', d => d.accept('7'));
      await page.locator(`[data-trial-row="${tid}"] [data-extend]`).click();
      await page.waitForFunction(id => /7 days left/i.test(document.querySelector(`[data-trial-row="${id}"]`)?.innerText || ''), tid);
      check(true, 'Browser: Extend from the Trials list gives an ended trial seven days from today');
      page.once('dialog', d => d.accept());
      await page.locator(`[data-trial-row="${tid}"] [data-make-full]`).click();
      await page.waitForFunction(id => !document.querySelector(`[data-trial-row="${id}"]`), tid);
      check((await s`SELECT account_kind FROM users WHERE id = ${tid}`)[0].account_kind === 'full', 'Browser: Make full from the Trials list makes the account full');
      check(errors.length === 0, 'Browser: no page errors ' + errors.join(' | '));
      console.log('Screenshots: ' + ['trial-class-page.png', 'trial-ended.png', 'trial-admin-trials.png'].map(f => path.join(shots, f)).join(', '));
    } finally { await browser.close(); server.close(); }
  }
  console.log(`PASS trial-accounts-check: ${n} assertions`);
})().catch(e => { console.error(e); process.exit(1); });
