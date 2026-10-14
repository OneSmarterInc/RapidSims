'use strict';
// The course page shows Midland's sessions by asking Midland directly, on the
// signed-in faculty member's behalf, with a short-lived signed launch.
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

const clean = x => ({ code: String(x.code || '').slice(0, 5), name: String(x.name || '').slice(0, 80),
  mode: x.mode === 'team' ? 'team' : 'individual', state: ['lobby', 'running', 'closed'].includes(x.state) ? x.state : 'closed',
  paused: !!x.paused, createdAt: Number(x.createdAt) || null, students: Number(x.students) || 0,
  teams: Number(x.teams) || 0, submitted: Number(x.submitted) || 0 });

async function list(me, course, sim) {
  const r = await ask(me, course, sim, { action: 'course_sessions' });
  if (!r.ok || !Array.isArray(r.data.sessions)) return { available: false, sessions: [] };
  return { available: true, sessions: r.data.sessions.slice(0, 20).map(clean) };
}

async function close(me, course, sim, code) {
  if (!/^[A-Z2-9]{5}$/.test(code)) return { status: 400, data: { error: 'invalid_session' } };
  const r = await ask(me, course, sim, { action: 'control', code, set: 'close' });
  return { status: r.ok ? 200 : r.status, data: r.ok ? { ok: true } : { error: r.data.error || 'close_failed' } };
}

module.exports = { SIM, list, close, sessionUrl };
