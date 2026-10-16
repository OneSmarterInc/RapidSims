'use strict';

const crypto = require('crypto');
const { checkAccess, body, facultyAccess } = require('../lib/guard');
const store = require('../lib/store');
const { Session, SOURCES } = require('../src/engine');
const { validate, review } = require('../src/report');
const { ROWS, DISPOSITIONS } = require('../data/report');
const { WINDOWS, AVAILABILITY, feasibleOrderings } = require('../data/calendar');
const { serialize, hydrate } = require('../lib/session');
const { reportCompletion, reportTranscript } = require('../lib/launch');
const { buildEnvelope } = require('../src/transcript');
const KA = require('../lib/kit-api');
const K = require('../lib/kit');

const key = (id) => `run03:${id}`;
const participantKey = (sub, code) => code ? `run03:participant:${code}:${sub}` : `run03:participant:${sub}`;
// A student from the class link plays inside a faculty session; a faculty member trying the sim plays on their own.
const inSession = (launch) => !!(launch && launch.role === 'student');
const id = () => crypto.randomBytes(12).toString('hex');
const load = async (runId) => { const raw = await store.getRaw(key(runId)); return raw ? hydrate(raw) : null; };
const save = (runId, session) => store.putRaw(key(runId), serialize(session));

const GENERIC_STARTERS = [
  "What happens when something doesn't go the way it should?",
  'Who receives this after you?',
  'What would happen if this stopped?',
  'Why is it done this way?',
  'What does the person on the other end see?'
];

const CHART_FIELDS = {
  intake: ['longestWait', 'faxRouting', 'providerReceipt'],
  log: ['purpose', 'receiver'],
  review: ['step', 'owner', 'receiver', 'catches', 'dependsOn']
};

async function resolveRunId(req, requested, code) {
  const explicit = String(requested || '').trim();
  if (explicit) return explicit;
  const sub = req.launch && req.launch.sub;
  if (!sub) return '';
  const pointer = await store.getRaw(participantKey(sub, code));
  return pointer && pointer.runId ? String(pointer.runId) : '';
}

function normalizeChart(raw, observationSeconds) {
  const input = raw || {};
  const chart = { intake: {}, log: {}, review: { timingSeconds: Number(observationSeconds) } };
  const errors = [];
  for (const [step, fields] of Object.entries(CHART_FIELDS)) {
    for (const field of fields) {
      const source = ((input[step] || {})[field]) || {};
      const value = String(source.value || '').trim().slice(0, 800);
      const couldNotEstablish = source.couldNotEstablish === true;
      if (!value && !couldNotEstablish) errors.push(`${step}.${field}`);
      chart[step][field] = { value, couldNotEstablish };
    }
  }
  return { ok: errors.length === 0, errors, chart };
}

function participantOutcome(s, result) {
  return {
    rootCause: result.rootCause,
    consequences: result.consequences.map((c) => ({
      rowId: c.rowId,
      label: c.label,
      disposition: c.disposition,
      configured: c.configured,
      consequence: c.consequence
    })),
    submission: s.submission,
    completedChart: s.completedChart,
    observationSeconds: s.observationSeconds
  };
}

// The review after the report: its two questions, and whether the student has sent it.
function reviewState(sess, me) {
  return sess ? { open: true, sent: !!(me && me.review), questions: K.REVIEW_QUESTIONS } : { open: false };
}

function publicState(s) {
  const sourceId = s.currentSourceId;
  const windowHistory = WINDOWS.map((w, index) => {
    const sourceKey = s.order && s.order[index];
    const turns = s.transcript.filter((t) => t.window === w.id);
    const secondsUsed = turns.reduce((sum, t) => sum + t.spent, 0);
    const isCurrent = index === s.windowIndex;
    return {
      window: w.id,
      sourceId: sourceKey || null,
      sourceName: sourceKey ? SOURCES[sourceKey].name : null,
      questions: turns.length,
      secondsUsed,
      secondsUnused: isCurrent ? s.remaining : Math.max(0, 900 - secondsUsed),
      complete: index < s.windowIndex || sourceId === null,
      turns: isCurrent ? turns.map((t) => ({ spent: t.spent, remaining: t.remaining })) : []
    };
  });
  return {
    order: s.order,
    windowIndex: s.windowIndex,
    windowsTotal: WINDOWS.length,
    remaining: s.remaining,
    finishedInterviews: sourceId === null,
    observationSeconds: s.observationSeconds ?? null,
    chartCompleted: !!s.completedChart,
    completedChart: s.completedChart || null,
    windowHistory,
    source: sourceId ? { id: sourceId, name: SOURCES[sourceId].name, role: SOURCES[sourceId].role } : null,
    conversation: sourceId ? s.transcript.filter(t => t.sourceId === sourceId).map(t => ({ question: t.question, answer: t.answer, spent: t.spent, remaining: t.remaining })) : []
  };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!checkAccess(req, res)) return;
  if (!store.configured()) return res.status(503).json({ error: 'no_store', message: 'Session storage is not configured.' });
  const b = body(req);
  try {
    // A student's session: the class's open session (or a practice student's own), checked against the launch.
    let sess = null, me = null;
    if (inSession(req.launch)) {
      // The class's open session; otherwise the last one this student joined, so a filed report stays readable after close.
      const lastKey = `kit:student:${req.launch.course || ''}:${req.launch.sub}`;
      const code = String(b.code || '').toUpperCase().trim() || await KA.entryCode(req.launch) || ((await store.getRaw(lastKey)) || {}).code || '';
      sess = code ? await store.getSession(code) : null;
      const pid = `platform:${req.launch.sub}`;
      const allowed = sess && sess.kit && sess.courseId === (req.launch.course || null) &&
        (KA.isPracticeSub(req.launch.sub) ? sess.practice && code === await KA.entryCode(req.launch) : !sess.practice);
      if (!allowed) return res.status(409).json({ error: 'no_open_session', message: 'Your instructor has not opened a session for this class yet. Open it again from your class page when it is ready.' });
      me = await store.getParticipant(sess.code, pid);
      if (!me || !me.joinedAt || me.launchId !== (req.launch.run || null)) {
        if (!me && sess.state === 'closed') return res.status(409).json({ error: 'session_closed', message: 'This session is closed. Your instructor can open a new one.' });
        me = { ...(me || { id: pid, groupId: pid, source: 'class-link', addedAt: Date.now() }), name: me && me.name || String(req.launch.name || 'Student').slice(0, 60),
          joinedAt: (me && me.joinedAt) || Date.now(), launchId: req.launch.run || null };
        await store.setParticipant(sess.code, pid, me);
        await store.putRaw(lastKey, { code: sess.code });
      }
      if (b.action === 'entry') return res.status(200).json({ code: sess.code, state: sess.state, practice: !!sess.practice });
      if (sess.state === 'lobby' && b.action !== 'brief') return res.status(409).json({ error: 'session_not_started', message: 'Your instructor starts the session shortly.' });
      if (sess.state === 'closed' && !['brief', 'resume', 'review'].includes(b.action)) return res.status(409).json({ error: 'session_closed', message: 'This session is closed. Your saved work and report stay as they are.' });
    } else if (b.action === 'entry') return res.status(200).json({ code: null, state: 'running', practice: false });

    if (b.action === 'brief') return res.status(200).json({
      faculty: facultyAccess(req),
      title: 'Why Don\'t They Have Any Patience?',
      organization: 'Wexford Benefit Administrators',
      assignment: 'Document how claims are handled from arrival until adjudication. Verify handoffs, waits, outputs, provider contact, and anything the partial chart cannot establish.',
      context: [
        'Wexford administers dental claims for self-funded employer plans. Around twelve hundred claims arrive each working day.',
        'The claims platform is being replaced. The configuration team needs a verified account of what happens from arrival until adjudication.',
        'The vendor\'s chart is incomplete and came from an earlier engagement. Treat it as a starting point, not a finding.',
        'You have three fixed fifteen-minute appointments and no second visits.'
      ],
      requirements: [
        'Every point where a claim changes hands or waits',
        'What each step produces and who receives it',
        'Every point where the submitting provider is contacted, or contacts Wexford',
        'Anything on the chart that you cannot verify'
      ],
      chart: [
        { id: 'arrival', title: 'Claim arrives', detail: 'Post · fax to outside conversion vendor · fax converted here · clearinghouse', purpose: 'Intake', owner: 'Mail room', timing: 'Releases 09:00 and 14:00' },
        { id: 'log', title: 'Receipt log', detail: 'All non-electronic claims posted to a spreadsheet before onward routing', purpose: null, owner: 'Log desk', timing: 'Approx. 6 hours/day' },
        { id: 'gap', title: 'Not documented', detail: 'A step exists; no detail was recorded', purpose: null, owner: null, timing: null },
        { id: 'adjudication', title: 'Adjudication', detail: 'Out of scope', purpose: null, owner: null, timing: null }
      ],
      observation: {
        heading: 'First-pass review desk',
        instruction: 'Watch the batch. When it is done, record what you think a claim takes.'
      },
      starters: GENERIC_STARTERS,
      windows: WINDOWS,
      availability: AVAILABILITY,
      orderings: feasibleOrderings(),
      sources: Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, { name: v.name, role: v.role }])),
      rows: ROWS,
      dispositions: DISPOSITIONS
    });

    if (b.action === 'start') {
      const runId = id();
      const s = new Session().chooseOrder(b.order || []);
      const observed = Number(b.observationSeconds);
      s.observationSeconds = Number.isFinite(observed) && observed > 0 ? observed : null;
      if (!s.observationSeconds) return res.status(400).json({ error: 'observation_required', message: 'Record the observed seconds per claim before starting interviews.' });
      s.launch = req.launch || null;
      await save(runId, s);
      if (req.launch && req.launch.sub) await store.putRaw(participantKey(req.launch.sub, sess && sess.code), { runId });
      if (sess) await store.setParticipant(sess.code, me.id, (me = { ...me, runId }));
      return res.status(200).json({ runId, state: publicState(s) });
    }

    const runId = await resolveRunId(req, sess ? '' : b.runId, sess && sess.code);
    if (!runId) return res.status(404).json({ error: 'no_such_run' });
    const s = await load(runId);
    if (!s) return res.status(404).json({ error: 'no_such_run' });
    if (s.launch && (!req.launch || req.launch.sub !== s.launch.sub ||
        (req.launch.course || null) !== (s.launch.course || null))) {
      return res.status(403).json({ error: 'not_your_run' });
    }
    if (!s.launch && req.launch) return res.status(403).json({ error: 'standalone_run' });

    if (b.action === 'resume') return res.status(200).json({ runId, state: publicState(s), submitted: !!s.submission });

    if (b.action === 'ask') {
      const question = String(b.question || '').trim();
      if (!question) return res.status(400).json({ error: 'question_required' });
      const turn = s.ask(question);
      if (turn.error) return res.status(409).json({ error: turn.error.toLowerCase() });
      await save(runId, s);
      return res.status(200).json({ answer: turn.answer, remaining: turn.remaining, state: publicState(s) });
    }

    if (b.action === 'advance') {
      if (!s.order || s.currentSourceId === null) return res.status(409).json({ error: 'interviews_complete' });
      const result = s.advanceWindow();
      await save(runId, s);
      return res.status(200).json({ done: result.done, state: publicState(s) });
    }

    if (b.action === 'save_chart') {
      if (s.currentSourceId !== null) return res.status(409).json({ error: 'interviews_not_complete' });
      const normalized = normalizeChart(b.chart, s.observationSeconds);
      if (!normalized.ok) return res.status(400).json({ error: 'chart_incomplete', fields: normalized.errors, message: 'Fill each chart field or mark it could not be established.' });
      s.completedChart = normalized.chart;
      await save(runId, s);
      return res.status(200).json({ state: publicState(s) });
    }

    if (b.action === 'submit') {
      if (s.currentSourceId !== null) return res.status(409).json({ error: 'interviews_not_complete' });
      if (!s.completedChart) return res.status(409).json({ error: 'chart_not_complete', message: 'Complete the process chart before filing the report.' });
      const checked = validate(b.submission);
      if (!checked.ok) return res.status(400).json(checked);
      s.submission = b.submission;
      await save(runId, s);
      const result = review(s.submission, s.transcript);
      const who = req.launch || s.launch;
      if (sess) {
        await store.setParticipant(sess.code, me.id, (me = { ...me, filedAt: Date.now() }));
        if (!sess.practice) {
          const envelope = buildEnvelope(s, result, { sessionId: runId, observationSeconds: s.observationSeconds,
            participant: { id: who.sub, displayName: who.name || null }, cohortId: who.course || null, completedAt: new Date().toISOString() });
          const transcript = await reportTranscript({ launch: who, runId, envelope });
          const completion = await KA.reportPerson(sess, me, 1);
          if ((!transcript.ok && !transcript.queued) || (!completion.ok && !completion.queued)) {
            return res.status(503).json({ error: 'report_not_queued', message: 'Your work is saved. Please retry submission so the instructor receives it.' });
          }
        }
      } else if (who) {
        const envelope = buildEnvelope(s, result, {
          sessionId: runId,
          observationSeconds: s.observationSeconds,
          participant: { id: who.sub, displayName: who.name || null },
          cohortId: who.course || null,
          completedAt: new Date().toISOString()
        });
        const transcript = await reportTranscript({ launch: who, runId, envelope });
        const completion = await reportCompletion({ launch: who, runId, summary: result.harmFired ? 'Recommendation caused harm' : 'Report completed', metrics: { harmFired: result.harmFired, evidenceHeld: result.evidence.held.length, loopAvailable: result.evidence.loopAvailable } });
        if ((!transcript.ok && !transcript.queued) || (!completion.ok && !completion.queued)) {
          return res.status(503).json({ error: 'report_not_queued', message: 'Your work is saved. Please retry submission so the instructor receives it.' });
        }
      }
      return res.status(200).json({ outcome: participantOutcome(s, result), studentReview: reviewState(sess, me) });
    }

    if (b.action === 'review') {
      if (!s.submission) return res.status(409).json({ error: 'report_not_submitted' });
      const result = review(s.submission, s.transcript);
      return res.status(200).json({ outcome: participantOutcome(s, result), studentReview: reviewState(sess, me) });
    }

    // The two review questions after the report. Revision 2 of the student's completion.
    if (b.action === 'review_answers') {
      if (!sess) return res.status(409).json({ error: 'no_session' });
      if (!s.submission) return res.status(409).json({ error: 'report_not_submitted' });
      const a1 = String(b.reflection1 || '').trim().slice(0, 1500), a2 = String(b.reflection2 || '').trim().slice(0, 1500);
      if (!a1 || !a2) return res.status(400).json({ error: 'answers_required', message: 'Answer both questions, then send.' });
      await store.setParticipant(sess.code, me.id, (me = { ...me, review: { reflection1: a1, reflection2: a2, at: Date.now() } }));
      await KA.reportPerson(sess, me, 2);
      return res.status(200).json({ studentReview: reviewState(sess, me) });
    }

    return res.status(400).json({ error: 'unknown_action' });
  } catch (e) {
    if (/ordering|order already/.test(e.message)) return res.status(400).json({ error: 'invalid_order', message: e.message });
    console.error('rapidsims01', e);
    return res.status(500).json({ error: e.code === 'NO_STORE' ? 'no_store' : 'server_error', message: e.message });
  }
};

