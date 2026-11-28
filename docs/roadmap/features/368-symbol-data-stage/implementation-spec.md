# Implementation Spec: symbol-data-stage

**Status**: `pending`
**Created**: 2026-11-28
**Feature**: `docs/roadmap/features/368-symbol-data-stage/feature.md`
**Total Steps**: 30
**Feature Branch**: `feature/symbol-data-stage`

---

## Execution Summary

The steps follow design.md, which is the authority for behaviour. A step that says "as design.md
§ N" adds only the file, symbol and test seams; decisions are cited as `D-n` (debate.md). Paths in a
step are relative to that step's **Service** directory unless they start with `packages/`, `docs/`,
`scripts/` or `services/`.

1. **Proto (Steps 1-2, one atomic unit).** The additive marketdata contract: the calendar RPC, the
   `return_bars` request field and the `bars` response field.
2. **Marketdata (Steps 3-9).** The calendar RPC, `BackfillBars` returning bars on request and
   staying quiet in the ledger for the stage, then the FR-7 default flip (Steps 7-8, one atomic
   unit) and the docs and durable scenarios that state the default. Marketdata lands first because
   it deploys first (design § 23 assumption 9).
3. **Config and reader (Steps 10-12, one atomic unit).** Config `062` (two keys, the changed
   seeded default), the `SetConfig` bounds, the stored set, the two `JobGraphSettings` accessors and
   their pins. One commit, because CI's whole-tree wiring check fails on a seeded-unread key.
4. **Schema (Step 13).** Analysis `032`: eight tables.
5. **Analysis seams (Steps 14-17).** The system-read identity and the shared drains, then the
   telemetry instruments. Both are used by every later handler.
6. **Job kinds (Steps 18-25).** Universe and shard handlers; the data job's pure rules, then its
   handler; the finality classifier and job.
7. **Run control (Steps 26-27).** `DataStageEnsure` and the `ensures` hook on the worker.
8. **Wiring (Steps 28-29).** `build_registry`, `app/main.py`, the end-to-end tests.
9. **Docs (Step 30).**

**Consumer surfaces (C-14).** None. The product spec marks the feature internal: no
`xstockstrat-ui` segment and no `xstockstrat-agent` tool consumes it, and no notify alert is emitted
(D-63). No UI or agent step exists; that is a decision, not an omission. The user-facing view is
deferred to the named follow-up `pipeline-cutover` (program feature 4).

**Tree.** `ccr-d10c1761-fxpr1d@b37b95de` = `origin/main-dev@bc497728` plus docs-only commits.
`origin/main-dev` is one commit ahead (`df9532c8`, `docs/runbooks/mcp-tools.md` and feature 345's
`context.md` only). Same deviation from `docs/sdd/tree-freshness.md` as the earlier phases: the
feature directory exists only on the harness branch, so the tree was not switched to `main-dev`.
No source file differs from `origin/main-dev` (`git diff --name-only HEAD origin/main-dev` lists
only `docs/` paths).

## Scenario Coverage (C-15)

`@AC-49` is unused.

| Scenario | Steps |
|---|---|
| `@AC-1` | 19 |
| `@AC-2` | 27 (two ensures, one database) |
| `@AC-3` | 19 |
| `@AC-4` | 19 |
| `@AC-5` | 19 |
| `@AC-6` | 23 |
| `@AC-7` | 23 |
| `@AC-8` | 21 (gap rule), 23 |
| `@AC-9` | 21 (session S is never a hole), 23 |
| `@AC-10` | 23 (pass 4 writes `fetch_failed`, reason `rpc`), 29 (all four passes, every job `succeeded`) |
| `@AC-11` | 21 (schedule dates), 23 |
| `@AC-12` | 21 (state and next check), 23 |
| `@AC-13` | 8 |
| `@AC-14` | 8 |
| `@AC-15` | 23 |
| `@AC-16` | 4 (Saturday answers 2026-11-27), 27 (no run row) |
| `@AC-17` | 4 (2026-11-26 is not a session), 23 |
| `@AC-18` | 27 (no further pass, no next run), 29 (created jobs finish) |
| `@AC-19` | 29 |
| `@AC-20` | 23 |
| `@AC-21` | 8 (a stored `vendor` is served from the vendor), 10 (the seed changes `default_value` only) |
| `@AC-22` | 21, 23 |
| `@AC-23` | 23 |
| `@AC-24` | 21, 23 |
| `@AC-25` | 23 |
| `@AC-26` | 27 |
| `@AC-27` | 21, 23 |
| `@AC-28` | 21, 23 |
| `@AC-29` | 19 |
| `@AC-30` | 19 |
| `@AC-31` | 19 (job succeeds, no shard), 27 (run marked done) |
| `@AC-32` | 15 |
| `@AC-33` | 23 |
| `@AC-34` | 19 |
| `@AC-35` | 29 |
| `@AC-36` | 19 |
| `@AC-37` | 4 |
| `@AC-38` | 27 (run row frozen), 23 (the data job reads no config key) |
| `@AC-39` | 27 (no run for the missed session), 23 (history covers 2026-11-25) |
| `@AC-40` | 19 |
| `@AC-41` | 19 |
| `@AC-42` | 23 |
| `@AC-43` | 4 (close is 16:00 on a half day), 27 |
| `@AC-44` | 19 |
| `@AC-45` | 29 |
| `@AC-46` | 23 (attempt 1 retries, attempt 2 defers, counter), 29 (pass 2 holds only that symbol) |
| `@AC-47` | 29 |
| `@AC-48` | 6 |
| `@AC-50` | 27 |
| `@AC-51` | 25 |
| `@AC-52` | 25 |
| `@AC-53` | 25 |
| `@AC-54` | 25 |
| `@AC-55` | 27 |
| `@AC-56` | 23 (data job), 25 (finality job) |
| `@AC-57` | 25 |
| `@AC-58` | 6 |
| `@AC-59` | 23 |
| `@AC-60` | 23 |
| `@AC-61` | 27 |
| `@AC-62` | 19 |
| `@AC-63` | 23 |
| `@AC-64` | 27 |
| `@AC-65` | 27 |
| `@AC-66` | 23 |

## Spec-time decisions

Names and seams the design leaves open, and facts found by search that are not in design.md or
recon.md. Each is this spec's choice and is open to challenge at `/sdd-review impl-spec`.

- **S-1. Kind names and key helpers live in `app/jobs/data_stage.py`.** `UNIVERSE_KIND`,
  `SHARD_KIND`, `SYMBOL_KIND`, `FINALITY_KIND`, `stage_epoch`, `parse_stage_epoch`, `stage_run_id`
  and `finality_run_id`. `app/engine/data_stage_ensure.py` imports them. design.md § 18 lists the
  complete set of changes to the 367 runtime, so nothing is added to `app/engine/job_graph.py`
  beyond that list. The import direction engine → jobs is new; no cycle results, because
  `job_graph.py` imports neither module.
- **S-2. `DataStageRuns`.** The run-row statements of design § 2 and § 9.3 (insert, read, pending,
  mark done, advance, finality due) are methods of a small class in `data_stage_ensure.py`, each
  one `bounded_txn(db_pool, 5)`. `DataStageEnsure` receives it. design § 22 asks for ensure unit
  tests on virtual clocks with an in-memory repository; this class is what the in-memory double
  replaces. The real class is tested on PostgreSQL.
- **S-3. `as_of` unset.** `GetLastClosedSession` with no `as_of` uses the server's current time.
  The stage always sends `as_of`.
- **S-4. A woken parent succeeds.** The universe and shard handlers return `Succeeded()` when
  `job.wait_round > 0`. design § 4 states the round-0 order only; a woken parent re-runs its handler
  from the top (`app/repositories/pipeline_jobs.py:132`).
- **S-5. `timeout` is passed to a stub only when set.** `_drain_positions_paged(…, timeout=None)`
  and the shared drains add the `timeout=` keyword to the stub call only when it is not `None`, so
  a legacy call site issues the same stub call as today (D-49: "legacy callers do not pass").
- **S-6. The `return_bars` range cap is checked in the handler.** `BackfillBars` in
  `internal/handler/marketdata_handler.go:124-127` wraps every service error as `Internal`, so a
  typed `InvalidArgument` returned by the service reaches the client as `INTERNAL`. The cap is
  checked beside the existing `symbols required` check (`:121-123`), which already yields
  `INVALID_ARGUMENT` on the wire. Rejected: forwarding service errors with `forwardConnectErr`,
  which would also change the wire code of the existing non-`1d` timeframe rejection.
- **S-7. Test doubles.** `StageJob` (the handler-facing surface of `ClaimedJob`, with `db()` over a
  real pool), `data_stage_pg` (a pool over the 031 and 032 tables), `FakeDataStageRuns` and
  `FakeJobRepo.list_by_run` land in `tests/conftest.py`, the Python fixture home (C-13).
- **S-8. Handler tests run on PostgreSQL.** A handler's only database access is `job.db()`, so the
  handler tests of Steps 19, 23, 25 and 29 carry the `real_pg` marker. Pure rules (Step 21, the
  finality classifier in Step 25) and the ensure state machine (Step 27) are tested without a
  database.
- **S-9. Config docs rows land in Step 10**, as in feature 367 (C-10): the analysis key-table rows
  and the config-governance entry are in the config commit.
- **S-10. Found by search, not in design.md or recon.md.**
  - `scripts/migration-rerun.py:1114` hard-codes the analysis tip `31` (Step 13).
  - `tests/test_config_read_classification.py:62-66` (`FR3_KEYS`) and
    `tests/test_config_zero_clamps.py:70-74` (`AC6_ROWS`) must each gain the new int key (Step 12).
  - `FakeJobRepo` (`tests/conftest.py:644`) has no `list_by_run` (Step 27).
  - `BoundedTxn` exposes `fetch`, `fetchrow`, `fetchval` and `execute` only
    (`app/repositories/read_budget.py:195-207`), so a multi-row insert is one `execute` over
    `unnest` arrays, as `_PARK_INSERT_SQL` does.
  - The handler contract (`tests/test_job_handler_contract.py`) forbids the names `db_pool` and
    `control_pool`, an `asyncio.timeout` around a `.db(` block, and any await inside a `.db(` block
    that is not on `conn`. It scans every file under `app/jobs/`, so the new module is covered
    without a test change.
  - `docs/roadmap/program-job-graph-analysis-pipeline.md:82` still describes a backfill child
    (Step 30).
  - `buf` is not installed in this sandbox (Steps 1-2: `docs/runbooks/codegen-toolchain-host-setup.md`).
- **S-11. Probes run at spec time, then reverted.**
  - Flipping the two stored `default_value` cells of `fundamentals.snapshot_source` in
    `scripts/config-wiring-stored.json` leaves `node scripts/check-config-wiring.mjs --final` at
    exit 0. The Go reader's default is a constant, not a literal, so the checker compares nothing.
    The code default (Step 7) and the seeded default (Step 10) can therefore land in separate
    commits.
  - Flipping the code default in `snapshotSource()` alone makes the
    `internal/service` test package panic at `TestFundamentals_ProviderFollowsLiveConfig_AC7`
    (`marketdata_service_test.go:366`). The count of affected tests could not be measured, because
    the package stops at the first panic. Steps 7 and 8 are one unit for this reason.
- **S-12. Step 10 lists eight files.** The seed, bounds, stored set and docs rows must be one
  commit (C-10), as in feature 367's Step 1.

## Open points for the operator

Not decided by this spec. Each has a default that follows design.md as written.

- **O-1. The stored description of `fundamentals.snapshot_source`.** The seeded text says "Seeded
  vendor (no serving change at deploy) … Unrecognized value → WARN + fail-safe to vendor"
  (`scripts/config-wiring-stored.json:3634`). After Step 7 the fail-safe is `edgar`. design § 13
  changes `default_value` only. Default: Step 10 leaves the description as it is. Alternative:
  rewrite it in `062`, guarded on the old text, as migration `055` did for another key.
- **O-2. `feature/symbol-data-stage` does not exist on `origin`.** The proto verification compares
  against that branch. `/sdd-execute` creates it from `main-dev` before Step 1.

## Step Dependencies

- **Steps 1+2 land together.** Trigger (`step-constraints.md` §C): a `.proto` edit needs its
  generated stubs in the same commit (CI `proto-freshness`). No descriptor-parity guard covers
  `Bar`, `BackfillBarsRequest` or `BackfillBarsResponse` (searched: `fields_by_name`, `_MAPPED`,
  `covers_every_proto_field`; the one marketdata hit is `Fundamentals` in
  `services/xstockstrat-indicators/tests/test_fundamental_metrics.py:45`).
- Step 3 requires Steps 1-2. Step 4 [test] covers Step 3.
- Step 5 requires Steps 1-2. Step 6 [test] covers Step 5.
- **Steps 7+8 land together.** Trigger: Step 7 changes a default that existing tests in the same Go
  package rely on; the package's tests fail until Step 8 pins them (S-11).
- Step 9 [docs] requires Step 7.
- **Steps 10+11+12 land together.** Triggers: a seeded config key needs its reader and the wiring
  check in the same commit; and Step 11's `int_positive` read turns
  `tests/test_config_read_classification.py:211` (`test_rule2_key_sets_match_classification`) red
  until Step 12 classifies it. One backend surface, two services, as in feature 367's Steps 1-3.
- **Config migration number.** `062` while the highest file on `origin/main-dev` is `061`. Re-check
  at execute (Step 10 item 1) and before the integration PR; a renumber forces a stored-set
  regeneration.
- **Stored set.** Step 10 regenerates `scripts/config-wiring-stored.json`. Regenerate it again
  after any `origin/main-dev` merge that brings in another config migration (`inputs_sha256`).
- Step 13 requires nothing from Steps 1-12. Steps 18-29 require Step 13.
- Step 14 requires nothing earlier. Step 15 [test] covers Step 14.
- Step 16 requires nothing earlier. Step 17 [test] covers Step 16.
- Step 18 requires Steps 11, 13, 14 and 16. Step 19 [test] covers Step 18.
- Step 20 requires Step 18 (same module). Step 21 [test] covers Step 20.
- Step 22 requires Steps 1-2 (generated `return_bars`, `bars`), 14, 16 and 20. Step 23 [test]
  covers Step 22.
- Step 24 requires Steps 1-2, 14, 16 and 18. Step 25 [test] covers Step 24.
- Step 26 requires Steps 1-2 (generated `GetLastClosedSession`), 11, 13 and 18. Step 27 [test]
  covers Step 26.
- Step 28 requires Steps 18, 22, 24 and 26. Step 29 [test] covers Step 28.
- Step 30 [docs] requires Steps 3, 5, 22, 24, 26 and 28.
- **Deploy order.** Marketdata deploys before analysis. Before marketdata honours `return_bars`,
  captured bars are NULL and those rows are excluded from the finality sample (design § 23
  assumption 9). Before marketdata serves `GetLastClosedSession`, the ensure logs one WARN per
  minute and creates no run.
- **Open risks carried from design.md, with their owners.**
  - Vendor finality is measured, not proven: Step 25 (classifier, sample), Step 30 (the operator
    procedure). The staging verification of design § 9.7 (3 sessions, 0 `drift`, the
    `BackfillFundamentals` duration) is a launch checklist item, not a step.
  - The Grafana drift rule lives outside the repo: Step 30 ships its definition; creating it is a
    launch checklist item.
  - The throughput ceiling and the shared vendor budget: measured in feature 369's shadow run. No
    step here.
  - An unmodelled closure, a missed session, an abandoned run, a missed finality check: Step 30
    documents them; feature 369 must tolerate them (design § 17).
  - The snapshot bound (25,000 rows guaranteed per attempt): Step 19 tests 100,000 rows.
- **Durable-suite promotion (C-16)** runs in the `/sdd-execute` integration PR, not in a step. It
  covers this feature's scenarios and the EXTEND cases in design.md § Business Rules Touched
  (`@AC-11 @AC-15 @feature-367`, `@FR-9 @regression @feature-367`, `@AC-14 @feature-295`). The one
  signed CHANGE (twelve marketdata scenarios, D-15) lands in Step 9, with the tests it describes.
- **Verification runs recorded at spec time**, on the tree above:
  `node scripts/check-config-wiring.mjs --final` and `--doc-check`,
  `python3 scripts/check-context-map.py`, `python3 scripts/check-otel-produced-signals.py` and
  `python3 scripts/check-migration-order.py origin/main-dev` exit 0. In analysis,
  `ruff check . && ruff format --check .` exits 0 and `uv run --extra dev pytest` on
  `test_job_graph_settings.py`, `test_job_handler_contract.py`, `test_held_position_drains.py` and
  `test_pipeline_jobs_real_pg.py` passes (94 tests; PostgreSQL 16 binaries are present). In
  marketdata, `GOWORK=off go test ./internal/service/ ./internal/handler/ ./internal/timeframe/`
  passes. In `packages/proto`, `GOWORK=off go test ./marketsession/...` passes. **Not run:**
  `buf` (absent), `pnpm` commands in `xstockstrat-config` (`node_modules` not installed),
  `golangci-lint`.
- **`uv run --extra dev`.** Every analysis command below passes `--extra dev`, as feature 367's
  spec recorded for this sandbox.

---

### Step 1 — proto: `GetLastClosedSession`, `BackfillBarsRequest.return_bars`, `BackfillBarsResponse.bars`

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/marketdata/v1/marketdata.proto` — modify

**Reviewers**: Proto Reviewer — Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` passes, `buf breaking` passes against dev trunk, BSR publication readiness; `xstockstrat-marketdata` service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency; `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Service block: `service MarketDataService` at `packages/proto/marketdata/v1/marketdata.proto:12-82`; last RPC `AckDelistingAlerts` at `:81`; `GetDataCoverage` at `:32`.
- `message BackfillBarsRequest` at `:157-164`, fields 1 to 5 used (`timeframe_enum = 5`).
- `message BackfillBarsResponse` at `:166-171`, fields 1 to 4 used (`symbol_results = 4`).
- `message Bar` at `:84-98`.
- `google/protobuf/timestamp.proto` is already imported (`:7`).
- Session dates as `YYYY-MM-DD` strings: `packages/proto/common/v1/common.proto:172` ("first_unservable_date is YYYY-MM-DD (NYSE session date), never a timestamp").
- No closed-set string is added (C-04): the new fields are a bool, a repeated `Bar`, timestamps and one date string.

**Lands with**: `Step 2`

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. In the `MarketDataService` block, after `GetDataCoverage` (`:32`), add
   `rpc GetLastClosedSession(GetLastClosedSessionRequest) returns (GetLastClosedSessionResponse);`
   with a one-line comment: the last closed NYSE regular session at `as_of`; early closes are not
   modelled.
2. After `message GetDataCoverageResponse` add the two messages exactly as design.md § 3:
   `GetLastClosedSessionRequest { google.protobuf.Timestamp as_of = 1; }` and
   `GetLastClosedSessionResponse { string session_date = 1; google.protobuf.Timestamp closed_at = 2;
   google.protobuf.Timestamp day_start = 3; google.protobuf.Timestamp day_end = 4; }`, with the
   field comments of § 3 (`YYYY-MM-DD, America/New_York`; `16:00 NY of session_date`;
   `00:00:00 NY`; `23:59:59 NY`).
3. `BackfillBarsRequest`: add `bool return_bars = 6;` with a comment: when set, the response
   carries the written bars; refused with INVALID_ARGUMENT unless the range is explicit and at most
   7 days.
4. `BackfillBarsResponse`: add `repeated Bar bars = 5;` with a comment: set only when the request
   set `return_bars`.
5. Change nothing else. No field is renumbered or removed.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against "../../.git#branch=feature/symbol-data-stage,subdir=packages/proto"
```
Then Step 2's gate (the unit commits once).

---

### Step 2 — proto-gen: regenerate the marketdata stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/marketdata/v1/` — modify (generated)
- `packages/proto/gen/python/marketdata/v1/` — modify (generated)
- `packages/proto/gen/ts/marketdata/v1/` — modify (generated, including `gen/ts/dist/`)

**Reviewers**: Proto Reviewer — Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` passes, `buf breaking` passes against dev trunk, BSR publication readiness; `xstockstrat-marketdata` service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency; `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Generator: `./scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs); CI job `proto-freshness` fails on a stale `packages/proto/gen/` (`.github/workflows/ci.yml:257-314`).
- Go implementers survive a new RPC without edits: the marketdata handler embeds `marketdatav1connect.UnimplementedMarketDataServiceHandler` (`services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:22`) and its gRPC adapter embeds `marketdatav1.UnimplementedMarketDataServiceServer` (`:327`). The two hand-written client fakes embed the client interface (`services/xstockstrat-trading/internal/service/trading_sizing_test.go:33`, `services/xstockstrat-portfolio/internal/service/portfolio_service_test.go:20`).
- `buf` is absent in this sandbox; `docs/runbooks/codegen-toolchain-host-setup.md` provisions the pinned toolchain on a host.

**Lands with**: `Step 1`

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Before editing the `.proto`, confirm the toolchain reproduces the committed stubs:
   `./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/`. If it does not, stop and
   follow `docs/runbooks/codegen-toolchain-host-setup.md` (ledger, backtest-debug-info).
2. After Step 1's edit, run `./scripts/buf-gen.sh`. Commit the proto source and the generated
   stubs together. Never edit a generated file by hand.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen/   # only marketdata/v1 files change
git diff --stat packages/proto/gen/ | tail -1
for s in xstockstrat-marketdata xstockstrat-trading xstockstrat-portfolio; do (cd services/$s && GOWORK=off go build ./... && GOWORK=off go vet ./...); done
cd services/xstockstrat-analysis && PYTHONPATH=../../packages/proto/gen/python uv run --extra dev python -c "from marketdata.v1 import marketdata_pb2 as m; m.GetLastClosedSessionRequest(); assert 'return_bars' in m.BackfillBarsRequest.DESCRIPTOR.fields_by_name and 'bars' in m.BackfillBarsResponse.DESCRIPTOR.fields_by_name"
```

---

### Step 3 — service: the calendar RPC and the exported close helper

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `packages/proto/marketsession/marketsession.go` — modify
- `services/xstockstrat-marketdata/internal/service/last_closed_session.go` — create
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go` — modify

**Reviewers**: `xstockstrat-marketdata` service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `func closeAt(d time.Time) time.Time` at `packages/proto/marketsession/marketsession.go:41-44`; its only caller is `Reference` at `:71` (`grep -rn "closeAt" packages/proto/marketsession/` → `:41`, `:71`).
- `func DayStart` at `:33`, `func Open` at `:36`, `func PrevTradingDay` at `:56`, `func Reference(now) (ref, live)` at `:66-72`.
- The rule to reuse, in `ComputeSessionGaps`: `last, live := marketsession.Reference(now); if live { last = marketsession.PrevTradingDay(last) }` (`internal/timeframe/timeframe.go:108-111`).
- Marketdata resolves the package through `replace github.com/xstockstrat/contracts => ../../packages/proto` (`go.mod:49`), so the export is available without a version bump.
- Handler shape for a unary RPC with no validation: `GetHistoricalFundamentals` at `internal/handler/marketdata_handler.go:133-139`; adapter shape: `GetDataCoverage` at `:443-449`.
- The RPC is ungated: `internalCallerAllowlist` (`internal/service/authz.go:26-29`) names two RPCs and its comment says every other marketdata RPC is ungated.
- No outbound call is added, so header propagation does not apply.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `marketsession.go`: rename `closeAt` to the exported `Close` and update the call in `Reference`
   (`:71`). Give it a one-line doc comment: the 16:00 America/New_York regular-session close of
   d's date. Add no other symbol.
2. `last_closed_session.go`: `func (s *MarketDataService) GetLastClosedSession(_ context.Context,
   req *marketdatav1.GetLastClosedSessionRequest) (*marketdatav1.GetLastClosedSessionResponse, error)`.
   - `asOf` is `req.GetAsOf().AsTime()`, or `time.Now()` when `as_of` is unset (S-3).
   - `ref, live := marketsession.Reference(asOf)`; if `live`, `ref = marketsession.PrevTradingDay(ref)`.
   - `session_date` is `ref` formatted `2006-01-02` (`ref` is a New York midnight).
   - `closed_at = marketsession.Close(ref)`; `day_start = marketsession.DayStart(ref)`;
     `day_end = day_start.AddDate(0, 0, 1).Add(-time.Second)`.
   - It reads no repository and no config key.
3. `marketdata_handler.go`: add `GetLastClosedSession` on `MarketDataHandler` (the `:133-139`
   shape) and on `grpcMarketDataAdapter` (the `:443-449` shape). Add no entry to
   `internalCallerAllowlist`.

**Verification**: Step 4's commands. On its own this step must keep the build green:
```bash
cd packages/proto && GOWORK=off go test ./marketsession/...
cd ../../services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
for s in xstockstrat-portfolio xstockstrat-trading; do (cd ../$s && GOWORK=off go build ./...); done
```

---

### Step 4 — test: the calendar RPC table

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/last_closed_session_test.go` — create
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler_test.go` — modify
- `packages/proto/marketsession/marketsession_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Existing calendar tests: `TestIsTradingDay_ClosuresAndJuneteenth` and `TestPrevTradingDay_SkipsCarterClosure` (`packages/proto/marketsession/marketsession_test.go:8`, `:38`).
- Adapter test shape: `TestSyncWatchlistDelistings_AdapterMapsPermissionDenied` (`internal/handler/marketdata_handler_test.go:164`).
- Thanksgiving 2026 is Thursday 2026-11-26; holidays are computed by rule (`marketsession.go:95`). 2026-11-27 is a Friday and a half day, which the package does not model (`marketsession.go:1-2`).
- New logic is in excluded packages (`service/`, `handler/`) — no coverage threshold applies to it; the table test is the verification. A `test` step is still required.
- C-13: the table rows are scenario one-offs with one consumer, so they stay inline.

**TDD**: `red-green required`

**Covers**: `AC-37`, `AC-16` (the calendar half), `AC-17` (the calendar half), `AC-43` (the calendar half)

**Instructions**:
1. `last_closed_session_test.go`: one table test calling the service method with a zero-value
   `MarketDataService`. Rows, each asserting `session_date`, `closed_at`, `day_start`, `day_end`:
   - `@AC-37`: `as_of` 2026-11-27 16:15 New York → `2026-11-27`, `closed_at`
     `2026-11-27T21:00:00Z`, `day_start` `2026-11-27T05:00:00Z`, `day_end` `2026-11-28T04:59:59Z`
     (RED: this row);
   - `as_of` 2026-11-27 15:59 New York → `2026-11-25` (today's session is not closed);
   - `as_of` exactly 16:00 New York → `2026-11-27`;
   - `@AC-16`: Saturday 2026-11-28 10:00 New York → `2026-11-27`;
   - `@AC-17`: Thursday 2026-11-26 12:00 New York (holiday) → `2026-11-25`;
   - `@AC-43`: 2026-11-27 13:30 New York (after the real 13:00 half-day close) → `2026-11-25`, and
     14:00 the same day is still `2026-11-25`: the close is modelled as 16:00;
   - a DST change: Sunday 2026-11-01 → `2026-10-30`, and Monday 2026-11-02 17:00 New York →
     `2026-11-02` with `closed_at` `2026-11-02T21:00:00Z` and `day_start` `2026-11-02T05:00:00Z`;
     Monday 2026-03-09 17:00 New York → `closed_at` `2026-03-09T20:00:00Z`;
   - `as_of` unset → a response whose `session_date` parses as a date (S-3).
2. `marketdata_handler_test.go`: one test that `GRPCHandler().GetLastClosedSession` returns a
   response and no `Unimplemented` status.
3. `marketsession_test.go`: one test that `Close` of a January and of a July date is 16:00 New
   York (`21:00Z`, `20:00Z`).

**Verification**:
```bash
cd packages/proto && GOWORK=off go test ./marketsession/... -count=1
cd ../../services/xstockstrat-marketdata
GOWORK=off go test ./internal/service/ ./internal/handler/ -run 'LastClosedSession' -count=1 -v
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 5 — service: `BackfillBars` returns the written bars on request and is ledger-quiet for the stage

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/authz.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go` — modify

**Reviewers**: `xstockstrat-marketdata` service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `func (s *MarketDataService) BackfillBars` at `internal/service/marketdata_service.go:1543-1640`. Ledger events: `marketdata.backfill.started` at `:1578`, `marketdata.backfill.failed` at `:1626`, `marketdata.backfill.completed` at `:1630`. The fetched bars are in memory before the insert: `bars, err := src.GetBars(…)` at `:1593`, `s.barInserter.InsertBars(ctx, bars)` at `:1612`. A written symbol appends nothing to `results`. The response is built at `:1635-1640`.
- No `markWarm` call sits between `:1543` and `:1640` (design § 9.2).
- Grant mechanism: `type internalCallerGrant struct{ callerID, rpc, peerSAN string }` (`internal/service/authz.go:22`), `internalCallerAllowlist` (`:26-29`), `hasInternalCallerAuthority(ctx, rpc)` (`:46-65`), which iterates every `x-internal-caller` value. Existing use: `internal/service/delisting_sync.go:28`.
- RPC-name constants: `rpcSyncWatchlistDelistings`, `rpcAckDelistingAlerts` (`authz.go:14-17`).
- The service receives the inbound gRPC context: adapter `BackfillBars` (`internal/handler/marketdata_handler.go:355-361`) → handler (`:120-130`) → `h.svc.BackfillBars(ctx, req.Msg)`.
- Handler validation precedent that yields `INVALID_ARGUMENT` on the wire: `symbols required` (`:121-123`); the service-error wrap at `:124-127` yields `INTERNAL` (S-6).
- `Bar.symbol` is filled by the Alpaca source: `barFromAlpaca(symbol, b, t, timeframe)` (`internal/alpaca/client.go:459`).
- No outbound call is added, so header propagation does not apply.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `authz.go`: add the constant `rpcBackfillBarsLedgerQuiet = "BackfillBars.ledger_quiet"` beside
   the two RPC constants, and the grant `{callerID: "analysis-data-stage", rpc:
   rpcBackfillBarsLedgerQuiet, peerSAN: "xstockstrat-analysis"}` (D-48). Update the allowlist
   comment (two lines at most): this grant suppresses ledger events only; `BackfillBars` itself
   stays ungated.
2. `marketdata_service.go`, `BackfillBars`:
   - compute `quiet := hasInternalCallerAuthority(ctx, rpcBackfillBarsLedgerQuiet)` once, after
     the timeframe rejection;
   - skip the three `s.emitEvent` calls (`:1578`, `:1626`, `:1630`) when `quiet`. Metrics
     (`telemetry.RecordBackfillSymbol`) and logs are unchanged;
   - when `req.GetReturnBars()`, append each written symbol's `bars` to a slice after its
     `InsertBars` succeeded, and set `Bars` on the response. When the flag is unset the response is
     byte-identical to today's (durable `@AC-14 @feature-294`).
3. `marketdata_handler.go`, `BackfillBars`: after the `symbols required` check, reject with
   `connect.CodeInvalidArgument` when `return_bars` is set and the range has no start, no end, or
   spans more than 7 days (a named constant, `returnBarsMaxRange = 7 * 24 * time.Hour`; D-64).
   Change no other error mapping (S-6).

**Verification**: Step 6's commands. On its own:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go test ./internal/service/ ./internal/handler/ -count=1
GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 6 — test: `return_bars`, the range cap and ledger suppression

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/backfill_outcome_test.go` — modify
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `type recordingLedger` at `internal/service/backfill_outcome_test.go:75`; `newOutcomeBarsSvc(src, inserter) (*MarketDataService, *recordingLedger)` at `:98`; the `backfillBars(t, svc, symbols...)` helper at `:121`.
- A context carrying a verified peer SAN: the helper at `internal/service/authz_test.go:28` (`peer.NewContext(ctx, &peer.Peer{AuthInfo: credentials.TLSInfo{State: state}})`), used by `TestInternalCaller_RequiresHeaderAndVerifiedPeerSAN` (`:35`). Same package as the backfill tests.
- Adapter error-mapping test shape: `TestToGRPCError_ConnectCodeCast` (`internal/handler/marketdata_handler_test.go:69`).
- Backfill metric assertions: `reader := serviceMetricReader(t)` and `backfillSymbolCounts(t, reader)` in `TestBackfillBars_SymbolOutcomeCounts_AC14` (`internal/service/marketdata_service_test.go:5700-5727`), same package.
- New logic is in excluded packages (`service/`, `handler/`) — no coverage threshold applies to it.
- C-13: the bar values are scenario one-offs; the ledger double and the peer-context helper already have one home each and are reused, not copied.

**TDD**: `red-green required`

**Covers**: `AC-48`, `AC-58`

**Instructions**:
1. `backfill_outcome_test.go`:
   - `@AC-58`: a one-day `BackfillBars` for `AAPL` with `ReturnBars: true` returns exactly the
     source's bar for `AAPL` in `Bars` (RED); the same call without the flag returns an empty
     `Bars` and the same `BarsWritten`, `FailedSymbols`, `ExpectedBars` and `SymbolResults`;
   - with `ReturnBars: true`, a symbol whose insert fails and a symbol with zero bars contribute no
     bar;
   - `@AC-48`: a call whose context carries `x-internal-caller: analysis-data-stage` and the
     verified SAN `xstockstrat-analysis` appends no event to `recordingLedger` (RED), for a
     written run and for a failed run; the same call without the header appends
     `marketdata.backfill.started` and `marketdata.backfill.completed`;
   - the header with a different SAN (`xstockstrat-ingest`), and the right SAN without the header,
     both append the events (the grant needs both);
   - a quiet call still counts its outcomes in `marketdata.backfill.symbols`, asserted with the
     package's `serviceMetricReader(t)` and `backfillSymbolCounts(t, reader)` helpers.
2. `marketdata_handler_test.go`, through `GRPCHandler().BackfillBars`:
   - `@AC-58`: `return_bars` with a 10-day range → `codes.InvalidArgument`;
   - `return_bars` with no range, or a range missing its start or its end → `codes.InvalidArgument`;
   - `return_bars` with a range of exactly 7 days is not rejected by the handler.

**Verification**:
```bash
cd services/xstockstrat-marketdata
GOWORK=off go test ./internal/service/ ./internal/handler/ -run 'Backfill|ReturnBars|InternalCaller' -count=1 -v
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "type recordingLedger" --include="*_test.go" .   # C-13: one declaration site
```

---

### Step 7 — service: EDGAR becomes the code default of the snapshot source

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: `xstockstrat-marketdata` service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Constants `snapshotSourceEdgar`, `snapshotSourceVendor` at `internal/service/marketdata_service.go:2036-2039`; their comment at `:2034-2035` says "\"vendor\" is the safe default".
- `func (s *MarketDataService) snapshotSource() string` at `:2044-2054`: `v := s.fundCfg.GetString("fundamentals.snapshot_source", snapshotSourceVendor)` (`:2045`); the unknown-value branch logs `falling back to vendor` and returns `snapshotSourceVendor` (`:2052-2053`). Its doc comment at `:2041-2043` states the fallback.
- It is the only reader of the key (`grep -rn "snapshot_source" services/xstockstrat-marketdata --include=*.go | grep -v _test.go`: the read at `:2045`, the rest are comments).
- Config-key contract (C-05): namespace `marketdata`, stored key `fundamentals.snapshot_source`, `value_type` string, code default `vendor` → `edgar`, reader `internal/service/marketdata_service.go:snapshotSource`, seed migration config `030` (changed default in `062`, Step 10), live read at each request.
- The non-filer fallback to the vendor is unchanged code: `edgarResolve` at `:2096`, the fallback branch at `:2112-2125`.

**Lands with**: `Step 8`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `snapshotSource()`: the default argument at `:2045` becomes `snapshotSourceEdgar`, and the
   unknown-value branch returns `snapshotSourceEdgar` with the WARN text `falling back to edgar`.
2. Rewrite the two comments (`:2034-2035`, `:2041-2043`) to state the new default and fallback, at
   most two lines each (root `CLAUDE.md` § How to Act #5).
3. Change no other line. No stored value is touched by code.

**Verification**: Step 8's gate for the Steps 7+8 unit.

---

### Step 8 — test: pin the vendor-default tests and cover the new default

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `type fakeCfg struct { bools; ints; strings }` at `internal/service/marketdata_service_test.go:290-294`; `GetString` at `:317`.
- The shared vendor-path builder `func enabledCfg(provider string) *fakeCfg` at `:340-357` sets no `strings` map; 32 call sites (`grep -c "enabledCfg(" internal/service/*_test.go`).
- The existing pin idiom: `vendorAxisCfg()` at `:843-847` (`cfg.strings = map[string]string{"fundamentals.snapshot_source": snapshotSourceVendor}`), also at `:4966`.
- Tests that already pin `edgar` assign a fresh `strings` map (`:2820`, `:2854`, `:2880`, `:2901`, `:2919`, `:3296`, `:3318`, `:3519`, `:3850`, `:4563`), so a default pin inside `enabledCfg` does not change them.
- Tests that do not use `enabledCfg`: a `config.MustSnapshotWatcher` snapshot at `:366-372` (`TestFundamentals_ProviderFollowsLiveConfig_AC7`), and literal `&fakeCfg{…}` values at `:577`, `:656`, `:920`, `:2528`, `:2560`, `:2698`.
- EDGAR-path builders: `edgarSnapshotSvc(…)` at `:2783`, `absenceSvc(cfg, vendor)` at `:3842`, `edgarCfg(edgarOn, finnhubOn)` at `:3848`.
- Spec-time probe (S-11): with Step 7 applied alone, the package panics at `TestFundamentals_ProviderFollowsLiveConfig_AC7`.
- New logic is in an excluded package (`service/`) — no coverage threshold applies to it.
- C-13: the pin stays in the two existing builders; no new fixture home.

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: `AC-13`, `AC-14`, `AC-21` (the serving half)

**Instructions**:
1. Write the three new tests first and see `@AC-13` fail against the pre-Step-7 tree:
   - `@AC-13`: a config with no `fundamentals.snapshot_source` and a stored EDGAR period for
     `AAPL` (through `edgarSnapshotSvc`) serves a snapshot whose source is `edgar` (RED);
   - `@AC-14`: `snapshot_source` `edgar`, no producible EDGAR snapshot for `TSM`, a vendor
     enabled → the snapshot's source is the configured vendor;
   - `@AC-21`: a stored `vendor` value serves `AAPL` from the configured vendor;
   - `snapshotSource()` directly: unset → `edgar`; `"edgar"` → `edgar`; `"vendor"` → `vendor`;
     an unrecognized value → `edgar`.
2. Apply Step 7, then pin every test that relied on the old default, in this order:
   - add `strings: map[string]string{"fundamentals.snapshot_source": snapshotSourceVendor}` to
     both branches of `enabledCfg` (`:340-357`), and reduce `vendorAxisCfg` (`:843-847`) to a call
     of `enabledCfg(finnhub.SourceName)`;
   - run `GOWORK=off go test ./internal/service/ -count=1`; for each remaining failure or panic
     that is a vendor-path test, add the same pin to that test's own config (the snapshot at
     `:366-372` gets a `fundamentals.snapshot_source` `StringVal` of `vendor`);
   - repeat until the package is green. Never weaken an assertion and never change a test that
     pins `edgar`.
3. Record in the Deviation Log the list of test functions pinned outside `enabledCfg`, so the
   Step 9 scenario edits can be checked against it.

**Verification** (the single gate for the Steps 7+8 unit):
```bash
cd services/xstockstrat-marketdata
GOWORK=off go test ./internal/service/ -count=1
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "snapshotSourceVendor" internal/service/marketdata_service.go   # the constant and the vendor case only; no default
```

---

### Step 9 — docs: the changed default in the docs, the catalog and the twelve durable scenarios

**Status**: `pending`
**Service**: `docs/` and `services/xstockstrat-marketdata/` (documentation only)
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify (the `fundamentals.snapshot_source` row only)
- `services/xstockstrat-marketdata/docs/fundamentals.md` — modify
- `docs/patterns/config-governance.md` — modify (the global-key bullet only)
- `scripts/config-heal/catalog.tsv` — modify (one cell)
- `services/xstockstrat-marketdata/acceptance/fix-marketdata-fundamentals-cache.feature` — modify
- `services/xstockstrat-marketdata/acceptance/fix-fundamentals-roe-unit.feature` — modify
- `services/xstockstrat-marketdata/acceptance/fix-marketdata-secret-exposure.feature` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-marketdata/CLAUDE.md:86`: the key-table row, default cell `` `vendor` ``.
- `services/xstockstrat-marketdata/docs/fundamentals.md:14` and `:19`: the axis description and "the serving source only while `snapshot_source=vendor`".
- `docs/patterns/config-governance.md:619`: `` `marketdata.fundamentals.snapshot_source` (string, `vendor`) ``.
- `scripts/config-heal/catalog.tsv:139`: the `code_default` cell is `vendor`. The catalog is read by `scripts/check-config-wiring.mjs:527` and `:832-853`; no gate compares it with migration `041`'s text (searched `emit-heal-data`, `catalog_041`), and the fresh dry-run stops at migration 41 (`scripts/config-heal-dryrun.py:181-188`).
- The twelve scenarios (D-15, operator sign-off 2026-11-28T06:40Z, context.md): `fix-marketdata-fundamentals-cache.feature` `@AC-1` (`:11`), `@AC-9` (`:20`), `@AC-2` (`:29`), `@AC-3` (`:39`), `@AC-5` (`:56`), `@AC-6` (`:66`); `fix-fundamentals-roe-unit.feature` `@AC-2` (`:17`), `@AC-4` (`:35`); `fix-marketdata-secret-exposure.feature` `@AC-1` (`:9`), `@AC-2` (`:17`), `@AC-5` (`:25`), `@AC-7` (`:35`).
- The Given wording already used in the same suite: `Given "marketdata.fundamentals.snapshot_source" is "vendor" and …` (`fix-marketdata-fundamentals-cache.feature:50`, `:87`).
- `docs/sdd/business-rules/CLAUDE.md`: a rule enters the durable suites only by promotion. This step adds no rule; it applies the signed CHANGE to the Givens of existing ones (C-16).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `CLAUDE.md:86`: the default cell becomes `` `edgar` ``; in the description state that the
   vendor is the fallback for a symbol with no producible EDGAR snapshot, that an unrecognized
   value now fails safe to `edgar`, and that a stored value is never changed by a default change.
2. `docs/fundamentals.md:14-19`: state `edgar` as the default of the axis.
3. `config-governance.md:619`: `(string, `edgar`)`, with one clause: default changed from `vendor`
   by feature 368; stored values unchanged. Edit no per-feature entry (they are append-only; the
   368 entry is Step 10's).
4. `catalog.tsv:139`: the `code_default` cell becomes `edgar`. Keep the tab structure (ten
   columns, `scripts/check-config-wiring.mjs:528`).
5. In each of the twelve scenarios add one step
   `Given "marketdata.fundamentals.snapshot_source" is "vendor"` (as an `And` after the existing
   first Given where one exists). Change no `When`, no `Then`, no tag and no other scenario.
   Check each against the Deviation Log list from Step 8: a scenario whose test did not need a pin
   is still edited (the signed list is the authority), and a pinned test whose scenario is not in
   the twelve is reported to the operator, not edited.

**Verification**:
```bash
grep -n "fundamentals.snapshot_source" services/xstockstrat-marketdata/CLAUDE.md docs/patterns/config-governance.md | grep -c "edgar"   # ≥ 2
awk -F'\t' 'NR==139 {print NF, $2, $5}' scripts/config-heal/catalog.tsv   # 10 marketdata.fundamentals.snapshot_source edgar
grep -c 'snapshot_source" is "vendor"' services/xstockstrat-marketdata/acceptance/fix-marketdata-fundamentals-cache.feature services/xstockstrat-marketdata/acceptance/fix-fundamentals-roe-unit.feature services/xstockstrat-marketdata/acceptance/fix-marketdata-secret-exposure.feature   # 8, 2, 4
node scripts/check-config-wiring.mjs --final && node scripts/check-config-wiring.mjs --doc-check && python3 scripts/check-context-map.py
```

---

### Step 10 — config: config `062` (two `analysis.pipeline.*` keys, the changed seeded default), the bounds, the stored set and the docs rows

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/062_analysis_data_stage_keys.up.sql` — create
- `services/xstockstrat-config/migrations/062_analysis_data_stage_keys.down.sql` — create
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify
- `services/xstockstrat-config/src/__tests__/analysisDataStageKeysSeedMigration.test.ts` — create
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify
- `scripts/config-wiring-stored.json` — modify (regenerated, never hand-edited)
- `services/xstockstrat-analysis/CLAUDE.md` — modify (§ Config Keys Consumed rows only)
- `docs/patterns/config-governance.md` — modify (one new per-feature entry)

**Reviewers**: `xstockstrat-config` service owner — Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability; `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias; `xstockstrat-marketdata` service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency; DBA — Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh`

**Codebase Evidence**:
- Last config migration: `061_analysis_pipeline_keys` (`ls services/xstockstrat-config/migrations | tail -2`).
- Seed shape: `migrations/061_analysis_pipeline_keys.up.sql:4-43` (one `INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id) VALUES … ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;`); its down at `061_….down.sql:4-14` (actor, `user_id IS NULL`, environment, a parenthesised OR-list of key and value pairs).
- The original seed of the changed key: `migrations/030_marketdata_edgar_snapshot_keys.up.sql:25-30` (`default_value` `vendor`); renamed to the relative key at `migrations/044_config_keys_relative.up.sql:216`. F-01: neither is edited.
- `default_value`-only change with an audit row: `migrations/041_heal_config_keys_to_reader_catalog.up.sql:497-510` (`UPDATE … SET default_value = …` and `INSERT INTO config.config_audit (namespace, key, old_value, new_value, changed_by, reason, environment, user_id, caller_identity)` with a reason starting `metadata:`).
- Actor columns change only with the value: `migrations/055_analysis_live_enrich_ttl_reseed.up.sql:2` ("actor columns change only with the value").
- The audit trigger writes a row only when `value_data` changes (`migrations/001_config_tables.up.sql:40`), so a `default_value` update needs its own audit insert.
- A migration with two statements: `migrations/052_alpaca_adaptive_rate_limit_keys.up.sql` (an `INSERT`, then an `UPDATE` at `:21`).
- Bounds registry: `const SCALAR_BOUNDS_REGISTRY` at `src/grpc/configServiceImpl.ts:115`, keyed `${namespace}.${relative key}` (`lookupScalarBounds`, `:200-202`); last analysis pipeline entry `'analysis.pipeline.retention_days'` at `:194`.
- Seed test precedent: `src/__tests__/analysisPipelineKeysSeedMigration.test.ts` (`HEAD`, `CONFLICT`, `ROW`, `only(ext)`), using `findOne` and `splitStatements` from `src/__tests__/migrationSql.ts:8`, `:19`. An `UPDATE` migration test precedent: `src/__tests__/liveEnrichTtlReseedMigration.test.ts:1-40`.
- Bounds test table: `TIMEOUT_KEY_FORMS` at `src/__tests__/setConfigScalarBounds.test.ts:299-326`; last row `pipeline.retention_days` at `:325`.
- Stored set: the two `fundamentals.snapshot_source` rows at `scripts/config-wiring-stored.json:3628-3649` (`"file": "030_marketdata_edgar_snapshot_keys.up.sql"`, `"default_value": "vendor"`); `inputs_sha256` at `:5596`. Generator: `scripts/config-wiring-stored.py` (needs `DATABASE_URL`, `psql`, `migrate`); CI job `config-wiring-stored` (`.github/workflows/ci.yml:1449-1502`).
- Docs: `services/xstockstrat-analysis/CLAUDE.md:303-308` (the six `pipeline.*` rows); `docs/patterns/config-governance.md:151` ("Newest first"), feature 367's entry at `:155`.
- `scripts/db-migrate.sh` applies config migrations before analysis migrations (product-spec.md § Database Changes); neither `062` nor analysis `032` depends on the other's content.
- Ledger: `SCALAR_BOUNDS_REGISTRY` bounds fire only at the `SetConfig` write edge (insights, 2026-09-06); the lower bound must be at least 1 for a key read through `int_positive` (insights, 2026-09-07).

**Lands with**: `Step 11, Step 12`

**TDD**: `red-green required (the bounds row: add the `setConfigScalarBounds.test.ts` row first and see it fail before editing `SCALAR_BOUNDS_REGISTRY`; the SQL is N/A and its static test is written alongside)`

**Covers**: `AC-21` (the seed half: the migration changes `default_value` and no stored value)

**Instructions**:
1. **Number.** `ls services/xstockstrat-config/migrations | tail -2`. Use `062` while the highest
   file on `origin/main-dev` is `061`. If it is higher, use highest + 1, record it in the
   Deviation Log, and read every `062` below as that number.
2. **Up, statement 1.** One `INSERT` in the 061 shape, namespace `analysis`, four tuples: each key
   for `staging` and `production`, `user_id NULL`, `consuming_service` `'xstockstrat-analysis'`,
   actor `'system:config-migration-feature-symbol-data-stage'`, ending `ON CONFLICT (namespace,
   key, environment, COALESCE(user_id, '')) DO NOTHING`. `value_data` equals `default_value`
   equals the code default:

   | Stored key | `value_type` | Value | Description must state |
   |---|---|---|---|
   | `pipeline.data_stage_enabled` | `bool` | `true` | Kill switch of the daily data stage (feature 368): when false no run, pass or job is created; jobs already created run to completion. Read fresh at each use |
   | `pipeline.data_stage_delay_minutes` | `int` | `30` | Minutes after the 16:00 New York close before a session's run starts; read once per run and frozen on the run row; bounds `[5,360]`; 0 or less reads as 30 |

3. **Up, statement 2.** One statement that changes the seeded default of the snapshot source and
   audits it, in the 041 shape:
   - a CTE `UPDATE config.config_values SET default_value = 'edgar' WHERE namespace = 'marketdata'
     AND key = 'fundamentals.snapshot_source' AND default_value = 'vendor' RETURNING namespace,
     key, environment, user_id`;
   - an `INSERT INTO config.config_audit (namespace, key, old_value, new_value, changed_by, reason,
     environment, user_id, caller_identity)` selecting from the CTE with `'vendor'`, `'edgar'`,
     the actor above, a reason starting `metadata: default_value`, and `NULL` caller identity.
   - The `SET` clause names `default_value` only. It sets no `value_data`, `updated_by`,
     `update_reason`, `caller_identity` or `description` (FR-7, O-1). No `pg_notify`: no served
     value changes.
4. **Down.** Two statements: an `UPDATE … SET default_value = 'vendor'` on the same namespace and
   key guarded by `default_value = 'edgar'`; and one `DELETE` of the two seeded keys in the 061
   down shape (`namespace = 'analysis'`, `environment IN ('staging', 'production')`, `user_id IS
   NULL`, the actor, and `((key = 'pipeline.data_stage_enabled' AND value_data = 'true') OR (key =
   'pipeline.data_stage_delay_minutes' AND value_data = '30'))`). The audit rows are not deleted.
5. **Bounds.** After `configServiceImpl.ts:194` add
   `'analysis.pipeline.data_stage_delay_minutes': { minValue: 5, maxValue: 360 },` (D-27).
   `pipeline.data_stage_enabled` is a bool and gets no entry.
6. **Seed test** `analysisDataStageKeysSeedMigration.test.ts`, mirroring the 061 test:
   - the up is exactly two statements;
   - statement 1 starts with the `HEAD` column list, ends with the `CONFLICT` clause, and its
     tuples are exactly the two keys times `staging` and `production` with the types and values
     above and a non-empty description; no stored key repeats its namespace;
   - the seeded int lies inside `[5, 360]`;
   - `@AC-21`: statement 2's `SET` clause is exactly `default_value = 'edgar'`; the statement
     contains none of `value_data =`, `updated_by`, `update_reason`, `pg_notify`; its `WHERE` holds
     the namespace, the key and `default_value = 'vendor'`; it inserts one audit row per updated
     row with the column list above;
   - the down's `UPDATE` sets `default_value = 'vendor'` only and is guarded by
     `default_value = 'edgar'`; the down's `DELETE` is restricted by the actor, `user_id IS NULL`,
     the namespace and each key's value pair, with the OR parenthesised.
7. **Bounds test.** Add `{ ns: 'analysis', key: 'pipeline.data_stage_delay_minutes', field:
   'intVal', min: 5, max: 360 }` after `setConfigScalarBounds.test.ts:325`.
8. **Stored set.** Regenerate `scripts/config-wiring-stored.json` with
   `scripts/config-wiring-stored.py`; never edit the JSON by hand. Routes, in order of preference:
   the CI-equivalent Docker route (the `timescale/timescaledb:latest-pg16` service and the
   `xstockstrat-migrate-ci` image, `.github/workflows/ci.yml:1449-1502`); the
   `config-wiring-stored` artifact of a CI run on the pushed branch (record the run URL in
   `context.md`); a throwaway local PostgreSQL 16. The first and third start a database for
   artifact generation, so name the route at the Phase-2 confirmation. If no route works the unit
   is blocked (P-03). Expected diff: `inputs_sha256`, four new rows whose `file` is
   `062_analysis_data_stage_keys.up.sql`, and `"default_value": "edgar"` on the two
   `fundamentals.snapshot_source` rows (their `file` stays `030_…`).
9. **Docs rows (C-10).**
   - `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed: two rows after `:308`, each
     with type, default, reader (`app/engine/job_graph.py:JobGraphSettings`), "seeded by config
     migration `062`"; the bool row says a missing row reads `true` (`get_bool(…, default=True)`);
     the int row says bounds `[5,360]`, read via `int_positive`, clamped with one WARN per distinct
     clamped value, read only by the data-stage ensure and frozen on the run row.
   - `docs/patterns/config-governance.md`: a `### feature 368 — symbol-data-stage
     (`xstockstrat-config` / `xstockstrat-analysis` / `xstockstrat-marketdata`)` entry directly
     above `:155` (newest first), in feature 367's shape: one paragraph (the two keys, the actor
     sentinel, the down's rule, the bounds entry), one paragraph on the changed default
     (`default_value` only, an audit row, stored values untouched, the down restores `vendor`),
     "Approval: owner + config team", then the table `Namespace | Key | Type | Default | Reader |
     Bounds | Notes` with three rows. Edit no earlier entry.

**Verification**: Step 12's combined gate for the Steps 10+11+12 unit.

---

### Step 11 — service: the two `JobGraphSettings` accessors

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/job_graph.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `class JobGraphSettings` at `app/engine/job_graph.py:191-232`; `worker_enabled` at `:207-208` (`self._cfg.get_bool("pipeline.worker_enabled", default=True)`); `_clamped(key, value, lo, hi)` at `:198-205`; `retention_days` at `:227-229` (`int_positive(self._cfg, "pipeline.retention_days", 7)` then `_clamped`).
- `def int_positive(cfg, key, default)` at `app/config/watcher.py:72-74`; `def get_bool(self, key, default=False)` at `app/config/watch_core.py:223`.
- Wiring attribution already exists for this file: `scripts/config-wiring.json:87-88` (`…/job_graph.py:int_positive`, `…/job_graph.py:self._cfg` → `analysis`). No registry entry is added.
- The gate compares a literal default with the seeded `default_value` (`scripts/check-config-wiring.mjs:538-544`), so each read passes its default as a literal.
- `app/config/watch_core.py` and `app/config/live_limits.py` are byte-identical across services (`scripts/check-watcher-copies.py`). Do not edit either.

**Lands with**: `Step 10, Step 12`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add to `JobGraphSettings`, after `retention_days`:
   - `data_stage_enabled() -> bool`: `self._cfg.get_bool("pipeline.data_stage_enabled", default=True)`
     (a missing row reads `true`; the feature-100 trap);
   - `data_stage_delay_minutes() -> int`: `int_positive(self._cfg,
     "pipeline.data_stage_delay_minutes", 30)`, then `self._clamped(…, 5, 360)`.
2. The class docstring says "the six `analysis.pipeline.*` keys"; drop the count.
3. Config-key contract (C-05). Namespace `analysis`; live mechanism: the service's `WatchConfig`
   watcher, read at each use (PLAT-6); seed migration: config `062` (Step 10).

   | Key | `value_type` | Code default | Reader |
   |---|---|---|---|
   | `pipeline.data_stage_enabled` | bool | `true` | `app/engine/job_graph.py:JobGraphSettings.data_stage_enabled` |
   | `pipeline.data_stage_delay_minutes` | int | `30` | `app/engine/job_graph.py:JobGraphSettings.data_stage_delay_minutes` |

**Verification**: Step 12's combined gate for the Steps 10+11+12 unit.

---

### Step 12 — test: the settings accessors, the read classification and the unit gate

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_job_graph_settings.py` — modify
- `services/xstockstrat-analysis/tests/test_config_read_classification.py` — modify
- `services/xstockstrat-analysis/tests/test_config_zero_clamps.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_job_graph_settings.py`: `_INT_GETTERS` at `:19-25`, `_settings(**values)` at `:28-29`, `_seeded_rows()` at `:105-110` (globs `*_analysis_pipeline_keys.up.sql` and asserts 12 rows), `test_seed_values_are_what_the_reader_returns` at `:113-124` (asserts the seeded key set equals the six 061 keys). Both keep passing: the new file's suffix is `_analysis_data_stage_keys`.
- `FR3_KEYS`: the pipeline entries at `tests/test_config_read_classification.py:62-66`; `test_rule2_key_sets_match_classification` at `:211`; `test_rule6_every_fr3_key_has_a_test_literal` at `:238`.
- `AC6_ROWS`: the pipeline rows at `tests/test_config_zero_clamps.py:70-74`; `test_ac6_table_covers_every_fr3_key` at `:101`.
- `get_bool` is not a classified read, so `pipeline.data_stage_enabled` joins neither set (feature 367 spec, Step 3).
- `def snapshot_watcher(namespace="analysis", **values)` at `tests/conftest.py:63`.

**Lands with**: `Step 10, Step 11`

**TDD**: `red-green required`

**Covers**: — (no scenario of its own: the kill-switch scenarios are asserted in Steps 19, 27 and 29; this step pins the read)

**Instructions**:
1. `tests/test_job_graph_settings.py`, using `snapshot_watcher`:
   - unset keys read `True` and `30`;
   - `pipeline.data_stage_enabled` stored `False` reads `False` (RED);
   - `pipeline.data_stage_delay_minutes` stored `0` or `-5` reads `30`; stored `2` reads `5` and
     stored `1000` reads `360`, with one clamp WARN per distinct stored value naming
     `analysis.pipeline.data_stage_delay_minutes`;
   - a value changed in the snapshot between two calls is seen by the second call;
   - seed-to-reader: parse the four tuples of
     `services/xstockstrat-config/migrations/<NNN>_analysis_data_stage_keys.up.sql` into a
     snapshot, one per environment, and assert the real `JobGraphSettings` returns each seeded
     value.
   The watcher values are scenario one-offs with one consumer, so they stay inline (C-13).
2. `test_config_read_classification.py`: add `"pipeline.data_stage_delay_minutes"` to `FR3_KEYS`
   after `:66`. Add nothing to `HONOUR_KEYS` or `ZERO_IS_LEGIT`.
3. `test_config_zero_clamps.py`: add `("pipeline.data_stage_delay_minutes", "int", 30)` to
   `AC6_ROWS` after `:74`.

**Verification** (the single gate for the Steps 10+11+12 unit):
```bash
# analysis (Steps 11+12)
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_job_graph_settings.py tests/test_config_read_classification.py tests/test_config_zero_clamps.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "snapshot_watcher\|from tests.conftest\|conftest" tests/test_job_graph_settings.py   # C-13: harness imported, not copied
# config (Step 10)
cd ../xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
ls migrations/062_*.up.sql migrations/062_*.down.sql
# read both: the .down restores default_value 'vendor' and deletes exactly the untouched seed rows
# whole-tree wiring, stored set and docs (Steps 10+11)
cd ../.. && node scripts/check-config-wiring.mjs --final && node scripts/check-config-wiring.mjs --doc-check
python3 scripts/check-watcher-copies.py && python3 scripts/check-context-map.py
python3 scripts/check-migration-order.py origin/main-dev
grep -c '"file": "062_analysis_data_stage_keys.up.sql"' scripts/config-wiring-stored.json   # 4
grep -n "analysis.pipeline.data_stage_delay_minutes" services/xstockstrat-config/src/grpc/configServiceImpl.ts   # 1 entry
```

---

### Step 13 — migration: analysis `032_symbol_data_stage` (eight tables)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/032_symbol_data_stage.up.sql` — create
- `services/xstockstrat-analysis/migrations/032_symbol_data_stage.down.sql` — create
- `scripts/migration-rerun.py` — modify (line 1114 only)

**Reviewers**: DBA — Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Last analysis migration: `031_pipeline_job_graph.up.sql` / `.down.sql` (`ls services/xstockstrat-analysis/migrations | tail -2`).
- The DDL is design.md § 11, verbatim.
- `tests/conftest.py:516-525` (`pipeline_pg`): asserts that no migration other than `*_pipeline_job_graph.up.sql` contains the text `pipeline_job`. The new file must not contain it, in a statement or in a comment (D-7).
- `scripts/migration-rerun.py:1114`: `for schema, want in (("ingest", 18), ("analysis", 31), ("config", p.cfg_top)):`. The config tip is computed (`:553-554`); the analysis tip is a literal (ledger fails, webhook-fanout-callback).
- CI `migration-order-gate`: `python3 scripts/check-migration-order.py origin/main-dev` exits 0 on the current tree.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. **Number.** `ls services/xstockstrat-analysis/migrations | tail -2`. Use `032` while the highest
   on `origin/main-dev` is `031`; otherwise highest + 1, recorded in the Deviation Log.
2. **Up.** The eight `CREATE TABLE IF NOT EXISTS` statements and four `CREATE INDEX IF NOT EXISTS`
   statements of design.md § 11, unchanged: `analysis.data_stage_runs`, `analysis.data_stage_users`,
   `analysis.data_stage_universe` (+ `idx_data_stage_universe_session_symbol`),
   `analysis.symbol_coverage` (+ `idx_symbol_coverage_session`), `analysis.symbol_bar`
   (+ `idx_symbol_bar_session`), `analysis.symbol_bar_hole`, `analysis.symbol_filings_check`,
   `analysis.data_stage_finality`. No foreign key. A two-line header at most (file name, service,
   feature slug). The text `pipeline_job` must not appear anywhere in the file.
3. **Down.** `DROP TABLE IF EXISTS` for the eight tables.
4. `scripts/migration-rerun.py:1114`: `("analysis", 31)` becomes `("analysis", 32)` (or the number
   from item 1). Change nothing else in the script.

**Verification** (offline; no database):
```bash
ls services/xstockstrat-analysis/migrations/032_*.up.sql services/xstockstrat-analysis/migrations/032_*.down.sql
# read both: each of the eight CREATE TABLE statements has its DROP TABLE in the .down
grep -c "pipeline_job" services/xstockstrat-analysis/migrations/032_symbol_data_stage.up.sql   # 0
grep -c "CREATE TABLE IF NOT EXISTS analysis\." services/xstockstrat-analysis/migrations/032_symbol_data_stage.up.sql   # 8
grep -ci "REFERENCES" services/xstockstrat-analysis/migrations/032_symbol_data_stage.up.sql   # 0
grep -n '("analysis", 32)' scripts/migration-rerun.py
python3 scripts/check-migration-order.py origin/main-dev
cd scripts && uv run --extra dev --frozen pytest tests/test_migration_rerun.py -q
```

---

### Step 14 — service: the system-read identity and the shared universe drains

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/identity.py` — modify
- `services/xstockstrat-analysis/app/engine/universe_reads.py` — create
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (`_drain_positions_paged` only)

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `app/identity.py:3-15`: `SYSTEM_IDENTITY`, `is_real_owner`, `owner_metadata`.
- `_SYSTEM_READ_META = (("x-user-id", SYSTEM_IDENTITY), ("x-internal-caller", "analysis-system-read"))` at `app/engine/live_loop.py:78`, used at `:188` and `:533`. No test and no other module names it (`grep -rn "_SYSTEM_READ_META" services/xstockstrat-analysis --include=*.py` → those three lines).
- `_DRAIN_PAGES = 50`, `_DRAIN_PAGE_SIZE = 1000` at `live_loop.py:68-69`, used at `:180-185`, `:549-555`, `:600-605`.
- Signals drain body: `_drain_signals_with(self, meta, scope)` at `live_loop.py:539-569`. On a stub exception it logs `live_loop: QuerySignals failed: %s`, records `telemetry.record_live_loop_drain_failure("signals")` and returns the partial set (`:560-563`). When the page loop ends with a token pending it returns silently.
- Watchlist drain body: `_drain_watchlist(self, owner)` at `:591-625`. On a stub exception it logs `live_loop: ListWatchlists(%s) failed: %s`, records `"watchlist"` and returns the partial set (`:609-612`); it skips a binding with `delisted` set (`:615-620`) and falls back to `wl.symbols` (`:622`).
- Callers that must keep working by name: `_drain_system_signals` (`:531-533`), `_drain_owner_signals` (`:535-537`), `_drain_watchlist`, used by `app/engine/entry_backfill.py:120`, `:148`, `:165` and mocked by `tests/test_entry_backfill.py:60-63`, `tests/test_live_loop_telemetry.py:138-139`, `tests/test_owner_header_guard.py:413`.
- `async def _drain_positions_paged(stub, user_id, metadata) -> list` at `app/handlers/servicer.py:7061-7090`; the stub call at `:7068-7074`; callers `servicer.py:6787` and `live_loop.py:585`.
- The servicer's own copies stay as they are (`_drain_watchlist_bindings` `servicer.py:6343`, `_drain_active_signals` `:6735`): D-21 moves the live-loop bodies and adds no third copy.
- Header propagation: the moved calls keep their per-call `metadata=` argument (`docs/patterns/header-propagation.md` § Python services (grpc.aio)); no new call site is added in this step.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `app/identity.py`: add the public `SYSTEM_READ_META` with the tuple and the one-line comment
   from `live_loop.py:77-78`. Delete `_SYSTEM_READ_META` from `live_loop.py` and import the new
   name there (D-18: moved, not copied).
2. `app/engine/universe_reads.py` (new):
   - `DRAIN_PAGES = 50` and `DRAIN_PAGE_SIZE = 1000`, moved from `live_loop.py:68-69`; `live_loop.py`
     imports them (its other user is `:180-185`);
   - `class UniverseReadError(Exception)` carrying `partial` (the set read so far) and `reason`
     (`"rpc"` or `"page_cap"`);
   - `async def drain_signals(ingest, meta, scope, *, timeout=None) -> set` with the request and
     normalisation of `live_loop.py:544-568`. A stub exception raises
     `UniverseReadError(partial, "rpc")` from it. A page loop that ends with a token still pending
     raises `UniverseReadError(partial, "page_cap")`;
   - `async def drain_watchlist(portfolio, meta, *, timeout=None) -> set` with the request, the
     `delisted` filter and the `symbols` fallback of `live_loop.py:598-625`, raising the same way;
   - `timeout` is added to the stub call only when it is not `None` (S-5).
   Neither function logs or records a metric.
3. `live_loop.py`: `_drain_signals_with` and `_drain_watchlist` become wrappers. Each keeps its
   `None`-stub early return, calls the shared function without `timeout`, and on
   `UniverseReadError`:
   - reason `rpc`: the same WARN text as today (with the original exception, `err.__cause__`), the
     same `record_live_loop_drain_failure` source, and `return err.partial`;
   - reason `page_cap`: `return err.partial`, with no log and no metric.
   Their names, signatures and return types do not change.
4. `servicer.py`: `_drain_positions_paged(stub, user_id, metadata, timeout=None)`; the
   `ListPositions` call gains `timeout=timeout` only when it is not `None`. Nothing else in the
   function changes.

**Verification**: Step 15's commands. On its own this step must leave the existing suites green:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_live_loop.py tests/test_live_loop_telemetry.py tests/test_held_position_drains.py tests/test_entry_backfill.py tests/test_owner_header_guard.py tests/test_identity.py -q
ruff check . && ruff format --check .
grep -rn "_SYSTEM_READ_META" app tests   # no output
```

---

### Step 15 — test: the shared drains and the unchanged legacy behaviour

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_universe_reads.py` — create
- `services/xstockstrat-analysis/tests/test_identity.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `class RecordingStub` at `tests/conftest.py:155-182`: records `(method, request, metadata)` and accepts extra keywords.
- Drain-failure metric assertions: `metric_sum(reader, name, **attrs)` at `tests/test_live_loop_telemetry.py:35`, the `metric_reader` fixture at `tests/test_telemetry.py:155`, used as `metric_sum(metric_reader, "analysis.live_loop.drain_failures", source=…)` (`tests/test_live_loop_telemetry.py:129`).
- Held-drain regression suite to mirror: `tests/test_held_position_drains.py:75-173` (durable `@AC-1 … @AC-10 @feature-356`).
- Live-loop construction for a drain test: `real_live_loop(…)` at `tests/conftest.py:96`.
- C-13: page payloads are scenario one-offs with one consumer; `RecordingStub`, `metric_reader` and `metric_sum` are imported, not copied.

**TDD**: `red-green required`

**Covers**: `AC-32`

**Instructions**:
1. `tests/test_universe_reads.py`:
   - `drain_watchlist` and `drain_signals`: every page read returns the normalised union; a stub
     error on page 2 raises `UniverseReadError` with reason `rpc` and `partial` equal to page 1's
     symbols (RED: the function does not exist); 51 pages raise reason `page_cap` with the symbols
     of the first 50 pages; exactly 50 pages with no pending token return normally;
   - `timeout=10` reaches every stub call as a keyword; with no `timeout` the stub call carries no
     `timeout` keyword at all (S-5);
   - a delisted binding is left out and a list with no bindings falls back to `symbols`;
   - `@AC-32`, through the live-loop wrapper: a user's watchlists span 51 pages →
     `_drain_watchlist` returns the symbols of the first 50 pages,
     `analysis.live_loop.drain_failures` does not increase and no WARNING record is written
     (`caplog`);
   - through the wrappers, an `rpc` failure returns the partial set, increases
     `analysis.live_loop.drain_failures` by 1 with source `watchlist` or `signals`, and logs the
     same WARN text as before the move;
   - `_drain_positions_paged`: the default call passes no `timeout` keyword; `timeout=10` passes
     it on every page.
2. `tests/test_identity.py`: `SYSTEM_READ_META` equals `(("x-user-id", "system"),
   ("x-internal-caller", "analysis-system-read"))`.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_universe_reads.py tests/test_identity.py tests/test_live_loop_telemetry.py tests/test_held_position_drains.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "from tests.conftest\|from tests.test_live_loop_telemetry\|metric_reader" tests/test_universe_reads.py   # C-13: doubles imported
```

---

### Step 16 — service: data-stage telemetry

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/telemetry.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Label-key constants `KEY_OUTCOME … KEY_PHASE` at `app/telemetry.py:428-435`; `KEY_KIND` and `KEY_OUTCOME` already exist.
- Instrument wrappers: `class Counter(_Bound)` at `:326`; a module-level instrument, `_PIPELINE_ATTEMPTS = Counter("analysis.pipeline.attempts", description=…)` at `:462`; its helper `def record_pipeline_attempt(outcome)` at `:566-568`.
- `tests/test_telemetry_allowlist.py:16` builds `ALLOWED_KEYS` from every `KEY_*` constant and `:17-33` lists `FORBIDDEN_KEYS` (`symbol`, `user_id`, `strategy_id`, …). None of the new keys is forbidden.
- `tests/test_pipeline_telemetry.py:257-261` compares only instruments named in `_PIPELINE_INSTRUMENTS`, so new `analysis.data_stage.*` names do not turn it red.
- The instrument table is design.md § 15. No symbol, user or run label (R-4; durable `@AC-41 @feature-294`).
- No outbound call is added, so header propagation does not apply.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add four label keys after `:435`: `KEY_VERDICT = "verdict"`, `KEY_STATE = "state"`,
   `KEY_REASON = "reason"`, `KEY_RESULT = "result"`.
2. Add eight module-level `Counter`s and one helper each, in the shape of `:462` and `:566-568`,
   each helper's docstring listing its closed label values:

   | Instrument | Helper | Labels |
   |---|---|---|
   | `analysis.data_stage.symbols` | `record_data_stage_symbol(verdict)` | `verdict` covered \| no_vendor_data \| fetch_failed |
   | `analysis.data_stage.fundamentals` | `record_data_stage_fundamentals(state)` | `state` fresh \| stale \| unavailable |
   | `analysis.data_stage.backfills` | `record_data_stage_backfill(kind, outcome)` | `kind` history \| final; `outcome` written \| empty \| skipped \| failed |
   | `analysis.data_stage.filings` | `record_data_stage_filings(outcome)` | `outcome` written \| empty \| skipped \| failed \| disabled \| error |
   | `analysis.data_stage.snapshot_users` | `record_data_stage_snapshot_user(outcome)` | `outcome` ok \| failed |
   | `analysis.data_stage.holes_confirmed` | `record_data_stage_hole(kind)` | `kind` short \| long |
   | `analysis.data_stage.fetch_deferred` | `record_data_stage_fetch_deferred(reason)` | `reason` rpc \| symbol \| budget |
   | `analysis.data_stage.finality` | `record_data_stage_finality(result)` | `result` match \| drift \| adjusted \| unavailable |

3. No `passes` counter (D-53), no gauge, no new `Loop` member.

**Verification**: Step 17's commands. On its own:
```bash
cd services/xstockstrat-analysis && uv run --extra dev pytest tests/test_telemetry_allowlist.py tests/test_pipeline_telemetry.py tests/test_telemetry_instruments.py -q && ruff check . && ruff format --check .
```

---

### Step 17 — test: data-stage telemetry

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_data_stage_telemetry.py` — create
- `services/xstockstrat-analysis/tests/test_telemetry_allowlist.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `MIN_INSTRUMENTS` at `tests/test_telemetry_allowlist.py:34-45`; `_drive()` at `:49-63`; `_keys_by_instrument(reader)` at `:66-75`; `test_ac41_every_label_key_is_a_module_constant` at `:78-84`.
- The `host.provider` check for a named instrument set: `test_ac3_feature_337_new_instruments_carry_host_provider` at `tests/test_pipeline_telemetry.py:229-261`, with `_PIPELINE_INSTRUMENTS` at `:32`.
- Fixtures: `metric_reader` (`tests/test_telemetry.py:155`), `otel_reset` (`tests/conftest.py:878-879`).
- C-13: the label values are the closed sets under test and have one consumer.

**TDD**: `red-green required`

**Covers**: — (no scenario of its own: the per-scenario counts are asserted in Steps 23 and 25; this step extends the durable label-allowlist rule of feature 294 and the `host.provider` rule of feature 337)

**Instructions**:
1. `tests/test_data_stage_telemetry.py`:
   - each of the eight helpers adds 1 to its instrument with exactly the label keys of Step 16's
     table (RED: the helper does not exist), for every value of its closed set;
   - no data point carries a key in `FORBIDDEN_KEYS`, and none carries `symbol`, `user_id` or
     `run_id`;
   - every `analysis.data_stage.*` instrument carries `host.provider`, mirroring
     `tests/test_pipeline_telemetry.py:229-261`.
2. `tests/test_telemetry_allowlist.py`: add the eight names to `MIN_INSTRUMENTS` and one call of
   each helper to `_drive()`.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_data_stage_telemetry.py tests/test_telemetry_allowlist.py tests/test_pipeline_telemetry.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "metric_reader\|otel_reset\|from tests" tests/test_data_stage_telemetry.py   # C-13: fixtures imported
```

---

### Step 18 — service: the universe job and the shard job

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/jobs/data_stage.py` — create

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `app/jobs/data_stage.py`: **Not found** — created by this step.
- Handler factory pattern: `def make_handler(settings, *, monotonic=time.monotonic)` returning `async def handler(job)` (`app/jobs/retention_prune.py:17-34`), with a self-stop loop of `job.db(30)` blocks (`:22-31`).
- Handler-facing job: `ClaimedJob` fields `job_id, kind, subject, epoch, run_id, lane, attempts, wait_round, lease_token` (`app/engine/job_graph.py:290-301`); `job.db(budget)` at `:303-365`, budget at most `HANDLER_BLOCK_CAP_S = 30.0` (`:43`).
- `attempts` is 1 on the first attempt: the claim sets `attempts = j.attempts + 1` (`app/repositories/pipeline_jobs.py:35`); a park refunds the attempt (`:127`).
- Outcomes and children: `Child(kind, subject, epoch, lane=None)` (`job_graph.py:74-78`), `Succeeded`, `WaitOn(children)` (`:81-88`), `PermanentJobError` (`:96`). A `WaitOn` with no child is a permanent error (`:172-173`); at most 10,000 children per park (`:23`, `:174-175`). A child with lane `None` inherits the parent's (`pipeline_jobs.py:101-108`).
- `Lane.WATCHLIST = 10`, `Lane.HELD = 20` (`job_graph.py:56-58`).
- Owner list source: the live loop reads `analysis.strategies` and takes each row's `user_id` (`app/engine/live_loop.py:374-402`); `is_real_owner` at `app/identity.py:6-8`.
- Reads: `drain_watchlist`, `drain_signals`, `UniverseReadError` (Step 14); `_drain_positions_paged(stub, user_id, metadata, timeout=None)` and `_normalize_symbol` (`app/handlers/servicer.py:7061`, `:6965`), imported from the servicer as `live_loop.py:41-45` does; `_PositionsPageError` (`servicer.py:408`).
- Scopes: `ingest_pb2.SIGNAL_SCOPE_SYSTEM`, `ingest_pb2.SIGNAL_SCOPE_OWN` (`live_loop.py:533`, `:537`).
- Header propagation (C-03): Python per-call `metadata=` (`docs/patterns/header-propagation.md` § Python services (grpc.aio)). A background call with no end user carries the owner or the system identity and a fresh trace id, with no access scope: `_saga_sweep_meta` at `app/handlers/servicer.py:3842-3848`; `owner_metadata(user_id) + [("x-trace-id", pass_trace_id)]` at `app/engine/entry_backfill.py:78`.
- Contract (`tests/test_job_handler_contract.py`): no `db_pool` name, no `asyncio.timeout` around a `.db(` block, awaits inside a `.db(` block only on `conn` (S-10).
- `settings.data_stage_enabled()`, `settings.max_attempts()`, `settings.retention_days()` (Step 11; `job_graph.py:223-229`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Module constants and key helpers (S-1), with a one-line module docstring:
   - kinds `UNIVERSE_KIND = "data_stage.universe"`, `SHARD_KIND = "data_stage.shard"`,
     `SYMBOL_KIND = "data_stage.symbol"`, `FINALITY_KIND = "data_stage.finality"`;
     `GLOBAL_SUBJECT = "global"`;
   - fixed invariants as named constants under one comment line citing design.md § 12 (not config
     keys, F-07): `PASSES = 4`, `SHARD_SIZE = 500`, `SNAPSHOT_BLOCK_ROWS = 5000`,
     `READ_BUDGET_S = 300`, `READ_PAGE_TIMEOUT_S = 10`, `RETENTION_BATCH = 5000`,
     `RETENTION_SELF_STOP_S = 120`, `SESSION_KEEP_MIN_DAYS = 30`, `HOLE_KEEP_DAYS = 730`,
     `FILINGS_KEEP_DAYS = 365`;
   - `stage_epoch(session: date, p: int) -> str` (`f"{session.isoformat()}#{p}"`),
     `parse_stage_epoch(epoch) -> tuple[date, int]` (raises `PermanentJobError` unless the epoch
     is `YYYY-MM-DD#p` with p in 1..4), `stage_run_id(session, p)` (`data_stage:S#p`) and
     `finality_run_id(session)` (`data_stage_finality:S`).
2. `make_universe_handler(settings, *, portfolio, ingest, monotonic=time.monotonic)`, as
   design.md § 4. The handler, in order:
   1. `job.wait_round > 0` → `Succeeded()` (S-4).
   2. Parse the epoch into S and p.
   3. Kill switch: `settings.data_stage_enabled()` false → INFO `data stage disabled; session S
      pass p skipped` and `Succeeded()`, with nothing deleted or written (D-17).
   4. Retention, pass 1 only (D-20, D-35): batches of `RETENTION_BATCH` rows, one `job.db(30)`
      each, stopping after the first batch that ends `RETENTION_SELF_STOP_S` after the handler
      began. Session-keyed tables (`symbol_coverage`, `symbol_bar`, `data_stage_finality`,
      `data_stage_universe`, `data_stage_users`, `data_stage_runs`) below `S − max(30,
      settings.retention_days())` days; `symbol_bar_hole` where `last_session < S − 730`;
      `symbol_filings_check` where `next_check_on < S − 365`.
   5. Marker check, one `job.db(5)`: a `data_stage_users` row for S exists → go to item 8.
   6. Reads. Owners: `SELECT DISTINCT user_id FROM analysis.strategies` in `job.db(5)`, filtered
      by `is_real_owner`, sorted. One trace id per attempt (`uuid4().hex`). Under one
      `asyncio.timeout(READ_BUDGET_S)` that contains no `.db(` block: the system-scope signals
      (`drain_signals(ingest, [*SYSTEM_READ_META, trace], SIGNAL_SCOPE_SYSTEM,
      timeout=READ_PAGE_TIMEOUT_S)`), then per owner with `[*owner_metadata(u), trace]`: held
      (`_drain_positions_paged(…, timeout=READ_PAGE_TIMEOUT_S)`, normalised), the watchlist drain
      and the own-signals drain (`SIGNAL_SCOPE_OWN`).
      - `job.attempts < settings.max_attempts()`: the first failed read, or the budget expiring,
        re-raises before any write (a transient error; D-19, D-49).
      - Last attempt: a user with any failed source contributes no rows and is recorded
        `snapshotted=false` with `failed_source` set to the first failure (`held`, `watchlist`,
        `signals`); a user not fully read when the budget expired gets `budget`; a failed
        system-scope read gives the `system` user row `snapshotted=false` with `system_signals`
        and does not mark owners.
   7. Write (D-33), `SNAPSHOT_BLOCK_ROWS` rows per `job.db(30)` block, each insert one `execute`
      over `unnest` arrays: block 1 first runs `DELETE FROM analysis.data_stage_universe WHERE
      session_date = S`; the last block writes every `data_stage_users` row, always including one
      for `SYSTEM_IDENTITY`. That block is the marker. A user's rows are `(S, user, symbol,
      held)` for the union of held, watchlist and own-signal symbols; the system-scope symbols are
      stored once under `SYSTEM_IDENTITY` with `held=false`. After the marker block commits,
      record `record_data_stage_snapshot_user("ok" | "failed")` once per user row.
   8. Park: `N = count(DISTINCT symbol)` of the snapshot for S, one `job.db(5)`. `N == 0` →
      `Succeeded()`. Otherwise `WaitOn` on `Child(SHARD_KIND, str(k), job.epoch)` for k in
      `0..ceil(N / SHARD_SIZE) − 1`.
3. `make_shard_handler()`, as design.md § 5:
   - `job.wait_round > 0` → `Succeeded()`; parse the epoch; `k = int(job.subject)` (a
     non-integer subject → `PermanentJobError`);
   - one `job.db(5)`: slice k of the snapshot (`GROUP BY symbol`, `bool_or(held)`, `ORDER BY
     symbol OFFSET k·500 LIMIT 500`), then drop the symbols that already have a `symbol_coverage`
     row for S;
   - an empty filtered slice → `Succeeded()`; a WARN only when the unfiltered slice is empty;
   - otherwise `WaitOn` on `Child(SYMBOL_KIND, symbol, job.epoch, Lane.HELD if held else
     Lane.WATCHLIST)`.
4. Neither handler returns a `Verdict` (R-5). Neither reads a config key other than through
   `settings`.

**Verification**: Step 19's commands. On its own:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_job_handler_contract.py tests/test_pipeline_boot.py -q   # the new module honours the contract
ruff check . && ruff format --check .
grep -n "metadata=\|owner_metadata\|SYSTEM_READ_META\|x-trace-id" app/jobs/data_stage.py   # every read carries an identity and a trace id
```

---

### Step 19 — test: universe and shard jobs

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/conftest.py` — modify
- `services/xstockstrat-analysis/tests/test_data_stage_universe.py` — create

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `local_pg` at `tests/conftest.py:439-440`; `pipeline_pool(dsn, size=4)` at `:510-512`; `pipeline_pg` at `:515-537` (runs the owning migration file alone); `_MIGRATIONS_DIR` at `:506`; `insert_pipeline_job` at `:539`.
- The `real_pg` marker: `pyproject.toml:34`; used as `pytestmark = pytest.mark.real_pg` (`tests/test_pipeline_jobs_real_pg.py:26`).
- Running a handler through the real worker on PostgreSQL: `_worker(pool, settings, …)`, `_drain(*workers)` and `_run_prune` at `tests/test_retention_prune_job.py:38-59`.
- `bounded_txn(pool, budget_s, …)` at `app/repositories/read_budget.py:212-258`: what `job.db()` wraps.
- `RecordingStub` (`tests/conftest.py:155`), `aio_rpc_error(code, details)` (`:146`), `snapshot_watcher` (`:63`).
- C-13: `data_stage_pg` and `StageJob` have consumers in Steps 19, 23, 25, 27 and 29, so they go to `tests/conftest.py` now (S-7). Portfolio and ingest page payloads are scenario one-offs.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-3, AC-4, AC-5, AC-29, AC-30, AC-31` (the job half), `AC-34, AC-36, AC-40, AC-41, AC-44, AC-62`

**Instructions**:
1. `tests/conftest.py`:
   - `data_stage_pg`: a fixture built on `pipeline_pg` that also drops and re-creates the eight
     stage tables by running `*_symbol_data_stage.up.sql` alone, plus a minimal
     `analysis.strategies (user_id text)` table when absent, and yields the pool;
   - `StageJob`: a small class with the handler-facing fields of `ClaimedJob` (`job_id`, `kind`,
     `subject`, `epoch`, `run_id`, `lane`, `attempts`, `wait_round`) and an async context manager
     `db(budget)` that opens `bounded_txn(pool, budget)`.
2. `tests/test_data_stage_universe.py` (`real_pg`), calling the handlers directly with `StageJob`
   and `RecordingStub` portfolio and ingest doubles unless a case says "through the worker":
   - `@AC-1`: `u1` owns a strategy, holds `AAPL`, has an active signal on `NVDA` and a watchlist
     with `MSFT` and `AAPL` → the snapshot lists exactly `AAPL`, `MSFT`, `NVDA` for `u1`, and
     `AAPL` is held (RED);
   - `@AC-29`: `u3` holds `AAPL` and owns no strategy → no universe row and no user row for `u3`;
   - `@AC-30`: a system-scope signal on `NVDA` → `NVDA` is stored under `system`, not held, and is
     in the universe of `u1` and of `u2` (own rows union the `system` rows); the park names a
     shard;
   - `@AC-31`: no strategy owner → the job returns `Succeeded`, no shard child, and the marker row
     for `system` exists;
   - `@AC-44`: the watchlist read fails for `u1` with `attempts=1` → the handler raises, and no
     universe row and no user row exist for S;
   - `@AC-3`: with `attempts` equal to `max_attempts` (5), `u1`'s watchlist read fails and `u2`'s
     succeeds → `u2`'s symbols are stored, `u1` has no universe row and a user row
     `snapshotted=false`, `failed_source='watchlist'`;
   - `@AC-62`: on the last attempt `u1`'s position pages stall until the 300 s budget expires (a
     patched `READ_BUDGET_S` of 0.2 s) → `u1` is recorded `failed_source='budget'` and every user
     fully read before it is snapshotted;
   - a failed system-scope read on the last attempt marks only the `system` row, with
     `system_signals`;
   - `@AC-40`: `pipeline.data_stage_enabled` false at the start of the job → `Succeeded`, no
     snapshot row, no shard child, and no stub call;
   - `@AC-41`: with the marker present, a pass-2 universe job issues no portfolio or ingest call
     and leaves the universe rows unchanged (compare row sets);
   - a crashed attempt's partial rows are cleared: rows for S without a marker are replaced by the
     next attempt;
   - `@AC-36`: `pipeline.retention_days` 7; coverage, bar, universe, user, run and finality rows
     for 2026-10-20 and for 2026-10-29 → after the pass-1 universe job for 2026-11-27 no
     2026-10-20 row remains and every 2026-10-29 row remains; a pass-2 job prunes nothing; a hole
     with `last_session` older than S − 730 and a filings row with `next_check_on` older than
     S − 365 are deleted;
   - retention self-stop: with a patched `RETENTION_SELF_STOP_S` of 0 the job still snapshots and
     parks after one batch;
   - a malformed epoch raises `PermanentJobError`;
   - the snapshot write at scale: 100,000 universe rows across users are stored and the marker is
     the last write (design § 22);
   - `@AC-34`, through the worker with a registry of the universe and shard handlers and a
     recording symbol handler: a snapshot of 1,200 distinct symbols → exactly 3 shard jobs, each
     with at most 500 children, and exactly 1,200 `data_stage.symbol` jobs;
   - `@AC-4`: `u1` and `u2` both watch `MSFT` → exactly 1 `data_stage.symbol` job for `MSFT` with
     epoch `2026-11-27#1`, and a second run of the same shard creates no second one;
   - `@AC-5`: `AAPL` held by `u1` and watched by `u2`, `MSFT` only watched → the `AAPL` job has
     lane 20 and the `MSFT` job lane 10;
   - a shard skips a symbol that already has a coverage row for S, and a filtered-empty shard
     returns `Succeeded`;
   - a woken universe job and a woken shard job (`wait_round=1`) return `Succeeded` without a
     read.
   Also assert `analysis.data_stage.snapshot_users` counts `ok` and `failed` once per user row.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_data_stage_universe.py tests/test_job_handler_contract.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "def data_stage_pg\|class StageJob" tests/conftest.py   # C-13: one home
grep -n "from tests.conftest" tests/test_data_stage_universe.py
```

---

### Step 20 — service: the data job's rules (pure functions)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/jobs/data_stage.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Coverage response: `GetDataCoverageResponse` with `bars_total = 3`, `earliest = 4`, `latest = 5`, `gaps = 7` (`packages/proto/marketdata/v1/marketdata.proto:186-196`).
- Gap bounds: `Gap{Start: DayStart(first), End: DayStart(prev).Add(12 * time.Hour)}` — New York midnight of the first missing session and New York noon of the last (`services/xstockstrat-marketdata/internal/timeframe/timeframe.go:102-103`, `:122`). Both fall on the session's own UTC date, so "a gap bound's date is its UTC date" (design § 6).
- Per-symbol outcomes: `BackfillSymbolOutcome` `EMPTY = 1`, `SKIPPED = 2`, `FAILED = 3` (`packages/proto/common/v1/common.proto:156-162`); `BackfillSymbolResult` lists non-written symbols only (`:164-170`), so a symbol with no entry was written.
- `HistoricalFundamentalsPeriod.period_end = 4` (`marketdata.proto:279`).
- The rules are design.md § 6 (steps 4, 6, 7), § 7 (fetch failure) and § 8 (state and schedule); the invariants are § 12 (D-32, D-44, D-66).
- `crc32`: `zlib.crc32` in the standard library; no dependency change, so `uv.lock` is untouched.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Add to `app/jobs/data_stage.py`, as functions with no I/O. Names are this spec's choice.
1. Constants: `WINDOW_DAYS = 730`, `LONG_HOLE_DAYS = 30`, `FETCH_ATTEMPTS_PER_PASS = 2`,
   `STALE_AFTER_DAYS = 190`, `FILING_DUE_DAYS = 105`, `FILING_RECHECK_DAYS = 7`,
   `NO_FILINGS_RECHECK_DAYS = 28`.
2. `coverage_window(session) -> (cov_start, cov_end)`: `cov_end` is S at 16:00Z, `cov_start` is
   `cov_end − 730 d` (D-8, D-32).
3. `gap_dates(gap) -> (first, last)`: the UTC dates of a gap's start and end.
4. `unconfirmed_gaps(gaps, session, stored_runs)`: the pre-S gaps, each clipped to end at or
   before S − 1 day, that no stored run `(first_session, last_session)` contains (§ 6 step 4,
   D-26). A gap that covers only S is not returned.
5. `holes_to_store(gaps, history_start, session)`: each gap of the post-fetch coverage clipped to
   `[history_start, S − 1 day]`; empty clips dropped (§ 6 step 6, D-37). `is_long_hole(first,
   last)`: more than 30 days.
6. `symbol_outcome(response, symbol) -> str`: `written` when the symbol has no result entry, else
   `empty`, `skipped` or `failed`.
7. `bar_verdict(final_outcome, latest_date, session, pre_session_gaps, contained_by)`: the table
   of § 6 step 7. `covered` needs `final_outcome == "written"`, `latest_date == session` and every
   pre-S gap contained by a stored or newly confirmed run; every other reachable row is
   `no_vendor_data`. It never returns `fetch_failed`.
8. `captured_bar(bars, day_start, day_end)`: the single returned bar with `time` in `[day_start,
   day_end]`, or `None` when there is not exactly one (§ 6 step 2).
9. Fundamentals (§ 8):
   - `filings_weekday(symbol)`: `zlib.crc32(symbol.encode()) % 5`, 0 = Monday … 4 = Friday;
   - `shift(d, w)`: `d + ((w − d.weekday()) mod 7)` days;
   - `fundamentals_state(newest_period_end, session, read_failed)`: `unavailable` on a read error
     or with nothing stored; `fresh` when `newest_period_end >= S − 190 d`; else `stale`;
   - `first_check_on(newest_period_end, session, w)`: `shift(P + 105)`, or `shift(S)` when
     `P + 105 <= S` or nothing is stored;
   - `next_check_after_call(newest_period_end, session, w, outcome)`: nothing stored →
     `shift(S + 28)`; `fresh` and `P + 105 > S` → `shift(P + 105)`; otherwise (overdue, stale,
     `error`, `disabled`) → `shift(S + 7)`;
   - `filings_outcome_of(response, symbol)`: `written` for a missing result entry, else `empty`,
     `skipped` or `failed`.
10. Change no handler in this step.

**Verification**: Step 21's commands. On its own:
```bash
cd services/xstockstrat-analysis && uv run --extra dev pytest tests/test_job_handler_contract.py tests/test_data_stage_universe.py -q && ruff check . && ruff format --check .
```

---

### Step 21 — test: the data job's rules

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_data_stage_rules.py` — create

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Generated messages for building inputs: `marketdata_pb2.GetDataCoverageResponse`, `common_pb2.TimeRange`, `common_pb2.BackfillSymbolResult`, `marketdata_pb2.Bar` (imported as in `tests/test_job_graph_settings.py:8`, `from gen.… import …`).
- Dates used by the scenarios: session 2026-11-27; `S − 190 d` = 2026-05-21; 2026-10-28 + 105 d = 2027-02-10; `S + 7` = 2026-12-04; `S + 28` = 2026-12-25.
- No database: this file carries no `real_pg` marker (S-8).
- C-13: every value is a scenario one-off with one consumer.

**TDD**: `red-green required`

**Covers**: `AC-8` (the gap rule), `AC-9` (session S is never a hole), `AC-11, AC-12, AC-22, AC-24, AC-27, AC-28` (the schedule and state values)

**Instructions**:
Table tests, one function per rule. Each bullet names the scenario value it pins.
1. `coverage_window(2026-11-27)` → `cov_end` `2026-11-27T16:00:00Z`, `cov_start` 730 days earlier.
2. `unconfirmed_gaps` and `holes_to_store`:
   - `@AC-8`: one gap on 2026-11-23, no stored run → unconfirmed, and the history range starts
     2026-11-23 (RED);
   - `@AC-24`: a gap 2026-11-12 to 2026-11-12 with a stored run `(2026-11-12, 2026-11-12)` → not
     unconfirmed; a stored run that only overlaps it → still unconfirmed;
   - `@AC-9`: a gap whose only missing session is S yields no unconfirmed gap and no hole; a gap
     running through S is clipped to end at S − 1 day;
   - a head gap of 62 days is one run and `is_long_hole` is true; a 30-day run is not long;
   - holes are clipped to `[history_start, S − 1 day]` and an empty clip is dropped.
3. `symbol_outcome`: no entry → `written`; each of `EMPTY`, `SKIPPED`, `FAILED` maps to its name.
4. `bar_verdict`: every row of design § 6 step 7 — written, latest = S, no open gap → `covered`;
   written, latest = S, an open gap → `no_vendor_data`; written, latest ≠ S → `no_vendor_data`;
   `empty` and `skipped` → `no_vendor_data` whatever the coverage says.
5. `captured_bar`: exactly one bar inside the day bounds → that bar; zero or two → `None`; a bar
   outside the bounds is ignored.
6. `filings_weekday` and `shift`: the weekday is in 0..4 and stable for a symbol; `shift(d, w)`
   lands on weekday w, 0 to 6 days after d, for every d of one week and every w (Monday = 0).
7. `fundamentals_state`: `@AC-12` P = 2026-08-10 → `fresh`; `@AC-22` P = 2026-05-11 → `stale`;
   P = 2026-05-21 → `fresh` (the boundary); nothing stored → `unavailable` (`@AC-28`); a read
   error → `unavailable`.
8. Schedule:
   - `@AC-11`: `first_check_on(2026-10-28, S, w)` is on or after 2027-02-10 and within 6 days of
     it, for every w;
   - `first_check_on` with `P + 105 <= S`, and with nothing stored, is `shift(S)`;
   - `@AC-12` and `@AC-22`: `next_check_after_call(…, "error")` and `(…, "disabled")` lie between
     2026-12-04 and 2026-12-10;
   - `@AC-27`: after a call on S that found no new filing (P overdue), the next check is on or
     after 2026-12-04, so the sessions 2026-11-30 to 2026-12-03 are not due;
   - `@AC-28`: with nothing stored the next check is on or after 2026-12-25, so no session until
     2026-12-24 is due;
   - `fresh` and not overdue after a call → `shift(P + 105)`.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_data_stage_rules.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "conftest\|def .*fixture" tests/test_data_stage_rules.py   # C-13: no fixture needed; single-consumer inline values
```

---

### Step 22 — service: the data job

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/jobs/data_stage.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Marketdata request shapes already used by analysis: `GetDataCoverage(marketdata_pb2.GetDataCoverageRequest(symbol=…, timeframe=common_pb2.Timeframe.TIMEFRAME_1DAY, range=…), metadata=…)` at `app/handlers/servicer.py:4231-4238`; a per-call `timeout=` keyword on a stub call at `:7038-7045` (`GetHistoricalFundamentals`, which reads `resp.periods` and `resp.pagination.next_page_token`).
- `BackfillBarsRequest` fields `symbols`, `range`, `timeframe_enum`, `return_bars` (Step 1; `packages/proto/marketdata/v1/marketdata.proto:157-164`); `BackfillBarsResponse.symbol_results`, `.bars`.
- `GetHistoricalFundamentalsRequest` fields `symbol = 1`, `range_start = 3`, `page = 6` (`marketdata.proto:300-308`); `BackfillFundamentalsRequest.symbols = 1` (`:315-320`).
- `BackfillFundamentals` answers `FailedPrecondition` when history is disabled (`services/xstockstrat-marketdata/internal/service/marketdata_service.go:2364-2369`), and its handler returns typed errors unwrapped (`internal/handler/marketdata_handler.go:142-148`).
- `BackfillBars` never marks a symbol warm; every bars or quotes read RPC does (design § 9.2), so the job may call only `BackfillBars`, `GetDataCoverage`, `GetHistoricalFundamentals` and `BackfillFundamentals` (D-23).
- Quiet-ledger header (Step 5): `x-internal-caller: analysis-data-stage` with the analysis SAN. Appending a grant to existing metadata: `meta = list(metadata) + [("x-internal-caller", _FUNDSIGNAL_CALLER)]` (`app/engine/fundsignal_loop.py:406`).
- Header propagation (C-03): per-call `metadata=`; `SYSTEM_READ_META` (Step 14) plus a fresh `x-trace-id` per attempt (D-18).
- gRPC error code access: `_rpc_code(e)` at `app/handlers/servicer.py:7097-7098` (`e.code() if isinstance(e, grpc.RpcError) and hasattr(e, "code") else None`).
- Worst-case attempt 500 s against `ATTEMPT_DEADLINE_S = 900.0` (`app/engine/job_graph.py:32`; design § 6).
- Rules (Step 20), telemetry helpers (Step 16), tables (Step 13).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
`make_symbol_handler(*, marketdata)` in `app/jobs/data_stage.py`, as design.md § 6, § 7 and § 8.
The handler reads no config key and returns only `Succeeded` or raises.
1. Constants under the same design § 12 comment: call timeouts `BACKFILL_TIMEOUT_S = 120`,
   `COVERAGE_TIMEOUT_S = 30`, `FUNDAMENTALS_READ_TIMEOUT_S = 10`,
   `FUNDAMENTALS_BACKFILL_TIMEOUT_S = 120`, `FUNDAMENTALS_STEP_BUDGET_S = 160`,
   `FUNDAMENTALS_PAGE = 50`, `PASS_BUDGET = "30 minutes"`, and
   `DATA_STAGE_CALLER = "analysis-data-stage"`.
2. Step 0: parse the epoch; `last = (p == PASSES)`. One `trace = uuid4().hex` per attempt;
   `meta = [*SYSTEM_READ_META, ("x-trace-id", trace)]`; the `BackfillBars` metadata is `meta`
   plus `("x-internal-caller", DATA_STAGE_CALLER)`, and no other call carries that value.
3. Step 1, one `job.db(10)`, in this order:
   - a `symbol_coverage` row for `(symbol, S)` exists → `Succeeded()` (D-34);
   - read `pass, done_at, day_start, day_end, (now() − pass_created_at) > interval '30 minutes'
     AS over_budget` from `data_stage_runs`; no row → `PermanentJobError`;
   - `pass ≠ p` or `done_at` set → INFO `data stage job superseded`, `Succeeded()`, no call and
     no write;
   - `over_budget` → a fetch failure with reason `budget`; no call of any kind is made (D-61);
   - read the stored hole runs and the filings-check row of the symbol.
4. Step 2: `BackfillBars([symbol], TIMEFRAME_1DAY, [day_start, day_end], return_bars=True)`,
   timeout 120 s → `final_outcome`; capture the bar with `captured_bar`.
5. Step 3: `GetDataCoverage(symbol, TIMEFRAME_1DAY, coverage_window(S))`, timeout 30 s.
6. Steps 4-5: `U = unconfirmed_gaps(…)`. Only when U is not empty: `BackfillBars([symbol],
   TIMEFRAME_1DAY, [start of the earliest gap in U, day_start − 1 s])`, timeout 120 s, **without**
   `return_bars` → `history_outcome`; then a second `GetDataCoverage` with the same range. With U
   empty the first coverage stands and `history_outcome` is `None`.
7. Step 6: holes are computed only when `history_outcome` is `written` or `empty`.
8. Step 7: `bar_verdict(…)`. WARN `data stage: final bar written but not stored` when the final
   call returned written and the coverage's latest bar is not S.
9. Fetch failure (design § 6 "Fetch failure", § 7): reason `rpc` for a gRPC error from
   `BackfillBars` or `GetDataCoverage` with any code except `INVALID_ARGUMENT` (including this
   call's own deadline); reason `symbol` for a per-symbol `failed` outcome; reason `budget` from
   item 3. `INVALID_ARGUMENT` raises `PermanentJobError`. Any exception that is not a gRPC error
   propagates unchanged (transient through the job graph, `dead` after `max_attempts`). An attempt
   stops at its first fetch failure:
   - `rpc` or `symbol` with `job.attempts < FETCH_ATTEMPTS_PER_PASS`: raise a transient error
     (the gRPC error itself, or a `RuntimeError` naming the per-symbol failure);
   - otherwise, and `budget` on any attempt: on passes 1 to 3, `record_data_stage_fetch_deferred
     (reason)` and `Succeeded()` with nothing written; on pass 4, write `bar_verdict =
     'fetch_failed'` with `fail_reason`, through items 11.1 and 11.2 only, storing the outcomes
     observed so far and NULL where no call was made. For `rpc` and `symbol` the fundamentals
     state is read (item 10, read only); for `budget` it is `unavailable` and no call is made.
10. Fundamentals step (§ 8), only on a `covered` or `no_vendor_data` verdict, wrapped in
    `except Exception` and bounded at 160 s with no `.db(` block inside the timeout:
    - read `GetHistoricalFundamentals(symbol, range_start = S − 190 d, page_size 50)`, timeout
      10 s, no `as_of_date`; on an empty page read once more unranged with `page_size` 1; P is the
      newest `period_end`; the state comes from `fundamentals_state`;
    - a check is due when the stored `next_check_on <= S`, or there is no row and
      `first_check_on(…) <= S`;
    - when due, `BackfillFundamentals([symbol])` with defaults, timeout 120 s: outcome from
      `filings_outcome_of`; `FAILED_PRECONDITION` → `disabled`; any other error → `error`;
    - a failure here never fails the job and never changes the bar verdict (D-25). The state
      describes stored filings as read before the call (D-31).
11. Write, one `job.db(10)`, in this order (D-52, D-62):
    1. `SELECT pass, done_at FROM analysis.data_stage_runs WHERE session_date = $1 FOR SHARE`;
       `pass ≠ p` or `done_at` set → INFO `data stage job superseded`, leave the block with
       nothing written, `Succeeded()`;
    2. `INSERT INTO analysis.symbol_coverage … ON CONFLICT DO NOTHING RETURNING 1`; no row back →
       leave the block and `Succeeded()`. Columns: `run_id = stage_run_id(S, p)`, `pass = p`,
       `earliest_bar`, `latest_bar` and `bars_in_window` from the final coverage, `confirmed_gaps`
       (the stored and newly confirmed runs inside the window), both outcomes, the state;
    3. holes: `DELETE` the stored runs inside the history range (D-37), then upsert each new run
       on `(symbol, first_session)` keeping `GREATEST(last_session)` and the greater
       `confirmed_on` (S);
    4. the filings upsert, whenever no row exists or a call was made: `next_check_on`, and
       `last_checked_on = S` and `last_outcome` when a call was made;
    5. when `covered`: `INSERT INTO analysis.symbol_bar … ON CONFLICT DO NOTHING` with the
       captured values, or five NULLs when nothing was captured.
12. After the commit, and only when item 11.2 inserted the row: `record_data_stage_symbol`,
    `record_data_stage_fundamentals`, `record_data_stage_backfill("final", …)` and
    `("history", …)` when made, `record_data_stage_filings` when a call was committed,
    `record_data_stage_hole("short" | "long")` per run written, and WARN `data stage: long hole
    confirmed` per long run.

**Verification**: Step 23's commands. On its own:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_job_handler_contract.py tests/test_data_stage_rules.py -q
ruff check . && ruff format --check .
grep -n "metadata=" app/jobs/data_stage.py   # every stub call passes metadata
grep -n "GetBars\|BatchGetBars\|GetLatestQuote\|GetLatestPrice\|GetFundamentals(\|GetFundamentalsMulti" app/jobs/data_stage.py   # no output
```

---

### Step 23 — test: the data job

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_data_stage_symbol.py` — create

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `data_stage_pg`, `StageJob` (Step 19, `tests/conftest.py`); `RecordingStub` with a per-method response function and `.of(method)` (`tests/conftest.py:155-182`); `aio_rpc_error(code, details)` (`:146`).
- `metric_reader` (`tests/test_telemetry.py:155`) and `metric_sum` (`tests/test_live_loop_telemetry.py:35`).
- A second pool on the same database for a concurrent writer: `pipeline_pool(local_pg)` (`tests/test_pipeline_jobs_real_pg.py:113-114`).
- Shifting a timestamp column in a test: `shift_pipeline_job(pool, job_id, **columns_to_seconds)` (`tests/conftest.py:571`); the run row is shifted the same way with a direct `UPDATE … SET pass_created_at = now() − interval '31 minutes'`.
- C-13: marketdata responses are scenario one-offs built from the generated messages; the doubles are imported from `tests/conftest.py`.

**TDD**: `red-green required`

**Covers**: `AC-6, AC-7, AC-8, AC-9, AC-10` (the pass-4 record), `AC-11, AC-12, AC-15, AC-17, AC-20, AC-22, AC-23, AC-24, AC-25, AC-27, AC-28, AC-33, AC-38` (the job half), `AC-39` (the history half), `AC-42, AC-46` (the attempt half), `AC-56` (the data job), `AC-59, AC-60, AC-63, AC-66`

**Instructions**:
`tests/test_data_stage_symbol.py` (`real_pg`). A local helper seeds the run row for 2026-11-27
(pass, `pass_created_at`, the day bounds of `@AC-37`) and builds a `RecordingStub` whose
`BackfillBars`, `GetDataCoverage`, `GetHistoricalFundamentals` and `BackfillFundamentals` answer
from per-test tables. Each case calls the handler with a `StageJob` for `data_stage.symbol`.
1. Bars path:
   - `@AC-6`: complete history and a vendor bar with close 190.00 → the final fetch returned
     written, no history call, exactly 1 `GetDataCoverage` call, the coverage row is `covered`,
     and exactly 1 bar row has captured close 190.00 (RED);
   - `@AC-7`: latest bar 2026-11-24 → a history call whose range covers 2026-11-25 and ends one
     second before `day_start`, without `return_bars`; `covered`; 1 bar row;
   - `@AC-8`: an interior hole on 2026-11-23 → a history call covering 2026-11-23; `covered`;
   - `@AC-9`: no bars, final and history both `EMPTY` → `no_vendor_data`, no bar row, and no hole
     row whose range contains 2026-11-27;
   - `@AC-23`: the final fetch `SKIPPED` → `no_vendor_data`, no bar row;
   - `@AC-24`: a stored hole 2026-11-12 → no history call; `covered`;
   - `@AC-25`: a stored same-day bar but the final fetch `EMPTY` → `no_vendor_data`, no bar row;
   - `@AC-17`: coverage with no gap around the holiday 2026-11-26 → `covered`, no history call;
   - `@AC-42`: the vendor has nothing from 2026-09-01 to 2026-10-30 → a WARN `data stage: long
     hole confirmed`, `analysis.data_stage.holes_confirmed{kind="long"}` +1, and
     `confirmed_gaps = 1` on the coverage row;
   - a history outcome of `SKIPPED` confirms no hole and the verdict is `no_vendor_data`;
   - the hole replace (D-37): stored runs inside the history range are deleted and the new runs
     stored; a run outside the range is kept;
   - the call order is final fetch, coverage, history, coverage, and the final call alone sets
     `return_bars`;
   - every `BackfillBars` call carries `x-internal-caller: analysis-data-stage`, `x-user-id:
     system` and an `x-trace-id`; no other call carries `analysis-data-stage`.
2. Replays and races:
   - `@AC-15`: with a `covered` row present, a second job makes no `BackfillBars` call and both
     rows are unchanged;
   - `@AC-33`: with a committed `no_vendor_data` row, a re-run makes no `BackfillBars` call and 1
     coverage row exists;
   - `@AC-66`: two jobs for one symbol reach the write together (the first holds its block open on
     a second pool) → exactly 1 coverage row, and the hole and filings rows are those of the job
     whose coverage row was stored;
   - `@AC-63`: the run is done and the symbol has no coverage row → the job succeeds with no
     marketdata call and writes no coverage and no bar row;
   - a job whose pass is behind the run row's is superseded the same way;
   - the supersede under the lock (D-62): the run row is marked done after the job's first block
     and before its write block → nothing is written;
   - a missing run row, and an `INVALID_ARGUMENT` from `BackfillBars`, raise `PermanentJobError`.
3. Fetch failures and the pass budget:
   - `@AC-46`: `UNAVAILABLE` on attempt 1 raises (the worker retries); on attempt 2 the job
     returns `Succeeded`, writes no coverage row, and
     `analysis.data_stage.fetch_deferred{reason="rpc"}` increases by 1;
   - a per-symbol `FAILED` outcome defers with reason `symbol`; an `UNAVAILABLE` from
     `GetDataCoverage` is an `rpc` fetch failure;
   - `@AC-10`: on pass 4, attempt 2, `UNAVAILABLE` → a coverage row `fetch_failed` with reason
     `rpc`, no bar row, no hole row, and the fundamentals state read from stored filings;
   - `@AC-59`: `pass_created_at` 31 minutes in the past on pass 1 → no marketdata call, no
     coverage row, `fetch_deferred{reason="budget"}` +1, on attempt 1 as well;
   - `@AC-60`: the same on pass 4 → `fetch_failed` with reason `budget` and fundamentals state
     `unavailable`, with no marketdata call;
   - `@AC-38`: the handler factory takes no settings object and the module reads no config key in
     the data job (a changed `pipeline.data_stage_delay_minutes` cannot defer or fail it).
4. Fundamentals:
   - `@AC-11`: `AAPL`'s check is due and `MSFT` has no row with P = 2026-10-28 →
     `BackfillFundamentals` is called for `AAPL` only, and `MSFT` gets a row whose
     `next_check_on` is on or after 2027-02-10;
   - `@AC-12`: P = 2026-08-10, the check due, `BackfillFundamentals` fails `UNAVAILABLE` → the job
     succeeds, the row is `covered` with state `fresh`, `next_check_on` is between 2026-12-04 and
     2026-12-10, and 1 bar row exists;
   - `@AC-22`: `FAILED_PRECONDITION`, P = 2026-05-11 → state `stale`, `last_outcome='disabled'`,
     `next_check_on` between 2026-12-04 and 2026-12-10;
   - `@AC-27`: a check made on 2026-11-27 with no new filing → jobs for 2026-11-30 to 2026-12-03
     make no `BackfillFundamentals` call;
   - `@AC-28`: nothing stored and a check made on 2026-11-27 → no call until 2026-12-24 and every
     coverage row has state `unavailable`;
   - a `GetHistoricalFundamentals` error gives state `unavailable` and the job still succeeds; no
     filings call is made on a `fetch_failed` verdict.
5. Telemetry and the RPC allowlist:
   - `@AC-20`: four data jobs, 3 ending `covered` and 1 `no_vendor_data`, 2 of them with a history
     fetch → the coverage rows count 3 and 1, and telemetry reports
     `analysis.data_stage.symbols` 3 `covered` and 1 `no_vendor_data` and 2
     `analysis.data_stage.backfills{kind="history"}`;
   - a replay counts nothing twice;
   - `@AC-56`: across every case of this file the marketdata stub was called only with
     `BackfillBars`, `GetDataCoverage`, `GetHistoricalFundamentals` and `BackfillFundamentals`.
6. `@AC-39` (the history half): the latest bar is 2026-11-24 after a missed session → the history
   call of the 2026-11-27 job covers 2026-11-25.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_data_stage_symbol.py tests/test_job_handler_contract.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "from tests.conftest" tests/test_data_stage_symbol.py   # C-13: doubles imported
```

---

### Step 24 — service: the finality classifier and the finality job

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/jobs/data_stage.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Captured columns: `analysis.symbol_bar (open, high, low, close, volume)`, all set or all NULL (Step 13; design § 11).
- The sample query and the result table are design.md § 9.4; the classifier is § 9.5 (D-60); the job is § 9.6 (D-59, D-63).
- Both values reach analysis through the same path with no rounding in marketdata (`services/xstockstrat-marketdata/internal/alpaca/client.go:450-459`).
- The re-fetch is the data job's final call (Step 22 item 4) with a 30 s timeout and the quiet caller.
- Worst case 20 + 300 + 20 = 340 s against `ATTEMPT_DEADLINE_S = 900.0` (`app/engine/job_graph.py:32`).
- No notify stub reaches the job registry (D-63; `app/jobs/__init__.py:7`).
- Header propagation (C-03): per-call `metadata=` with `SYSTEM_READ_META`, a fresh `x-trace-id` and the `analysis-data-stage` caller.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Constants under the design § 12 comment (D-64, D-66): `FINALITY_SAMPLE = 50`,
   `FINALITY_CALL_TIMEOUT_S = 30`, `FINALITY_BUDGET_S = 300`, `PRICE_REL_TOL = 1e-6`,
   `VOLUME_REL_TOL = 0.01`, `ADJUSTED_ABS_TOL = 0.011`, `ADJUSTED_REL_TOL = 1e-4`.
2. `classify_finality(captured, refetched) -> str`, a pure function implementing the table of
   design § 9.5 in this order: `unavailable` when there is no re-fetched bar; the zero-value rule
   (a captured price of 0 → `match` on exact equality, else `drift`; captured volume 0 requires
   re-fetched volume 0); `match`; `adjusted` (conditions i, ii and iii); otherwise `drift`.
3. `make_finality_handler(*, marketdata)`, as design § 9.6:
   - the epoch is the session date (`date.fromisoformat`; a malformed epoch →
     `PermanentJobError`);
   - one `job.db(10)`: finality rows for S exist → `Succeeded()`; read the run row's `day_start`
     and `day_end` (no row → `PermanentJobError`); select the sample with the query of § 9.4
     (`WHERE session_date = $1 AND close IS NOT NULL ORDER BY md5(symbol || $1::text) LIMIT 50`);
     an empty sample → INFO and `Succeeded()`;
   - re-fetch each sampled symbol in sequence under one `asyncio.timeout(FINALITY_BUDGET_S)` that
     contains no `.db(` block: `BackfillBars([symbol], TIMEFRAME_1DAY, [day_start, day_end],
     return_bars=True)`, timeout 30 s. Any error, a non-written outcome, or a symbol not reached
     before the budget expired is that symbol's `unavailable`. No error is re-raised;
   - classify, then one `job.db(10)`: `INSERT INTO analysis.data_stage_finality … ON CONFLICT DO
     NOTHING` with the re-fetched values (five NULLs for `unavailable`);
   - after the commit, per inserted row: `record_data_stage_finality(result)`; WARN `data stage
     finality drift` per drifted symbol with the symbol and both value sets; WARN `data stage
     finality unavailable` when every row is `unavailable`.
4. The job writes no coverage row, no bar row and no hole row, emits no notify alert, and calls
   only `BackfillBars`.

**Verification**: Step 25's commands. On its own:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_job_handler_contract.py tests/test_data_stage_symbol.py -q
ruff check . && ruff format --check .
grep -n "notify\|EmitAlert" app/jobs/data_stage.py   # no output
```

---

### Step 25 — test: the finality classifier and job

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_data_stage_finality.py` — create

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `data_stage_pg`, `StageJob`, `RecordingStub`, `aio_rpc_error` (`tests/conftest.py`); `metric_reader`, `metric_sum` (Step 23's sources).
- The classifier cases are design § 22: a match; a close-only change with volume +2% → drift; a 2:1 split → adjusted; a 3.00 stock × 0.995 cent-rounded with unchanged volume → adjusted; unavailable.
- C-13: bar values are the scenario's own; doubles are imported.

**TDD**: `red-green required`

**Covers**: `AC-51, AC-52, AC-53, AC-54, AC-56` (the finality job), `AC-57`

**Instructions**:
1. Classifier table (no database):
   - `@AC-51`: captured close 190.00 and volume 1,000,000, the same prices and volume → `match`
     (RED);
   - `@AC-52`: close 190.40 instead of 190.00 → `drift`; volume 5% higher with equal prices →
     `drift`;
   - `@AC-53`: captured 100.00 / 104.00 / 98.00 / 102.00 / 1,000,000 against 50.00 / 52.00 /
     49.00 / 51.00 / 2,000,000 → `adjusted`; captured 3.00 / 3.05 / 2.95 / 3.00 / 500,000 against
     2.99 / 3.03 / 2.94 / 2.985 / 500,000 → `adjusted`;
   - a close-only change with volume +2% → `drift`; a uniform rescale with volume changed by 3%
     and not inversely → `drift`;
   - volume within 1% and prices within 1e-6 → `match`;
   - a captured price of 0: equal re-fetched values → `match`, anything else → `drift`; captured
     volume 0 with re-fetched volume 5 → `drift`;
   - no re-fetched bar → `unavailable`.
2. Job tests (`real_pg`):
   - `@AC-57`: 1,200 covered bar rows for S → exactly 50 finality rows; a second run writes
     nothing, selects the same 50 symbols and counts no result twice; a session with 12 covered
     symbols checks all 12; a bar row with NULL captured values is never sampled; the sample of
     another session differs;
   - `@AC-54`: every re-fetch fails `UNAVAILABLE` for 50 sampled symbols → 50 rows `unavailable`,
     the handler returns `Succeeded`, `finality{result="drift"}` does not increase, and one WARN
     `data stage finality unavailable` is logged;
   - `@AC-52`: two drifted symbols → `finality{result="drift"}` +2, two WARN `data stage finality
     drift` records, and the coverage and bar rows of both symbols are unchanged (compare before
     and after);
   - the budget: with a patched `FINALITY_BUDGET_S` of 0.2 s and a stalling stub, the unreached
     symbols are `unavailable` and the job succeeds;
   - a missing run row and a malformed epoch raise `PermanentJobError`;
   - `@AC-56`: the stub was called only with `BackfillBars`, each call with `return_bars`, the
     day bounds of the run row and `x-internal-caller: analysis-data-stage`.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_data_stage_finality.py tests/test_job_handler_contract.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "from tests.conftest" tests/test_data_stage_finality.py   # C-13: doubles imported
```

---

### Step 26 — service: `DataStageEnsure` and the worker's `ensures` hook

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/data_stage_ensure.py` — create
- `services/xstockstrat-analysis/app/engine/job_graph.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `app/engine/data_stage_ensure.py`: **Not found** — created by this step.
- `JobGraphWorker.__init__(self, repo, service_pool, settings, registry, *, monotonic, utc_today, rand)` at `app/engine/job_graph.py:370-397`.
- `maintenance_tick` at `:715-728`: `if enabled(): await self._guarded("ensure", self._ensure_prune)` at `:724-725`; `_guarded(step, fn)` at `:730-735` logs and swallows an `Exception`; `_ensure_prune` at `:753-764` (the per-day marker shape to follow).
- `repo.enqueue(kind, subject, epoch, *, run_id, lane, conn=None)` → `(job_id, created)`, `ON CONFLICT (kind, subject, epoch) DO NOTHING` (`app/repositories/pipeline_jobs.py:275-295`); `repo.list_by_run(run_id)` returns rows with `state` (`:165-168`, `:400-402`); `FINISHED_STATES` at `:17`.
- `bounded_txn(pool, budget_s, …)` at `app/repositories/read_budget.py:212-258`; it is already imported by `job_graph.py:17`. The ensure uses the service pool through it and opens no pool of its own (F-06).
- Settings: `data_stage_enabled()`, `data_stage_delay_minutes()` (Step 11).
- `GetLastClosedSession` (Steps 1-3); kinds and key helpers (Step 18, S-1).
- Header propagation (C-03): the one new outbound call carries `SYSTEM_READ_META` and a fresh `x-trace-id` per ask (D-18), as a per-call `metadata=` argument.
- The state machine is design.md § 2 (steps 1-8) and § 9.3; its rules are D-22, D-45, D-51, D-53.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `job_graph.py`: `JobGraphWorker.__init__` gains the keyword-only `ensures=()` and stores it. In
   `maintenance_tick`, directly after the `_ensure_prune` line (`:725`), for each entry:
   `if enabled(): await self._guarded("ensure", fn)`. Nothing else in the file changes
   (design § 18 item 1).
2. `data_stage_ensure.py`, a one-line module docstring, then:
   - constants under one comment citing design § 12: `ASK_PERIOD_S = 60`, `ASK_TIMEOUT_S = 2`,
     `PASS_CHECK_PERIOD_S = 60`, `ENSURE_DB_BUDGET_S = 5`, and the SQL intervals `30 minutes`
     (spacing) and `16 hours` (finality);
   - `class DataStageRuns` (S-2), constructed with the service pool, each method one
     `bounded_txn(pool, ENSURE_DB_BUDGET_S)`:
     - `insert(session, closed_at, day_start, day_end, delay)` → the run row or `None`: the
       `INSERT … SELECT … WHERE now() >= $2 + make_interval(mins => $5) ON CONFLICT (session_date)
       DO NOTHING` of design § 2 step 2, then a read of the row;
     - `read(session)` → the row or `None`;
     - `pending(session)` → bool: the marker is absent, or some snapshot symbol of S has no
       `symbol_coverage` row (§ 2 step 6);
     - `mark_done(session, p)` → bool: `UPDATE … SET done_at = now() WHERE session_date = $1 AND
       pass = $2 AND done_at IS NULL`;
     - `advance(session, p)` → bool: the compare-and-set of § 2 step 8, including `now() >=
       pass_created_at + interval '30 minutes'`;
     - `finality_due(session)` → bool: `now() >= closed_at + interval '16 hours'`;
   - `class DataStageEnsure(repo, runs, marketdata, settings, *, now, monotonic)` with one public
     coroutine `tick()` implementing § 2 steps 1 to 8 in order:
     1. ask at most once per 60 s (`GetLastClosedSession(as_of=now())`, timeout 2 s); on an error
        one WARN and keep the cache; with no cache return. A new session date clears the run
        cache and the per-run marks;
     2. with no cached run row: return when the switch is off or local `now < closed_at + delay`;
        otherwise `runs.insert(…)` with `settings.data_stage_delay_minutes()`; no row → return;
     3. `done_at` set → the finality step, then return;
     4. the switch on and `(S, p)` not marked → `repo.enqueue(UNIVERSE_KIND, GLOBAL_SUBJECT,
        stage_epoch(S, p), run_id=stage_run_id(S, p), lane=Lane.HELD)`, then mark;
     5. the pass check at most once per 60 s, starting on the tick of the enqueue:
        `repo.list_by_run(stage_run_id(S, p))`; zero rows → clear the mark and return; any row not
        in `FINISHED_STATES` → return;
     6. `runs.pending(S)`;
     7. nothing pending, or `p == PASSES` → `runs.mark_done(S, p)` whatever the switch says; on
        success INFO `data stage run done`; on no match re-read the run row;
     8. pending and `p < PASSES` → return when the switch is off; otherwise `runs.advance(S, p)`;
        on success INFO `data stage pass started` (session, pass); on no match re-read the run row.
   - the finality step (§ 9.3): when the switch is on, the process flag for S is clear, a local
     prefilter passes and `runs.finality_due(S)` is true → `repo.enqueue(FINALITY_KIND,
     GLOBAL_SUBJECT, S.isoformat(), run_id=finality_run_id(S), lane=Lane.WATCHLIST)`, then set the
     flag.
3. Every cache (the calendar answer, the run row, the enqueued marks, the finality flag, the last
   check times) is process state the database can rebuild; no cache is consulted to decide a gate
   that the database decides (D-45).
4. `tick()` raises nothing the worker must handle beyond what `_guarded` logs; it creates no task
   and no pool.

**Verification**: Step 27's commands. On its own:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_job_graph_worker.py tests/test_retention_prune_job.py tests/test_pipeline_boot.py -q   # ensures=() changes nothing
ruff check . && ruff format --check .
grep -n "create_pool\|asyncpg" app/engine/data_stage_ensure.py   # no output (F-06)
grep -n "metadata=" app/engine/data_stage_ensure.py
```

---

### Step 27 — test: the ensure

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/conftest.py` — modify
- `services/xstockstrat-analysis/tests/test_data_stage_ensure.py` — create
- `services/xstockstrat-analysis/tests/test_job_graph_worker.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `class VirtualTime` at `tests/conftest.py:608`, the `virtual_time` fixture at `:633-634` (`await advance(seconds)`); `class FakeJobRepo` at `:644`, with `enqueue` at `:849-859` and `jobs`, `calls`, `fail` (`:652-662`). It has no `list_by_run` (S-10).
- Worker helper for tick tests: `_worker(vt, repo, settings, handler, …)` at `tests/test_job_graph_worker.py:87`; the daily-ensure tests at `:515-563` (`test_daily_prune_is_ensured_once_per_day_and_again_by_a_new_worker`, `test_daily_ensure_marker_is_not_set_when_the_ensure_fails`); `test_ac16_disabled_worker_does_not_enqueue_the_daily_prune` at `:155`.
- `data_stage_pg` (Step 19); `PipelineJobsRepository(pool)` on a test pool (`tests/test_retention_prune_job.py:40`).
- Ledger (insights, pipeline-job-graph): inject `monotonic` and test timer code on the virtual clock; mutation-check such tests.
- C-13: `FakeDataStageRuns` has consumers in Steps 27 and 29, so it goes to `tests/conftest.py` (S-7).

**TDD**: `red-green required`

**Covers**: `AC-2, AC-16` (no run row), `AC-18` (no further pass, no next run), `AC-26, AC-31` (run marked done), `AC-38` (run row frozen), `AC-39` (no run for the missed session), `AC-43, AC-50, AC-55, AC-61, AC-64, AC-65`

**Instructions**:
1. `tests/conftest.py`:
   - `FakeJobRepo.list_by_run(run_id, *, conn=None)`: the jobs whose `run_id` matches, as dicts
     with `state`;
   - `FakeDataStageRuns(clock)`: an in-memory `DataStageRuns` whose "database now" is a settable
     wall time advanced with the virtual clock, with the same method results, plus `pending_value`
     and helpers to seed a row.
2. `tests/test_data_stage_ensure.py`, unit cases on `virtual_time` with `FakeJobRepo`,
   `FakeDataStageRuns` and a `RecordingStub` marketdata:
   - `@AC-26`: at 16:29 database time no run row exists; at 16:30 exactly 1 exists (RED);
   - `@AC-43`: a half-day session answers `closed_at` 16:00, and the run row is created at 16:30;
   - `@AC-16`: on Saturday 2026-11-28 the cached session is 2026-11-27; no run row exists for
     2026-11-28;
   - `@AC-38`: the run row was created with delay 30; the key changes to 120 at 16:40 → the row
     still holds `closed_at` 16:00 and delay 30, and the ensure keeps enqueuing and advancing;
   - `@AC-39`: the ensure first ticks at 17:00 on 2026-11-27 after a down period → a run row for
     2026-11-27 and none for 2026-11-25;
   - the ask: at most one `GetLastClosedSession` per 60 s; a failing ask logs one WARN per minute
     and keeps the cached answer; with no cached answer nothing is created;
   - the enqueue: one universe job per `(S, p)` with epoch `S#p`, run id `data_stage:S#p` and lane
     20; a second ensure instance on the same repository creates none;
   - `@AC-65`: the run row is at pass 2 and no job exists for that pass → the pass-2 universe job
     is enqueued on the next tick; a pass with zero job rows is never marked done;
   - the pass check runs from the tick of the enqueue and at most once per 60 s; an unfinished job
     of the pass stops it;
   - `@AC-64`: every snapshot symbol recorded by 16:36 → the run is marked done within 65 s, before
     17:00, without waiting for the spacing;
   - `@AC-31`: nothing pending after an empty-universe pass → the run is marked done;
   - `@AC-50`: all 4 passes finished and a symbol still pending → the run is marked done;
   - the spacing: pending at pass 1 with every job finished → no advance before 30 minutes after
     `pass_created_at`, an advance at the first check after it, INFO `data stage pass started`;
   - a compare-and-set that matched no row re-reads the run row and follows it (another instance
     advanced or finished the run);
   - `@AC-18`: the switch set to false → no further pass is created for the session, no run row is
     created for the next session, and a run with nothing pending is still marked done;
   - `@AC-61`: a run at pass 2 and not done when the session moves to 2026-11-27 → a run row for
     2026-11-27 is created, no pass 3 is created for 2026-11-25, and its `done_at` stays NULL;
   - `@AC-55`: run done; at 07:59 on 2026-11-28 no finality job exists; at 08:00 exactly 1 exists
     with epoch `2026-11-27`, run id `data_stage_finality:2026-11-27` and lane 10, however many
     ticks follow and with two ensure instances; no finality job for an undone run or with the
     switch off; a run done after +16 h gets its finality job at done.
3. The same file, `real_pg` cases on `data_stage_pg` with the real `DataStageRuns` and
   `PipelineJobsRepository`:
   - `@AC-2`: two ensures tick at the same time with `closed_at` 31 minutes before the database's
     now → exactly 1 run row and exactly 1 universe job for pass 1;
   - the database-time gate: `closed_at` 29 minutes before now → `insert` returns `None`; 30
     minutes → a row with `pass = 1`;
   - two `advance` calls race → exactly one returns true and the row is at pass 2;
   - `mark_done` after an `advance` matches no row;
   - `pending` is true without a marker, true with a snapshot symbol lacking a coverage row, false
     when every snapshot symbol has one;
   - `finality_due` flips at `closed_at + 16 hours`.
4. `tests/test_job_graph_worker.py`: with `ensures=(fn,)`, `fn` runs once per maintenance tick
   after the prune ensure; it does not run with `pipeline.worker_enabled` false; a raising entry is
   logged and does not stop the next entry or the tick.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_data_stage_ensure.py tests/test_job_graph_worker.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "class FakeDataStageRuns\|async def list_by_run" tests/conftest.py   # C-13: one home
```

---

### Step 28 — service: registry and startup wiring

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/jobs/__init__.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `def build_registry(settings) -> HandlerRegistry` at `app/jobs/__init__.py:7-11`; called with one argument by `app/main.py:253` and by `tests/test_retention_prune_job.py:43`.
- `HandlerRegistry.register(kind, handler, *, child_kinds=())` (`app/engine/job_graph.py:128-130`); `validate()` raises on an unregistered child kind (`:141-160`); the worker claims only registered kinds.
- The pipeline block of `app/main.py:243-259`: `PipelineJobsRepository(control_pool)` is constructed inline at `:250`; three `spawn(` calls at `:256-258`.
- Stubs on the servicer: `servicer._marketdata`, `servicer._ingest`, `servicer._portfolio`, passed to the live loop at `app/main.py:165-171` (`app/handlers/servicer.py:565-576`).
- `tests/test_supervision.py:143-148` pins the number of `spawn(` calls in `app/main.py`; this step adds none.
- `tests/test_pipeline_boot.py:50-58` lists the job-graph files that must not mention the durable scheduler.
- No new environment variable and no new port: `MARKETDATA_ENDPOINT`, `INGEST_ENDPOINT` and `PORTFOLIO_ENDPOINT` are already read (`app/main.py:31-36`); `docker-compose.yml`, `.do/app.dev.yaml` and `.do/app.yaml` need no change.
- No new pool (F-06): the ensure receives the existing `db_pool` (`app/main.py:51-55`, `_create_pools`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `app/jobs/__init__.py`: `build_registry(settings, *, marketdata=None, portfolio=None,
   ingest=None)`. The prune kind is registered as today. When all three stubs are given, register:
   `UNIVERSE_KIND` with `child_kinds=(SHARD_KIND,)`, `SHARD_KIND` with `child_kinds=(SYMBOL_KIND,)`,
   `SYMBOL_KIND` and `FINALITY_KIND` with none. With a stub missing, register none of the four
   (design § 18 item 3). `registry.validate()` stays the last call.
2. `app/main.py`, inside the existing pipeline block:
   - construct the repository once: `pipeline_repo = PipelineJobsRepository(control_pool)`, shared
     by the worker and the ensure (design § 18 item 4);
   - `data_stage_ensure = DataStageEnsure(pipeline_repo, DataStageRuns(db_pool),
     servicer._marketdata, pipeline_settings)`;
   - `build_registry(pipeline_settings, marketdata=servicer._marketdata,
     portfolio=servicer._portfolio, ingest=servicer._ingest)`;
   - `JobGraphWorker(pipeline_repo, db_pool, pipeline_settings, registry,
     ensures=(data_stage_ensure.tick,))`.
   Add no `spawn(` call, no pool, no channel and no environment variable.

**Verification**: Step 29's commands. On its own:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_pipeline_boot.py tests/test_supervision.py tests/test_retention_prune_job.py tests/test_job_handler_contract.py -q
ruff check . && ruff format --check .
grep -c "spawn(" app/main.py   # unchanged from before this step
grep -n "DataStageEnsure\|ensures=" app/main.py
```

---

### Step 29 — test: boot wiring, the end-to-end run and the unchanged responses

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_data_stage_e2e.py` — create
- `services/xstockstrat-analysis/tests/test_pipeline_boot.py` — modify
- `services/xstockstrat-analysis/tests/test_owner_header_guard.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- A real worker on PostgreSQL driven tick by tick: `_worker`, `_drain`, `maintenance_tick`, `claim_tick` (`tests/test_retention_prune_job.py:38-59`).
- Boot-wiring assertions by source inspection: `tests/test_pipeline_boot.py:45-47` (`inspect.getsource(app_main.serve)`), the disjointness list at `:50-58`.
- Header guard: `_assert_owner_headers(*stubs)` at `tests/test_owner_header_guard.py:90-100` (one non-empty `x-user-id`; `system` only with one grant in `_SYSTEM_GRANTS`, `:36`); the path tests from `:150`.
- A servicer for RPC-level assertions: `make_servicer()` (`tests/test_analysis_servicer.py:46`, imported at `tests/test_owner_header_guard.py:30`).
- `data_stage_pg`, `StageJob`, `FakeDataStageRuns` (Steps 19, 27); `RecordingStub`.
- The pass spacing and the pass budget are decided by the database clock, so a test moves a run between passes by shifting `pass_created_at` back, never by waiting.
- C-13: the 2,000-symbol universe is generated in the test; doubles are imported.

**TDD**: `red-green required`

**Covers**: `AC-10` (all four passes), `AC-18` (created jobs finish), `AC-19, AC-35, AC-45, AC-46` (the pass-2 half), `AC-47`

**Instructions**:
1. `tests/test_pipeline_boot.py`:
   - `build_registry(settings)` registers only the prune kind; with three stubs it registers the
     four stage kinds and `validate()` passes; with one stub missing it registers none of them
     (RED);
   - the source of `app_main.serve` constructs `PipelineJobsRepository(` once and passes
     `ensures=`;
   - add `app/engine/data_stage_ensure.py` to the disjointness list (`:50-58`; `app/jobs/*.py` is
     already globbed).
2. `tests/test_owner_header_guard.py`: one path test driving the universe handler with
   `RecordingStub` ingest and portfolio doubles: every ingest call carries exactly one non-empty
   `x-user-id`; the system-scope read carries `system` with the single grant
   `analysis-system-read`; an owner read carries no grant; every call carries an `x-trace-id`.
3. `tests/test_data_stage_e2e.py` (`real_pg`), a real `JobGraphWorker` with the full stage
   registry, the real `DataStageEnsure` and `DataStageRuns`, and scripted `RecordingStub` doubles:
   - the healthy run: 2,000 symbols over 5 shards, one pass → 2,000 coverage rows, the run done,
     every job `succeeded`;
   - `@AC-45`: marketdata `UNAVAILABLE` during passes 1 and 2 and healthy in pass 3 (the test
     shifts `pass_created_at` back by 31 minutes between passes) → passes 1 and 2 write no
     coverage row for `NVDA`, pass 3 records `covered`, the run is marked done;
   - `@AC-10`: `BackfillBars` for `NVDA` fails `UNAVAILABLE` in all 4 passes → the coverage row is
     `fetch_failed` with reason `rpc`, no bar row and no hole row exist, and every `NVDA` data job
     is in state `succeeded`;
   - `@AC-46`: only `NVDA` deferred in pass 1 → pass 2 creates a data job for `NVDA` and for no
     other symbol;
   - `@AC-47`: the pass-1 data job for `NVDA` ends `dead` (a stub that raises a non-gRPC error on
     every attempt) → a data job for `NVDA` exists with epoch `2026-11-27#2`;
   - `@AC-35`: in one shard the `AAPL` job ends `dead` and the `MSFT` job succeeds → the coverage
     row for `MSFT` exists and `AAPL` has none for the session; the shard and the universe job are
     `blocked` and the pass still finishes;
   - `@AC-18`: pass 1 has created 3 data jobs, 1 not started; the switch is set to false → the 3
     jobs run to completion and write their rows;
   - `@AC-19`: build a servicer with `make_servicer`, record `ListOpportunities` for `u1` (the
     opportunities for `AAPL` and `MSFT` with their conviction values) and
     `GetWatchlistReadiness` for `u1` (state `READY` for `AAPL`); run one full stage pass against
     the same marketdata, portfolio and ingest doubles; call both RPCs again → equal responses.
     Also assert that the stage's statements name only the eight stage tables and
     `analysis.strategies` (a scan of the SQL literals in `app/jobs/data_stage.py` and
     `app/engine/data_stage_ensure.py`).

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_data_stage_e2e.py tests/test_pipeline_boot.py tests/test_owner_header_guard.py tests/test_supervision.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "from tests.conftest" tests/test_data_stage_e2e.py   # C-13: doubles imported
```

---

### Step 30 — docs: the data-stage page, the requeue note, the service docs and the program plan

**Status**: `pending`
**Service**: `docs/`, `services/xstockstrat-analysis/` and `services/xstockstrat-marketdata/` (documentation only)
**Files**:
- `services/xstockstrat-analysis/docs/data-stage.md` — create
- `services/xstockstrat-analysis/docs/pipeline-jobs.md` — modify (§ Manual recovery)
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `docs/roadmap/program-job-graph-analysis-pipeline.md` — modify (line 82 only)

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-analysis/CLAUDE.md:106-114` (`### Pipeline job graph (feature 367)`, ending "Detail → this service's `docs/` folder (**`pipeline-jobs.md`**)"); § Dependencies at `:137-148` (the marketdata row reads "Historical OHLCV data for backtesting"); § Observability at `:345-352`, the pipeline bullet at `:350`.
- `services/xstockstrat-analysis/docs/pipeline-jobs.md:40-83` (§ Manual recovery, the requeue SQL).
- `services/xstockstrat-marketdata/CLAUDE.md:227-235` (§ Ledger Events Emitted: `marketdata.backfill.started`, `.completed`, `.failed`); the internal-caller paragraph at `:173-176`.
- `docs/roadmap/program-job-graph-analysis-pipeline.md:82`: feature 2's row says "an automatic backfill child with a terminal \"no vendor data\" verdict". The design has no child (D-30) and three bar verdicts (D-42); P-03 requires the note be corrected.
- `scripts/check-context-map.py` validates doc cross-references in `CLAUDE.md` files and passes on the current tree; `scripts/check-otel-produced-signals.py` scans `docs/` and `packages/otel` for named alert assets and passes on the current tree. The drift rule is not provisioned in `packages/otel` (D-63), so no registry row is added.
- `node scripts/check-config-wiring.mjs --doc-check` scans every `services/*/CLAUDE.md`.
- The config rows and the config-governance entry landed in Step 10; the default docs in Step 9.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `services/xstockstrat-analysis/docs/data-stage.md` (new), from design.md:
   - what a run, a pass and the four job kinds are (the table of § 1);
   - the run row and the ensure (§ 2), including a missed session and an abandoned run;
   - the three bar verdicts, the fetch-failure reasons and the pass budget (§ 6, § 7);
   - the fundamentals states and the check schedule (§ 8);
   - the finality check: what is compared, the four results, and the operator procedure of § 9.6
     (the drift query, then raising `analysis.pipeline.data_stage_delay_minutes`);
   - the Grafana alert rule definition on `increase(analysis.data_stage.finality{result="drift"})
     > 0`, with the statement that the rule is created by hand at launch and is not in
     `packages/otel`;
   - hole visibility (§ 10): the find query (covered with `bars_in_window < 400`) and the clear
     statement (`DELETE FROM analysis.symbol_bar_hole WHERE symbol = $X`); `symbol_bar` rows are
     never deleted by hand;
   - the eight tables and their retention (§ 4, § 11);
   - the telemetry table and the log lines (§ 15);
   - the seam for feature 369 (§ 17), both lists;
   - the pre-launch staging verification (§ 9.7) and the deploy order (marketdata first);
   - the accepted risks (design.md § Open Risks).
2. `docs/pipeline-jobs.md` § Manual recovery: one paragraph after the recovery SQL (D-65): once a
   data-stage run is done, a requeued `data_stage.*` job writes nothing for that session; the next
   session's run repairs the stored bars only. Link to `data-stage.md`.
3. `services/xstockstrat-analysis/CLAUDE.md`:
   - a `### Symbol data stage (feature 368)` subsection after `:114`, five to eight lines: the
     daily stage, the kinds, the eight tables (migration `032`), the kill switch, no notify alert,
     and "Detail → this service's `docs/` folder (**`data-stage.md`**)";
   - § Dependencies: the marketdata row gains the stage's calls (`GetLastClosedSession`,
     `BackfillBars`, `GetDataCoverage`, `GetHistoricalFundamentals`, `BackfillFundamentals`); the
     portfolio and ingest rows gain the universe snapshot reads;
   - § Observability: one bullet listing the eight `analysis.data_stage.*` instruments with their
     label values and the INFO and WARN lines of design § 15.
4. `services/xstockstrat-marketdata/CLAUDE.md`:
   - § Ledger Events Emitted: one sentence under the table — a `BackfillBars` call carrying
     `x-internal-caller: analysis-data-stage` from the `xstockstrat-analysis` SAN appends none of
     the three backfill events; metrics and logs are unchanged;
   - beside the internal-caller paragraph (`:173-176`): the `BackfillBars.ledger_quiet` grant, and
     that `BackfillBars` itself stays ungated;
   - one sentence each for `GetLastClosedSession` (ungated, backed by `packages/proto/marketsession`,
     early closes not modelled) and `return_bars` (explicit range of at most 7 days).
5. `docs/roadmap/program-job-graph-analysis-pipeline.md:82`: rewrite the "Delivers" cell to match
   the approved design: one run per closed session with up to four passes; one data job per symbol
   that fetches through marketdata `BackfillBars` itself (no backfill child); three bar verdicts;
   the bar record; the next-morning finality check (feature 368). Change no other row.

**Verification**:
```bash
python3 scripts/check-context-map.py && python3 scripts/check-otel-produced-signals.py
node scripts/check-config-wiring.mjs --doc-check
ls services/xstockstrat-analysis/docs/data-stage.md
grep -n "data-stage.md" services/xstockstrat-analysis/CLAUDE.md services/xstockstrat-analysis/docs/pipeline-jobs.md
grep -n "analysis-data-stage" services/xstockstrat-marketdata/CLAUDE.md
grep -c "backfill child" docs/roadmap/program-job-graph-analysis-pipeline.md   # 0
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
