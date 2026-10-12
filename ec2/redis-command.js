'use strict';
// Shared Redis command transport for every simulation. Supports local Redis on EC2
// and keeps the existing Upstash REST transport available for non-EC2 deployments.
const { createClient } = require('redis');

let client;
let connecting;
function localClient() {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) throw Object.assign(new Error('REDIS_URL is not set'), { code: 'NO_STORE' });
  client = createClient({ url });
  client.on('error', error => console.error('Redis client error:', error));
  return client;
}
async function connect() {
  const c = localClient();
  if (!c.isOpen) {
    if (!connecting) connecting = c.connect().finally(() => { connecting = null; });
    await connecting;
  }
  return c;
}
function configured() {
  return Boolean(process.env.REDIS_URL ||
    ((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
     (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)));
}
async function command(args) {
  if (process.env.REDIS_URL) {
    const c = await connect();
    return c.sendCommand(args.map(value => String(value)));
  }
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw Object.assign(new Error('Redis session storage is not configured'), { code: 'NO_STORE' });
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify(args)
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error || 'Redis REST error ' + response.status);
  return body.result;
}
module.exports = { configured, command };
