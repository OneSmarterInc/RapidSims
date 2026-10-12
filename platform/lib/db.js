'use strict';
const { Pool } = require('pg');

let adapter = null;
function sql() {
  if (adapter) return adapter;
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    const error = new Error('DATABASE_URL is not set');
    error.code = 'NO_DB';
    throw error;
  }
  const pool = new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX || 10) });
  pool.on('error', error => console.error('Unexpected PostgreSQL pool error:', error));
  const tagged = async (strings, ...values) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) text += '$' + (i + 1) + strings[i + 1];
    const result = await pool.query(text, values);
    return result.rows;
  };
  tagged.query = async (text, values = []) => (await pool.query(text, values)).rows;
  adapter = tagged;
  return adapter;
}

const crypto = require('crypto');
const id = (p) => p + '_' + crypto.randomBytes(9).toString('base64url');
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const joinCode = () => Array.from({ length: 6 }, () => CHARS[crypto.randomInt(CHARS.length)]).join('');

module.exports = { sql, id, joinCode };
