/* Why Don't They Have Any Patience? class debrief (approved Oct 16). Every slide is written from this session's own
   students. The bands, what was going on and the lessons arrive from the server with the faculty session (input.kit),
   so this file names none of them. Slides play in the shared player (kit/debrief-player.js). */
(function (global) {
'use strict';
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const word = n => WORDS[n] || String(n);
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const who = k => k ? cap1(word(k)) : 'Nobody';
const RUTH = { closed: 'Stopped volunteering', opened: 'Opened up', guarded: 'Stayed guarded', not_reached: '—' };
const ROW_ORDER = ['intake', 'log', 'vendor', 'review'];
const CALLS = ['keep', 'automate', 'eliminate', 'cannot_assess'];

function model(input) {
  const K = input.kit || {}, B = K.bands || {}, order = K.order || [];
  const anon = !!input.anonymous;
  const rows = (input.students || []).filter(s => s.done && s.report).map((s, i) => ({ ...s, key: 'card-' + i, name: anon ? `Student ${i + 1}` : s.name }));
  const n = rows.length;
  const base = { ready: n > 0, submitted: n, total: (input.students || []).length, unit: 'student', units: 'students', lessons: K.lessons || [], slides: [] };
  if (!base.ready) return base;
  const ofN = k => `${k} of ${n} ${n === 1 ? 'student' : 'students'}`;
  const call = (r, id) => ((r.report.rows || []).find(x => x.rowId === id) || {}).disposition;
  const keepers = rows.filter(r => call(r, 'review') === 'keep'), matched = rows.filter(r => r.band === 'matched');

  // D0 · how the class filed the review desk
  base.slides.push({ key: 'settled', kicker: 'How the class filed the review desk', lesson: 3,
    headline: esc(n === 1 ? (B[rows[0].band] || {}).label + '.' : keepers.length ? `${cap1(word(keepers.length))} of ${word(n)} students kept the review desk.` : 'Nobody kept the review desk.'),
    sub: n === 1 ? 'One report, filed against the same three interviews everyone had.' : 'Everyone had the same three interviews and the same forty-five minutes.',
    evidence: keepers.length ? `${matched.length} of ${keepers.length} who kept the desk had heard why the matching matters.` : 'Nobody kept the desk this time.',
    ask: 'Who kept the review desk, and what did you hear that made you keep it?',
    body: { kind: 'tiles', tiles: order.map(b => ({ band: b, rows: rows.filter(r => r.band === b) })).filter(x => x.rows.length && B[x.band])
      .map(x => ({ label: B[x.band].label, cls: B[x.band].cls, phrase: B[x.band].phrase, names: x.rows.map(r => r.name) })) } });

  // D1 · the interviews: order, and what happened with Ruth
  const closed = rows.filter(r => r.ruth === 'closed'), opened = rows.filter(r => r.ruth === 'opened');
  base.slides.push({ key: 'ruth', kicker: 'The interviews', lesson: 1,
    headline: esc(`${who(opened.length)} opened Ruth up. ${who(closed.length)} closed her.`),
    sub: 'Ruth stays polite after she closes, so most people leave believing she helped.',
    evidence: `${ofN(closed.length)} asked the question that closed Ruth.`,
    ask: closed.length ? 'Read one closing question aloud. Why did it end the conversation?' : 'Which question opened Ruth up?',
    body: { kind: 'ruth', rows: rows.map(r => {
      const t = (r.transcript || []).find(x => x.closed) || (r.transcript || []).find(x => x.opened);
      return { name: r.name, order: (r.order || []).join(' › '), questions: (r.transcript || []).length, ruth: RUTH[r.ruth] || '', line: t ? t.question : '' };
    }) } });

  // D2 · the four steps and the class's calls on each
  const firsts = rows.filter(r => (r.transcript || []).some((x, i, a) => x.kind === 'open-ended' && (i === 0 || a[i - 1].window !== x.window)));
  base.slides.push({ key: 'calls', kicker: 'Four steps, four calls', lesson: 0,
    headline: 'The class’s call on each step.',
    sub: 'Each cell counts the students who made that call.',
    evidence: `${ofN(firsts.length)} opened at least one appointment with an open-ended question, the most expensive kind.`,
    ask: 'Where did the class agree, and where did it split?',
    body: { kind: 'calls', heads: CALLS.map(c => (K.dispositions || {})[c] || c),
      rows: ROW_ORDER.map(id => ({ label: ((K.rows || []).find(x => x.id === id) || {}).label || id, counts: CALLS.map(c => rows.filter(r => call(r, id) === c).length) })) } });

  // D3 · reasoned or lucky: which key answers each student held
  const loop = rows.filter(r => r.evidence && r.evidence.loop);
  base.slides.push({ key: 'evidence', kicker: 'Reasoned or lucky', lesson: 2,
    headline: esc(loop.length ? `${cap1(word(loop.length))} of ${word(n)} ${n === 1 ? 'student' : 'students'} heard both halves of the loop.` : 'Nobody heard both halves of the loop.'),
    sub: 'Senders hear nothing back, and repeat copies arrive days later. Each half came from a different person.',
    evidence: `${ofN(loop.length)} heard both halves.`,
    ask: 'Who heard that nothing goes back to senders? Who heard when the repeat copies arrive?',
    body: { kind: 'evidence', rows: rows.map(r => ({ name: r.name, held: (r.evidence || {}).held || [], loop: !!(r.evidence || {}).loop, band: B[r.band] })) } });

  // D4 · what was going on
  const rv = K.reveal || {};
  base.slides.push({ key: 'reveal', kicker: rv.heading || 'What was going on', headline: 'Repeat copies, and the desk that catches them.', sub: '',
    ask: 'What would you put in the new system first?', body: { kind: 'reveal', paragraphs: rv.paragraphs || [] } });

  // D5 · what students said
  const cards = rows.filter(r => r.reflection1 || r.reflection2).map(r => ({ id: r.key, name: r.name, a1: r.reflection1, a2: r.reflection2 }));
  base.slides.push({ key: 'said', kicker: 'What students said', headline: cards.length ? 'In their own words, after the report.' : 'Reviews arrive as students answer.',
    sub: cards.length ? '' : 'Students see the review questions after they file the report.',
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
  const chips = list => `<div class="pc-names">${list.map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
  if (b.kind === 'tiles') return `<div class="md-tiles">${b.tiles.map(t => `<div class="md-tile"><span class="md-band md-b${t.cls}"></span><div class="md-tin"><span class="md-tband md-t${t.cls}">${esc(t.label)}</span><span class="md-tphrase">${esc(t.phrase)}</span>${chips(t.names)}</div></div>`).join('')}</div>`;
  if (b.kind === 'ruth') return `<table class="pc-grid"><thead><tr><th>Student</th><th>Order</th><th>Questions</th><th>Ruth</th><th>The question</th></tr></thead><tbody>${b.rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.order)}</td><td>${r.questions}</td><td>${esc(r.ruth)}</td><td class="pc-line">${esc(r.line)}</td></tr>`).join('')}</tbody></table>`;
  if (b.kind === 'calls') return `<table class="pc-grid"><thead><tr><th>Step</th>${b.heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr><td>${esc(r.label)}</td>${r.counts.map(c => `<td>${c || ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  if (b.kind === 'evidence') return `<table class="pc-grid"><thead><tr><th>Student</th><th>Key answers heard</th><th>Both halves</th><th>Review desk</th></tr></thead><tbody>${b.rows.map(r => `<tr><td>${esc(r.name)}</td><td class="pc-line">${r.held.length ? r.held.map(esc).join('<br>') : 'None'}</td><td>${r.loop ? 'Yes' : ''}</td><td>${r.band ? `<span class="md-tband md-t${r.band.cls}">${esc(r.band.label)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
  if (b.kind === 'reveal') return `<div class="pc-reveal">${b.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}</div>`;
  if (b.kind === 'said') {
    const cards = b.cards.filter(c => !ui.hidden[c.id]), hiddenN = b.cards.length - cards.length;
    return `<div class="md-said">${cards.map(c => `<div class="md-card"><div class="md-cin"><div class="md-chead"><b>${esc(c.name)}</b><button type="button" class="md-btn md-small" data-md-hide="${esc(c.id)}">Hide</button></div>
      ${c.a1 ? `<small class="pc-q">${esc(b.questions[0] || '')}</small><p class="md-quote">${esc(c.a1)}</p>` : ''}${c.a2 && (ui.allReviews || !c.a1) ? `<small class="pc-q">${esc(b.questions[1] || '')}</small><p class="md-quote">${esc(c.a2)}</p>` : ''}</div></div>`).join('')}</div>
      ${hiddenN ? `<button type="button" class="md-btn md-small" data-md="unhide">Show ${hiddenN} hidden</button>` : ''}`;
  }
  if (b.kind === 'lessons') return `<div class="md-lessons">${b.items.map((l, i) => `<div class="md-lrow"><span class="md-num">${i + 1}</span><div><b class="md-lhead">${esc(l.head)}</b><p>${esc(l.text)}</p></div><div class="md-ev"><small>In this class</small>${esc(l.evidence)}</div></div>`).join('')}</div>`;
  return '';
}

function mount(root, getInput, opts) {
  const P = global.DebriefPlayer || (typeof require === 'function' ? require('../../platform/public/kit/debrief-player.js') : null);
  return P.mount(root, getInput, { ...(opts || {}), model, body: bodyHTML });
}

const PatienceDebrief = { model, mount, bodyHTML };
if (typeof module !== 'undefined' && module.exports) module.exports = PatienceDebrief;
global.PatienceDebrief = PatienceDebrief;
})(typeof window !== 'undefined' ? window : globalThis);
