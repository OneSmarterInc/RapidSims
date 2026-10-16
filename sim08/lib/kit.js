// Server only. What the shared faculty pages (platform/public/kit/) need from RapidSim 08: one run per student
// or team with its eighteen-month outcome band, the debrief content (the answer key included), and the
// completion each student reports. Approved Oct 15, 2026. Students receive only the questions, after the report.
const C = require('../config/content.js');
const E = require('./engine.js');
const R = require('./room.js');

// Shown under the eighteen-month report, so they never point at the warning questions before play.
const LESSON_QUESTIONS = [
  'Which question told you the most, and why did you spend it when you did?',
  'Which vendor answer sounded reassuring and turned out to matter?',
  'Who at Brookfield had to work differently, and did your plan help them?',
  'What did the three-year quote leave out?'
];
// The second is the closing question from the instructor's debrief.
const REVIEW_QUESTIONS = [
  'Which question would you spend again, and which would you trade?',
  C.DEBRIEF.turn
];
const LESSONS = [
  { head: 'The quote is the first item, not the total.', text: 'Total cost of ownership includes the cover, the training and the slow weeks.' },
  { head: 'Shadow systems grow beside the real one.', text: 'The paper sheet, the whiteboard and the spreadsheet are signs that the system missed something.' },
  { head: 'Configurable means somebody has to configure it.', text: 'A rule nobody owns is a rule nobody writes.' },
  { head: 'Change has a cost, and someone pays it.', text: 'Ask who has to work differently, and who covers the slow weeks.' }
];
// The outcome eighteen months on: green to red.
const BANDS = {
  adopted: { label: C.DEBRIEF.tierLabels.adopted, cls: 'g', phrase: 'The practice runs on the new system' },
  lucky: { label: C.DEBRIEF.tierLabels.lucky, cls: 'y', phrase: 'The fix was funded, aimed at the wrong thing' },
  knew: { label: C.DEBRIEF.tierLabels.knew, cls: 'o', phrase: 'The committee knew and did not act' },
  shadow: { label: C.DEBRIEF.tierLabels.shadow, cls: 'l', phrase: 'A shadow system runs the practice' }
};
const ORDER = ['adopted', 'lucky', 'knew', 'shadow'];
const ended = (sess, now) => R.clock(sess, now).phase === 'report';
const joined = participants => Object.values(participants || {}).filter(p => p && p.joinedAt);

function runList(sess, participants) {
  if (sess.mode === 'team') {
    const groups = {};
    for (const p of Object.values(participants || {})) if (p && p.groupId) (groups[p.groupId] ||= []).push(p.id);
    // Once the session starts, the frozen teams decide who is on which team.
    const teams = sess.teams && Object.keys(sess.teams).length ? sess.teams : groups;
    return Object.entries(teams).map(([groupId, ids]) => ({ runId: groupId, groupId, members: ids }));
  }
  return joined(participants).map(p => ({ runId: p.groupId || `individual:${p.id}`, groupId: p.groupId || `individual:${p.id}`, members: [p.id] }));
}

// The faculty session as the shared pages read it. Faculty only.
function facultyKit(sess, participants, runsStore, now) {
  const clk = R.clock(sess, now), done = ended(sess, now), team = sess.mode === 'team';
  const people = {}, runs = {};
  for (const p of Object.values(participants || {}).filter(Boolean)) {
    people[p.id] = { id: p.id, name: p.name, joinedAt: p.joinedAt || null,
      ...(team ? { groupId: p.groupId || null, teamLabel: p.groupId ? p.teamLabel || p.groupId.slice(5) : null, isCaptain: false } : {}) };
  }
  for (const run of runList(sess, participants)) {
    const present = run.members.map(id => participants[id]).filter(p => p && p.joinedAt);
    const label = team ? (participants[run.members[0]]?.teamLabel || run.groupId.slice(5)) : participants[run.members[0]]?.name;
    const phase = clk.phase;
    const f = phase === 'lobby' ? { questionIds: [] } : R.runFacts(sess, participants, runsStore, run.groupId, done ? 'report' : phase);
    const finished = done && present.length > 0;
    const routes = f.vendor ? E.routesFor(f.vendor, f.questionIds) : { direct: [], partial: [] };
    const reflections = {};
    for (const p of present) if (p.review) reflections[p.id] = { reflection1: p.review.reflection1, reflection2: p.review.reflection2 };
    const first = present[0] || participants[run.members[0]];
    runs[run.runId] = { runId: run.runId, teamLabel: label, runnerId: first ? first.id : null, completedBy: null,
      done: finished, completedAt: finished ? (sess.reportAt || null) : null,
      phase: sess.state !== 'lobby' && present.length ? 1 : 0, joined: present.length > 0, late: !team && R.isLate(sess, first || {}),
      band: finished ? f.report.tier : null,
      vendor: f.vendor || null, vendorName: f.vendor ? R.vendorName(f.vendor) : '', boardChose: !!f.boardChose,
      questionIds: f.questionIds || [], plan: done ? f.plan || null : null,
      found: routes.direct.length >= 1 || routes.partial.length >= 2,
      headline: finished ? f.report.headline : '', reportText: finished ? f.report.text : '',
      votes: team ? present.map(p => ({ name: p.name, vendor: p.vendorVote || null, plan: p.planVote || null })) : null,
      reflections, ...(team ? {} : { reflection1: reflections[first?.id]?.reflection1 || '', reflection2: reflections[first?.id]?.reflection2 || '' }) };
  }
  const kit = {
    bands: BANDS, order: ORDER, ended: done, phase: clk.phase,
    vendors: C.VENDORS.map(v => ({ key: v.key, name: v.name, threeYear: v.threeYear, risk: C.DEBRIEF.riskLabels[v.key] })),
    // The answer key. Faculty only, from the server.
    questions: C.QUESTIONS.map(q => ({ id: q.id, text: q.text, routes: q.routes })),
    plans: C.PLANS.map(p => ({ key: p.key, text: p.text, matches: p.matches })),
    disagreement: C.DEBRIEF.disagreement, disagreementNone: C.DEBRIEF.disagreementNone,
    closingAsk: C.DEBRIEF.naming[C.DEBRIEF.naming.length - 1],
    reviewQuestions: REVIEW_QUESTIONS, lessonQuestions: LESSON_QUESTIONS, lessons: LESSONS
  };
  return { participants: people, runs, kit, clock: clk };
}

// The completion one student reports: revision 1 at the report (or close), revision 2 with their review.
function completion(sess, participants, runsStore, pid, now, revision) {
  const me = participants[pid];
  if (!me || !me.joinedAt || !ended(sess, now) || !R.isMember(sess, me)) return null;
  const team = sess.mode === 'team';
  const f = R.runFacts(sess, participants, runsStore, me.groupId, 'report');
  const band = f.report.tier, b = BANDS[band];
  const plan = C.PLANS.find(p => p.key === f.plan);
  const summary = {
    // A private run is not a class session, so Past sessions does not group it.
    ...(sess.solo ? {} : { sessionCode: sess.code, sessionName: sess.name || null, sessionCreatedAt: sess.createdAt || null }),
    band, year3Band: band, bandLabel: b.label, bandTone: b.cls, reviewQuestions: REVIEW_QUESTIONS,
    result: { overall: `${b.label}. Bought ${R.vendorName(f.vendor)}${f.boardChose ? ' (the board chose on price)' : ''} after ${f.questionIds.length} of ${C.QUESTION_BUDGET} questions. ${plan ? 'Go-live plan: ' + plan.text : 'No go-live plan was funded.'}` },
    vendor: f.vendor, boardChose: !!f.boardChose, questions: f.questionIds, plan: f.plan || null,
    ...(team ? { teamRunId: me.groupId, teamLabel: me.teamLabel || '', teamMembers: R.members(sess, me.groupId).map(id => participants[id]?.name).filter(Boolean) } : {}),
    reflection1: me.review?.reflection1 || '', reflection2: me.review?.reflection2 || ''
  };
  const metrics = { revision, Outcome: b.label, Vendor: R.vendorName(f.vendor), Questions: f.questionIds.length, Plan: plan ? plan.key : 'none',
    ...(me.review ? { reflection1: me.review.reflection1, reflection2: me.review.reflection2 } : {}) };
  return { runId: sess.solo ? sess.code : `${sess.code}:${team ? me.groupId : pid}`, summary, metrics };
}

module.exports = { LESSON_QUESTIONS, REVIEW_QUESTIONS, LESSONS, BANDS, ORDER, facultyKit, completion, ended };
