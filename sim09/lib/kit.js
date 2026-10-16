// Server only. What the shared faculty pages (platform/public/kit/) need from RapidSim 09: one run per student
// or team with its band (did the money follow the unit's own destination statement?), the debrief content (the
// stages, values and names), and the completion each student reports. Approved Oct 15, 2026. Students receive
// only the questions, after the 2010 stage.
const C = require('../config/content.js');
const E = require('./engine.js');
const R = require('./room.js');

// Shown after the 2010 stage, so they never point at the outcome before it.
const LESSON_QUESTIONS = [
  'Was your direction statement right? Was your destination statement right?',
  'Which company did you think would be paid, and who was paid instead?',
  'What would have told you in 2000 that buyers would keep the savings?',
  'Where did your money go: with your destination statement, or against it?'
];
// The second is the closing question from the instructor's debrief.
const REVIEW_QUESTIONS = [
  'Read your destination statement again. What would have had to be true for it to hold?',
  C.DEBRIEF.turn
];
const LESSONS = [
  { head: 'The direction test.', text: 'Was the forecast right about what would happen? Almost always, yes.' },
  { head: 'The destination test.', text: 'Was it right about who would be paid? That is the bet, and it is harder.' },
  { head: 'Adoption is not revenue.', text: 'Business purchasing did move online. The firms in the middle were not paid for it.' },
  { head: 'Cheap and universal loses its price.', text: 'When a capability becomes cheap and universal, the firm that planned to charge for it loses its price.' }
];
// Neutral tones: whether the money followed the unit's own statement, never a verdict on the outcome.
const BANDS = {
  followed: { label: 'Followed the statement', cls: 'b', phrase: 'The money went where the destination statement said' },
  against: { label: 'Against the statement', cls: 'v', phrase: 'Half or more went against the destination statement' },
  cash: { label: 'Held cash', cls: 'n', phrase: 'Half or more stayed in cash' },
  unplaced: { label: 'Unplaced', cls: 'y', phrase: 'Time ran out before the fund was placed' }
};
const ORDER = ['followed', 'against', 'cash', 'unplaced'];

// Allocation is over once the clock has passed it (or it was closed early).
function allocationOver(sess, now) {
  const ph = R.clock(sess, now).phase;
  if (['held', 'reveal'].includes(ph)) return true;
  return ph === 'closed' && (!!sess.allocationClosed || (sess.released || 0) > 0 || R.elapsedSeconds(sess, sess.closedAt || now) >= E.ALLOCATION_CLOSES);
}
function bandOf(rec) {
  if (!rec || !rec.allocation) return 'unplaced';
  if (E.contradiction(rec.statements, rec.allocation)) return 'against';
  if ((rec.allocation.cash || 0) / C.FUND.total >= 0.5) return 'cash';
  return 'followed';
}
const humans = participants => Object.values(participants || {}).filter(p => p && p.kind !== 'team');

function unitList(sess, participants) {
  if (sess.mode === 'team') {
    const groups = {};
    for (const p of humans(participants)) if (p.groupId) (groups[p.groupId] ||= []).push(p.id);
    const teams = sess.teams && Object.keys(sess.teams).length ? sess.teams : groups;
    return Object.entries(teams).map(([g, ids]) => ({ runId: g, members: ids, rec: participants[g] || null }));
  }
  return humans(participants).filter(p => p.joinedAt || p.source === 'course').map(p => ({ runId: `individual:${p.id}`, members: [p.id], rec: p }));
}

// The faculty session as the shared pages read it. Faculty only.
function facultyKit(sess, participants, now) {
  const team = sess.mode === 'team', over = allocationOver(sess, now), released = sess.released || 0;
  const people = {}, runs = {};
  for (const p of humans(participants)) {
    people[p.id] = { id: p.id, name: p.name, joinedAt: p.joinedAt || null,
      ...(team ? { groupId: p.groupId || null, teamLabel: p.groupId ? p.teamLabel || p.groupId.slice(5) : null, isCaptain: false } : {}) };
  }
  for (const u of unitList(sess, participants)) {
    const present = u.members.map(id => participants[id]).filter(p => p && p.joinedAt);
    const first = present[0] || participants[u.members[0]];
    const rec = u.rec || {};
    const finished = over && present.length > 0;
    const allocation = rec.allocation ? Object.fromEntries(E.BUCKETS.map(k => [k, rec.allocation[k] || 0])) : null;
    const reflections = {};
    for (const p of present) if (p.review) reflections[p.id] = { reflection1: p.review.reflection1, reflection2: p.review.reflection2 };
    runs[u.runId] = { runId: u.runId, teamLabel: team ? (first?.teamLabel || u.runId.slice(5)) : first?.name, runnerId: first ? first.id : null, completedBy: null,
      done: finished || (!!rec.allocation && present.length > 0), completedAt: rec.allocationAt || null,
      phase: sess.state !== 'lobby' && present.length ? 1 : 0, joined: present.length > 0,
      band: finished || rec.allocation ? bandOf(rec) : null,
      statements: rec.statements || null, statementsBy: rec.statementsBy || null, allocation, allocationBy: rec.allocationBy || null,
      values: allocation ? Object.fromEntries(E.YEARS.slice(0, released).map(y => [y, E.display(E.fundAt(rec.allocation, y).total)])) : {},
      finalValue: allocation ? E.display(E.fundAt(rec.allocation, E.YEARS[E.YEARS.length - 1]).total) : null,
      reflections, ...(team ? {} : { reflection1: reflections[first?.id]?.reflection1 || '', reflection2: reflections[first?.id]?.reflection2 || '' }) };
  }
  const kit = {
    bands: BANDS, order: ORDER, ended: over, released, stagesTotal: C.REVEAL.stages.length,
    nextYear: released < C.REVEAL.stages.length ? C.REVEAL.stages[released].year : null,
    companies: E.KEYS.map(k => ({ key: k, descriptor: E.COMPANY[k].descriptor, category: E.COMPANY[k].category, name: C.REVEAL.names[k] })),
    cashLabel: C.FUND.cashLabel,
    picks: C.WALL.destination.options.map(o => ({ key: o.key, text: o.text })),
    // The history and the names, for the debrief. Faculty only, from the server.
    stages: C.REVEAL.stages.map(s => ({ year: s.year, heading: s.heading, direction: s.direction, destination: s.destination,
      values: Object.fromEntries(E.KEYS.map(k => [k, E.display(E.fundAt({ [k]: C.FUND.total }, s.year).total)])) })),
    namesHeading: C.REVEAL.namesHeading, closingAsk: C.REVEAL.closing,
    reviewQuestions: REVIEW_QUESTIONS, lessonQuestions: LESSON_QUESTIONS, lessons: LESSONS
  };
  return { participants: people, runs, kit, clock: R.clock(sess, now) };
}

// The completion one student reports: revision 1 at the 2010 stage (or close), revision 2 with their review.
function completion(sess, participants, pid, now, revision) {
  const me = participants[pid];
  if (!me || !me.joinedAt || me.kind === 'team') return null;
  // Reported once the 2010 stage is out, or when the session closes after the fund.
  if (!allocationOver(sess, now) || ((sess.released || 0) < C.REVEAL.stages.length && sess.state !== 'closed')) return null;
  const team = sess.mode === 'team';
  if (team && !me.groupId) return null;
  const rec = team ? participants[me.groupId] || {} : me;
  const band = bandOf(rec), b = BANDS[band];
  const last = E.YEARS[E.YEARS.length - 1];
  const value = rec.allocation ? E.display(E.fundAt(rec.allocation, last).total) : null;
  const pick = rec.statements ? (C.WALL.destination.options.find(o => o.key === rec.statements.pick) || {}).text : null;
  const summary = {
    // A private run is not a class session, so Past sessions does not group it.
    ...(sess.solo ? {} : { sessionCode: sess.code, sessionName: sess.name || null, sessionCreatedAt: sess.createdAt || null }),
    band, year3Band: band, bandLabel: b.label, bandTone: b.cls, reviewQuestions: REVIEW_QUESTIONS,
    result: { overall: `${b.label}. ${pick ? 'Destination: ' + pick + '.' : 'No destination statement.'} ${value ? 'Fund worth ' + value + ' by ' + last + '.' : 'Fund left unplaced.'}` },
    destination: rec.statements ? rec.statements.pick : null, statements: rec.statements || null, allocation: rec.allocation || null,
    ...(team ? { teamRunId: me.groupId, teamLabel: me.teamLabel || '', teamMembers: ((sess.teams || {})[me.groupId] || []).map(id => participants[id]?.name).filter(Boolean) } : {}),
    reflection1: me.review?.reflection1 || '', reflection2: me.review?.reflection2 || ''
  };
  const metrics = { revision, Band: b.label, Destination: pick || '', [`Fund in ${last}`]: value || 'Unplaced',
    ...(me.review ? { reflection1: me.review.reflection1, reflection2: me.review.reflection2 } : {}) };
  return { runId: sess.solo ? sess.code : `${sess.code}:${team ? me.groupId : pid}`, summary, metrics };
}

module.exports = { LESSON_QUESTIONS, REVIEW_QUESTIONS, LESSONS, BANDS, ORDER, facultyKit, completion, allocationOver, bandOf };
