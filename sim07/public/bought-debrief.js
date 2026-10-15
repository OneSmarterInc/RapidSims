/* Would You Have Bought It? class debrief (approved Oct 15: D0 to D5). Every slide is written from this session's
   own decisions. The bands, stages, names, lessons and questions arrive from the server with the faculty session
   (input.kit), so this file names none of them. Slides play in the shared player (kit/debrief-player.js). */
(function (global) {
'use strict';
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const word = n => WORDS[n] || String(n);
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const words = s => String(s || '').trim().split(/\s+/).filter(Boolean).length;

function model(input) {
  const K = input.kit || {}, B = K.bands || {}, order = K.order || [];
  const team = !!input.team, anon = !!input.anonymous;
  const rows = (input.teams || []).filter(t => t.band).map((t, i) => ({ ...t, key: 'card-' + i, name: anon && !team ? `Student ${i + 1}` : t.name }));
  const n = rows.length, unit = team ? 'team' : 'student', units = team ? 'teams' : 'students';
  const base = { ready: !!K.ended && n > 0, submitted: n, total: (input.teams || []).length, unit, units, lessons: K.lessons || [], slides: [] };
  if (!base.ready) return base;
  const ofN = k => `${k} of ${n} ${n === 1 ? unit : units}`;
  const by = b => rows.filter(r => r.band === b);
  const bought = by('bought'), declined = by('declined'), lapsed = by('lapsed');

  // Every reason, one per student, labelled for the side-by-side picker.
  let k = 0;
  const reasons = [];
  rows.forEach(r => (r.reasons || []).forEach(x => { if (x.choice && x.text) reasons.push({ key: 'r' + (k++), who: anon ? (team ? `${r.name} · member` : r.name) : (team ? `${x.name} · ${r.name}` : r.name), choice: x.choice, lapsed: x.lapsed, text: x.text, recognised: x.recognised }); }));
  const longest = list => list.slice().sort((a, b) => words(b.text) - words(a.text))[0] || null;
  const buyers = reasons.filter(x => x.choice === 'buy'), decliners = reasons.filter(x => x.choice === 'decline' && !x.lapsed);

  // D0 · how the class decided
  base.slides.push({ key: 'glance', kicker: 'How the class decided', lesson: 2,
    headline: esc([bought.length ? `${cap1(word(bought.length))} bought.` : 'Nobody bought.', declined.length ? `${cap1(word(declined.length))} declined.` : 'Nobody declined.',
      lapsed.length ? `${cap1(word(lapsed.length))} let the offer lapse.` : ''].filter(Boolean).join(' ')),
    sub: `Every ${unit} read the same briefing and the same four advisers.`,
    evidence: `${ofN(declined.length + lapsed.length)} declined or let the offer lapse.`,
    ask: bought.length ? 'Who bought? What did you see?' : 'Nobody bought. What would have made you buy?',
    body: { kind: 'tiles', tiles: order.map(b => ({ band: b, rows: by(b) })).filter(x => x.rows.length)
      .map(x => ({ label: B[x.band].label, cls: B[x.band].cls, phrase: B[x.band].phrase, names: x.rows.map(r => r.name) })) } });

  // D1 · two reasons side by side, one bought and one declined, chosen by the instructor
  base.slides.push({ key: 'pair', kicker: 'Two reasons, side by side', lesson: 1,
    headline: buyers.length && decliners.length ? 'Same evidence. <em>Opposite</em> calls.' : 'The class reasoned one way.',
    sub: buyers.length && decliners.length ? 'Both were written in 2000, before any of the stages.' : 'Every reason was written in 2000, before any of the stages.',
    evidence: `${ofN(rows.filter(r => (r.reasons || []).some(x => words(x.text) >= 8)).length)} wrote a full reason before the clock closed.`,
    ask: buyers.length && decliners.length ? 'Someone who declined: answer the buyer.' : buyers.length ? 'Make the case for the other side. What would someone who declined have said?' : 'Make the case for the other side. What would a buyer have said?',
    body: { kind: 'pair', buyers, decliners, suggest: [longest(buyers), longest(decliners)] } });

  // D2 · what happened next: the three stages, with the names
  base.slides.push({ key: 'stages', kicker: 'What happened next', headline: 'Two years. Five years. Ten years.',
    sub: 'Read each reason again at each date.', ask: 'At which date did your own reason start to look different?',
    body: { kind: 'stages', stages: K.stages || [] } });

  // D3 · recognition against the choice
  const recs = (K.recognitionOptions || []).map(([v, label]) => ({ v, label, buy: reasons.filter(x => x.recognised === v && x.choice === 'buy').length, decline: reasons.filter(x => x.recognised === v && x.choice === 'decline').length }));
  const knew = reasons.filter(x => x.recognised === 'yes');
  base.slides.push({ key: 'recognition', kicker: 'Did knowing change the choice?', lesson: 0,
    headline: knew.length ? esc(`${cap1(word(knew.length))} said they recognised the companies.`) : 'Nobody said they recognised the companies.',
    sub: 'Students answered after they decided, before any of the stages.',
    evidence: knew.length ? `Of those who recognised them, ${knew.filter(x => x.choice === 'buy').length} bought and ${knew.filter(x => x.choice === 'decline').length} declined.` : 'Nobody recognised the companies, so every call came from the briefing.',
    ask: 'If you recognised them, did you decide on the briefing or on what you remembered?',
    body: { kind: 'recognition', rows: recs } });

  // D4 · what students said
  const cards = [];
  rows.forEach(r => (r.reviews || []).forEach((x, j) => cards.push({ id: `${r.key}-${j}`, name: anon ? (team ? `${r.name} · member ${j + 1}` : r.name) : (team ? `${x.name} · ${r.name}` : r.name), a1: x.a1, a2: x.a2 })));
  base.slides.push({ key: 'said', kicker: 'What students said', headline: cards.length ? 'In their own words, after 2010.' : 'Reviews arrive as students answer.',
    sub: cards.length ? '' : 'Students see the review questions after the 2010 stage.',
    ask: 'Whose answer surprised you?', body: { kind: 'said', questions: K.reviewQuestions || [], cards } });

  // D5 · lessons, each with where this class showed it
  const ev = [];
  base.slides.forEach(s => { if (s.lesson != null) ev[s.lesson] = s.evidence; });
  ev[3] = bought.length ? `${ofN(bought.length)} paid for the option.` : 'Nobody paid for the option.';
  base.slides.push({ key: 'lessons', kicker: 'What to take from this', headline: 'Four lessons, and where this class showed them.',
    body: { kind: 'lessons', closing: (K.reviewQuestions || [])[1] || '',
      items: (K.lessons || []).map((l, i) => ({ head: l.head, text: l.text, evidence: ev[i] || '' })) } });
  return base;
}

function bodyHTML(s, ui) {
  const b = s.body;
  const chips = list => `<div class="bt-names">${list.map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
  if (b.kind === 'tiles') return `<div class="md-tiles">${b.tiles.map(t => `<div class="md-tile"><span class="md-band md-b${t.cls}"></span><div class="md-tin"><span class="md-tband md-t${t.cls}">${esc(t.label)}</span><span class="md-tphrase">${esc(t.phrase)}</span>${chips(t.names)}</div></div>`).join('')}</div>`;
  if (b.kind === 'pair') {
    const side = (name, list, fallback, title) => {
      if (!list.length) return `<div class="bt-memo"><span class="bt-h">${title}</span><p class="md-note">Nobody ${title.toLowerCase()}.</p></div>`;
      const cur = list.find(x => x.key === ui.pick[name]) || fallback || list[0];
      return `<div class="bt-memo"><span class="bt-h">${title}</span><select data-md-pick="${name}" aria-label="Choose the reason that ${title.toLowerCase()}">${list.map(x => `<option value="${esc(x.key)}" ${x.key === cur.key ? 'selected' : ''}>${esc(x.who)}</option>`).join('')}</select><p class="bt-quote">${esc(cur.text)}</p></div>`;
    };
    return `<div class="bt-pair">${side('bought', b.buyers, b.suggest[0], 'Bought')}${side('declined', b.decliners, b.suggest[1], 'Declined')}</div><p class="md-note">The longest reason on each side shows first. Choose any other from the list.</p>`;
  }
  if (b.kind === 'stages') return `<div class="bt-stages">${b.stages.map(st => `<div class="bt-stage"><span class="bt-year">${esc(st.year)}</span><b>${esc(st.title)}</b>${st.body.map(p => `<p>${esc(p)}</p>`).join('')}${st.names ? `<p class="bt-names-line">${esc(st.names)}</p>` : ''}</div>`).join('')}</div>`;
  if (b.kind === 'recognition') return `<table class="bt-table"><thead><tr><th>Recognised the companies?</th><th>Bought</th><th>Declined</th></tr></thead><tbody>${b.rows.map(r => `<tr><td>${esc(r.label)}</td><td>${r.buy}</td><td>${r.decline}</td></tr>`).join('')}</tbody></table>`;
  if (b.kind === 'said') {
    const cards = b.cards.filter(c => !ui.hidden[c.id]), hiddenN = b.cards.length - cards.length;
    return `<div class="md-said">${cards.map(c => `<div class="md-card"><div class="md-cin"><div class="md-chead"><b>${esc(c.name)}</b><button type="button" class="md-btn md-small" data-md-hide="${esc(c.id)}">Hide</button></div>
      ${c.a1 ? `<small class="bt-q">${esc(b.questions[0] || '')}</small><p class="md-quote">${esc(c.a1)}</p>` : ''}${c.a2 && (ui.allReviews || !c.a1) ? `<small class="bt-q">${esc(b.questions[1] || '')}</small><p class="md-quote">${esc(c.a2)}</p>` : ''}</div></div>`).join('')}</div>
      ${hiddenN ? `<button type="button" class="md-btn md-small" data-md="unhide">Show ${hiddenN} hidden</button>` : ''}`;
  }
  if (b.kind === 'lessons') return `<div class="md-lessons">${b.items.map((l, i) => `<div class="md-lrow"><span class="md-num">${i + 1}</span><div><b class="md-lhead">${esc(l.head)}</b><p>${esc(l.text)}</p></div><div class="md-ev"><small>In this class</small>${esc(l.evidence)}</div></div>`).join('')}</div>`;
  return '';
}

function mount(root, getInput, opts) {
  const P = global.DebriefPlayer || (typeof require === 'function' ? require('../../platform/public/kit/debrief-player.js') : null);
  return P.mount(root, getInput, { ...(opts || {}), model, body: bodyHTML });
}

const BoughtDebrief = { model, mount, bodyHTML };
if (typeof module !== 'undefined' && module.exports) module.exports = BoughtDebrief;
global.BoughtDebrief = BoughtDebrief;
})(typeof window !== 'undefined' ? window : globalThis);
