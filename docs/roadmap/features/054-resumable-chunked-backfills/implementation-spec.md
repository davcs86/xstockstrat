# Implementation Spec: resumable-chunked-backfills

**Status**: `in-progress`
**Created**: 2026-06-09
**Feature**: `docs/roadmap/features/054-resumable-chunked-backfills/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/resumable-chunked-backfills`

---

## Prerequisite Warning — read before executing any step

This feature (P2) is the third in the backfill-hardening initiative and **builds directly on
artifacts from two features that are NOT yet present on `main-dev`**. This was confirmed by
codebase survey on 2026-06-09:

- **P0 `durable-observable-backfills` (feature 052)** — provides the durable `ingest.backfill_jobs`
  table, the `ingest.backfill.max_concurrent_jobs` concurrency gate (as a *live* config-driven
  gate, not just a documented key), and the "interrupted job → resume infrastructure" hooks.
  **None of this exists on `main-dev` today.** Confirmed:
  - `services/xstockstrat-ingest/migrations/` last file is `002_add_signal_sources_registry.up.sql`
    — there is **no** `backfill_jobs` migration (`ls services/xstockstrat-ingest/migrations/`).
  - `IngestServicer` stores jobs **in-memory only** in `self._jobs: dict` — see
    `services/xstockstrat-ingest/app/handlers/servicer.py:40` (`self._jobs: dict[...] = {}`) and
    `:66` (`self._jobs[job_id] = job`). No DB persistence, no concurrency gate in `_run_backfill`
    (`:78`).
  - The `ingest.backfill.max_concurrent_jobs` key is documented in
    `services/xstockstrat-ingest/CLAUDE.md` but is **not seeded** in any config migration
    (`grep -rn "ingest.backfill" services/xstockstrat-config/migrations/*.up.sql` → no match) and
    is **not read** anywhere in ingest code (`grep -rn "max_concurrent" services/xstockstrat-ingest/`
    → no match).
- **P1 `backfill-backtest-coverage` (feature 053)** — provides the `GetDataCoverage` RPC on
  `MarketDataService`, consumed by the `GAPS_ONLY` fill mode (FR-4). **This RPC does not exist**:
  `packages/proto/marketdata/v1/marketdata.proto:12-30` defines only `StreamBars`, `StreamQuotes`,
  `GetBars`, `GetLatestQuote`, `BackfillBars`, `ListAssets` — no `GetDataCoverage`.

**Per `docs/roadmap/features/merge-order.md`, feature 054 is blocked by both 052 and 053
(both `Resolved: No`).** Do **not** run `/sdd-execute` against this spec until 052 and 053 are
merged to `main-dev` and `launched`. When they are, **re-run `/sdd-spec resumable-chunked-backfills`**
so this spec can be re-grounded against the real (post-052/053) `ingest.backfill_jobs` schema,
`max_concurrent_jobs` gate implementation, and `GetDataCoverage` signature — the references below
that depend on 052/053 are necessarily **forward-looking** and flagged inline as such.

### Positive findings (independent of 052/053)

- **Resume idempotency is safe at the storage layer** — the product-spec /sdd-review explicitly
  flagged "confirm marketdata's OHLCV write is an idempotent upsert (not insert-only)". **Confirmed
  it is an upsert**: `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:42-47`:
  `INSERT INTO marketdata.ohlcv (...) ... ON CONFLICT (symbol, timeframe, time) DO UPDATE SET ...`.
  Re-fetching a chunk's entire window on resume therefore overwrites rather than duplicates rows.
  **No marketdata code change is required for idempotency** — Affected Services note in the product
  spec ("minimal/no new code beyond P1") holds.
- `bars_total` already exists on `BackfillJob` (`packages/proto/ingest/v1/ingest.proto:31`,
  field 7) — FR-5 only needs to start *populating* it, not add the field.

---

## Execution Summary

The change is owned almost entirely by `xstockstrat-ingest`. Order: (1) extend the proto with an
additive `FillMode` enum + chunk-progress fields and regenerate stubs; (2) add the
`ingest.backfill_chunks` migration (run-order after 052's `backfill_jobs` migration); (3) seed the
three new config keys; (4) implement the chunk planner, chunk repository, resume-on-startup, and
`GAPS_ONLY` mode in the servicer, gated by the new concurrency key; (5) test; (6) update the
historical-backfill runbook. `xstockstrat-marketdata` needs **no code change** — its OHLCV upsert
already makes chunk re-fetch idempotent, and it merely supplies the `GetDataCoverage` RPC delivered
by 053.

## Step Dependencies

- Step 2 (`proto-gen`) requires Step 1 (`proto`): stubs regenerate from the edited `.proto`.
- Step 4 (`migration`) requires feature 052's `backfill_jobs` migration to exist (FK target +
  correct NNN run-order). NNN is provisional — see Step 4.
- Step 6 (`service`) requires Steps 2, 4, 5: it imports regenerated `FillMode`/chunk fields, writes
  to the `ingest.backfill_chunks` table, and reads the three new config keys.
- Step 6 also requires feature 052 (the `ingest.backfill_jobs` table + `max_concurrent_jobs` gate it
  extends) and feature 053 (the `GetDataCoverage` RPC the `GAPS_ONLY` path calls).
- Step 7 (`test`) covers Step 6 (`service`).
- Step 8 (`config`) is independent of code but pairs with Step 6's reads; can land any time after
  052's config seed exists (to avoid colliding with `max_concurrent_jobs`).
- Step 9 (`docs`) should land last so the runbook describes shipped behavior.

---

### Step 1 — proto: add FillMode enum and chunk-progress fields to ingest.proto

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/ingest/v1/ingest.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` pass; `xstockstrat-ingest` (service owner) — additive fields match servicer needs; `xstockstrat-marketdata` (service owner) — no marketdata proto change here

**Codebase Evidence**:
- `TriggerBackfillRequest` on the stacked base ends at field 5 (`timeframe_enum = 5`, added by feature 053). **Re-spec: next free field number is `6`** (was 5 at spec time).
- `BackfillJob` on the stacked base ends at field 12 (`failed_symbols = 11` from 052, `timeframe_enum = 12` from 053). `bars_total` already present at field 7. **Re-spec: next free field numbers are `13, 14`** (were 11, 12 at spec time).
- Existing enum convention (zero-value `_UNSPECIFIED = 0`): `BackfillStatus` at
  `packages/proto/ingest/v1/ingest.proto:37-44` (`BACKFILL_STATUS_UNSPECIFIED = 0;`).
- Root CLAUDE.md proto governance: "Prefer enums over strings … Every enum must have a zero-value
  `<NAME>_UNSPECIFIED = 0` sentinel." The product spec (Proto Contract Changes) prefers an explicit
  enum over reusing the `overwrite` bool.

**Instructions**:
1. Add a new enum after `BackfillStatus` (around `:44`):
   ```proto
   enum FillMode {
     FILL_MODE_UNSPECIFIED = 0;  // treated as FILL_MODE_FULL by the server
     FILL_MODE_FULL = 1;         // fetch the entire requested range (current behavior)
     FILL_MODE_GAPS_ONLY = 2;    // fetch only ranges missing per GetDataCoverage
   }
   ```
2. In `TriggerBackfillRequest`, add field 6 (keep the existing `overwrite` bool for back-compat —
   do not remove it):
   ```proto
   FillMode fill_mode = 6;  // FR-4; UNSPECIFIED == FULL. Independent of `overwrite`. (re-spec: 6, 053 took 5)
   ```
3. In `BackfillJob`, add fields 13 and 14 for FR-5 per-chunk monitoring (re-spec: 13/14, 052+053 took 11/12):
   ```proto
   int32 chunks_total = 13;      // planned chunk count
   int32 chunks_completed = 14;  // chunks in COMPLETED state
   ```
4. Do not renumber or remove any existing field.

**Verification**:
- `cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/resumable-chunked-backfills"`
  (per root CLAUDE.md proto governance; `buf breaking` must pass since all changes are additive).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/python/**` — modify (regenerated)
- `packages/proto/gen/go/**` — modify (regenerated)
- `packages/proto/gen/ts/**` — modify (regenerated)

**Reviewers**: _inherited from Step 1_ — Proto Reviewer; `xstockstrat-ingest` (service owner); `xstockstrat-marketdata` (service owner)

**Codebase Evidence**:
- Generated stubs are consumed by ingest as `from gen.ingest.v1 import ingest_pb2` —
  `services/xstockstrat-ingest/app/handlers/servicer.py:12`.
- Repo codegen entry point: `./scripts/buf-gen.sh` (root CLAUDE.md §Generating Proto Stubs).
- Fallback if `buf` is unavailable (recorded in phase3-deviations.md §"Proto stub regeneration"):
  `python3 -m grpc_tools.protoc -I. -I/usr/local/include --python_out=gen/python
  --grpc_python_out=gen/python $(find . -name "*.proto" ! -path "./gen/*" | sort)` run from
  `packages/proto/`.

**Instructions**:
1. From repo root, run `./scripts/buf-gen.sh` to regenerate TS, Python, and Go stubs and compile the
   TS package.
2. If `buf` is unavailable, use the grpc_tools fallback above for the Python stubs (the only stubs
   this feature's ingest code consumes).
3. Commit all regenerated files.

**Verification**:
- `cd packages/proto && python3 -c "from gen.ingest.v1 import ingest_pb2; print(ingest_pb2.FILL_MODE_GAPS_ONLY); print(ingest_pb2.BackfillJob.DESCRIPTOR.fields_by_name['chunks_total'].number)"`
  → prints `2` and `11`.

---

### Step 4 — migration: add ingest.backfill_chunks table

> Numbered Step 4 (not 3) to keep `service`/`test`/`config`/`docs` step numbers stable; there is no
> Step 3. (Ordering in the file is logical, not by integer gaps.)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/migrations/004_add_backfill_chunks.up.sql` — create
- `services/xstockstrat-ingest/migrations/004_add_backfill_chunks.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps), up+down pair present, index correctness, run-order vs. feature 052's `backfill_jobs` migration; `xstockstrat-ingest` (service owner) — chunk schema matches planner/resume logic

**Codebase Evidence**:
- Last migration on `main-dev` today: `services/xstockstrat-ingest/migrations/002_add_signal_sources_registry.up.sql`
  (confirmed via `ls services/xstockstrat-ingest/migrations/`). **Re-spec: 052 added `003_backfill_jobs`, so this migration is `004`.** The parent `ingest.backfill_jobs(job_id)` (uuid PK) exists on the stacked base.
  golang-migrate requires sequential numbering with no gaps (phase3-deviations.md §"Migration
  naming"). **Resolved: `004`.**
- This table has a FK to `ingest.backfill_jobs(job_id)` — **a table that does not yet exist on
  `main-dev`** (provided by feature 052). The exact PK column name/type of `backfill_jobs.job_id`
  must be read from 052's migration before writing this FK. The product spec assumes
  `job_id` is the parent key.
- golang-migrate `.up.sql`/`.down.sql` convention is the repo standard (phase3-deviations.md
  §"Migration naming"); existing examples: `001_newsletter_signals.up.sql`,
  `002_add_signal_sources_registry.up.sql`.

**Instructions**:
1. (Confirmed on stacked base) parent is `ingest.backfill_jobs(job_id uuid PRIMARY KEY)` from 052's `003_backfill_jobs.up.sql`. This migration is `004`.
2. Create `NNN_add_backfill_chunks.up.sql` per the product-spec Database Changes section:
   ```sql
   CREATE TABLE ingest.backfill_chunks (
       chunk_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       job_id        uuid NOT NULL REFERENCES ingest.backfill_jobs(job_id) ON DELETE CASCADE,
       symbols       text[] NOT NULL,
       range_start   timestamptz NOT NULL,
       range_end     timestamptz NOT NULL,
       status        smallint NOT NULL DEFAULT 0,  -- mirrors BackfillStatus enum ordinals
       bars_written  bigint NOT NULL DEFAULT 0,
       error         text,
       attempt_count int NOT NULL DEFAULT 0,
       started_at    timestamptz,
       completed_at  timestamptz
   );
   CREATE INDEX idx_backfill_chunks_job_status ON ingest.backfill_chunks (job_id, status);
   ```
   - `ON DELETE CASCADE` implements the resolved retention decision (chunks cascade-delete with the
     parent job — context.md /sdd-review note).
   - The `(job_id, status)` index serves the resume query (FR-2/FR-3: select `PENDING`/`FAILED`
     chunks for a job).
   - This is a plain table (operational uuid-keyed state), **not** a hypertable — matches the
     product-spec note "Likely a plain table … DBA to confirm" and contrasts with ingest's only
     hypertable (`ingest.newsletter_signals`).
3. Create the matching `NNN_add_backfill_chunks.down.sql`:
   ```sql
   DROP TABLE IF EXISTS ingest.backfill_chunks;
   ```

**Verification**:
- `./scripts/db-migrate.sh` applies cleanly with no NNN gap error (golang-migrate enforces sequential
  numbering); then `psql … -c "\d ingest.backfill_chunks"` shows the table, FK to
  `ingest.backfill_jobs`, and the `idx_backfill_chunks_job_status` index. Roll back with the down
  migration to confirm the pair is balanced.

---

### Step 6 — service: chunk planner, chunk repository, resume, and GAPS_ONLY mode

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/repositories/backfill_chunks.py` — create (**Not found** — no
  chunk/job repository exists today; `services/xstockstrat-ingest/app/repositories/` contains only
  `signal_sources.py` per `ls`)
- `services/xstockstrat-ingest/app/main.py` — modify (invoke resume-on-startup)
- `services/xstockstrat-ingest/app/config/watcher.py` — modify (add backfill config helpers)

**Reviewers**: `xstockstrat-ingest` (service owner) — idempotent chunk execution, resume-after-restart correctness, concurrency-gate interaction, no double-fetch

**Codebase Evidence**:
- Current monolithic backfill: `IngestServicer._run_backfill` issues **one** `BackfillBars` call for
  the whole range — `services/xstockstrat-ingest/app/handlers/servicer.py:78-130` (the single
  `await self._marketdata.BackfillBars(...)` at `:84`). This is what the chunk loop replaces.
- `TriggerBackfill` creates the job and fires the background task —
  `services/xstockstrat-ingest/app/handlers/servicer.py:57-76`. Note it currently builds the
  `BackfillJob` in-memory (`self._jobs[job_id] = job`, `:66`); **after 052 this will write to
  `ingest.backfill_jobs` instead** — coordinate with 052's job repository rather than re-implementing.
- Header propagation pattern already present and correct (must be reused for any new outbound call):
  `propagation_meta = [(k, v) for ... if k in ("x-user-id", "x-access-scope", "x-trace-id")]` —
  `services/xstockstrat-ingest/app/handlers/servicer.py:67-71` and `:176-180`. The marketdata stub
  call at `:84` already passes `metadata=propagation_meta`. **The new per-chunk `BackfillBars` calls
  and the new `GetDataCoverage` call (for GAPS_ONLY) MUST pass the same `propagation_meta`** (per
  docs/patterns/header-propagation.md — Python per-method metadata pattern).
- Marketdata stub already wired: `self._marketdata = marketdata_pb2_grpc.MarketDataServiceStub(...)`
  — `services/xstockstrat-ingest/app/handlers/servicer.py:37`. The `GAPS_ONLY` path calls
  `self._marketdata.GetDataCoverage(...)` — **RPC delivered by feature 053; confirm its exact
  request/response message names from the merged 053 proto before coding** (not present on
  `main-dev`: `grep -n GetDataCoverage packages/proto/marketdata/v1/marketdata.proto` → no match).
- asyncpg pool is available as `self._db` (may be `None`) —
  `services/xstockstrat-ingest/app/handlers/servicer.py:39`; pool created in `main.py:54`
  (`db_pool = await asyncpg.create_pool(...)`). Repository functions take the pool as first arg —
  pattern in `services/xstockstrat-ingest/app/repositories/signal_sources.py` (e.g.
  `list_all_sources(self._db, ...)` called at servicer `:389`).
- Config read helpers exist (`get_int`/`get_bool`/`get_str`) —
  `services/xstockstrat-ingest/app/config/watcher.py:60-90`. There are **no** backfill-specific
  helper properties yet (the file's only domain helpers are `sandbox_*` at `:92-106`, left over
  from the indicators template — note the stale class docstring at `:1-2`/`:16`).
- Concurrency: feature 052 introduces `ingest.backfill.max_concurrent_jobs` as a live gate. This
  feature adds a **separate** chunk-level gate `ingest.backfill.max_concurrent_chunks` (default 3) —
  resolved decision (context.md). **Reuse 052's gating mechanism (e.g. its asyncio.Semaphore) as the
  reference pattern; do not bypass the job gate.**

**Instructions**:
1. **Config helpers** (`watcher.py`): add three property helpers mirroring the `sandbox_*` pattern at
   `:92-106`:
   - `backfill_chunk_max_bars` → `get_int("ingest.backfill.chunk_max_bars", default=<see Step 8>)`
   - `backfill_chunk_window_days` → `get_int("ingest.backfill.chunk_window_days", default=<see Step 8>)`
   - `backfill_max_concurrent_chunks` → `get_int("ingest.backfill.max_concurrent_chunks", default=3)`
   (Also fix the stale "for xstockstrat-indicators" docstring while here — optional.)
2. **Chunk repository** (`backfill_chunks.py`, new): module-level async functions taking the pool as
   the first arg (signal_sources.py style):
   - `plan_chunks(symbols, timeframe, range_start, range_end, window_days, max_bars)` →
     pure function returning a list of chunk descriptors. Primary split by time window
     (`chunk_window_days`), secondary by symbol batch; never let a chunk's estimated bar count exceed
     `chunk_max_bars` (FR-1; density-driven sizing per resolved decision — use the timeframe
     bars/day estimates from the runbook's Timeframe Guide: 1m≈390, 5m≈78, 1h≈7, 1d≈1).
   - `insert_chunks(pool, job_id, chunks)` → bulk-insert planned chunks with `status=0` (PENDING).
   - `get_incomplete_chunks(pool, job_id)` → `SELECT ... WHERE job_id=$1 AND status IN (PENDING,
     FAILED)` (uses the `(job_id, status)` index from Step 4).
   - `mark_chunk_running/completed/failed(pool, chunk_id, ...)` → status + `bars_written` +
     `attempt_count` + timestamp updates.
   - `list_jobs_with_incomplete_chunks(pool)` → for resume-on-startup.
3. **Servicer `_run_backfill` rewrite** (`servicer.py:78`): replace the single `BackfillBars` call
   with: plan chunks → persist via `insert_chunks` → set `BackfillJob.chunks_total` and `bars_total`
   (sum of planned chunks, FR-5) → execute incomplete chunks under an
   `asyncio.Semaphore(self._cfg.backfill_max_concurrent_chunks)` (FR-6), each calling
   `self._marketdata.BackfillBars(...)` for **its own window only**, passing `metadata=propagation_meta`
   → on clean fetch `mark_chunk_completed` and advance `bars_processed` += chunk bars and
   `chunks_completed` += 1 (FR-5, monotonic) → on error `mark_chunk_failed` and continue (job becomes
   PARTIAL/FAILED). A chunk is COMPLETED **only** after a clean fetch (resolved idempotency decision).
4. **GAPS_ONLY mode** (`TriggerBackfill`/`_run_backfill`): when `request.fill_mode ==
   ingest_pb2.FILL_MODE_GAPS_ONLY`, before planning, call `self._marketdata.GetDataCoverage(...)`
   (053 RPC, `metadata=propagation_meta`) per symbol to compute missing ranges, and plan chunks over
   only those gaps (FR-4). `FILL_MODE_UNSPECIFIED`/`FILL_MODE_FULL` → plan over the full requested
   range (current behavior).
5. **Resume on startup** (`main.py`): after the db pool is created (`main.py:54`) and before/just
   after `grpc_server.start()`, schedule a resume task that calls
   `list_jobs_with_incomplete_chunks(db_pool)` and re-runs `_run_backfill`'s chunk loop for each —
   re-fetching incomplete chunks' full windows (safe via marketdata's `ON CONFLICT DO UPDATE` upsert,
   confirmed in `marketdata_repo.go:45`). This supersedes P0 FR-3's "mark interrupted FAILED" — coordinate
   with 052's startup hook so there is one resume path, not two.

**Verification**:
- Lint: `cd services/xstockstrat-ingest && ruff check . && ruff format --check .`
- Behavioral verification is in the paired Step 7 (coverage + unit assertions).
- Header propagation: `grep -n "metadata=propagation_meta" services/xstockstrat-ingest/app/handlers/servicer.py`
  must show the per-chunk `BackfillBars` call and the `GetDataCoverage` call both passing it
  (in addition to the existing lines at `:84`/`:118`/`:272`).

---

### Step 7 — test: chunk planner, resume, GAPS_ONLY, concurrency

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_backfill_chunks.py` — create
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify (add chunked-backfill cases)

**Reviewers**: `xstockstrat-ingest` (service owner) — test coverage of resume/idempotency/concurrency paths

**Codebase Evidence**:
- Existing test harness mocks all deps and pokes servicer internals directly:
  `make_servicer()` builds `IngestServicer(cfg, marketdata_ch, ledger_ch, db_pool=None)` and tests
  manipulate `svc._jobs` — `services/xstockstrat-ingest/tests/test_ingest_servicer.py:23-60`. Use
  `AsyncMock` for the marketdata stub (`BackfillBars`, `GetDataCoverage`) and a mocked pool.
- Coverage gate for ingest is **40%** (root CLAUDE.md §CI/CD; `services/xstockstrat-ingest/CLAUDE.md`
  §Running Tests shows `uv run pytest --cov=app --cov-fail-under=40`).

**Instructions**:
1. `test_backfill_chunks.py` — unit-test the pure `plan_chunks`: a multi-year × multi-symbol 1d range
   splits into the expected number of chunks; no chunk exceeds `chunk_max_bars`; 1m density yields
   more/smaller chunks than 1d for the same range (density-driven sizing, FR-1).
2. Servicer tests (`test_ingest_servicer.py`):
   - **Resume idempotency (AC-2)**: seed mocked incomplete chunks; run the resume path; assert only
     `PENDING`/`FAILED` chunks trigger `BackfillBars` (COMPLETED ones do not) and `bars_processed` is
     not double-counted.
   - **GAPS_ONLY (AC-3)**: with `fill_mode=FILL_MODE_GAPS_ONLY`, assert `GetDataCoverage` is called and
     chunks cover only the returned missing ranges.
   - **Concurrency (AC-4)**: assert no more than `max_concurrent_chunks` `BackfillBars` calls are
     in-flight concurrently (e.g. via a counting AsyncMock side-effect).
   - **Propagation**: assert the per-chunk `BackfillBars` and `GetDataCoverage` calls receive the
     three propagation headers in `metadata`.

**Verification**:
- `cd services/xstockstrat-ingest && uv run pytest --cov=app --cov-fail-under=40` — confirm ≥ 40% and
  all new tests pass.
- Lint (if not run in Step 6): `cd services/xstockstrat-ingest && ruff check . && ruff format --check .`

---

### Step 8 — config: seed the three new backfill chunk keys

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/005_ingest_backfill_chunking.up.sql` — create
- `services/xstockstrat-config/migrations/005_ingest_backfill_chunking.down.sql` — create

**Reviewers**: `xstockstrat-config` (service owner) — config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping

**Codebase Evidence**:
- Config keys are seeded as `INSERT INTO config.config_values (...)` migrations with one row per
  environment (`dev`, `production`), `trading_mode='all'`, and `ON CONFLICT (namespace, key,
  environment, trading_mode) DO NOTHING` — pattern in
  `services/xstockstrat-config/migrations/004_agent_config.up.sql:5-14`.
- Last config migration on `main-dev`: `004_agent_config.up.sql` (confirmed via
  `ls services/xstockstrat-config/migrations/`). **Re-spec: 052 added NO config migration (it relies on watcher defaults), so the last config migration is `004_agent_config`; this seed migration is `005`.**
- The three keys are **absent** today: `grep -rn "ingest.backfill" services/xstockstrat-config/migrations/`
  → no match (the existing `ingest.backfill.*` keys live only in ingest's CLAUDE.md doc table, not
  seeded — they come from 052).

**Instructions**:
1. (Re-spec: NNN = `005`.) Create the up migration seeding three keys for
   both `dev` and `production` (`trading_mode='all'`, `ON CONFLICT ... DO NOTHING`), following the
   004 pattern exactly:
   - `ingest` / `backfill.chunk_max_bars` (int) — hard per-chunk bar cap (FR-1). Choose a default
     well under the runbook's ~1M ceiling (e.g. `200000`); confirm with the ingest owner.
   - `ingest` / `backfill.chunk_window_days` (int) — default time-window chunk size (FR-1), e.g. `90`.
   - `ingest` / `backfill.max_concurrent_chunks` (int) — chunk concurrency gate, default `3` (FR-6,
     resolved decision).
   Set `consuming_service='xstockstrat-ingest'`. Use the same default in `value_data` and
   `default_value`, matching the watcher defaults chosen in Step 6.
2. Create the matching down migration deleting only these three keys.
3. Document the three keys in `services/xstockstrat-ingest/CLAUDE.md` §"Config Keys Consumed"
   (append to the existing `ingest.backfill.*` rows) — required by the product spec and root CLAUDE.md
   config governance ("defaults declared in each service's CLAUDE.md").

**Verification**:
- `./scripts/db-migrate.sh` applies cleanly (no NNN gap); `psql … -c "SELECT key, value_data FROM
  config.config_values WHERE namespace='ingest' AND key LIKE 'backfill.chunk%' OR key =
  'backfill.max_concurrent_chunks';"` returns the three keys for dev+production. Roll back to confirm
  the down migration removes exactly those rows.

---

### Step 9 — docs: replace the manual per-year loop in historical-backfill.md

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/historical-backfill.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- The manual split-by-year `for`-loop the product spec (AC-5) wants replaced is at
  `docs/runbooks/historical-backfill.md:159-178` ("Large Backfill Strategy" → the `for year in 2020
  2021 2022 2023; do curl … done` block).
- The trigger example uses `overwrite=False` — `historical-backfill.md:66`; the gRPC snippet builds
  `TriggerBackfillRequest(...)` at `:58-66`. These should gain a `fill_mode` note for GAPS_ONLY.
- Note: the runbook still references the **removed** webhook (`curl … :8055/webhooks/trigger-backfill`,
  `:71-82` and `:169`) — ingest is now gRPC-only (`services/xstockstrat-ingest/CLAUDE.md` §Ports).
  Replacing the loop is a good moment to drop those stale `curl` webhook examples in favor of the
  gRPC `TriggerBackfill` call already shown at `:42-68`.

**Instructions**:
1. Replace the "Large Backfill Strategy" manual `for`-loop (`:159-178`) with guidance that a single
   `TriggerBackfill` call is now chunked server-side: trigger one job over the full range; the server
   splits it into chunks (bounded by `ingest.backfill.chunk_max_bars` /
   `ingest.backfill.chunk_window_days`) and resumes automatically after an interruption.
2. Document the new `fill_mode` field on `TriggerBackfillRequest`: `FILL_MODE_FULL` (default for
   manual triggers) vs `FILL_MODE_GAPS_ONLY` (recommended for routine refreshes; agent-scheduled
   refreshes default to it — resolved decision). Update the gRPC snippet at `:58-66` accordingly.
3. Optionally remove the stale `:8055/webhooks/trigger-backfill` `curl` examples (`:71-82`).

**Verification**:
- Manual read: the per-year `for`-loop is gone; the runbook describes one chunked, resumable job and
  the `fill_mode` options; no `markdownlint`/CI link breakage (no new internal links added).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
