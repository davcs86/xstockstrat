# Implementation Spec: durable-observable-backfills

**Status**: `complete`
**Created**: 2026-06-08
**Feature**: `docs/roadmap/features/052-durable-observable-backfills/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/durable-observable-backfills`

---

## Execution Summary

Proto changes land first (Step 1 + regen Step 2) so both services can compile against the new
`BackfillJob.failed_symbols` and `BackfillBarsResponse.expected_bars` fields. The DB migration
(Step 3) creates the durable `ingest.backfill_jobs` table next, since the repository (Step 4) and
all servicer rewrites depend on it existing. The new config key + watcher accessors (Step 5) are
independent and feed the retry/concurrency logic. The bulk of the work is the ingest servicer
rewrite (Steps 6–8): durable job repo wiring + notify channel, lifecycle events + alert + retry +
concurrency gate, and startup reconciliation. marketdata's `expected_bars` estimate (Step 9) is a
small, independent Go change. Tests (Steps 10–11) pair with the two service steps. Docs (Step 12)
reconciles `xstockstrat-ingest/CLAUDE.md`.

## Step Dependencies

- Step 2 (`proto-gen`) requires Step 1 (`proto`): stubs regenerated from the edited `.proto` files.
- Step 4 (`service`: repo) requires Step 3 (`migration`): repository reads/writes the new table.
- Step 6 (`service`: servicer durability) requires Step 2 (new proto fields), Step 4 (repository),
  and Step 5 (config accessors).
- Step 7 (`service`: lifecycle/alert/retry/concurrency) requires Step 6 and Step 2 + Step 5.
- Step 8 (`service`: startup reconciliation) requires Step 4 (repo) and Step 6 (servicer DB wiring).
- Step 9 (`service`: marketdata `expected_bars`) requires Step 2 (regenerated Go stub). Independent
  of the ingest steps otherwise; ingest reads the field in Step 6/7 but tolerates `0`.
- Step 10 (`test`: ingest) covers Steps 4, 6, 7, 8.
- Step 11 (`test`: marketdata) covers Step 9.
- Step 12 (`docs`) should land last so it reflects final emitted-event behavior.

---

### Step 1 — proto: Add `failed_symbols` to `BackfillJob` and `expected_bars` to `BackfillBarsResponse`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/ingest/v1/ingest.proto` — modify
- `packages/proto/marketdata/v1/marketdata.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` pass; `xstockstrat-ingest` (service owner) — job-state durability; `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity

**Codebase Evidence**:
- Confirmed via Read `packages/proto/ingest/v1/ingest.proto` L24–35: `BackfillJob` currently uses
  field numbers 1–10 (`error = 10`). Next free number is `11` (matches product-spec FR-7 and the
  054-overlap note in context.md: 052 uses 11, 054 must use 12+).
- Confirmed via Read `packages/proto/marketdata/v1/marketdata.proto` L90–93: `BackfillBarsResponse`
  uses fields 1 (`bars_written`) and 2 (`failed_symbols`). Next free number is `3`.

**Instructions**:
1. In `packages/proto/ingest/v1/ingest.proto`, add to `message BackfillJob` after `string error = 10;`:
   `repeated string failed_symbols = 11; // symbols that failed in a PARTIAL/FAILED job (FR-7)`
2. In `packages/proto/marketdata/v1/marketdata.proto`, add to `message BackfillBarsResponse` after
   `repeated string failed_symbols = 2;`:
   `int64 expected_bars = 3; // estimated total bars across requested symbols/range (FR-6)`
3. Both are additive field additions on existing messages — non-breaking per
   `docs/runbooks/proto-versioning.md` ("Adding a new optional field" is always safe). No `v2`.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/durable-observable-backfills"
```
Both must pass (additive change is non-breaking).

---

### Step 2 — proto-gen: Regenerate stubs (Go, Python, TS)

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/**` — modify (regenerated)
- `packages/proto/gen/python/**` — modify (regenerated)
- `packages/proto/gen/ts/**` — modify (regenerated)

**Reviewers**: Proto Reviewer — field number uniqueness, `buf lint`/`buf breaking` pass; `xstockstrat-ingest` (service owner) — job-state durability; `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity (inherited from Step 1)

**Codebase Evidence**:
- Confirmed via root `CLAUDE.md` §"Generating Proto Stubs": `./scripts/buf-gen.sh` "generates
  TypeScript, Python, and Go stubs and compiles the TS package. Run after any `.proto` change."
- The `proto-freshness` CI job enforces stubs match protos (`docs/runbooks/proto-versioning.md`
  L82). phase3-deviations.md L20–27 notes a fallback `grpc_tools.protoc` invocation if `buf` is
  unavailable in the environment.

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Commit the regenerated stubs in `packages/proto/gen/` **together** with the Step 1 proto source
   edits (proto-versioning.md PR1 rule: "Commit proto source + generated stubs together").

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```
Exit code 0 after running means stubs are fresh (no diff). Confirm `failed_symbols` is present in
`packages/proto/gen/python/ingest/v1/ingest_pb2.py` and `expected_bars` in
`packages/proto/gen/python/marketdata/v1/marketdata_pb2.py` (ingest reads both via the Python stub).

---

### Step 3 — migration: Create `ingest.backfill_jobs` table

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/migrations/003_backfill_jobs.up.sql` — create
- `services/xstockstrat-ingest/migrations/003_backfill_jobs.down.sql` — create

**Reviewers**: DBA — Migration NNN numbering (no gaps), up+down pair present, hypertable vs. plain-table choice, index correctness; `xstockstrat-ingest` (service owner) — job-state durability

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-ingest/migrations/`: last migration is
  `002_add_signal_sources_registry.{up,down}.sql`. **Next number is `003`** — note this corrects
  the product-spec assumption (FR / Database Changes section said "next NNN after
  `001_newsletter_signals`"); `002` already exists, so the new migration is `003`.
- Existing pattern: `002_add_signal_sources_registry.up.sql` L5–19 uses
  `CREATE TABLE IF NOT EXISTS ingest.<name> (...)` plain table (not hypertable) plus a
  `CREATE INDEX IF NOT EXISTS` — the `ingest` schema is created in `000_schema.up.sql`, so no
  `CREATE SCHEMA` needed.
- Product spec "Database Changes" + Resolved Decisions: **plain table, not hypertable**; columns
  `job_id` (uuid PK), `symbols` (text[]), `timeframe`, `range_start`, `range_end`, `status`
  (smallint mirroring `BackfillStatus`), `bars_processed`, `bars_total`, `failed_symbols` (text[]),
  `error`, `started_at`, `completed_at`, `created_at`; index on `status` and `created_at`.

**Instructions**:
1. Create `003_backfill_jobs.up.sql`:
   ```sql
   -- 003_backfill_jobs.up.sql
   -- Durable backfill job state (replaces the in-memory self._jobs dict).
   -- Plain table (not a hypertable): low-volume operational state keyed by uuid.
   -- The ingest schema was created in migration 000 — no CREATE SCHEMA needed.

   CREATE TABLE IF NOT EXISTS ingest.backfill_jobs (
       job_id         UUID PRIMARY KEY,
       symbols        TEXT[] NOT NULL DEFAULT '{}',
       timeframe      TEXT NOT NULL DEFAULT '',
       range_start    TIMESTAMPTZ,
       range_end      TIMESTAMPTZ,
       status         SMALLINT NOT NULL,   -- mirrors BackfillStatus enum (0..5)
       bars_processed BIGINT NOT NULL DEFAULT 0,
       bars_total     BIGINT NOT NULL DEFAULT 0,
       failed_symbols TEXT[] NOT NULL DEFAULT '{}',
       error          TEXT NOT NULL DEFAULT '',
       started_at     TIMESTAMPTZ,
       completed_at   TIMESTAMPTZ,
       created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );

   CREATE INDEX IF NOT EXISTS backfill_jobs_status_idx     ON ingest.backfill_jobs (status);
   CREATE INDEX IF NOT EXISTS backfill_jobs_created_at_idx ON ingest.backfill_jobs (created_at DESC);
   ```
2. Create `003_backfill_jobs.down.sql`:
   ```sql
   -- 003_backfill_jobs.down.sql
   DROP TABLE IF EXISTS ingest.backfill_jobs;
   ```

**Verification**:
```bash
./scripts/db-migrate.sh
```
Then confirm the table and indexes exist (golang-migrate run order is sequential; 003 applies after
002). Optionally: `psql "$DATABASE_URL" -c "\d ingest.backfill_jobs"` shows the columns and the two
indexes; `./scripts/db-migrate.sh down 1` then `up` round-trips cleanly.

---

### Step 4 — service: Add `backfill_jobs` repository

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/repositories/backfill_jobs.py` — create

**Reviewers**: `xstockstrat-ingest` (service owner) — job-state durability, no lost jobs across restart

**Codebase Evidence**:
- Existing pattern: `services/xstockstrat-ingest/app/repositories/signal_sources.py` — module-level
  `async def` functions taking `db_pool` as first arg, using `await db_pool.fetchrow(...)` /
  `await db_pool.fetch(...)` and `return dict(row)`. Use this same style (no class).
- Confirmed via Read `app/handlers/servicer.py` L40: today job state is `self._jobs: dict[str,
  ingest_pb2.BackfillJob]` — this repo replaces it (product-spec Resolved Decision: drop the dict
  entirely, read/write the table on every RPC).
- Proto field order confirmed in Step 1 evidence; `BackfillStatus` enum values
  (`BACKFILL_STATUS_QUEUED=1` … `_PARTIAL=5`) at `ingest.proto` L37–44 map to the `status` smallint.

**Instructions**:
1. Create `app/repositories/backfill_jobs.py` with module-level async functions mirroring
   `signal_sources.py` style. Implement at minimum:
   - `async def insert_job(db_pool, *, job_id, symbols, timeframe, range_start, range_end, status) -> None`
     — `INSERT INTO ingest.backfill_jobs (job_id, symbols, timeframe, range_start, range_end, status)
     VALUES ($1,$2,$3,$4,$5,$6)`.
   - `async def update_job(db_pool, job_id, **fields) -> None` — dynamic `UPDATE ingest.backfill_jobs
     SET ... WHERE job_id = $N` for the mutable columns (`status`, `bars_processed`, `bars_total`,
     `failed_symbols`, `error`, `started_at`, `completed_at`). Build the `SET` clause from the passed
     kwargs only (follow the dynamic-WHERE param-indexing style already used in
     `servicer.py:QuerySignals` L286–325).
   - `async def get_job(db_pool, job_id) -> dict | None` — `SELECT *` for one `job_id`; `return
     dict(row) if row else None`.
   - `async def list_jobs(db_pool, *, status_filter=None, limit=100, offset=0) -> list[dict]` —
     `SELECT * ... [WHERE status = $1] ORDER BY created_at DESC LIMIT/OFFSET`.
   - `async def reconcile_interrupted(db_pool, *, error_msg) -> int` — single statement
     `UPDATE ingest.backfill_jobs SET status = $1, error = $2, completed_at = NOW()
     WHERE status IN ($3, $4) RETURNING job_id` where `$1 = FAILED`, `$3 = RUNNING`, `$4 = QUEUED`;
     return the count of reconciled rows (FR-3). Pass enum ints from the caller (servicer) so this
     module stays proto-free, matching `signal_sources.py` which has no proto imports.
2. Add a helper `def job_row_to_proto(row: dict) -> ingest_pb2.BackfillJob` either here or in the
   servicer — converting a DB row to a `BackfillJob` message (set `failed_symbols` from the
   `text[]` column, and build `range` from `range_start`/`range_end` via
   `google.protobuf.Timestamp`). If placed in the repo, import `ingest_pb2` at module top.

**Verification**: Covered by Step 10 (`test`). For a quick import sanity check:
```bash
cd services/xstockstrat-ingest && uv run python -c "from app.repositories import backfill_jobs; print('ok')"
```

---

### Step 5 — config: Add `ingest.backfill.max_retry_attempts` + watcher accessors

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/config/watcher.py` — modify

**Reviewers**: `xstockstrat-ingest` (service owner) — config key naming `<service>.<category>.<key>`, defaults

**Codebase Evidence**:
- Confirmed via Read `app/config/watcher.py` L60–106: `ConfigWatcher` has generic `get_int` /
  `get_bool` getters plus typed `@property` helpers (e.g. `sandbox_timeout_ms` L93–95). Add
  ingest-backfill `@property` accessors in the same style.
- Existing keys confirmed in `services/xstockstrat-ingest/CLAUDE.md` Config Keys table:
  `ingest.backfill.max_concurrent_jobs` (int, default `3`) and `ingest.backfill.retry_on_failure`
  (bool, default `true`) already documented but currently inert (no reader in `servicer.py` — grep
  for `max_concurrent_jobs` / `retry_on_failure` in the service returns matches only in CLAUDE.md).
- Per `docs/runbooks/config-rollout.md` Governance Summary: a "New non-breaking key" requires
  service-owner approval + a PR documenting it (Step 12 updates the CLAUDE.md table). Config keys
  are served live via WatchConfig — **no env var or deployment-file change** is needed for a new key.

**Instructions**:
1. In `app/config/watcher.py`, add three `@property` accessors after the existing sandbox helpers,
   reusing the generic getters:
   ```python
   @property
   def backfill_max_concurrent_jobs(self) -> int:
       return self.get_int("ingest.backfill.max_concurrent_jobs", default=3)

   @property
   def backfill_retry_on_failure(self) -> bool:
       return self.get_bool("ingest.backfill.retry_on_failure", default=True)

   @property
   def backfill_max_retry_attempts(self) -> int:
       return self.get_int("ingest.backfill.max_retry_attempts", default=3)
   ```
   (The new key `ingest.backfill.max_retry_attempts` follows `<service>.<category>.<key>`; default
   `3` per FR-8.)

**Verification**: Covered by Step 10 (`test`) — add getter-default tests mirroring the existing
`TestConfigWatcherGetters` (e.g. `test_backfill_max_retry_attempts_default == 3`). Lint runs in
Step 10's verification.

---

### Step 6 — service: Persist job state to the table; wire notify channel; drop `self._jobs`

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/main.py` — modify

**Reviewers**: `xstockstrat-ingest` (service owner) — job-state durability, no lost jobs across restart, idempotent ingestion

**Codebase Evidence**:
- Confirmed via Read `app/handlers/servicer.py`:
  - L29–40 `IngestServicer.__init__(self, config_watcher, marketdata_channel, ledger_channel,
    db_pool=None)` — **no notify channel today**. L37–38 build the marketdata/ledger stubs.
  - L40 `self._jobs: dict[str, ingest_pb2.BackfillJob] = {}` — to be removed.
  - L57–76 `TriggerBackfill` writes `self._jobs[job_id] = job` (L66) then `asyncio.create_task`.
  - L132–143 `GetBackfillStatus` / `ListBackfillJobs` read `self._jobs`.
- Confirmed via Read `app/main.py` L30–65: `IngestServicer(...)` is constructed with
  `config_watcher`, `marketdata_channel`, `ledger_channel`, `db_pool`. `NOTIFY_ENDPOINT` is **not**
  yet read in `main.py` (grep: only `CONFIG/MARKETDATA/LEDGER_ENDPOINT` at L31–33).
- **Env var already wired** — `NOTIFY_ENDPOINT: xstockstrat-notify:50059` is present in all three
  deployment files for the ingest block (confirmed: `docker-compose.yml` L308; `.do/app.dev.yaml`
  L210; `.do/app.yaml` L210). **No deployment-file change needed** — only `main.py` must read it.
- Notify stub pattern (reference): `services/xstockstrat-analysis/app/handlers/servicer.py` L52
  `self._notify = notify_pb2_grpc.NotifyServiceStub(notify_channel) if notify_channel else None`
  and `app/main.py` L55 passes `notify_channel=grpc.aio.insecure_channel(NOTIFY_ENDPOINT)`.

**Instructions**:
1. In `app/main.py`:
   - Add `NOTIFY_ENDPOINT = os.environ.get("NOTIFY_ENDPOINT", "xstockstrat-notify:50059")` (mirrors
     `analysis/app/main.py` L32).
   - Create `notify_channel = grpc.aio.insecure_channel(NOTIFY_ENDPOINT)` alongside the existing
     marketdata/ledger channels (L57–58) and pass `notify_channel=notify_channel` to the
     `IngestServicer(...)` constructor.
2. In `app/handlers/servicer.py`:
   - Add `from gen.notify.v1 import notify_pb2, notify_pb2_grpc` to the imports (mirrors analysis).
   - Add `notify_channel=None` param to `__init__`; set
     `self._notify = notify_pb2_grpc.NotifyServiceStub(notify_channel) if notify_channel else None`.
   - **Remove** `self._jobs` (L40).
   - Rewrite `TriggerBackfill` (L57–76): generate `job_id`, call
     `backfill_jobs.insert_job(self._db, ..., status=BACKFILL_STATUS_QUEUED)` instead of writing the
     dict. Keep the existing `propagation_meta` extraction (L67–71) and `asyncio.create_task` launch
     (concurrency gating added in Step 7). Guard `if self._db is None: abort UNAVAILABLE` (mirror the
     IngestSignal db-None guard at L181–183).
   - Rewrite `_run_backfill` (L78–130): load/mutate the job via repo calls
     (`backfill_jobs.update_job(self._db, job_id, status=..., bars_processed=..., bars_total=...,
     failed_symbols=..., started_at=..., completed_at=..., error=...)`) instead of mutating a
     `BackfillJob` object held in the dict. Set `bars_total` from the marketdata response
     `resp.expected_bars` (FR-6; tolerate `0`). Populate `failed_symbols` from
     `resp.failed_symbols` (FR-7). (Lifecycle events, alert, and retry are added in Step 7.)
   - Rewrite `GetBackfillStatus` (L132–137): `row = await backfill_jobs.get_job(self._db,
     request.job_id)`; if `None`, keep the existing `abort(NOT_FOUND, ...)`; else return
     `job_row_to_proto(row)`.
   - Rewrite `ListBackfillJobs` (L139–143): `rows = await backfill_jobs.list_jobs(self._db,
     status_filter=(request.status_filter if request.status_filter !=
     BACKFILL_STATUS_UNSPECIFIED else None), ...)`; build
     `ListBackfillJobsResponse(jobs=[job_row_to_proto(r) for r in rows])`.
   - Header propagation: the existing `propagation_meta` list (L67–71, forwarding `x-user-id`,
     `x-access-scope`, `x-trace-id`) is already passed to the marketdata/ledger calls; pass the same
     `metadata=propagation_meta` on the **new** notify `EmitAlert` call added in Step 7 (per
     `docs/patterns/header-propagation.md` Python per-method `metadata` pattern; this matches how
     `IngestSignal` forwards it to ledger at L272).

**Verification**: Covered by Step 10 (`test`). Lint runs in Step 10's verification.

---

### Step 7 — service: Emit full lifecycle events, notify alert, retry policy, concurrency gate

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` (service owner) — concurrency-gate correctness, idempotent ingestion, no lost jobs across restart

**Codebase Evidence**:
- Confirmed via Read `app/handlers/servicer.py` L106–126: today only `ingest.backfill.completed` is
  emitted (`AppendEvent(event_type="ingest.backfill.completed", stream_key=f"backfill:{job_id}",
  ...)`). FR-4 requires `queued` / `running` / `completed` / `failed` on the same
  `stream_key = backfill:<job_id>`.
- Confirmed via Read L127–130: the `except` branch sets `FAILED` + `error` but emits **no** ledger
  event and **no** notify alert. FR-5 requires a notify `EmitAlert` on `FAILED` or `PARTIAL`.
- Confirmed via Read L72: `asyncio.create_task(self._run_backfill(...))` is unbounded — FR-9
  requires a real concurrency gate (asyncio semaphore/queue). Today no semaphore exists (grep
  `Semaphore` in the service → no match).
- EmitAlert request shape (reference): `services/xstockstrat-analysis/app/engine/live_loop.py`
  L156–167 — `notify_pb2.EmitAlertRequest(severity=ALERT_SEVERITY_WARNING, category=..., title=...,
  body=..., source_service="xstockstrat-analysis", tags=[...], context=ctx)` where `ctx` is a
  `google.protobuf.struct_pb2.Struct`. Use `ALERT_SEVERITY_ERROR` for FAILED and
  `ALERT_SEVERITY_WARNING` for PARTIAL.
- `BackfillStatus` enum + `BACKFILL_STATUS_PARTIAL`/`_FAILED` confirmed at `ingest.proto` L37–44.
  Product spec FR-4: PARTIAL emits `completed` (with `failed_symbols`), NOT `failed`.

**Instructions**:
1. **Concurrency gate (FR-9)**: in `__init__`, create `self._backfill_sem =
   asyncio.Semaphore(self._cfg.backfill_max_concurrent_jobs)` (read once at init is acceptable;
   note in code that live re-read is out of scope). In `_run_backfill`, wrap the marketdata fetch
   body in `async with self._backfill_sem:` so jobs above the limit stay `QUEUED` (status remains
   `BACKFILL_STATUS_QUEUED` in the table until the semaphore is acquired, then transition to
   `RUNNING`). Acceptance criterion 5: with `max_concurrent_jobs=1`, a second triggered job stays
   `QUEUED` until the first finishes.
2. **Lifecycle events (FR-4)**: add a small helper `async def _emit_backfill_event(self, event_type,
   job_id, payload_dict, propagation_meta)` that builds a `Struct` and calls
   `self._ledger.AppendEvent(AppendEventRequest(event_type=event_type,
   source_service="xstockstrat-ingest", stream_key=f"backfill:{job_id}", payload=...),
   metadata=propagation_meta)` (factoring the existing L118–126 call). Emit:
   - `ingest.backfill.queued` — in `TriggerBackfill` right after the row insert.
   - `ingest.backfill.running` — at the start of the semaphore-protected body, after status→RUNNING.
   - `ingest.backfill.completed` — on COMPLETED **and** PARTIAL outcomes (carry `failed_symbols`).
   - `ingest.backfill.failed` — only in the `except` (total-failure) path. Do **not** emit `failed`
     for PARTIAL.
3. **Notify alert (FR-5)**: on a PARTIAL outcome and on the `except` FAILED path, call
   `self._notify.EmitAlert(...)` (guard `if self._notify is not None`). Include `job_id`, the failing
   symbols, and the error string — put them in the `EmitAlertRequest.context` Struct and the `body`.
   Use `category="backfill"`, `source_service="xstockstrat-ingest"`,
   `tags=[f"job_id:{job_id}"]`, severity `ERROR` (failed) / `WARNING` (partial). Pass
   `metadata=propagation_meta` (header propagation per Step 6 evidence).
4. **Retry policy (FR-8)**: in `_run_backfill`, when `self._cfg.backfill_retry_on_failure` is true,
   on a transient `BackfillBars` failure retry up to `self._cfg.backfill_max_retry_attempts` with
   exponential backoff `2s / 4s / 8s` (`await asyncio.sleep(2 ** attempt)`), retrying only the
   failed symbols of the job (re-issue `BackfillBars` with `symbols=<remaining failed symbols>`).
   When `retry_on_failure` is false, the first failure is terminal (no retry → FAILED). After
   exhausting retries, the job is FAILED (or PARTIAL if some symbols succeeded across attempts).
   Update `failed_symbols` / `bars_processed` in the table between attempts.

**Verification**: Covered by Step 10 (`test`) — assert event types emitted per outcome, EmitAlert
called on FAILED/PARTIAL only, retry count honored for true/false, and the semaphore gates a second
job. Lint runs in Step 10's verification.

---

### Step 8 — service: Startup reconciliation of interrupted jobs (FR-3)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/main.py` — modify

**Reviewers**: `xstockstrat-ingest` (service owner) — no lost jobs across restart, job-state durability

**Codebase Evidence**:
- Confirmed via Read `app/main.py` L54–65: the asyncpg pool is created (L54) before the
  `IngestServicer` is constructed (L60–65) and before `grpc_server.start()` (L79). A reconciliation
  call fits cleanly after the pool is established and before the server starts accepting traffic.
- FR-3: jobs left `RUNNING` or `QUEUED` from a previous process MUST be marked `FAILED` with error
  `"interrupted by restart"`. No automatic resume (P0 scope).
- Repo function `reconcile_interrupted` is created in Step 4.

**Instructions**:
1. In `app/main.py`, after `db_pool = await asyncpg.create_pool(...)` (L54) and before
   `grpc_server.start()`, call:
   ```python
   from app.repositories import backfill_jobs
   from gen.ingest.v1 import ingest_pb2
   n = await backfill_jobs.reconcile_interrupted(
       db_pool,
       error_msg="interrupted by restart",
   )  # marks RUNNING/QUEUED → FAILED; pass enum ints into the repo
   log.info("reconciled %d interrupted backfill job(s)", n)
   ```
   Pass the `BACKFILL_STATUS_FAILED` / `_RUNNING` / `_QUEUED` enum ints from here into
   `reconcile_interrupted` (the repo stays proto-free per Step 4).

**Verification**: Covered by Step 10 (`test`) — a unit test on `reconcile_interrupted` with a mocked
pool asserting the `UPDATE ... WHERE status IN (RUNNING, QUEUED)` statement and the returned count.
Acceptance criterion 1: trigger → restart mid-job → `GetBackfillStatus` returns a reconciled
terminal status, not `NOT_FOUND`.

---

### Step 9 — service: marketdata returns `expected_bars` estimate (FR-6)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- Confirmed via Read `internal/service/marketdata_service.go` L131–197: `BackfillBars` resolves
  `start`/`end` from `req.Range` (defaulting `end=now`, `start=end-365d` at L141–146), loops symbols
  fetching `src.GetBars(...)`, accumulates `totalWritten`, and returns
  `&marketdatav1.BackfillBarsResponse{BarsWritten: totalWritten, FailedSymbols: failedSymbols}`
  (L193–196). The new field `ExpectedBars` (added to the Go stub in Step 2) must be populated here.
- Product spec Resolved Decision: marketdata returns the estimate; ingest sets `bars_total` from it.
  Out of scope: "Any change to how `xstockstrat-marketdata` fetches from Alpaca beyond optionally
  returning an expected-bar-count estimate."

**Instructions**:
1. Compute a bar-count estimate from `symbols × trading-day count × bars-per-day for the timeframe`
   over `[start, end]`. Add a small helper (e.g. `func estimateExpectedBars(symbols []string,
   timeframe string, start, end time.Time) int64`) in this file that:
   - counts weekdays (Mon–Fri) in `[start, end]` as a trading-day approximation (US-holiday calendar
     is out of scope — a weekday approximation is acceptable for a progress denominator);
   - multiplies by a per-day bar factor keyed off `timeframe` (`"1d"`→1, `"1h"`→7 (~6.5 RTH hours,
     round up), `"5m"`→78, `"1m"`→390; default to 1 for unknown timeframes);
   - multiplies by `len(symbols)`.
2. Set `ExpectedBars: estimateExpectedBars(req.Symbols, req.Timeframe, start, end)` in the returned
   `BackfillBarsResponse` (L193–196).
3. No new outbound gRPC call is introduced (estimate is computed locally) → no header-propagation
   change required for this step.

**Verification**: Covered by Step 11 (`test`).

---

### Step 10 — test: ingest servicer durability, lifecycle, retry, concurrency, reconciliation

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify
- `services/xstockstrat-ingest/tests/test_backfill_jobs.py` — create (repo unit tests)

**Reviewers**: `xstockstrat-ingest` (service owner) — job-state durability, concurrency-gate correctness

**Codebase Evidence**:
- Confirmed via Read `tests/test_ingest_servicer.py`: existing tests construct the servicer via
  `make_servicer()` (L23–28) with `db_pool=None` and manipulate `svc._jobs` directly (e.g. L47, L66,
  L92, L207, L244). **These `self._jobs`-based tests (`TestListBackfillJobs`, `TestGetBackfillStatus`,
  `TestTriggerBackfill`, `TestRunBackfill`) must be rewritten** to mock the new repo functions /
  `AsyncMock` db pool, since `self._jobs` is removed in Step 6.
- Mock patterns already in the file: `AsyncMock` for `svc._db.fetchrow` / `svc._marketdata.BackfillBars`
  / `svc._ledger.AppendEvent` (L238–241, L388–390). Add `svc._notify = MagicMock(); svc._notify.EmitAlert
  = AsyncMock(...)` for the new alert path (mirror `analysis/tests/test_live_loop.py` L33).
- Coverage threshold for ingest is **40%** (`services/xstockstrat-ingest/CLAUDE.md` Running Tests:
  `--cov-fail-under=40`; matches root CLAUDE.md CI table).

**Instructions**:
1. Update `make_servicer()` to pass a notify channel mock (or set `svc._notify` in each test).
2. Rewrite the four `self._jobs`-based test classes to drive behavior through mocked repo functions
   (patch `app.repositories.backfill_jobs.insert_job/get_job/list_jobs/update_job/reconcile_interrupted`
   with `AsyncMock`) and a mocked `svc._db`. Cover: `GetBackfillStatus` found/NOT_FOUND;
   `ListBackfillJobs` filter/no-filter; `TriggerBackfill` inserts a QUEUED row + emits `queued`.
3. Add new tests for Step 7 behavior:
   - `_run_backfill` emits `running` then `completed` on success; `completed` (not `failed`) +
     `EmitAlert(WARNING)` on PARTIAL; `failed` + `EmitAlert(ERROR)` on total failure.
   - Retry: with `retry_on_failure=True`, a transient `BackfillBars` failure is retried up to
     `max_retry_attempts` (patch `asyncio.sleep` to avoid real backoff); with `False`, the first
     failure is terminal (one call).
   - Concurrency: with `max_concurrent_jobs=1`, the semaphore serializes two `_run_backfill` calls.
   - `bars_total` set from `resp.expected_bars`; `failed_symbols` populated.
4. Add `tests/test_backfill_jobs.py` covering repo functions with an `AsyncMock` pool, including
   `reconcile_interrupted` (Step 8 FR-3 path).
5. Add `TestConfigWatcherGetters` cases for the three new accessors (Step 5 defaults).

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
```
All tests pass, lint+format clean, coverage ≥ 40%.

---

### Step 11 — test: marketdata `expected_bars` estimate

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — create (or modify if present)

**Reviewers**: `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity

**Codebase Evidence**:
- Confirmed via `find services/xstockstrat-marketdata -name "*_test.go"`: existing tests live in
  `internal/config`, `internal/middleware`, `internal/source`, `internal/alpaca` — there is **no**
  `internal/service/marketdata_service_test.go` yet, so this is created from scratch (no existing
  pattern in this exact package; follow Go table-test conventions used in the sibling
  `internal/source/source_test.go`).
- **Coverage note**: `internal/service/` is in the Go coverage-**excluded** package set (root
  CLAUDE.md test-step `COVERPKGS` filter excludes `/service/`). New logic landing only in
  `internal/service/` does not contribute to the measured coverage threshold — per the skill rule,
  a `test` step is still required but no coverage threshold applies; a unit test on the pure
  `estimateExpectedBars` helper is sufficient verification.

**Instructions**:
1. Add a focused table test for `estimateExpectedBars` (Step 9): assert weekday counting over a
   known `[start, end]` range, the per-timeframe factors (`1d`/`1h`/`5m`/`1m` + unknown→1), and the
   `× len(symbols)` multiplier. Keep it a pure-function test (no DB / Alpaca needed). Export the
   helper or place the test in the same package so it is callable.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/... -race -count=1
```
Tests pass. (No coverage gate — `internal/service/` is excluded from CI coverage measurement, per
the Codebase Evidence note above.) Lint:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 12 — docs: Reconcile `xstockstrat-ingest/CLAUDE.md`

**Status**: `done`
**Service**: `docs` (`services/xstockstrat-ingest/CLAUDE.md`)
**Files**:
- `services/xstockstrat-ingest/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via Read `services/xstockstrat-ingest/CLAUDE.md`:
  - Config Keys table L47–63 lists `max_concurrent_jobs` and `retry_on_failure` but **not**
    `ingest.backfill.max_retry_attempts` (new key, Step 5).
  - Ledger Events table L64–73 already lists all four `ingest.backfill.{queued,running,completed,
    failed}` events — this now matches code after Step 7 (acceptance criterion 7). Confirm/keep.
  - Database section L37–42 lists only `ingest.newsletter_signals`; add the new
    `ingest.backfill_jobs` table + migration `003_backfill_jobs.up.sql`.
  - Dependencies table L29–35 already claims "Alert on backfill failures" for notify — now true
    after Step 7; no change needed there.
- Root `CLAUDE.md` config governance: new keys' defaults are "declared in each service's CLAUDE.md"
  — so the new key must appear in this table (and the `config-rollout.md` checklist requires the
  documenting PR for a new key).

**Instructions**:
1. Add a row to the Config Keys table:
   `| ingest.backfill.max_retry_attempts | int | 3 | Max retry attempts for transient backfill failures (FR-8) |`
2. In the Database section, add the `ingest.backfill_jobs` plain table and its migration
   `migrations/003_backfill_jobs.up.sql` (note: durable backfill job state, not a hypertable).
3. Verify the Ledger Events table already lists all four backfill events (it does — confirm it now
   matches emitted behavior per acceptance criterion 7). Add `ingest.backfill_jobs` reconciliation
   note if helpful (FR-3).

**Verification**: Read the file back and confirm the new key row, the new table entry, and that the
Ledger Events table matches the events emitted in Step 7. (Docs-only — no build/test command.)

---

## Deviation Log

### Deviation: Step 2 — proto codegen toolchain
**Spec said**: Run `./scripts/buf-gen.sh` (normally run inside the `Dockerfile.codegen` container via `scripts/localenv-setup.sh`).
**Actual**: Docker daemon is unavailable in this execution sandbox. Installed the codegen toolchain directly on the host, pinned to the CI `proto-freshness` job versions (buf v1.50.0; protoc-gen-go@v1.36.11; protoc-gen-go-grpc@v1.6.2; protoc-gen-connect-go@v1.19.2; grpcio-tools==1.80.0; TS plugins from the committed pnpm lockfile), then ran `./scripts/buf-gen.sh`. `git diff` of `packages/proto/gen/` is limited to the intended ingest/marketdata files (mirrors CI's stale-stub check).
**Reason**: Docker unavailable; host toolchain pinned to CI versions is the sanctioned sequential-mode CI-equivalent fallback.
**Disposition**: CI-equivalent fallback
