# AWS security fixes: rollout and verification

These changes target the repository's AWS EC2/systemd/Nginx deployment, not Vercel. They are local code changes; they do not change GitHub, AWS, live credentials, or existing databases. The actual hosted topology and deployed revision still need operator verification.

## Before production

Use a maintenance window with no active classes. This is a coordinated authentication-protocol upgrade, not a rolling-compatible change:

- Old launch tokens lack a purpose/run identifier and are rejected. Students and faculty must relaunch from the portal.
- Sim01, Sim02 and RapidSim+01 now namespace their Redis keys. Existing unnamespaced rooms are not adopted because their ownership cannot be proved. Retain a Redis backup; start fresh rooms after deployment. No code deletes the old keys.
- Platform-launched runs require an account owner. Anonymous users cannot recover those runs using just a run ID. Standalone access requires an explicitly configured code.
- The platform and all result-sending services must upgrade together. Do not switch result verification back to accepting launch tokens during rollout.
- Back up PostgreSQL and Redis and confirm restore procedures. Historical completion/transcript rows remain; only new reports gain idempotency IDs. Existing duplicates are not silently deleted.

## Configuration

Use `ec2/rapidsims.env.example` as a template, not as production credentials. Global settings live in `/etc/rapidsims.env`; optional `/etc/rapidsims/<service>.env` files override them. Files must be trusted, root-owned, mode 0640 or tighter, and readable only by the service group. They must use shell-compatible assignments because the release script reads them as well as systemd.

| Setting | Required behavior |
|---|---|
| `DATABASE_URL` | Platform PostgreSQL connection; native `pg` driver, not a Neon-specific API. |
| `REDIS_URL` | Simulation session storage. Keep the Redis listener private. |
| `REPORT_REDIS_URL` | One shared durable outbox for **every sim and the worker**, even if their session databases differ. Falls back to `REDIS_URL` if omitted. |
| `APP_ENV` | Same value across the platform, simulations and worker for a deployment; staging must use separate databases/credentials. |
| `LAUNCH_SECRET` | Strong random launch/registration signing key shared with the simulations. |
| `REPORT_SECRET` | A second strong random key, different from `LAUNCH_SECRET`, available to the platform, sims and worker. Never send it to browsers. |
| `REPORT_KEYS_JSON` | Optional stronger isolation: platform/worker map simulation IDs to separate keys; each sim receives only its own `REPORT_SECRET`. Include any deliberately supported legacy identity. Do not put the full map into each simulation's environment. |
| `PUBLIC_BASE_URL` | Canonical HTTPS portal URL. The runtime/worker use it as the default `PLATFORM_URL`. |
| `PLATFORM_URL` | Result destination, explicitly override if needed. Must point to the upgraded platform. |
| `HEALTH_SECRET` | Dedicated diagnostic key, different from launch/report keys. |
| `HEALTH_ALLOWED_ORIGINS` | Comma-separated HTTPS origins you operate. `PUBLIC_BASE_URL` is also accepted. Required for independent external sim origins. |
| `HEALTH_PRIVATE_ORIGINS` | Explicit private-address/HTTP exception, primarily for local or staging diagnostics; it does not itself add an origin to the allowlist. Leave empty in public production unless deliberately needed. |
| `ANTHROPIC_API_KEY` | Required by the AI-backed Sim01/02; readiness checks presence, not provider billing or live inference. |
| Standalone access/faculty codes | Leave unset for portal-only operation. Configure only where you intentionally permit standalone use outside enrolment checks. |

Enable Redis persistence and backups for the report database. Use a non-evicting policy for pending academic records; configure capacity alerts. Redis acknowledgement durability depends on your AOF/replication policy—an AOF fsync interval can still lose its last unflushed writes after a machine failure. Do not call an in-memory-only Redis deployment durable. The retry queue has no expiry and contains student work: restrict access and include it in retention/privacy planning. It must never be flushed as disposable cache.

The global-file/single-Unix-user setup is not a hard security boundary between services. Per-simulation keys reduce accidental cross-attribution, but truly untrusted services also need separate users/containers and scoped storage access. That larger infrastructure change is not applied here.

## One-time Nginx integration

Preserve the existing TLS certificate, listener, renewal and other domain configuration. Do **not** replace a live HTTPS configuration with the sample HTTP server.

1. Put `limit_req_zone $binary_remote_addr zone=rapid_auth:10m rate=5r/s;` once in Nginx's `http` context.
2. Generate `ec2/render-nginx.js --locations` into `/etc/nginx/rapidsims-locations.conf` using the reviewed release checkout. This file contains only locations, not a new server/listener.
3. In the existing RapidSims HTTPS `server` block, replace its overlapping application locations with `include /etc/nginx/rapidsims-locations.conf;`. Retain certificate and ACME configuration. Set `client_max_body_size 1m` and suitable proxy timeouts there.
4. Run `sudo nginx -t` before reload. Back up the original config first. The deploy script refuses to proceed if the managed include has not been installed.

The generated locations forward the real client address and add an additional auth/student request limit. The application also enforces shared PostgreSQL IP/account throttles. Do not expose service ports 3100–3112 publicly; otherwise a caller could bypass Nginx limits. Restrict PostgreSQL/Redis ports too.

## Release procedure

Requires Node 24 (matching CI), the `rapidsims` service account, Nginx, PostgreSQL, Redis, Git, and the self-hosted runner setup in [self-hosted-runner.md](self-hosted-runner.md). This script targets one EC2 machine hosting independent processes; a deployment spread over multiple EC2 machines requires adapting orchestration, not assuming this script provisions them.

1. Review and commit the local changes through your normal process. No commit or push was performed by this work.
2. Run `npm ci --ignore-scripts --no-audit --no-fund` and `npm test` on the candidate revision. Tests use isolated PostgreSQL and temporary local HTTP servers, never production data. Browser E2E and real Redis tests remain separate checks.
3. Configure the new keys, shared outbox and Nginx include in staging first.
4. The checked-in GitHub Actions workflow gates deployment on `npm test` and Bash syntax, then sends the exact triggering commit SHA to the local root-owned helper on the production runner. The helper rejects superseded master revisions. For a deliberately authorized manual release, invoke `sudo bash ec2/deploy.sh <40-character-tested-SHA> /var/www/rapidsims` from reviewed code after fetching that commit.
5. The script archives the SHA into an isolated staging directory, installs locked dependencies, tests/builds, performs an additive PostgreSQL migration in a transaction, and creates `/var/www/rapidsims-releases/<SHA>`.
6. Each changed service gets its own `/var/www/rapidsims-services/<service>` pointer. Shared-code/runtime changes affect all services; a single simulation change does not restart unrelated simulations. The script checks authenticated readiness and build SHA before proceeding, updates the managed Nginx locations, and restarts the report worker.

Migration adds `auth_attempts`, report/launch reference columns and unique report-ID indexes. It preserves existing rows and can be repeated. Index creation may lock a large table: measure on staging and use a separate online-index migration if production volume requires it. Application rollback does not roll back additive schema changes.

## Acceptance checks

- Protected `/_ops/ready` on every affected service returns `ok: true` and the intended build SHA. This checks PostgreSQL schema/connectivity, Redis, outbox connectivity and essential configuration, not a complete classroom or AI-provider transaction.
- Sign in as test admin/faculty/student; create a course; assign a published sim; enrol and approve the student; launch and complete it. Confirm the correct faculty result. Use test accounts, not genuine student submissions.
- Test a team room and a solo run. Every report must reference the exact issued student launch; roster-only members who never launched must not gain a fabricated completion.
- On staging, temporarily make the portal result endpoint unavailable, finish a run, then restore it. Verify the queued report arrives once, including after restarting the simulation and worker. This live Redis/restart scenario was not exercised against AWS in the local test suite.
- Reissue a test invitation: the old link must fail. A removed student must not restore their own released access by rejoining.
- Ensure the worker is active: `sudo systemctl status rapidsims-reports`. Review `sudo journalctl -u rapidsims-reports --since '15 minutes ago'`. Alert on growing pending counts, repeated retry failures, worker restarts, Redis capacity and readiness failures. Failed reports are retained rather than silently discarded; permanent invalid-report errors need operator investigation.
- Browser-check the admin catalogue capability selector and one complete student/faculty flow. VM/client tests are not a substitute for a real-browser production check.

## Recovery

On an error after promotion begins, the release script restores previous service pointers and the previous managed Nginx include, restarts services and retains the failed release for diagnosis. Keep maintenance restrictions in place until the restored services are checked; reverting to a pre-security release also restores its vulnerabilities.

Each release records all prior targets in `services-previous.tsv` and the old locations include in `nginx-previous.conf`. For a later manual rollback, an operator should validate those exact absolute targets, restore only the intended service symlinks under `/var/www/rapidsims-services`, restart/check those services, restore the matching locations include, run `nginx -t`, reload Nginx, and restart the worker. Never blindly reset the checkout, delete databases, or restore a mismatched partial protocol version.

A failed release directory is deliberately retained and the same SHA is not overwritten. Use a newly reviewed corrective commit for another automated attempt, or an explicitly reviewed manual rollback. Periodically archive unused releases and abandoned staging directories only after verifying no active service points to them. No automatic recursive deletion is included.

## Audit disposition

| Original findings | Local changes |
|---|---|
| P1 #1 | Separate report authority/purposes, signed envelopes, exact launch binding, stable report IDs and database uniqueness. |
| P1 #2–4, #7 | Fail-closed access, simulation scope, immutable faculty/run ownership, isolated Redis keys for the affected stores. |
| P1 #5–6 | Escaped denial HTML; atomic replacement/consumption of invitation and reset credentials. |
| P1 #8 | Launch lifetime uses activity duration plus buffer (minimum 180 minutes, maximum 720); no indefinite renewal. |
| P2 #9–10, #20 | Persistent admin overrides, approved session capability metadata, declared protocol v2, one EC2 route/service manifest, validated metadata size and transactional catalogue updates. |
| P2 #11–13 | Durable retry outbox, no self-restoration after instructor removal, allowlisted/pinned/no-redirect diagnostics. |
| P2 #14–15, #17 | Full regression gate, exact-SHA versioned release, locked dependencies, affected-service promotion, rollback and bounded dependency readiness. |
| P2 #16 | Original Vercel issue is not applicable to AWS. AWS change detection includes `shared/`, `ec2/` and root dependencies. Historical Vercel files are retained, not treated as deployment authority. |
| P2 #18–19 | Bounded telemetry, asynchronous bounded password hashing, database-backed account/IP throttles and Nginx limits. |
| P3 | Root, platform and operations documentation now describe AWS, 12 simulations and the current contracts. |

Tradeoffs: longer-lived scoped launches can remain valid until expiry after access changes; the current design does not implement immediate cross-service revocation. Queuing prevents transient callback loss but relies on properly configured Redis persistence and an operating worker. Releases retain rollback copies and restart changed processes; this is not zero-downtime blue/green deployment. Broader security, browser, AWS IAM, network, backup and load assessments remain separate from these audited fixes.
