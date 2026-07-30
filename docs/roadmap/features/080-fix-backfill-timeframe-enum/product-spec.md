# Product Spec: fix-backfill-timeframe-enum

**Created**: 2026-07-29
**Type**: bug · **Severity**: SEV-3 (latent; no current user-visible breakage)

---

## Problem Statement

Every `BackfillJob` returned by `xstockstrat-ingest` carries a populated **deprecated** field and an
empty replacement field.

Observed live against the staging MCP server on 2026-07-29 (`get_backfill_status`, three jobs, all
identical in shape):

```json
{ "job_id": "9b744a89-…", "timeframe": "1d", "timeframe_enum": "TIMEFRAME_UNSPECIFIED" }
```

Confirmed in source rather than inferred from the response:

- `packages/proto/ingest/v1/ingest.proto:29-30` — `// DEPRECATED: use timeframe_enum. Removed in a
  future release once all callers migrate.` / `string timeframe = 3 [deprecated = true];`
- `packages/proto/ingest/v1/ingest.proto:39` — `xstockstrat.common.v1.Timeframe timeframe_enum = 12;`
- `services/xstockstrat-ingest/app/handlers/servicer.py:70-94` — `job_row_to_proto` sets
  `timeframe=row["timeframe"] or ""` and **never assigns `timeframe_enum`**, so it serializes as the
  zero value on every read.

**Why this matters despite being invisible today.** The proto's own migration note says the string
field is scheduled for removal. The read path populates *only* the field being deleted. On the day
`timeframe` is dropped, every consumer of `GetBackfillStatus` / `ListBackfillJobs` loses the timeframe
entirely — with no failing test to catch it, because nothing asserts the enum on the read path.

The write path already migrated correctly: the UI sends `timeframeEnum`
(`services/xstockstrat-ui/src/app/insights/backfills/page.tsx:112`), the agent sends
`timeframe_enum` (`services/xstockstrat-agent/app/client.py:752`), and ingest's own chunk dispatch
sets it (`servicer.py:257,458`). Only the **read** path was left behind — the same
"shipped the producer, forgot the other path" shape as ledger `fails.md` 2026-07-01 (C-10(b)).

## Secondary finding — the reason this survived review

**There is no `timeframe_enum` column in `ingest.backfill_jobs`.**
`services/xstockstrat-ingest/migrations/003_backfill_jobs.up.sql:9` declares only
`timeframe TEXT NOT NULL DEFAULT ''`, and
`services/xstockstrat-ingest/app/repositories/backfill_jobs.py:41-45` inserts only that column.
Two consequences:

1. **`_resume_job` reads a column that cannot exist.** `servicer.py:407` does
   `enum = row.get("timeframe_enum") or 0` — always `0`, always falling through to the string branch.
   Harmless, but it reads as if the column were real.
2. **A test asserts against a shape the database never produces.**
   `services/xstockstrat-ingest/tests/test_ingest_servicer.py:506` sets
   `job_row["timeframe_enum"] = 4` on a hand-built fixture. That is the exact defect family fixed by
   features 075 / 077 / 078 this cycle: *a test built against the shape the handler expects, rather
   than the shape the real source emits, so the mismatch never goes red.*

Because the enum is not stored, the fix must **derive** it, not read it.

## User Story

As a consumer of the backfill APIs, I want `BackfillJob.timeframe_enum` populated, so that reading the
timeframe does not depend on a field the proto has already scheduled for deletion.

## Functional Requirements

FR-1. `job_row_to_proto` (`servicer.py:70-94`) sets `timeframe_enum` by mapping the stored `timeframe`
string through the existing `_STR_TO_ENUM` (`servicer.py:35`). Reuse that map — do not introduce a
second one.

FR-2. `timeframe` (the deprecated string) keeps being populated exactly as today. This fix is additive;
removing the string is a separate, coordinated change once consumers migrate.

FR-3. An unmappable or empty stored string yields `TIMEFRAME_UNSPECIFIED` rather than raising —
`_STR_TO_ENUM.get(tf, 0)`, matching how `servicer.py:257` already handles it.

FR-4. Decide and record what to do about the two secondary findings:
  - `servicer.py:407`'s `row.get("timeframe_enum")` — dead branch against a non-existent column.
    Either drop it or add the column; do not leave it implying storage that does not exist.
  - `tests/test_ingest_servicer.py:506` — a fixture key the DB never produces. Whatever FR-4 decides
    for the column, the fixture must match the real row shape.

## Out of Scope

- Removing the deprecated `timeframe` string from the proto (breaking; needs the full
  `docs/runbooks/proto-versioning.md` flow).
- The `BackfillBarsRequest` write path — already correct.
- Any UI change. The UI reads the string today and keeps working either way.

## Affected Services

- `xstockstrat-ingest` — `app/handlers/servicer.py`, its tests. Possibly `migrations/` if FR-4 adds a
  column.

## Proto Contract Changes

- [x] None. Both fields already exist; only the producer changes.

## Config Key Changes

- [x] None.

## Database Changes

- [ ] **Open (FR-4)** — none required for the fix itself, since the enum is derived from the stored
  string. A column would only be added if FR-4 chooses to make `servicer.py:407` real rather than
  delete it.

## Acceptance Criteria

1. `GetBackfillStatus` and `ListBackfillJobs` return `timeframe_enum` matching the job's stored
   timeframe (`1d` → `TIMEFRAME_1DAY`, `1h` → `TIMEFRAME_1HOUR`, `15m` → `TIMEFRAME_15MIN`).
2. A test drives a job row with each supported timeframe string through `job_row_to_proto` and asserts
   **both** `timeframe` and `timeframe_enum` — the paired assertion is the point, since asserting only
   the string is what let this through.
3. An unmappable stored string yields `TIMEFRAME_UNSPECIFIED` and does not raise.
4. The fixture in `tests/test_ingest_servicer.py` matches the real `backfill_jobs` row shape — no key
   the database cannot produce.
5. Red-before-green recorded: the new assertion fails against the current tree.

## Open Questions

- [ ] FR-4: drop `servicer.py:407`'s dead read, or add a `timeframe_enum` column and populate it on
  insert? Deriving is sufficient and needs no migration; storing is only worth it if a future caller
  needs a timeframe the string map cannot express.
- [ ] Are there other messages in this service with the same deprecated-string/enum pair where only
  the string is populated on a read path? `ingest.proto:63-67` shows a second such pair — worth one
  grep before scoping.

## Feature Workflow Notes

Branch: `feature/fix-backfill-timeframe-enum` from `main-dev`.
Confirmed bug → routes via `docs/runbooks/bug-triage.md` Track C. SEV-3: latent, no user-visible
breakage today, so it does not warrant a hotfix.
