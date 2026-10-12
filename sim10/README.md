# Sim-10: Infrastructure or Bubble?

Sim id `rapid-10-bubble`, route `/sim10`. Node 18+, no dependencies.

## Run and check

```
npm run gate     # build gate: must pass before any push
npm test         # engine, HTTP, launch, solo, completion and client checks
DEV_OPEN=1 node server.js                            # local, no launch token
DEV_OPEN=1 SIM10_CLOCK_SCALE=0.05 node server.js     # same, clock at 1/20 speed
```

Pages: `/` private play or class join, `/host` session setup (instructor), `/console?code=` projector, `/play?code=` student.

## Deploy

Root Directory **sim10**, framework **Other**, build command **npm run build**, output directory **public**. The build and output settings are committed in `vercel.json`. See [the shared deployment guide](../docs/sim09-sim10-integration.md).

Its own Vercel project; `vercel.json` sends every path to `api/index.js`. Variables are listed in `.env.example`.

| Variable | Value |
|---|---|
| `LAUNCH_SECRET` | Same value as the platform's |
| `PLATFORM_URL` | `https://rapidsims.flexee.org` |
| `SIM_URL` | `https://rapidsims.flexee.org/sim10`. Set explicitly; never derived |
| `BASE_PATH` | `/sim10/` |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Required Upstash store for solo and class play. Missing production storage returns a clear 503 error |
| `ACCESS_CODE`, `FACULTY_CODES` | Optional standalone access. Unset means closed, as in sim08 |
| `DEV_OPEN` | Never set on Vercel |

The production origin is `https://sim10.vercel.app`; the platform `/sim10` rewrites point to it. Deploy the platform configuration as well as this sim. On the first application API request the sim announces itself to `PLATFORM_URL/api/register` and appears in the admin catalogue unpublished. The health endpoint is read-only.

## Platform contract (matches `platform/lib/launch.js` and sim08)

- Token arrives as `#lt=` or `?lt=`, is kept for the tab and scoped to each run/session, and is sent as `X-Launch-Token` on every call. It must name `sim: rapid-10-bubble`, a person (`sub`) and a role of `student`, `faculty` or `faculty_preview`.
- A direct visit asks for `ACCESS_CODE` before showing play/join options. Signed platform launches skip this prompt after server verification. Remembered codes are revalidated on refresh.
- Student Play offers a private individual run with one or two companies. The reading and decision clocks start immediately; the owner releases each reveal afterward. Solo sessions cannot be joined or controlled by others.
- Faculty launched with `mode: session` land on setup. Their sessions are bound to their course; students join through the platform's session page and are identified as `platform:<sub>`.
- After the last company's outcome is revealed, each platform student's calls, lines and reasons are reported to `PLATFORM_URL/api/complete`.

## Where things live

| Path | What |
|---|---|
| `data/config.js` | Clock lengths, scaling constants, pack layout, reveal row sets, sim ids |
| `data/copy.js` | Every word students or the projector see, plus facilitator notes |
| `data/sources/` | Real figures with filing references (server-side only) |
| `lib/engine.js` | Sessions, clock, verdicts, teams, reveal gating, console |
| `lib/denylist.js` | One matcher for the gate and the live guard |
| `lib/launch.js` | Launch-token verification and signed registration/completion |
| `tools/gate.js` | Build gate |

## Checked against the repo (27 Sep 2026)

Launch, registration and completion copy sim08. The sim-id check lists every id declared in the repo (`rapid-01` to `rapid-09`) plus the three conflicted legacy ids.

## Before students see it

Chuck blind-reads both packs (join as a student with `DEV_OPEN=1`) and playtests one individual and one team session.

## Catalogue and diagnostics

Registration supplies Sim10-specific financial-analysis catalogue details (revision `sim10-v2`) and requests number 10 for new records. Existing record IDs, publication states and administrator numbering remain intact.

Set `HEALTH_SECRET` to the same dedicated diagnostic key as the platform. Public `/api/health` stays minimal. The `x-health-key` header unlocks build, Redis configuration, launch-secret fingerprint, platform URL and registration address. It does not issue network requests or mutate sessions. Never use `LAUNCH_SECRET` as the diagnostic key.


## UI branch review

The approved UI changes are isolated on `feature/sim10-ui-review`, based on
`610977f6383baa8ed8412e40cb0378c40da57c96`. The unchanged baseline is preserved
on `backup/main-before-sim10-ui-20261005`; no merge to `main` is part of this work.

- Desktop figures and answers use two columns; mobile uses one document flow.
- Draft writes are serialized; failed fields remain in this tab and can be retried.
  Hide/show does not recreate the form. Unsaved expired drafts can be copied,
  but are never represented as recorded answers.
- Team commitment requires a cited line, a reason of at least 15 characters and
  counter-evidence of at least 80 characters. The confirmation checks that the
  shared draft still matches the reviewed answer. Individual deadlines still
  record the last saved response, including incomplete responses.
- Concurrent edits to different team fields use compare-and-set to avoid lost
  updates. Editing the same field concurrently remains last-writer-wins.
- Progress uses the server phase start. Faculty mode survives the launch redirect.
- The console exposes the actual join URL and a copy action. Its projector link
  opens a host-authenticated display without facilitator notes or host controls.
- Authentication and connection failures have different recovery messages.
  Progress reporting is shown separately from answers being recorded.

Validation: `npm test` includes content gates, API/engine tests, entry tests and
save-queue regression coverage. `npm run gate` checks content provenance/leaks.

The optional `npm run test:browser` suite requires Playwright and Chromium.
Install a local test runtime with `npm install --no-save --package-lock=false playwright`
and `npx playwright install chromium`, or point `SIM10_PLAYWRIGHT_PATH` at an
existing Playwright module. `SIM10_CHROMIUM_PATH` and comma-separated
`SIM10_BROWSER_ARGS` can select an existing browser. Set `SIM10_SCREENSHOTS` to
an external directory for screenshots. The suite starts its own local server,
uses an in-memory store and does not contact live simulation sessions.
