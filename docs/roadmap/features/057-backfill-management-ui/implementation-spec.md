# Implementation Spec: backfill-management-ui

**Status**: `pending`
**Created**: 2026-06-11
**Feature**: `docs/roadmap/features/057-backfill-management-ui/feature.md`
**Total Steps**: 14
**Feature Branch**: `feature/backfill-management-ui`

---

## Execution Summary

This feature is built bottom-up: the proto contract first (additive `CancelBackfill` +
`DeleteBackfilledData` RPCs, a `BACKFILL_STATUS_CANCELED` enum value, and a symbol filter on
`ListBackfillJobsRequest`), then codegen, then the two backend services (ingest cancel + symbol
filter; marketdata scoped delete), each paired with a test step, then the optional marketdata
delete-guard config key, and finally the `xstockstrat-ui` Backfills page (BFF wiring + browser
client + hooks + page) which depends on the regenerated stubs. The UI is gated to admin scope at
both the page (visibility) and BFF (enforcement) layers, reusing the `ADMIN_BIT = 0x04` pattern
established by feature 049. Docs last.

## Step Dependencies

- Step 1 [proto] → Step 2 [proto-gen] must run before any consumer (Steps 3–14).
- Step 3 [service] (ingest CancelBackfill + symbol filter) is covered by Step 4 [test].
- Step 5 [service] (marketdata DeleteBackfilledData) is covered by Step 6 [test]; Step 5 reads
  the config key added in Step 7 [config], so Step 7 should land with or before Step 5 (the key
  has a safe default, so ordering is soft).
- Steps 8–13 (UI) require Step 2 (regenerated TS stubs carrying the new RPCs/enum/field) and the
  backend RPCs from Steps 3 and 5 to exist for an end-to-end pass.
- Step 8 [service] (BFF) → Step 9 [service] (browser client) → Step 10 [service] (hooks) →
  Step 11 [service] (page) → Step 12 [service] (nav/admin-gate hook reuse) are ordered by import
  dependency. Step 13 [test] (E2E) covers Steps 8–12.
- Step 14 [docs] last.

---

### Step 1 — proto: additive `CancelBackfill` + `DeleteBackfilledData` + `BACKFILL_STATUS_CANCELED` + symbol filter

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/ingest/v1/ingest.proto` — modify
- `packages/proto/marketdata/v1/marketdata.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, additive-only changes (`buf lint`/`buf breaking` pass), `xstockstrat-ingest` (service owner) — backfill job control correctness / cancel without orphaned jobs, `xstockstrat-marketdata` (service owner) — safe scoped deletion of backfilled bars, `xstockstrat-ui` (service owner) — Connect-RPC call safety

**Codebase Evidence**:
- Confirmed via Read `packages/proto/ingest/v1/ingest.proto` L11–22: `service IngestService` has
  `TriggerBackfill`, `GetBackfillStatus`, `ListBackfillJobs`, `NormalizeRawData`, `IngestSignal`,
  `QuerySignals`, `ListSignalSources`, `ManageSignalSource`. **No `CancelBackfill`** RPC present.
- L42–49: `enum BackfillStatus` last value is `BACKFILL_STATUS_PARTIAL = 5`; next free = `6`.
- L75–78: `message ListBackfillJobsRequest { BackfillStatus status_filter = 1; PageRequest page = 2; }`
  — next free field number = `3`. No symbol/ticker filter exists.
- Confirmed via Read `packages/proto/marketdata/v1/marketdata.proto` L12–33: `service MarketDataService`
  has `StreamBars`, `StreamQuotes`, `GetBars`, `GetLatestQuote`, `BackfillBars`, `GetDataCoverage`,
  `ListAssets`. **No delete RPC.**
- Shared types confirmed via Read `packages/proto/common/v1/common.proto` L42 (`message TimeRange`)
  and L72–77 (`enum Timeframe { TIMEFRAME_UNSPECIFIED=0; TIMEFRAME_1MIN=1; TIMEFRAME_5MIN=2;
  TIMEFRAME_1HOUR=3; TIMEFRAME_1DAY=4; }`). Both protos already `import "common/v1/common.proto"`.

**Instructions**:
- In `ingest/v1/ingest.proto`:
  - Add to `enum BackfillStatus` after L48: `BACKFILL_STATUS_CANCELED = 6;` (FR-4 cancel target state).
  - Add RPC to `service IngestService` (after `ListBackfillJobs` at L14):
    `rpc CancelBackfill(CancelBackfillRequest) returns (BackfillJob);` — returns the updated job so
    the UI gets the new `CANCELED` status in one round-trip (mirrors `GetBackfillStatus` returning
    `BackfillJob`).
  - Add message: `message CancelBackfillRequest { string job_id = 1; }`.
  - Add a symbol filter to `ListBackfillJobsRequest` at the next free field number:
    `string symbol = 3;  // optional ticker filter (FR-3)`. Use `string` (single optional symbol) —
    matches the existing optional-string filter style in `QuerySignalsRequest` (L112–118).
- In `marketdata/v1/marketdata.proto`:
  - Add RPC to `service MarketDataService` (after `GetDataCoverage` at L29):
    `rpc DeleteBackfilledData(DeleteBackfilledDataRequest) returns (DeleteBackfilledDataResponse);`
  - Add messages:
    ```
    message DeleteBackfilledDataRequest {
      string symbol = 1;                                  // REQUIRED — server rejects empty (FR-5)
      xstockstrat.common.v1.TimeRange range = 2;          // optional; empty = whole symbol
      xstockstrat.common.v1.Timeframe timeframe = 3;      // optional; UNSPECIFIED = all timeframes
    }
    message DeleteBackfilledDataResponse {
      int64 rows_deleted = 1;
    }
    ```
- Keep all changes additive — do NOT renumber or retype any existing field.

**Verification**:
- `cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/backfill-management-ui"`
  — both pass (additive only). (If the branch baseline is unavailable locally, use
  `--against ".git#branch=main-dev"`.)

---

### Step 2 — proto-gen: regenerate Go / Python / TS stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/ingest/v1/**`, `packages/proto/gen/go/marketdata/v1/**` — regenerated
- `packages/proto/gen/python/ingest/v1/**`, `packages/proto/gen/python/marketdata/v1/**` — regenerated
- `packages/proto/gen/ts/ingest/v1/**`, `packages/proto/gen/ts/marketdata/v1/**` (+ compiled `gen/ts/dist/`) — regenerated

**Reviewers**: Inherited from Step 1 — Proto Reviewer, `xstockstrat-ingest` (service owner), `xstockstrat-marketdata` (service owner), `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- Confirmed via root `CLAUDE.md` §Generating Proto Stubs: `./scripts/buf-gen.sh` generates TS,
  Python, and Go stubs and compiles the TS package. The `proto-freshness` CI job enforces stub
  freshness (`docs/runbooks/proto-versioning.md` L82–88).

**Instructions**:
- Run `./scripts/buf-gen.sh` from the repo root.
- Commit the proto source (Step 1) and the regenerated stubs together in the same step/commit
  (per `docs/runbooks/proto-versioning.md` PR1 guidance).

**Verification**:
- `./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/` — exits clean (no
  uncommitted stub drift).

---

### Step 3 — service: ingest `CancelBackfill` RPC + `ListBackfillJobs` symbol filter

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/repositories/backfill_jobs.py` — modify

**Reviewers**: `xstockstrat-ingest` (service owner) — backfill job control correctness, idempotent ingestion, job-state durability, cancel without orphaned jobs

**Codebase Evidence**:
- Confirmed via Read `services/xstockstrat-ingest/app/handlers/servicer.py`:
  - `class IngestServicer(ingest_pb2_grpc.IngestServiceServicer)` L95.
  - Admin gate helper `_has_admin_scope(context)` L113–126 reads `x-access-scope` and tests
    `& 0x04` (reuse for the cancel mutation gate).
  - `_propagation_meta(context)` L128–134 forwards `x-user-id`/`x-access-scope`/`x-trace-id`.
  - `TriggerBackfill` L136–161 creates a job and launches `asyncio.create_task(self._run_backfill(...))`.
  - `_run_chunks` L408–485 schedules chunks via `await asyncio.gather(*(run_one(c) for c in chunks))`;
    each `run_one` (L422) checks/updates job state under `lock` — this is where chunk scheduling
    must observe a cancel flag and stop launching further marketdata `BackfillBars` calls.
  - `GetBackfillStatus` L487–495 returns `job_row_to_proto(get_job(...))`.
  - `ListBackfillJobs` L497–518 builds `status_filter` + offset/limit and calls
    `backfill_jobs.list_jobs(self._db, status_filter=..., limit=..., offset=...)`.
- Confirmed via Read `services/xstockstrat-ingest/app/repositories/backfill_jobs.py`:
  - `_UPDATABLE_COLUMNS` L13–23 currently allows `status`, `bars_processed`, `bars_total`,
    `failed_symbols`, `error`, `started_at`, `completed_at`.
  - `update_job(db_pool, job_id, **fields)` L50–68 — dynamic safe SET clause restricted to
    `_UPDATABLE_COLUMNS`.
  - `get_job` L71–76, `list_jobs` L79–100 (builds `WHERE status = $1` when `status_filter` not None).
- `BACKFILL_STATUS_CANCELED = 6` added to the proto in Step 1; available as
  `ingest_pb2.BACKFILL_STATUS_CANCELED` after Step 2.

**Instructions**:
- Add `CancelBackfill(self, request, context)` to `IngestServicer`:
  - Guard `if self._db is None: await context.abort(grpc.StatusCode.UNAVAILABLE, ...)` (match the
    pattern at `TriggerBackfill` L137).
  - Admin gate: `if not self._has_admin_scope(context): await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required")`
    (reuse `_has_admin_scope`, the feature-049 pattern).
  - Look up the job via `backfill_jobs.get_job(self._db, request.job_id)`; abort `NOT_FOUND` if absent.
  - If the job is already terminal (`COMPLETED`/`FAILED`/`PARTIAL`/`CANCELED`), abort
    `FAILED_PRECONDITION` ("job not cancelable in state X") — only `QUEUED`/`RUNNING` are cancelable.
  - Mark the job `CANCELED`: `await backfill_jobs.update_job(self._db, request.job_id,
    status=ingest_pb2.BACKFILL_STATUS_CANCELED, completed_at=datetime.now(UTC))`.
  - Signal the in-flight runner to stop scheduling further chunks: introduce an in-process
    cancellation registry on the servicer (e.g. `self._canceled_jobs: set[str]` initialized in
    `__init__`, add `request.job_id`), and in `_run_chunks.run_one` (L422) check
    `if job_id in self._canceled_jobs: return` at the top of the coroutine **before** acquiring the
    chunk semaphore / issuing the marketdata `BackfillBars` call — so already-completed chunks'
    bars are retained (FR-4) but no new chunks are fetched. Also short-circuit `_finalize_backfill`
    so a canceled job is not overwritten back to COMPLETED/PARTIAL (check the registry / re-read the
    row status before the final `update_job`).
  - Emit a ledger event for observability via the existing `_emit_backfill_event(...)` helper
    (e.g. event type `ingest.backfill.canceled`), passing `self._propagation_meta(context)` so
    headers propagate (the ledger `AppendEvent` call already forwards `metadata=propagation_meta`,
    L168–176).
  - Return `job_row_to_proto(get_job(self._db, request.job_id))` (the updated CANCELED job).
- Add the symbol filter to `ListBackfillJobs`: read `request.symbol` (empty = no filter) and pass it
  to `backfill_jobs.list_jobs(...)` as a new `symbol_filter` kwarg.
- In `backfill_jobs.py`, extend `list_jobs(...)` with a `symbol_filter: str | None = None` parameter.
  The `symbols` column is a Postgres text array (inserted as `list(symbols)` at `insert_job` L37–47),
  so filter with array membership: add `AND $N = ANY(symbols)` to the WHERE clause when
  `symbol_filter` is non-empty (combine with the existing optional `status` predicate). Keep the
  `ORDER BY created_at DESC LIMIT ... OFFSET ...` tail.
- No change to `_UPDATABLE_COLUMNS` is required (`status` and `completed_at` are already allowed).
- Header propagation note (per §5c): the only new outbound call is the ledger `AppendEvent` for the
  cancel event, made through the existing `self._ledger` stub with `metadata=self._propagation_meta(context)`
  — reuses the established per-method metadata propagation (`_propagation_meta` L128–134); no new
  client/interceptor introduced.

**Verification**:
- `grep -n "x-user-id" services/xstockstrat-ingest/app/handlers/servicer.py` — confirm the new
  cancel-event ledger call passes `propagation_meta` (the three headers) like the existing emitters.
- Behavioral check covered by Step 4.

---

### Step 4 — test: ingest cancel + symbol filter coverage

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_backfill_jobs.py` — modify (or add `tests/test_cancel_backfill.py`)

**Reviewers**: `xstockstrat-ingest` (service owner) — backfill job control correctness, cancel without orphaned jobs

**Codebase Evidence**:
- Confirmed existing test files via `find`: `services/xstockstrat-ingest/tests/test_backfill_jobs.py`,
  `tests/test_ingest_servicer.py`, `tests/conftest.py` exist.
- Coverage command + threshold from service CLAUDE.md L96 (`uv run pytest --cov=app --cov-fail-under=40`)
  and root §CI/CD (Python ≥40%).

**Instructions**:
- Add tests covering: (a) `CancelBackfill` on a `QUEUED`/`RUNNING` job transitions it to
  `BACKFILL_STATUS_CANCELED` and records the cancellation in the registry; (b) `CancelBackfill`
  without the admin scope bit aborts `PERMISSION_DENIED`; (c) `CancelBackfill` on a terminal job
  aborts `FAILED_PRECONDITION`; (d) `CancelBackfill` on an unknown job aborts `NOT_FOUND`;
  (e) `list_jobs(..., symbol_filter="AAPL")` returns only jobs whose `symbols` array contains AAPL.
- Reuse the existing servicer/db fixtures from `tests/conftest.py` and the style in
  `test_backfill_jobs.py`.

**Verification**:
- `cd services/xstockstrat-ingest && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40`
  — lint clean and coverage ≥ 40%.
- After any `pyproject.toml` change, also run `uv lock` and commit `uv.lock` (no dep change expected here).

---

### Step 5 — service: marketdata `DeleteBackfilledData` scoped delete RPC

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, safe scoped deletion of backfilled bars; DBA — scoped delete safety on the OHLCV hypertable (no full-table deletes), index/partition correctness

**Codebase Evidence**:
- Confirmed via Read `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go`:
  - `var _ marketdatav1connect.MarketDataServiceHandler = (*MarketDataHandler)(nil)` L18 — handler
    must implement the generated interface (which gains `DeleteBackfilledData` after Step 2).
  - `GetDataCoverage` handler L122–131 is the closest analog (validates `req.Msg.Symbol == ""` →
    `CodeInvalidArgument`, delegates to `h.svc`, wraps errors).
  - gRPC adapter `grpcMarketDataAdapter` L149–192 — each RPC has an adapter method calling the
    Connect handler then `toGRPCError`. `DeleteBackfilledData` needs an adapter method too.
- Confirmed via Read `services/xstockstrat-marketdata/internal/service/marketdata_service.go`:
  - `GetDataCoverage` service method at L113 resolves the canonical timeframe via
    `timeframe.Resolve(req.GetTimeframe(), "")` (L117); `timeframe.Resolve` signature confirmed at
    `internal/timeframe/timeframe.go:55` → `func Resolve(enum commonv1.Timeframe, legacyStr string) (string, error)`.
  - `BackfillBars` L268 + `InsertBars` write into `marketdata.ohlcv`.
  - Admin scope is available server-side via `middleware.FromContext(ctx).AccessScope` (string)
    — confirmed in `internal/middleware/propagation.go` (`PropagationData.AccessScope`,
    `FromContext`); the gRPC server installs `middleware.UnaryServerInterceptor` (`cmd/server/main.go:100`).
  - `s.cfg.GetInt(key, default)` confirmed at `internal/config/config.go:108` for the delete-window guard.
- Confirmed via Read `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go`:
  - Table is `marketdata.ohlcv` with columns `(time, symbol, timeframe, open, high, low, close,
    volume, vwap, trade_count, source)` and `ON CONFLICT (symbol, timeframe, time)` (L42–47) — so
    PK `(symbol, timeframe, time)` backs an efficient scoped delete predicate.
  - `GetCoverage` (L139–156) shows the canonical scoped read pattern:
    `WHERE symbol=$1 AND timeframe=$2 AND time >= $3 AND time <= $4`.

**Instructions**:
- Repo: add `func (r *MarketDataRepo) DeleteBars(ctx context.Context, symbol, timeframe string,
  start, end time.Time) (int64, error)`:
  - Build a bounded `DELETE FROM marketdata.ohlcv WHERE symbol=$1` and append predicates:
    `AND timeframe=$2` only when `timeframe != ""`; `AND time >= $...` / `AND time <= $...` only when
    the respective bound is non-zero. **Never** issue a `DELETE` with no `symbol` predicate.
  - Return the affected-row count from the pgx `CommandTag` (`tag.RowsAffected()`).
- Service: add `func (s *MarketDataService) DeleteBackfilledData(ctx context.Context,
  req *marketdatav1.DeleteBackfilledDataRequest) (*marketdatav1.DeleteBackfilledDataResponse, error)`:
  - Reject unbounded requests: if `req.Symbol == ""` return an `InvalidArgument` error
    ("symbol required; refusing unbounded delete") (FR-5 server-side guard).
  - Admin gate: read `middleware.FromContext(ctx).AccessScope`, parse to int, and reject when the
    `0x04` ADMIN bit is unset with a `PermissionDenied` error (mirror the ingest/analysis 0x04 gate).
  - Resolve the timeframe: if `req.Timeframe != commonv1.TIMEFRAME_UNSPECIFIED`, call
    `timeframe.Resolve(req.Timeframe, "")` to get the canonical DB string; otherwise pass `""`
    (delete across all timeframes for the symbol/range).
  - Derive `start`/`end` from `req.Range` (zero values when absent → repo omits those predicates).
  - **Delete-window guard** (resolves the deferred open question): read
    `s.cfg.GetInt("marketdata.backfill.max_delete_days", 0)`. If > 0 and a bounded range is supplied
    whose span exceeds the configured days, reject with `InvalidArgument`. A whole-symbol delete
    (no range) is intentionally allowed at the server but is the case the UI double-confirms (Step 11).
  - Call `s.repo.DeleteBars(...)`, emit a ledger event (e.g. `marketdata.backfill.data_deleted`) via
    the existing `s.emitEvent(...)` helper for an audit trail, and return
    `&marketdatav1.DeleteBackfilledDataResponse{RowsDeleted: n}`.
- Handler: add `DeleteBackfilledData(ctx, req *connect.Request[...])` to `MarketDataHandler`
  (validate `req.Msg.Symbol == ""` → `CodeInvalidArgument` early, delegate to `h.svc`, wrap service
  errors mapping `InvalidArgument`/`PermissionDenied` to the matching connect codes), and add the
  matching `grpcMarketDataAdapter.DeleteBackfilledData` method calling the Connect handler then
  `toGRPCError` (extend `toGRPCError` if it must map `CodePermissionDenied` → `codes.PermissionDenied`).
- No new outbound gRPC call to another backend service is introduced (the ledger emit reuses the
  existing `s.ledger` client dialed with `middleware.UnaryClientInterceptor`, which propagates the
  three headers — confirmed in `NewMarketDataService` and `internal/middleware/propagation.go`), so
  §5c header-propagation is already satisfied by the existing interceptor.

**Verification**:
- `grep -n "DeleteBackfilledData" services/xstockstrat-marketdata/internal/handler/marketdata_handler.go services/xstockstrat-marketdata/internal/service/marketdata_service.go`
  — confirm handler + adapter + service methods exist.
- `grep -n "AccessScope\|0x04\|PermissionDenied" services/xstockstrat-marketdata/internal/service/marketdata_service.go`
  — confirm the admin gate is present on the delete path.
- Behavioral + coverage check covered by Step 6.

---

### Step 6 — test: marketdata scoped-delete coverage

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — create or modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — safe scoped deletion of backfilled bars; DBA — no full-table deletes

**Codebase Evidence**:
- Coverage command + threshold from root §CI/CD (Go ≥40%) and the §6 test-pairing table for
  Go services (the `COVERPKGS` excludes `cmd/handler/repository/telemetry/service`).
- New logic spans `service/` (excluded from CI coverage measurement) and `repository/` (also
  excluded). Per the §6 excluded-package note, the unbounded-reject / admin-gate / scoped-predicate
  logic should still be unit-tested even though it lands in excluded packages.

**Instructions**:
- Add table-driven tests for `DeleteBackfilledData`: (a) empty `Symbol` → `InvalidArgument`
  (unbounded reject); (b) missing admin bit in `AccessScope` → `PermissionDenied`; (c) a bounded
  request (symbol+range+timeframe) builds the scoped predicate and returns the repo row count;
  (d) a whole-symbol request (symbol only, admin) is accepted at the service layer;
  (e) a range exceeding `marketdata.backfill.max_delete_days` (when set) → `InvalidArgument`.
- Mock/stub the repo `DeleteBars` to assert it is never invoked without a symbol predicate.

**Verification**:
- `cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod`
  — lint clean.
- `cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"`
  — confirm ≥ 40%. Note: the new delete logic lives in `service/` + `repository/`, which are
  **excluded** from CI coverage measurement — the unit tests above provide the behavioral
  verification; the threshold gate is satisfied by the existing measured packages.

---

### Step 7 — config: register `marketdata.backfill.max_delete_days` delete-window guard

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify (add the key to the Config Keys Consumed table)
- `CLAUDE.md` (root) — modify (note the new key under Config Governance recently-added keys, per `docs/runbooks/config-rollout.md` "new key → PR to root CLAUDE.md")

**Reviewers**: `xstockstrat-marketdata` (service owner) — config key naming (`<service>.<category>.<key>`), default declared in service CLAUDE.md

**Codebase Evidence**:
- Confirmed via Read `services/xstockstrat-marketdata/CLAUDE.md` L44–59: existing
  `marketdata.backfill.*` namespace keys (`marketdata.backfill.batch_size`,
  `marketdata.backfill.rate_limit_rps`) — the new key fits the established `marketdata.backfill.*`
  category.
- `docs/runbooks/config-rollout.md` L199–207 governance table: a new non-breaking key requires the
  service owner + a PR to root `CLAUDE.md`. Naming convention `<service>.<category>.<key>` (L30–39).
- `s.cfg.GetInt(...)` read pattern confirmed at `internal/config/config.go:108`.

**Instructions**:
- Add to the marketdata CLAUDE.md Config Keys Consumed table:
  `| marketdata.backfill.max_delete_days | int | 0 | Max date-range span (days) a single scoped backfill delete may cover; 0 = no window cap. A whole-symbol delete (no range) is exempt and double-confirmed in the UI. |`
- Add a one-line note to the root `CLAUDE.md` Config Governance section recording the new key,
  owner `xstockstrat-marketdata`, feature 057.
- Default `0` (disabled) keeps current behavior; no `SetConfig` rollout is required to ship.

**Verification**:
- `grep -n "max_delete_days" services/xstockstrat-marketdata/CLAUDE.md CLAUDE.md` — present in both.

---

### Step 8 — service: UI insights-BFF wiring for cancel / list-jobs / status / delete

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — Connect-RPC call safety, admin-scope gating (per 049) so non-admins cannot reach the mutating RPCs; Security — admin/operator access-scope enforcement on mutating RPCs (FR-7)

**Codebase Evidence**:
- Confirmed via Read `services/xstockstrat-ui/src/lib/insightsBff.ts`:
  - `router.service(IngestService, { ... })` L90–99 already wires `listSignalSources` and
    `triggerBackfill` through `ingestClient` with `requireSession` + `backendHeaders`.
  - `backendHeaders(claims, ctx)` L25–31 sets `x-user-id`, `x-access-scope`
    (`rolesToAccessScope(claims.roles)`), `x-trace-id` — the propagation path.
  - Admin gate pattern: `const ADMIN_BIT = 0x04; if ((rolesToAccessScope(claims.roles) & ADMIN_BIT) === 0) throw new ConnectError('Admin scope required', Code.PermissionDenied);`
    (L62–68 / L82–87).
  - `router.service(MarketDataService, { async getBars ... })` L101–106 already wired via
    `marketDataClient`.
  - `handlerMap` uses `PREFIX = '/insights/api'` (L168–171) — new methods are auto-registered
    because they are added to existing `router.service(...)` blocks.
- Backend clients `ingestClient` / `marketDataClient` already exist in
  `services/xstockstrat-ui/src/lib/connectClients.ts` (L36 / L31), dialed at
  `INGEST_ENDPOINT` / `MARKETDATA_ENDPOINT` (both already in the ui docker-compose block — see
  Codebase Evidence in Step 9; no new env var).

**Instructions**:
- Extend the `router.service(IngestService, {...})` block with:
  - `getBackfillStatus` — `requireSession` then `ingestClient.getBackfillStatus(req, { headers: backendHeaders(claims, ctx) })` (read-only; no admin gate — operators monitor).
  - `listBackfillJobs` — same pattern, forwards the new `symbol` filter field transparently.
  - `cancelBackfill` — `requireSession`, then apply the `ADMIN_BIT = 0x04` gate (copy L82–87) before
    `ingestClient.cancelBackfill(...)` (mutating → admin only, FR-7).
- Extend the `router.service(MarketDataService, {...})` block with:
  - `deleteBackfilledData` — `requireSession`, apply the `ADMIN_BIT = 0x04` gate, then
    `marketDataClient.deleteBackfilledData(req, { headers: backendHeaders(claims, ctx) })`
    (destructive → admin only, FR-7; the marketdata server enforces it again per Step 5).
- All forwarded calls carry the three headers via `backendHeaders(...)` — satisfies §5c header
  propagation (reuses the existing BFF header builder; no new client introduced).

**Verification**:
- `grep -n "cancelBackfill\|deleteBackfilledData\|ADMIN_BIT" services/xstockstrat-ui/src/lib/insightsBff.ts`
  — confirm both mutating methods are present and each is preceded by the `0x04` gate.
- Behavioral check covered by Step 13.

---

### Step 9 — service: UI browser client for the Backfills page (marketdata via insights BFF)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/browserClients/insightsMarketDataClient.ts` — create

**Reviewers**: `xstockstrat-ui` (service owner) — Connect-RPC call safety, browser transport baseUrl correctness

**Codebase Evidence**:
- Confirmed via Read `services/xstockstrat-ui/src/lib/browserClients/insightsIngestClient.ts`:
  it builds `createConnectTransport({ baseUrl: '/insights/api' })` for `IngestService` — the
  insights-segment ingest client the Backfills page reuses for cancel/list/status/trigger.
- `services/xstockstrat-ui/src/lib/browserClients/marketDataClient.ts` exists but points at
  `'/trader/api'` (L5) — wrong segment for an insights-mounted Backfills page. A new
  insights-scoped marketdata client is needed for `deleteBackfilledData` (mirrors why
  `insightsIngestClient.ts` exists alongside the config-ui `ingestClient.ts`).
- Confirmed via `grep` on docker-compose.yml: the `xstockstrat-ui:` block (L433) sets
  `MARKETDATA_ENDPOINT: xstockstrat-marketdata:50053` (L448) and `INGEST_ENDPOINT: xstockstrat-ingest:50055`
  (L452) — both endpoints already wired; `.do/app.dev.yaml`/`.do/app.yaml` likewise carry
  `MARKETDATA_ENDPOINT`/`INGEST_ENDPOINT` for the ui service. **No new env var or port** required
  (confirmed present, not absent).

**Instructions**:
- Create `insightsMarketDataClient.ts` mirroring `insightsIngestClient.ts` but for
  `MarketDataService`:
  ```ts
  import { createClient } from '@connectrpc/connect';
  import { createConnectTransport } from '@connectrpc/connect-web';
  import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';
  // Routes through the insights BFF (/insights/api) so the Backfills page (mounted under
  // /insights) reaches the same handler that gates deleteBackfilledData to admin scope.
  const transport = createConnectTransport({ baseUrl: '/insights/api' });
  export const insightsMarketDataClient = createClient(MarketDataService, transport);
  ```
- Reuse the existing `insightsIngestClient` (no new file) for ingest calls
  (`triggerBackfill`/`listBackfillJobs`/`getBackfillStatus`/`cancelBackfill`).

**Verification**:
- `grep -n "insights/api" services/xstockstrat-ui/src/lib/browserClients/insightsMarketDataClient.ts`
  — confirm the insights-segment baseUrl.

---

### Step 10 — service: UI React-Query hooks for backfill management

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useBackfills.ts` — create

**Reviewers**: `xstockstrat-ui` (service owner) — Connect-RPC call safety, query invalidation correctness

**Codebase Evidence**:
- Confirmed via Read `services/xstockstrat-ui/src/hooks/useBacktest.ts`: the established hook
  pattern — `useMutation<Result, Error, Input>` with `mutationFn: (req) => insightsIngestClient.triggerBackfill(req)`,
  deriving `Input`/`Result` from `Parameters<...>` / `Awaited<ReturnType<...>>`. `useTriggerBackfill`
  (L24–28) already exists.
- Polling pattern for live progress (FR-2/FR-6): React Query `useQuery` with `refetchInterval`
  (the product spec OQ resolved live progress to **poll `GetBackfillStatus`**).
- Admin flag hook: `useIsAdmin()` from `@/hooks/useLiveStrategies` (used by
  `src/app/insights/strategies/page.tsx:11,31`), backed by `/api/auth/me` returning `{ isAdmin }`
  (`src/app/api/auth/me/route.ts`).

**Instructions**:
- Add hooks in `useBackfills.ts`:
  - `useBackfillJobs(filter)` — `useQuery` calling `insightsIngestClient.listBackfillJobs({ statusFilter, symbol, page })`;
    set a `refetchInterval` (e.g. 4000ms) so the list reflects live status/progress.
  - `useBackfillStatus(jobId)` — `useQuery` calling `insightsIngestClient.getBackfillStatus({ jobId })`
    with `refetchInterval` while the job is non-terminal (poll-for-progress, FR-2).
  - `useCancelBackfill()` — `useMutation` calling `insightsIngestClient.cancelBackfill({ jobId })`;
    on success invalidate the jobs query.
  - `useDeleteBackfilledData()` — `useMutation` calling
    `insightsMarketDataClient.deleteBackfilledData({ symbol, range, timeframe })`.
  - Reuse `useTriggerBackfill` from `useBacktest.ts` for the create form (or re-export).

**Verification**:
- `grep -n "listBackfillJobs\|getBackfillStatus\|cancelBackfill\|deleteBackfilledData\|refetchInterval" services/xstockstrat-ui/src/hooks/useBackfills.ts`
  — confirm all four operations and the polling interval are present.

---

### Step 11 — service: UI Backfills page (create / list / monitor / cancel / delete)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/backfills/page.tsx` — create

**Reviewers**: `xstockstrat-ui` (service owner) — UI correctness, confirmation UX for destructive delete, admin-scope gating (per 049) so non-admins cannot reach the page; Security — admin/operator access-scope enforcement on the page (FR-7)

**Codebase Evidence**:
- Confirmed via `find` the insights segment uses `'use client'` pages under
  `src/app/insights/<feature>/page.tsx` wrapped in `<AppShell>` (e.g.
  `src/app/insights/strategies/page.tsx` imports `AppShell` from `@/components/insights/AppShell`,
  `Card`/`Button`/`Badge` from `@/components/ui/*`).
- Admin-gated UI pattern confirmed in `src/app/insights/strategies/page.tsx`:
  `const { data: isAdmin } = useIsAdmin();` then `{isAdmin && <Button>…</Button>}` (L31, L62–67) —
  hides admin-only actions; the BFF (Step 8) is the real enforcement boundary.
- Typed-confirmation precedent: `window.confirm(...)` is used for destructive strategy deactivate
  (`src/app/insights/strategies/page.tsx:42-50`); the Backfills delete needs a stronger **typed**
  confirmation (operator types the symbol) per FR-5, and a **second** typed confirmation for a
  whole-symbol delete (no range).
- `BACKFILL_STATUS_*` enum and `BackfillJob` fields (`barsProcessed`/`barsTotal`/`chunksCompleted`/
  `chunksTotal`/`failedSymbols`/`error`/`status`) come from the regenerated TS stubs
  (`@xstockstrat/proto/ingest/v1/ingest_pb`), confirmed present on `BackfillJob` in the proto
  (`packages/proto/ingest/v1/ingest.proto` L24–40).

**Instructions**:
- Create a `'use client'` page wrapped in `<AppShell>` with:
  - **Create backfill form** (FR-1): symbol(s), timeframe (map to `common.v1.Timeframe`), date range
    → `useTriggerBackfill`. Gate the form to `isAdmin`.
  - **Job list + monitor** (FR-2/FR-6): render `useBackfillJobs(filter)` results in a table showing
    status badge, `barsProcessed/barsTotal`, `chunksCompleted/chunksTotal`, `failedSymbols`, `error`.
    Surface the real `barsTotal` (do not fabricate progress — FR-6). Live updates come from the
    hook's `refetchInterval`.
  - **Filter** (FR-3): status dropdown (maps to `statusFilter`) + symbol text input (maps to the new
    `symbol` filter field).
  - **Cancel** (FR-4): per-row Cancel button on `QUEUED`/`RUNNING` jobs → `useCancelBackfill`;
    `isAdmin`-gated; confirm before firing.
  - **Delete backfilled data** (FR-5): a delete panel scoped by symbol + optional range + optional
    timeframe → `useDeleteBackfilledData`; require the operator to **type the symbol** to enable the
    button; if no range is set (whole-symbol delete), require a **second** typed confirmation;
    `isAdmin`-gated. Show the returned `rowsDeleted` count.
- Map Connect error codes to friendly messages (the insights BFF normalizes error bodies to JSON —
  `insightsBff.ts` L215–220).

**Verification**:
- `grep -n "useBackfillJobs\|useCancelBackfill\|useDeleteBackfilledData\|isAdmin\|barsTotal" services/xstockstrat-ui/src/app/insights/backfills/page.tsx`
  — confirm list/monitor, cancel, delete, admin-gate, and truthful-progress rendering.

---

### Step 12 — service: UI nav entry to the Backfills page (admin-gated)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/AppShell.tsx` — modify (add an admin-gated nav link to `/insights/backfills`)

**Reviewers**: `xstockstrat-ui` (service owner) — navigation correctness, admin-scope gating so non-admins do not see the entry (FR-7)

**Codebase Evidence**:
- `AppShell` is the shared insights chrome imported by insights pages (confirmed import in
  `src/app/insights/strategies/page.tsx:5` → `@/components/insights/AppShell`). The exact nav-link
  list inside `AppShell.tsx` must be read at execute time to match its existing link structure.
- `useIsAdmin()` (`@/hooks/useLiveStrategies`) is the established client-side admin flag for
  conditionally rendering admin-only chrome.

**Instructions**:
- Read `services/xstockstrat-ui/src/components/insights/AppShell.tsx` first to find the existing nav
  link collection and its rendering pattern.
- Add a nav link to `/insights/backfills` (label e.g. "Backfills") rendered only when `useIsAdmin()`
  is true, matching the existing link markup. If `AppShell` does not currently consume `useIsAdmin`,
  add the hook call and gate the new link accordingly.
- **Not found note**: if `AppShell.tsx` has no nav-link list (e.g. it is a thin wrapper), instead add
  the admin-gated link in the insights landing page (`src/app/insights/page.tsx`) following the
  `{isAdmin && <Link …>}` pattern from `strategies/page.tsx`.

**Verification**:
- `grep -n "backfills\|useIsAdmin" services/xstockstrat-ui/src/components/insights/AppShell.tsx`
  — confirm the admin-gated link to `/insights/backfills`.

---

### Step 13 — test: UI E2E for the Backfills page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/backfills.spec.ts` — create

**Reviewers**: `xstockstrat-ui` (service owner) — E2E correctness, admin-scope visibility, destructive-delete confirmation UX

**Codebase Evidence**:
- Confirmed via `find` the E2E suite is organized per segment under `services/xstockstrat-ui/e2e/insights/`
  with `e2e/helpers/`; Playwright config at `services/xstockstrat-ui/playwright.config.ts`. Per the
  §6 pairing table, Next.js segments have **no coverage threshold** — `pnpm test:e2e` (the
  `test:e2e` script confirmed in `package.json:14`) is the verification.
- Existing insights E2E specs in `e2e/insights/` provide the auth-fixture / mock-backend pattern to
  reuse (read one before authoring).

**Instructions**:
- Add an E2E spec covering: (a) an admin user sees the Backfills nav entry and page; a non-admin
  does **not** (FR-7); (b) creating a backfill shows the job in the list (AC-1); (c) the job list
  renders status + bars/chunks progress and is filterable by status and symbol (AC-2); (d) cancel
  transitions a running job to CANCELED (AC-3); (e) the delete panel requires typing the symbol and
  a second confirmation for a whole-symbol delete, and surfaces `rowsDeleted` (AC-4).
- Reuse the auth/mock helpers from `e2e/helpers/` and an existing `e2e/insights/*.spec.ts` for the
  backend-mock shape.

**Verification**:
- `cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e` — lint clean; E2E suite passes.

---

### Step 14 — docs: backfill-management UI + new RPCs + config key

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/runbooks/historical-backfill.md` — modify (add a "Manage backfills from the UI" section: trigger/monitor/cancel/delete, admin-only)

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/historical-backfill.md` is the canonical backfill runbook (per
  `docs/runbooks/CLAUDE.md` and `docs/CLAUDE.md`). It currently documents triggering/monitoring via
  the `TriggerBackfill` RPC; the new UI page is the operator-facing complement.

**Instructions**:
- Add a UI section to `historical-backfill.md` describing the `/insights/backfills` page: creating a
  backfill, monitoring live progress (polled `GetBackfillStatus`), filtering by status/symbol,
  canceling an in-flight job (retains completed-chunk bars), and the scoped destructive delete
  (symbol + optional range + optional timeframe, typed confirmation, second confirmation for
  whole-symbol, admin-only). Reference the new `CancelBackfill` / `DeleteBackfilledData` RPCs and the
  `marketdata.backfill.max_delete_days` guard key. Keep all shell commands macOS/Homebrew-compatible.

**Verification**:
- `grep -n "backfills\|CancelBackfill\|DeleteBackfilledData\|max_delete_days" docs/runbooks/historical-backfill.md`
  — confirm the new section references the page, RPCs, and config key.

---

## Deviation Log

### Deviation: process — single integration PR (no per-step PRs)
**Spec/skill default**: sequential mode opens a stacked PR per step.
**Actual**: per the user's execute-time directive, each step is committed directly to `feature/backfill-management-ui` (pushed for backup) with **no per-step PRs**; a single integration PR → `main-dev` is opened after Step 14.
**Reason**: user preference to avoid 14 stacked PRs.
**Disposition**: process-only; every step still has its own commit + verification record.

### Deviation: Step 2 — codegen via host toolchain (Docker unavailable)
**Spec said**: Run `./scripts/buf-gen.sh` (normally the `Dockerfile.codegen` container).
**Actual**: The runner's Docker daemon is not running, so codegen ran on the host with the toolchain pinned to the CI `proto-freshness` versions (buf v1.47.2; protoc-gen-go v1.36.11 / -go-grpc v1.6.2 / -connect-go v1.19.2; grpcio-tools 1.80.0; TS plugins from the committed lockfile).
**Reason**: No Docker; host toolchain is the sanctioned sequential-mode fallback.
**Disposition**: CI-equivalent fallback. Regen diff confirmed **limited to `ingest/v1` + `marketdata/v1`** (Go/Python/TS + dist). Host `buf`'s bundled `google/protobuf` descriptors produced an unrelated doc-comment change in `gen/ts/google/protobuf/timestamp.ts`; reverted so committed stubs match CI's baseline.

### Deviation: Step 3/4 — `_finalize_backfill` cancel guard uses the in-process registry (not a DB re-read)
**Spec said (Step 3)**: "Also short-circuit `_finalize_backfill` so a canceled job is not overwritten back to COMPLETED/PARTIAL (check the registry / re-read the row status before the final `update_job`)."
**Actual**: Implemented as `if job_id in self._canceled_jobs: discard + return` (the registry branch the spec offered), **not** a DB re-read. The initial DB-re-read implementation broke two existing `TestRunBackfill` tests whose `db` mock makes `await get_job(...)` fail; the registry check is authoritative for the live run (CancelBackfill adds to the registry before writing CANCELED) and adds no DB round-trip.
**Reason**: Avoids an extra DB read on every finalize and the test-mock incompatibility; the spec explicitly allowed "check the registry."
**Disposition**: in-scope (one of the two spec-offered options). Verified: full ingest suite 130 passed, coverage 74.6% ≥ 40%.

### Deviation: Step 6 — refactored Step-5 code for unit-testability (user-approved Option A)
**Problem**: The new delete logic landed in `service/` + `repository/`, but those types aren't unit-mockable without a DB: `MarketDataService.repo` is a concrete `*MarketDataRepo` (un-stubbable), `config.Watcher` has no exported setter (so the `max_delete_days` window-guard couldn't be driven from `package service`), and `middleware`'s context key is unexported. The existing service test suite never constructs the service with a repo — so only the empty-symbol/missing-admin guards were testable as-written.
**Decision (asked via AskUserQuestion, user chose A)**: refactor for testability rather than lean on the Step-13 E2E.
**Actual**: Extracted two pure helpers (edits two Step-5 files + adds a repo test file, beyond Step 6's declared `marketdata_service_test.go`):
- `service.resolveDeletePlan(symbol, accessScope, tf, range, maxDays)` — the FR-5 guards (symbol-required→InvalidArgument, admin-0x04→PermissionDenied, window-cap→InvalidArgument) + timeframe/range resolution, taking scope+maxDays as plain params (no ctx/Watcher). `DeleteBackfilledData` now calls it.
- `repository.buildDeleteBarsQuery(symbol, timeframe, start, end)` — pure SQL+args builder; `DeleteBars` calls it + `Exec`.
**Tests**: `TestResolveDeletePlan` (8 sub-cases) + `TestBuildDeleteBarsQuery` (4 variants) asserting the DBA-critical invariant — the symbol predicate is ALWAYS present and always `$1`, so a full-table delete can never be issued.
**Disposition**: user-approved scope expansion. Verified: `go build` OK, `golangci-lint` 0 issues, all 7 tested packages pass.
