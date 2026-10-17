'use strict';
// The faculty helper ("Ask about this sim"), plan approved Oct 17, 2026 (claude/RapidSims-Next-Plans.md).
// Faculty only. It answers from the sim's own faculty material (the one-pager and the faculty session data the sim
// sends its faculty pages) and, when a session is open, that session with students shown as "Student 1, 2, 3".
// Claude Haiku 5.5 through the Anthropic API; the key stays on the server (ANTHROPIC_API_KEY).
const { onePagerFor } = require('./one-pager');

const MODEL = process.env.ASSIST_MODEL || 'claude-haiku-5-5';
// Published Haiku 5.5 prices per million tokens for prompts up to 100,000 tokens (confirm against Anthropic's page).
const PRICE = { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 };
// Per faculty member per month: per sim (trying, adopted), and for questions about the class as a whole (general).
const LIMITS = { trying: 30, adopted: 200, general: 30 };
const GENERAL = 'general';
const CEILING_USD = Number(process.env.ASSIST_MONTHLY_CEILING_USD || 25);
// All twelve sims (rolled out Oct 17 after the pilot on rapidsimplus-01). ASSIST_SIMS can narrow the list.
const ALL_SIMS = ['rapid-01-disaster', 'rapid-02-relay', 'rapid-03-midland', 'rapid-04-whose-number', 'rapid-05-approve',
  'rapid-06-switch', 'rapid-07-bought', 'rapid-08-later', 'rapid-09-money-land', 'rapid-10-bubble', 'rapidsimplus-01', 'rapidsimplus-02'];
const PILOT_SIMS = process.env.ASSIST_SIMS ? String(process.env.ASSIST_SIMS).split(',').map(x => x.trim()).filter(Boolean) : ALL_SIMS;
const MAX_CONTEXT_CHARS = 240000; // about 60,000 tokens, well under the 100,000-token price step
// Haiku 5.5 thinks by default and thinking counts toward max_tokens, which cut answers short (Oct 17). The helper
// explains material it is given, so thinking is turned off; the limit leaves room for a full ~250-word answer.
const MAX_ANSWER_TOKENS = 1200;

const enabled = simId => PILOT_SIMS.includes(simId) && !!process.env.ANTHROPIC_API_KEY;

// Students become "Student 1, 2, 3" before anything leaves the platform; the faculty page puts real names back.
function anonymise(state) {
  const names = new Map(), label = name => { if (!names.has(name)) names.set(name, `Student ${names.size + 1}`); return names.get(name); };
  const people = Object.values((state && state.participants) || {});
  for (const p of [...people, ...(Array.isArray(state && state.roster) ? state.roster : [])]) if (p && typeof p.name === 'string' && p.name.trim().length >= 2) label(p.name.trim());
  // Whole names only, matched at word edges, longest first, in one pass ("Ana Lopez" never rewrites "Analysis").
  const esc = n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sorted = [...names.keys()].sort((a, b) => b.length - a.length);
  const re = sorted.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${sorted.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'gu') : null;
  const swap = v => {
    if (typeof v === 'string') return re ? v.replace(re, m => names.get(m)) : v;
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
    return v;
  };
  return { data: swap(state), names: Object.fromEntries([...names].map(([n, l]) => [l, n])) };
}

// Keep the session data small: long text is trimmed, the characters' own answer text is dropped (the questions stay).
function compact(v, depth = 0) {
  if (typeof v === 'string') return v.length > 400 ? v.slice(0, 400) + '…' : v;
  if (Array.isArray(v)) return v.slice(0, 60).map(x => compact(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !['answer', 'key', 'launch', 'launchId', 'owner', 'ownerId', 'ownerKey', 'platformAuth', 'joinUrl', 'you', 'email', 'sub'].includes(k)).map(([k, x]) => [k, compact(x, depth + 1)]));
  return v;
}

// One line per other sim: its title, whether it is in this class, and what it fits (from its one-pager).
function catalogueLines(catalogue, inClass, exceptId) {
  const fits = t => { const m = String(t || '').match(/It (?:fits|sits beside|suits|works)[^.]*\./); return m ? m[0] : ''; };
  const set = new Set(inClass || []);
  const lead = t => (String(t || '').split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#') && !l.startsWith('<!--')) || '');
  return (catalogue || []).filter(c => c.id !== exceptId).map(c => `- ${c.title}${set.has(c.id) ? ' (in this class)' : ''}: ${lead(c.text)} ${fits(c.text)}`.trim()).join('\n');
}

function systemPrompt(sim, page, kit, catalogue, inClass) {
  return [
    `You are the faculty helper for the RapidSims simulation "${sim.title}". You help instructors prepare, rehearse, run and debrief it.`,
    'Answer about this simulation, its sessions and teaching it, and about which RapidSims suit a course (from the list of other RapidSims below). For anything else, say briefly that you can help with RapidSims.',
    'Answer the question in your first sentence. Then add only what the instructor needs to act on it.',
    'Keep it short: at most about 150 words, in two or three short paragraphs or one short list (start list lines with "- ").',
    'Use the words the instructor sees on the faculty pages. Never mention field names, codes, ids or timestamps from the data (for example completedAt, phase, band keys).',
    'Speak to the instructor as "you". Offer a follow-up only when it is clearly useful.',
    'Students appear as "Student 1", "Student 2" and so on. Use those labels exactly; the instructor sees the real names.',
    'If the material does not settle a question, say so and suggest where on the faculty pages to look.',
    'For how RapidSims itself works (classes, the class link, access, the pages), use only the guide below; never guess.',
    '',
    FACULTY_GUIDE,
    '',
    ...(catalogue && catalogue.length ? ['## The other RapidSims (for questions about which sim suits a unit)', catalogueLines(catalogue, inClass, sim.id), ''] : []),
    '## The faculty one-pager',
    page ? page.text : '(not available)',
    '',
    '## Faculty material from the simulation (bands, lessons, debrief notes, what really happened)',
    JSON.stringify(compact(kit || {})).slice(0, 60000)
  ].join('\n');
}

const usd = u => ((u.input_tokens || 0) * PRICE.input + (u.output_tokens || 0) * PRICE.output +
  (u.cache_read_input_tokens || 0) * PRICE.cacheRead + (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite) / 1e6;

// Questions left for this faculty member on this sim (or on general questions) this month, and the platform ceiling.
async function allowance(s, me, simId) {
  const general = simId === GENERAL;
  const adopted = general ? false : (await s`SELECT 1 FROM course_sims cs JOIN courses c ON c.id = cs.course_id
    JOIN enrolments e ON e.course_id = c.id AND e.paid = true
    WHERE cs.sim_id = ${simId} AND c.faculty_id = ${me.id} LIMIT 1`).length > 0;
  const limit = general ? LIMITS.general : adopted ? LIMITS.adopted : LIMITS.trying;
  const used = Number((await s`SELECT count(*)::int AS n FROM assist_usage
    WHERE user_id = ${me.id} AND sim_id = ${simId} AND created_at >= date_trunc('month', now())`)[0].n);
  const spent = Number((await s`SELECT coalesce(sum(cost_usd), 0)::float AS c FROM assist_usage
    WHERE created_at >= date_trunc('month', now())`)[0].c);
  return { adopted, general, limit, used, left: Math.max(0, limit - used), spent, paused: spent >= CEILING_USD };
}

async function callModel(system, messages, fetchImpl = fetch, thinkingOff = true) {
  const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: thinkingOff ? MAX_ANSWER_TOKENS : MAX_ANSWER_TOKENS * 3,
      ...(thinkingOff ? { thinking: { type: 'disabled' } } : {}),
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages })
  });
  const d = await r.json().catch(() => ({}));
  // If the API refuses the thinking setting, ask again with thinking on and more room for it.
  if (!r.ok && thinkingOff && r.status === 400 && /thinking/i.test(JSON.stringify(d))) {
    console.warn('assist: thinking off refused, asking with thinking on', d.error && d.error.message);
    return callModel(system, messages, fetchImpl, false);
  }
  if (!r.ok) throw Object.assign(new Error((d.error && d.error.message) || 'The helper is unavailable.'), { status: 502 });
  let text = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  if (!text || d.stop_reason !== 'end_turn') console.warn('assist: answer', JSON.stringify({ stop: d.stop_reason, blocks: (d.content || []).map(c => c.type), usage: d.usage }));
  if (text && d.stop_reason === 'max_tokens') text += ' …';
  return { text, usage: d.usage || {} };
}

const blocked = (a, what) => a.paused ? { status: 429, body: { error: 'helper_paused', message: 'The helper has reached this month’s limit for the platform. It returns at the start of next month.', allowance: a } }
  : !a.left ? { status: 429, body: { error: 'helper_limit', message: `You have used this month’s ${a.limit} questions ${what}.${a.general || a.adopted ? '' : ' Licensing a class raises the limit to 200.'}`, allowance: a } } : null;
const historyTurns = history => (Array.isArray(history) ? history : []).slice(-4).filter(t => t && typeof t.q === 'string' && typeof t.a === 'string')
  .flatMap(t => [{ role: 'user', content: t.q.slice(0, 1500) }, { role: 'assistant', content: t.a.slice(0, 3000) }]);

// Calls the model, asks once more on an empty answer, records the question and its cost.
async function answer({ s, me, course, usageId, sessionCode, system, messages, q, a, names, fetchImpl, now }) {
  let out = await callModel(system, messages, fetchImpl), cost = usd(out.usage);
  // An empty answer is asked once more; both calls are paid for, so both costs are recorded on the one question.
  if (!out.text) { const again = await callModel(system, messages, fetchImpl); cost += usd(again.usage);
    out = { text: again.text, usage: Object.fromEntries(['input_tokens', 'output_tokens', 'cache_read_input_tokens'].map(k => [k, (out.usage[k] || 0) + (again.usage[k] || 0)])) }; }
  await s`INSERT INTO assist_usage (user_id, sim_id, course_id, session_code, model, tokens_in, tokens_out, cache_read, cost_usd, question, answer, created_at)
    VALUES (${me.id}, ${usageId}, ${course ? course.id : null}, ${sessionCode || null}, ${MODEL},
      ${out.usage.input_tokens || 0}, ${out.usage.output_tokens || 0}, ${out.usage.cache_read_input_tokens || 0}, ${cost}, ${q}, ${out.text}, ${now})`;
  await s`UPDATE assist_usage SET question = NULL, answer = NULL WHERE question IS NOT NULL AND created_at < now() - interval '30 days'`;
  const left = { ...a, used: a.used + 1, left: Math.max(0, a.left - 1) };
  if (!out.text) return { status: 502, body: { error: 'helper_empty', message: 'No answer came back. Please ask again.', allowance: left } };
  return { status: 200, body: { answer: out.text, names, allowance: left } };
}

// One question about a sim. sessionState is what the sim returned for faculty_state (or null when no session is open).
async function ask({ s, me, course, sim, question, history, sessionState, catalogue, inClass, fetchImpl, now = new Date() }) {
  const q = String(question || '').trim().slice(0, 1500);
  if (!q) return { status: 400, body: { error: 'question_required' } };
  if (!enabled(sim.id)) return { status: 404, body: { error: 'helper_not_available', message: 'The helper is not available for this simulation yet.' } };
  const a = await allowance(s, me, sim.id);
  const stop = blocked(a, 'for this simulation'); if (stop) return stop;
  const page = onePagerFor(sim.id, sim.detail);
  const anon = sessionState ? anonymise(sessionState) : { data: null, names: {} };
  // Everything the sim sent its faculty pages except the teaching material (that goes in the cached system prompt).
  const session = anon.data ? compact(Object.fromEntries(Object.entries(anon.data).filter(([k]) => k !== 'kit'))) : null;
  const system = systemPrompt(sim, page, sessionState && compact(anonymise({ participants: sessionState.participants, kit: sessionState.kit }).data.kit), catalogue, inClass);
  const context = session ? `The open session, students shown as labels:\n${JSON.stringify(session).slice(0, MAX_CONTEXT_CHARS)}\n\n` : 'No session is open on the instructor’s screen.\n\n';
  const messages = [...historyTurns(history), { role: 'user', content: context + 'Question: ' + q }];
  return answer({ s, me, course, usageId: sim.id, sessionCode: sessionState && sessionState.session ? sessionState.session.code : null,
    system, messages, q, a, names: anon.names, fetchImpl, now });
}

// How the faculty section works, for questions asked outside a sim's own pages.
const FACULTY_GUIDE = [
  'The faculty section of RapidSims:',
  '- Your classes: the list of classes. Each class has a title, a term and the number of students expected (a forecast, not a limit).',
  '- Class home: the class link students use to join (one link covers every simulation in the class, so nobody joins twice), the students and their access, and the simulations in the class. Simulations can be added to a class there.',
  '- How students get in: each student opens the class link once; the class then sits on their own page. When you start a session for a simulation, students open that simulation from their own page and join the open session by themselves. They need no separate session link.',
  '- Student access: on Class home, in the Students section, give a student access once their registration is settled. Payment happens outside RapidSims, so the instructor turns access on. A student without access can see what is coming but cannot open anything.',
  '- Each simulation in the class has four pages in the left menu: Sessions (start a session when the class is ready; students join the open session by themselves from their own page), Past sessions (every session’s results, newest first), Rehearse (play as practice students before class, worth doing once before teaching with it) and Play it yourself (opens in a new tab, as a student sees it).',
  '- During a session: Students, Results and Debrief tabs. The debrief runs from the instructor’s screen.',
  '- Every faculty page has Ask Claude. On a simulation’s pages it answers about that simulation with its teaching material and the open session.'
].join('\n');

function generalPrompt(courseInfo, catalogue) {
  const inClass = new Set((courseInfo && courseInfo.sims || []).map(x => x.id));
  return [
    'You are the faculty helper for RapidSims, short business-school decision simulations. You help instructors choose simulations, set up their classes and find their way around the faculty pages.',
    'Answer only about RapidSims, its simulations and teaching with them. For anything else, say briefly that you can help with RapidSims.',
    'Answer the question in your first sentence. Then add only what the instructor needs to act on it.',
    'Keep it short: at most about 150 words, in two or three short paragraphs or one short list (start list lines with "- ").',
    'Use the words the instructor sees on the faculty pages. Never mention field names, codes or ids.',
    'For detailed questions about one simulation (a student’s result, the debrief, what really happens), suggest opening that simulation’s Sessions page and asking there.',
    'Never reveal how a simulation turns out; describe each one as its one-pager does.',
    '',
    FACULTY_GUIDE,
    '',
    '## The RapidSims catalogue (one-pagers)',
    ...catalogue.map(c => `### ${c.title}${inClass.has(c.id) ? ' (in this class)' : ''}\n${inClass.has(c.id) ? c.text : c.text.split('\n## ')[0]}`)
  ].join('\n');
}

// One question about the class or RapidSims in general (Class home, Your classes and the class-wide pages).
// courseInfo: { title, term, students, withAccess, sims: [{ id, title }] } or null. catalogue: [{ id, title, text }].
async function askGeneral({ s, me, course, courseInfo, catalogue, question, history, fetchImpl, now = new Date() }) {
  const q = String(question || '').trim().slice(0, 1500);
  if (!q) return { status: 400, body: { error: 'question_required' } };
  if (!process.env.ANTHROPIC_API_KEY) return { status: 404, body: { error: 'helper_not_available', message: 'The helper is not available yet.' } };
  const a = await allowance(s, me, GENERAL);
  const stop = blocked(a, 'about your classes'); if (stop) return stop;
  const system = generalPrompt(courseInfo, catalogue);
  const context = courseInfo ? `The class on the instructor’s screen: ${JSON.stringify({ title: courseInfo.title, term: courseInfo.term, students: courseInfo.students,
    studentsWithAccess: courseInfo.withAccess, simulations: (courseInfo.sims || []).map(x => x.title) })}\n\n` : 'The instructor is on their list of classes.\n\n';
  const messages = [...historyTurns(history), { role: 'user', content: context + 'Question: ' + q }];
  return answer({ s, me, course, usageId: GENERAL, sessionCode: null, system, messages, q, a, names: {}, fetchImpl, now });
}

module.exports = { catalogueLines, ALL_SIMS, GENERAL, FACULTY_GUIDE, MODEL, PRICE, LIMITS, CEILING_USD, PILOT_SIMS, enabled, anonymise, compact, allowance, ask, askGeneral, generalPrompt, usd };
