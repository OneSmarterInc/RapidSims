'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const { launchUrl } = require('./metadata');
const { healthHeaders } = require('./sim-health');

const blocked = new net.BlockList();
for (const [address, bits] of [['0.0.0.0',8],['10.0.0.0',8],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['100.64.0.0',10],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(address,bits,'ipv4');
for (const [address,bits] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['::ffff:0:0',96]]) blocked.addSubnet(address,bits,'ipv6');
const origins = value => String(value || '').split(',').map(s => s.trim()).filter(Boolean).map(s => new URL(s).origin);
async function lookup(hostname) {
  let timer;
  try {
    return await Promise.race([dns.lookup(hostname, { all: true }), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Diagnostic DNS timeout')), 3000);
    })]);
  } finally { clearTimeout(timer); }
}

async function probeHealth(address) {
  const url = new URL(launchUrl(address) + '/api/health');
  const allowed = origins(process.env.HEALTH_ALLOWED_ORIGINS);
  if (process.env.PUBLIC_BASE_URL) allowed.push(new URL(process.env.PUBLIC_BASE_URL).origin);
  if (!allowed.includes(url.origin)) throw new Error('Simulation origin is not approved for diagnostics');
  const privateAllowed = origins(process.env.HEALTH_PRIVATE_ORIGINS).includes(url.origin);
  if (url.protocol !== 'https:' && !privateAllowed) throw new Error('Diagnostics require HTTPS');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const records = net.isIP(hostname) ? [{address:hostname,family:net.isIP(hostname)}] : await lookup(hostname);
  if (!records.length || (!privateAllowed && records.some(r => blocked.check(r.address,r.family===6?'ipv6':'ipv4')))) throw new Error('Private diagnostic destination is not approved');
  // Pin the validated address for this connection; do not resolve it again on connect.
  const selected = records[0];
  return new Promise((resolve,reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      headers: healthHeaders(),
      lookup: (_host, options, callback) => options.all ? callback(null,[selected]) : callback(null,selected.address,selected.family)
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400) { response.resume(); reject(new Error('Diagnostic redirects are not allowed')); return; }
      let size = 0; const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 128*1024) request.destroy(new Error('Diagnostic response too large')); else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve({ok:response.statusCode>=200 && response.statusCode<300,status:response.statusCode,json:async()=>value});
        } catch { reject(new Error('Invalid diagnostic response')); }
      });
    });
    const timer = setTimeout(()=>request.destroy(new Error('Diagnostic timeout')),8000);
    request.on('error',reject); request.on('close',()=>clearTimeout(timer));
  });
}
module.exports = { probeHealth };
