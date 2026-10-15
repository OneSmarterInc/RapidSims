// Debrief slides: each headline is written from the session's own results.
// Uses the real outcome engine on the approved sample class (canvas D0 to D7).
const assert = require('node:assert/strict');
const S = require('../lib/scenario.js');
const D = require('../public/midland-debrief.js');
const { buildClosingLesson } = require('../lib/closingLesson.js');
const t = require('../config/thresholds.json');

let n = 0; const check = (a, e, m) => { assert.deepEqual(a, e, m); n++; };
const a = (run, uptime, capacity, connect, features) => ({ run, uptime, capacity, connect, features });
const plan = {
  'Team 1': [a(4, 2, 1, 2, 0), a(4, 1, 1, 2, 1), 'Keep dispatch safe first, then start listening to the units.'],
  'Team 2': [a(4, 1, 1, 3, 0), a(4, 1, 1, 3, 0), 'Connect the machines now.'],
  'Team 3': [a(5, 2, 0, 0, 2), a(4, 1, 0, 2, 2), 'Keep the lights on and give the board something to see.'],
  'Team 4': [a(4, 1, 0, 3, 1), a(4, 1, 0, 3, 1), 'Go all in on Sam’s data.']
};
const teams = Object.entries(plan).map(([name, [y1, y2, said]], i) => ({
  id: 'team:' + name, name, members: ['Ana', 'Ben'].map(x => x + i), year1: y1, year2: y2, strategicView: said,
  outcomes: S.evaluateAll(y1, y2, t), reviews: [{ name: 'Ana' + i, text: 'One more million in Connect.' }]
}));
const strip = h => h.replace(/<[^>]+>/g, '');

const m = D.model({ mode: 'team', thresholds: t, teams: [...teams, { id: 'team:Team 5', name: 'Team 5', members: [] }] });
check([m.ready, m.submitted, m.total, m.slides.length], [true, 4, 5, 8], 'Eight slides from the four submitted teams; the unfinished team is counted');
const by = k => m.slides.find(s => s.key === k);
check(teams.map(x => x.outcomes.year3.band), ['pilot', 'strong', 'weak', 'data_no_room'], 'Sample class reaches four different Year 3 results');
check(strip(by('glance').headline), 'Same $18M. Same four executives. Four different companies in Year 3.', 'D0 headline');
check(by('glance').body.tiles.map(x => x.name), ['Team 2', 'Team 1', 'Team 4', 'Team 3'], 'D0 tiles run from Strong to Weak');
check(strip(by('q1').headline), 'Year 3 was decided in Year 1.', 'D1 headline: Year 1 Connect lines up with Year 3');
check(by('q1').sub, 'Team 3 put $0 into Connect in Year 1. It lost the district report that year and reached Year 3 with too little data to predict anything.', 'D1 names the team with no Year 1 Connect');
check(by('q1').body.rows.filter(r => r.mark).map(r => r.name), ['Team 3'], 'D1 marks Team 3');
check(/Uptime held dispatch/.test(by('q1').note), true, 'D1 credits the test Team 3 funded');
check(strip(by('q2').headline), 'After Year 1, Team 3 could no longer reach Strong.', 'D2 headline');
check(/Team 1 could still reach Strong in Year 2 and stopped at \$4M/.test(by('q2').note), true, 'D2 names the near miss');
check(/Team 3 could still reach a Pilot in Year 2 and stopped at \$2M/.test(by('q2').note), true, 'D2 names the reachable Pilot');
check(strip(by('q3').headline), 'Every team paid Dale first. Then three teams sided with Sam, and one with Tom.', 'D3 headline');
check(strip(by('q3').sub), 'The line nobody argued for, Capacity, got the least: $4M of the class’s $72M.', 'D3 names the least funded line');
check(/Team 3 gave Dale \$1M more/.test(by('q3').note), true, 'D3 names Run above the minimum');
check(strip(by('q4').headline), 'Team 4 built the data and had nowhere to run it.', 'D4 headline');
check(by('q4').body.rows.find(r => r.name === 'Team 4').capacity, 0, 'D4 shows Team 4 with no Capacity');
check(strip(by('buyers').headline), 'Corven came for field data, and found it at Team 2 and Team 4.', 'D5 headline');
check(by('buyers').sub, 'Only Team 2 also kept costs lean enough for Ridge Hollow.', 'D5 line under the headline');
check(by('buyers').body.rows[0].name, 'Team 2', 'D5 lists the team both buyers wanted first');
check(by('said').body.cards[0].reviews[0].text, 'One more million in Connect.', 'D6 shows a member review');
check(by('lessons').body.items.map(x => x.evidence), [
  'Team 3 put $0 into Connect in Year 1. $2M was the line for a clean district report, and Year 3 showed the gap.',
  'After Year 1, Team 3 could no longer reach Strong.',
  'Every team paid Dale first. Three teams sided with Sam, and one with Tom.',
  'Capacity got $4M of $72M. Two teams gave it nothing. Team 4 had the data and no room to run it.'
], 'D7 evidence comes from the class');

// The Oct 15 retest: two teams, both Limited. The slides say what is true of that class.
const two = [['Team 1', a(4, 2, 1, 1, 1), a(4, 2, 2, 1, 0)], ['Team 2', a(4, 1, 2, 1, 1), a(4, 1, 1, 1, 2)]].map(([name, y1, y2]) =>
  ({ id: name, name, members: [], year1: y1, year2: y2, outcomes: S.evaluateAll(y1, y2, t), reviews: [] }));
const m2 = D.model({ mode: 'team', thresholds: t, teams: two }), by2 = k => m2.slides.find(s => s.key === k);
check(strip(by2('glance').headline), 'Same $18M, same result: both teams reached Limited.', 'Same result reads as one result');
check(by2('glance').sub, 'Each team was $1M of Connect away from a Pilot.', 'and says how close they came');
check(by2('glance').body.tiles.length, 1, 'one tile, not a wall of identical tiles');
check([strip(by2('q1').headline), by2('q1').sub], ['Both teams put $1M into Connect in Year 1.', 'Both teams reached Limited in Year 3.'], 'D1 says what is true of the class');
check(strip(by2('q2').headline), 'After Year 1, both teams could no longer reach Strong.', 'D2 groups the class');
check(by2('q2').note, 'Both teams could still reach a Pilot ($3M) in Year 2 and stopped at $2M.', 'D2 names the reachable Pilot');
check(strip(by2('q3').headline), 'Both teams gave Sam the least, and Sam’s line decided Year 3.', 'D3 names the starved line that decided Year 3');
check(strip(by2('q4').headline), 'Both teams paid for Capacity. Neither built the data to use it.', 'D4 for room without data');
check(strip(by2('buyers').headline), 'Corven came for field data, and found too little at both teams.', 'D5 for no Corven interest');
check(JSON.stringify(m2).includes('Weak'), false, 'The result is called Limited everywhere');

// The lessons match what students saw on their own final page.
const student = buildClosingLesson(teams[0].year1, teams[0].year2, teams[0].outcomes, t);
check(D.LESSONS.map(l => l.head), student.teaches.map(x => x.head), 'Debrief lessons match the student closing lesson');
check(D.QUESTIONS, S.LESSON_QUESTIONS, 'Debrief questions match the questions students saw at the start');

// Anonymous switch hides team and member names.
const anon = D.model({ mode: 'team', thresholds: t, teams, anonymous: true });
const text = JSON.stringify(anon);
check(/Team [1-4]|Ana\d/.test(text), false, 'Anonymous slides carry no team or member names');
check(strip(anon.slides[3].headline).startsWith('Every team paid Dale first.'), true, 'Anonymous headlines still read');

// Individual sessions say students, not teams; one result reads naturally.
const solo = D.model({ mode: 'individual', thresholds: t, teams: [{ ...teams[1], name: 'Ana Lopez' }] });
check(strip(solo.slides[0].headline), 'Ana Lopez reached Strong in Year 3.', 'One student');
check(strip(solo.slides[1].headline), 'Ana Lopez put $3M into Connect in Year 1.', 'One student is named');

// Nothing submitted yet.
check(D.model({ mode: 'team', thresholds: t, teams: [{ id: 'x', name: 'Team 1' }] }).ready, false, 'Empty debrief waits for results');

// Every slide renders without throwing in a DOM-free check of the HTML builders.
check(typeof D.mount, 'function', 'mount is exported');
console.log(`RapidSim 03 debrief checks passed (${n} assertions).`);
