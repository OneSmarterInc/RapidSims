'use strict';
// Server only. What the shared faculty pages (platform/public/kit/) need from RapidSim 06: one run per
// student or team with its decision band, the debrief content, and the completion each student reports.
// Approved Oct 15, 2026. Students receive only the questions.
const cfg = require('../data/config.js');
const E = require('./engine.js');

// Shown after the reveal, so they never give the lesson away before play.
const LESSON_QUESTIONS = [
  'Which report made you most sure, and was it right?',
  'What did the two documents have in common?',
  'What would have told you that switching could not help?',
  'Who does your own backup depend on?'
];
// The second is the closing question from the instructor's debrief.
const REVIEW_QUESTIONS = [
  'Which report decided it for you, and what would have changed your mind?',
  'Name a service you depend on. Then name who it depends on. Keep going until you reach a company you had never heard of.'
];
const LESSONS = [
  { head: 'Redundancy is having two of something.', text: 'Harlow had two providers and two contracts.' },
  { head: 'Diversity means the second one fails for different reasons.', text: `Both providers ran over the same ${cfg.hiddenDependency} cable.` },
  { head: 'The risk sat outside every contract Harlow signed.', text: `${cfg.hiddenDependency} appears in both documents and in neither contract.` },
  { head: 'Switching has a cost even when it fixes nothing.', text: 'Eight minutes with no card sales, and the payments still timed out.' }
];
// No verdict reaches a student; these bands are for the faculty pages and Past sessions.
const BANDS = {
  stay: { label: 'Held', cls: 'g', phrase: 'Committed to staying on the primary provider' },
  none: { label: 'No decision', cls: 'y', phrase: 'The clock ran out before a decision' },
  switch: { label: 'Switched', cls: 'o', phrase: 'Switched to the backup provider' }
};
const ORDER = ['stay', 'none', 'switch'];

const ended = (sess, t) => !!sess.startedAt && t - sess.startedAt >= E.PLAY_MS;
const engineState = (sess, run) => ({ participantId: run.runId, begunAt: sess.startedAt || null, docsOpened: run.docsOpened, decision: run.decision || null });
const openedBoth = (sess, run) => {
  const st = engineState(sess, run);
  const reading = run.decision ? run.decision.docsBefore : Object.fromEntries(Object.entries(run.docsOpened || {}).map(([k, v]) => [k, v !== null && v <= (sess.startedAt || 0) + E.PLAY_MS]));
  return cfg.documents.every(d => reading && reading[d.id]);
};

// The faculty session as the shared pages read it. Faculty only.
function facultyKit(sess, participants, runs, t) {
  const done = ended(sess, t) || (sess.state === 'closed' && !!sess.startedAt);
  const team = sess.mode === 'team';
  const people = {}, out = {};
  for (const p of Object.values(participants || {}).filter(Boolean)) {
    people[p.id] = { id: p.id, name: p.name, joinedAt: p.joinedAt || null,
      ...(team ? { groupId: p.runId || null, teamLabel: p.runId ? (runs[p.runId]?.label || p.teamLabel) : null, isCaptain: false } : {}) };
  }
  for (const run of Object.values(runs || {}).filter(Boolean)) {
    const members = Object.values(participants || {}).filter(p => p && p.runId === run.runId);
    const joined = members.some(p => p.joinedAt);
    const d = run.decision;
    const finished = !!d || (done && joined);
    const band = d ? d.choice : finished ? 'none' : null;
    const st = engineState(sess, run);
    const reflections = {};
    for (const p of members) if (p.review) reflections[p.id] = { reflection1: p.review.reflection1, reflection2: p.review.reflection2 };
    out[run.runId] = { runId: run.runId, teamLabel: run.label, runnerId: members[0]?.id || null, completedBy: null,
      done: finished, completedAt: d ? (sess.startedAt || 0) + d.atMs : null, phase: sess.startedAt && joined ? 1 : 0, joined, band,
      atReport: d ? d.atReport : null, storyTime: d ? d.storyTime : null, reason: d ? d.reason : '', by: d ? d.by || null : null,
      openedBoth: openedBoth(sess, run), lost: sess.startedAt ? E.lostSoFar(st, Math.min(t, sess.startedAt + E.PLAY_MS)) : 0,
      reflections, ...(team ? {} : { reflection1: reflections[members[0]?.id]?.reflection1 || '', reflection2: reflections[members[0]?.id]?.reflection2 || '' }) };
  }
  const states = Object.values(runs || {}).filter(r => r && Object.values(participants || {}).some(p => p && p.runId === r.runId && p.joinedAt)).map(r => engineState(sess, r));
  const kit = {
    bands: BANDS, order: ORDER, ended: done, reports: cfg.reports.map(r => ({ n: r.n, source: r.source, text: r.text })),
    projector: sess.startedAt ? E.projector(states, done ? sess.startedAt + E.PLAY_MS : t) : null,
    map: cfg.reveal.map, caption: cfg.reveal.caption, documents: cfg.documents.map(d => ({ id: d.id, title: d.title })),
    hidden: cfg.hiddenDependency, minGroup: cfg.projectorMinGroupForReading,
    reviewQuestions: REVIEW_QUESTIONS, lessonQuestions: LESSON_QUESTIONS, lessons: LESSONS
  };
  return { participants: people, runs: out, kit };
}

// The completion one student reports: revision 1 at the reveal (or close), revision 2 with their review.
function completion(sess, me, run, revision) {
  if (!me || !run) return null;
  const team = sess.mode === 'team', d = run.decision, band = d ? d.choice : 'none', b = BANDS[band];
  const both = openedBoth(sess, run);
  const summary = {
    // A private run (a direct launch) is not a class session, so Past sessions does not group it.
    ...(sess.solo ? {} : { sessionCode: sess.code, sessionName: sess.name || null, sessionCreatedAt: sess.createdAt || null }),
    band, year3Band: band, bandLabel: b.label, bandTone: b.cls, reviewQuestions: REVIEW_QUESTIONS,
    result: { overall: d ? `${b.label} at report ${d.atReport} (${d.storyTime}). ${both ? 'Opened both documents first.' : 'Did not open both documents first.'}` : `${b.label}.` },
    choice: band, atReport: d ? d.atReport : null, openedBoth: both,
    ...(team ? { teamRunId: run.runId, teamLabel: run.label } : {}),
    reflection1: me.review?.reflection1 || '', reflection2: me.review?.reflection2 || ''
  };
  const metrics = { revision, Decision: b.label, 'At report': d ? d.atReport : '', 'Opened both documents': both ? 'Yes' : 'No',
    ...(me.review ? { reflection1: me.review.reflection1, reflection2: me.review.reflection2 } : {}) };
  return { runId: sess.solo ? sess.code : `${sess.code}:${run.runId}`, summary, metrics };
}

module.exports = { LESSON_QUESTIONS, REVIEW_QUESTIONS, LESSONS, BANDS, ORDER, facultyKit, completion, ended };
