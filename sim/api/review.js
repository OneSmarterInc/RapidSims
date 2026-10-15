// A student's two review answers, written after the debrief. They are saved on the
// student's run in the session (for the faculty Results tab and the class debrief) and
// sent to the platform as a later revision of the same completion.
const { checkAccess, body } = require('../lib/guard.js');
const store = require('../lib/store.js');
const { report, sessionFor } = require('../lib/completion.js');
const S = require('../lib/scenario.js');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!checkAccess(req, res)) return;
  const b = body(req);
  const reflection1 = String(b.reflection1 || '').trim().slice(0, 1500);
  const reflection2 = String(b.reflection2 || '').trim().slice(0, 1500);
  if (!reflection1 || !reflection2) return res.status(400).json({ error: 'answers_required', message: 'Answer both questions, then submit.' });
  const positions = Array.isArray(b.positions) ? b.positions.slice(0, 3) : [];
  if (positions.length !== S.PHASES.length) return res.status(400).json({ error: 'incomplete run' });
  let saved = false;
  if (req.launch) {
    const found = await sessionFor(req.launch, b);
    if (found) {
      const runs = await store.getRuns(found.sess.code);
      const run = runs[found.pid] || { groupId: found.pid, positions, phase: 3, done: true };
      Object.assign(run, { reflection1, reflection2, reviewedAt: Date.now(), updatedAt: Date.now() });
      await store.setRun(found.sess.code, found.pid, run);
      saved = true;
    }
    await report(req.launch, b, {
      positions, coverageEarnedAt: b.coverageEarnedAt === null || b.coverageEarnedAt === undefined ? null : parseInt(b.coverageEarnedAt, 10),
      coveragePrivate: !!b.coveragePrivate, privateCount: b.privateCount, reflection1, reflection2, revision: 2
    });
  }
  return res.status(200).json({ ok: true, saved });
};
