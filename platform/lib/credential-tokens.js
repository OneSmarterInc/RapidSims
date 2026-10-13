'use strict';
const crypto = require('node:crypto');

async function issue(s, userId, purpose, expires) {
  const token = crypto.randomBytes(24).toString('base64url');
  await s.transaction(async tx => {
    const user = (await tx`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`)[0];
    if (!user) throw new Error('Unknown account');
    await tx`UPDATE tokens SET used_at = now() WHERE user_id = ${userId} AND used_at IS NULL`;
    await tx`INSERT INTO tokens (token, user_id, purpose, expires_at) VALUES (${token}, ${userId}, ${purpose}, ${expires})`;
  });
  return token;
}

async function consume(s, token, purpose, passwordHash, name) {
  return s.transaction(async tx => {
    const candidate = (await tx`SELECT user_id FROM tokens WHERE token = ${token} AND purpose = ${purpose}`)[0];
    if (!candidate) return null;
    // Lock the account before token rows: issue and consume use the same lock order.
    const user = (await tx`SELECT * FROM users WHERE id = ${candidate.user_id} FOR UPDATE`)[0];
    if (!user || user.disabled) return null;
    const consumed = await tx`UPDATE tokens SET used_at = now()
      WHERE token = ${token} AND purpose = ${purpose} AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`;
    if (!consumed.length) return null;
    await tx`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${user.id}`;
    if (name) await tx`UPDATE users SET name = ${name} WHERE id = ${user.id}`;
    await tx`UPDATE tokens SET used_at = now() WHERE user_id = ${user.id} AND used_at IS NULL`;
    await tx`DELETE FROM sessions WHERE user_id = ${user.id}`;
    return { ...user, name: name || user.name };
  });
}
module.exports = { issue, consume };
