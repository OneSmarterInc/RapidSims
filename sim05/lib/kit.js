// Server only. What the shared faculty pages (platform/public/kit/) need from RapidSim 05:
// one run per student or team with its ending band, the debrief content, and the completion
// each student reports. Approved Oct 15, 2026. Students receive only the questions.
const C = require('../config/content.js');
const E = require('./engine.js');
const R = require('./room.js');

// Shown under the ending, so they never give the lesson away before play.
const LESSON_QUESTIONS = [
  'Which request was hardest to decide, and why?',
  'What could Loopwell work out about Dana that she never told it?',
  'Which feature asked for more data than it needed?',
  'Did Dana agree to the combination, or only to each step?'
];
// The two questions every student answers after the ending. The second was the closing question.
const REVIEW_QUESTIONS = [
  'Which approval would you take back, and what did it let Loopwell work out?',
  C.DEBRIEF.turn
];
// The six endings, red for the furthest inference to green for nothing beyond what Dana enters.
const TONES = { 1: 'l', 2: 'o', 3: 'o', 4: 'y', 5: 'g', 6: 'g' };
const PHRASES = {
  1: 'Loopwell can name the change with high confidence',
  2: 'Loopwell can guess at the change',
  3: 'Loopwell found a second address',
  4: 'Loopwell knows home and workplace',
  5: 'Loopwell knows her routine',
  6: 'Loopwell knows only what Dana enters'
};
function bands(intensity) {
  return Object.fromEntries(C.ENDINGS.map(e => [`e${e.group}`, { label: E.endingLabel(e.group, intensity), cls: TONES[e.group], phrase: PHRASES[e.group] }]));
}
const ORDER = C.ENDINGS.map(e => `e${e.group}`);

function ended(sess, now) { return R.clock(sess, now).closedRounds === 5; }
function decisionsOf(sess, participants, run, closed) {
  if (sess.mode === 'team') return R.teamDecisions(sess, participants, run.groupId, closed).map(t => t.decision);
  return R.ownVotes(participants[run.pid], closed).map((d, i) => (i < closed ? d : undefined));
}

// The faculty session as the shared pages read it. Faculty only.
function facultyKit(sess, participants, now) {
  const clk = R.clock(sess, now), closed = clk.closedRounds, done = ended(sess, now);
  const intensity = sess.intensity || 'standard', team = sess.mode === 'team';
  const people = {}, runs = {};
  for (const p of Object.values(participants || {}).filter(Boolean)) {
    people[p.id] = { id: p.id, name: p.name, joinedAt: p.joinedAt || null,
      ...(team ? { groupId: p.groupId || null, teamLabel: p.groupId ? R.teamLabel(sess, participants, p.groupId) : null, isCaptain: false } : {}) };
  }
  const list = team
    ? R.teamGroups(sess, participants).map(groupId => ({ runId: groupId, groupId, members: (sess.teams && sess.teams[groupId]) || Object.values(participants).filter(p => p && p.groupId === groupId).map(p => p.id) }))
    : Object.values(participants || {}).filter(p => p && p.joinedAt).map(p => ({ runId: `individual:${p.id}`, pid: p.id, members: [p.id] }));
  for (const run of list) {
    const joined = run.members.some(id => participants[id]?.joinedAt);
    const decisions = decisionsOf(sess, participants, run, closed);
    const finished = done && joined;
    const reflections = {};
    for (const id of run.members) { const r = participants[id]?.review; if (r) reflections[id] = { reflection1: r.reflection1, reflection2: r.reflection2 }; }
    const e = finished ? E.ending(decisions, intensity) : null;
    runs[run.runId] = { runId: run.runId, teamLabel: team ? R.teamLabel(sess, participants, run.groupId) : participants[run.pid]?.name,
      runnerId: run.members[0] || null, completedBy: null, done: finished, completedAt: finished ? (sess.endedAt || null) : null,
      phase: sess.state !== 'lobby' && joined ? 1 : 0, joined, late: !team && R.isLate(sess, participants[run.pid] || {}),
      decisions: decisions.map(d => (d ? E.normalise(d) : null)), band: e ? `e${e.group}` : null,
      knows: e ? e.knows.map(k => ({ label: k.label || k.id, level: k.level })) : [], reflections,
      ...(team ? {} : { reflection1: reflections[run.pid]?.reflection1 || '', reflection2: reflections[run.pid]?.reflection2 || '' }) };
  }
  // The class totals, as the round screen counts them (late students stay out).
  const counted = Object.values(runs).filter(r => r.joined && !r.late);
  const agg = E.aggregate(counted.map(r => ({ decisions: r.decisions.map(d => d || undefined) })), intensity, { mode: sess.mode });
  const kit = {
    bands: bands(intensity), order: ORDER, ended: done, intensity,
    rounds: C.ROUNDS.map(r => ({ n: r.n, title: r.title })),
    aggregate: { rounds: agg.rounds, groups: agg.groups, complete: agg.complete, reached: agg.reached, headline: agg.headline,
      disagreement: agg.disagreement, mostDivided: agg.mostDivided },
    reviewQuestions: REVIEW_QUESTIONS, lessonQuestions: LESSON_QUESTIONS,
    lessons: C.DEBRIEF.naming.map(n => ({ head: n.term, text: n.line })),
    teamPrompt: team ? C.DEBRIEF.teamPrompt : null
  };
  return { participants: people, runs, kit, clock: clk };
}

// The completion one student reports: revision 1 at the ending, revision 2 with their review.
function completion(sess, participants, pid, now, revision) {
  const me = participants[pid];
  if (!me || !ended(sess, now)) return null;
  const team = sess.mode === 'team', intensity = sess.intensity || 'standard';
  const run = team ? { groupId: me.groupId, members: (sess.teams || {})[me.groupId] || [] } : { pid, members: [pid] };
  if (team && !run.groupId) return null;
  const decisions = decisionsOf(sess, participants, run, 5);
  const e = E.ending(decisions, intensity), band = `e${e.group}`, b = bands(intensity)[band];
  const counts = { approve: 0, decline: 0, timeout: 0 };
  decisions.forEach(d => { counts[E.normalise(d)]++; });
  const summary = {
    // A private run (a direct launch) is not a class session, so Past sessions does not group it.
    ...(sess.solo ? {} : { sessionCode: sess.code, sessionName: sess.name || null, sessionCreatedAt: sess.createdAt || null }),
    band, year3Band: band, bandLabel: b.label, bandTone: b.cls, reviewQuestions: REVIEW_QUESTIONS,
    result: { overall: `${b.label}. Approved ${counts.approve}, declined ${counts.decline}${counts.timeout ? `, and ${counts.timeout} shipped when the clock ran out` : ''}.` },
    decisions: decisions.map(d => E.normalise(d)), intensity,
    ...(team ? { teamRunId: run.groupId, teamLabel: R.teamLabel(sess, participants, run.groupId),
      teamMembers: run.members.map(id => participants[id]?.name).filter(Boolean) } : {}),
    reflection1: me.review?.reflection1 || '', reflection2: me.review?.reflection2 || ''
  };
  const metrics = { revision, Ending: b.label, Approved: counts.approve, Declined: counts.decline, 'Shipped on timeout': counts.timeout,
    ...(me.review ? { reflection1: me.review.reflection1, reflection2: me.review.reflection2 } : {}) };
  return { runId: sess.solo ? sess.code : `${sess.code}:${team ? run.groupId : pid}`, summary, metrics };
}

module.exports = { LESSON_QUESTIONS, REVIEW_QUESTIONS, bands, ORDER, facultyKit, completion, ended };
