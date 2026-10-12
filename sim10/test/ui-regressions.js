'use strict';
const assert = require('node:assert/strict');
const { DraftQueue } = require('../public/draft-queue');
const { memoryStore } = require('../lib/store');
const E = require('../lib/engine');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function check() {
  let release, fail = false;
  const writes = [];
  const queue = new DraftQueue({ delay: 10000, write: async fields => {
    writes.push(fields);
    if (writes.length === 1) await new Promise(resolve => { release = resolve; });
    if (fail) throw new Error('Network unavailable');
  }});
  queue.edit({ lineWhy: 'First explanation' });
  const first = queue.flush(); await tick();
  queue.edit({ lineWhy: 'Latest explanation', mind: 'More evidence' });
  let finished = false;
  const commitWait = queue.flush().then(() => { finished = true; });
  assert.equal(finished, false, 'flush must wait for an already-running write');
  release(); await first; await commitWait;
  assert.deepEqual(writes, [{ lineWhy: 'First explanation' }, { lineWhy: 'Latest explanation', mind: 'More evidence' }]);
  assert.equal(queue.unsettled, false);
  fail = true; queue.edit({ call: 'infra' });
  await assert.rejects(queue.flush(), /Network/);
  assert.deepEqual(queue.dirty, { call: 'infra' }, 'failure retains fields for retry');
  assert(queue.error);
  fail = false; await queue.flush(); assert.equal(queue.error, null); assert.deepEqual(queue.dirty, {});
  queue.pause();

  const store = memoryStore(), now = 1700000000000;
  const s = await E.createSession(store, { mode: 'team', cases: ['A'], teams: 2 }, now);
  const a = await E.join(store, s.code, { team: 1 }, now), b = await E.join(store, s.code, { team: 1 }, now);
  await E.startCase(store, s.code, s.hostKey, 'A', now);
  const at = now + 13 * 60000;
  await Promise.all([
    E.saveTeamDraft(store, s.code, a.pid, 'A', { call: 'infra', line: 'is.revenue' }, at),
    E.saveTeamDraft(store, s.code, b.pid, 'A', { lineWhy: 'Revenue grew between the two reported quarters.', mind: 'I would change my view if cash collection weakened and spending kept rising without sustainable customer demand.' }, at)
  ]);
  const v = await E.studentState(store, s.code, a.pid, at);
  assert.equal(v.teamDraft.call, 'infra'); assert(v.teamDraft.mind.length >= 80, 'concurrent field edits both survive');
  assert.equal(v.startsAt, now + 12 * 60000, 'phase start comes from the room clock, not join time');
  const later = await E.studentState(store, s.code, a.pid, at + 60000);
  assert.equal(later.startsAt, v.startsAt, 'refresh does not reset progress');
  const reviewed = { ...v.teamDraft };
  await E.saveTeamDraft(store, s.code, b.pid, 'A', { call: 'bubble' }, at);
  await assert.rejects(E.commitTeam(store, s.code, a.pid, 'A', at, reviewed), /changed the answer/);
  await E.commitTeam(store, s.code, a.pid, 'A', at, { ...reviewed, call: 'bubble' });
  await assert.rejects(E.commitTeam(store, s.code, b.pid, 'A', at), /already committed/);
}
module.exports = { check };
