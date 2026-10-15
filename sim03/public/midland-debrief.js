/* Midland class debrief: one slide per lesson question, each headline written from the session's own numbers. */
(function (global) {
'use strict';

const LESSONS = [
  { head: 'Technology spending takes time to pay off.', text: 'What you fund this year decides what the company can do two or three years from now.' },
  { head: 'Some capabilities take years to build.', text: 'The yearly limit on each line stands for that time. Money that arrives later buys less of it.' },
  { head: 'Each executive is right about one part of the company.', text: 'The technology leader’s job is to fund the whole company.' },
  { head: 'The quietest line can matter most.', text: 'Capacity had only you to speak for it. In Year 3 it decided whether the data could become a service.' }
];
const QUESTIONS = [
  'What does a dollar you spend this year buy two years from now?',
  'Which capabilities take more than a year to build?',
  'Every executive is right about their own part of the company. How do you fund the whole company?',
  'Which need will speak up for itself, and which one only you can speak for?'
];
const LINES = ['run', 'uptime', 'capacity', 'connect', 'features'];
const EXEC = { run: 'Dale', uptime: 'Renata', capacity: 'no one', connect: 'Sam', features: 'Tom' };
const LINE_LABEL = { run: 'Run', uptime: 'Uptime', capacity: 'Capacity', connect: 'Connect', features: 'Features' };
const BAND = {
  strong: { label: 'Strong', cls: 'g' }, middle: { label: 'Middle', cls: 'y' }, pilot: { label: 'Pilot', cls: 'y' },
  data_no_room: { label: 'Data without room', cls: 'o' }, weak: { label: 'Weak', cls: 'r' }
};
const SHOW_ORDER = { strong: 0, pilot: 1, data_no_room: 2, weak: 3 };
// How much of the field data a result shows: used to test whether Year 1 Connect lines up with Year 3.
const DATA_RANK = { strong: 3, data_no_room: 2, pilot: 1, weak: 0 };
const INTEREST = { high: { label: 'High', cls: 'g' }, qualified: { label: 'Some', cls: 'y' }, low: { label: 'Low', cls: 'r' } };
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const word = n => WORDS[n] || String(n);
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const money = n => num(n) === 0 ? "$0" : `$${num(n)}M`;
function listNames(items) {
  const n = items.map(x => x.name);
  if (n.length <= 1) return n.join('');
  return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
}
function sumLines(a, b) { const o = {}; for (const k of LINES) o[k] = num(a && a[k]) + num(b && b[k]); return o; }

// input: { mode, thresholds, anonymous, teams:[{ id, name, members:[names], year1, year2, outcomes, strategicView, reviews:[{ name, text }] }] }
function model(input) {
  const t = input.thresholds || {};
  const budget = num(t.budgetPerYear) || 9, cap = num(t.perLineCap) || 3, floor = num(t.runFloor) || 4;
  const strongLine = num(t.year3ConnectStrong) || 5, pilotLine = num(t.year3ConnectPilotMin) || 3, capStrong = num(t.year3CapacityStrong) || 2;
  const team = input.mode !== 'individual';
  const unit = team ? 'team' : 'student', units = team ? 'teams' : 'students';
  const plural = n => n === 1 ? unit : units;
  const all = input.teams || [];
  const done = all.filter(x => x.year1 && x.year2 && x.outcomes && x.outcomes.year3 && x.outcomes.year3.band);
  const rows = done.map((x, i) => {
    const c = sumLines(x.year1, x.year2);
    const o = x.outcomes;
    return {
      id: x.id, realName: x.name, members: x.members || [], strategicView: x.strategicView || '', reviews: x.reviews || [],
      y1: x.year1, y2: x.year2, c,
      bands: { y1: o.year1 && o.year1.band, heat: o.year2 && o.year2.heat && o.year2.heat.band,
        comp: o.year2 && o.year2.competitor && o.year2.competitor.band, y3: o.year3.band },
      ridge: (o.buyers && o.buyers.ridge_hollow && o.buyers.ridge_hollow.interest) || null,
      corven: (o.buyers && o.buyers.corven && o.buyers.corven.interest) || null
    };
  }).sort((a, b) => String(a.realName).localeCompare(String(b.realName), undefined, { numeric: true }));
  rows.forEach((r, i) => { r.name = input.anonymous ? `${team ? 'Team' : 'Student'} ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}` : r.realName; });
  const out = { ready: rows.length > 0, submitted: rows.length, total: all.length, unit, units, slides: [] };
  if (!rows.length) return out;
  const n = rows.length, pair = 2 * budget;

  // D0 · the class at a glance
  const bandsSeen = [...new Set(rows.map(r => r.bands.y3))];
  const glanceHead = n === 1 ? `${esc(rows[0].name)} reached <em>${esc(BAND[rows[0].bands.y3].label)}</em> in Year 3.`
    : bandsSeen.length === 1 ? `Same ${money(pair)}. Every ${unit} reached <em>${esc(BAND[bandsSeen[0]].label)}</em> in Year 3.`
    : `Same ${money(pair)}. Same four executives. <em>${cap1(word(bandsSeen.length))} different companies</em> in Year 3.`;
  const phrase = r => {
    const c = r.c;
    if (r.bands.y3 === 'strong') return ['Sells failure prediction to customers', 'Field data and room to run it.'];
    if (r.bands.y3 === 'pilot') return ['A pilot on the newest units', `${money(Math.max(1, strongLine - c.connect))} more Connect would have made it a business.`];
    if (r.bands.y3 === 'data_no_room') return ['Field data with nowhere to run it', `${money(Math.max(1, capStrong - c.capacity))} more Capacity would have run it.`];
    return ['Too little field history to predict anything', `${money(Math.max(1, pilotLine - c.connect))} more Connect would have reached a pilot.`];
  };
  const byShow = rows.slice().sort((a, b) => SHOW_ORDER[a.bands.y3] - SHOW_ORDER[b.bands.y3] || a.name.localeCompare(b.name, undefined, { numeric: true }));
  out.slides.push({ key: 'glance', kicker: 'The class at a glance', headline: glanceHead, sub: '',
    ask: 'You all had the same money and the same facts. What made the difference?',
    body: { kind: 'glance', grouped: n > 8, tiles: byShow.map(r => ({ name: r.name, members: input.anonymous || !team ? [] : r.members, band: r.bands.y3, lines: phrase(r) })),
      groups: Object.keys(SHOW_ORDER).map(b => ({ band: b, names: byShow.filter(r => r.bands.y3 === b).map(r => r.name) })).filter(g => g.names.length) } });

  // D1 · a dollar this year
  const y1c = r => num(r.y1.connect);
  const ordered = rows.slice().sort((a, b) => y1c(b) - y1c(a) || DATA_RANK[b.bands.y3] - DATA_RANK[a.bands.y3]);
  const lines = rows.every(a => rows.every(b => !(y1c(a) > y1c(b)) || DATA_RANK[a.bands.y3] >= DATA_RANK[b.bands.y3]));
  const varied = new Set(rows.map(y1c)).size > 1;
  const low = Math.min(...rows.map(y1c)), lowRows = rows.filter(r => y1c(r) === low);
  const lowWeak = lowRows.every(r => r.bands.y3 === 'weak');
  let q1Head, q1Sub, q1Ask, q1Note = '', q1Evidence;
  if (!varied) {
    q1Head = `Every ${unit} put ${money(low)} into Connect in Year 1.`;
    q1Sub = 'Same start. The differences in Year 3 came from Year 2 and from Capacity.';
    q1Ask = 'What did your team fund first in Year 1, and why?';
    q1Evidence = `Every ${unit} started with ${money(low)} of Connect.`;
  } else {
    q1Head = lines ? 'Year 3 was decided in <em>Year 1</em>.' : 'Year 1 set the starting line for <em>Year 3</em>.';
    const they = lowRows.length === 1 ? 'It' : 'They';
    q1Sub = low === 0
      ? `${esc(listNames(lowRows))} put $0 into Connect in Year 1. ${they} lost the district report that year${lowWeak ? ' and reached Year 3 with too little data to predict anything' : ''}.`
      : `${esc(listNames(lowRows))} put the least into Connect in Year 1: ${money(low)}. ${they} reached ${esc(BAND[lowRows[0].bands.y3].label)} in Year 3.`;
    q1Ask = low < num(t.year1ConnectStrong || 2)
      ? `${esc(listNames(lowRows))}, what looked more urgent than Connect in Year 1? Would you choose it again?`
      : 'What did your team fund first in Year 1, and why?';
    const funded = lowRows.length === 1 && lowRows[0].bands.heat === 'strong' && lowWeak;
    if (funded) q1Note = `${esc(lowRows[0].name)} did well on the test it funded: its Uptime held dispatch through the heat wave. The tests that needed Connect went the other way.`;
    q1Evidence = lines ? 'Year 1 Connect lined up with every Year 3 result.' : `${esc(listNames(lowRows))} started with the least Connect and reached ${esc(BAND[lowRows[0].bands.y3].label)}.`;
  }
  out.slides.push({ key: 'q1', kicker: `Question 1 of 4 · ${QUESTIONS[0]}`, headline: q1Head, sub: q1Sub, ask: q1Ask, lesson: 0, note: q1Note,
    body: { kind: 'matrix', rows: ordered.map(r => ({ name: r.name, connect: y1c(r), cap, mark: varied && y1c(r) === low && lowWeak,
      cells: [r.bands.y1, r.bands.heat, r.bands.comp, r.bands.y3] })) } });

  // D2 · what takes years
  const race = rows.map(r => ({ r, a: y1c(r), b: num(r.y2.connect), total: r.c.connect, reach: y1c(r) + cap }));
  const outOfReach = race.filter(x => x.reach < strongLine).map(x => x.r);
  const nearMiss = race.filter(x => x.reach >= strongLine && x.total < strongLine);
  let q2Head, q2Evidence;
  if (outOfReach.length) { q2Head = `After Year 1, ${esc(listNames(outOfReach))} could no longer reach <em class="bad">Strong</em>.`; q2Evidence = `After Year 1, ${esc(listNames(outOfReach))} could no longer reach Strong.`; }
  else if (nearMiss.length) { q2Head = `Every ${unit} could still reach Strong after Year 1. <em>${esc(listNames(nearMiss.map(x => x.r)))} stopped short.</em>`; q2Evidence = `${esc(listNames(nearMiss.map(x => x.r)))} could still reach Strong and stopped short.`; }
  else { q2Head = `Every ${unit} built enough Connect for <em>Strong</em> by Year 3.`; q2Evidence = `Every ${unit} reached ${money(strongLine)} of Connect.`; }
  const q2Note = [
    ...nearMiss.map(x => `${esc(x.r.name)} could still reach ${money(strongLine)} in Year 2 and stopped at ${money(x.total)}.`),
    outOfReach.length ? `${esc(listNames(outOfReach))} started Year 2 already out of reach.` : ''
  ].filter(Boolean).join(' ');
  out.slides.push({ key: 'q2', kicker: `Question 2 of 4 · ${QUESTIONS[1]}`, headline: q2Head, lesson: 1, note: q2Note,
    sub: `Each line takes at most ${money(cap)} a year. Strong needed ${money(strongLine)} of Connect by Year 3, so the race started in Year 1.`,
    ask: 'What in a real company takes years to build and can’t be bought in a hurry?',
    body: { kind: 'race', max: 2 * cap, pilotLine, strongLine,
      rows: race.slice().sort((x, y) => y.total - x.total).map(x => ({ name: x.r.name, a: x.a, b: x.b, total: x.total, reach: x.reach,
        tag: x.reach < strongLine ? `could reach ${money(x.reach)} at most` : x.total < strongLine ? `${money(strongLine - x.total)} short` : '' })) } });

  // D3 · whose argument won
  const sided = rows.map(r => {
    const four = ['connect', 'uptime', 'features', 'capacity'];
    const top = Math.max(...four.map(k => r.c[k]));
    const winners = four.filter(k => r.c[k] === top);
    return { r, who: winners.length === 1 ? EXEC[winners[0]] === 'no one' ? 'Capacity' : EXEC[winners[0]] : 'no one side', line: winners.length === 1 ? winners[0] : null };
  });
  const counts = {};
  sided.forEach(s => { counts[s.who] = (counts[s.who] || 0) + 1; });
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const colorFor = who => ({ Sam: 'connect', Tom: 'features', Renata: 'uptime', Capacity: 'capacity' }[who] || '');
  // The same phrase twice: plain for the lessons slide, coloured for the headline.
  const sidePhrase = html => {
    const nm = who => html ? `<em class="${colorFor(who)}">${who}</em>` : who;
    if (ranked.length === 1 && n > 1) return ranked[0][0] === 'no one side' ? `every ${unit} split the rest evenly` : `every ${unit} sided with ${nm(ranked[0][0])}`;
    return ranked.map(([who, k], i) => {
      if (who === 'no one side') return i === 0 ? `${word(k)} ${plural(k)} split the rest evenly` : `${word(k)} split the rest evenly`;
      return i === 0 ? `${word(k)} ${plural(k)} sided with ${nm(who)}` : `${word(k)} with ${nm(who)}`;
    }).reduce((acc, p, i, arr) => i === 0 ? p : acc + (i === arr.length - 1 ? ', and ' : ', ') + p, '');
  };
  const capTotal = rows.reduce((s, r) => s + r.c.capacity, 0), grand = rows.reduce((s, r) => s + LINES.reduce((x, k) => x + r.c[k], 0), 0);
  const aboveFloor = rows.filter(r => r.c.run > 2 * floor);
  const q3Head = `Every ${unit} paid Dale first. Then ${sidePhrase(true)}.`;
  const q3Note = `Two years, ${money(pair)} per ${unit}. Run had a ${money(2 * floor)} two-year minimum before anyone argued. ` +
    (aboveFloor.length ? aboveFloor.map(r => `${esc(r.name)} gave Dale ${money(r.c.run - 2 * floor)} more than he needed.`).join(' ') : `Every ${unit} held Run at the minimum.`);
  out.slides.push({ key: 'q3', kicker: `Question 3 of 4 · ${QUESTIONS[2]}`, headline: q3Head, lesson: 2, note: q3Note,
    sub: `Capacity had no executive arguing for it. It got <b class="capacity">${money(capTotal)} of the class’s ${money(grand)}</b>.`,
    ask: 'Whose argument was hardest to say no to? Which line had no one speaking for it?',
    body: { kind: 'stack', total: pair, rows: sided.map(s => ({ name: s.r.name, c: s.r.c, who: s.who, line: s.line })) } });

  // D4 · the line no one spoke for
  const dnr = rows.filter(r => r.bands.y3 === 'data_no_room'), strongRows = rows.filter(r => r.bands.y3 === 'strong');
  const zero = rows.filter(r => r.c.capacity === 0).length;
  const q4Head = dnr.length ? `${esc(listNames(dnr))} built the data and had <em class="warn">nowhere to run it</em>.`
    : strongRows.length ? `${esc(listNames(strongRows))} built the data and <em class="good">the room to run it</em>.`
    : `No ${unit} built enough data for Capacity to decide Year 3.`;
  const q4Sub = dnr.length === 1 ? `${money(dnr[0].c.connect)} in Connect, ${money(dnr[0].c.capacity)} in Capacity. Capacity was the one line with no executive asking for it.`
    : 'Capacity was the one line with no executive asking for it.';
  const q4Evidence = `Capacity got ${money(capTotal)} of ${money(grand)}.${zero ? ` ${cap1(word(zero))} ${plural(zero)} gave it nothing.` : ''}${dnr.length ? ` ${esc(listNames(dnr))} had the data and no room to run it.` : ''}`;
  out.slides.push({ key: 'q4', kicker: `Question 4 of 4 · ${QUESTIONS[3]}`, headline: q4Head, sub: q4Sub, lesson: 3, evidence: q4Evidence,
    ask: 'In your own company, who speaks for the capacity line? Who should?',
    body: { kind: 'map', maxX: 2 * cap, maxY: 2 * cap, strongLine, pilotLine, capStrong,
      dots: rows.map(r => ({ name: r.name, x: r.c.connect, y: r.c.capacity, band: r.bands.y3 })) } });

  // D5 · buyers
  const both = rows.filter(r => r.ridge === 'high' && r.corven === 'high'), neither = rows.filter(r => r.ridge === 'low' && r.corven === 'low');
  let q5Head = both.length === 1 ? `Only ${esc(both[0].name)} pleased both buyers.` : both.length ? `${esc(listNames(both))} pleased both buyers.` : `No ${unit} pleased both buyers.`;
  if (neither.length) q5Head += ` <em class="bad">${esc(listNames(neither))} pleased neither.</em>`;
  const featureCost = rows.filter(r => r.c.features >= 3 && r.ridge === 'low');
  const score = v => ({ high: 2, qualified: 1, low: 0 }[v] || 0);
  out.slides.push({ key: 'buyers', kicker: 'Year 3 · Three buyers look at Midland', headline: q5Head,
    sub: 'Same company, same budget. Each buyer read a different part of it.',
    note: `Ridge Hollow liked ${money(8)} or less in Run + Features. Corven liked ${money(5)} or more in Connect.` +
      featureCost.map(r => ` ${esc(r.name)}’s ${money(r.c.features)} of Features counted as cost to Ridge Hollow and bought nothing for Corven.`).join(''),
    ask: 'Who were you building the company for? Did your team choose that, or did it just happen?',
    body: { kind: 'buyers', rows: rows.slice().sort((a, b) => score(b.ridge) + score(b.corven) - score(a.ridge) - score(a.corven) || a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map(r => ({ name: r.name, ridge: r.ridge, ridgeSpend: r.c.run + r.c.features, corven: r.corven, connect: r.c.connect,
        mark: r.ridge === 'high' && r.corven === 'high' ? 'good' : r.ridge === 'low' && r.corven === 'low' ? 'bad' : '' })) } });

  // D6 · what teams said
  out.slides.push({ key: 'said', kicker: `What ${units} said · Year 1 reason and reviews for Tom`, headline: 'Every plan made sense in Year 1. <em>Year 3 graded them.</em>',
    ask: 'Read your Year 1 sentence again. What would you write today?',
    body: { kind: 'said', cards: byShow.map(r => ({ name: r.name, said: r.strategicView, band: r.bands.y3, result: phrase(r)[0],
      reviews: r.reviews.filter(x => x && x.text).map(x => ({ name: input.anonymous ? 'A member' : x.name, text: x.text })) })) } });

  // D7 · lessons with this class's evidence
  const q3Evidence = `Every ${unit} paid Dale first. ${cap1(sidePhrase(false))}.`;
  out.slides.push({ key: 'lessons', kicker: 'The four lessons · as students saw them at the end', headline: 'What Midland teaches, <em>proved by this class</em>.',
    body: { kind: 'lessons', items: LESSONS.map((l, i) => ({ ...l, evidence: [q1Evidence, q2Evidence, q3Evidence, q4Evidence][i], tone: ['ev-connect', 'ev-weak', 'ev-features', 'ev-capacity'][i] })),
      closing: 'Your budget decided what Midland was ready for when the future arrived.' } });
  out.lessons = LESSONS;
  out.slides.forEach(s => { if (s.lesson != null && !s.evidence) s.evidence = [q1Evidence, q2Evidence, q3Evidence, q4Evidence][s.lesson]; });
  return out;
}

// ---- Rendering ----
const chip = (band, extra = '') => band ? `<span class="md-chip md-${BAND[band] ? BAND[band].cls : 'n'}${extra}">${esc(BAND[band] ? BAND[band].label : band)}</span>` : '<span class="md-chip md-n">—</span>';
const pct = (v, max) => `${Math.max(0, Math.min(100, (num(v) / max) * 100))}%`;

function bodyHTML(s, ui) {
  const b = s.body;
  if (b.kind === 'glance') {
    if (b.grouped) return `<div class="md-tiles">${b.groups.map(g => `<div class="md-tile md-${BAND[g.band].cls}"><div><b class="md-tname">${cap1(word(g.names.length))} · ${esc(BAND[g.band].label)}</b></div><div class="md-tlist">${g.names.map(esc).join(', ')}</div></div>`).join('')}</div>`;
    return `<div class="md-tiles">${b.tiles.map(x => `<div class="md-tile md-${BAND[x.band].cls}"><div><b class="md-tname">${esc(x.name)}</b>${x.members.length ? `<span class="md-tmem">${esc(x.members.join(', '))}</span>` : ''}</div><div class="md-tfoot"><span class="md-tband">${esc(BAND[x.band].label)}</span><b class="md-tphrase">${esc(x.lines[0])}</b><span class="md-tdetail">${esc(x.lines[1])}</span></div></div>`).join('')}</div>`;
  }
  if (b.kind === 'matrix') {
    const head = `<div class="md-mrow md-mhead"><span>${ui.unitTitle}</span><span class="connect">Year 1 Connect</span><span>Y1 · District report<i class="connect">needs Connect</i></span><span>Y2 · Heat wave<i class="uptime">needs Uptime</i></span><span>Y2 · Competitor<i class="connect">needs Connect</i></span><span>Y3 · Prediction<i class="connect">needs Connect + Capacity</i></span></div>`;
    return `<div class="md-matrix">${head}${b.rows.map(r => `<div class="md-mrow${r.mark ? ' md-mark' : ''}"><b class="md-rname">${esc(r.name)}</b><span class="md-y1"><span class="md-ybar" style="width:calc(${Math.min(1, num(r.connect) / r.cap)} * 9em)"></span><b>${money(r.connect)}</b></span>${r.cells.map(c => chip(c)).join('')}</div>`).join('')}</div>`;
  }
  if (b.kind === 'race') {
    return `<div class="md-legend"><span><i class="md-sw connect"></i>Year 1 Connect</span><span><i class="md-sw connect2"></i>Year 2 Connect</span><span><i class="md-sw ghost"></i>Most still possible after Year 1</span></div>
    <div class="md-race"><div class="md-track-lines"><span class="md-line pilot" style="left:${pct(b.pilotLine, b.max)}"><i>${money(b.pilotLine)} · Pilot</i></span><span class="md-line strong" style="left:${pct(b.strongLine, b.max)}"><i>${money(b.strongLine)} · Strong</i></span></div>
    ${b.rows.map(r => `<div class="md-rrow"><b class="md-rname">${esc(r.name)}</b><div class="md-track"><span class="md-seg connect" style="width:${pct(r.a, b.max)}"></span><span class="md-seg connect2" style="width:${pct(r.b, b.max)}"></span>${r.reach > r.total ? `<span class="md-seg ghost" style="width:${pct(Math.min(r.reach, b.max) - r.total, b.max)}"></span>` : ''}<span class="md-rtag${r.reach < b.strongLine ? ' bad' : r.tag ? ' warn' : ''}">${money(r.total)}${r.tag ? ' · ' + esc(r.tag) : ''}</span></div></div>`).join('')}</div>`;
  }
  if (b.kind === 'stack') {
    return `<div class="md-legend">${['run', 'uptime', 'capacity', 'connect', 'features'].map(k => `<span><i class="md-sw ${k}"></i>${k === 'capacity' ? 'No one' : EXEC[k]} · ${LINE_LABEL[k]}</span>`).join('')}</div>
    <div class="md-stacks">${b.rows.map(r => `<div class="md-srow"><b class="md-rname">${esc(r.name)}</b><div class="md-stack">${LINES.filter(k => r.c[k] > 0).map(k => `<span class="md-sseg ${k}" style="width:${pct(r.c[k], b.total)}" title="${LINE_LABEL[k]} ${money(r.c[k])}">${k === 'run' ? 'Run ' : ''}${money(r.c[k])}</span>`).join('')}</div><span class="md-side ${r.line || ''}">${r.who === 'no one side' ? 'Split evenly' : `Sided with ${esc(r.who)}`}</span></div>`).join('')}</div>`;
  }
  if (b.kind === 'map') {
    const seen = {};
    const dots = b.dots.map(d => { const k = `${d.x}:${d.y}`; const i = seen[k] = (seen[k] || 0) + 1; return { ...d, i }; });
    return `<div class="md-map"><div class="md-plot">
      <span class="md-zone weak" style="left:0;width:${pct(b.pilotLine, b.maxX)};top:0;bottom:0"><i>Weak · too little data</i></span>
      <span class="md-zone pilot" style="left:${pct(b.pilotLine, b.maxX)};width:${pct(b.strongLine - b.pilotLine, b.maxX)};top:0;bottom:0"><i>Pilot</i></span>
      <span class="md-zone strong" style="left:${pct(b.strongLine, b.maxX)};right:0;top:0;bottom:${pct(b.capStrong, b.maxY)}"><i>Strong</i></span>
      <span class="md-zone dnr" style="left:${pct(b.strongLine, b.maxX)};right:0;bottom:0;height:${pct(b.capStrong, b.maxY)}"><i>Data, no room</i></span>
      ${dots.map(d => `<span class="md-dot md-${BAND[d.band].cls}" style="left:calc(${pct(d.x, b.maxX)} - ${d.x >= b.maxX ? 1.4 : d.x === 0 ? -1.4 : 0}em - ${(d.i - 1) * 2.8}em);bottom:calc(${pct(d.y, b.maxY)} + ${d.y === 0 ? 1.4 : d.y >= b.maxY ? -1.4 : 0}em)" title="${esc(d.name)}: Connect ${money(d.x)}, Capacity ${money(d.y)}">${esc(String(d.name).replace(/^(Team|Student) /, ''))}</span>`).join('')}
    </div><div class="md-axis-x"><span>$0</span><span class="connect">Two-year Connect → Sam’s line: the data</span><span>${money(b.maxX)}</span></div><div class="md-axis-y capacity">↑ Capacity: no one’s line</div></div>`;
  }
  if (b.kind === 'buyers') {
    const cell = (v, amt) => v ? `<div class="md-cell md-${INTEREST[v].cls}"><b>${INTEREST[v].label}</b><span>${amt}</span></div>` : '<div class="md-cell md-n"><b>—</b></div>';
    return `<div class="md-buyers"><div class="md-brow md-bhead"><span></span><div><b>Ridge Hollow</b><i>Private equity · reads Run + Features · Dale’s question: how lean?</i></div><div><b>Corven</b><i>Platform buyer · reads <span class="connect">Connect</span> · Sam’s question: how much field history?</i></div><div><b>Carrolton</b><i>Competitor · reads the customer list · the same for every ${ui.unit}</i></div></div>
    ${b.rows.map(r => `<div class="md-brow${r.mark ? ' md-mark-' + r.mark : ''}"><b class="md-rname">${esc(r.name)}</b>${cell(r.ridge, money(r.ridgeSpend))}${cell(r.corven, money(r.connect))}<div class="md-cell md-n"><b>Some</b><span>customers</span></div></div>`).join('')}</div>`;
  }
  if (b.kind === 'said') {
    return `<div class="md-said">${b.cards.map(c => {
      const shown = ui.allReviews ? c.reviews : c.reviews.slice(0, 1);
      return `<article class="md-card"><b class="md-rname">${esc(c.name)}</b><span class="md-k">Year 1, they said</span><p class="md-quote">${c.said ? `“${esc(c.said)}”` : '<span class="md-dim">No sentence saved.</span>'}</p><div class="md-res md-${BAND[c.band].cls}"><b>Year 3 · ${esc(BAND[c.band].label)}</b><span>${esc(c.result)}</span></div>${shown.length ? shown.map(r => `<span class="md-k">Looking back · ${esc(r.name)}</span><p class="md-review">${esc(r.text)}</p>`).join('') : '<span class="md-k">Looking back</span><p class="md-review md-dim">Reviews appear here as members send them.</p>'}</article>`;
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
  const extraBtn = s.key === 'said' ? `<button type="button" class="md-btn" data-md="reviews">${ui.allReviews ? 'First review only' : 'All reviews'}</button>` : '';
  return `<section class="md-slide" aria-roledescription="slide" aria-label="${i + 1} of ${m.slides.length}">
  <div class="md-top"><span class="md-kicker">${esc(s.kicker)}</span><div class="md-tools"><span class="md-count">${m.submitted < m.total ? `${m.submitted} of ${m.total} ${m.units} submitted · ` : ''}${i + 1} / ${m.slides.length}</span></div></div>
  <div class="md-headwrap"><div class="md-head" role="heading" aria-level="2">${s.headline}</div>${s.sub ? `<div class="md-sub">${s.sub}</div>` : ''}</div>
  <div class="md-main${revealed ? ' md-with-lesson' : ''}"><div class="md-body">${bodyHTML(s, { ...ui, unit: m.unit, unitTitle: cap1(m.unit) })}${s.note ? `<p class="md-note">${s.note}</p>` : ''}</div>
  ${revealed ? `<div class="md-lesson"><span class="md-k amber">Lesson ${s.lesson + 1}</span><b>${esc(lesson.head)}</b><p>${esc(lesson.text)}</p><p class="md-lev">In this class: ${s.evidence}</p></div>` : ''}</div>
  <div class="md-foot">${s.ask ? `<div class="md-ask"><span>Ask the class</span><p>${s.ask}</p></div>` : '<div class="md-ask md-ask-empty"></div>'}
  ${lesson ? `<button type="button" class="md-btn${revealed ? '' : ' md-amber'}" data-md="lesson">${revealed ? 'Hide lesson' : 'Show lesson'}</button>` : ''}${extraBtn}
  <button type="button" class="md-btn" data-md="prev" ${i === 0 ? 'disabled' : ''} aria-label="Previous slide">←</button><button type="button" class="md-btn md-pri" data-md="next" ${i === m.slides.length - 1 ? 'disabled' : ''}>Next →</button></div></section>`;
}

// One debrief per root. getInput() returns the latest session data; UI state survives polling.
function mount(root, getInput) {
  if (root._md) { root._md.refresh(); return root._md; }
  const ui = { index: 0, anonymous: false, revealed: {}, allReviews: false };
  let last = '';
  function paint(force) {
    const input = getInput();
    const m = model({ ...input, anonymous: ui.anonymous });
    const sig = JSON.stringify([m, ui]);
    if (!force && sig === last) return;
    last = sig;
    if (!m.ready) {
      root.innerHTML = `<div class="md-empty"><h2>The debrief fills in as ${m.units} submit.</h2><p>${m.total ? `${m.submitted} of ${m.total} ${m.units} have submitted so far.` : `No ${m.units} yet.`} Each slide is written from this session’s own results.</p></div>`;
      return;
    }
    ui.index = Math.min(ui.index, m.slides.length - 1);
    root.innerHTML = `<div class="md-bar"><div class="md-dots" role="tablist" aria-label="Debrief slides">${m.slides.map((s, i) => `<button type="button" role="tab" aria-selected="${i === ui.index}" data-md-go="${i}" title="${esc(s.kicker)}">${i + 1}</button>`).join('')}</div>
      <div class="md-bar-actions"><button type="button" class="md-btn" data-md="anon" aria-pressed="${ui.anonymous}">${ui.anonymous ? 'Anonymous · show names' : 'Team names · hide names'}</button><button type="button" class="md-btn md-pri" data-md="present">Present</button></div></div>
      <div class="md-stage" tabindex="0">${slideHTML(m, m.slides[ui.index], ui.index, ui)}</div>`;
    root._mdSlides = m.slides.length;
  }
  function go(i) { ui.index = Math.max(0, Math.min((root._mdSlides || 1) - 1, i)); paint(true); }
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || !root.contains(b)) return;
    if (b.dataset.mdGo) return go(Number(b.dataset.mdGo));
    const a = b.dataset.md;
    if (a === 'next') return go(ui.index + 1);
    if (a === 'prev') return go(ui.index - 1);
    if (a === 'anon') { ui.anonymous = !ui.anonymous; return paint(true); }
    if (a === 'reviews') { ui.allReviews = !ui.allReviews; return paint(true); }
    if (a === 'lesson') { const k = root.querySelector('.md-slide') && model({ ...getInput(), anonymous: ui.anonymous }).slides[ui.index].key; if (k) ui.revealed[k] = !ui.revealed[k]; return paint(true); }
    if (a === 'present') {
      const el = root;
      if (document.fullscreenElement) document.exitFullscreen && document.exitFullscreen();
      else if (el.requestFullscreen) el.requestFullscreen().then(() => { const st = root.querySelector('.md-stage'); if (st) st.focus(); }).catch(() => root.classList.toggle('md-presenting'));
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
  const api = { refresh: () => paint(false), ui };
  root._md = api;
  paint(true);
  return api;
}

const MidlandDebrief = { model, mount, LESSONS, QUESTIONS };
if (typeof module !== 'undefined' && module.exports) module.exports = MidlandDebrief;
global.MidlandDebrief = MidlandDebrief;
})(typeof window !== 'undefined' ? window : globalThis);
