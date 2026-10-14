# Flexee RapidSims

An AWS-hosted learning portal with **12 independent simulation services**. The repository's deployment adapter runs the platform and simulations as 13 Node processes on EC2, with Nginx in front, PostgreSQL for platform records and Redis for simulation state and queued results. No framework migration or Vercel hosting is required.

## Components

- `platform/`: admin, faculty and student interfaces; accounts, catalogue, courses, enrolment, access release, launch records, completions and transcripts.
- `sim/`, `sim-02/`, `sim03/` through `sim10/`, `sim-plus-01/`, `simplus02/`: each simulation's authored content, engine, API and interface.
- `shared/`: scoped launch verification and signed, idempotent server reports with a persistent delivery outbox.
- `ec2/`: HTTP adapter, app/route manifest, systemd services, generated Nginx routing and exact-commit release scripts.
- `tools/`: isolated security, integration and simulation regression checks.

Each sim owns its scenario; the platform owns accounts, access and academic records. A signed launch identifies the account/course and issued run. A separate server credential signs a completed report, including transcript content. The platform verifies the exact launch and deduplicates retries. Payment happens outside the application; faculty/admin access release is represented by the enrolment's paid flag.

## Development and verification

Use Node 24. Install locked dependencies with `npm ci --ignore-scripts --no-audit --no-fund`, then run `npm test`. Tests use isolated databases and temporary local HTTP servers; the security suite does not read production credentials. `npm run test:security` runs the targeted regression suite alone.

Application startup also requires explicit local PostgreSQL, Redis and signing configuration. Never point development tests at production databases. See the existing `tools/local/` utilities for local setup and [operations](OPERATIONS.md) for configuration.

## AWS releases

Start with [the AWS security rollout](docs/aws-security-rollout.md) before deploying these changes. It covers the coordinated protocol upgrade, required report key/outbox, database migration, maintenance window, staging checks and rollback.

[EC2 setup](ec2/README.md) describes provisioning. `ec2/apps.json` is the service/route source of truth; a new external service can use its own approved HTTPS URL without a new EC2 manifest entry. New catalogue entries remain drafts until approved. The admin editor controls account-bound classroom-session capability.

Historical Vercel manifests remain in the repository for older tooling; they are not the production deployment configuration. Nothing in a local test run pushes to GitHub or deploys AWS.

