// The completion this sim reports to the platform for one student's run.
// Session play carries the session, so Past sessions groups it; the review answers
// arrive as a later revision of the same report (same run id, higher revision).
const store = require('./store.js');
const { reportCompletion } = require('./launch.js');
const S = require('./scenario.js');
const B = require('./bands.js');

const label = (arr, id) => { const x = arr.find(a => a.id === id); return x ? x.label : id; };

// The session this launch is playing in, when the browser says so and the store agrees.
async function sessionFor(launch, b) {
  const code = String(b.code || '').toUpperCase().trim();
  if (!launch || !code || !/^[A-Z2-9]{5}$/.test(code) || !store.configured()) return null;
  try {
    const sess = await store.getSession(code);
    const pid = `platform:${launch.sub}`;
    if (!sess || sess.practice || (sess.courseId && sess.courseId !== launch.course)) return null;
    const me = (await store.getParticipants(code))[pid];
    return me ? { sess, pid } : null;
  } catch (e) { return null; }
}

async function report(launch, b, { positions, coverageEarnedAt, coveragePrivate, privateCount, firedAndIgnored, reflection1, reflection2, revision }) {
  if (!launch || !Array.isArray(positions) || positions.length !== S.PHASES.length) return { ok: false, skipped: true };
  const found = await sessionFor(launch, b);
  const band = B.bandOf(positions);
  const finalReading = label(S.READINGS, positions[positions.length - 1].reading);
  const summary = {
    finalReading, band, year3Band: band, bandLabel: B.BANDS[band] ? B.BANDS[band].label : null, bandTone: B.BANDS[band] ? B.BANDS[band].cls : null,
    reviewQuestions: S.REVIEW_QUESTIONS,
    result: { overall: B.BANDS[band] ? `${B.BANDS[band].label}. ${B.BANDS[band].phrase}.` : `Final reading: ${finalReading}.` },
    positions: positions.map(p => ({ reading: p.reading, action: p.action, tripwire: String(p.tripwire || '').slice(0, 400) })),
    coverageAdmission: coverageEarnedAt === null || coverageEarnedAt === undefined ? null : (S.PHASES[coverageEarnedAt] || {}).label || null,
    reflection1: reflection1 || '', reflection2: reflection2 || '',
    ...(found ? { sessionCode: found.sess.code, sessionName: found.sess.name || null, sessionCreatedAt: found.sess.createdAt || null } : {})
  };
  const metrics = {
    revision: revision || 1,
    'Result': B.BANDS[band] ? B.BANDS[band].label : '',
    'Final reading': finalReading,
    'Sequencing': B.actedEarly(positions) ? 'Acted irreversibly before Day 3' : 'Kept options open',
    'Coverage admission': summary.coverageAdmission ? summary.coverageAdmission + (coveragePrivate ? ' (privately)' : '') : 'Never obtained',
    'Private conversations': parseInt(privateCount, 10) || 0,
    ...(firedAndIgnored !== undefined ? { 'Tripwires not acted on': firedAndIgnored } : {}),
    ...(reflection1 || reflection2 ? { reflection1: reflection1 || '', reflection2: reflection2 || '' } : {})
  };
  return reportCompletion({ launch, runId: found ? `${found.sess.code}:${found.pid}` : launch.run, summary, metrics });
}

module.exports = { report, sessionFor };
