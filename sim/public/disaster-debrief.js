/* Disaster or Breach class debrief (approved canvas D0 to D7). Each headline is written from the session's own positions.
   The resolution, the band names and the fork outcomes arrive from the server with the faculty session (input.kit),
   so this file names none of them. Slides play in the shared player (kit/debrief-player.js). */
(function (global) {
'use strict';
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const word = n => WORDS[n] || String(n);
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const names = list => list.length <= 1 ? (list[0] || '') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
const ofN = (k, n) => n === 1 ? (k ? 'The student' : 'Nobody') : k === n ? (n === 2 ? 'Both students' : `All ${word(n)}`) : `${cap1(word(k))} of ${word(n)}`;

function model(input) {
  const K = input.kit || {};
  const all = (input.students || []);
  const done = all.filter(s => s.done && Array.isArray(s.positions) && s.positions.length === 3 && s.band);
  const anon = !!input.anonymous;
  const rows = done.map((s, i) => ({ ...s, key: 'card-' + i, name: anon ? `Student ${i + 1}` : s.name }));
  const n = rows.length;
  const base = { ready: n > 0, submitted: n, total: all.length, unit: 'student', units: 'students', lessons: K.lessons || [], slides: [] };
  if (!n) return base;
  const Q = K.lessonQuestions || [], B = K.bands || {}, order = K.order || [], RL = K.readingLabels || {}, AL = K.actionLabels || {}, IRR = K.irreversible || {};
  const early = r => r.positions.slice(0, 2).some(p => p && IRR[p.action]);
  const byBand = order.map(b => ({ band: b, rows: rows.filter(r => r.band === b) })).filter(x => x.rows.length);
  const finalBoth = rows.filter(r => r.positions[2].reading === 'both');
  const kept = rows.filter(r => !early(r)), acted = rows.filter(early);

  // D0 · the class at a glance
  const readyBoth = rows.filter(r => r.band === order[0]);
  base.slides.push({ key: 'glance', kicker: 'The class at a glance',
    headline: byBand.length === 1 ? `Same incident call. Same four advisers. ${n === 1 ? 'One ending' : 'Every student reached the same ending'}: <em>${esc(B[byBand[0].band].label)}</em>.`
      : `Same incident call. Same four advisers. <em>${cap1(word(byBand.length))} different endings.</em>`,
    sub: `${cap1(word(n))} student${n === 1 ? '' : 's'} ran the same incident. ${readyBoth.length ? `${ofN(readyBoth.length, n)} kept every option open and ${readyBoth.length === 1 ? 'named' : 'named'} both causes on Day 3.` : 'Nobody kept every option open and named both causes on Day 3.'}`,
    ask: 'You all heard the same four people. What made you trust one of them?',
    body: { kind: 'tiles', tiles: byBand.map(x => ({ band: x.band, label: B[x.band].label, cls: B[x.band].cls, phrase: B[x.band].phrase, names: x.rows.map(r => r.name) })) } });

  // D1 · what actually happened
  base.slides.push({ key: 'both', kicker: 'What actually happened', headline: (K.resolution || {}).headline || '', sub: esc((K.resolution || {}).text || ''),
    ask: 'Kate was right. Why was acting on her answer still a mistake?',
    body: { kind: 'fork', fork: K.fork || {}, kept: kept.map(r => r.name), acted: acted.map(r => r.name) } });

  // D2 · question 1: whose answer did you trust
  const h4 = id => rows.filter(r => r.positions[0].reading === id);
  const hw = h4('hardware'), bo = h4('both');
  base.slides.push({ key: 'q1', kicker: `Question 1 of 4 · ${Q[0] || ''}`, lesson: 0,
    headline: hw.length ? `At Hour 4, ${ofN(hw.length, n).toLowerCase()} took <em class="hw">Kate's reading: ${esc(RL.hardware || 'hardware').toLowerCase()}</em>.` : `At Hour 4, nobody took Kate's reading.`,
    sub: esc(bo.length ? `Only ${names(bo.map(r => r.name))} named ${esc(RL.both || 'both').toLowerCase()} at Hour 4.` : `Nobody named ${(RL.both || 'both').toLowerCase()} at Hour 4.`) + (h4('breach').length ? '' : ' Nobody chose intrusion, though Priya raised it in the first five minutes.'),
    evidence: `${ofN(hw.length, n)} took Kate's reading at Hour 4.`,
    ask: 'Which adviser did you discount because of what they stood to lose?',
    body: { kind: 'readings', rows: ['hardware', 'both', 'unknown', 'breach'].map(id => ({ id, label: RL[id] || id, names: h4(id).map(r => r.name) })), n } });

  // D3 · question 2: moves you could not undo
  const actedText = acted.map(r => {
    const i = r.positions.findIndex((p, k) => k < 2 && IRR[p.action]);
    return `${r.name} ${i === 0 ? 'at Hour 4' : 'at Hour 20'} (${(AL[r.positions[i].action] || '').toLowerCase()})`;
  });
  base.slides.push({ key: 'q2', kicker: `Question 2 of 4 · ${Q[1] || ''}`, lesson: 1,
    headline: acted.length ? `${ofN(acted.length, n)} did something they <em class="no">could not undo</em> before Day 3.` : 'Every student kept every option open until Day 3.',
    sub: esc(acted.length ? `${names(actedText)}. Each move closed a door the Day 3 audit needed open.` : 'Nothing anyone did before the audit closed a door.'),
    evidence: acted.length ? `${ofN(acted.length, n)} made an irreversible move before Day 3.` : 'Nobody made an irreversible move before Day 3.',
    ask: 'Four hours of outage bought the images. Who would you have had to convince to spend them?',
    body: { kind: 'moves', phases: K.phases || [], rows: [...acted, ...kept].map(r => ({ name: r.name, cells: r.positions.map((p, k) => ({ label: AL[p.action] || p.action, irr: !!IRR[p.action], day3: k === 2 })) })) } });

  // D4 · question 3: when did you change your mind
  const movedAt = r => { const k = r.positions.findIndex(p => p.reading === 'both'); return k; };
  const moved = rows.filter(r => movedAt(r) > 0), atH20 = moved.filter(r => movedAt(r) === 1), atD3 = moved.filter(r => movedAt(r) === 2);
  base.slides.push({ key: 'q3', kicker: `Question 3 of 4 · ${Q[2] || ''}`, lesson: 2,
    headline: moved.length ? `${cap1(word(moved.length))} student${moved.length === 1 ? '' : 's'} moved to <em class="bo">${esc(RL.both || 'both').toLowerCase()}</em>.${atD3.length ? ` ${atD3.length === moved.length ? (moved.length === 1 ? 'They' : 'All of them') : cap1(word(atD3.length)) + ' of them'} waited for the Day 3 audit.` : ''}`
      : `Nobody changed their reading to ${esc(RL.both || 'both').toLowerCase()} during the incident.`,
    sub: esc([atH20.length ? `${names(atH20.map(r => r.name))} moved at Hour 20, when corruption crossed to a second array with no shared hardware.` : '',
      atD3.length ? `${names(atD3.map(r => r.name))} moved only when the modified backup jobs turned up.` : ''].filter(Boolean).join(' ')),
    evidence: atH20.length ? `${names(atH20.map(r => r.name))} moved to both at Hour 20.` : 'Nobody moved to both at Hour 20, when the second array failed.',
    ask: 'At Hour 20, what did the second array tell you that Kate’s explanation could not?',
    body: { kind: 'track', phases: K.phases || [], rows: rows.slice().sort((a, b) => (movedAt(a) < 1 ? 9 : movedAt(a)) - (movedAt(b) < 1 ? 9 : movedAt(b))).map(r => ({ name: r.name,
      cells: r.positions.map(p => ({ id: p.reading, label: RL[p.reading] || p.reading })),
      when: movedAt(r) === 0 ? 'From Hour 4' : movedAt(r) === 1 ? (K.phases || [])[1] || 'Hour 20' : movedAt(r) === 2 ? (K.phases || [])[2] || 'Day 3' : r.positions[2].reading === 'unknown' ? 'Never named a cause' : `Stayed with ${(RL[r.positions[2].reading] || '').toLowerCase()}` })) } });

  // D5 · question 4: what the silence was hiding
  const cov = k => rows.filter(r => (r.coverageEarnedAt === null || r.coverageEarnedAt === undefined ? 3 : r.coverageEarnedAt) === k);
  const first = cov(0);
  base.slides.push({ key: 'q4', kicker: `Question 4 of 4 · ${Q[3] || ''}`, lesson: 3,
    headline: first.length ? `${first.length === 1 ? 'Only ' + esc(first[0].name) : cap1(word(first.length)) + ' students'} got Sophia’s <em>coverage gap</em> at Hour 4${first.length === 1 && first[0].coveragePrivate ? ', and asked in private' : ''}.`
      : 'Nobody got Sophia’s <em>coverage gap</em> at Hour 4.',
    sub: esc(K.coverage || ''),
    evidence: `${first.length ? names(first.map(r => r.name)) : 'Nobody'} got it at Hour 4. ${cov(3).length ? `${cap1(word(cov(3).length))} never got it.` : ''}`.trim(),
    ask: 'Why might Sophia say it to one person in private, but not on the open call?',
    body: { kind: 'silence', cols: [0, 1, 2, 3].map(k => ({ k, label: k === 3 ? 'Never' : (K.phases || [])[k] || '', names: cov(k).map(r => r.name) })) } });

  // D6 · what students said
  const said = rows.filter(r => r.reflection1 || r.reflection2);
  base.slides.push({ key: 'said', kicker: 'What students said', headline: said.length ? 'In their own words, after the reveal.' : 'Reviews arrive as students finish.',
    ask: 'Whose answer surprised you?', body: { kind: 'said', questions: K.reviewQuestions || [], cards: said.map(r => ({ id: r.key, name: r.name, band: r.band, label: B[r.band].label, cls: B[r.band].cls, a1: r.reflection1, a2: r.reflection2 })) } });

  // D7 · lessons
  const ev = base.slides.filter(s => s.lesson != null).map(s => s.evidence);
  base.slides.push({ key: 'lessons', kicker: 'What to take from this', headline: 'Four lessons, and where this class showed them.',
    body: { kind: 'lessons', items: (K.lessons || []).map((l, i) => ({ head: l.head, text: l.text, evidence: ev[i] || '' })) } });
  return base;
}

function bodyHTML(s, ui) {
  const b = s.body;
  const chips = list => `<div class="dd-names">${list.map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
  if (b.kind === 'tiles') return `<div class="md-tiles">${b.tiles.map(t => `<div class="md-tile"><span class="md-band md-b${t.cls}"></span><div class="md-tin"><span class="md-tband md-t${t.cls}">${esc(t.label)}</span><span class="md-tphrase">${esc(t.phrase)}</span>${chips(t.names)}</div></div>`).join('')}</div>`;
  if (b.kind === 'fork') {
    const f = b.fork || {}, cell = (txt, cls) => `<div class="dd-cell ${cls}">${esc(txt || '')}</div>`;
    return `<div class="dd-fork"><span></span><span class="dd-h">If it had been hardware only</span><span class="dd-h dd-hb">What happened</span>
      <div class="dd-row"><b>Kept options open</b><small>No irreversible move before Day 3</small>${chips(b.kept)}</div>${cell(f.reversible && f.reversible.hardware, 'dd-dim')}${cell(f.reversible && f.reversible.both, 'dd-good')}
      <div class="dd-row"><b>Acted early</b><small>An irreversible move before Day 3</small>${chips(b.acted)}</div>${cell(f.irreversible && f.irreversible.hardware, 'dd-dim')}${cell(f.irreversible && f.irreversible.both, 'dd-bad')}</div>`;
  }
  if (b.kind === 'readings') return `<div class="dd-bars">${b.rows.map(r => `<div class="dd-bar"><span class="dd-lab dd-r-${r.id}">${esc(r.label)}</span><div class="dd-track">${r.names.length ? `<div class="dd-fill dd-f-${r.id}" style="width:${Math.max(18, r.names.length / b.n * 100)}%">${esc(r.names.join(' · '))}</div>` : ''}</div><span class="dd-n dd-r-${r.id}">${r.names.length}</span></div>`).join('')}</div>`;
  if (b.kind === 'moves') return `<div class="dd-grid"><span></span>${b.phases.map(p => `<span class="dd-h">${esc(p)}</span>`).join('')}${b.rows.map(r => `<b class="dd-nm">${esc(r.name)}</b>${r.cells.map(c => `<span class="dd-mv ${c.irr ? (c.day3 ? 'dd-late' : 'dd-irr') : 'dd-ok'}">${esc(c.label)}</span>`).join('')}`).join('')}</div>
    <p class="md-note">Teal outline: a move you can undo. Rose: cannot be undone, before Day 3. Grey: cannot be undone, made on Day 3 with the audit in hand.</p>`;
  if (b.kind === 'track') return `<div class="dd-grid dd-grid5"><span></span>${b.phases.map(p => `<span class="dd-h">${esc(p)}</span>`).join('')}<span class="dd-h">Moved to both</span>${b.rows.map(r => `<b class="dd-nm">${esc(r.name)}</b>${r.cells.map(c => `<span class="dd-rd dd-f-${c.id}">${esc(c.label)}</span>`).join('')}<span class="dd-when">${esc(r.when)}</span>`).join('')}</div>`;
  if (b.kind === 'silence') return `<div class="dd-cols">${b.cols.map((c, i) => `<div class="dd-col dd-c${i}"><span class="dd-h">${esc(c.label)}</span><b>${c.names.length}</b>${chips(c.names)}</div>`).join('')}</div>
    <div class="dd-worked"><span class="dd-h">The question that worked</span><em>“Where would you not have seen it?”</em><small>not “How’s your coverage?”</small></div>`;
  if (b.kind === 'said') {
    const cards = b.cards.filter(c => !ui.hidden[c.id]);
    const hiddenN = b.cards.length - cards.length;
    return `<div class="md-said">${cards.map(c => `<div class="md-card"><div class="md-cin"><div class="md-chead"><b>${esc(c.name)}</b><span class="md-chip md-${c.cls}">${esc(c.label)}</span><button type="button" class="md-btn md-small" data-md-hide="${esc(c.id)}">Hide</button></div>
      ${c.a1 ? `<small class="dd-q">${esc(b.questions[0] || '')}</small><p class="md-quote">${esc(c.a1)}</p>` : ''}${c.a2 && (ui.allReviews || !c.a1) ? `<small class="dd-q">${esc(b.questions[1] || '')}</small><p class="md-quote">${esc(c.a2)}</p>` : ''}</div></div>`).join('')}</div>
      ${hiddenN ? `<button type="button" class="md-btn md-small" data-md="unhide">Show ${hiddenN} hidden</button>` : ''}`;
  }
  if (b.kind === 'lessons') return `<div class="md-lessons">${b.items.map((l, i) => `<div class="md-lrow"><span class="md-num">${i + 1}</span><div><b class="md-lhead">${esc(l.head)}</b><p>${esc(l.text)}</p></div><div class="md-ev"><small>In this class</small>${esc(l.evidence)}</div></div>`).join('')}</div>`;
  return '';
}

function mount(root, getInput, opts) {
  const P = global.DebriefPlayer || (typeof require === 'function' ? require('../../platform/public/kit/debrief-player.js') : null);
  return P.mount(root, getInput, { ...(opts || {}), model, body: bodyHTML });
}

const DisasterDebrief = { model, mount, bodyHTML };
if (typeof module !== 'undefined' && module.exports) module.exports = DisasterDebrief;
global.DisasterDebrief = DisasterDebrief;
})(typeof window !== 'undefined' ? window : globalThis);
