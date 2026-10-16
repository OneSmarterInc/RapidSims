'use strict';
// Server only. What the shared faculty pages (platform/public/kit/) need from RapidSim 10: one run per student
// or team with its band (the calls it made), the debrief content (the reveal, the notes and the minority case),
// and the completion each student reports. Approved Oct 15, 2026. Students receive only the questions, after
// the last company's outcome.
const config = require('../data/config');
const copy = require('../data/copy');
const content = require('./content');
const E = require('./engine');

const LESSON_QUESTIONS = [
  'Which line did you cite, and what did it tell you that the headline figures did not?',
  "Where did the company's own measure and the standard figure differ?",
  'What would the next quarter have had to show for you to switch?',
  'What did the later quarters show that your two quarters did not?'
];
// The second is the closing question from the instructor notes.
const REVIEW_QUESTIONS = [
  "Read your 'what would change my mind' answer again. Did the later quarters show it?",
  copy.notes.A.beforeReveal.turn
];
const LESSONS = [
  { head: 'Company measures are chosen by the company.', text: 'Cash revenue and adjusted profit add back what the company decides. Read them beside the standard figures.' },
  { head: 'Cash paid in advance is not revenue earned.', text: 'It is owed back as service, and it becomes revenue only as the service is provided.' },
  { head: 'Growth bought is not growth earned.', text: 'Acquisitions make reported revenue jump. Like-for-like growth shows what the business itself is doing.' },
  { head: 'The same lines can mislead in both directions.', text: 'A company that looks worse on almost every line can survive. Ask what would have to be true for each call.' }
];
// Neutral tones: the calls made, never a verdict on them.
const BANDS = {
  infra: { label: 'Infrastructure', cls: 'b', phrase: 'Called it infrastructure that will be needed' },
  bubble: { label: 'Bubble', cls: 'v', phrase: 'Called it inside a bubble' },
  mixed: { label: 'Mixed', cls: 'y', phrase: 'Called the two companies differently' },
  none: { label: 'No call', cls: 'n', phrase: 'No call was recorded' }
};
const ORDER = ['infra', 'bubble', 'mixed', 'none'];
const CALL = { infra: 'Infrastructure', bubble: 'Bubble' };
const STAGE = ['Show the company', 'Show the next four quarters', 'Show what happened'];

const caseLabel = (s, cs) => `Company ${s.cases.indexOf(cs) + 1}`;
const closedCase = (s, cs, now) => E.phaseOf(s, cs, now).name === 'closed';
// Every case played to its end, or a started session that was closed.
const ended = (s, now) => s.cases.every(cs => closedCase(s, cs, now)) || (s.state === 'closed' && !!s.runs.A.startedAt);
const finished = (s, now) => {
  const last = s.cases[s.cases.length - 1];
  return (closedCase(s, last, now) && s.runs[last].reveal >= 3) || (s.state === 'closed' && !!s.runs.A.startedAt);
};

function bandOf(calls) {
  const made = calls.filter(Boolean);
  if (!calls.length) return null;
  if (!made.length) return 'none';
  return made.every(c => c === made[0]) ? made[0] : 'mixed';
}

async function participants(store, s) {
  const pids = await store.smembers(E.K.pids(s.code));
  const recs = (await store.mget(pids.map(p => E.K.part(s.code, p)))).filter(Boolean);
  return Object.fromEntries(recs.map(r => [r.pid, r]));
}

// The class's units: one per joined student, or one per team.
function units(s, people) {
  const list = Object.values(people);
  if (s.mode === 'team') {
    const ids = Array.isArray(s.teamIds) && s.runs.A.startedAt ? s.teamIds : [...new Set(list.map(p => p.groupId).filter(Boolean))];
    return ids.map(id => ({ runId: id, team: id, members: list.filter(p => (s.teamIds && s.runs.A.startedAt ? p.team : p.groupId) === id) }));
  }
  return list.filter(p => p.joinedAt).map(p => ({ runId: `individual:${p.pid}`, team: null, members: [p] }));
}

// One unit's answer for one case: the student's own, or the team's committed call.
async function answers(store, s, unit) {
  const out = {};
  for (const cs of s.cases) {
    const rec = s.mode === 'team'
      ? await store.get(E.K.commit(s.code, cs, unit.team))
      : await store.get(E.K.resp(s.code, cs, unit.members[0].pid));
    out[cs] = { rec, privates: [] };
    if (s.mode === 'team') {
      for (const m of unit.members) {
        const r = await store.get(E.K.resp(s.code, cs, m.pid));
        if (r && r.private) out[cs].privates.push({ name: m.name, call: r.private });
      }
    }
  }
  return out;
}

function callView(s, cs, rec, now) {
  const e = E.evaluate(rec);
  if (e.status !== 'recorded') return { status: e.status, closed: closedCase(s, cs, now) };
  return { status: 'recorded', closed: closedCase(s, cs, now), call: e.call, line: e.line, lineLabel: e.line ? E.pickerLabel(cs, e.line) : null,
    lineWhy: e.lineWhy, mind: e.mind, blanks: e.blanks, held: E.guard(s, cs, `${e.lineWhy} ${e.mind}`) };
}

// The session bar's next step for the case in play.
function nextStep(s, now) {
  if (s.state !== 'running') return null;
  const cs = E.activeCase(s), ph = E.phaseOf(s, cs, now).name, team = s.mode === 'team';
  if (ph === 'read') return { set: 'advance', label: team ? 'Open the private calls now' : 'Open the calls now', addTime: true };
  if (ph === 'verdict') return { set: 'advance', label: 'Close the calls now' };
  if (ph === 'private') return { set: 'advance', label: 'Open the team call now' };
  if (ph === 'team') return { set: 'advance', label: 'Close the team calls now' };
  if (ph === 'closed' && s.runs[cs].reveal < 3) return { set: 'reveal', label: STAGE[s.runs[cs].reveal] };
  if (ph === 'closed' && cs === 'A' && s.cases.includes('B')) return { set: 'start_b', label: 'Start company 2' };
  return null;
}

// The faculty session as the shared pages read it. Faculty only.
async function facultyKit(store, s, now) {
  const people = await participants(store, s);
  const team = s.mode === 'team', over = ended(s, now), done = finished(s, now);
  const roster = {}, runs = {};
  for (const p of Object.values(people)) {
    roster[p.pid] = { id: p.pid, name: p.name || 'Student', joinedAt: p.joinedAt || null,
      ...(team ? { groupId: p.groupId || null, teamLabel: p.groupId ? p.teamLabel || p.groupId.slice(5) : null, isCaptain: false } : {}) };
  }
  for (const u of units(s, people)) {
    const present = u.members.filter(p => p.joinedAt);
    const first = present[0] || u.members[0];
    const a = await answers(store, s, u);
    const calls = {}, privates = {};
    for (const cs of s.cases) { calls[cs] = callView(s, cs, a[cs].rec, now); privates[cs] = a[cs].privates; }
    const closedCalls = s.cases.filter(cs => calls[cs].closed || s.state === 'closed').map(cs => calls[cs].call || null);
    const reflections = {};
    for (const p of present) if (p.review) reflections[p.pid] = { reflection1: p.review.reflection1, reflection2: p.review.reflection2 };
    runs[u.runId] = { runId: u.runId, teamLabel: team ? (first && first.teamLabel) || String(u.team).slice(5) : first && first.name,
      runnerId: first ? first.pid : null, completedBy: null,
      done: over && present.length > 0, completedAt: over ? (s.closedAt || null) : null,
      phase: s.runs.A.startedAt && present.length ? 1 : 0, joined: present.length > 0,
      band: closedCalls.length && present.length ? bandOf(closedCalls) : null,
      calls, privates, reflections,
      ...(team ? {} : { reflection1: (reflections[first && first.pid] || {}).reflection1 || '', reflection2: (reflections[first && first.pid] || {}).reflection2 || '' }) };
  }
  const cs = E.activeCase(s), ph = E.phaseOf(s, cs, now);
  const kit = {
    bands: BANDS, order: ORDER, ended: over, finished: done, mode: s.mode, cases: s.cases.map(c => ({ id: c, label: caseLabel(s, c) })),
    activeCase: cs, phase: ph.name, next: nextStep(s, now), callNames: CALL,
    // The reveal, the notes and the minority case for the debrief. Faculty only, from the server.
    byCase: Object.fromEntries(s.cases.map(c => {
      const stage = s.runs[c].reveal, nb = copy.notes[c].beforeReveal;
      return [c, { id: c, label: caseLabel(s, c), phase: E.phaseOf(s, c, now).name, started: !!s.runs[c].startedAt, stage,
        reveal: stage >= 1 ? content.buildReveal(c, stage, null) : null,
        disagreement: nb.disagreement, turn: nb.turn, minorityCase: nb.minorityCase,
        naming: nb.naming.map(([term, tag]) => ({ term, line: E.pickerLabel(c, tag) })),
        afterNotes: stage >= 1 ? copy.notes[c].afterReveal : null }];
    })),
    reviewQuestions: REVIEW_QUESTIONS, lessonQuestions: LESSON_QUESTIONS, lessons: LESSONS
  };
  return { people, participants: roster, runs, kit, clock: { phase: s.state === 'lobby' ? 'lobby' : ph.name, endsAt: ph.endsAt || null, caseId: cs } };
}

// The completion one student reports: revision 1 at the last outcome (or close), revision 2 with their review.
async function completion(store, s, people, pid, now, revision) {
  const me = people[pid];
  if (!me || !me.joinedAt || !finished(s, now)) return null;
  const team = s.mode === 'team';
  if (team && me.team == null) return null;
  const companies = [];
  for (const cs of s.cases) {
    const rec = team ? await store.get(E.K.commit(s.code, cs, me.team)) : await store.get(E.K.resp(s.code, cs, pid));
    const e = E.evaluate(rec);
    companies.push({ company: caseLabel(s, cs), status: e.status,
      ...(e.status === 'recorded' ? { call: CALL[e.call], line: e.line ? E.pickerLabel(cs, e.line) : null, why: e.lineWhy.slice(0, 400), wouldHaveSwitchedIf: e.mind.slice(0, 800) } : {}) });
  }
  const band = bandOf(companies.map(c => (c.call ? (c.call === 'Bubble' ? 'bubble' : 'infra') : null))) || 'none', b = BANDS[band];
  const overall = `${b.label}. ${companies.map(c => `${c.company}: ${c.call ? c.call + (c.line ? ` (cited ${c.line})` : '') : 'no call'}.`).join(' ')}`;
  const summary = {
    // A private run is not a class session, so Past sessions does not group it.
    ...(s.solo ? {} : { sessionCode: s.code, sessionName: s.name || null, sessionCreatedAt: s.createdAt || null }),
    band, year3Band: band, bandLabel: b.label, bandTone: b.cls, reviewQuestions: REVIEW_QUESTIONS,
    result: { overall }, mode: s.mode, companies,
    ...(team ? { teamRunId: me.team, teamLabel: me.teamLabel || '', teamMembers: Object.values(people).filter(p => p.team === me.team).map(p => p.name) } : {}),
    reflection1: (me.review && me.review.reflection1) || '', reflection2: (me.review && me.review.reflection2) || ''
  };
  const metrics = { revision, Band: b.label, ...Object.fromEntries(companies.map(c => [c.company, c.call || 'No call'])),
    ...(me.review ? { reflection1: me.review.reflection1, reflection2: me.review.reflection2 } : {}) };
  return { runId: s.solo ? s.code : `${s.code}:${team ? me.team : pid}`, summary, metrics };
}

module.exports = { LESSON_QUESTIONS, REVIEW_QUESTIONS, LESSONS, BANDS, ORDER, STAGE, facultyKit, completion, participants, nextStep, ended, finished, bandOf, caseLabel };
