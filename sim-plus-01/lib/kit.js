'use strict';
// Server only. What the shared faculty pages (platform/public/kit/) need from Why Don't They Have Any Patience?:
// one record per student run with its band (the call on the first-pass review desk), the debrief content (what was
// going on, the lessons) and the completion each student reports. Approved Oct 16, 2026.
const { META } = require('./meta');
const { SOURCES } = require('../src/engine');
const { WINDOWS } = require('../data/calendar');
const { ROWS, DISPOSITIONS, EVIDENCE } = require('../data/report');
const { review } = require('../src/report');
const { CLASSIFICATION_LABELS, OBSERVATION, readEstimate } = require('../data/simmeta');

// Shown after the report is filed, so they never steer the interviews.
const REVIEW_QUESTIONS = [
  'Which question opened the most useful answer, and why did it work?',
  'What would you ask first if you ran the interviews again?'
];
const LESSONS = [
  { head: 'The wording of a question decides what you hear.', text: 'Open-ended questions cost the most time. Questions about exceptions, about what would happen if a step stopped, and about how the sender sees it opened the useful answers.' },
  { head: 'One question can close a source for good.', text: 'Asking Ruth whether her step could be automated or cut made her stop volunteering anything. She stayed polite, so most people did not notice.' },
  { head: 'The cause sits between the people you interview.', text: 'Ray knew senders hear nothing back. Ruth knew repeat copies arrive six to ten days apart. Together they explain the duplicates.' },
  { head: 'A recommendation is only as strong as its evidence.', text: 'Keeping the review desk is the safe call. Knowing why it matters is what lets you design what replaces it.' }
];
// The band is the call on the first-pass review desk, the step the whole sim turns on.
const BANDS = {
  matched: { label: 'Matching kept, with the evidence', cls: 'g', phrase: 'Kept first-pass review after hearing why the matching matters' },
  kept: { label: 'Matching kept, without the evidence', cls: 'y', phrase: 'Kept first-pass review without hearing why it matters' },
  study: { label: 'Sent for a second study', cls: 'o', phrase: 'Left the review desk unchanged for another study' },
  duplicates: { label: 'Duplicates paid', cls: 'l', phrase: 'The new system pays repeat copies twice' }
};
const ORDER = ['matched', 'kept', 'study', 'duplicates'];
const DISPOSITION_LABELS = { automate: 'Automate', keep: 'Keep', eliminate: 'Eliminate', cannot_assess: 'Cannot assess' };
const SEVERITY_LABELS = { harm: 'Causes harm', miss: 'Carries the problem forward', dodge: 'Left for another study', partial: 'Partly addresses it', ok: 'Holds up', correct: 'The defensible call' };
// What was going on at Wexford. Faculty only, from the server.
const REVEAL = {
  heading: 'What was going on',
  paragraphs: [
    'Paper and fax senders never hear that a claim arrived. Six to ten days later, many send it again.',
    'Ruth Kessler’s first-pass review is where those repeat copies are caught. She matches them by judgment, and that judgment is written down nowhere.',
    'The receipt log has no reader: it answers a mail problem last seen ten years ago. The fax vendor step is out of sight from inside Wexford.',
    'An acknowledgment to every sender addresses the cause. Until it exists, the review desk is the safety net.'
  ]
};
const DEBRIEF_NOTES = [
  'Open with the review desk: ask who kept it, and what they heard that made them keep it.',
  'Put one transcript on screen where Ruth stopped volunteering. Ask the class to find the question that did it; she stays polite, so the author rarely notices.',
  `Observation: six claims in seven take ${OBSERVATION.cleanSeconds} seconds and three take two to three minutes. Ask what students saw at claims four, eleven and seventeen, and who asked Ruth about them.`,
  'The loop needs two people: Ray (nothing goes back to paper and fax senders) and Ruth (repeat copies arrive six to ten days apart). Ask who held both halves.',
  'The fax vendor is the one step nobody inside Wexford can describe, so Cannot assess is the defensible call there.'
];

const sourceName = id => (SOURCES[id] || {}).name || id;

function bandOf(result) {
  if (!result || !result.ok) return null;
  const d = (result.consequences.find(c => c.rowId === 'review') || {}).disposition;
  if (d === 'automate' || d === 'eliminate') return 'duplicates';
  if (d === 'cannot_assess') return 'study';
  return result.support.review ? 'matched' : 'kept';
}

// Where a run is: 0 not started, 1 interviewing, 2 chart, 3 report, 4 filed.
function stageOf(s) {
  if (!s) return 0;
  if (s.submission) return 4;
  if (s.completedChart) return 3;
  if (s.order && s.windowIndex >= WINDOWS.length) return 2;
  return s.order ? 1 : 0;
}
const STAGES = ['Reading the brief', 'Interviewing', 'Completing the chart', 'Writing the report', 'Report filed'];

// One student's run as the faculty pages read it. Faculty only: it carries the transcript and the classifications.
function runRecord(p, s) {
  const result = s && s.submission ? review(s.submission, s.transcript) : null;
  const ruthTurns = s ? s.transcript.filter(t => t.sourceId === 'ruth') : [];
  const closing = ruthTurns.find(t => t.postureAfter === 'CLOSED' && t.postureBefore !== 'CLOSED');
  const opening = ruthTurns.find(t => t.postureAfter === 'OPEN' && t.postureBefore !== 'OPEN');
  const reflections = p.review ? { [p.id]: { reflection1: p.review.reflection1, reflection2: p.review.reflection2 } } : {};
  return {
    runId: `individual:${p.id}`, runnerId: p.id, teamLabel: p.name, completedBy: result ? p.id : null,
    joined: !!p.joinedAt, phase: stageOf(s), stage: STAGES[stageOf(s)], done: !!result, completedAt: p.filedAt || null,
    band: bandOf(result),
    order: s && s.order ? s.order.map(sourceName) : [],
    windows: s && s.order ? WINDOWS.map((w, i) => {
      const turns = s.transcript.filter(t => t.window === w.id);
      return { label: w.label, source: sourceName(s.order[i]), questions: turns.length, seconds: turns.reduce((n, t) => n + t.spent, 0) };
    }) : [],
    ruth: ruthTurns.length ? (closing ? 'closed' : opening ? 'opened' : 'guarded') : 'not_reached',
    ruthClosedBy: closing ? closing.question : null, ruthOpenedBy: opening ? opening.question : null,
    observationSeconds: s ? s.observationSeconds : null, observationNote: s && s.observationSeconds != null ? (readEstimate(s.observationSeconds) || {}).note || '' : '',
    chart: s ? s.completedChart : null,
    report: result ? { rootCause: result.rootCause, rows: result.consequences.map(c => ({ rowId: c.rowId, label: c.label, disposition: c.disposition,
      justification: ((s.submission.rows || {})[c.rowId] || {}).justification || '', severity: c.severity, configured: c.configured, supported: result.support[c.rowId] !== false })) } : null,
    // The loop names the pair of answers the student actually heard (#97).
    evidence: result ? { held: result.evidence.held.map(e => e.label), missed: result.evidence.missed.map(e => e.label), loop: result.evidence.loopAvailable,
      loopPair: (result.evidence.loopPairsHeld[0] || []).map(id => (EVIDENCE.find(e => e.id === id) || {}).label || id) } : null,
    transcript: s ? s.transcript.map(t => ({ window: t.window, source: t.sourceName, question: t.question, answer: t.answer || '', kind: CLASSIFICATION_LABELS[t.bucket] || '',
      spent: t.spent, closed: t.postureAfter === 'CLOSED' && t.postureBefore !== 'CLOSED', opened: t.postureAfter === 'OPEN' && t.postureBefore !== 'OPEN' })) : [],
    reflections, reflection1: p.review ? p.review.reflection1 : '', reflection2: p.review ? p.review.reflection2 : ''
  };
}

// The faculty session as the shared pages read it. Faculty only.
function facultyKit(sess, people, sessions) {
  const participants = {}, runs = {};
  for (const p of people) {
    participants[p.id] = { id: p.id, name: p.name, joinedAt: p.joinedAt || null, groupId: p.id, isCaptain: false };
    runs[`individual:${p.id}`] = runRecord(p, sessions[p.id] || null);
  }
  const kit = {
    bands: BANDS, order: ORDER, ended: sess.state === 'closed', rows: ROWS.map(r => ({ id: r.id, label: r.label })), dispositions: DISPOSITION_LABELS,
    severities: SEVERITY_LABELS, sources: Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, { name: v.name, role: v.role }])),
    observation: OBSERVATION, reveal: REVEAL, debriefNotes: DEBRIEF_NOTES, reviewQuestions: REVIEW_QUESTIONS, lessonQuestions: [], lessons: LESSONS
  };
  return { participants, runs, kit };
}

// The completion one student reports: revision 1 when the report is filed (or the session closes), revision 2 with the review.
function completion(sess, p, s, revision) {
  const result = s && s.submission ? review(s.submission, s.transcript) : null;
  if (!result || !result.ok) return null;
  const band = bandOf(result), b = BANDS[band];
  const summary = {
    ...(sess.practice ? {} : { sessionCode: sess.code, sessionName: sess.name || null, sessionCreatedAt: sess.createdAt || null }),
    band, bandLabel: b.label, bandTone: b.cls, reviewQuestions: REVIEW_QUESTIONS,
    result: { overall: `${b.label}. ${result.consequences.map(c => `${c.label}: ${DISPOSITION_LABELS[c.disposition]}`).join('. ')}.` },
    order: s.order.map(sourceName), rootCause: result.rootCause, evidenceHeld: result.evidence.held.map(e => e.label),
    reflection1: (p.review && p.review.reflection1) || '', reflection2: (p.review && p.review.reflection2) || ''
  };
  const metrics = { revision, Band: b.label, 'Key answers heard': result.evidence.held.length, 'Questions asked': s.transcript.length,
    ...Object.fromEntries(result.consequences.map(c => [c.label, DISPOSITION_LABELS[c.disposition]])),
    ...(p.review ? { reflection1: p.review.reflection1, reflection2: p.review.reflection2 } : {}) };
  return { runId: `${sess.code}:${p.id}`, summary, metrics };
}

module.exports = { REVIEW_QUESTIONS, LESSONS, BANDS, ORDER, REVEAL, DEBRIEF_NOTES, STAGES, bandOf, stageOf, runRecord, facultyKit, completion, META, DISPOSITIONS };
