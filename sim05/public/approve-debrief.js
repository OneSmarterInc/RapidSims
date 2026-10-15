/* Would You Approve This? class debrief (approved Oct 15: D0 to D5). Every slide is written from this session's
   own decisions. The endings, round titles, terms and questions arrive from the server with the faculty session
   (input.kit), so this file names none of them. Slides play in the shared player (kit/debrief-player.js). */
(function (global) {
'use strict';
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const word = n => WORDS[n] || String(n);
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const shipped = d => d === 'approve' || d === 'timeout';

function model(input) {
  const K = input.kit || {}, A = K.aggregate || {}, B = K.bands || {}, order = K.order || [], rounds = K.rounds || [];
  const team = !!input.team, anon = !!input.anonymous;
  const rows = (input.teams || []).filter(t => t.band).map((t, i) => ({ ...t, key: 'card-' + i, name: anon && !team ? `Student ${i + 1}` : t.name }));
  const n = rows.length, unit = team ? 'team' : 'student', units = team ? 'teams' : 'students';
  const base = { ready: !!K.ended && n > 0, submitted: n, total: (input.teams || []).length, unit, units, lessons: K.lessons || [], slides: [] };
  if (!base.ready) return base;
  const counted = rows.filter(r => !r.late), m = counted.length || n;
  const ofN = k => `${k} of ${m} ${m === 1 ? unit : units}`;

  // D0 · the endings at a glance
  const byBand = order.map(b => ({ band: b, rows: rows.filter(r => r.band === b) })).filter(x => x.rows.length);
  base.slides.push({ key: 'glance', kicker: 'Where the class ended', lesson: 0,
    headline: esc(A.headline || `${cap1(word(n))} ${n === 1 ? unit : units} reached an ending.`),
    sub: byBand.length === 1 ? `Every ${unit} reached the same ending.` : `${cap1(word(byBand.length))} endings in one class, from the same five requests.`,
    evidence: `${ofN(A.reached || 0)} ended with Loopwell estimating a change in Dana's health.`,
    ask: 'Nobody set out to find that. Which decision got Loopwell there?',
    body: { kind: 'tiles', tiles: byBand.map(x => ({ label: B[x.band].label, cls: B[x.band].cls, phrase: B[x.band].phrase, names: x.rows.map(r => r.name) })) } });

  // D1 · the round that split the class
  const split = (A.rounds || []).find(r => r.round === A.mostDivided) || null;
  const atLeast3 = counted.filter(r => (r.decisions || []).filter(shipped).length >= 3).length;
  base.slides.push({ key: 'split', kicker: 'Where the class split', lesson: 3,
    headline: esc(A.disagreement || 'No round divided the class.'),
    sub: split ? esc(`Round ${split.round}: ${(rounds[split.round - 1] || {}).title || ''}`) : 'Ask who hesitated longest, and at which round.',
    evidence: `${ofN(atLeast3)} let at least three of the five requests ship.`,
    ask: esc(team && K.teamPrompt ? K.teamPrompt : 'Find one of each. What did you see that the other side did not?'),
    body: { kind: 'split', round: split ? split.round : null, title: split ? (rounds[split.round - 1] || {}).title : '',
      approved: split ? rows.filter(r => r.decisions[split.round - 1] === 'approve').map(r => r.name) : [],
      declined: split ? rows.filter(r => r.decisions[split.round - 1] === 'decline').map(r => r.name) : [],
      timeout: split ? rows.filter(r => r.decisions[split.round - 1] === 'timeout').map(r => r.name) : [] } });

  // D2 · what shipped, round by round
  const R = (A.rounds || []).map(r => ({ ...r, title: (rounds[r.round - 1] || {}).title || '' }));
  const r2 = R[1] || { approve: 0, timeout: 0, title: '' }, r3 = R[2] || { approve: 0, timeout: 0, title: '' };
  base.slides.push({ key: 'rounds', kicker: 'What shipped', lesson: 1,
    headline: 'Five requests. Each one made sense <em>on its own</em>.',
    sub: 'A timeout ships, the same as an approval.',
    evidence: `${r2.title} shipped for ${ofN(r2.approve + r2.timeout)}.`,
    ask: 'Which request needed less data than it asked for?',
    body: { kind: 'rounds', rounds: R, total: m } });

  // D3 · four ideas for what happened
  base.slides.push({ key: 'terms', kicker: 'Name what happened', headline: 'Four ideas for what Loopwell did.',
    ask: 'Which one did you notice while you were deciding?',
    body: { kind: 'terms', items: (K.lessons || []).map(l => ({ head: l.head, text: l.text })) } });

  // D4 · what students said
  const cards = [];
  rows.forEach(r => (r.reviews || []).forEach((x, j) => cards.push({ id: `${r.key}-${j}`, name: anon ? (team ? `${r.name} · member ${j + 1}` : r.name) : (team ? `${x.name} · ${r.name}` : r.name), a1: x.a1, a2: x.a2 })));
  base.slides.push({ key: 'said', kicker: 'What students said', headline: cards.length ? 'In their own words, after the ending.' : 'Reviews arrive as students answer.',
    sub: cards.length ? '' : 'Students see the review questions under their ending.',
    ask: 'Whose answer surprised you?', body: { kind: 'said', questions: K.reviewQuestions || [], cards } });

  // D5 · lessons, each with where this class showed it
  const ev = [];
  base.slides.forEach(s => { if (s.lesson != null) ev[s.lesson] = s.evidence; });
  ev[2] = ev[2] || `${r3.title} shipped for ${ofN(r3.approve + r3.timeout)}.`;
  base.slides.push({ key: 'lessons', kicker: 'What to take from this', headline: 'Four lessons, and where this class showed them.',
    body: { kind: 'lessons', closing: (K.reviewQuestions || [])[1] || '',
      items: (K.lessons || []).map((l, i) => ({ head: l.head, text: l.text, evidence: ev[i] || '' })) } });
  return base;
}

function bodyHTML(s, ui) {
  const b = s.body;
  const chips = list => `<div class="ap-names">${list.map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
  if (b.kind === 'tiles') return `<div class="md-tiles">${b.tiles.map(t => `<div class="md-tile"><span class="md-band md-b${t.cls}"></span><div class="md-tin"><span class="md-tband md-t${t.cls}">${esc(t.label)}</span><span class="md-tphrase">${esc(t.phrase)}</span>${chips(t.names)}</div></div>`).join('')}</div>`;
  if (b.kind === 'split') return b.round ? `<div class="ap-split"><div class="ap-col ap-ok"><span class="ap-h">Approved</span><b>${b.approved.length}</b>${chips(b.approved)}</div><div class="ap-col ap-no"><span class="ap-h">Declined</span><b>${b.declined.length}</b>${chips(b.declined)}</div>${b.timeout.length ? `<div class="ap-col"><span class="ap-h">Clock ran out</span><b>${b.timeout.length}</b>${chips(b.timeout)}</div>` : ''}</div>` : '';
  if (b.kind === 'rounds') return `<div class="ap-rounds">${b.rounds.map(r => { const t = Math.max(1, r.approve + r.decline + r.timeout); return `<div class="ap-row"><span class="ap-rt"><b>${r.round}</b> ${esc(r.title)}</span><div class="ap-bar"><i class="ap-a" style="width:${r.approve / t * 100}%"></i><i class="ap-t" style="width:${r.timeout / t * 100}%"></i><i class="ap-d" style="width:${r.decline / t * 100}%"></i></div><span class="ap-n">${r.approve + r.timeout} shipped · ${r.decline} declined</span></div>`; }).join('')}
    <p class="md-note">Green: approved. Amber: the clock ran out, so it shipped. Grey: declined.</p></div>`;
  if (b.kind === 'terms') return `<div class="md-lessons">${b.items.map((l, i) => `<div class="md-lrow"><span class="md-num">${i + 1}</span><div><b class="md-lhead">${esc(l.head)}</b><p>${esc(l.text)}</p></div></div>`).join('')}</div>`;
  if (b.kind === 'said') {
    const cards = b.cards.filter(c => !ui.hidden[c.id]), hiddenN = b.cards.length - cards.length;
    return `<div class="md-said">${cards.map(c => `<div class="md-card"><div class="md-cin"><div class="md-chead"><b>${esc(c.name)}</b><button type="button" class="md-btn md-small" data-md-hide="${esc(c.id)}">Hide</button></div>
      ${c.a1 ? `<small class="ap-q">${esc(b.questions[0] || '')}</small><p class="md-quote">${esc(c.a1)}</p>` : ''}${c.a2 && (ui.allReviews || !c.a1) ? `<small class="ap-q">${esc(b.questions[1] || '')}</small><p class="md-quote">${esc(c.a2)}</p>` : ''}</div></div>`).join('')}</div>
      ${hiddenN ? `<button type="button" class="md-btn md-small" data-md="unhide">Show ${hiddenN} hidden</button>` : ''}`;
  }
  if (b.kind === 'lessons') return `<div class="md-lessons">${b.items.map((l, i) => `<div class="md-lrow"><span class="md-num">${i + 1}</span><div><b class="md-lhead">${esc(l.head)}</b><p>${esc(l.text)}</p></div><div class="md-ev"><small>In this class</small>${esc(l.evidence)}</div></div>`).join('')}</div>`;
  return '';
}

function mount(root, getInput, opts) {
  const P = global.DebriefPlayer || (typeof require === 'function' ? require('../../platform/public/kit/debrief-player.js') : null);
  return P.mount(root, getInput, { ...(opts || {}), model, body: bodyHTML });
}

const ApproveDebrief = { model, mount, bodyHTML };
if (typeof module !== 'undefined' && module.exports) module.exports = ApproveDebrief;
global.ApproveDebrief = ApproveDebrief;
})(typeof window !== 'undefined' ? window : globalThis);
