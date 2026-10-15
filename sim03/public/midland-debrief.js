/* Midland class debrief: one slide per lesson question, each headline written from the session's own numbers. */
(function (global) {
'use strict';

const LESSONS = [
  { head: 'Technology spending takes time to pay off.', text: 'What you fund this year decides what the company can do two or three years from now.' },
  { head: 'Some capabilities take years to build.', text: 'Each line takes only so much a year. Money that arrives late buys less of it.' },
  { head: 'Each executive is right about one part of the company.', text: 'The technology leader’s job is to fund the whole company.' },
  { head: 'Fund the line nobody asks for.', text: 'Four executives argued for their own lines. Nobody argued for Capacity, the computing room to use the data. Only you speak for it, and in Year 3 it decided whether the data could become a service.' }
];
const QUESTIONS = [
  'What does a dollar you spend this year buy two years from now?',
  'Which capabilities take more than a year to build?',
  'Every executive is right about their own part of the company. How do you fund the whole company?',
  'Which part of the company had no one asking for money?'
];
const LINES = ['run', 'uptime', 'capacity', 'connect', 'features'];
const EXEC = { run: 'Dale', uptime: 'Renata', capacity: 'Nobody', connect: 'Sam', features: 'Tom' };
const LINE_LABEL = { run: 'Run', uptime: 'Uptime', capacity: 'Capacity', connect: 'Connect', features: 'Features' };
// One name and one colour per result, on every slide and on the Results tab.
const BAND = {
  strong: { label: 'Strong', cls: 'g', phrase: 'Sells failure prediction to customers' },
  middle: { label: 'Middle', cls: 'y' },
  pilot: { label: 'Pilot', cls: 'y', phrase: 'A pilot on the newest units' },
  data_no_room: { label: 'Data without room', cls: 'o', phrase: 'Field data with nowhere to run it' },
  weak: { label: 'Limited', cls: 'l', phrase: 'Too little field history to predict' }
};
const SHOW_ORDER = { strong: 0, pilot: 1, data_no_room: 2, weak: 3 };
const DATA_RANK = { strong: 3, data_no_room: 2, pilot: 1, weak: 0 };
const INTEREST = { high: { label: 'High', cls: 'g' }, qualified: { label: 'Some', cls: 'y' }, low: { label: 'Low', cls: 'l' } };
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const word = n => WORDS[n] || String(n);
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const money = n => num(n) === 0 ? '$0' : `$${num(n)}M`;
function sumLines(a, b) { const o = {}; for (const k of LINES) o[k] = num(a && a[k]) + num(b && b[k]); return o; }

// input: { mode, thresholds, anonymous, teams:[{ id, name, members, year1, year2, outcomes, strategicView, reviews:[{ name, text }] }] }
function model(input) {
  const t = input.thresholds || {};
  const budget = num(t.budgetPerYear) || 9, cap = num(t.perLineCap) || 3, floor = num(t.runFloor) || 4;
  const strongLine = num(t.year3ConnectStrong) || 5, pilotLine = num(t.year3ConnectPilotMin) || 3, capStrong = num(t.year3CapacityStrong) || 2;
  const y1Strong = num(t.year1ConnectStrong) || 2;
  const team = input.mode !== 'individual';
  const unit = team ? 'team' : 'student', units = team ? 'teams' : 'students';
  const plural = n => n === 1 ? unit : units;
  const all = input.teams || [];
  const done = all.filter(x => x.year1 && x.year2 && x.outcomes && x.outcomes.year3 && x.outcomes.year3.band);
  const rows = done.map(x => {
    const c = sumLines(x.year1, x.year2), o = x.outcomes;
    return {
      realName: x.name, members: x.members || [], strategicView: x.strategicView || '', reviews: x.reviews || [],
      y1: x.year1, y2: x.year2, c,
      bands: { y1: o.year1 && o.year1.band, heat: o.year2 && o.year2.heat && o.year2.heat.band,
        comp: o.year2 && o.year2.competitor && o.year2.competitor.band, y3: o.year3.band },
      ridge: (o.buyers && o.buyers.ridge_hollow && o.buyers.ridge_hollow.interest) || null,
      corven: (o.buyers && o.buyers.corven && o.buyers.corven.interest) || null
    };
  }).sort((a, b) => String(a.realName).localeCompare(String(b.realName), undefined, { numeric: true }));
  rows.forEach((r, i) => { r.key = `card-${i}`; r.name = input.anonymous ? `${team ? 'Team' : 'Student'} ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}` : r.realName; });
  const out = { ready: rows.length > 0, submitted: rows.length, total: all.length, unit, units, slides: [], lessons: LESSONS };
  if (!rows.length) return out;
  const n = rows.length, pair = 2 * budget;
  // "Both teams" / "Every team" when a sentence is about the whole class; names otherwise.
  const group = list => list.length === n && n === 2 ? `Both ${units}` : list.length === n && n > 2 ? `Every ${unit}` : (list.length <= 1 ? list.map(x => x.name).join('') : list.slice(0, -1).map(x => x.name).join(', ') + ' and ' + list[list.length - 1].name);
  const isAll = list => list.length === n && n > 1;
  const groupMid = list => group(list).replace(/^Both /, 'both ').replace(/^Every /, 'every ');
  const they = list => list.length === 1 && !isAll(list) ? 'It' : 'They';
  const label = b => BAND[b] ? BAND[b].label : b;

  // How close a team came to the next result: the one line that decided it.
  const next = r => {
    const c = r.c, b = r.bands.y3;
    const mk = (line, have, need, target) => ({ line, have, need, gap: Math.max(1, need - have), target, text: `${money(Math.max(1, need - have))} more ${LINE_LABEL[line]} → ${target}` });
    if (b === 'strong') return { line: 'connect', have: c.connect, need: c.connect, text: 'Top result reached', top: true };
    if (b === 'data_no_room') return mk('capacity', c.capacity, capStrong, 'Strong');
    if (b === 'pilot') return mk('connect', c.connect, strongLine, c.capacity >= capStrong ? 'Strong' : 'data without room');
    return mk('connect', c.connect, pilotLine, 'Pilot');
  };

  // D0 · the class at a glance
  const bandsSeen = [...new Set(rows.map(r => r.bands.y3))];
  const byShow = rows.slice().sort((a, b) => SHOW_ORDER[a.bands.y3] - SHOW_ORDER[b.bands.y3] || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const same = n > 1 && bandsSeen.length === 1;
  const gaps = rows.map(next);
  const sameGap = same && new Set(gaps.map(g => g.text)).size === 1 && !gaps[0].top;
  const glanceHead = n === 1 ? `${esc(rows[0].name)} reached <em class="${BAND[rows[0].bands.y3].cls}">${esc(label(rows[0].bands.y3))}</em> in Year 3.`
    : same ? `Same ${money(pair)}, same result: ${group(rows).toLowerCase()} reached <em class="${BAND[bandsSeen[0]].cls}">${esc(label(bandsSeen[0]))}</em>.`
    : `Same ${money(pair)}. Same four executives. <em>${cap1(word(bandsSeen.length))} different companies</em> in Year 3.`;
  const closeCount = gaps.filter(g => !g.top && g.gap === 1).length;
  out.slides.push({ key: 'glance', kicker: 'The class at a glance', headline: glanceHead,
    sub: sameGap ? `Each ${unit} was ${money(gaps[0].gap)} of ${LINE_LABEL[gaps[0].line]} away from ${gaps[0].target === 'Pilot' ? 'a Pilot' : gaps[0].target}.` : '',
    ask: same ? 'Every team made the same call on Connect. Why did it look less urgent than the rest?' : 'You all had the same money and the same facts. What made the difference?',
    note: same ? 'The bars show the line that decided the result.' : closeCount ? `Bars show the line that decided each result. ${cap1(word(closeCount))} ${plural(closeCount)} ${closeCount === 1 ? 'was' : 'were'} $1M from the next result.` : 'Bars show the line that decided each result.',
    body: { kind: 'glance', same, max: 2 * cap,
      tiles: same ? [{ name: group(rows), members: [], band: bandsSeen[0], phrase: BAND[bandsSeen[0]].phrase }]
        : byShow.map(r => ({ name: r.name, members: input.anonymous || !team ? [] : r.members, band: r.bands.y3, phrase: BAND[r.bands.y3].phrase })),
      close: byShow.map(r => ({ name: r.name, band: r.bands.y3, ...next(r) })) } });

  // D1 · a dollar this year
  const y1c = r => num(r.y1.connect);
  const ordered = rows.slice().sort((a, b) => y1c(b) - y1c(a) || DATA_RANK[b.bands.y3] - DATA_RANK[a.bands.y3]);
  const lines = rows.every(a => rows.every(b => !(y1c(a) > y1c(b)) || DATA_RANK[a.bands.y3] >= DATA_RANK[b.bands.y3]));
  const varied = new Set(rows.map(y1c)).size > 1;
  const low = Math.min(...rows.map(y1c)), lowRows = rows.filter(r => y1c(r) === low);
  const lowWeak = lowRows.every(r => r.bands.y3 === 'weak');
  let q1Head, q1Sub, q1Ask, q1Note = '', q1Evidence;
  if (!varied) {
    q1Head = `${group(rows)} put ${money(low)} into Connect in Year 1.`;
    q1Sub = same ? `${group(rows)} reached ${esc(label(bandsSeen[0]))} in Year 3.` : 'Same start. The differences in Year 3 came from Year 2 and from Capacity.';
    q1Ask = 'What did your team fund first in Year 1, and why?';
  } else {
    q1Head = lines ? 'Year 3 was decided in <em class="connect">Year 1</em>.' : 'Year 1 set the starting line for <em>Year 3</em>.';
    q1Sub = low === 0
      ? `${esc(group(lowRows))} put $0 into Connect in Year 1. ${they(lowRows)} lost the district report that year${lowWeak ? ' and reached Year 3 with too little data to predict anything' : ''}.`
      : `${esc(group(lowRows))} put the least into Connect in Year 1: ${money(low)}. ${they(lowRows)} reached ${esc(label(lowRows[0].bands.y3))} in Year 3.`;
    q1Ask = low < y1Strong ? `${esc(group(lowRows))}, what looked more urgent than Connect in Year 1? Would you choose it again?` : 'What did your team fund first in Year 1, and why?';
    if (lowRows.length === 1 && lowRows[0].bands.heat === 'strong' && lowWeak) q1Note = `${esc(lowRows[0].name)} did well on the test it funded: its Uptime held dispatch through the heat wave. The tests that needed Connect went the other way.`;
  }
  q1Evidence = low < y1Strong
    ? `${esc(group(lowRows))} put ${money(low)} into Connect in Year 1. ${money(y1Strong)} was the line for a clean district report, and Year 3 showed the gap.`
    : lines ? 'Year 1 Connect lined up with every Year 3 result.' : `${esc(group(lowRows))} started with the least Connect and reached ${esc(label(lowRows[0].bands.y3))}.`;
  out.slides.push({ key: 'q1', kicker: `Question 1 of 4 · ${QUESTIONS[0]}`, headline: q1Head, sub: q1Sub, ask: q1Ask, lesson: 0, note: q1Note, evidence: q1Evidence,
    body: { kind: 'matrix', rows: ordered.map(r => ({ name: r.name, connect: y1c(r), cap, mark: varied && y1c(r) === low && lowWeak,
      cells: [r.bands.y1, r.bands.heat, r.bands.comp, r.bands.y3] })) } });

  // D2 · what takes years
  const race = rows.map(r => ({ r, a: y1c(r), b: num(r.y2.connect), total: r.c.connect, reach: y1c(r) + cap }));
  const outOfReach = race.filter(x => x.reach < strongLine).map(x => x.r);
  const nearMiss = race.filter(x => x.reach >= strongLine && x.total < strongLine);
  const pilotMiss = race.filter(x => x.reach >= pilotLine && x.total < pilotLine);
  let q2Head, q2Evidence;
  if (outOfReach.length) { q2Head = `After Year 1, ${esc(groupMid(outOfReach))} could no longer reach <em class="l">Strong</em>.`; q2Evidence = `After Year 1, ${esc(groupMid(outOfReach))} could no longer reach Strong.`; }
  else if (nearMiss.length) { q2Head = `Every ${unit} could still reach Strong after Year 1. <em class="y">${esc(group(nearMiss.map(x => x.r)))} stopped short.</em>`; q2Evidence = `${esc(group(nearMiss.map(x => x.r)))} could still reach Strong and stopped short.`; }
  else { q2Head = `Every ${unit} built enough Connect for <em class="g">Strong</em> by Year 3.`; q2Evidence = `Every ${unit} reached ${money(strongLine)} of Connect.`; }
  const pilotNote = pilotMiss.length && isAll(pilotMiss.map(x => x.r)) && new Set(pilotMiss.map(x => x.total)).size === 1
    ? `${group(rows)} could still reach a Pilot (${money(pilotLine)}) in Year 2 and stopped at ${money(pilotMiss[0].total)}.`
    : pilotMiss.map(x => `${esc(x.r.name)} could still reach a Pilot in Year 2 and stopped at ${money(x.total)}.`).join(' ');
  const q2Note = [...nearMiss.map(x => `${esc(x.r.name)} could still reach Strong in Year 2 and stopped at ${money(x.total)}.`), pilotNote].filter(Boolean).join(' ');
  out.slides.push({ key: 'q2', kicker: `Question 2 of 4 · ${QUESTIONS[1]}`, headline: q2Head, lesson: 1, note: q2Note, evidence: q2Evidence,
    sub: `Each line takes at most ${money(cap)} a year. Strong needed ${money(strongLine)} of Connect by Year 3, so the race started in Year 1.`,
    ask: 'What in a real company takes years to build and can’t be bought in a hurry?',
    body: { kind: 'race', max: 2 * cap, pilotLine, strongLine,
      rows: race.slice().sort((x, y) => y.total - x.total).map(x => ({ name: x.r.name, a: x.a, b: x.b, total: x.total, reach: x.reach,
        tone: x.total >= strongLine ? 'g' : x.reach < strongLine ? 'l' : 'y',
        tag: x.total >= strongLine ? money(x.total) : x.reach < strongLine ? `${money(x.total)} · ${money(x.reach)} was the most left` : `${money(x.total)} · ${money(strongLine - x.total)} short of Strong` })) } });

  // D3 · whose argument won
  const four = ['connect', 'uptime', 'features', 'capacity'];
  const sided = rows.map(r => {
    const top = Math.max(...four.map(k => r.c[k])), winners = four.filter(k => r.c[k] === top);
    return { r, line: winners.length === 1 ? winners[0] : null };
  });
  const counts = {};
  sided.forEach(s => { const k = s.line || 'split'; counts[k] = (counts[k] || 0) + 1; });
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const sideWord = (k, html) => {
    if (k === 'split') return 'split the rest evenly';
    if (k === 'capacity') return `backed ${html ? '<em class="capacity">Capacity</em>' : 'Capacity'}, the line no one argued for`;
    return `sided with ${html ? `<em class="${k}">${EXEC[k]}</em>` : EXEC[k]}`;
  };
  const sidePhrase = html => {
    if (ranked.length === 1 && n > 1) return `every ${unit} ${sideWord(ranked[0][0], html)}`;
    return ranked.map(([k, c], i) => i === 0 ? `${word(c)} ${plural(c)} ${sideWord(k, html)}`
      : `${word(c)} ${k === 'capacity' || k === 'split' ? sideWord(k, html) : sideWord(k, html).replace('sided ', '')}`)
      .reduce((acc, p, i, arr) => i === 0 ? p : acc + (i === arr.length - 1 ? ', and ' : ', ') + p, '');
  };
  const totals = Object.fromEntries(four.map(k => [k, rows.reduce((s, r) => s + r.c[k], 0)]));
  const least = four.slice().sort((a, b) => totals[a] - totals[b])[0];
  const grand = rows.reduce((s, r) => s + LINES.reduce((x, k) => x + r.c[k], 0), 0);
  const connectStarved = rows.some(r => r.bands.y3 !== 'strong') && least === 'connect';
  const q3Head = connectStarved
    ? `${group(rows)} gave <em class="connect">Sam</em> the least, and Sam’s line decided Year 3.`
    : `Every ${unit} paid Dale first. Then ${sidePhrase(true)}.`;
  const q3Sub = least === 'capacity'
    ? `The line nobody argued for, Capacity, got the least: <b class="capacity">${money(totals.capacity)} of the class’s ${money(grand)}</b>.`
    : `${EXEC[least]}’s ${LINE_LABEL[least]} got the least: <b class="${least}">${money(totals[least])} of the class’s ${money(grand)}</b>.`;
  const aboveFloor = rows.filter(r => r.c.run > 2 * floor);
  const q3Note = `Two years, ${money(pair)} per ${unit}. Run needed ${money(2 * floor)} before anyone argued. ` +
    (aboveFloor.length ? aboveFloor.map(r => `${esc(r.name)} gave Dale ${money(r.c.run - 2 * floor)} more than he needed.`).join(' ') : `${n === 2 ? `Both ${units}` : n > 2 ? `Every ${unit}` : esc(rows[0].name)} held Run at the minimum.`);
  const q3Evidence = connectStarved ? `${group(rows)} gave Connect the least, and Connect decided Year 3.` : `Every ${unit} paid Dale first. ${cap1(sidePhrase(false))}.`;
  out.slides.push({ key: 'q3', kicker: `Question 3 of 4 · ${QUESTIONS[2]}`, headline: q3Head, sub: q3Sub, lesson: 2, note: q3Note, evidence: q3Evidence,
    ask: 'Whose argument was hardest to say no to? Which part of the company had no one asking for money?',
    body: { kind: 'stack', total: pair, rows: sided.map(s => ({ name: s.r.name, c: s.r.c, line: s.line,
      side: s.line ? (s.line === 'capacity' ? 'Backed Capacity' : `Sided with ${EXEC[s.line]}`) : 'Split evenly' })) } });

  // D4 · fund the line nobody asks for
  const dnr = rows.filter(r => r.bands.y3 === 'data_no_room'), strongRows = rows.filter(r => r.bands.y3 === 'strong');
  const roomNoData = rows.filter(r => r.c.capacity >= capStrong && r.c.connect < strongLine);
  const zero = rows.filter(r => r.c.capacity === 0).length;
  const q4Head = dnr.length ? `${esc(group(dnr))} built the data and had <em class="o">nowhere to run it</em>.`
    : strongRows.length ? `${esc(group(strongRows))} built the data and <em class="g">the room to run it</em>.`
    : roomNoData.length ? (roomNoData.length === 1 && !isAll(roomNoData) ? `${esc(roomNoData[0].name)} paid for Capacity, but not for <em class="connect">the data to use it</em>.`
      : `${esc(group(roomNoData))} paid for Capacity. ${n === 2 ? 'Neither' : 'None'} built <em class="connect">the data to use it</em>.`)
    : `No ${unit} built the data or the room for Year 3.`;
  const q4Evidence = `Capacity got ${money(totals.capacity)} of ${money(grand)}.${zero ? ` ${cap1(word(zero))} ${plural(zero)} gave it nothing.` : ''}${dnr.length ? ` ${esc(group(dnr))} had the data and no room to run it.` : roomNoData.length ? ` ${esc(group(roomNoData))} paid for it; Connect was the missing piece.` : ''}`;
  out.slides.push({ key: 'q4', kicker: `Question 4 of 4 · ${QUESTIONS[3]}`, headline: q4Head, lesson: 3, evidence: q4Evidence,
    sub: `Year 3 Strong needed both: ${money(strongLine)} of Connect for the data, and ${money(capStrong)} of Capacity to run it.`,
    ask: 'In your own company, who speaks for the computing room? Who should?',
    body: { kind: 'two', max: 2 * cap, strongLine, capStrong,
      rows: rows.slice().sort((a, b) => DATA_RANK[b.bands.y3] - DATA_RANK[a.bands.y3] || a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map(r => ({ name: r.name, connect: r.c.connect, capacity: r.c.capacity, band: r.bands.y3, mark: r.bands.y3 === 'data_no_room' })) } });

  // D5 · buyers
  const corvenHigh = rows.filter(r => r.corven === 'high'), ridgeHigh = rows.filter(r => r.ridge === 'high');
  const q5Head = corvenHigh.length ? `Corven came for field data, and found it at <em class="connect">${esc(group(corvenHigh))}</em>.`
    : `Corven came for field data, and found too little at <em class="l">${n === 2 ? `both ${units}` : n > 2 ? `every ${unit}` : esc(rows[0].name)}</em>.`;
  const ridgeBoth = ridgeHigh.filter(r => r.corven === 'high');
  const q5Sub = ridgeBoth.length && corvenHigh.length ? `${ridgeBoth.length === 1 ? 'Only ' : ''}${esc(group(ridgeBoth))} also kept costs lean enough for Ridge Hollow.`
    : ridgeHigh.length ? `Ridge Hollow liked the lean costs at ${esc(group(ridgeHigh))}.`
    : 'Ridge Hollow found every cost base heavier than it wanted.';
  const featureCost = rows.filter(r => r.c.features >= 3 && r.ridge === 'low');
  const score = v => ({ high: 2, qualified: 1, low: 0 }[v] || 0);
  out.slides.push({ key: 'buyers', kicker: 'Year 3 · Buyers look at Midland', headline: q5Head, sub: q5Sub,
    note: 'Carrolton, the competitor, bids the same for every team: it wants the customers.' +
      featureCost.map(r => ` ${esc(r.name)}’s ${money(r.c.features)} of Features counted as cost to Ridge Hollow and bought nothing for Corven.`).join(''),
    ask: 'Who were you building the company for? Did your team choose that, or did it just happen?',
    body: { kind: 'buyers', rows: rows.slice().sort((a, b) => score(b.ridge) + score(b.corven) - score(a.ridge) - score(a.corven) || a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map(r => ({ name: r.name, ridge: r.ridge, ridgeSpend: r.c.run + r.c.features, corven: r.corven, connect: r.c.connect })) } });

  // D6 · what teams said, what they funded
  out.slides.push({ key: 'said', kicker: `What ${units} said, and what they funded`, headline: 'Every plan made sense in Year 1. <em>Year 3 graded them.</em>',
    ask: 'Read your Year 1 sentence again. Did your budget do what you said?',
    body: { kind: 'said', total: pair, cards: byShow.map(r => ({ id: r.key, name: r.name, said: r.strategicView, band: r.bands.y3, result: BAND[r.bands.y3].phrase, c: r.c,
      reviews: r.reviews.filter(x => x && x.text).map(x => ({ name: input.anonymous ? 'A member' : x.name, text: x.text })) })) } });

  // D7 · lessons with this class's evidence
  out.slides.push({ key: 'lessons', kicker: 'The four lessons · as students see them at the end', headline: 'What Midland teaches, <em>shown by this class</em>.',
    body: { kind: 'lessons', items: LESSONS.map((l, i) => ({ head: l.head, text: i === 1 ? `Each line takes at most ${money(cap)} a year. Money that arrives late buys less of it.` : i === 3 ? 'Nobody argued for Capacity, the computing room to use the data. Only you speak for it.' : l.text,
      evidence: [q1Evidence, q2Evidence, q3Evidence, q4Evidence][i], tone: ['ev-connect', 'ev-l', 'ev-features', 'ev-capacity'][i] })),
      closing: 'Your budget decided what Midland was ready for when the future arrived.' } });
  return out;
}

// ---- Rendering ----
const chip = b => b ? `<span class="md-chip md-${BAND[b] ? BAND[b].cls : 'n'}">${esc(BAND[b] ? BAND[b].label : b)}</span>` : '<span class="md-chip md-n">—</span>';
const pct = (v, max) => `${Math.max(0, Math.min(100, (num(v) / max) * 100))}%`;

function bodyHTML(s, ui) {
  const b = s.body;
  if (b.kind === 'glance') {
    const tiles = `<div class="md-tiles${b.same ? ' md-tiles-one' : ''}">${b.tiles.map(x => `<div class="md-tile"><span class="md-band md-b${BAND[x.band].cls}"></span><div class="md-tin"><b class="md-tname">${esc(x.name)}</b>${x.members.length ? `<span class="md-tmem">${esc(x.members.join(', '))}</span>` : ''}<span class="md-tband md-t${BAND[x.band].cls}">${esc(BAND[x.band].label)}</span><span class="md-tphrase">${esc(x.phrase)}</span></div></div>`).join('')}</div>`;
    const close = `<div class="md-close"><div class="md-close-head"><b>How close ${b.same ? 'each ' + ui.unit + ' came' : 'each ' + ui.unit + ' came to the next result'}</b><span>White line = what the next result needed</span></div>
      ${b.close.map(r => `<div class="md-crow"><b class="md-rname">${esc(r.name)}</b><div class="md-ctrack"><span class="md-cfill ${r.top ? 'strong' : r.line}" style="width:${r.top ? '100%' : pct(r.have, b.max)}">${r.top ? '' : money(r.have)}</span>${r.top ? '' : `<span class="md-goal" style="left:${pct(r.need, b.max)}"></span>`}</div><span class="md-ctext md-t${BAND[r.band].cls}">${esc(r.text)}</span></div>`).join('')}</div>`;
    return tiles + close;
  }
  if (b.kind === 'matrix') {
    const head = `<div class="md-mrow md-mhead"><span>${ui.unitTitle}</span><span class="connect">Year 1 Connect</span><span>Y1 · District report<i class="connect">needs Connect</i></span><span>Y2 · Heat wave<i class="uptime">needs Uptime</i></span><span>Y2 · Competitor<i class="connect">needs Connect</i></span><span>Y3 · Prediction<i class="connect">needs Connect + Capacity</i></span></div>`;
    return `<div class="md-matrix">${head}${b.rows.map(r => `<div class="md-mrow${r.mark ? ' md-mark' : ''}"><b class="md-rname">${esc(r.name)}</b><span class="md-y1"><span class="md-ybar" style="width:calc(${Math.min(1, num(r.connect) / r.cap)} * 9em)"></span><b>${money(r.connect)}</b></span>${r.cells.map(c => chip(c)).join('')}</div>`).join('')}</div>`;
  }
  if (b.kind === 'race') {
    return `<div class="md-legend"><span><i class="md-sw connect"></i>Year 1 Connect</span><span><i class="md-sw connect2"></i>Year 2 Connect</span><span><i class="md-sw ghost"></i>Still possible after Year 1</span></div>
    <div class="md-race"><div class="md-lanes-over"><span class="md-zone-p" style="left:${pct(b.pilotLine, b.max)};width:${pct(b.strongLine - b.pilotLine, b.max)}"></span><span class="md-zone-s" style="left:${pct(b.strongLine, b.max)};right:0"></span>
      <span class="md-line pilot" style="left:${pct(b.pilotLine, b.max)}"><i>${money(b.pilotLine)} · Pilot</i></span><span class="md-line strong" style="left:${pct(b.strongLine, b.max)}"><i>${money(b.strongLine)} · Strong</i></span></div>
    ${b.rows.map(r => `<div class="md-rrow"><b class="md-rname">${esc(r.name)}</b><div class="md-lane"><span class="md-seg connect" style="width:${pct(r.a, b.max)}"></span><span class="md-seg connect2${r.a ? '' : ' solo'}" style="width:${pct(r.b, b.max)}"></span>${r.reach > r.total ? `<span class="md-seg ghost" style="width:${pct(Math.min(r.reach, b.max) - r.total, b.max)}"></span>` : ''}<span class="md-rtag md-t${r.tone}">${esc(r.tag)}</span></div></div>`).join('')}</div>`;
  }
  if (b.kind === 'stack') {
    return `<div class="md-legend">${LINES.map(k => `<span><i class="md-sw ${k}"></i>${EXEC[k]} · ${LINE_LABEL[k]}</span>`).join('')}</div>
    <div class="md-stacks">${b.rows.map(r => `<div class="md-srow"><b class="md-rname">${esc(r.name)}</b><div class="md-stack">${LINES.filter(k => r.c[k] > 0).map(k => `<span class="md-sseg ${k}" style="width:${pct(r.c[k], b.total)}" title="${LINE_LABEL[k]} ${money(r.c[k])}">${k === 'run' ? 'Run ' : ''}${money(r.c[k])}</span>`).join('')}</div><span class="md-side ${r.line || ''}">${esc(r.side)}</span></div>`).join('')}</div>`;
  }
  if (b.kind === 'two') {
    const bar = (v, need, cls) => `<span class="md-tcell"><span class="md-ttrack"><span class="md-tfill ${cls}" style="width:${pct(v, b.max)}"></span><span class="md-goal" style="left:${pct(need, b.max)}"></span></span><b>${money(v)}</b><i class="${v >= need ? 'md-ok' : 'md-no'}" aria-label="${v >= need ? 'enough' : 'short'}">${v >= need ? '✓' : '✗'}</i></span>`;
    return `<div class="md-two"><div class="md-trow md-thead"><span></span><span class="connect">Connect · the data<i>Sam asked for it · needs ${money(b.strongLine)}</i></span><span class="capacity">Capacity · the room<i>Nobody asked · needs ${money(b.capStrong)}</i></span><span>Year 3</span></div>
      ${b.rows.map(r => `<div class="md-trow${r.mark ? ' md-mark-o' : ''}"><b class="md-rname">${esc(r.name)}</b>${bar(r.connect, b.strongLine, 'connect')}${bar(r.capacity, b.capStrong, 'capacity')}${chip(r.band)}</div>`).join('')}</div>`;
  }
  if (b.kind === 'buyers') {
    const cell = (v, amt, yard) => v ? `<div class="md-cell md-${INTEREST[v].cls}"><b>${INTEREST[v].label}</b><span><strong>${amt}</strong> · ${yard}</span></div>` : '<div class="md-cell md-n"><b>—</b></div>';
    return `<div class="md-buyers"><div class="md-brow md-bhead"><span></span><div><b>Ridge Hollow · private equity</b><i>Reads Run + Features. Dale’s question: how lean?</i></div><div><b>Corven · platform buyer</b><i>Reads <span class="connect">Connect</span>. Sam’s question: how much field history?</i></div></div>
    ${b.rows.map(r => `<div class="md-brow"><b class="md-rname">${esc(r.name)}</b>${cell(r.ridge, money(r.ridgeSpend), `liked ${money(8)} or less`)}${cell(r.corven, money(r.connect), `liked ${money(5)} or more`)}</div>`).join('')}</div>`;
  }
  if (b.kind === 'said') {
    const shown = b.cards.filter(c => !ui.hidden[c.id]);
    const hiddenCount = b.cards.length - shown.length;
    return `<div class="md-legend">${LINES.map(k => `<span><i class="md-sw ${k}"></i>${LINE_LABEL[k]}</span>`).join('')}${hiddenCount ? `<button type="button" class="md-btn md-small" data-md="unhide">Show ${hiddenCount} hidden</button>` : ''}</div><div class="md-said">${shown.map(c => {
      const reviews = ui.allReviews ? c.reviews : c.reviews.slice(0, 1);
      return `<article class="md-card"><span class="md-band md-b${BAND[c.band].cls}"></span><div class="md-cin"><div class="md-chead"><b class="md-rname">${esc(c.name)}</b><button type="button" class="md-btn md-small" data-md-hide="${esc(c.id)}">Hide</button></div>
        <span class="md-k">Year 1, they said</span><p class="md-quote">${c.said ? `“${esc(c.said)}”` : '<span class="md-dim">No sentence saved.</span>'}</p>
        <span class="md-k">What they funded · 2 years</span><div class="md-fund">${LINES.filter(k => c.c[k] > 0).map(k => `<span class="${k}" style="width:${pct(c.c[k], b.total)}" title="${LINE_LABEL[k]} ${money(c.c[k])}"></span>`).join('')}</div>
        <span class="md-res md-t${BAND[c.band].cls}">Year 3 · ${esc(BAND[c.band].label)} · ${esc(c.result)}</span>
        ${reviews.map(r => `<span class="md-k">Looking back · ${esc(r.name)}</span><p class="md-review">${esc(r.text)}</p>`).join('')}</div></article>`;
    }).join('')}</div>`;
  }
  if (b.kind === 'lessons') {
    return `<div class="md-lessons">${b.items.map((l, i) => `<div class="md-lrow"><span class="md-num">${i + 1}</span><div><b class="md-lhead">${esc(l.head)}</b><p>${esc(l.text)}</p></div><div class="md-ev ${l.tone}"><small>In this class</small>${l.evidence}</div></div>`).join('')}</div><div class="md-closing">${esc(b.closing)}</div>`;
  }
  return '';
}

function slideHTML(m, s, i, ui) {
  const lesson = s.lesson != null ? m.lessons[s.lesson] : null;
  const revealed = lesson && ui.revealed[s.key];
  const last = i === m.slides.length - 1;
  const extraBtn = s.key === 'said' ? `<button type="button" class="md-btn" data-md="reviews">${ui.allReviews ? 'First review only' : 'All reviews'}</button>` : '';
  return `<section class="md-slide" aria-roledescription="slide" aria-label="${i + 1} of ${m.slides.length}">
  <div class="md-top"><span class="md-kicker">${esc(s.kicker)}</span><div class="md-tools"><span class="md-count">${m.submitted < m.total ? `${m.submitted} of ${m.total} ${m.units} submitted · ` : ''}${i + 1} / ${m.slides.length}</span></div></div>
  <div class="md-headwrap"><div class="md-head" role="heading" aria-level="2">${s.headline}</div>${s.sub ? `<div class="md-sub">${s.sub}</div>` : ''}</div>
  <div class="md-main${revealed ? ' md-with-lesson' : ''}"><div class="md-body">${bodyHTML(s, { ...ui, unit: m.unit, unitTitle: cap1(m.unit) })}${s.note ? `<p class="md-note">${s.note}</p>` : ''}</div>
  ${revealed ? `<div class="md-lesson"><span class="md-k amber">Lesson ${s.lesson + 1}</span><b>${esc(lesson.head)}</b><p>${esc(lesson.text)}</p><p class="md-lev">In this class: ${s.evidence}</p></div>` : ''}</div>
  <div class="md-foot">${s.ask ? `<div class="md-ask"><span>Ask the class</span><p>${s.ask}</p></div>` : `<div class="md-ask md-closing-ask"><p>${esc(s.body.closing || '')}</p></div>`}
  ${lesson ? `<button type="button" class="md-btn${revealed ? '' : ' md-amber'}" data-md="lesson">${revealed ? 'Hide lesson' : 'Show lesson'}</button>` : ''}${extraBtn}
  <button type="button" class="md-btn" data-md="prev" ${i === 0 ? 'disabled' : ''} aria-label="Previous slide">←</button>${last ? '<button type="button" class="md-btn md-light" data-md="end">End debrief</button>' : '<button type="button" class="md-btn md-pri" data-md="next">Next →</button>'}</div></section>`;
}

// One debrief per root. getInput() returns the latest session data; UI state survives polling.
// opts.onEnd(): called by End debrief on the last slide.
function mount(root, getInput, opts) {
  if (root._md) { root._md.opts = opts || root._md.opts; root._md.refresh(); return root._md; }
  const ui = { index: 0, anonymous: false, revealed: {}, allReviews: false, hidden: {} };
  let last = '', slides = [];
  const api = { refresh: () => paint(false), ui, opts: opts || {} };
  function paint(force) {
    const m = model({ ...getInput(), anonymous: ui.anonymous });
    const sig = JSON.stringify([m, ui]);
    if (!force && sig === last) return;
    last = sig; slides = m.slides;
    if (!m.ready) {
      root.innerHTML = `<div class="md-empty"><h2>The debrief fills in as ${m.units} submit.</h2><p>${m.total ? `${m.submitted} of ${m.total} ${m.units} have submitted so far.` : `No ${m.units} yet.`} Each slide is written from this session’s own results.</p></div>`;
      return;
    }
    ui.index = Math.min(ui.index, m.slides.length - 1);
    root.innerHTML = `<div class="md-bar"><div class="md-dots" role="tablist" aria-label="Debrief slides">${m.slides.map((s, i) => `<button type="button" role="tab" aria-selected="${i === ui.index}" data-md-go="${i}" title="${esc(s.kicker)}">${i + 1}</button>`).join('')}</div>
      <div class="md-bar-actions"><button type="button" class="md-btn" data-md="anon" aria-pressed="${ui.anonymous}">${ui.anonymous ? 'Anonymous · show names' : 'Team names · hide names'}</button><button type="button" class="md-btn md-pri" data-md="present">Present</button></div></div>
      <div class="md-stage" tabindex="0">${slideHTML(m, m.slides[ui.index], ui.index, ui)}</div>`;
  }
  function go(i) {
    ui.index = Math.max(0, Math.min(slides.length - 1, i)); paint(true);
    // Keep the whole slide in view below the page's top bar.
    if (!document.fullscreenElement && !root.classList.contains('md-presenting') && root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: 'start' });
  }
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || !root.contains(b)) return;
    if (b.dataset.mdGo) return go(Number(b.dataset.mdGo));
    if (b.dataset.mdHide) { ui.hidden[b.dataset.mdHide] = true; return paint(true); }
    const a = b.dataset.md;
    if (a === 'next') return go(ui.index + 1);
    if (a === 'prev') return go(ui.index - 1);
    if (a === 'anon') { ui.anonymous = !ui.anonymous; return paint(true); }
    if (a === 'reviews') { ui.allReviews = !ui.allReviews; return paint(true); }
    if (a === 'unhide') { ui.hidden = {}; return paint(true); }
    if (a === 'lesson') { const k = slides[ui.index] && slides[ui.index].key; if (k) ui.revealed[k] = !ui.revealed[k]; return paint(true); }
    if (a === 'end') {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
      root.classList.remove('md-presenting');
      if (api.opts.onEnd) api.opts.onEnd();
      return;
    }
    if (a === 'present') {
      if (document.fullscreenElement) document.exitFullscreen && document.exitFullscreen();
      else if (root.requestFullscreen) root.requestFullscreen().then(() => { const st = root.querySelector('.md-stage'); if (st) st.focus(); }).catch(() => root.classList.toggle('md-presenting'));
      else root.classList.toggle('md-presenting');
    }
  });
  // Arrow keys move slides while the debrief has focus, so typing elsewhere on the page is untouched.
  root.addEventListener('keydown', e => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(ui.index + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(ui.index - 1); }
    if (e.key === 'Escape') root.classList.remove('md-presenting');
  });
  root._md = api;
  paint(true);
  return api;
}

const MidlandDebrief = { model, mount, LESSONS, QUESTIONS, BAND };
if (typeof module !== 'undefined' && module.exports) module.exports = MidlandDebrief;
global.MidlandDebrief = MidlandDebrief;
})(typeof window !== 'undefined' ? window : globalThis);
