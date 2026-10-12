# Run RapidSims on EC2 with systemd

This deploys the platform and every simulation folder from this repository on one Ubuntu EC2 instance. Each app runs as its own Node process under systemd. Nginx routes the platform and simulations by URL path.

**No Docker, RDS, or S3 are used.** PostgreSQL and Redis run locally on the EC2 instance as Ubuntu packages; all 13 Node app services run under systemd.

## One environment file

All 13 systemd services load the same file: /etc/rapidsims.env. It contains DATABASE_URL for local PostgreSQL and REDIS_URL for local Redis, plus shared signing, AI, and access-code values. There are no per-app environment files. The runtime calculates each app's SIM_URL from PUBLIC_BASE_URL and its route; optional overrides are in the example.

For production, use a strong random LAUNCH_SECRET and a separate HEALTH_SECRET. Keep the file owned by root and readable by the service group only. Remove SETUP_KEY after creating the first administrator.

The standalone ACCESS_CODE, FACULTY_CODE, and FACULTY_CODES values are shared by all simulations because there is one environment file. Platform sign-in and signed launch tokens remain the preferred account flow.

## EC2 setup

Use an Ubuntu EC2 instance with Node.js 20 or newer, Nginx, Git, curl, PostgreSQL, and Redis. Install native packages (no containers):

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
sudo mkdir -p /opt/rapidsims
sudo chown rapidsims:rapidsims /opt/rapidsims
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
sudo -u rapidsims env HOME=/var/lib/rapidsims git clone git@github.com:OneSmarterInc/RapidSims.git /opt/rapidsims
```

GitHub's SSH test may finish with a message that shell access is not provided; successful authentication is what matters.

3. Create the single server-side environment file:

```bash
sudo install -o root -g rapidsims -m 0640 /opt/rapidsims/ec2/rapidsims.env.example /etc/rapidsims.env
sudoedit /etc/rapidsims.env
```

4. Install the systemd and Nginx configuration:

```bash
sudo cp /opt/rapidsims/ec2/rapidsims@.service /etc/systemd/system/rapidsims@.service
sudo cp /opt/rapidsims/ec2/nginx-rapidsims.conf /etc/nginx/conf.d/rapidsims.conf
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl daemon-reload
```

Edit server_name in /etc/nginx/conf.d/rapidsims.conf to your domain before reloading Nginx. Ensure Node is available at /usr/bin/node (the path used by the unit).

5. Install dependencies and build the generated assets:

```bash
sudo bash /opt/rapidsims/ec2/deploy.sh
```

The script installs shared `pg` and `redis` clients plus each app's production dependencies, runs available simulation build scripts, enables and restarts all 13 systemd services, and checks the platform health endpoint.

Thereafter deploy updates with:

```bash
sudo -u rapidsims env HOME=/var/lib/rapidsims git -C /opt/rapidsims pull --ff-only
sudo bash /opt/rapidsims/ec2/deploy.sh
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

The public health endpoint confirms process liveness; it does not prove a full database, AI, Redis, or student-playthrough flow. Run the repository's simulation checks before publishing a release.

## Operations

- Start/stop one app: sudo systemctl restart rapidsims@sim03
- Check one app: sudo systemctl status rapidsims@sim03
- Check Nginx: sudo nginx -t && sudo systemctl reload nginx
- Protect /etc/rapidsims.env and repository access. Never commit production secrets.

The platform uses the native PostgreSQL client and simulation sessions use the native Redis client when REDIS_URL is set. Redis Lua scripts, hashes, sets, and TTL behavior work directly against local Redis. Existing Upstash REST configuration remains supported for non-EC2 deployments.
