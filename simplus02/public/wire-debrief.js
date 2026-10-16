/* Who Pays for the Wire? class debrief (approved Oct 16). Every slide is written from this session's own teams.
   The seats, terms, play-forward lines, the real proceeding and the lessons arrive from the server with the faculty
   session (input.kit), so this file names none of them. Slides play in the shared player (kit/debrief-player.js). */
(function (global) {
'use strict';
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const word = n => WORDS[n] || String(n);
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
// The order the student outcome uses: households, industry, data centre, utility.
const SEAT_ORDER = ['advocate', 'manufacturers', 'developer', 'utility'];
const UNIT = { top: '%', term: ' yr', exit: ' yr', coll: ' mo', threshold: ' MW' };

function model(input) {
  const K = input.kit || {}, B = K.bands || {}, order = K.order || [], dials = K.dials || {}, seatNames = K.seatNames || {};
  const anon = !!input.anonymous;
  const rows = (input.teams || []).filter(t => t.result).map((t, i) => ({ ...t, key: 'card-' + i, name: anon ? `Team ${i + 1}` : t.name }));
  const n = rows.length;
  const base = { ready: !!K.ended && n > 0, submitted: n, total: (input.teams || []).length, unit: 'team', units: 'teams', lessons: K.lessons || [], slides: [] };
  if (!base.ready) return base;
  const ofN = k => `${k} of ${n} ${n === 1 ? 'team' : 'teams'}`;
  const settledCount = r => r.result.settled.length;
  const termsOf = r => Object.keys(dials).map(d => ({ label: dials[d].short, value: `${r.result.terms[d]}${UNIT[d] || ''}`, imposed: r.result.imposed.includes(d) }));
  const both = rows.filter(r => r.band === 'both').length;

  // D0 · how each team settled
  base.slides.push({ key: 'settled', kicker: 'How each team settled', lesson: 1,
    headline: esc(n === 1 ? (both ? 'The team signed every term.' : `The team signed ${Object.keys(dials).length - rows[0].result.imposed.length} of ${Object.keys(dials).length} terms. The Commission set the rest.`)
      : both ? `${cap1(word(both))} of ${word(n)} teams signed every term.` : 'The Commission set the terms each team left open.'),
    sub: 'Every team had the same four seats, the same five terms and the same deadline.',
    evidence: `${ofN(rows.filter(r => settledCount(r) > 0).length)} signed at least one group of terms.`,
    ask: 'Which term did your team settle first, and what made it possible?',
    body: { kind: 'settled', tiles: order.map(b => ({ band: b, rows: rows.filter(r => r.band === b) })).filter(x => x.rows.length && B[x.band])
      .map(x => ({ label: B[x.band].label, cls: B[x.band].cls, phrase: B[x.band].phrase, names: x.rows.map(r => r.name) })),
      grid: { heads: Object.keys(dials).map(d => dials[d].short), rows: rows.map(r => ({ name: r.name, terms: termsOf(r), freeze: r.result.freezeMonths })) } } });

  // D1 · two contrasting teams: the most settled beside the least
  const ranked = rows.slice().sort((a, b) => settledCount(b) - settledCount(a) || a.result.freezeMonths - b.result.freezeMonths);
  const pair = ranked.length > 1 && ranked[0] !== ranked[ranked.length - 1] ? [ranked[0], ranked[ranked.length - 1]] : ranked.slice(0, 1);
  const card = r => ({ name: r.name, band: B[r.band], terms: termsOf(r), freeze: r.result.freezeMonths,
    seats: (r.seats || []).filter(p => p.seat).map(p => `${seatNames[p.seat] || p.seat}: ${anon ? 'a student' : p.name}`) });
  base.slides.push({ key: 'pair', kicker: pair.length > 1 ? 'Two teams side by side' : 'The team', lesson: 0,
    headline: pair.length > 1 ? 'The most settled team beside the least.' : 'What each seat got.',
    sub: 'Ask which risks each team accepted, before anyone mentions who paid.',
    evidence: `${ofN(rows.filter(r => r.result.terms.top < 85).length)} set take-or-pay below the filed 85%.`,
    ask: pair.length > 1 ? `${pair[0].name}: what did each seat get? ${pair[1].name}: what stopped the signatures?` : 'What did each seat get?',
    body: { kind: 'pair', cards: pair.map(card) } });

  // D2 · those teams played forward, if demand misses and if it arrives
  base.slides.push({ key: 'forward', kicker: 'Who pays', headline: 'The same terms, two futures.',
    sub: 'Nobody could know which would happen. Both are shown.', ask: pair.length > 1 ? 'Which seat carried the risk in each team?' : 'Which seat carried the risk?',
    body: { kind: 'forward', seatNames, tables: pair.map(r => ({ name: r.name, misses: r.playForward.misses, arrives: r.playForward.arrives })) } });

  // D3 · what the deadline did
  const imposed = rows.reduce((s, r) => s + r.result.imposed.length, 0), longest = Math.max(...rows.map(r => r.result.freezeMonths));
  base.slides.push({ key: 'deadline', kicker: 'What the deadline did', lesson: 2,
    headline: esc(imposed ? `The Commission set ${imposed} term${imposed === 1 ? '' : 's'} across the class. The longest freeze added ${longest} months.` : 'Every term was signed before the deadline. No freeze was added.'),
    sub: 'Each term left open went to the Commission, and each one extended the connection freeze.',
    evidence: `${ofN(rows.filter(r => r.result.imposed.length).length)} left at least one term to the Commission.`,
    ask: 'What did the deadline change for your team?',
    body: { kind: 'deadline', rows: rows.map(r => ({ name: r.name, imposed: r.result.imposed.map(d => (dials[d] || {}).short || d), freeze: r.result.freezeMonths })) } });

  // D4 · what actually happened
  const rv = K.reveal || {};
  base.slides.push({ key: 'reveal', kicker: rv.heading || 'What actually happened', lesson: 3,
    headline: 'The real proceeding.', sub: '', evidence: `${ofN(both)} reached a package all four seats signed.`,
    ask: 'What changes when the regulator can approve a package without every party signing?',
    body: { kind: 'reveal', paragraphs: rv.projector || [] } });

  // D5 · what students said
  const cards = [];
  rows.forEach(r => (r.reviews || []).forEach((x, j) => cards.push({ id: `${r.key}-${j}`, name: anon ? `${r.name} · member ${j + 1}` : `${x.name} · ${r.name}`, a1: x.a1, a2: x.a2 })));
  base.slides.push({ key: 'said', kicker: 'What students said', headline: cards.length ? 'In their own words, after the deadline.' : 'Reviews arrive as students answer.',
    sub: cards.length ? '' : 'Students see the review questions after the deadline.',
    ask: 'Whose answer surprised you?', body: { kind: 'said', questions: K.reviewQuestions || [], cards } });

  // D6 · lessons, each with where this class showed it
  const ev = [];
  base.slides.forEach(s => { if (s.lesson != null && s.evidence) ev[s.lesson] = s.evidence; });
  base.slides.push({ key: 'lessons', kicker: 'What to take from this', headline: 'Four lessons, and where this class showed them.',
    body: { kind: 'lessons', closing: (K.reviewQuestions || [])[1] || '', items: (K.lessons || []).map((l, i) => ({ head: l.head, text: l.text, evidence: ev[i] || '' })) } });
  return base;
}

function bodyHTML(s, ui) {
  const b = s.body;
  const chips = list => `<div class="wr-names">${list.map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
  const termRow = t => `<td class="${t.imposed ? 'wr-imposed' : ''}">${esc(t.value)}</td>`;
  if (b.kind === 'settled') return `<div class="md-tiles">${b.tiles.map(t => `<div class="md-tile"><span class="md-band md-b${t.cls}"></span><div class="md-tin"><span class="md-tband md-t${t.cls}">${esc(t.label)}</span><span class="md-tphrase">${esc(t.phrase)}</span>${chips(t.names)}</div></div>`).join('')}</div>
    <table class="wr-grid"><thead><tr><th>Team</th>${b.grid.heads.map(h => `<th>${esc(h)}</th>`).join('')}<th>Freeze</th></tr></thead><tbody>${b.grid.rows.map(r => `<tr><td>${esc(r.name)}</td>${r.terms.map(termRow).join('')}<td>${r.freeze ? r.freeze + ' mo' : ''}</td></tr>`).join('')}</tbody></table>
    <p class="md-note">Shaded terms were set by the Commission.</p>`;
  if (b.kind === 'pair') return `<div class="wr-pair">${b.cards.map(c => `<div class="wr-card"><span class="md-tband md-t${c.band.cls}">${esc(c.band.label)}</span><b>${esc(c.name)}</b>
    <table class="wr-grid wr-small"><tbody>${c.terms.map(t => `<tr><td>${esc(t.label)}</td>${termRow(t)}</tr>`).join('')}<tr><td>Freeze</td><td>${c.freeze ? c.freeze + ' months' : 'None'}</td></tr></tbody></table>
    ${c.seats.length ? `<small>Seats</small><p>${c.seats.map(esc).join('<br>')}</p>` : ''}</div>`).join('')}</div>`;
  if (b.kind === 'forward') return `<div class="wr-pair">${b.tables.map(t => `<div class="wr-card"><b>${esc(t.name)}</b><small>If the forecast demand arrives</small>${SEAT_ORDER.map(k => `<p>${esc(t.arrives[k])}</p>`).join('')}
    <small>If it does not</small>${SEAT_ORDER.map(k => `<p>${esc(t.misses[k])}</p>`).join('')}</div>`).join('')}</div>`;
  if (b.kind === 'deadline') return `<table class="wr-grid"><thead><tr><th>Team</th><th>Set by the Commission</th><th>Freeze added</th></tr></thead><tbody>${b.rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.imposed.length ? esc(r.imposed.join(', ')) : 'Nothing'}</td><td>${r.freeze ? r.freeze + ' months' : 'None'}</td></tr>`).join('')}</tbody></table>`;
  if (b.kind === 'reveal') return `<div class="wr-reveal">${b.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}</div><p class="md-note">The full account and its sources are in Advanced settings and instructor notes.</p>`;
  if (b.kind === 'said') {
    const cards = b.cards.filter(c => !ui.hidden[c.id]), hiddenN = b.cards.length - cards.length;
    return `<div class="md-said">${cards.map(c => `<div class="md-card"><div class="md-cin"><div class="md-chead"><b>${esc(c.name)}</b><button type="button" class="md-btn md-small" data-md-hide="${esc(c.id)}">Hide</button></div>
      ${c.a1 ? `<small class="wr-q">${esc(b.questions[0] || '')}</small><p class="md-quote">${esc(c.a1)}</p>` : ''}${c.a2 && (ui.allReviews || !c.a1) ? `<small class="wr-q">${esc(b.questions[1] || '')}</small><p class="md-quote">${esc(c.a2)}</p>` : ''}</div></div>`).join('')}</div>
      ${hiddenN ? `<button type="button" class="md-btn md-small" data-md="unhide">Show ${hiddenN} hidden</button>` : ''}`;
  }
  if (b.kind === 'lessons') return `<div class="md-lessons">${b.items.map((l, i) => `<div class="md-lrow"><span class="md-num">${i + 1}</span><div><b class="md-lhead">${esc(l.head)}</b><p>${esc(l.text)}</p></div><div class="md-ev"><small>In this class</small>${esc(l.evidence)}</div></div>`).join('')}</div>`;
  return '';
}

function mount(root, getInput, opts) {
  const P = global.DebriefPlayer || (typeof require === 'function' ? require('../../platform/public/kit/debrief-player.js') : null);
  return P.mount(root, getInput, { ...(opts || {}), model, body: bodyHTML });
}

const WireDebrief = { model, mount, bodyHTML };
if (typeof module !== 'undefined' && module.exports) module.exports = WireDebrief;
global.WireDebrief = WireDebrief;
})(typeof window !== 'undefined' ? window : globalThis);
