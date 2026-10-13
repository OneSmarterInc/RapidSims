'use strict';
// Shared Redis command transport for every simulation. Supports local Redis on EC2
// and keeps the existing Upstash REST transport available for non-EC2 deployments.
const { createClient } = require('redis');

const clients = new Map();
function localClient(url) {
  if (clients.has(url)) return clients.get(url);
  if (!url) throw Object.assign(new Error('REDIS_URL is not set'), { code: 'NO_STORE' });
  const client = createClient({ url, disableOfflineQueue: true, socket: {
    connectTimeout: 5000, reconnectStrategy: retries => retries < 3 ? Math.min(1000, retries * 250) : new Error('Redis unavailable')
  } });
  client.on('error', error => console.error('Redis client error:', error.code || 'connection_failed'));
  const entry = { client, connecting: null };
  clients.set(url, entry);
  return entry;
}
async function connect(url) {
  const entry = localClient(url), c = entry.client;
  if (entry.connecting) await entry.connecting;
  if (!c.isOpen) {
    if (!entry.connecting) entry.connecting = c.connect().finally(() => { entry.connecting = null; });
    await entry.connecting;
  }
  return c;
}
function configured() {
  return Boolean(process.env.REDIS_URL ||
    ((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
     (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)));
}
async function command(args, redisUrl = process.env.REDIS_URL) {
  if (redisUrl) {
    let timer;
    try {
      return await Promise.race([
        connect(redisUrl).then(c => c.sendCommand(args.map(value => String(value)))),
        new Promise((_, reject) => { timer = setTimeout(() => {
          const c = clients.get(redisUrl)?.client;
          if (c?.isOpen) c.destroy();
          reject(Object.assign(new Error('Redis command timed out'), { code: 'REDIS_TIMEOUT' }));
        }, 8000); })
      ]);
    } finally { clearTimeout(timer); }
  }
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw Object.assign(new Error('Redis session storage is not configured'), { code: 'NO_STORE' });
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify(args), signal: AbortSignal.timeout(8000), redirect: 'error'
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error || 'Redis REST error ' + response.status);
  return body.result;
}
module.exports = { configured, command };

