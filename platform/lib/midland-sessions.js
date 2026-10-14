'use strict';
// The course page talks to Midland on the faculty member's behalf, with a
// short-lived signed faculty launch for that course.
const crypto = require('node:crypto');
const { launchToken } = require('./launch.js');
const SIM = 'rapid-03-midland';
let apps = {};
try { apps = require('../../ec2/apps.json'); } catch { apps = {}; }

function sessionUrl(sim) {
  if (process.env.SIM03_SESSION_URL) return process.env.SIM03_SESSION_URL;
  const port = apps.sim03 && apps.sim03.port;
  if (port) return `http://127.0.0.1:${port}/api/session`;
  return String(sim.launch_url || '').replace(/\/+$/, '') + '/api/session';
}

async function ask(me, course, sim, body) {
  const token = launchToken({ userId: me.id, name: me.name, email: me.email, role: 'faculty',
    simId: SIM, courseId: course.id, mode: 'session', runId: 'course-page', minutes: 5 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const r = await fetch(sessionUrl(sim), { method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-launch-token': token }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: d };
  } catch (e) {
    return { ok: false, status: 503, data: { error: 'midland_unavailable' } };
  } finally { clearTimeout(timer); }
}

// Three practice students on one team. Each gets a signed student launch for
// the practice session only; the first enters the team's decisions.
const PRACTICE = [['ana', 'Practice Ana'], ['ben', 'Practice Ben'], ['cal', 'Practice Cal']];
async function practiceStart(me, course, sim, startOver = false) {
  const run = crypto.randomBytes(4).toString('hex');
  const students = PRACTICE.map(([key, name]) => ({ sub: `practice-${me.id}-${key}`, name }));
  const r = await ask(me, course, sim, { action: 'practice_start', students, startOver: startOver === true });
  if (!r.ok || !r.data.code) return { status: r.ok ? 502 : r.status, data: { error: r.data.error || 'practice_unavailable' } };
  const code = r.data.code;
  const base = String(sim.launch_url || '').replace(/\/+$/, '');
  const links = students.map((x, i) => {
    const token = launchToken({ userId: x.sub, name: x.name, role: 'student', simId: SIM, courseId: course.id,
      mode: 'play', runId: `practice-${run}-${i}`, minutes: 240 });
    return { name: x.name, entersDecisions: i === 0,
      url: `${base}/?session=${encodeURIComponent(code)}#lt=${encodeURIComponent(token)}` };
  });
  return { status: 200, data: { code, resumed: !!r.data.resumed, students: links,
    classUrl: `/api/launch?sim=${SIM}&course=${encodeURIComponent(course.id)}&mode=session&session=${encodeURIComponent(code)}` } };
}

async function practiceFinish(me, course, sim) {
  const r = await ask(me, course, sim, { action: 'practice_finish' });
  return { status: r.ok ? 200 : r.status, data: r.ok ? { ok: true } : { error: r.data.error || 'practice_unavailable' } };
}

module.exports = { SIM, ask, practiceStart, practiceFinish, sessionUrl };
