'use strict';
// The server reports each student's outcome itself, at the deadline (revision 1) and with the review (revision 2).
// This endpoint stays so older pages can still ask; it settles an expired negotiation and reports nothing new.
const { store, keys } = require('../lib/store');
const { body, launchFor, participant } = require('../lib/guard');
const { settleDeadline } = require('./session');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = body(req);
  if (!launchFor(req, b)) return res.status(req.headers['x-launch-token'] || b.launchToken ? 401 : 200).json({ ok: true, reported: false, reason: 'not_platform_launch' });
  if (!store.configured()) return res.status(503).json({ error: 'no_store' });
  const code = String(b.code || '').toUpperCase().trim(), pid = String(b.participantId || '');
  try {
    const sess = await store.get(keys.session(code)), roster = await store.get(keys.roster(code)), me = roster && roster[pid];
    if (!sess || !me || !participant(req, b, sess, me)) return res.status(403).json({ error: 'not_joined' });
    await settleDeadline(code, Date.now());
    const table = me.table ? await store.get(keys.table(code, me.table)) : null;
    if (!table || !table.result) return res.status(409).json({ error: 'not_finished' });
    return res.status(200).json({ ok: true, reported: true });
  } catch (e) {
    console.error('finish failed', e.message);
    return res.status(503).json({ error: 'finish_unavailable' });
  }
};
