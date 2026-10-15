/* Whose Number Is Right? class debrief (approved Oct 15: D0 to D5). Every slide is written from this session's
   own numbers. The definitions, departments, purposes and lessons arrive from the server with the faculty session
   (input.kit), so this file names none of them. Nothing on these slides says whether a number matches its sheet.
   Slides play in the shared player (kit/debrief-player.js). */
(function (global) {
'use strict';
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const word = n => WORDS[n] || String(n);
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const num = x => (x.number == null ? null : Number(x.number));

function model(input) {
  const K = input.kit || {}, S = K.sheets || {}, order = K.assignmentOrder || Object.keys(S);
  const team = !!input.team, anon = !!input.anonymous;
  const all = (input.teams || []);
  const rows = all.map((t, i) => ({ ...t, key: 'card-' + i, name: anon && !team ? `Student ${i + 1}` : t.name }));
  const n = rows.length;
  const base = { ready: !!K.locked && n > 0, submitted: K.locked ? n : rows.filter(r => r.number != null).length, total: n,
    unit: team ? 'team' : 'student', units: team ? 'teams' : 'students', lessons: K.lessons || [], slides: [] };
  if (!base.ready) return base;
  const used = new Set(rows.map(r => r.sheetId));
  // Sheets nobody played appear as labelled examples, computed by the engine, so the class sees all five.
  const examples = order.filter(id => !used.has(id) && S[id]).map(id => ({ key: 'example-' + id, name: 'Example', example: true, sheetId: id, number: S[id].value }));
  const reported = rows.filter(r => num(r) != null);
  const pool = reported.length >= 2 ? reported : [...reported, ...examples];
  const hi = pool.reduce((a, x) => (a && num(a) >= num(x) ? a : x), null), lo = pool.reduce((a, x) => (a && num(a) <= num(x) ? a : x), null);
  const gap = hi && lo ? (num(hi) - num(lo)).toFixed(1) : '0.0';
  const dept = r => (S[r.sheetId] || {}).department || '';

  // D0 · every number, by name, all at once (not grouped by sheet)
  const nums = reported.map(num);
  base.slides.push({ key: 'numbers', kicker: 'The numbers',
    headline: reported.length ? `Same records. ${cap1(word(reported.length))} number${reported.length === 1 ? '' : 's'}, from <em>${Math.min(...nums).toFixed(1)}%</em> to <em>${Math.max(...nums).toFixed(1)}%</em>.` : 'Same records. No number was locked in time.',
    sub: `Every ${base.unit} had the same account records and the same support tickets.${examples.length ? ' Examples show the sheets nobody played.' : ''}`,
    ask: `Every ${base.unit} used the same records. How can the numbers sit this far apart?`,
    body: { kind: 'numbers', items: [...rows, ...examples].map(r => ({ name: r.name, example: !!r.example, number: r.number, confidence: r.confidence })) } });

  // D1 · the two numbers furthest apart: defend them
  base.slides.push({ key: 'defend', kicker: 'Defend your number', lesson: 2,
    headline: hi && lo && hi !== lo ? `${esc(hi.name)} reported <em>${esc(hi.number)}%</em>. ${esc(lo.name)} reported <em>${esc(lo.number)}%</em>.` : 'One number to defend.',
    sub: 'Before anyone explains, each side makes its case.',
    evidence: hi && lo && hi !== lo ? `${hi.name} and ${lo.name} were ${gap} points apart, from the same records.` : 'Every number came from the same records.',
    ask: `${esc(hi ? hi.name : '')}${lo && lo !== hi ? ' and ' + esc(lo.name) : ''}: what did you count as retained?`,
    body: { kind: 'defend', pair: [hi, lo].filter(Boolean).map(r => ({ name: r.name, number: r.number, example: !!r.example })) } });

  // D2 · the definitions, the line that changes, who wrote it and why
  base.slides.push({ key: 'definitions', kicker: 'Where each number came from', lesson: 3,
    headline: `${cap1(word(order.length))} definitions of <em>retained</em>. One line each.`,
    sub: 'Every sheet shares four lines. The highlighted line is the only one that changes.',
    evidence: hi && lo && hi !== lo ? `${dept(hi)}'s definition gave ${hi.number}%. ${dept(lo)}'s gave ${lo.number}%.` : 'Each department wrote the line that suits its job.',
    ask: 'Which department would you trust to write the definition, and why?',
    body: { kind: 'definitions', sheets: order.filter(id => S[id]).map(id => ({ id, department: S[id].department, purpose: S[id].purpose,
      line: (S[id].lines || [])[S[id].contestedIndex] || '', value: S[id].value,
      teams: rows.filter(r => r.sheetId === id).map(r => ({ name: r.name, number: r.number })) })) } });

  // D3 · the worked calculation for any two (the faculty member picks; the furthest pair to start)
  const choices = [...rows.filter(r => r.sheetId), ...examples].map(r => ({ key: r.key, label: r.example ? `Example · ${dept(r)}` : r.name, sheetId: r.sheetId, number: r.number }));
  base.slides.push({ key: 'worked', kicker: 'The calculation', lesson: 1,
    headline: 'Same 40 accounts. The definition decides which ones count.',
    sub: 'Choose any two to compare their worked calculation.',
    evidence: hi && lo && hi !== lo && S[hi.sheetId] && S[lo.sheetId] && hi.sheetId !== lo.sheetId
      ? `From the same 40 accounts, ${dept(hi)}'s definition gives ${S[hi.sheetId].value}%. ${dept(lo)}'s gives ${S[lo.sheetId].value}%.`
      : 'Each definition, worked from the same 40 accounts, gives its own number.',
    ask: 'Which accounts moved between the two calculations?',
    body: { kind: 'worked', choices, first: hi ? hi.key : (choices[0] || {}).key, second: lo ? lo.key : (choices[1] || {}).key,
      sheets: Object.fromEntries(order.filter(id => S[id]).map(id => [id, { department: S[id].department, line: (S[id].lines || [])[S[id].contestedIndex] || '', derivation: S[id].derivation || [] }])) } });

  // D4 · what students said
  const cards = [];
  rows.forEach((r, i) => (r.reviews || []).forEach((x, j) => cards.push({ id: `${r.key}-${j}`, name: anon ? (team ? `${r.name} · member ${j + 1}` : r.name) : (team ? `${x.name} · ${r.name}` : r.name), a1: x.a1, a2: x.a2 })));
  base.slides.push({ key: 'said', kicker: 'What students said', headline: cards.length ? 'In their own words, after the reveal.' : 'Reviews arrive as students answer.',
    sub: cards.length || input.reviewOpen ? '' : 'Press Release review questions in the bar below. Students see the questions within a few seconds.',
    ask: 'Whose answer surprised you?', body: { kind: 'said', questions: K.reviewQuestions || [], cards } });

  // D5 · lessons, each with where this class showed it
  const ev = [];
  base.slides.forEach(s => { if (s.lesson != null) ev[s.lesson] = s.evidence; });
  ev[0] = ev[0] || `Same records, ${word(order.length)} definitions, ${word(new Set([...rows.map(r => r.number), ...examples.map(e => e.number)].filter(Boolean)).size)} numbers.`;
  base.slides.push({ key: 'lessons', kicker: 'What to take from this', headline: 'Four lessons, and where this class showed them.',
    body: { kind: 'lessons', closing: 'Write down a number you are judged by, its definition, and what it leaves out.',
      items: (K.lessons || []).map((l, i) => ({ head: l.head, text: l.text, evidence: ev[i] || '' })) } });
  return base;
}

function bodyHTML(s, ui) {
  const b = s.body;
  if (b.kind === 'numbers') return `<div class="wd-nums">${b.items.map(x => `<div class="wd-num${x.example ? ' wd-ex' : ''}"><span class="wd-name">${esc(x.name)}</span><b>${x.number == null ? 'No number' : esc(x.number) + '%'}</b><small>${x.example ? 'From the engine' : x.confidence ? 'Confidence ' + esc(x.confidence) + '/5' : 'Time ended'}</small></div>`).join('')}</div>`;
  if (b.kind === 'defend') return `<div class="wd-defend">${b.pair.map(x => `<div class="wd-side"><span class="wd-name">${esc(x.name)}</span><b>${esc(x.number)}%</b>${x.example ? '<small>Example</small>' : ''}</div>`).join('<span class="wd-vs">vs</span>')}</div>`;
  if (b.kind === 'definitions') return `<div class="wd-defs">${b.sheets.map(x => `<div class="wd-def"><div class="wd-dhead"><b>${esc(x.department)}</b><span>${esc(x.purpose)}</span></div><p class="wd-line">${esc(x.line)}</p><div class="wd-teams">${x.teams.length ? x.teams.map(t => `<span>${esc(t.name)} · ${t.number == null ? 'no number' : esc(t.number) + '%'}</span>`).join('') : `<span class="wd-ex">Example · ${esc(x.value)}%</span>`}</div></div>`).join('')}</div>`;
  if (b.kind === 'worked') {
    const pick = k => b.choices.find(c => c.key === k) || b.choices[0];
    const a = pick(ui.pick.first || b.first), c = pick(ui.pick.second || b.second);
    const sel = (name, cur) => `<select data-md-pick="${name}" aria-label="Choose ${name === 'first' ? 'the first' : 'the second'} calculation">${b.choices.map(x => `<option value="${esc(x.key)}" ${x.key === cur.key ? 'selected' : ''}>${esc(x.label)}${b.sheets[x.sheetId] && !x.label.startsWith('Example') ? ' · ' + esc(b.sheets[x.sheetId].department) : ''}</option>`).join('')}</select>`;
    const col = (x, name) => { const sh = b.sheets[x.sheetId] || {}; return `<div class="wd-col">${sel(name, x)}<b class="wd-dept">${esc(sh.department || '')}</b><p class="wd-line">${esc(sh.line || '')}</p><ol>${(sh.derivation || []).map(l => `<li>${esc(l)}</li>`).join('')}</ol></div>`; };
    return a && c ? `<div class="wd-worked">${col(a, 'first')}${col(c, 'second')}</div>` : '';
  }
  if (b.kind === 'said') {
    const cards = b.cards.filter(c => !ui.hidden[c.id]), hiddenN = b.cards.length - cards.length;
    return `<div class="md-said">${cards.map(c => `<div class="md-card"><div class="md-cin"><div class="md-chead"><b>${esc(c.name)}</b><button type="button" class="md-btn md-small" data-md-hide="${esc(c.id)}">Hide</button></div>
      ${c.a1 ? `<small class="wd-q">${esc(b.questions[0] || '')}</small><p class="md-quote">${esc(c.a1)}</p>` : ''}${c.a2 && (ui.allReviews || !c.a1) ? `<small class="wd-q">${esc(b.questions[1] || '')}</small><p class="md-quote">${esc(c.a2)}</p>` : ''}</div></div>`).join('')}</div>
      ${hiddenN ? `<button type="button" class="md-btn md-small" data-md="unhide">Show ${hiddenN} hidden</button>` : ''}`;
  }
  if (b.kind === 'lessons') return `<div class="md-lessons">${b.items.map((l, i) => `<div class="md-lrow"><span class="md-num">${i + 1}</span><div><b class="md-lhead">${esc(l.head)}</b><p>${esc(l.text)}</p></div><div class="md-ev"><small>In this class</small>${esc(l.evidence)}</div></div>`).join('')}</div>`;
  return '';
}

function mount(root, getInput, opts) {
  const P = global.DebriefPlayer || (typeof require === 'function' ? require('../../platform/public/kit/debrief-player.js') : null);
  return P.mount(root, getInput, { ...(opts || {}), model, body: bodyHTML });
}

const WhoseDebrief = { model, mount, bodyHTML };
if (typeof module !== 'undefined' && module.exports) module.exports = WhoseDebrief;
global.WhoseDebrief = WhoseDebrief;
})(typeof window !== 'undefined' ? window : globalThis);
