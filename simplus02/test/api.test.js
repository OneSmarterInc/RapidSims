require('../../tools/security/report-fixture.cjs');
'use strict';
// Runs the real handlers end to end against an in-memory store honouring the same compare-and-set contract:
// a class of 30 at seven tables, the timed phases, concurrent moves, notices, the extension and the deadline.
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { store } = require('../lib/store');
const C = require('../data/config');
const { seatBriefs } = require('../data/content');

process.env.LAUNCH_SECRET = 'test-secret-not-real';
delete process.env.PLATFORM_URL; delete process.env.FACULTY_CODES; delete process.env.ACCESS_CODE;

let clock = 1_800_000_000_000; Date.now = () => clock; const advance = m => { clock += m * 60000; };
const db = new Map();
Object.assign(store, {
  configured: () => true,
  get: async k => db.has(k) && db.get(k) ? JSON.parse(db.get(k)) : null,
  getMany: async ks => ks.map(k => db.has(k) && db.get(k) ? JSON.parse(db.get(k)) : null),
  cas: async (k, prev, next) => {
    const cur = db.has(k) ? db.get(k) : '';
    if (cur !== (prev == null ? '' : JSON.stringify(prev))) return false;
    db.set(k, next == null ? '' : JSON.stringify(next)); return true;
  },
});
const session = require('../api/session');
const token = (sub, role = 'student') => { const p = { kind: 'launch', run: 'run-' + sub, sub, name: sub, role, sim: C.id, mode: role === 'student' ? 'play' : 'session', course: 'c1', iat: clock, exp: clock + 4 * 36e5 };
  const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + createHmac('sha256', process.env.LAUNCH_SECRET).update(b).digest('base64url'); };
async function call(b, headers = {}) {
  const res = { statusCode: 200, payload: null, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(v) { this.payload = v; return this; } };
  await session({ method: 'POST', headers, body: b }, res);
  return { status: res.statusCode, body: res.payload };
}
const facT = token('teacher', 'faculty'), fac = b => call(b, { 'x-launch-token': facT });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

(async () => {
  ok((await call({ action: 'create', mode: 'team' })).status === 401, 'create needs faculty');
  const code = (await fac({ action: 'create', mode: 'team' })).body.session.code;
  ok(/^[A-Z2-9]{5}$/.test(code), 'code shape');
  ok((await call({ action: 'join', code })).status === 401, 'join needs a RapidSims sign-in');

  // 30 students join from the class link and are split into seven tables.
  const people = [];
  for (let i = 0; i < 30; i++) {
    const lt = token('s' + i), r = await call({ action: 'join', code }, { 'x-launch-token': lt });
    people.push({ ...r.body, h: { 'x-launch-token': lt, 'x-participant-key': r.body.participantKey } });
  }
  ok(people.every(p => p.participantId), 'all joined');
  const v0 = await call({ action: 'view', code, participantId: people[0].participantId }, people[0].h);
  ok(v0.body.seated === false, 'unseated before Start');
  ok((await call({ action: 'view', code, participantId: people[0].participantId }, { ...people[0].h, 'x-participant-key': 'wrong' })).status === 403, 'wrong key rejected');
  const assign = Object.fromEntries(people.map((p, i) => [p.participantId, `Table ${(i % 7) + 1}`]));
  ok((await fac({ action: 'group', code, assign })).status === 200, 'seven tables');
  for (const p of people) for (let step = 1; step <= 4; step++) {
    ok((await call({ action: 'walkthrough', code, participantId: p.participantId, step }, p.h)).status === 200, 'walkthrough screen acknowledged');
  }
  ok((await fac({ action: 'control', code, set: 'start' })).body.session.phase === 'briefing', 'Start: briefing');
  ok((await call({ action: 'join', code }, { 'x-launch-token': token('late') })).status === 409, 'late join blocked');
  ok((await fac({ action: 'control', code, set: 'openings' })).status === 200, 'openings');

  const views = await Promise.all(people.map(p => call({ action: 'view', code, participantId: p.participantId }, p.h)));
  ok(views.every(v => v.body.seated), 'everyone seated');
  ok(new Set(views.map(v => v.body.table)).size === 7, 'seven tables');
  for (const v of views) for (const [seat, b] of Object.entries(seatBriefs)) {
    const has = JSON.stringify(v.body).includes(b.floor);
    ok(seat === v.body.seat ? has : !has, `floor leak check ${v.body.seat}/${seat}`);
  }
  ok(views.every(v => v.body.editable === false), 'read-only during openings');
  const mover = people[views.findIndex(v => v.body.seat === 'developer')];
  ok((await call({ action: 'move', code, participantId: mover.participantId, dial: 'top', value: 70 }, mover.h)).status === 409, 'no moves in openings');

  // Negotiate
  await fac({ action: 'control', code, set: 'negotiation' });
  const at = (table, seat) => people[views.findIndex(v => v.body.table === table && v.body.seat === seat)];
  const act = (p, b) => call({ code, participantId: p.participantId, ...b }, p.h);
  const T1 = { top: 75, term: 14, exit: 0, coll: 0, threshold: 50 };
  ok(Object.values(require('../engine/model').floors(T1)).every(Boolean), 'T1 package clears all four floors');
  for (const [d, v] of Object.entries(T1)) await act(at('T1', 'utility'), { action: 'move', dial: d, value: v });
  for (const seat of ['utility', 'developer', 'manufacturers', 'advocate']) for (const d of Object.keys(T1)) await act(at('T1', seat), { action: 'sign', dial: d });
  const t1 = (await act(at('T1', 'advocate'), { action: 'view' })).body;
  ok(t1.sheet.locked.money && t1.sheet.locked.threshold, 'T1 fully locked');
  await act(at('T2', 'manufacturers'), { action: 'move', dial: 'threshold', value: 60 });
  for (const seat of ['utility', 'developer', 'manufacturers', 'advocate']) await act(at('T2', seat), { action: 'sign', dial: 'threshold' });
  ok((await act(at('T2', 'developer'), { action: 'move', dial: 'top', value: 72 })).status === 400, 'off-step move rejected');
  await Promise.all([['utility', 'top', 90], ['developer', 'term', 8], ['manufacturers', 'threshold', 55], ['advocate', 'coll', 30]]
    .map(([s, d, v]) => act(at('T3', s), { action: 'move', dial: d, value: v })));
  const t3 = (await act(at('T3', 'utility'), { action: 'view' })).body;
  ok(t3.sheet.dials.top === 90 && t3.sheet.dials.term === 8 && t3.sheet.dials.threshold === 55 && t3.sheet.dials.coll === 30, 'concurrent moves all land');
  ok(t3.log.filter(e => e.action === 'move').length === 4, 'four moves logged');

  // Notice, stall flag, extension
  await fac({ action: 'control', code, set: 'notice__T4__closest' });
  advance(11);
  const con = (await fac({ action: 'faculty_state', code })).body;
  const t4run = Object.values(con.runs).find(r => r.tableId === 'T4');
  ok(t4run.sheet.stalled, 'T4 flagged quiet');
  ok(!JSON.stringify(con).includes(seatBriefs.advocate.floor), 'faculty state carries no floor');
  const t4v = (await act(at('T4', 'advocate'), { action: 'view' })).body;
  ok(t4v.notices.length === 1 && /closest/.test(t4v.notices[0].text + t4v.notices[0].id), 'notice reaches the table');
  ok((await fac({ action: 'control', code, set: 'extend' })).status === 200, 'extend once');
  ok((await fac({ action: 'control', code, set: 'extend' })).status === 409, 'extend twice rejected');

  // Deadline passes: the first request closes everything
  advance(60);
  const lateMove = await act(at('T1', 'developer'), { action: 'move', dial: 'top', value: 60 });
  ok(lateMove.status === 409, 'moves after deadline rejected');
  const after = (await fac({ action: 'faculty_state', code })).body;
  const results = Object.values(after.runs).map(r => ({ id: r.tableId, ...r.result }));
  ok(after.kit.phase === 'closed' && results.length === 7 && results.every(r => r.terms), 'all tables closed');
  const r1 = results.find(r => r.id === 'T1'), r2 = results.find(r => r.id === 'T2');
  ok(r1.imposed.length === 0 && r1.freezeMonths === 0, 'T1 nothing imposed');
  ok(r2.settled.includes('threshold') && r2.terms.threshold === 60 && r2.imposed.length === 4, 'T2 threshold stands, money imposed');
  ok(results.filter(r => r.settled.length === 0).every(r => r.imposed.length === 5), 'unsettled tables fully imposed');

  const out = (await act(at('T2', 'advocate'), { action: 'view' })).body.outcome;
  ok(out && out.arrives && out.misses, 'outcome both scenarios');
  ok(!/score|rank/i.test(JSON.stringify(out)), 'no score or rank in outcome');
  console.log(`All API tests pass (${n} assertions).`);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
