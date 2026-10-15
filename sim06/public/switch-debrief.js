/* Do We Switch? class debrief (approved Oct 15: D0 to D5). Every slide is written from this session's own
   decisions. The bands, reports, map, lessons and questions arrive from the server with the faculty session
   (input.kit), so this file names none of them. Slides play in the shared player (kit/debrief-player.js). */
(function (global) {
'use strict';
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const word = n => WORDS[n] || String(n);
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const avg = list => list.length ? list.reduce((a, r) => a + (Number(r.lost) || 0), 0) / list.length : 0;

function model(input) {
  const K = input.kit || {}, B = K.bands || {}, order = K.order || [], reports = K.reports || [];
  const team = !!input.team, anon = !!input.anonymous;
  const rows = (input.teams || []).filter(t => t.band).map((t, i) => ({ ...t, key: 'card-' + i, name: anon && !team ? `Student ${i + 1}` : t.name }));
  const n = rows.length, unit = team ? 'team' : 'student', units = team ? 'teams' : 'students';
  const base = { ready: !!K.ended && n > 0, submitted: n, total: (input.teams || []).length, unit, units, lessons: K.lessons || [], slides: [] };
  if (!base.ready) return base;
  const ofN = k => `${k} of ${n} ${n === 1 ? unit : units}`;
  const by = b => rows.filter(r => r.band === b);
  const sw = by('switch'), st = by('stay'), none = by('none');

  // D0 · decisions by report
  const byBand = order.map(b => ({ band: b, rows: by(b) })).filter(x => x.rows.length);
  const counts = reports.map(r => ({ n: r.n, switch: sw.filter(x => x.atReport === r.n).length, stay: st.filter(x => x.atReport === r.n).length }));
  const first = sw.length ? Math.min(...sw.map(x => x.atReport)) : null;
  base.slides.push({ key: 'glance', kicker: 'Where the class decided', lesson: 0,
    headline: esc([sw.length ? `${cap1(word(sw.length))} switched.` : 'Nobody switched.', st.length ? `${cap1(word(st.length))} held.` : 'Nobody held.',
      none.length ? `${cap1(word(none.length))} made no decision.` : `Every ${unit} decided.`].join(' ')),
    sub: `The same ${word(reports.length)} reports reached every ${unit} at the same moment.`,
    evidence: first ? `The first switch came at report ${first} of ${reports.length}.` : 'Nobody switched to the backup provider.',
    ask: 'What made the early deciders sure?',
    body: { kind: 'reports', counts, tiles: byBand.map(x => ({ label: B[x.band].label, cls: B[x.band].cls, phrase: B[x.band].phrase, names: x.rows.map(r => r.name) })) } });

  // D1 · the disagreement, in the students' own reasons
  const pick = list => list.filter(r => r.reason).slice(0, 4).map(r => ({ name: r.name, reason: r.reason, at: r.atReport }));
  const split = sw.length && st.length;
  base.slides.push({ key: 'split', kicker: 'Where the class split', lesson: 1,
    headline: split ? 'Same reports. <em>Opposite</em> decisions.' : 'The class decided the same way.',
    sub: split ? 'Each side, in its own words.' : `Every ${unit} that decided went the same way.`,
    evidence: `${ofN(sw.length)} paid for the switch window.`,
    ask: split ? 'Find one of each. What did you see that the other side did not?' : 'Who waited longest, and what were you waiting for?',
    body: { kind: 'split', sw: pick(sw), st: pick(st), none: none.map(r => r.name) } });

  // D2 · the reveal: what sat under both providers
  base.slides.push({ key: 'reveal', kicker: 'What was underneath', headline: esc(`Both providers ran through ${K.hidden || 'one company'}.`),
    sub: esc(K.caption || ''), ask: 'Where in the documents could you have seen it?',
    body: { kind: 'map', map: K.map || { nodes: [], edges: [] } } });

  // D3 · reading before deciding
  const read = rows.filter(r => r.openedBoth).length, min = K.minGroup || 3;
  const share = list => list.length < min ? null : { k: list.filter(r => r.openedBoth).length, n: list.length };
  base.slides.push({ key: 'reading', kicker: 'Reading before deciding', lesson: 2,
    headline: esc(`${cap1(word(read))} of ${word(n)} ${n === 1 ? unit : units} opened both documents first.`),
    sub: `A group smaller than ${min} shows a dash, so no one can be identified.`,
    evidence: `${ofN(read)} opened both documents before deciding.`,
    ask: `Anyone who found ${K.hidden || 'it'} in both: did you believe it, or did the reports win?`,
    body: { kind: 'reading', groups: order.map(b => ({ label: (B[b] || {}).label, cls: (B[b] || {}).cls, v: share(by(b)) })) } });

  // D4 · what students said
  const cards = [];
  rows.forEach(r => (r.reviews || []).forEach((x, j) => cards.push({ id: `${r.key}-${j}`, name: anon ? (team ? `${r.name} · member ${j + 1}` : r.name) : (team ? `${x.name} · ${r.name}` : r.name), a1: x.a1, a2: x.a2 })));
  base.slides.push({ key: 'said', kicker: 'What students said', headline: cards.length ? 'In their own words, after the reveal.' : 'Reviews arrive as students answer.',
    sub: cards.length ? '' : 'Students see the review questions under the reveal.',
    ask: 'Whose answer surprised you?', body: { kind: 'said', questions: K.reviewQuestions || [], cards } });

  // D5 · lessons, each with where this class showed it
  const ev = [];
  base.slides.forEach(s => { if (s.lesson != null) ev[s.lesson] = s.evidence; });
  ev[3] = sw.length && st.length ? `Switching lost ${money(avg(sw))} on average. Holding lost ${money(avg(st))}.`
    : sw.length ? `Switching lost ${money(avg(sw))} on average.` : `Nobody paid for the switch window.`;
  base.slides.push({ key: 'lessons', kicker: 'What to take from this', headline: 'Four lessons, and where this class showed them.',
    body: { kind: 'lessons', closing: (K.reviewQuestions || [])[1] || '',
      items: (K.lessons || []).map((l, i) => ({ head: l.head, text: l.text, evidence: ev[i] || '' })) } });
  return base;
}

function mapSVG(map) {
  const pos = { stores: [260, 34], northline: [135, 124], clearpath: [385, 124], meridian: [260, 214], processor: [260, 304] };
  const W = 230, H = 38;
  const edges = (map.edges || []).filter(([a, b]) => pos[a] && pos[b]).map(([a, b]) => `<line x1="${pos[a][0]}" y1="${pos[a][1] + H / 2}" x2="${pos[b][0]}" y2="${pos[b][1] - H / 2}" class="sw-edge"/>`).join('');
  const nodes = (map.nodes || []).filter(x => pos[x.id]).map(x => { const [cx, cy] = pos[x.id]; return `<g class="${x.fault ? 'sw-fault' : 'sw-node'}"><rect x="${cx - W / 2}" y="${cy - H / 2}" width="${W}" height="${H}" rx="3"/><text x="${cx}" y="${cy + 4}" text-anchor="middle">${esc(x.label)}</text></g>`; }).join('');
  return `<svg class="sw-map" viewBox="0 0 520 330" role="img" aria-label="Both providers connect through one company">${edges}${nodes}</svg>${map.faultNote ? `<p class="md-note">${esc(map.faultNote)}</p>` : ''}`;
}

function bodyHTML(s, ui) {
  const b = s.body;
  const chips = list => `<div class="sw-names">${list.map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
  if (b.kind === 'reports') {
    const max = Math.max(1, ...b.counts.map(c => c.switch + c.stay));
    return `<div class="sw-bars">${b.counts.map(c => `<div class="sw-col"><div class="sw-stack"><i class="sw-s" style="height:${c.switch / max * 100}%"></i><i class="sw-h" style="height:${c.stay / max * 100}%"></i></div><span>${c.n}</span></div>`).join('')}</div>
    <p class="md-note">Each column is one report. Orange: switched at that report. Green: committed to hold.</p>
    <div class="md-tiles">${b.tiles.map(t => `<div class="md-tile"><span class="md-band md-b${t.cls}"></span><div class="md-tin"><span class="md-tband md-t${t.cls}">${esc(t.label)}</span><span class="md-tphrase">${esc(t.phrase)}</span>${chips(t.names)}</div></div>`).join('')}</div>`;
  }
  if (b.kind === 'split') {
    const col = (h, cls, list) => `<div class="sw-colx ${cls}"><span class="sw-h2">${h}</span>${list.length ? list.map(x => `<div class="sw-reason"><b>${esc(x.name)} · report ${x.at}</b><p class="md-quote">${esc(x.reason)}</p></div>`).join('') : '<p class="md-note">Nobody, or no reason given.</p>'}</div>`;
    return `<div class="sw-split">${col('Switched', 'sw-cs', b.sw)}${col('Held', 'sw-ch', b.st)}</div>${b.none.length ? `<p class="md-note">No decision: ${esc(b.none.join(', '))}</p>` : ''}`;
  }
  if (b.kind === 'map') return mapSVG(b.map);
  if (b.kind === 'reading') return `<div class="sw-read">${b.groups.map(g => `<div class="sw-rg"><span class="md-tband md-t${g.cls}">${esc(g.label)}</span><b>${g.v ? `${g.v.k} of ${g.v.n}` : '—'}</b><small>opened both documents first</small></div>`).join('')}</div>`;
  if (b.kind === 'said') {
    const cards = b.cards.filter(c => !ui.hidden[c.id]), hiddenN = b.cards.length - cards.length;
    return `<div class="md-said">${cards.map(c => `<div class="md-card"><div class="md-cin"><div class="md-chead"><b>${esc(c.name)}</b><button type="button" class="md-btn md-small" data-md-hide="${esc(c.id)}">Hide</button></div>
      ${c.a1 ? `<small class="sw-q">${esc(b.questions[0] || '')}</small><p class="md-quote">${esc(c.a1)}</p>` : ''}${c.a2 && (ui.allReviews || !c.a1) ? `<small class="sw-q">${esc(b.questions[1] || '')}</small><p class="md-quote">${esc(c.a2)}</p>` : ''}</div></div>`).join('')}</div>
      ${hiddenN ? `<button type="button" class="md-btn md-small" data-md="unhide">Show ${hiddenN} hidden</button>` : ''}`;
  }
  if (b.kind === 'lessons') return `<div class="md-lessons">${b.items.map((l, i) => `<div class="md-lrow"><span class="md-num">${i + 1}</span><div><b class="md-lhead">${esc(l.head)}</b><p>${esc(l.text)}</p></div><div class="md-ev"><small>In this class</small>${esc(l.evidence)}</div></div>`).join('')}</div>`;
  return '';
}

function mount(root, getInput, opts) {
  const P = global.DebriefPlayer || (typeof require === 'function' ? require('../../platform/public/kit/debrief-player.js') : null);
  return P.mount(root, getInput, { ...(opts || {}), model, body: bodyHTML });
}

const SwitchDebrief = { model, mount, bodyHTML };
if (typeof module !== 'undefined' && module.exports) module.exports = SwitchDebrief;
global.SwitchDebrief = SwitchDebrief;
})(typeof window !== 'undefined' ? window : globalThis);
