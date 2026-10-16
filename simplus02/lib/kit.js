'use strict';
// Server only. What the shared faculty pages (platform/public/kit/) need from Who Pays for the Wire?: one run per
// team with its band (which groups of terms the team signed), the debrief content (the reveal, the debrief
// prompts and the lessons), and the completion each student reports. Approved Oct 16, 2026.
const C = require('../data/config');
const T = require('../engine/table');
const R = require('./room');
const { playForward } = require('../engine/playforward');
const { staffNotices, seatBriefs, walkthrough } = require('../data/content');
const reveal = require('../data/reveal');

const MIN = 60000;
// The ten-minute notice is offered only when it is true (#69).
const noticeOpen = (id, sess, now) => id !== 'tenminutes' || (sess.phaseEndsAt && sess.phaseEndsAt - now <= 12 * MIN);
// Shown after the deadline, so they never steer the negotiation.
const LESSON_QUESTIONS = [
  'Which risk did your party accept, and why?',
  'Which term made another seat’s agreement possible?',
  'What did the deadline change for your team?',
  'What would change if the Commission could approve a package without every party signing?'
];
// The second is the closing question.
const REVIEW_QUESTIONS = [
  'Which term did you give the most on, and what did you get for it?',
  LESSON_QUESTIONS[3]
];
const LESSONS = [
  { head: 'Contract terms decide who carries the risk.', text: 'Take-or-pay, term, exit fee and collateral move the cost of missing demand between data centres, shareholders and customers.' },
  { head: 'A deal needs something for every seat.', text: 'A term one party cannot accept can be traded for one it can.' },
  { head: 'A known fallback changes the bargaining.', text: 'Terms left open went to the Commission, and each one extended the connection freeze.' },
  { head: 'A regulator can approve a package without every signature.', text: 'In Ohio, the Commission chose between two settlements. The data-centre parties had backed the other one.' }
];
// Neutral tones: which groups a team signed, never a verdict on the terms.
const BANDS = {
  both: { label: 'Both settled', cls: 'b', phrase: 'The team signed every term' },
  money: { label: 'Money settled', cls: 'v', phrase: 'The team signed the money terms; the Commission set the threshold' },
  threshold: { label: 'Threshold settled', cls: 'y', phrase: 'The team signed the threshold; the Commission set the money terms' },
  commission: { label: 'Commission set both', cls: 'n', phrase: 'The Commission set every term' }
};
const ORDER = ['both', 'money', 'threshold', 'commission'];
const SEAT_NAMES = Object.fromEntries(Object.entries(seatBriefs).map(([k, b]) => [k, b.seat]));
// The debrief prompts from the instructor's specification.
const DEBRIEF_NOTES = [
  'Start with two contrasting team outcomes. Ask which risks the parties accepted, which terms made another seat’s agreement possible, and what the deadline changed.',
  'The model shows how the terms move risk between the seats. Its numbers are fictional.',
  'Use the non-unanimous settlement: the Commission adopted a package the data-centre parties did not sign. Ask what changes when the regulator can approve a package without every party signing.',
  'Keep the demand figures distinct: about 30,000 MW of interest, 13,022.7 MW of paid study requests and 5,642 MW of new binding contracts, additional to 12,219 MW contracted earlier. These were projects scheduled to come online through 2035.',
  'Minimum billing demand determines demand charges; The 85% applies to demand charges only. A four-year ramp plus eight years gives a twelve-year contract.'
];

function bandOf(result) {
  if (!result) return null;
  const s = result.settled || [];
  return s.length === 2 ? 'both' : s.includes('money') ? 'money' : s.includes('threshold') ? 'threshold' : 'commission';
}
const humans = roster => Object.entries(roster || {}).map(([id, p]) => ({ id, ...p }));
const walkthroughOf = (sess, roster) => {
  const joined = humans(roster).filter(p => p.joinedAt && p.groupId);
  return { finished: joined.filter(p => R.walkthroughComplete(sess, p)).length, pending: joined.filter(p => !R.walkthroughComplete(sess, p)).map(p => p.name) };
};

// The session bar's next step.
function nextStep(sess) {
  if (sess.state !== 'running') return null;
  if (sess.phase === 'briefing') return { set: 'openings', label: 'Start opening statements' };
  if (sess.phase === 'openings') return { set: 'negotiation', label: 'Open negotiation' };
  if (sess.phase === 'negotiation') return { set: 'close_sheet', label: 'Close the sheet now', addTime: !sess.extended };
  return null;
}

// The faculty session as the shared pages read it. Faculty only.
function facultyKit(sess, roster, tables, now) {
  const people = humans(roster), participants = {}, runs = {};
  for (const p of people) participants[p.id] = { id: p.id, name: p.name, joinedAt: p.joinedAt || null, groupId: p.groupId || null,
    teamLabel: p.groupId ? p.teamLabel || p.groupId.slice(5) : null, isCaptain: false };
  const groups = [...new Set(people.map(p => p.groupId).filter(Boolean))];
  for (const g of groups) {
    const members = people.filter(p => p.groupId === g), present = members.filter(p => p.joinedAt);
    const tableId = (sess.tableOf || {})[g], t = tableId ? tables[tableId] : null, result = t && t.result;
    const last = t && t.log.length ? t.log.at(-1).t : (sess.negotiationStartedAt || now);
    const reflections = {};
    for (const p of present) if (p.review) reflections[p.id] = { reflection1: p.review.reflection1, reflection2: p.review.reflection2 };
    runs[g] = { runId: g, teamLabel: members[0].teamLabel || g.slice(5), runnerId: present[0] ? present[0].id : null, completedBy: null,
      done: !!result, completedAt: result ? (sess.closedAt || null) : null, joined: present.length > 0,
      phase: tableId && present.length ? 1 : 0, band: bandOf(result), tableId: tableId || null,
      seats: members.map(p => ({ name: p.name, seat: p.seat || null, joined: !!p.joinedAt })),
      sheet: t ? { dials: t.dials, locked: t.locked, moves: t.log.filter(e => e.action === 'move').length, notices: t.notices.length,
        minutesSinceActivity: Math.floor((now - last) / MIN), stalled: sess.phase === 'negotiation' && now - last >= C.timing.staleMinutes * MIN } : null,
      result: result || null, playForward: result ? playForward(result) : null, reflections };
  }
  const kit = {
    bands: BANDS, order: ORDER, phase: sess.phase, ended: sess.phase === 'closed', extended: !!sess.extended, next: nextStep(sess),
    seatNames: SEAT_NAMES, dials: C.dials, groups: C.settlementGroups, staffNotices: staffNotices.filter(n => noticeOpen(n.id, sess, now)).map(({ id, label, text }) => ({ id, label, text })),
    walkthrough: walkthroughOf(sess, roster), walkthroughScreens: walkthrough.length,
    // The real proceeding and the debrief prompts. Faculty only, from the server.
    reveal: { heading: reveal.heading, projector: reveal.projectorParagraphs, paragraphs: reveal.paragraphs, sources: reveal.sources, note: reveal.facilitatorNote },
    debriefNotes: DEBRIEF_NOTES, reviewQuestions: REVIEW_QUESTIONS, lessonQuestions: LESSON_QUESTIONS, lessons: LESSONS
  };
  return { participants, runs, kit, clock: { phase: sess.state === 'lobby' ? 'lobby' : sess.phase, endsAt: sess.phaseEndsAt || null } };
}

// The completion one student reports: revision 1 at the deadline (or close), revision 2 with their review.
function completion(sess, roster, pid, table, revision) {
  const me = roster[pid];
  if (!me || !me.joinedAt || !table || !table.result || !me.groupId) return null;
  const r = table.result, band = bandOf(r), b = BANDS[band];
  const summary = {
    ...(sess.practice ? {} : { sessionCode: sess.code, sessionName: sess.name || null, sessionCreatedAt: sess.createdAt || null }),
    band, year3Band: band, bandLabel: b.label, bandTone: b.cls, reviewQuestions: REVIEW_QUESTIONS,
    result: { overall: `${b.label}. ${SEAT_NAMES[me.seat] || 'No seat'} in ${me.teamLabel || table.label || table.id}. The Commission set ${r.imposed.length} term${r.imposed.length === 1 ? '' : 's'}${r.freezeMonths ? `; the freeze runs ${r.freezeMonths} more months` : ''}.` },
    table: table.label || table.id, seat: me.seat, seatName: SEAT_NAMES[me.seat] || null, settledGroups: r.settled, imposedTerms: r.imposed, terms: r.terms, freezeMonths: r.freezeMonths,
    teamRunId: me.groupId, teamLabel: me.teamLabel || '', teamMembers: humans(roster).filter(p => p.groupId === me.groupId).map(p => p.name),
    reflection1: (me.review && me.review.reflection1) || '', reflection2: (me.review && me.review.reflection2) || ''
  };
  const metrics = { revision, Band: b.label, Seat: SEAT_NAMES[me.seat] || '', 'Terms set by the Commission': r.imposed.length, 'Freeze months': r.freezeMonths,
    ...(me.review ? { reflection1: me.review.reflection1, reflection2: me.review.reflection2 } : {}) };
  return { runId: `${sess.code}:${me.groupId}`, summary, metrics };
}

// Seat each faculty-made team at its own table: four seats, extras as co-counsel (approved #2).
function seatTeams(sess, roster) {
  const people = humans(roster).filter(p => p.groupId);
  const groups = [...new Set(people.map(p => p.groupId))].sort((a, b) => String((roster[people.find(p => p.groupId === a).id] || {}).teamLabel || a).localeCompare(String((roster[people.find(p => p.groupId === b).id] || {}).teamLabel || b), undefined, { numeric: true }));
  const next = { ...roster }, tables = {}, tableIds = [], tableOf = {};
  groups.forEach((g, n) => {
    const id = 'T' + (n + 1), members = people.filter(p => p.groupId === g).map(p => p.id).sort();
    const order = members.map(x => ({ x, h: require('crypto').createHash('sha256').update(sess.seed + x).digest('hex') })).sort((a, b) => a.h.localeCompare(b.h)).map(o => o.x);
    tables[id] = { ...T.createTable(id, `${sess.seed}:${id}`), notices: [], label: roster[order[0]].teamLabel || g.slice(5), groupId: g };
    order.forEach((pid, i) => { next[pid] = { ...next[pid], table: id, seat: T.SEATS[i % T.SEATS.length] }; });
    tableIds.push(id); tableOf[g] = id;
  });
  return { roster: next, tables, tableIds, tableOf };
}

module.exports = { noticeOpen, LESSON_QUESTIONS, REVIEW_QUESTIONS, LESSONS, BANDS, ORDER, SEAT_NAMES, bandOf, nextStep, facultyKit, completion, seatTeams, walkthroughOf };
