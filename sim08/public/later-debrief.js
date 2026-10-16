/* Eighteen Months Later class debrief (approved Oct 15: D0 to D5). Every slide is written from this session's own
   choices. The vendors, questions, warnings, plans, outcomes and lessons arrive from the server with the faculty
   session (input.kit), so this file names none of them. Slides play in the shared player (kit/debrief-player.js). */
(function (global) {
'use strict';
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const word = n => WORDS[n] || String(n);
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const RANK = { adopted: 0, lucky: 1, knew: 1, shadow: 2 };
const HEAD = { adopted: 'adopted the system.', lucky: 'funded the right plan without finding the risk.', knew: 'found the risk and funded the wrong plan.', shadow: 'ended with a shadow system.' };

function model(input) {
  const K = input.kit || {}, B = K.bands || {}, order = K.order || [], vendors = K.vendors || [], questions = K.questions || [], plans = K.plans || [];
  const team = !!input.team, anon = !!input.anonymous;
  const rows = (input.teams || []).filter(t => t.band).map((t, i) => ({ ...t, key: 'card-' + i, name: anon && !team ? `Student ${i + 1}` : t.name }));
  const n = rows.length, unit = team ? 'team' : 'student', units = team ? 'teams' : 'students';
  const base = { ready: !!K.ended && n > 0, submitted: n, total: (input.teams || []).length, unit, units, lessons: K.lessons || [], slides: [] };
  if (!base.ready) return base;
  const counted = rows.filter(r => !r.late), m = counted.length || n;
  const ofN = k => `${k} of ${m} ${m === 1 ? unit : units}`;
  const has = k => (m === 1 || k === 1 ? 'has' : 'have');
  const vname = k => (vendors.find(v => v.key === k) || {}).name || '';
  const by = b => rows.filter(r => r.band === b);

  // D0 · eighteen months on
  const tiles = order.map(b => ({ band: b, rows: by(b) })).filter(x => x.rows.length);
  const adopted = by('adopted').length, shadow = by('shadow').length;
  base.slides.push({ key: 'glance', kicker: 'Eighteen months on', lesson: 1,
    // One line per outcome this class reached.
    headline: esc(tiles.map(x => `${cap1(word(x.rows.length))} ${HEAD[x.band]}`).join(' ')),
    sub: tiles.length === 1 ? `Every ${unit} landed in the same place.` : `${cap1(word(tiles.length))} different outcomes from the same three vendors.`,
    evidence: (k => `${ofN(k)} ${has(k)} something running beside the new system.`)(counted.filter(r => r.band !== 'adopted').length),
    ask: 'Where did the work go that the new system did not do?',
    body: { kind: 'tiles', tiles: tiles.map(x => ({ label: B[x.band].label, cls: B[x.band].cls, phrase: B[x.band].phrase,
      names: x.rows.map(r => `${r.name} · ${vname(r.vendor)}`) })) } });

  // D1 · same vendor, different place
  let pair = null;
  for (const v of vendors.map(x => x.key)) {
    const mine = rows.filter(r => r.vendor === v);
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
      const a = mine[i], b = mine[j];
      if (a.band === b.band) continue;
      const gap = Math.abs(RANK[a.band] - RANK[b.band]);
      if (!pair || gap > pair.gap) pair = { gap, vendor: v, a, b };
    }
  }
  const fill = (t, o) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => o[k] ?? '');
  const card = r => ({ name: r.name, band: r.band, label: B[r.band].label, cls: B[r.band].cls, found: r.found, boardChose: r.boardChose,
    questions: (r.questionIds || []).map(id => { const q = questions.find(x => x.id === id) || {}; return { text: q.text || id, route: (q.routes || {})[r.vendor] || null }; }),
    plan: (plans.find(p => p.key === r.plan) || {}).text || 'None funded' });
  const matched = counted.filter(r => (plans.find(p => p.key === r.plan) || { matches: [] }).matches.includes(r.vendor)).length;
  // With no pair, the two most different outcomes stand side by side (or the one, in a class of one).
  const spread = counted.slice().sort((a, b) => RANK[a.band] - RANK[b.band]);
  const fallback = spread.length > 1 ? [spread[0], spread[spread.length - 1]] : spread.slice(0, 1);
  base.slides.push({ key: 'split', kicker: 'Same vendor, different place', lesson: 3,
    headline: pair ? esc(`${pair.a.name} and ${pair.b.name} both bought ${vname(pair.vendor)}.`) : `Nobody who chose the same vendor landed differently.`,
    sub: pair ? 'They ended up in different places.' : fallback.length > 1 ? `Here are the two ${units} who landed furthest apart.` : `Here is how this ${unit} got there.`,
    evidence: `${ofN(matched)} funded the go-live plan that fitted their vendor.`,
    ask: pair ? 'Before anything else, what did one of you know that the other didn\'t?' : 'Who came closest to asking the question that mattered, and what stopped them?',
    body: { kind: 'pair', cards: (pair ? [pair.a, pair.b] : fallback).map(card) } });

  // D2 · the questions the class spent, with the warnings marked
  const asked = questions.map(q => ({ text: q.text, n: counted.filter(r => (r.questionIds || []).includes(q.id)).length,
    warns: vendors.filter(v => q.routes && q.routes[v.key]).map(v => ({ name: v.name, kind: q.routes[v.key] })) }));
  const found = counted.filter(r => r.found).length;
  base.slides.push({ key: 'questions', kicker: 'Where the warnings were', lesson: 2,
    headline: esc(`${cap1(word(found))} of ${word(m)} ${m === 1 ? unit : units} found their vendor's risk before choosing.`),
    sub: 'Each question went to all three vendors. The marks show where a vendor gave something away.',
    evidence: `${ofN(found)} found their vendor's risk before choosing.`,
    ask: 'Which question did you skip because it felt less like diligence?',
    body: { kind: 'questions', rows: asked.filter(r => r.n || r.warns.length), quiet: asked.filter(r => !r.n && !r.warns.length).length, total: m } });

  // D3 · go-live plans against the vendor chosen
  const grid = vendors.map(v => ({ name: v.name, cells: plans.map(p => ({ n: counted.filter(r => r.vendor === v.key && r.plan === p.key).length, fit: (p.matches || []).includes(v.key) })),
    none: counted.filter(r => r.vendor === v.key && !r.plan).length }));
  const funded = counted.filter(r => r.plan).length;
  base.slides.push({ key: 'plans', kicker: 'The go-live plans', lesson: 0,
    headline: 'Every vendor needed a different plan.', sub: 'A bordered cell marks the plan that fitted that vendor.',
    evidence: `${ofN(funded)} funded a go-live plan beyond the quote.`,
    ask: 'Which plan did your quote leave out?',
    body: { kind: 'plans', plans: plans.map((p, i) => ({ n: i + 1, text: p.text })), grid } });

  // D4 · what students said
  const cards = [];
  rows.forEach(r => (r.reviews || []).forEach((x, j) => cards.push({ id: `${r.key}-${j}`, name: anon ? (team ? `${r.name} · member ${j + 1}` : r.name) : (team ? `${x.name} · ${r.name}` : r.name), a1: x.a1, a2: x.a2 })));
  base.slides.push({ key: 'said', kicker: 'What students said', headline: cards.length ? 'In their own words, after the report.' : 'Reviews arrive as students answer.',
    sub: cards.length ? '' : 'Students see the review questions under their report.',
    ask: 'Whose answer surprised you?', body: { kind: 'said', questions: K.reviewQuestions || [], cards } });

  // D5 · lessons, each with where this class showed it
  const ev = [];
  base.slides.forEach(s => { if (s.lesson != null) ev[s.lesson] = s.evidence; });
  base.slides.push({ key: 'lessons', kicker: 'What to take from this', headline: 'Four lessons, and where this class showed them.',
    body: { kind: 'lessons', closing: K.closingAsk || (K.reviewQuestions || [])[1] || '',
      items: (K.lessons || []).map((l, i) => ({ head: l.head, text: l.text, evidence: ev[i] || '' })) } });
  return base;
}

function bodyHTML(s, ui) {
  const b = s.body;
  const chips = list => `<div class="lt-names">${list.map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
  if (b.kind === 'tiles') return `<div class="md-tiles">${b.tiles.map(t => `<div class="md-tile"><span class="md-band md-b${t.cls}"></span><div class="md-tin"><span class="md-tband md-t${t.cls}">${esc(t.label)}</span><span class="md-tphrase">${esc(t.phrase)}</span>${chips(t.names)}</div></div>`).join('')}</div>`;
  if (b.kind === 'pair') return b.cards.length ? `<div class="lt-pair">${b.cards.map(c => `<div class="lt-card"><span class="md-tband md-t${c.cls}">${esc(c.label)}</span><b>${esc(c.name)}</b>
    <small>Questions spent</small><ol>${c.questions.map(q => `<li>${esc(q.text)}${q.route ? ` <em class="lt-w">${q.route === 'direct' ? 'warning' : 'partial'}</em>` : ''}</li>`).join('') || '<li>None</li>'}</ol>
    <small>Go-live plan</small><p>${esc(c.plan)}</p></div>`).join('')}</div>` : '';
  if (b.kind === 'questions') return `<div class="lt-qs">${b.rows.map(r => `<div class="lt-q${r.warns.length ? ' lt-qw' : ''}"><span class="lt-n">${r.n}</span><span class="lt-qt">${esc(r.text)}</span><span class="lt-qv">${r.warns.map(w => `<i class="${w.kind === 'direct' ? 'lt-d' : 'lt-p'}">${esc(w.name)}</i>`).join('')}</span></div>`).join('')}</div>
    ${b.quiet ? `<p class="md-note">${cap1(word(b.quiet))} other question${b.quiet === 1 ? '' : 's'}, nobody asked.</p>` : ''}<p class="md-note">The number shows how many asked it. A solid mark: that vendor's answer gave its risk away. An outlined mark: half of it.</p>`;
  if (b.kind === 'plans') return `<table class="lt-grid"><thead><tr><th>Vendor</th>${b.plans.map(p => `<th>Plan ${p.n}</th>`).join('')}<th>None</th></tr></thead><tbody>${b.grid.map(g => `<tr><td>${esc(g.name)}</td>${g.cells.map(c => `<td class="${c.fit ? 'lt-fit' : ''}">${c.n}</td>`).join('')}<td>${g.none}</td></tr>`).join('')}</tbody></table>
    <ol class="lt-plans">${b.plans.map(p => `<li>${esc(p.text)}</li>`).join('')}</ol>`;
  if (b.kind === 'said') {
    const cards = b.cards.filter(c => !ui.hidden[c.id]), hiddenN = b.cards.length - cards.length;
    return `<div class="md-said">${cards.map(c => `<div class="md-card"><div class="md-cin"><div class="md-chead"><b>${esc(c.name)}</b><button type="button" class="md-btn md-small" data-md-hide="${esc(c.id)}">Hide</button></div>
      ${c.a1 ? `<small class="lt-rq">${esc(b.questions[0] || '')}</small><p class="md-quote">${esc(c.a1)}</p>` : ''}${c.a2 && (ui.allReviews || !c.a1) ? `<small class="lt-rq">${esc(b.questions[1] || '')}</small><p class="md-quote">${esc(c.a2)}</p>` : ''}</div></div>`).join('')}</div>
      ${hiddenN ? `<button type="button" class="md-btn md-small" data-md="unhide">Show ${hiddenN} hidden</button>` : ''}`;
  }
  if (b.kind === 'lessons') return `<div class="md-lessons">${b.items.map((l, i) => `<div class="md-lrow"><span class="md-num">${i + 1}</span><div><b class="md-lhead">${esc(l.head)}</b><p>${esc(l.text)}</p></div><div class="md-ev"><small>In this class</small>${esc(l.evidence)}</div></div>`).join('')}</div>`;
  return '';
}

function mount(root, getInput, opts) {
  const P = global.DebriefPlayer || (typeof require === 'function' ? require('../../platform/public/kit/debrief-player.js') : null);
  return P.mount(root, getInput, { ...(opts || {}), model, body: bodyHTML });
}

const LaterDebrief = { model, mount, bodyHTML };
if (typeof module !== 'undefined' && module.exports) module.exports = LaterDebrief;
global.LaterDebrief = LaterDebrief;
})(typeof window !== 'undefined' ? window : globalThis);
