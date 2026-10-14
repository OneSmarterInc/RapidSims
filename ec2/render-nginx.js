'use strict';
const apps = require('./apps.json');
const domain = process.env.NGINX_SERVER_NAME || 'rapidsims.flexee.org';
if (!/^[a-zA-Z0-9.-]+$/.test(domain)) throw new Error('Invalid server name');
const lines = ['# Generated from ec2/apps.json; install only after nginx -t.',
  'limit_req_zone $binary_remote_addr zone=rapid_auth:10m rate=5r/s;',
  'server {', '    listen 80;', `    server_name ${domain};`,
  '    client_max_body_size 1m;', '    proxy_connect_timeout 10s;', '    proxy_read_timeout 120s;'];
const headerLength = lines.length;
function location(route, app, auth = false) {
  lines.push(`    location ${route} {`, ...(auth ? ['        limit_req zone=rapid_auth burst=15 nodelay;', '        limit_req_status 429;'] : []),
    `        proxy_pass http://127.0.0.1:${app.port}${route === '/' || route.startsWith('= /api/') ? '' : '/'};`,
    '        proxy_http_version 1.1;', '        proxy_set_header Host $host;',
    '        proxy_set_header X-Real-IP $remote_addr;', '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto $scheme;', '    }');
}
for (const path of ['/api/auth','/api/student']) location('= '+path,apps.platform,true);
location('/', apps.platform);
for (const [id, app] of Object.entries(apps)) {
  if (id === 'platform') continue;
  if (!/^[a-z0-9-]+$/.test(app.dir) || !Number.isInteger(app.port) || app.port < 1024 || app.port > 65535) throw new Error('Invalid app manifest');
  for (const prefix of [app.prefix, ...(app.aliases || [])]) {
    if (!/^\/[a-z0-9-]+$/.test(prefix)) throw new Error('Invalid route prefix');
    lines.push(`    location = ${prefix} { return 308 ${prefix}/$is_args$args; }`);
    location('^~ '+prefix+'/',app);
    // Add path context and cookie isolation to the generated location.
    lines.splice(lines.length-1,0,`        proxy_cookie_path / ${prefix}/;`,`        proxy_set_header X-Forwarded-Prefix ${prefix};`);
  }
}
lines.push('}');
process.stdout.write((process.argv.includes('--locations') ? lines.slice(headerLength, -1) : lines).join('\n')+'\n');
