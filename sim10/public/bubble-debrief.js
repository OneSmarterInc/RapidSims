/* Infrastructure or Bubble? class debrief (approved Oct 15: D0 to D5). Every slide is written from this session's
   own calls. The companies, the reveal, the minority case and the lessons arrive from the server with the faculty
   session (input.kit), so this file names none of them. Slides play in the shared player (kit/debrief-player.js). */
(function (global) {
'use strict';
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const word = n => WORDS[n] || String(n);
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const CALLS = ['infra', 'bubble'];
const TONE = { infra: 'b', bubble: 'v' };

function model(input) {
  const K = input.kit || {}, B = K.bands || {}, order = K.order || [], names = K.callNames || {};
  const team = !!input.team, anon = !!input.anonymous;
  const cases = (K.cases || []).map(c => ({ ...c, ...(K.byCase || {})[c.id] })).filter(c => c.phase === 'closed');
  const rows = (input.teams || []).filter(t => t.band).map((t, i) => ({ ...t, key: 'card-' + i, name: anon && !team ? `Student ${i + 1}` : t.name }));
  const n = rows.length, unit = team ? 'team' : 'student', units = team ? 'teams' : 'students';
  const base = { ready: cases.length > 0 && n > 0, submitted: n, total: (input.teams || []).length, unit, units, lessons: K.lessons || [], slides: [] };
  if (!base.ready) return base;
  const ofN = k => `${k} of ${n} ${n === 1 ? unit : units}`;
  const two = cases.length > 1;
  const callOf = (r, c) => ((r.calls || {})[c.id] || {});
  const recorded = c => rows.map(r => ({ r, x: callOf(r, c) })).filter(o => o.x.status === 'recorded');
  const split = c => { const rec = recorded(c); return { infra: rec.filter(o => o.x.call === 'infra').length, bubble: rec.filter(o => o.x.call === 'bubble').length, none: n - rec.length }; };

  // D0 · the class's calls for each company
  const splits = cases.map(c => ({ label: c.label, ...split(c) }));
  // Name only the calls made (#58): "one infrastructure call", or "seven infrastructure, four bubble".
  const line = s => {
    const made = [['infrastructure', s.infra], ['bubble', s.bubble]].filter(x => x[1] > 0);
    if (!made.length) return 'no calls';
    if (made.length === 1) return `${word(made[0][1])} ${made[0][0]} call${made[0][1] > 1 ? 's' : ''}`;
    return `${word(s.infra)} infrastructure, ${word(s.bubble)} bubble`;
  };
  const differ = two ? rows.filter(r => { const a = callOf(r, cases[0]).call, b = callOf(r, cases[1]).call; return a && b && a !== b; }).length : 0;
  const wrote = recorded(cases[0]).filter(o => (o.x.mind || '').trim().length >= 80).length;
  base.slides.push({ key: 'calls', kicker: 'The calls', lesson: 3,
    headline: esc(two ? splits.map(s => `${s.label}: ${line(s)}.`).join(' ') : `${cap1(line(splits[0]))}.`),
    sub: `Every ${unit} read the same two quarters and made one call${two ? ' on each company' : ''}.`,
    evidence: two ? `${ofN(differ)} called the two companies differently.` : `${ofN(wrote)} wrote what would have changed their mind.`,
    ask: 'Before anyone names the company: what did each side see?',
    body: { kind: 'calls', splits, names, total: n, tiles: order.map(b => ({ band: b, rows: rows.filter(r => r.band === b) })).filter(x => x.rows.length && B[x.band])
      .map(x => ({ label: B[x.band].label, cls: B[x.band].cls, phrase: B[x.band].phrase, names: x.rows.map(r => r.name) })) } });

  // D1 · the same line with opposite calls, one pair per company
  const pairs = cases.map(c => {
    const rec = recorded(c).filter(o => o.x.line), byLine = {};
    rec.forEach(o => { (byLine[o.x.line] ||= { infra: [], bubble: [] })[o.x.call].push(o); });
    const hit = Object.values(byLine).find(g => g.infra.length && g.bubble.length);
    const card = o => ({ name: o.r.name, call: names[o.x.call], tone: TONE[o.x.call], line: o.x.lineLabel || 'None cited', why: o.x.lineWhy, mind: o.x.mind, held: !!o.x.held });
    // No pair (#59): one answer for each call instead.
    const all = recorded(c), one = CALLS.map(k => all.find(o => o.x.call === k)).filter(Boolean);
    return { label: c.label, pair: !!hit, cards: hit ? [hit.infra[0], hit.bubble[0]].map(card) : one.map(card) };
  });
  const anyPair = pairs.some(p => p.pair);
  base.slides.push({ key: 'pairs', kicker: 'Same line, opposite calls', lesson: 0,
    headline: anyPair ? 'The same line, read two ways.' : 'No pair this time. One answer for each call.',
    sub: anyPair ? 'Each pair pointed at the same figure and reached opposite calls.' : 'Compare what each call rested on.',
    evidence: `${ofN(rows.filter(r => cases.some(c => /^hl\./.test(callOf(r, c).line || ''))).length)} cited one of the company's own measures.`,
    ask: anyPair ? 'What does this line tell you that it does not tell your partner?' : 'Which line would have changed your call?',
    body: { kind: 'pairs', pairs } });

  // D2 · when the class agreed, the case for the other call; otherwise the lines cited by call
  const views = cases.map(c => {
    const s = split(c), rec = recorded(c);
    const unanimous = rec.length >= 2 && (!s.infra || !s.bubble) ? (s.infra ? 'infra' : 'bubble') : null;
    const lines = {};
    rec.forEach(o => { if (o.x.line) (lines[o.x.line] ||= { label: o.x.lineLabel, infra: 0, bubble: 0 })[o.x.call]++; });
    return { label: c.label, unanimous, other: unanimous ? (unanimous === 'infra' ? 'bubble' : 'infra') : null,
      minority: unanimous ? (c.minorityCase || {})[unanimous === 'infra' ? 'bubble' : 'infra'] || '' : '',
      lines: Object.values(lines).sort((a, b) => (b.infra + b.bubble) - (a.infra + a.bubble)).slice(0, 6) };
  });
  const agreed = views.filter(v => v.unanimous);
  base.slides.push({ key: 'lines', kicker: agreed.length ? 'The other call' : 'Lines cited, by call', lesson: 1,
    headline: agreed.length ? esc(`Everyone called ${agreed[0].label.toLowerCase()} ${agreed[0].unanimous === 'infra' ? 'infrastructure' : 'a bubble'}. Here is the case for the other call.`) : 'Which lines each call rested on.',
    sub: agreed.length ? 'Read it aloud, then ask who could have made it.' : 'The lines most cited, counted by the call they supported.',
    evidence: `${ofN(rows.filter(r => cases.some(c => /deferred|cash_revenue/.test(callOf(r, c).line || ''))).length)} cited cash paid in advance.`,
    ask: agreed.length ? 'What would you have needed to see to make this call?' : 'Which of these lines would the other side point to?',
    body: { kind: 'lines', views, names } });

  // D3 · the reveal for each company, only as far as students have seen it
  cases.forEach(c => {
    const stage = c.stage || 0, r = c.reveal;
    base.slides.push({ key: 'reveal-' + c.id, kicker: two ? `What happened · ${c.label}` : 'What happened',
      headline: r ? esc(`${c.label} was ${r.identity.name.replace(/\.$/, '')}.`) : esc(`${c.label} is not named yet.`),
      sub: r ? esc(r.identity.period) : 'Show the company from the session bar. Each part appears here as students see it.',
      ask: stage >= 3 ? 'Whose answer to "what would have changed your mind" came closest?' : 'What do you expect the next part to show?',
      body: { kind: 'reveal', stage, reveal: r, after: c.afterNotes || [] } });
  });

  // D4 · what students said
  const cards = [];
  rows.forEach(r => (r.reviews || []).forEach((x, j) => cards.push({ id: `${r.key}-${j}`, name: anon ? (team ? `${r.name} · member ${j + 1}` : r.name) : (team ? `${x.name} · ${r.name}` : r.name), a1: x.a1, a2: x.a2 })));
  base.slides.push({ key: 'said', kicker: 'What students said', headline: cards.length ? 'In their own words, after the outcome.' : 'Reviews arrive as students answer.',
    sub: cards.length ? '' : "Students see the review questions after the last company's outcome.",
    ask: 'Whose answer surprised you?', body: { kind: 'said', questions: K.reviewQuestions || [], cards } });

  // D5 · lessons, each with where this class showed it
  const ev = [];
  base.slides.forEach(s => { if (s.lesson != null && s.evidence) ev[s.lesson] = s.evidence; });
  ev[2] = `${ofN(rows.filter(r => cases.some(c => /growth|acquired/.test(callOf(r, c).line || ''))).length)} cited a growth figure.`;
  base.slides.push({ key: 'lessons', kicker: 'What to take from this', headline: 'Four lessons, and where this class showed them.',
    body: { kind: 'lessons', closing: (K.reviewQuestions || [])[1] || '', items: (K.lessons || []).map((l, i) => ({ head: l.head, text: l.text, evidence: ev[i] || '' })) } });
  return base;
}

function bodyHTML(s, ui) {
  const b = s.body;
  const chips = list => `<div class="bb-names">${list.map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
  if (b.kind === 'calls') return `<div class="bb-splits">${b.splits.map(x => `<div class="bb-split"><b>${esc(x.label)}</b>${CALLS.map(c => `<div class="bb-row"><span class="bb-l">${esc(b.names[c])}</span><div class="bb-bar"><i class="bb-${TONE[c]}" style="width:${(100 * x[c] / Math.max(1, b.total)).toFixed(1)}%"></i></div><span class="bb-v">${x[c]}</span></div>`).join('')}${x.none ? `<p class="md-note">No call: ${x.none}</p>` : ''}</div>`).join('')}</div>
    <div class="md-tiles">${b.tiles.map(t => `<div class="md-tile"><span class="md-band md-b${t.cls}"></span><div class="md-tin"><span class="md-tband md-t${t.cls}">${esc(t.label)}</span><span class="md-tphrase">${esc(t.phrase)}</span>${chips(t.names)}</div></div>`).join('')}</div>`;
  if (b.kind === 'pairs') return `<div class="bb-pairs">${b.pairs.filter(p => p.cards.length || b.pairs.length === 1).map(p => `<div class="bb-pair">${b.pairs.length > 1 ? `<small class="bb-case">${esc(p.label)}</small>` : ''}<div class="bb-cards">${p.cards.map(c => `<div class="bb-card"><span class="md-tband md-t${c.tone}">${esc(c.call)}</span><b>${esc(c.name)}</b>
    <small>Line</small><p>${esc(c.line)}</p>${c.held ? '<p class="md-note">This answer may name the company. It shows here once the company is shown.</p>' : `<small>Why</small><p>${esc(c.why)}</p><small>Would have switched if</small><p>${esc(c.mind)}</p>`}</div>`).join('') || '<p class="md-note">No pair for this company.</p>'}</div></div>`).join('')}</div>`;
  if (b.kind === 'lines') return `<div class="bb-views">${b.views.map(v => `<div class="bb-view">${b.views.length > 1 ? `<small class="bb-case">${esc(v.label)}</small>` : ''}${v.unanimous
    ? `<div class="bb-minority"><span class="md-tband md-t${TONE[v.other]}">The case for ${esc(b.names[v.other])}</span><p>${esc(v.minority)}</p></div>`
    : `<table class="bb-grid"><thead><tr><th>Line</th><th>${esc(b.names.infra)}</th><th>${esc(b.names.bubble)}</th></tr></thead><tbody>${v.lines.map(l => `<tr><td>${esc(l.label)}</td><td>${l.infra}</td><td>${l.bubble}</td></tr>`).join('') || '<tr><td colspan="3">No lines cited.</td></tr>'}</tbody></table>`}</div>`).join('')}</div>`;
  if (b.kind === 'reveal') {
    const r = b.reveal;
    if (!r) return '<p class="md-note">Nothing shown yet.</p>';
    let h = `<p class="bb-asset">${esc(r.identity.asset)}</p>`;
    const quarter = q => esc(String(q).replace(/^.*?(\w{3})\w*\s+(\d{4})$/, '$1 $2'));
    const heads = r.table ? r.table.quarters.map((q, i) => (i < 2 ? '<th class="bb-seen">' : '<th>') + quarter(q) + '</th>').join('') : '';
    if (r.table) h += `<table class="bb-grid bb-q"><thead><tr><th>${esc(r.table.unitNote)}</th>${heads}</tr></thead><tbody>${r.table.rows.slice(0, 7).map(x => `<tr><td>${esc(x.label)}</td>${x.values.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    else h += '<p class="md-note">Show the next four quarters from the session bar.</p>';
    if (r.outcome) h += `<ul class="bb-out">${r.outcome.map(o => `<li>${esc(o.text)}</li>`).join('')}</ul>`;
    else if (r.table) h += '<p class="md-note">Show what happened from the session bar.</p>';
    return h;
  }
  if (b.kind === 'said') {
    const cards = b.cards.filter(c => !ui.hidden[c.id]), hiddenN = b.cards.length - cards.length;
    return `<div class="md-said">${cards.map(c => `<div class="md-card"><div class="md-cin"><div class="md-chead"><b>${esc(c.name)}</b><button type="button" class="md-btn md-small" data-md-hide="${esc(c.id)}">Hide</button></div>
      ${c.a1 ? `<small class="bb-qn">${esc(b.questions[0] || '')}</small><p class="md-quote">${esc(c.a1)}</p>` : ''}${c.a2 && (ui.allReviews || !c.a1) ? `<small class="bb-qn">${esc(b.questions[1] || '')}</small><p class="md-quote">${esc(c.a2)}</p>` : ''}</div></div>`).join('')}</div>
      ${hiddenN ? `<button type="button" class="md-btn md-small" data-md="unhide">Show ${hiddenN} hidden</button>` : ''}`;
  }
  if (b.kind === 'lessons') return `<div class="md-lessons">${b.items.map((l, i) => `<div class="md-lrow"><span class="md-num">${i + 1}</span><div><b class="md-lhead">${esc(l.head)}</b><p>${esc(l.text)}</p></div><div class="md-ev"><small>In this class</small>${esc(l.evidence)}</div></div>`).join('')}</div>`;
  return '';
}

function mount(root, getInput, opts) {
  const P = global.DebriefPlayer || (typeof require === 'function' ? require('../../platform/public/kit/debrief-player.js') : null);
  return P.mount(root, getInput, { ...(opts || {}), model, body: bodyHTML });
}

const BubbleDebrief = { model, mount, bodyHTML };
if (typeof module !== 'undefined' && module.exports) module.exports = BubbleDebrief;
global.BubbleDebrief = BubbleDebrief;
})(typeof window !== 'undefined' ? window : globalThis);
