'use strict';
// The faculty helper ("Ask about this sim"), plan approved Oct 17, 2026 (claude/RapidSims-Next-Plans.md).
// Faculty only. It answers from the sim's own faculty material (the one-pager and the faculty session data the sim
// sends its faculty pages) and, when a session is open, that session with students shown as "Student 1, 2, 3".
// Claude Haiku 5.5 through the Anthropic API; the key stays on the server (ANTHROPIC_API_KEY).
const { onePagerFor } = require('./one-pager');

const MODEL = process.env.ASSIST_MODEL || 'claude-haiku-5-5';
// Published Haiku 5.5 prices per million tokens for prompts up to 100,000 tokens (confirm against Anthropic's page).
const PRICE = { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 };
const LIMITS = { trying: 30, adopted: 200 };
const CEILING_USD = Number(process.env.ASSIST_MONTHLY_CEILING_USD || 25);
// The pilot runs on one sim; more join as their material is checked.
const PILOT_SIMS = String(process.env.ASSIST_SIMS || 'rapidsimplus-01').split(',').map(x => x.trim()).filter(Boolean);
const MAX_CONTEXT_CHARS = 240000; // about 60,000 tokens, well under the 100,000-token price step
const MAX_ANSWER_TOKENS = 600;

const enabled = simId => PILOT_SIMS.includes(simId) && !!process.env.ANTHROPIC_API_KEY;

// Students become "Student 1, 2, 3" before anything leaves the platform; the faculty page puts real names back.
function anonymise(state) {
  const names = new Map(), label = name => { if (!names.has(name)) names.set(name, `Student ${names.size + 1}`); return names.get(name); };
  const people = Object.values((state && state.participants) || {});
  for (const p of people) if (p && p.name) label(p.name);
  const swap = v => {
    if (typeof v === 'string') { let out = v; for (const [n, l] of names) if (n) out = out.split(n).join(l); return out; }
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
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !['answer', 'key', 'launch', 'launchId', 'owner', 'joinUrl'].includes(k)).map(([k, x]) => [k, compact(x, depth + 1)]));
  return v;
}

function systemPrompt(sim, page, kit) {
  return [
    `You are the faculty helper for the RapidSims simulation "${sim.title}". You help instructors prepare, rehearse, run and debrief it.`,
    'Answer only about this simulation, its sessions and teaching it. For anything else, say briefly that you can help with this simulation.',
    'Be brief and concrete: at most about 250 words, short paragraphs or a short list. Say what to do or what a screen means.',
    'Students appear as "Student 1", "Student 2" and so on. Use those labels exactly; the instructor sees the real names.',
    'If the material does not settle a question, say so and suggest where on the faculty pages to look.',
    '',
    '## The faculty one-pager',
    page ? page.text : '(not available)',
    '',
    '## Faculty material from the simulation (bands, lessons, debrief notes, what really happened)',
    JSON.stringify(compact(kit || {})).slice(0, 60000)
  ].join('\n');
}

const usd = u => ((u.input_tokens || 0) * PRICE.input + (u.output_tokens || 0) * PRICE.output +
  (u.cache_read_input_tokens || 0) * PRICE.cacheRead + (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite) / 1e6;

// Questions left for this faculty member on this sim this month, and whether the platform is under its ceiling.
async function allowance(s, me, simId) {
  const adopted = (await s`SELECT 1 FROM course_sims cs JOIN courses c ON c.id = cs.course_id
    JOIN enrolments e ON e.course_id = c.id AND e.paid = true
    WHERE cs.sim_id = ${simId} AND c.faculty_id = ${me.id} LIMIT 1`).length > 0;
  const limit = adopted ? LIMITS.adopted : LIMITS.trying;
  const used = Number((await s`SELECT count(*)::int AS n FROM assist_usage
    WHERE user_id = ${me.id} AND sim_id = ${simId} AND created_at >= date_trunc('month', now())`)[0].n);
  const spent = Number((await s`SELECT coalesce(sum(cost_usd), 0)::float AS c FROM assist_usage
    WHERE created_at >= date_trunc('month', now())`)[0].c);
  return { adopted, limit, used, left: Math.max(0, limit - used), spent, paused: spent >= CEILING_USD };
}

async function callModel(system, messages, fetchImpl = fetch) {
  const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_ANSWER_TOKENS,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((d.error && d.error.message) || 'The helper is unavailable.'), { status: 502 });
  return { text: (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim(), usage: d.usage || {} };
}

// One question. sessionState is what the sim returned for faculty_state (or null when no session is open).
async function ask({ s, me, course, sim, question, history, sessionState, fetchImpl, now = new Date() }) {
  const q = String(question || '').trim().slice(0, 1500);
  if (!q) return { status: 400, body: { error: 'question_required' } };
  if (!enabled(sim.id)) return { status: 404, body: { error: 'helper_not_available', message: 'The helper is not available for this simulation yet.' } };
  const a = await allowance(s, me, sim.id);
  if (a.paused) return { status: 429, body: { error: 'helper_paused', message: 'The helper has reached this month’s limit for the platform. It returns at the start of next month.', allowance: a } };
  if (!a.left) return { status: 429, body: { error: 'helper_limit', message: `You have used this month’s ${a.limit} questions for this simulation.${a.adopted ? '' : ' Licensing a class raises the limit to 200.'}`, allowance: a } };
  const page = onePagerFor(sim.id, sim.detail);
  const anon = sessionState ? anonymise(sessionState) : { data: null, names: {} };
  const session = anon.data ? compact({ session: anon.data.session && { state: anon.data.session.state, mode: anon.data.session.mode, practice: anon.data.session.practice },
    participants: anon.data.participants, runs: anon.data.runs }) : null;
  const system = systemPrompt(sim, page, sessionState && compact(anonymise({ participants: sessionState.participants, kit: sessionState.kit }).data.kit));
  const turns = (Array.isArray(history) ? history : []).slice(-4).filter(t => t && typeof t.q === 'string' && typeof t.a === 'string')
    .flatMap(t => [{ role: 'user', content: t.q.slice(0, 1500) }, { role: 'assistant', content: t.a.slice(0, 3000) }]);
  const context = session ? `The open session, students shown as labels:\n${JSON.stringify(session).slice(0, MAX_CONTEXT_CHARS)}\n\n` : 'No session is open on the instructor’s screen.\n\n';
  const out = await callModel(system, [...turns, { role: 'user', content: context + 'Question: ' + q }], fetchImpl);
  const cost = usd(out.usage);
  await s`INSERT INTO assist_usage (user_id, sim_id, course_id, session_code, model, tokens_in, tokens_out, cache_read, cost_usd, question, answer, created_at)
    VALUES (${me.id}, ${sim.id}, ${course ? course.id : null}, ${sessionState && sessionState.session ? sessionState.session.code : null}, ${MODEL},
      ${out.usage.input_tokens || 0}, ${out.usage.output_tokens || 0}, ${out.usage.cache_read_input_tokens || 0}, ${cost}, ${q}, ${out.text}, ${now})`;
  await s`UPDATE assist_usage SET question = NULL, answer = NULL WHERE question IS NOT NULL AND created_at < now() - interval '30 days'`;
  return { status: 200, body: { answer: out.text, names: anon.names, allowance: { ...a, used: a.used + 1, left: Math.max(0, a.left - 1) } } };
}

module.exports = { MODEL, PRICE, LIMITS, CEILING_USD, PILOT_SIMS, enabled, anonymise, compact, allowance, ask, usd };
