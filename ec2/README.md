# Run RapidSims on EC2 with systemd

This deploys the platform and every simulation folder from this repository on one Ubuntu EC2 instance. Each app runs as its own Node process under systemd. Nginx routes the platform and simulations by URL path.

**No Docker, RDS, or S3 are used.** PostgreSQL and Redis run locally on the EC2 instance as Ubuntu packages; all 13 Node app services run under systemd.

Read [the security rollout guide](../docs/aws-security-rollout.md) before upgrading an existing installation. The launch/report protocol change requires a maintenance window and fresh launches/rooms.

## Environment files

All 13 app services load /etc/rapidsims.env, then optional /etc/rapidsims/<service>.env overrides. The report worker uses the global and platform files. Configure DATABASE_URL, REDIS_URL, the shared durable REPORT_REDIS_URL, distinct launch/report/diagnostic keys, and the public portal address. The runtime calculates each app's SIM_URL from PUBLIC_BASE_URL and the route manifest.

For production, use strong independent LAUNCH_SECRET, REPORT_SECRET and HEALTH_SECRET values. Keep files root-owned and readable by the service group only. Remove SETUP_KEY after creating the first administrator. Enable Redis persistence and backups; the report outbox is not disposable cache.

Leave standalone ACCESS_CODE, FACULTY_CODE and FACULTY_CODES unset for account-only access. Where intentionally needed, configure them per service. Platform sign-in and signed launch tokens remain the preferred account flow.

## EC2 setup

Use an Ubuntu EC2 instance with Node.js 24 (matching CI), Nginx, Git, curl, PostgreSQL, and Redis. Install native packages (no containers):

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib redis-server nginx git curl
sudo systemctl enable --now postgresql redis-server
```

Keep PostgreSQL and Redis bound to localhost; do not allow ports 5432 or 6379 in the EC2 security group. Create the application database and user:

```bash
sudo -u postgres psql
```

At the `psql` prompt, run `CREATE ROLE rapidsims LOGIN;`, then `\password rapidsims` and enter a strong password, then `CREATE DATABASE rapidsims OWNER rapidsims;` and `\q`. Put the same password in DATABASE_URL in `/etc/rapidsims.env` (URL-encode special characters). Configure the EC2 security group to allow SSH only from administrator IP addresses and HTTP/HTTPS from users. Point the site's DNS A record to the EC2 Elastic IP.

1. Create the service account with a home directory and prepare the checkout location:

```bash
sudo useradd --system --user-group --create-home --home-dir /var/lib/rapidsims --shell /usr/sbin/nologin rapidsims
sudo mkdir -p /var/www/rapidsims
sudo chown rapidsims:rapidsims /var/www/rapidsims
sudo install -d -o rapidsims -g rapidsims -m 0700 /var/lib/rapidsims/.ssh
```

2. Create a read-only GitHub deploy key for this private repository:

```bash
sudo -u rapidsims env HOME=/var/lib/rapidsims ssh-keygen -t ed25519 -C rapidsims-ec2 -f /var/lib/rapidsims/.ssh/id_ed25519 -N ""
sudo cat /var/lib/rapidsims/.ssh/id_ed25519.pub
```

Copy the displayed public key. In GitHub, open **OneSmarterInc/RapidSims → Settings → Deploy keys → Add deploy key**. Give it a recognizable title such as `EC2 RapidSims`, paste the public key, leave **Allow write access** unchecked, and save it.

Test SSH and accept GitHub's host key on the first connection, then clone as the service account:

```bash
sudo -u rapidsims env HOME=/var/lib/rapidsims ssh -T git@github.com
sudo -u rapidsims env HOME=/var/lib/rapidsims git clone git@github.com:OneSmarterInc/RapidSims.git /var/www/rapidsims
```

GitHub's SSH test may finish with a message that shell access is not provided; successful authentication is what matters.

3. Create the server-side environment file and provision optional per-service overrides:

```bash
sudo install -o root -g rapidsims -m 0640 /var/www/rapidsims/ec2/rapidsims.env.example /etc/rapidsims.env
sudoedit /etc/rapidsims.env
```

4. Prepare the managed Nginx locations. For an existing HTTPS site, follow the rollout guide to preserve its certificate and server configuration. For a fresh HTTP-only bootstrap:

```bash
node /var/www/rapidsims/ec2/render-nginx.js --locations | sudo tee /etc/nginx/rapidsims-locations.conf >/dev/null
sudo cp /var/www/rapidsims/ec2/nginx-rapidsims.conf /etc/nginx/conf.d/rapidsims.conf
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl daemon-reload
```

Edit server_name in /etc/nginx/conf.d/rapidsims.conf to your domain before reloading Nginx. Ensure Node is available at /usr/bin/node (the path used by the unit).

5. Fetch a reviewed commit and deploy its exact tested SHA (replace the placeholder):

```bash
sudo bash /var/www/rapidsims/ec2/deploy.sh <40-character-tested-SHA> /var/www/rapidsims
```

The script uses locked root dependencies, runs the full test gate and builds in a versioned release directory, applies additive database migrations, installs systemd units, and promotes only affected service pointers. Every affected service must pass authenticated storage readiness with the new build SHA. The result-delivery worker is also installed and restarted.

Thereafter deploy updates with:

```bash
sudo -u rapidsims env HOME=/var/lib/rapidsims git -C /var/www/rapidsims fetch origin master
sudo bash /var/www/rapidsims/ec2/deploy.sh <40-character-tested-SHA> /var/www/rapidsims
```

## Routes

| App | URL path | Local service |
|---|---|---:|
| Platform | / | 3100 |
| RapidSim 01 | /sim01/ | 3101 |
| RapidSim 02 | /sim02/ | 3102 |
| RapidSim 03–10 | /sim03/ through /sim10/ | 3103–3110 |
| RapidSim+ 01 | /sim-plus-01/ | 3111 |
| RapidSim+ 02 | /simplus02/ | 3112 |

The existing platform aliases /rapidsims01/ and /simplus01/ continue to route to RapidSim 03. The direct /sim-plus-01/ path is available for the separate RapidSim+ 01 folder. All Node services bind only to localhost; Nginx is the public listener.

## HTTPS

The checked-in Nginx config listens on HTTP so first boot and certificate issuance are straightforward. After DNS points to this instance, install Certbot for Nginx and issue a certificate for the configured domain. Keep ports 80 and 443 open so Certbot can validate and renew. Set PUBLIC_BASE_URL=https://your-domain in /etc/rapidsims.env, then restart the platform and sim services.

## First-run setup and checks

- Visit /setup.html and use the one-time SETUP_KEY to create the initial administrator. Remove SETUP_KEY from /etc/rapidsims.env and restart rapidsims@platform.
- Confirm /api/health responds with platform liveness.
- Confirm each /simNN/api/health path responds for its simulation.
- Use the platform's protected health probe with HEALTH_SECRET to check the configured database and launch-secret fingerprint.
- Check logs with sudo journalctl -u 'rapidsims@*' -f or sudo journalctl -u rapidsims@sim03 -n 100.

The public health endpoint confirms process liveness. Protected /_ops/ready checks storage connectivity, required schema and essential configuration; neither proves a complete student playthrough or external AI availability. Run the staging acceptance checks in the rollout guide before publishing a release.

## Operations

- Start/stop one app: sudo systemctl restart rapidsims@sim03
- Check one app: sudo systemctl status rapidsims@sim03
- Check Nginx: sudo nginx -t && sudo systemctl reload nginx
- Protect /etc/rapidsims.env and repository access. Never commit production secrets.

The platform uses the native PostgreSQL client and simulation sessions use the native Redis client when REDIS_URL is set. Redis Lua scripts, hashes, sets, and TTL behavior work directly against local Redis. Existing Upstash REST configuration remains supported for non-EC2 deployments.

