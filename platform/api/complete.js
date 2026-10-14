// Only simulation servers can sign v2 completion reports with REPORT_SECRET.
// Launch credentials are never accepted as proof of completed work.
//
// The platform learns that a person finished, roughly how long it took, and
// whatever summary the sim chose to send. It learns nothing about the scenario,
// and the sim keeps no record of the person.
const { sql, id } = require('../lib/db.js');
const { verifyReport } = require('../../shared/report-contract.js');

function body(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  return b || {};
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = body(req);
  const payload = verifyReport(String(b.token || ''), 'complete');
  if (!payload) return res.status(401).json({ error: 'bad_signature' });
  if (!payload.sub || !payload.sim) return res.status(400).json({ error: 'incomplete_token' });

  const s = sql();
  try {
    // Only accept a completion for someone who really launched this sim.
    // Bind the completion to a launch the platform actually issued. Do not
    // trust a stale/null course carried by a resumed simulation run: that
    // stores a valid completion globally but makes it invisible to faculty.
    const known = await s`SELECT id, course_id, as_role FROM launches
          WHERE id = ${payload.launchId} AND user_id = ${payload.sub} AND sim_id = ${payload.sim}
            AND course_id IS NOT DISTINCT FROM ${payload.course || null}`;
    if (!known.length) return res.status(404).json({ error: 'no_matching_launch' });
    const courseId = known[0].course_id || null;

    const dur = payload.duration && Number.isFinite(+payload.duration)
      ? Math.max(0, Math.min(86400, Math.round(+payload.duration))) : null;

    let metrics = null;
    if (payload.metrics && typeof payload.metrics === 'object') {
      // Keep it small — this is a summary, not a transcript.
      const trimmed = {};
      Object.entries(payload.metrics).slice(0, 12).forEach(([k, v]) => {
        trimmed[String(k).slice(0, 60)] = typeof v === 'string' ? v.slice(0, 200) : v;
      });
      metrics = trimmed;
    }

    // Some simulations return a structured summary. String(object) used to turn
    // that into "[object Object]", which meant faculty could see a completion but
    // not the student's actual reflection. Store structured summaries as JSON
    // text while keeping plain-string summaries backward compatible.
    let summary = null;
    if (payload.summary !== undefined && payload.summary !== null) {
      try {
        summary = typeof payload.summary === 'object'
          ? JSON.stringify(payload.summary)
          : String(payload.summary);
      } catch {
        summary = String(payload.summary);
      }
      // A full Midland team summary with two 1,500-character reviews is about 8,000 characters.
      summary = summary.slice(0, 16000);
    }

    await s`INSERT INTO completions (id, user_id, sim_id, course_id, duration_seconds, summary, metrics, report_id, launch_id)
            VALUES (${id('cmp')}, ${payload.sub}, ${payload.sim}, ${courseId},
                    ${dur}, ${summary}, ${metrics ? JSON.stringify(metrics) : null}, ${payload.reportId}, ${known[0].id})
            ON CONFLICT (report_id) DO UPDATE SET summary = EXCLUDED.summary, metrics = EXCLUDED.metrics
            WHERE (CASE WHEN EXCLUDED.metrics->>'revision' ~ '^[0-9]{1,6}$' THEN (EXCLUDED.metrics->>'revision')::int ELSE 0 END)
                > (CASE WHEN completions.metrics->>'revision' ~ '^[0-9]{1,6}$' THEN (completions.metrics->>'revision')::int ELSE 0 END)`;
    // A retry of the same report changes nothing. A later revision of the same
    // run (a team member adding their own review) replaces the summary.

    return res.status(200).json({ ok: true });
  } catch (e) {
    if (e.code === 'NO_SECRET') return res.status(500).json({ error: 'no_secret' });
    if (e.code === 'NO_DB') return res.status(503).json({ error: 'no_db' });
    console.error('completion failure', e.message);
    return res.status(500).json({ error: 'server_error' });
  }
};

