#!/usr/bin/env node
'use strict';

// Runs one Vercel-style app folder as a persistent Node service on EC2.
// Usage: node ec2/server.js platform|sim01|...|simplus02
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const REPO = path.resolve(__dirname, '..');
const APPS = {
  platform: { dir: 'platform', port: 3100, prefix: '', title: 'flexee-platform' },
  sim01: { dir: 'sim', port: 3101, prefix: '/sim01', title: 'rapid-sim-01' },
  sim02: { dir: 'sim-02', port: 3102, prefix: '/sim02', title: 'rapid-sim-02' },
  sim03: { dir: 'sim03', port: 3103, prefix: '/sim03', title: 'rapid-sim-03' },
  sim04: { dir: 'sim04', port: 3104, prefix: '/sim04', title: 'rapid-sim-04' },
  sim05: { dir: 'sim05', port: 3105, prefix: '/sim05', title: 'rapid-sim-05' },
  sim06: { dir: 'sim06', port: 3106, prefix: '/sim06', title: 'rapid-sim-06' },
  sim07: { dir: 'sim07', port: 3107, prefix: '/sim07', title: 'rapid-sim-07' },
  sim08: { dir: 'sim08', port: 3108, prefix: '/sim08', title: 'rapid-sim-08' },
  sim09: { dir: 'sim09', port: 3109, prefix: '/sim09', title: 'rapid-sim-09' },
  sim10: { dir: 'sim10', port: 3110, prefix: '/sim10', title: 'rapid-sim-10' },
  simplus01: { dir: 'sim-plus-01', port: 3111, prefix: '/sim-plus-01', title: 'rapid-sim-plus-01' },
  simplus02: { dir: 'simplus02', port: 3112, prefix: '/simplus02', title: 'rapid-sim-plus-02' }
};

const id = process.argv[2];
const config = APPS[id];
if (!config) {
  console.error('Usage: node ec2/server.js ' + Object.keys(APPS).join('|'));
  process.exit(2);
}

const appRoot = path.join(REPO, config.dir);
const publicRoot = fs.existsSync(path.join(appRoot, 'public', 'index.html'))
  ? path.join(appRoot, 'public')
  : appRoot;

if (id !== 'platform') {
  const key = 'SIM_URL_' + id.toUpperCase();
  process.env.SIM_URL = process.env[key] || (process.env.PUBLIC_BASE_URL || '') + config.prefix;
  process.env.PLATFORM_URL = process.env.PLATFORM_URL || process.env.PUBLIC_BASE_URL || '';
} else {
  process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';
}
process.env.PORT = String(config.port);
process.chdir(appRoot);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json'
};

const apiFiles = [];
function walkApi(dir, relative = '') {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) walkApi(path.join(dir, entry.name), rel);
    else if (entry.isFile() && entry.name.endsWith('.js')) apiFiles.push({ rel, full: path.join(dir, entry.name) });
  }
}
walkApi(path.join(appRoot, 'api'));

function matchApi(route) {
  const parts = route.split('/').filter(Boolean);
  let best = null;
  let bestScore = -1;
  for (const file of apiFiles) {
    const pattern = file.rel.slice(0, -3).split('/');
    let params = {};
    let score = 0;
    let i = 0;
    let catchAll = false;
    for (; i < pattern.length; i++) {
      const segment = pattern[i];
      if (/^\[\.\.\..+\]$/.test(segment)) {
        params[segment.slice(4, -1)] = parts.slice(i).join('/');
        score += 1;
        i = parts.length;
        catchAll = true;
        break;
      }
      if (i >= parts.length) break;
      if (/^\[.+\]$/.test(segment)) {
        params[segment.slice(1, -1)] = decodeURIComponent(parts[i]);
      } else if (segment === parts[i]) score += 10;
      else { score = -1; break; }
    }
    const matchedLength = catchAll ? i === parts.length : pattern.length === parts.length && i === pattern.length;
    if (score >= 0 && matchedLength && score > bestScore) {
      best = { ...file, params };
      bestScore = score;
    }
  }
  return best;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    try { out[key] = decodeURIComponent(part.slice(index + 1).trim()); }
    catch { out[key] = part.slice(index + 1).trim(); }
  }
  return out;
}

function addVercelResponseHelpers(res) {
  res.status = function (code) { this.statusCode = code; return this; };
  res.json = function (value) {
    if (!this.headersSent) this.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.end(JSON.stringify(value));
    return this;
  };
  res.send = function (value) {
    if (value !== null && typeof value === 'object' && !Buffer.isBuffer(value)) return this.json(value);
    this.end(value);
    return this;
  };
  res.redirect = function (statusOrUrl, maybeUrl) {
    const code = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
    const target = typeof statusOrUrl === 'number' ? maybeUrl : statusOrUrl;
    this.statusCode = code;
    this.setHeader('Location', target);
    this.end();
    return this;
  };
  res.cookie = function (name, value, options = {}) {
    const pieces = [name + '=' + encodeURIComponent(String(value))];
    if (options.maxAge) pieces.push('Max-Age=' + Math.floor(options.maxAge / 1000));
    if (options.domain) pieces.push('Domain=' + options.domain);
    if (options.path) pieces.push('Path=' + options.path);
    if (options.httpOnly) pieces.push('HttpOnly');
    if (options.secure) pieces.push('Secure');
    if (options.sameSite) pieces.push('SameSite=' + options.sameSite);
    const previous = this.getHeader('Set-Cookie');
    this.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : previous ? [previous] : []), pieces.join('; ')]);
    return this;
  };
  res.clearCookie = function (name, options = {}) {
    return this.cookie(name, '', { ...options, maxAge: 1 });
  };
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type === 'application/json' || type.endsWith('+json')) return JSON.parse(raw);
  if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(raw));
  return raw;
}

function sendFile(res, file) {
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  fs.createReadStream(file).on('error', () => {
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  }).pipe(res);
}

function staticPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const candidate = path.resolve(publicRoot, relative);
  if (candidate !== publicRoot && !candidate.startsWith(publicRoot + path.sep)) return null;
  try {
    const stat = fs.statSync(candidate);
    return stat.isFile() ? candidate : stat.isDirectory() && fs.existsSync(path.join(candidate, 'index.html'))
      ? path.join(candidate, 'index.html') : null;
  } catch { return null; }
}

async function handle(req, res) {
  addVercelResponseHelpers(res);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');

  let url;
  try { url = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
  catch { res.statusCode = 400; return res.end('Bad request'); }

  if (req.method === 'GET' && id === 'sim07' && (url.pathname === '/demo' || url.pathname === '/demo/')) {
    url.pathname = '/index.html';
  }
  if (req.method === 'GET' && id === 'platform') {
    const pages = { '/admin': '/admin.html', '/faculty': '/faculty.html', '/student': '/student.html',
      '/signin': '/signin.html', '/account': '/account.html', '/join': '/join.html' };
    if (pages[url.pathname]) url.pathname = pages[url.pathname];
  }
  if (req.method === 'GET' && /^sim0[3-9]$/.test(id) && url.pathname === '/') {
    res.statusCode = 302;
    res.setHeader('Location', config.prefix + '/launch.html');
    return res.end();
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    const route = url.pathname === '/api' ? 'index' : url.pathname.slice('/api/'.length);
    // RapidSim 10 uses a Vercel rewrite to one catch-all entry (api/index.js).
    // Route unmatched API paths there on EC2 so its own router can handle them.
    const found = matchApi(route) || (id === 'sim10' ? apiFiles.find(file => file.rel === 'index.js') : null);
    if (!found) { res.statusCode = 404; return res.json({ error: 'Not found' }); }
    req.url = url.pathname + url.search;
    req.originalUrl = req.url;
    req.query = Object.fromEntries(url.searchParams.entries());
    req.cookies = parseCookies(req.headers.cookie);
    req.params = found.params;
    req.protocol = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    req.secure = req.protocol === 'https';
    req.ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    try {
      req.body = await readBody(req);
      const handler = require(found.full);
      const fn = typeof handler === 'function' ? handler : handler.default;
      if (typeof fn !== 'function') throw new Error('API module does not export a handler: ' + found.rel);
      await fn(req, res);
      if (!res.writableEnded) res.end();
    } catch (error) {
      console.error(config.title + ' API error:', error);
      if (!res.headersSent) {
        res.statusCode = error.statusCode || 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: res.statusCode === 500 ? 'Internal server error' : error.message }));
      } else if (!res.writableEnded) res.end();
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 404;
    return res.end('Not found');
  }
  let file;
  try { file = staticPath(url.pathname); }
  catch { res.statusCode = 400; return res.end('Bad request'); }
  if (!file) { res.statusCode = 404; return res.end('Not found'); }
  if (req.method === 'HEAD') {
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    return res.end();
  }
  return sendFile(res, file);
}

http.createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error(config.title + ' request error:', error);
    if (!res.headersSent) res.statusCode = 500;
    if (!res.writableEnded) res.end('Internal server error');
  });
}).listen(config.port, '127.0.0.1', () => {
  console.log(config.title + ' listening on 127.0.0.1:' + config.port);
});
