'use strict';
// GET /api/one-pager?sim=<id>[&for=student]: a sim's faculty one-pager (or its student page) (its own ONE-PAGER.md, or an Admin edit for this release).
// The pages describe the situation and how a session runs; outcomes stay with the sim, so the text is public.
const { onePagerFor, studentPageFor } = require('../lib/one-pager');
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const url = new URL(req.url, 'http://x'), id = String((req.query && req.query.sim) || url.searchParams.get('sim') || '');
  // ?for=student: the student page (situation, role, what you'll do, what you hand in), for the student course page.
  if (String((req.query && req.query.for) || url.searchParams.get('for') || '') === 'student') {
    const sp = studentPageFor(id);
    if (!sp) return res.status(404).json({ error: 'no_student_page' });
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json({ sim: id, reviewedFor: sp.reviewedFor, text: sp.text });
  }
  let detail = null;
  try { const { sql } = require('../lib/db.js'); detail = ((await sql()`SELECT detail FROM sims WHERE id = ${id}`)[0] || {}).detail || null; }
  catch { detail = null; } // without the database, the sim's own page still shows
  const page = onePagerFor(id, detail);
  if (!page) return res.status(404).json({ error: 'no_one_pager' });
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.status(200).json({ sim: id, reviewedFor: page.reviewedFor, edited: page.edited, text: page.text });
};
