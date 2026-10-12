# Run RapidSims on EC2 with systemd

This deploys the platform and every simulation folder from this repository on one Ubuntu EC2 instance. Each app runs as its own Node process under systemd. Nginx routes the platform and simulations by URL path.

**No Docker, RDS, or S3 are used by this deployment.** The current application still requires its existing PostgreSQL and Redis services: DATABASE_URL (currently Neon Postgres) and the Upstash Redis REST URL/token for session state. Those are application dependencies, not EC2 hosting resources. The EC2 instance hosts all web apps and API handlers.

## One environment file

All 13 systemd services load the same file: /etc/rapidsims.env. Start from ec2/rapidsims.env.example, fill in the existing database, Redis, signing, AI, and access-code values, then copy it to that path. There are no per-app environment files. The runtime calculates each app's SIM_URL from PUBLIC_BASE_URL and its route; optional overrides are in the example.

For production, use a strong random LAUNCH_SECRET and a separate HEALTH_SECRET. Keep the file owned by root and readable by the service group only. Remove SETUP_KEY after creating the first administrator.

The standalone ACCESS_CODE and FACULTY_CODES values are shared by all simulations because there is one environment file. Platform sign-in and signed launch tokens remain the preferred account flow.

## EC2 setup

Use an Ubuntu EC2 instance with Node.js 20 or newer, Nginx, Git, and curl. Configure the EC2 security group to allow SSH only from administrator IP addresses and HTTP/HTTPS from users. Point the site's DNS A record to the EC2 Elastic IP.

1. Create the service account and checkout location:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin rapidsims
sudo mkdir -p /opt/rapidsims
sudo chown rapidsims:rapidsims /opt/rapidsims
```

2. Give the instance read-only Git access to this private repository using a GitHub deploy key, then clone it:

```bash
sudo -u rapidsims git clone git@github.com:OneSmarterInc/RapidSims.git /opt/rapidsims
```

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
sudo -u rapidsims /opt/rapidsims/ec2/deploy.sh
```

The script installs production dependencies in each app folder, runs available simulation build scripts, restarts the 13 systemd services, and checks the platform health endpoint.

6. Enable automatic service startup:

```bash
for app in platform sim01 sim02 sim03 sim04 sim05 sim06 sim07 sim08 sim09 sim10 simplus01 simplus02; do
  sudo systemctl enable --now "rapidsims@$app.service"
done
```

The deploy script's initial restart assumes those units are installed; enable/start them once first if systemd reports that a unit is not found. Thereafter deploy with:

```bash
cd /opt/rapidsims
sudo -u rapidsims git pull --ff-only
sudo -u rapidsims /opt/rapidsims/ec2/deploy.sh
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

The local platform setup currently uses Neon-compatible Postgres and simulation sessions use Upstash-compatible Redis REST. If the requirement changes to keep the database and Redis on the EC2 host too, those integrations must be migrated to native PostgreSQL and Redis clients; setting DATABASE_URL to a local PostgreSQL socket or KV_REST_API_URL to a Redis TCP address will not work with the current adapters.
