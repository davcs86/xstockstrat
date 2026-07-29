# Product Spec: fix-backfill-timeframe-enum

**Created**: 2026-07-29
**Last Updated**: 2026-07-29 (scope widened to `marketdata`'s `Bar` by user decision)
**Type**: bug · **Severity**: SEV-3 (latent; no current user-visible breakage)

---

## Problem Statement

Every `BackfillJob` returned by `xstockstrat-ingest` carries a populated **deprecated** field and an
empty replacement field. The same is true of every `Bar` returned by `xstockstrat-marketdata` —
found while sweeping for other instances, and folded into this feature (see § marketdata below).
The slug still says "backfill" because that is where the defect was first observed; the scope is
**every producer of a deprecated-string/enum pair**.

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
string through the existing `_STR_TO_ENUM` (`servicer.py:35`), normalizing through the existing
`_TF_ALIASES` (`servicer.py:37-44`) first. Reuse both existing maps — do not introduce a second one.
The alias hop is not optional: the column is `TEXT NOT NULL DEFAULT ''` with no CHECK constraint
(`003_backfill_jobs.up.sql:9`), so nothing guarantees a canonical value, and `_resume_job`
(`servicer.py:408-410`) already resolves aliases. Mapping through `_STR_TO_ENUM` alone would leave a
legacy `"1Day"` row resolving on the resume path but `UNSPECIFIED` on the read path — a narrower
copy of the bug being fixed.

FR-2. `timeframe` (the deprecated string) keeps being populated exactly as today, byte-for-byte
(including non-canonical values — FR-1 normalizes only what feeds the enum). This fix is additive;
removing the string is a separate, coordinated change once consumers migrate.

FR-3. An unmappable or empty stored string yields `TIMEFRAME_UNSPECIFIED` rather than raising —
`.get(…, 0)` on the map lookup, matching how `servicer.py:257` already handles it.

FR-4. **Derive the enum; add no column.** Resolves Open Question 1 (evidence below):
  - `servicer.py:407`'s `enum = row.get("timeframe_enum") or 0` is **deleted**, along with the
    `_ENUM_TO_STR` branch it feeds. `_resume_job` derives its timeframe from the stored string via
    the same alias normalization FR-1 uses.
  - `tests/test_ingest_servicer.py:506`'s `job_row["timeframe_enum"] = 4` is **removed**; the fixture
    drives the real row shape (`timeframe` only). That the resume test still passes is the evidence
    the deleted branch was dead.

### marketdata — the same defect on the hotter read path

Folded into this feature by user decision (2026-07-29) rather than deferred: it is the identical
producer-side gap, and splitting one defect family across two features invites fixing half of it.
`Bar` (`marketdata.proto:44-58`) carries `string timeframe = 10 [deprecated = true]` (`:55`) and
`Timeframe timeframe_enum = 12` (`:57`); `TimeframeEnum` appears exactly once in the whole service
(`internal/service/marketdata_service.go:120`) and only on the *request* side.

FR-5. Every `Bar` construction site sets `TimeframeEnum` alongside the existing `Timeframe` string,
via the existing `internal/timeframe` package — no new mapping table:
  - `internal/repository/marketdata_repo.go:112-124` — DB read path; `tf` is the scanned canonical
    column, so `timeframe.FromString(tf)`.
  - `internal/alpaca/client.go:199-205` (single-symbol) and `:305-311` (multi-symbol) — `timeframe`
    is the canonical string parameter already threaded through both.
  - `internal/alpaca/stream.go:255-260` — see FR-6; this one is not mechanical.

FR-6. **Streamed bars are labelled `TIMEFRAME_1MIN`, not `UNSPECIFIED`.** `streamBarTimeframe = "1m"`
(`stream.go:28`) because Alpaca's `bars` channel emits 1-minute bars only, and
`timeframe.FromString("1m")` returns `TIMEFRAME_UNSPECIFIED` **by design** (`timeframe.go:66-70` —
sub-15m intervals were removed so callers *requesting* them get an error). Routing the stream site
through `FromString` would therefore be a no-op dressed as a fix. A streamed bar genuinely *is* a
1-minute bar, and `TIMEFRAME_1MIN = 1 [deprecated = true]` (`common.proto:82`) still exists precisely
so already-produced data can be described (**PROTO-2**, deprecate-don't-delete). Set it explicitly
and comment why. *This is the one judgement call in the feature — flagged for the `/sdd-design`
adversarial round.*

FR-7. The deprecated `Timeframe` string keeps its current value at every site (`"1m"` on the stream
path included) — same additive rule as FR-2. `timeframe.FromString` is not modified: its refusal of
`"1m"` is load-bearing for request resolution.

## Out of Scope

- Removing the deprecated `timeframe` string from the proto (breaking; needs the full
  `docs/runbooks/proto-versioning.md` flow).
- The `BackfillBarsRequest` write path — already correct.
- Any UI change. The UI reads the string today and keeps working either way.
- Any **request**-message timeframe handling in either service. `TriggerBackfillRequest`
  (`ingest.proto:64`), `StreamBarsRequest` (`marketdata.proto:73`), `GetBarsRequest` (`:86`) and
  `BackfillBarsRequest` (`:104`) all carry the same deprecated pair, but they are *consumed* — ingest
  via `_canonical_timeframe` (`servicer.py:47`) and marketdata via `timeframe.Resolve`
  (`marketdata_service.go:120`), both of which already prefer the enum. The defect exists only where
  a service is the **producer**.

## Affected Services

- `xstockstrat-ingest` (Python) — `app/handlers/servicer.py`, its tests. No `migrations/` change (FR-4).
- `xstockstrat-marketdata` (Go) — `internal/repository/marketdata_repo.go`,
  `internal/alpaca/client.go`, `internal/alpaca/stream.go`, their tests. No `migrations/` change:
  `Bar.timeframe_enum` is derived from the already-stored canonical string, exactly as in ingest.

## Proto Contract Changes

- [x] None. Both fields already exist; only the producer changes.

## Config Key Changes

- [x] None.

## Database Changes

- [x] **None.** FR-4 derives the enum from the stored string, so no column and no migration. The
  `migrations/` directory is untouched — `003_backfill_jobs.up.sql` is applied and must never be
  edited (**F-01**).

## Acceptance Criteria

1. All three `job_row_to_proto` read paths — `GetBackfillStatus` (`servicer.py:513`),
   `ListBackfillJobs` (`:539`), and `CancelBackfill` (`:583`, which also returns a `BackfillJob` per
   `ingest.proto:16`) — return `timeframe_enum` matching the job's stored timeframe
   (`1d` → `TIMEFRAME_1DAY`, `1h` → `TIMEFRAME_1HOUR`, `15m` → `TIMEFRAME_15MIN`). The shared mapper
   fixes all three structurally; naming them is the point, since untested parity is what let this ship.
2. A test drives a job row with each supported timeframe string through `job_row_to_proto` and asserts
   **both** `timeframe` and `timeframe_enum` — the paired assertion is the point, since asserting only
   the string is what let this through.
3. An unmappable or empty stored string yields `TIMEFRAME_UNSPECIFIED` and does not raise; a legacy
   alias row (`1Day`) yields `TIMEFRAME_1DAY` while its `timeframe` string is returned unchanged.
4. The fixture in `tests/test_ingest_servicer.py` matches the real `backfill_jobs` row shape — no key
   the database cannot produce.
5. Red-before-green recorded in both services: each new assertion fails against the current tree.
6. Every `Bar` returned by `GetBars` (DB path) and by the Alpaca fetch paths carries a
   `TimeframeEnum` matching its `Timeframe` string, asserted **paired** — same rule as AC-2, so the
   Go suite cannot go green on the string alone.
7. A streamed bar carries `TIMEFRAME_1MIN` with `Timeframe == "1m"` (FR-6), and
   `timeframe.FromString("1m")` still returns `TIMEFRAME_UNSPECIFIED` — i.e. the request-resolution
   refusal is provably untouched by the labelling change.

## Open Questions

Both closed at the `/sdd-review product-spec` gate (2026-07-29); the reasoning is repeated in
`context.md` so a later reader does not have to reconstruct it.

- [x] **FR-4: derive, do not store.** Closed. `_canonical_timeframe` (`servicer.py:47`) already
  canonicalizes on the write path — it prefers the request's enum and stores `15m`/`1h`/`1d` — so the
  enum is a pure function of a column that already exists. A `timeframe_enum` column would duplicate
  state, need migration `008_*`, and create two values that can disagree. Nothing in the product needs
  a timeframe the string map cannot express (`_STR_TO_ENUM` covers every supported interval; sub-15m
  was deliberately removed, `common.proto:82-83`). Revisit only if a stored timeframe ever needs to
  outlive the string vocabulary.
- [x] **No second read-path instance inside this service.** Closed.
  `grep 'deprecated = true' packages/proto/ingest/v1/ingest.proto` returns exactly two hits: `:30`
  (`BackfillJob` — this bug) and `:64` (`TriggerBackfillRequest`). The latter is a **request** message
  that ingest *consumes* via `_canonical_timeframe`, which already prefers the enum — the write path
  the spec declares correct. The gap only exists where ingest is the *producer*, so this stays one fix
  for one message. The sweep did surface the same defect one service over, in `marketdata`'s `Bar` —
  see § Out of Scope for why it is deferred rather than folded in.

## Feature Workflow Notes

Branch: `feature/fix-backfill-timeframe-enum` from `main-dev`.
Confirmed bug → routes via `docs/runbooks/bug-triage.md` Track C. SEV-3: latent, no user-visible
breakage today, so it does not warrant a hotfix.
