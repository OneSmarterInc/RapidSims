/* Where Does the Money Land? class debrief (approved Oct 15: D0 to D5). Every slide is written from this session's
   own statements and funds. The companies, picks, stages, values, names and lessons arrive from the server with the
   faculty session (input.kit), so this file names none of them. Slides play in the shared player (kit/debrief-player.js). */
(function (global) {
'use strict';
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const word = n => WORDS[n] || String(n);
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const usdK = n => !n ? '$0' : n >= 1000000 ? '$' + (n / 1000000).toFixed(n % 1000000 ? 2 : 0) + 'M' : '$' + Math.round(n / 1000) + 'K';
const FUND = 1000000;

function model(input) {
  const K = input.kit || {}, B = K.bands || {}, order = K.order || [], companies = K.companies || [], picks = K.picks || [];
  const team = !!input.team, anon = !!input.anonymous;
  const rows = (input.teams || []).filter(t => t.band).map((t, i) => ({ ...t, key: 'card-' + i, name: anon && !team ? `Student ${i + 1}` : t.name }));
  const n = rows.length, unit = team ? 'team' : 'student', units = team ? 'teams' : 'students';
  const base = { ready: !!K.ended && n > 0, submitted: n, total: (input.teams || []).length, unit, units, lessons: K.lessons || [], slides: [] };
  if (!base.ready) return base;
  const ofN = k => `${k} of ${n} ${n === 1 ? unit : units}`;
  const pickText = k => (picks.find(p => p.key === k) || {}).text || 'No statement';
  const placed = rows.filter(r => r.allocation);
  const maxShare = a => Math.max(...companies.map(c => a[c.key] || 0), a.cash || 0) / FUND;
  const holds = a => companies.filter(c => a[c.key] > 0).length + (a.cash > 0 ? 1 : 0);

  // D0 · where the money went, grouped by destination pick
  const buckets = [...companies.map(c => ({ key: c.key, label: c.descriptor })), { key: 'cash', label: K.cashLabel || 'Cash' }];
  const totals = buckets.map(b => ({ ...b, amount: placed.reduce((s, r) => s + (r.allocation[b.key] || 0), 0) }));
  const all = totals.reduce((s, b) => s + b.amount, 0) || 1;
  const byPick = picks.map(p => ({ text: p.text, names: rows.filter(r => r.statements && r.statements.pick === p.key).map(r => r.name) })).filter(x => x.names.length);
  // Every company (or cash) that took the most, so a tie names them all.
  const topAmount = Math.max(...totals.map(t => t.amount));
  const tops = totals.filter(t => t.amount === topAmount).map(t => t.key === 'cash' ? 'cash' : t.label.replace(/^The /, 'the '));
  const topText = tops.length > 1 ? tops.slice(0, -1).join(', ') + ' and ' + tops[tops.length - 1] : tops[0];
  base.slides.push({ key: 'money', kicker: 'Where the money went', lesson: 0,
    headline: placed.length ? esc(`${usdK(all)} placed. The most went to ${topText}.`) : 'No fund was placed.',
    sub: `Every ${unit} read the same forecast and the same five companies.`,
    evidence: `${ofN(rows.filter(r => r.statements).length)} wrote a direction statement before any money moved.`,
    ask: 'Who said where the money would land, and did your money go there?',
    body: { kind: 'money', totals: totals.map(t => ({ ...t, share: t.amount / all })), byPick, tiles: order.map(b => ({ band: b, rows: rows.filter(r => r.band === b) })).filter(x => x.rows.length)
      .map(x => ({ label: B[x.band].label, cls: B[x.band].cls, phrase: B[x.band].phrase, names: x.rows.map(r => r.name) })) } });

  // D1 · the most concentrated fund beside the most spread
  const ranked = placed.map(r => ({ r, max: maxShare(r.allocation), holds: holds(r.allocation) }));
  const conc = ranked.slice().sort((a, b) => b.max - a.max)[0], spread = ranked.slice().sort((a, b) => a.max - b.max || b.holds - a.holds)[0];
  const pair = conc && spread && conc.r !== spread.r ? [conc.r, spread.r] : conc ? [conc.r] : [];
  const card = r => ({ name: r.name, band: B[r.band], pick: pickText(r.statements && r.statements.pick), reason: r.statements ? r.statements.reason : '',
    fund: buckets.filter(b => (r.allocation || {})[b.key] > 0).map(b => `${b.label}: ${usdK(r.allocation[b.key])}`) });
  base.slides.push({ key: 'pair', kicker: 'Concentrated and spread', lesson: 1,
    headline: pair.length > 1 ? 'The most concentrated fund beside the most spread.' : 'One fund to look at.',
    sub: 'Ask why, before anyone mentions what happened.',
    evidence: `${ofN(rows.filter(r => r.statements && r.statements.pick).length)} named who would be paid.`,
    ask: pair.length > 1 ? `${pair[0].name}: why so much in one place? ${pair[1].name}: why spread it?` : 'Why this fund, and not another?',
    body: { kind: 'pair', cards: pair.map(card) } });

  // D2 · what happened: three stages, with values and names
  base.slides.push({ key: 'history', kicker: 'What happened', headline: 'Two years. Four years. Ten years.',
    sub: 'What $1M in each company became.', ask: 'Was the forecast\'s direction right? Was its destination right?',
    body: { kind: 'history', stages: K.stages || [], companies, released: K.released || 0, total: K.stagesTotal || 3, namesHeading: K.namesHeading } });

  // D3 · direction against destination
  const against = rows.filter(r => r.band === 'against');
  base.slides.push({ key: 'statements', kicker: 'Direction and destination', lesson: 2,
    headline: against.length ? esc(`${cap1(word(against.length))} ${against.length === 1 ? unit : units} put the money against their own destination.`) : `Every ${unit}'s money followed its own destination.`,
    sub: 'The direction statements will mostly hold. Read the destinations beside them.',
    evidence: `${ofN(against.length)} put half or more against their own destination statement.`,
    ask: 'What do the direction statements have in common? Now read the destinations.',
    body: { kind: 'statements', rows: rows.filter(r => r.statements).slice(0, 6).map(r => ({ name: r.name, direction: r.statements.direction, pick: pickText(r.statements.pick), reason: r.statements.reason, band: B[r.band] })) } });

  // D4 · what students said
  const cards = [];
  rows.forEach(r => (r.reviews || []).forEach((x, j) => cards.push({ id: `${r.key}-${j}`, name: anon ? (team ? `${r.name} · member ${j + 1}` : r.name) : (team ? `${x.name} · ${r.name}` : r.name), a1: x.a1, a2: x.a2 })));
  base.slides.push({ key: 'said', kicker: 'What students said', headline: cards.length ? 'In their own words, after 2010.' : 'Reviews arrive as students answer.',
    sub: cards.length ? '' : 'Students see the review questions after the 2010 stage.',
    ask: 'Whose answer surprised you?', body: { kind: 'said', questions: K.reviewQuestions || [], cards } });

  // D5 · lessons, each with where this class showed it
  const ev = [];
  base.slides.forEach(s => { if (s.lesson != null) ev[s.lesson] = s.evidence; });
  // The whole fund in the firms in the middle: no cash, every dollar in the five.
  const midOnly = placed.filter(r => !(r.allocation.cash > 0) && companies.every(c => !(r.allocation[c.key] > 0) || ['marketplaces', 'software'].includes(c.category))).length;
  ev[3] = `${ofN(midOnly)} put the whole fund on the firms in the middle.`;
  base.slides.push({ key: 'lessons', kicker: 'What to take from this', headline: 'Four lessons, and where this class showed them.',
    body: { kind: 'lessons', closing: K.closingAsk || '', items: (K.lessons || []).map((l, i) => ({ head: l.head, text: l.text, evidence: ev[i] || '' })) } });
  return base;
}

function bodyHTML(s, ui) {
  const b = s.body;
  const chips = list => `<div class="mn-names">${list.map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
  if (b.kind === 'money') return `<div class="mn-bars">${b.totals.map(t => `<div class="mn-row"><span class="mn-l">${esc(t.label)}</span><div class="mn-bar"><i style="width:${(t.share * 100).toFixed(1)}%"></i></div><span class="mn-v">${usdK(t.amount)}</span></div>`).join('')}</div>
    <div class="md-tiles">${b.tiles.map(t => `<div class="md-tile"><span class="md-band md-b${t.cls}"></span><div class="md-tin"><span class="md-tband md-t${t.cls}">${esc(t.label)}</span><span class="md-tphrase">${esc(t.phrase)}</span>${chips(t.names)}</div></div>`).join('')}</div>`;
  if (b.kind === 'pair') return `<div class="mn-pair">${b.cards.map(c => `<div class="mn-card"><span class="md-tband md-t${c.band.cls}">${esc(c.band.label)}</span><b>${esc(c.name)}</b>
    <small>Destination</small><p>${esc(c.pick)}${c.reason ? ' · ' + esc(c.reason) : ''}</p><small>The fund</small><ul>${c.fund.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>`).join('')}</div>`;
  if (b.kind === 'history') {
    // Only the stages students have seen, so the slide never runs ahead of the class.
    const shown = b.stages.slice(0, b.released), hidden = b.released < b.total;
    if (!shown.length) return `<p class="md-note">Release 2002 from the session bar. Each stage appears here as students see it.</p>`;
    return `<table class="mn-grid"><thead><tr><th>$1M in</th>${shown.map(s2 => `<th>${s2.year}</th>`).join('')}</tr></thead><tbody>${b.companies.map(c => `<tr><td>${esc(c.descriptor)}${hidden ? '' : `<small>${esc(c.name)}</small>`}</td>${shown.map(s2 => `<td>${esc(s2.values[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${hidden ? `<p class="md-note">Students have seen ${b.released} of ${b.total} stages. The names appear here once all three are out.</p>` : ''}`;
  }
  if (b.kind === 'statements') return `<div class="mn-st">${b.rows.map(r => `<div class="mn-s"><b>${esc(r.name)}</b><span class="md-tband md-t${r.band.cls}">${esc(r.band.label)}</span>
    <small>Direction</small><p>${esc(r.direction)}</p><small>Destination · ${esc(r.pick)}</small><p>${esc(r.reason)}</p></div>`).join('')}</div>`;
  if (b.kind === 'said') {
    const cards = b.cards.filter(c => !ui.hidden[c.id]), hiddenN = b.cards.length - cards.length;
    return `<div class="md-said">${cards.map(c => `<div class="md-card"><div class="md-cin"><div class="md-chead"><b>${esc(c.name)}</b><button type="button" class="md-btn md-small" data-md-hide="${esc(c.id)}">Hide</button></div>
      ${c.a1 ? `<small class="mn-q">${esc(b.questions[0] || '')}</small><p class="md-quote">${esc(c.a1)}</p>` : ''}${c.a2 && (ui.allReviews || !c.a1) ? `<small class="mn-q">${esc(b.questions[1] || '')}</small><p class="md-quote">${esc(c.a2)}</p>` : ''}</div></div>`).join('')}</div>
      ${hiddenN ? `<button type="button" class="md-btn md-small" data-md="unhide">Show ${hiddenN} hidden</button>` : ''}`;
  }
  if (b.kind === 'lessons') return `<div class="md-lessons">${b.items.map((l, i) => `<div class="md-lrow"><span class="md-num">${i + 1}</span><div><b class="md-lhead">${esc(l.head)}</b><p>${esc(l.text)}</p></div><div class="md-ev"><small>In this class</small>${esc(l.evidence)}</div></div>`).join('')}</div>`;
  return '';
}

function mount(root, getInput, opts) {
  const P = global.DebriefPlayer || (typeof require === 'function' ? require('../../platform/public/kit/debrief-player.js') : null);
  return P.mount(root, getInput, { ...(opts || {}), model, body: bodyHTML });
}

const MoneyDebrief = { model, mount, bodyHTML };
if (typeof module !== 'undefined' && module.exports) module.exports = MoneyDebrief;
global.MoneyDebrief = MoneyDebrief;
})(typeof window !== 'undefined' ? window : globalThis);
