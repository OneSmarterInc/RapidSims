// Server only. What the shared faculty pages (platform/public/kit/) need from RapidSim 07: one run per student
// or team with its decision band, the debrief content (the stages and the names), and the completion each
// student reports. Approved Oct 15, 2026. Students receive only the questions, after the third stage.
const { REVEAL, PRE_REVEAL } = require('../data/config.js');
const E = require('./engine.js');

// Shown after the 2010 stage, so they never point at the outcome before it.
const LESSON_QUESTIONS = [
  'What on the briefing sheet carried the most weight for you?',
  'Which adviser did you find most convincing, and why?',
  'Did anything in 2002 make your decision look wrong? Should it have?',
  'What would you have needed to know in 2000 to decide differently?'
];
// The second is the closing question from the instructor's debrief.
const REVIEW_QUESTIONS = [
  'What did you weigh most, and would you weigh it the same way now?',
  'Name a decision you made on incomplete information. What would have to be true for it to look foolish later?'
];
const LESSONS = [
  { head: 'Hindsight rewrites the judgement.', text: 'Once you know the ending, one choice looks obvious. In 2000 everyone read the same sheet you did.' },
  { head: 'Judge the decision, not the outcome.', text: 'A good decision uses what was knowable at the time and reasons from it. The outcome came ten years later.' },
  { head: 'Right about the market, wrong about the company.', text: 'The internet hype was overblown. The seller survived it anyway.' },
  { head: 'A cheap option is still an option.', text: 'Fifty million was about 1% of revenue. A small, capped loss bought the right to learn.' }
];
// Neutral tones: the colour names the choice, never a verdict on it.
const BANDS = {
  bought: { label: 'Bought', cls: 'b', phrase: 'Bought the company for $50 million' },
  declined: { label: 'Declined', cls: 'v', phrase: 'Declined the offer' },
  lapsed: { label: 'Lapsed', cls: 'n', phrase: 'The clock ran out, which counts as declining' }
};
const ORDER = ['bought', 'declined', 'lapsed'];
const bandOfPos = pos => (!pos ? null : pos.choice === 'buy' ? 'bought' : pos.lapsed ? 'lapsed' : 'declined');
const joined = participants => Object.values(participants || {}).filter(p => p && p.joinedAt);
const ended = (sess, t) => ['decided', 'closed'].includes(E.phaseOf(sess, t)) && !!sess.startedAt;

// Team runs: the majority decides; a tie declines. Lapsed only when every member lapsed.
function teamBand(sess, members, t) {
  const pos = members.map(p => E.positionOf(p, sess, t));
  if (!pos.length || pos.some(x => !x)) return null;
  const buy = pos.filter(x => x.choice === 'buy').length;
  if (buy > pos.length - buy) return 'bought';
  return pos.every(x => x.lapsed) ? 'lapsed' : 'declined';
}

function runsOf(sess, participants) {
  if (sess.mode === 'team') {
    const groups = {};
    for (const p of Object.values(participants || {})) if (p && p.groupId) (groups[p.groupId] ||= []).push(p);
    return Object.entries(groups).map(([groupId, members]) => ({ runId: groupId, members, label: members[0].teamLabel || groupId.slice(5) }));
  }
  return Object.values(participants || {}).filter(p => p && (p.joinedAt || p.source === 'course'))
    .map(p => ({ runId: `individual:${p.id}`, members: [p], label: p.name }));
}

// The faculty session as the shared pages read it. Faculty only.
function facultyKit(sess, participants, lastBeat, t) {
  const team = sess.mode === 'team', done = ended(sess, t);
  const people = {}, runs = {};
  for (const p of Object.values(participants || {}).filter(Boolean)) {
    people[p.id] = { id: p.id, name: p.name, joinedAt: p.joinedAt || null,
      ...(team ? { groupId: p.groupId || null, teamLabel: p.groupId ? p.teamLabel || '' : null, isCaptain: false } : {}) };
  }
  for (const run of runsOf(sess, participants)) {
    const present = run.members.filter(p => p.joinedAt);
    const band = team ? teamBand(sess, present, t) : bandOfPos(E.positionOf(run.members[0], sess, t));
    const reflections = {}, reasons = [];
    for (const p of present) {
      if (p.review) reflections[p.id] = { reflection1: p.review.reflection1, reflection2: p.review.reflection2 };
      const pos = E.positionOf(p, sess, t);
      reasons.push({ id: p.id, name: p.name, choice: pos ? pos.choice : null, lapsed: pos ? pos.lapsed : false, text: pos ? pos.text : '', recognised: p.recognised || null });
    }
    const first = present[0] || run.members[0];
    runs[run.runId] = { runId: run.runId, teamLabel: run.label, runnerId: first ? first.id : null, completedBy: null,
      done: !!band && present.length > 0, completedAt: band ? Math.max(0, ...present.map(p => p.decidedAt || 0)) || null : null,
      phase: sess.startedAt && present.length ? 1 : 0, joined: present.length > 0, band,
      votes: team ? { buy: reasons.filter(r => r.choice === 'buy').length, decline: reasons.filter(r => r.choice === 'decline').length } : null,
      reasons, reflections,
      ...(team ? {} : { reflection1: reflections[first?.id]?.reflection1 || '', reflection2: reflections[first?.id]?.reflection2 || '',
        choice: reasons[0]?.choice || null, lapsed: !!reasons[0]?.lapsed, justification: reasons[0]?.text || '', recognised: reasons[0]?.recognised || null }) };
  }
  const stage = E.effectiveStage(sess, sess.practice ? 0 : lastBeat, t);
  const kit = {
    bands: BANDS, order: ORDER, ended: done, stage,
    stages: REVEAL.stages.map(s => ({ n: s.n, year: s.year, title: s.title, body: s.body, names: s.names || null })),
    recognitionOptions: PRE_REVEAL.decision.recognitionOptions,
    reviewQuestions: REVIEW_QUESTIONS, lessonQuestions: LESSON_QUESTIONS, lessons: LESSONS
  };
  return { participants: people, runs, kit };
}

// The completion one student reports: revision 1 at the 2010 stage (or close), revision 2 with their review.
function completion(sess, participants, pid, t, revision) {
  const me = participants[pid];
  if (!me || !me.joinedAt) return null;
  const pos = E.positionOf(me, sess, t);
  if (!pos) return null;
  const team = sess.mode === 'team';
  const members = team ? joined(participants).filter(p => p.groupId && p.groupId === me.groupId) : [me];
  const band = team ? teamBand(sess, members, t) : bandOfPos(pos);
  if (!band) return null;
  const b = BANDS[band], mine = bandOfPos(pos);
  const summary = {
    // A private run is not a class session, so Past sessions does not group it.
    ...(sess.solo ? {} : { sessionCode: sess.code, sessionName: sess.name || null, sessionCreatedAt: sess.createdAt || null }),
    band, year3Band: band, bandLabel: b.label, bandTone: b.cls, reviewQuestions: REVIEW_QUESTIONS,
    result: { overall: team ? `${me.teamLabel || 'The team'}: ${b.label}. Your vote: ${BANDS[mine].label}.` : `${b.label}.` },
    choice: pos.choice, lapsed: pos.lapsed, justification: pos.text, recognised: me.recognised || null,
    ...(team ? { teamRunId: me.groupId, teamLabel: me.teamLabel || '', teamMembers: members.map(p => p.name) } : {}),
    reflection1: me.review?.reflection1 || '', reflection2: me.review?.reflection2 || ''
  };
  const metrics = { revision, Decision: b.label, ...(team ? { 'Your vote': BANDS[mine].label } : {}), Recognised: me.recognised || '',
    ...(me.review ? { reflection1: me.review.reflection1, reflection2: me.review.reflection2 } : {}) };
  return { runId: sess.solo ? sess.code : `${sess.code}:${team ? me.groupId : pid}`, summary, metrics };
}

module.exports = { LESSON_QUESTIONS, REVIEW_QUESTIONS, LESSONS, BANDS, ORDER, facultyKit, completion, ended, bandOfPos };
