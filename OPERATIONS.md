# RapidSims operations — AWS

The current repository contains one platform and 12 simulations. Each simulation is an independent Node service; the included AWS deployment uses EC2, systemd and Nginx. PostgreSQL stores central platform data, and Redis stores simulation sessions and pending academic reports.

## Required configuration

Use [the environment example](ec2/rapidsims.env.example) and [the rollout guide](docs/aws-security-rollout.md). Global configuration is in `/etc/rapidsims.env`, with optional per-service overrides in `/etc/rapidsims/<service>.env`. Do not commit these files or print their contents in logs.

The platform needs `DATABASE_URL`, `PUBLIC_BASE_URL`, `LAUNCH_SECRET`, a separate `REPORT_SECRET` (or per-sim key map), `HEALTH_SECRET`, and access to the report Redis database. Sims need launch/report signing configuration, their stable URL, the platform address and session storage. AI-backed sims also need their provider key. Standalone access codes are optional and deliberately bypass portal enrolment, so leave them unset unless required.

All services and the retry worker must agree on `REPORT_REDIS_URL` and `APP_ENV`. Enable Redis persistence, backups and capacity alerts; pending reports must not be evicted as cache. The worker is `rapidsims-reports.service`.

## Database

`platform/lib/schema.sql` is the source of truth. After edits, regenerate `schema.js` with `node platform/lib/build-schema.js`. Runtime queries use native `pg`, parameterized tagged templates or `.query()`; `.transaction()` keeps related statements on one database connection.

The AWS release script applies additive migrations in a transaction before promotion. Back up first and assess index-locking time on staging. The admin migration action remains available, but it is not a substitute for release readiness checks.

## Health and monitoring

Public `/api/health` is cheap liveness only. Protected diagnostic requests require `x-health-key`; never put the key into a URL. Admin diagnostics can probe only approved origins, reject unexpected private destinations and redirects, and pin validated DNS addresses.

Protected `/_ops/ready` checks actual storage connections, required schema and essential configuration. It returns the release SHA. It does not test external AI billing, every classroom flow, or backups.

Check service logs with `journalctl -u rapidsims@<service>` and worker logs with `journalctl -u rapidsims-reports`. Alert on callback backlog, retry failures, worker restarts, readiness failure, PostgreSQL/Redis capacity, and disk usage from retained releases.

## Temporary traffic monitor

`/_ops/traffic` and `/traffic-monitor` use the diagnostic key. Telemetry is per process, aggregate only, with a two-minute rolling window and a cap of 2,048 latency samples per second. Pruning occurs during traffic, not only when a dashboard is open. At high rates, displayed latency percentiles are sampled, not exact for every request.

The existing temporary dashboard generates bounded read-only test traffic. Do not use it against production during classes. Remove the monitor once testing is complete.

## Releases, recovery and new simulations

The AWS workflow deploys the exact tested SHA. Release files and locked dependencies are built outside the live checkout; affected services have independent pointers. Shared changes affect all consumers. The prior pointers and Nginx locations are retained for rollback.

A new colocated service requires a reviewed `ec2/apps.json` entry and generated routes. An externally hosted AWS service needs an approved origin and compatible protocol, but no new local process entry. Register as draft, review, approve session capability if implemented, assign to a test course and complete an end-to-end test before publishing.

See [the coordinated rollout and recovery procedure](docs/aws-security-rollout.md) for required manual infrastructure setup and remaining validation. Existing legacy sessions are not silently migrated into the strengthened ownership model.

`sim/public/index.html` is generated. Edit `sim/src/` and run `node build.js`, which refuses to write a bundle containing scenario content.

## Temporary traffic monitor

The EC2 runtime exposes an operator-only, in-process traffic snapshot at
`/_ops/traffic` when the request includes the existing `HEALTH_SECRET` in the
`x-health-key` header. The temporary dashboard is at `/traffic-monitor` and
uses the same key only in browser memory. It can ramp read-only GET requests
from 1 to a selected maximum of 50 requests/second, and automatically cools
down after repeated errors, timeouts, or high p95 latency.

This telemetry is per Node process and is retained for two minutes. It stores
aggregate counts and latency values only; it does not store request bodies or
client IP addresses. Remove the dashboard route, page, and telemetry block in
`ec2/server.js` after the load-test work is complete.
