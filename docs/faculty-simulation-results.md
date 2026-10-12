# Faculty simulation results

## Scope and navigation

The Results button is shown beside each simulation in a faculty-owned course.
It opens `/faculty.html?view=sim-results&course=<course-id>&sim=<sim-id>`.
The new screen and API actions require the **faculty** role and ownership of the
course. Admin and student screens, their results, and the existing Who has played
and student-results routes are unchanged. Even an admin in the teaching view does
not receive this new button or permission.

The view uses the existing portal navigation controller. Course/SIM, student
page, progress filter and sort survive refresh and Back/Forward. Search text is
kept in the current history entry, scoped by signed-in account, not in a shareable
URL. Choosing another simulation clears the previous search. Returning to a
result view reloads authoritative data; expanded details and additional history
pages are intentionally not cached across reloads.

## Data contract

Both actions use POST `/api/faculty`, existing session authentication, course
ownership checks and a current `course_sims` membership check. Responses are
`Cache-Control: no-store`. Wrong role returns 403, missing/other-owner course or
unassigned SIM returns 404, invalid history kind/cursor returns 400.

- `sim_results`: `courseId`, `simId`, optional `page`, `search`, `filter`, `sort`.
  Returns 20 student accounts per page, full-course active-student counters,
  normalized filter/page/sort, and the latest three saved completions per account.
  Search is a literal case-insensitive name/email match. Filters: `all`,
  `completed`, `started`, `not-started`, `not-released`, `repeated`, `removed`.
  Sort: `name` or `attempts` (most recorded completions first).
- `sim_result_history`: `courseId`, `simId`, `studentId`, `kind` (`attempts` or
  `transcripts`), optional opaque `cursor`. Returns ten records and `next`.
  Stable timestamp + record-ID cursors preserve PostgreSQL microseconds and
  avoid offset shifts if newer records arrive while older history is loaded.

Account ID, course ID and SIM ID define a row, never the display name. Each
completion is rendered separately within that row. No records are overwritten,
merged, averaged, ranked or de-duplicated by content. Zero, false, nested metrics,
structured summaries, plain summaries, missing data, and saved malformed JSON
text all remain visible. All field values are escaped; no returned HTML executes.
Long history loads in batches. The table itself has no internal scrollbar.

## Accuracy and existing limitations

- The existing completion writer generates a new ID for each callback. Retries
  may produce extra records. The UI says **recorded completions**, not a claimed
  count of unique simulation sessions. Callback idempotency is a separate change.
- Launches are not attempts or proof of active play. A started student has a
  launch but no completion. Removed enrolments retain records in the table and
  are excluded from summary counts.
- Team labels and submitting runner are shown only when present in the saved
  summary (`teamRunId`, `teamLabel`, `completedBy`). No invented team attribution.
- Completion and transcript tables have no reliable shared run key. All available
  transcripts are exposed in a separate history under that student/SIM/course;
  dates are not used to guess a completion association. The full envelope is
  rendered as labelled fields; referenced answer text is not invented.
- Course-less legacy records are included only if all recorded student launches
  for that account/SIM identify exactly this one non-null course. Ambiguous
  legacy data is excluded with an explicit notice. This is deliberately stricter
  than the older results endpoint and avoids exposing another course's result.
  Resolving ambiguous historical attribution would require a separate reviewed
  data repair; this feature makes no such changes.
- Existing storage may already have truncated summaries to 6000 characters and
  string metrics to 200 characters. This screen exposes what was saved, not
  information that the existing writers discarded.

## Validation and rollout

`platform/tools/faculty-sim-results-check.js` runs against an isolated PGlite
PostgreSQL engine using the actual schema, API, role/session guard and queries.
With `--browser` it also serves the actual faculty HTML and API, and uses
Playwright for Results button entry, duplicate names, history loads, escaping,
zero/false preservation, refresh, Back/Forward, pagination, responsive layouts,
no nested scrollbars, empty/error/retry states. It never uses DATABASE_URL.
CI installs pinned test dependencies in RUNNER_TEMP; production dependencies
and package.json are unchanged.

Local invocation (test-only dependencies must be available on NODE_PATH):

```
node platform/tools/faculty-sim-results-check.js --browser
node platform/tools/portal-navigation-browser-check.js
node platform/tools/check-faculty-student-results.js
node platform/tools/faculty-views-check.js
node platform/tools/course-catalogue-check.js
node platform/tools/links-check.js
node platform/tools/routing-check.js
```

No new schema migration, backfill, data import or simulation-engine change is
required. Existing `ensureTranscripts` is reused and may create that existing
optional table on an older deployment, exactly as the current result readers do.
Deploy API, reader module, faculty HTML, JS and CSS together. Validate with a
faculty-owned course after deployment. Rollback is a code revert; no reverse data
migration or deletion is needed. Keep production credentials out of preview
validation; the isolated suite needs no real accounts or databases.
