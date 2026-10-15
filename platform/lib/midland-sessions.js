'use strict';
// The class page talks to each sim on the shared faculty pages (the kit) on the faculty
// member's behalf, with a short-lived signed faculty launch for that class.
const crypto = require('node:crypto');
const { launchToken } = require('./launch.js');
const SIM = 'rapid-03-midland';
// Sims on the shared faculty pages: their app (ec2/apps.json), an override URL, and how many practice students Rehearse opens.
const KIT_SIMS = {
  'rapid-03-midland': { app: 'sim03', env: 'SIM03_SESSION_URL', practice: 3 },
  'rapid-01-disaster': { app: 'sim01', env: 'SIM01_SESSION_URL', practice: 1 },
  'rapid-02-relay': { app: 'sim02', env: 'SIM02_SESSION_URL', practice: 1 },
  'rapid-04-whose-number': { app: 'sim04', env: 'SIM04_SESSION_URL', practice: 3 },
  'rapid-05-approve': { app: 'sim05', env: 'SIM05_SESSION_URL', practice: 1 },
  'rapid-06-switch': { app: 'sim06', env: 'SIM06_SESSION_URL', practice: 1 },
  'rapid-07-bought': { app: 'sim07', env: 'SIM07_SESSION_URL', practice: 1 }
};
let apps = {};
try { apps = require('../../ec2/apps.json'); } catch { apps = {}; }

function sessionUrl(sim) {
  const kit = KIT_SIMS[sim.id] || KIT_SIMS[SIM];
  if (process.env[kit.env]) return process.env[kit.env];
  const port = apps[kit.app] && apps[kit.app].port;
  if (port) return `http://127.0.0.1:${port}/api/session`;
  return String(sim.launch_url || '').replace(/\/+$/, '') + '/api/session';
}

async function ask(me, course, sim, body) {
  const token = launchToken({ userId: me.id, name: me.name, email: me.email, role: 'faculty',
    simId: sim.id || SIM, courseId: course.id, mode: 'session', runId: 'course-page', minutes: 5 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const r = await fetch(sessionUrl(sim), { method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-launch-token': token }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) {
    return { ok: false, status: 503, data: { error: 'sim_unavailable' } };
  } finally { clearTimeout(timer); }
}

// Practice students: three on one team (Midland) or one on their own. Each gets a signed
// student launch for the practice session only; the first enters the team's decisions.
const PRACTICE = [['ana', 'Practice Ana'], ['ben', 'Practice Ben'], ['cal', 'Practice Cal']];
async function practiceStart(me, course, sim, startOver = false) {
  const run = crypto.randomBytes(4).toString('hex');
  const count = (KIT_SIMS[sim.id] || KIT_SIMS[SIM]).practice;
  const students = PRACTICE.slice(0, count).map(([key, name]) => ({ sub: `practice-${me.id}-${key}`, name }));
  const r = await ask(me, course, sim, { action: 'practice_start', students, startOver: startOver === true });
  if (!r.ok || !r.data.code) return { status: r.ok ? 502 : r.status, data: { error: r.data.error || 'practice_unavailable' } };
  const code = r.data.code;
  const base = String(sim.launch_url || '').replace(/\/+$/, '');
  const links = students.map((x, i) => {
    const token = launchToken({ userId: x.sub, name: x.name, role: 'student', simId: sim.id || SIM, courseId: course.id,
      mode: 'play', runId: `practice-${run}-${i}`, minutes: 240 });
    return { name: x.name, entersDecisions: i === 0,
      url: `${base}/?session=${encodeURIComponent(code)}#lt=${encodeURIComponent(token)}` };
  });
  const progress = new Map((r.data.students || []).map(x => [x.name, x]));
  for (const link of links) { const p = progress.get(link.name); if (p) { link.status = p.status || ''; link.finished = !!p.finished; } }
  return { status: 200, data: { code, resumed: !!r.data.resumed, complete: !!r.data.complete, students: links,
    classUrl: `/api/launch?sim=${encodeURIComponent(sim.id || SIM)}&course=${encodeURIComponent(course.id)}&mode=session&session=${encodeURIComponent(code)}` } };
}

async function practiceStatus(me, course, sim) {
  const r = await ask(me, course, sim, { action: 'practice_status' });
  if (!r.ok) return { status: r.status, data: { error: r.data.error || 'practice_unavailable' } };
  const d = r.data || {};
  return { status: 200, data: { code: d.code || null, complete: !!d.complete,
    students: Array.isArray(d.students) ? d.students.slice(0, 6).map(x => ({ name: String(x.name || '').slice(0, 60),
      status: String(x.status || '').slice(0, 80), finished: !!x.finished })) : [] } };
}

async function practiceFinish(me, course, sim) {
  const r = await ask(me, course, sim, { action: 'practice_finish' });
  return { status: r.ok ? 200 : r.status, data: r.ok ? { ok: true } : { error: r.data.error || 'practice_unavailable' } };
}

// The course row and menu: the open session, or the most recent one.
async function courseStatus(me, course, sim) {
  const r = await ask(me, course, sim, { action: 'course_sessions' });
  if (!r.ok) return { status: 200, data: { available: false, open: null, last: null } };
  const pick = x => x ? { code: String(x.code || ''), name: String(x.name || '').slice(0, 80), mode: x.mode === 'individual' ? 'individual' : 'team',
    state: ['lobby', 'running', 'closed'].includes(x.state) ? x.state : 'closed', paused: !!x.paused, createdAt: x.createdAt || null,
    students: Number(x.students) || 0, teams: Number(x.teams) || 0, submitted: Number(x.submitted) || 0 } : null;
  const list = Array.isArray(r.data.sessions) ? r.data.sessions : [];
  return { status: 200, data: { available: true, open: pick(list.find(x => x.state !== 'closed')), last: pick(list.find(x => x.state === 'closed')), count: list.length } };
}

module.exports = { SIM, KIT_SIMS, ask, practiceStart, practiceStatus, practiceFinish, courseStatus, sessionUrl };
