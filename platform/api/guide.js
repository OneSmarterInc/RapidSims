'use strict';
// GET /api/guide: the Getting started page for faculty (platform/content/GETTING-STARTED.md). It describes the faculty
// pages only, so it is public, and an invitation email can link straight to it.
const fs = require('node:fs'), path = require('node:path');
const FILE = path.join(__dirname, '..', 'content', 'GETTING-STARTED.md');
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  let text;
  try { text = fs.readFileSync(FILE, 'utf8').trim(); } catch { return res.status(404).json({ error: 'no_guide' }); }
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.status(200).json({ text });
};
