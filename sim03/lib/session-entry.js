const { verifyLaunch } = require('./launch.js');
const { META } = require('./scenario.js');
const store = require('./store.js');

function accountJoinUrl(sess) {
  const base = (process.env.PLATFORM_URL || 'https://rapidsims.flexee.org').replace(/\/+$/, '');
  const url = new URL(base + '/session.html');
  url.searchParams.set('sim', META.id);
  url.searchParams.set('session', sess.code);
  if (sess.courseId) url.searchParams.set('course', sess.courseId);
  return url.href;
}

// Practice students exist only inside a practice session: practice-<faculty id>-<name>.
const isPracticeSub = sub => String(sub || '').startsWith('practice-');

function participantLaunch(req, b) {
  const token = req.headers?.['x-launch-token'] || b?.launchToken;
  const p = token ? verifyLaunch(String(token)) : null;
  return p && p.sim === META.id && p.sub &&
    ['student', 'faculty', 'faculty_preview'].includes(p.role) ? p : null;
}

// Standalone code-based sessions retain their existing behavior. Platform
// participants are bound to the signed account, not a name or a remembered ID.
function participantError(req, b, sess, pid) {
  if (!sess.platformAuth && !String(pid || '').startsWith('platform:')) return null;
  const p = participantLaunch(req, b);
  if (!p) return { status: 401, error: 'platform_signin_required' };
  if (sess.courseId && p.course !== sess.courseId) return { status: 403, error: 'session_course_mismatch' };
  if (pid && pid !== `platform:${p.sub}`) return { status: 403, error: 'participant_identity_mismatch' };
  return null;
}

// A student launched from a course that has an open team session belongs in
// that session. Returns the session, or null when there is none to join.
async function openTeamSessionFor(launch) {
  if (!launch || launch.role !== 'student' || !launch.course || !store.configured()) return null;
  if (isPracticeSub(launch.sub)) return null;
  try {
    const code = await store.getCourseTeamSession(launch.course);
    const sess = code ? await store.getSession(code) : null;
    return sess && sess.mode === 'team' && sess.state !== 'closed' && sess.courseId === launch.course ? sess : null;
  } catch (e) {
    console.error('course team session lookup failed', e.code || e.message);
    return null;
  }
}

module.exports = { accountJoinUrl, participantLaunch, participantError, openTeamSessionFor, isPracticeSub };
