# Flexee RapidSims platform

The platform implements accounts, admin/faculty/student interfaces, catalogue editing, courses, enrolment, access release, launch history, completions, transcripts and faculty results. It is a working API and UI, not a foundation-only scaffold.

## Service contract

Simulations are independent AWS services. The platform signs a purpose-scoped launch containing the user, role, course and persisted launch ID. Sims verify the launch and maintain their own run state.

A simulation signs completion/transcript reports with a separate server-only report credential. The signature covers the full report. The receiver checks the exact issued launch and deduplicates stable report IDs. Pending callbacks are stored in Redis and retried by the AWS report worker.

Registration uses the shared registration/launch key, declares protocol version 2, and creates a draft catalogue entry. Admin overrides persist until reset. Registered service copy takes precedence over older bundled snapshots; bundled copy remains a fallback for legacy rows. Account-bound classroom sessions are an explicitly approved catalogue capability, with a compatibility fallback for existing supported sims.

## Storage and configuration

The runtime uses native `pg` against PostgreSQL, not a Vercel-specific database driver. See [operations](../OPERATIONS.md) and [AWS rollout](../docs/aws-security-rollout.md) for environment variables, migrations and secrets.

There are 13 tables in `lib/schema.sql`: users, auth_attempts, tokens, sessions, sims, previews, courses, course_sims, enrolments, launches, completions, sim_access and transcripts. Regenerate the runtime schema with `node platform/lib/build-schema.js` from the repository root.

Access release lives on `enrolments.paid`; payment processing is external. Instructor removal cannot be undone by student self-enrolment. Invitation and reset credentials are replaced/consumed atomically.

## Verification

From the repository root, run `npm ci --ignore-scripts --no-audit --no-fund` then `npm test`. The security checks use isolated PostgreSQL; they do not migrate or seed your application database. Browser and production acceptance checks are described separately in the rollout guide.

