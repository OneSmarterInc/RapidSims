'use strict';
// GET /api/one-pager?sim=<id>: a sim's faculty one-pager (its own ONE-PAGER.md, via the catalogue snapshot).
// The pages describe the situation and how a session runs; outcomes stay with the sim, so the text is public.
const source = require('../lib/catalogue-source.json');
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const url = new URL(req.url, 'http://x'), id = String((req.query && req.query.sim) || url.searchParams.get('sim') || '');
  const entry = Object.hasOwn(source, id) ? source[id] : null;
  if (!entry || !entry.onePager) return res.status(404).json({ error: 'no_one_pager' });
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({ sim: id, reviewedFor: entry.onePager.reviewedFor, text: entry.onePager.text });
};
