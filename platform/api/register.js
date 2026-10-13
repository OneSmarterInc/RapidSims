'use strict';
const { sql } = require('../lib/db');
const { verify } = require('../lib/launch');
const { jsonDetail, launchUrl } = require('../lib/metadata');
const clip = (v, n) => v == null ? null : String(v).slice(0, n);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  const p = verify(String(b?.token || ''));
  if (!p) return res.status(401).json({ error: 'bad_signature' });
  if (p.kind !== 'register' || typeof p.sim !== 'string' || !p.sim || p.sim.length > 200) return res.status(400).json({ error: 'not_a_registration' });
  try {
    const address = launchUrl(p.launchUrl);
    if (p.protocolVersion !== undefined && p.protocolVersion !== 2) return res.status(400).json({error:'unsupported_protocol_version'});
    const incoming = { ...(p.detail || {}) };
    // Deployments cannot claim administrative ownership or approve capabilities.
    for (const key of Object.keys(incoming)) if (key.startsWith('_')) delete incoming[key];
    incoming._registered = true;
    if (p.protocolVersion === 2) incoming._protocolVersion = 2;
    const revision = clip(p.catalogueRevision, 120);
    if (revision) incoming._source_revision = revision;
    jsonDetail(incoming);
    const minutes = Number.isFinite(+p.minutes) ? Math.max(1, Math.min(600, Math.round(+p.minutes))) : null;
    const result = await sql().transaction(async tx => {
      await tx.query('LOCK TABLE sims IN SHARE ROW EXCLUSIVE MODE');
      const existing = (await tx`SELECT * FROM sims WHERE id = ${p.sim}`)[0];
      if (!existing) {
        const taken = (await tx`SELECT number FROM sims WHERE number IS NOT NULL`).map(r => r.number);
        let number = Number.isSafeInteger(+p.number) && +p.number > 0 && !taken.includes(+p.number) ? +p.number : 1;
        while (taken.includes(number)) number++;
        await tx`INSERT INTO sims(id, number, title, tagline, description, minutes, launch_url, published, detail)
          VALUES (${p.sim}, ${number}, ${clip(p.title, 200) || p.sim}, ${clip(p.tagline, 300)},
          ${clip(p.description, 4000)}, ${minutes}, ${address}, false, ${jsonDetail(incoming)})`;
        return { created: true, number };
      }
      const edited = Array.isArray(existing.detail?._edited) ? existing.detail._edited : [];
      const detail = { ...existing.detail, ...incoming, _edited: edited };
      for (const field of edited) if (Object.hasOwn(existing.detail || {}, field)) detail[field] = existing.detail[field];
      const title = edited.includes('title') ? existing.title : clip(p.title, 200) || existing.title;
      const tagline = edited.includes('tagline') ? existing.tagline : clip(p.tagline, 300) || existing.tagline;
      const description = edited.includes('description') ? existing.description : clip(p.description, 4000) || existing.description;
      const url = edited.includes('launch_url') ? existing.launch_url : address;
      const duration = edited.includes('minutes') ? existing.minutes : minutes || existing.minutes;
      await tx`UPDATE sims SET title = ${title}, tagline = ${tagline}, description = ${description},
        launch_url = ${url}, minutes = ${duration}, detail = ${jsonDetail(detail)} WHERE id = ${p.sim}`;
      return { created: false, catalogueRefreshed: revision !== existing.detail?._source_revision };
    });
    return res.status(200).json({ ok: true, ...result, aliasesRemoved: [],
      aliasesRetained: Array.isArray(p.replaces) ? p.replaces.filter(x => x !== p.sim).slice(0, 5) : [] });
  } catch (error) {
    console.error('Registration failed:', error.code || error.message);
    return res.status(error.status || 500).json({ error: error.status ? error.message : 'registration_failed' });
  }
};

