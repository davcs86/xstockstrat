# Recon: symbol-data-stage

**Created**: 2026-11-28
**From**: product-spec.md
**Tree**: ccr-d10c1761-fxpr1d@f3183664 = origin/main-dev@bc497728 + docs-only commits
**Affected services**: xstockstrat-analysis, xstockstrat-marketdata, xstockstrat-ingest, xstockstrat-portfolio, xstockstrat-config

Paths under "analysis", "marketdata", "ingest", "portfolio" and "config" are relative to
`services/xstockstrat-<name>/`. Every `path:line` comes from a discovery digest on the tree above.

---

## Objective

Add a daily stage on the analysis job graph (feature 367) that snapshots each user's symbol
universe and runs one data job per symbol and closed session: bars brought to the last closed
session with an automatic gaps-only backfill, fundamentals refreshed by staleness, a durable
coverage record and a bar record that feature 369 evaluates from. It also flips the code default
and seeded `default_value` of `marketdata.fundamentals.snapshot_source` to `edgar` without changing
any stored value. No existing loop is removed and no analysis RPC response changes.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Entry point and wiring: `app/main.py:243-259` builds
    `JobGraphWorker(PipelineJobsRepository(control_pool), db_pool, pipeline_settings, build_registry(pipeline_settings))`
    and spawns `pipeline-claim`, `pipeline-maintenance`, `pipeline-heartbeat` through
    `supervision.spawn`. Pools: `_create_pools` `app/main.py:51` (service pool `DB_POOL_MAX` default
    2; control pool fixed 2).
  - Channels: `app/main.py:77-116` (`MARKETDATA_ENDPOINT`, `INGEST_ENDPOINT`, `PORTFOLIO_ENDPOINT`;
    mTLS via `app/mtls.py`). Stubs live on the servicer (`servicer._marketdata`, `_ingest`,
    `_portfolio`). Analysis has no identity stub and no `IDENTITY_ENDPOINT`.
  - Job graph runtime: `app/engine/job_graph.py` — `Lane` `:56` (WATCHLIST=10, HELD=20), `Child`
    `:74`, outcomes `:81-93`, `classify` `:104`, `check_outcome` `:108`, `HandlerRegistry.register`
    `:128`, `validate` `:141`, `validate_wait_on` `:162`, `JobGraphSettings` `:191`, `ClaimedJob`
    `:290-301`, `job.db(budget)` `:303`, `worker._gate` `:390`, `maintenance_tick` `:725`,
    `_ensure_prune` `:753`.
  - Job repository: `app/repositories/pipeline_jobs.py` — `_REPORT_SQL` `:69`, `_SETTLE_SQL` `:132`,
    prune SQL `:184-199`, `enqueue` `:275`, `park` `:368`, `list_by_run` `:400`.
  - Registry: `app/jobs/__init__.py:7` `build_registry(settings)` (receives only `settings`);
    reference handler `app/jobs/retention_prune.py:17-34`.
  - Last migration: `031_pipeline_job_graph.up.sql` (`migrations/`).
  - Config-read pattern: `JobGraphSettings.worker_enabled` =
    `get_bool("pipeline.worker_enabled", default=True)` `app/engine/job_graph.py:207-208`; getters
    in `app/config/watcher.py:66-72`.
  - Universe drains: `_drain_positions_paged` (module level in `app/handlers/servicer.py`, imported
    at `app/engine/live_loop.py:42`); `_drain_held` `live_loop.py:577`; `_drain_watchlist`
    `live_loop.py:591`; `_drain_signals_with` `live_loop.py:539`; servicer copies
    `_drain_watchlist_bindings` `servicer.py:6343`, `_drain_active_signals` `:6735`,
    `_drain_held_symbols` `:6776`; `resolve_universe` `live_loop.py:114` (per strategy).
  - Owner list: live loop derives owners from `analysis.strategies` rows `live_loop.py:374-402`.
  - Identity metadata: `owner_metadata(owner)` `app/identity.py:11` (raises for empty or `system`);
    `_SYSTEM_READ_META` `live_loop.py:78`; fundsignal `sys_meta` `fundsignal_loop.py:214-217`.
  - Telemetry: `app/telemetry.py` — wrapper classes, `KEY_*` labels `:428-435`,
    `record_pipeline_attempt` `:566`.
  - Durable schedule (feature 158, disjoint from the job graph): `app/engine/durable_schedule.py`.
- **`xstockstrat-marketdata`** (Go)
  - `GetDataCoverage`: service `internal/service/marketdata_service.go:516`, handler
    `internal/handler/marketdata_handler.go:214`, repo `internal/repository/marketdata_repo.go:264`;
    gaps via `timeframe.ComputeSessionGaps` `internal/timeframe/timeframe.go:104`.
  - `BackfillBars`: `marketdata_service.go:1541-1543` (synchronous, sequential over symbols);
    outcome logic `:1607`, `:1652`; delisted flag `internal/service/delisting.go:72`.
  - Bar ingest poller: `StartBarIngestPoller` `marketdata_service.go:1338`, `ingestRecentBars`
    `:1414`, warm set `warmSnapshot` `:1214`, `markWarm` `:651`.
  - Fundamentals: dispatch `:1840`, `:1859`; `resolveFundamentals` `:1982`; `snapshotSource` `:2044`;
    constants `:2036-2039`; unknown-value fallback `:2051-2053`; `edgarResolve` `:2096`;
    `errNoEdgarSnapshot` `:2078`; quota `:2185-2215`.
  - Authz: `internal/service/authz.go:26-29` (only two RPCs gated; the rest ungated).
  - Calendar package: `packages/proto/marketsession/marketsession.go` (`SessionDate` `:22`,
    `IsTradingDay` `:47`, `PrevTradingDay` `:56`, `Reference` `:66`, `closures` `:82`, `isHoliday`
    `:95`).
  - Last migration: `010_symbol_profile`.
- **`xstockstrat-ingest`** (Python)
  - `TriggerBackfill`: `app/handlers/servicer.py:525-603` (async; `asyncio.create_task` `:599`);
    admin check `_has_admin_scope` `:431-436`; self-serve envelope `_self_serve_denial` `:457`;
    self-serve dedup `_insert_self_serve_job` `:605`; `_plan_work_ranges` `:793-827`; no-gap fast
    path `:850-868`; `_verify_gaps_only` `:897-959`; `_finalize_backfill` `:961-981`;
    `GetBackfillStatus` `:1203`; `ListBackfillJobs` `:1213`; `_resume_job` `:1043`.
  - `QuerySignals`: `servicer.py:1542`; system grants `_SYSTEM_GRANTS` `:122-126`.
  - Last migration: `018_backfill_symbol_results`.
- **`xstockstrat-portfolio`** (Go)
  - `ListPositions`: `internal/service/portfolio_service.go:992`, repo
    `internal/repository/portfolio_repo.go:80` (`user_id = $1`).
  - `ListWatchlists`: `portfolio_service.go:2437` (first page can write, `:2452`).
  - `ListAllWatchlistSymbols`: `portfolio_service.go:2402-2419`; gate
    `internal/service/authz.go:19-21`; repo `internal/repository/watchlist_repo.go:445-447`.
  - Last migration: `019_fill_applied_events`.
- **`xstockstrat-config`** (Node)
  - Latest migration: `migrations/061_analysis_pipeline_keys.up.sql` (shape `:5-12`, conflict clause
    `:43`); down `061_analysis_pipeline_keys.down.sql:4-14`.
  - Original seed of the changed key: `migrations/030_marketdata_edgar_snapshot_keys.up.sql:25-30`;
    rename to namespace-relative `migrations/044_config_keys_relative.up.sql:216`.

## Facts the design must fit

### Job graph contract (feature 367)

- **Handler shape.** `async def handler(job) -> Succeeded | WaitOn | Verdict`
  (`app/engine/job_graph.py:108`). `ClaimedJob` carries `job_id, kind, subject, epoch, run_id, lane,
  attempts, wait_round, lease_token` (`:290-301`).
- **Database access.** `job.db(budget)` yields one bounded transaction on the service pool; budget
  is at most 30 s (`HANDLER_BLOCK_CAP_S`); a process-wide lock allows one handler DB block at a time
  per instance (`:303`, `:390`). `tests/test_job_handler_contract.py` forbids pool access, and every
  await inside the block must be on `conn` (line 110), so gRPC calls sit outside it.
- **Wake.** When all children are `succeeded`, `_SETTLE_SQL` sets the parent `ready` with
  `wait_round + 1` and the handler runs again from the top (`pipeline_jobs.py:132`). The job object
  has no child-outcome accessor.
- **Bad child.** A child that ends `failed`, `dead` or `blocked` blocks the waiting parent at once
  and the parent's handler does not run again. The parent's verdict is `dependency_failed`,
  `dependency_dead`, or the child's own verdict label (`pipeline_jobs.py:132`;
  `tests/test_job_graph_worker_real_pg.py:110-122`).
- **Park.** `repo.park` inserts children with ON CONFLICT DO NOTHING, attaches an existing child as
  it is, and refunds the parking attempt (`pipeline_jobs.py:368`). Limits: 8 park rounds, 10,000
  children, child kinds declared at `register` (`job_graph.py:128`, `:162`). A parked job holds no
  worker slot.
- **Enqueue.** `enqueue(kind, subject, epoch, *, run_id, lane, conn=None)` returns `(job_id,
  created)`; an existing row keeps its original run id and lane (`pipeline_jobs.py:275`). `kind`,
  `subject`, `epoch`, `run_id` are unbounded TEXT; unique on `(kind, subject, epoch)`
  (`migrations/031_pipeline_job_graph.up.sql`).
- **Periodic ensure.** Only `_ensure_prune` exists, called from `maintenance_tick` every 5 s when
  `worker_enabled` (`job_graph.py:725`, `:753`). There is no generic periodic API.
- **Errors and limits.** Only `PermanentJobError` is permanent (`:104`); everything else retries
  with backoff 5 to 300 s until `max_attempts` (default 5), then `dead`. An attempt is stopped at
  900 s. Slots: `worker_concurrency` default 4.
- **Retention.** `failed`/`dead`/`blocked` kept `max(30, retention_days)` days; `succeeded` kept
  `retention_days` (default 7) (`app/jobs/retention_prune.py:17-34`). A `failed` or `dead` key
  blocks parents on that key until it is pruned or repaired by hand (`docs/pipeline-jobs.md`).
- **Handler wiring.** `build_registry(settings)` passes no stubs (`app/jobs/__init__.py:7`); new
  handlers need stubs threaded through it.

### Universe sources

- Positions and watchlists are readable only per user, with that user's `x-user-id`
  (`portfolio_service.go:992`, `:2437`). No cross-user positions read exists.
- `ListAllWatchlistSymbols` is cross-user but returns bare symbols with no user mapping and is
  gated to caller `analysis-fundsignal` (`portfolio_service.go:2402-2419`, `authz.go:19-21`).
- `QuerySignals` has no all-owners scope; `scope=SYSTEM` needs `x-internal-caller:
  analysis-system-read` plus the analysis SAN (ingest `servicer.py:122-126`).
- The live loop already reads each owner's positions, watchlists and signals in the background by
  sending `owner_metadata(owner)` for owners taken from `analysis.strategies`
  (`live_loop.py:374-402`, `:577`, `:591`, `:539`).
- A user with no strategy is not in `analysis.strategies`. Identity `ListUsers` is admin-header
  gated and analysis has no identity channel.
- `ListWatchlists` can write on its first page (`portfolio_service.go:2452`).
- Watchlist caps: 50 lists per user, 500 symbols per list (bounded [1,1000]); no per-user total cap.

### Coverage and the calendar

- `GetDataCoverage` takes one symbol; for `1d` it runs one query returning every stored stamp in
  the range and reports head gaps, interior holes and the trailing edge up to the last closed
  session (`marketdata_service.go:516`, `:573`; `timeframe.go:104-131`). A zero start floors to
  2000-01-01.
- "Last closed" inside `ComputeSessionGaps` is `marketsession.Reference(now)`, stepping back one
  day while the session is live (`timeframe.go:108-111`). After 16:00 New York today counts as
  closed at once, so a bar that has not arrived yet is a gap.
- The calendar computes holidays by rule and lists one-off closures only up to 2025-01-09; early
  closes are not modelled (`marketsession.go:1-2`, `:82`, `:95`).
- No RPC in any service exposes a session date or market status. Python has no calendar code.
- Existing analysis callers of `GetDataCoverage` read only `cov.latest` over a 10-day probe
  (`servicer.py:4231`, `:4325`, `:6503`).

### Bar arrival without this feature

- Daily bars are ingested only for an in-memory, demand-driven warm set that is lost on restart
  (`marketdata_service.go:1214`, `:1338`, `:1414`). A symbol nobody reads gets no daily bar.
- The ingester also writes the forming daily bar during the session; coverage presence is by date.
- No constant or comment states when the vendor publishes the final daily bar after the close.

### Backfill

- `TriggerBackfill` is asynchronous and persists a job; a multi-symbol request is one job
  (ingest `servicer.py:525-603`, `:573`). With `GAPS_ONLY` and no gaps the job is `COMPLETED` at
  once (`:850-868`).
- Authorization: the admin bit in `x-access-scope` (`:431-436`), or the self-serve envelope, which
  requires one symbol, bars, gaps-only, range of at most 730 days and a real `x-user-id` that is
  not `system` (`:457`). No grant lets a `system` caller trigger a backfill.
- Dedup exists only for self-serve (per-symbol advisory lock, `ALREADY_EXISTS`, `:605`). Admin
  requests are never de-duplicated (`:589-590`).
- Status: `GetBackfillStatus` and `ListBackfillJobs` have no ownership check; there is no streaming
  status. `callback_url` posts a webhook through notify's origin allowlist (`:566-570`).
- Concurrency: 3 jobs, 3 chunks per job (`backfill.max_concurrent_jobs`,
  `backfill.max_concurrent_chunks`).
- Outcomes: `EMPTY` and `SKIPPED` leave the job `COMPLETED` with the symbol in `symbol_results`;
  `FAILED` or `INCOMPLETE` make it `PARTIAL`; no progress makes it `FAILED` (`:961-981`).
  `INCOMPLETE` comes from the verify pass for an interior hole the vendor did not fill
  (`:897-959`). A head gap counts only if bars exist in the 730 days before it (`:314`).
- Side effects per job: four ledger events (`ingest.backfill.*`) and a notify alert on `FAILED` or
  on `PARTIAL` with failed work (`:591`, `:706`, `:861`, `:994-1024`).
- Restart: interrupted jobs are marked `FAILED` then re-driven (`app/main.py:71`, `:1034`).
- `BackfillBars` on marketdata is ungated but synchronous, and only ingest calls it
  (ingest `servicer.py:1136`).

### Fundamentals

- On the EDGAR axis `GetFundamentals` never calls the SEC. A hit needs a cache row younger than
  `edgar.cache_ttl_hours` (24); a miss re-derives the snapshot from stored historical periods and a
  live price (`marketdata_service.go:2096-2132`). New filings arrive only through
  `BackfillFundamentals`, which ingest drives with `data_kind=FUNDAMENTALS`. `edgar.rate_limit_rps`
  throttles that client, not the read path.
- The pure EDGAR path never sets `stale=true`. `stale=true` comes from the vendor path at quota
  with a stored row; at quota with no row the call returns ResourceExhausted (`:1982`).
- A non-filer falls back to the vendor when one is enabled, otherwise NotFound (`:2112-2125`).
  With `edgar.enabled=false` the call returns FailedPrecondition.
- `GetFundamentalsMulti` omits a NotFound symbol but any other error aborts the whole batch; it has
  no per-symbol error field (`:1859-1908`).
- `snapshot_source` is read in one place, `snapshotSource()` (`:2044`), with the default constant
  at `:2036-2039` and an unknown-value fallback to vendor at `:2051-2053`. No other service reads
  the key.

### Config

- `default_value` is documentation: services use the call-site default, the UI shows it beside the
  current value, and there is no reset-to-default action (config `CLAUDE.md`, CONFIG-2). Its one
  machine consumer is `scripts/check-config-wiring.mjs:538-544`, `:651`, which reports
  `default-mismatch` when a reader's literal default differs from a stored `default_value`.
- Stored key today: namespace `marketdata`, key `fundamentals.snapshot_source`, `default_value`
  `vendor` in both environments (`scripts/config-wiring-stored.json:3628-3649`).
- Live values: both staging deployments hold `edgar`; the repo inventory shows production equal to
  the seeded default (`scripts/config-heal/inventory-staging.jsonl:150-151`).
- A new migration makes `scripts/config-wiring-stored.json` stale (it hashes the whole config
  migration set, `check-config-wiring.mjs:221-231`); `scripts/config-heal/catalog.tsv:139` holds
  the key's code default.
- `job_graph.py:self._cfg` is already a registered receiver, so a new `JobGraphSettings` accessor
  needs no `scripts/config-wiring.json` entry; a reader in a new file would.

## Patterns to REUSE

- Daily ensure across instances → the `_ensure_prune` shape: per-day marker, idempotent enqueue,
  called from `maintenance_tick` (analysis `app/engine/job_graph.py:725`, `:753`).
- Run id and epoch helpers → `prune_run_id` / `prune_epoch` (`app/engine/job_graph.py:61-71`).
- Handler factory → `make_handler(settings, *, monotonic=...)` (`app/jobs/retention_prune.py:17`).
- Kill-switch accessor → `JobGraphSettings.worker_enabled` (`app/engine/job_graph.py:207-208`).
- Held-position drain → `_drain_positions_paged` (imported at `app/engine/live_loop.py:42`); do not
  add a third copy of the watchlist or signal drains (`live_loop.py:591`, `:539` vs
  `servicer.py:6343`, `:6735`).
- Background per-owner identity → `owner_metadata(owner)` plus a fresh `x-trace-id`
  (`app/identity.py:11`; `servicer.py:3845-3847`).
- System-read identity → `_SYSTEM_READ_META` (`live_loop.py:78`).
- Interior-hole and trailing-edge detection → marketdata `GetDataCoverage` gaps
  (`marketdata_service.go:573`); gaps-only planning and the verify pass → ingest
  (`servicer.py:793-827`, `:897-959`).
- Telemetry → module-level instrument plus `record_*` helper with a closed label set
  (`app/telemetry.py:428-435`, `:566`); no `symbol` or `user_id` labels.
- Config seed → `061_analysis_pipeline_keys.up.sql:5-12`, `:43` and its guarded down `:4-14`; seed
  test `config/src/__tests__/analysisPipelineKeysSeedMigration.test.ts`.
- `default_value`-only change → the 041 sync shape, with audit row
  (`config/migrations/041_heal_config_keys_to_reader_catalog.up.sql:482-517`).
- Timer-driven tests → the `virtual_time` fixture and in-memory repository
  (`tests/test_job_graph_worker.py`); real Postgres through `local_pg` and `pipeline_pg`
  (`tests/conftest.py:440`, `:516`).
- Trading calendar → `packages/proto/marketsession` (Go); no second holiday table.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @AC-2 @AC-3 @AC-4 @feature-367` enqueue idempotency, fenced lease, takeover,
  stale-report rejection (`services/xstockstrat-analysis/acceptance/pipeline-job-graph.feature`).
- **PRESERVE** `@AC-5 @AC-6 @AC-7 @feature-367` retry, permanent failure, dead after `max_attempts`
  (same file) — a dead child must leave no `covered` record and no bar record.
- **PRESERVE** `@AC-8 @feature-367` "A parent parks until its child succeeds" (same file).
- **PRESERVE** `@AC-9 @feature-367` "An unsatisfiable child blocks its parent for good" (same file)
  — the blocked parent's handler never runs again, so it cannot write the `no_vendor_data` record.
- **PRESERVE** `@AC-10 @AC-12 @AC-13 @AC-18 @feature-367` lane order, retention, queue metrics.
- **EXTEND** `@AC-11 @feature-367` "Jobs are grouped by universe run" — data jobs carry the run id.
- **EXTEND** `@AC-15 @feature-367` "The daily prune runs once across instances" — the universe run
  needs the same once-per-session guarantee.
- **PRESERVE** `@AC-14 @AC-16 @AC-17 @feature-367` kill-switch scenarios — `worker_enabled=false`
  stops everything; `data_stage_enabled` is an additional gate.
- **PRESERVE** `@FR-2 @regression @feature-367` boot tasks through `spawn`; `@FR-8 @regression
  @feature-367` `host.provider` on pipeline instruments.
- **EXTEND** `@FR-9 @regression @feature-367` pipeline keys seeded in both environments
  (`services/xstockstrat-config/acceptance/pipeline-job-graph.feature`).
- **EXTEND** `@AC-14 @feature-295`; **PRESERVE** `@AC-24 @AC-29 @feature-295`
  (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`) — a stored value that
  differs from the code default is not retyped.
- **PRESERVE** `@AC-4 @AC-10 @feature-255`
  (`services/xstockstrat-marketdata/acceptance/fix-marketdata-fundamentals-cache.feature`) — set
  `vendor` explicitly.
- **PRESERVE, depends on the old default** `@AC-1 @AC-2 @AC-3 @AC-5 @AC-6 @AC-9 @feature-255` (same
  file); `@AC-2 @AC-4 @feature-340` (`.../fix-fundamentals-roe-unit.feature`); `@AC-1 @AC-2 @AC-5
  @AC-7 @feature-254` (`.../fix-marketdata-secret-exposure.feature`). These never name
  `snapshot_source`. With no stored row the new default sends them down the EDGAR path. Either
  their Givens are pinned to `vendor`, or the operator signs a CHANGE row.
- **PRESERVE** `@AC-4 @AC-10 @feature-231`, `@AC-7 @feature-215`, `@AC-6 @AC-7 @feature-211`
  (marketdata suites) — explicit `edgar`; NotFound and FailedPrecondition must read as fundamentals
  `unavailable`, never fail a data job.
- **PRESERVE** `@AC-1 @AC-2 @AC-3 @AC-4 @feature-364`
  (`services/xstockstrat-ingest/acceptance/fix-gapsonly-backfill-is.feature`) — an unfillable
  interior hole is `PARTIAL` with `incomplete`; a head gap with no prior bars is `COMPLETED`.
- **PRESERVE** `@AC-7 @AC-15 @feature-343` (`.../backtest-inline-backfill.feature`) — the
  self-serve envelope and its `no_user` denial. **CHANGE** if the design adds a system or admin
  grant for the data job (needs operator sign-off).
- **PRESERVE** `@AC-2 @AC-3 @feature-261` (`.../fix-ingest-poller-backfill.feature`) — a canceled
  backfill is final and is not a success.
- **PRESERVE** `@AC-9 @AC-11 @AC-23 @AC-26 @feature-352`
  (`services/xstockstrat-marketdata/acceptance/delisted-symbol-handling.feature`) and `@AC-7 @AC-10
  @feature-352` (portfolio suite) — a flagged symbol ends `SKIPPED` with the job `COMPLETED`, and
  stays on a user's list.
- **PRESERVE** `@AC-1 @AC-2 @feature-154`
  (`services/xstockstrat-portfolio/acceptance/fundsignal-watchlist-universe.feature`) —
  `ListAllWatchlistSymbols` stays gated to `analysis-fundsignal`. A new per-user read would be an
  EXTEND with its own gate.
- **PRESERVE** `@AC-1 … @AC-10 @feature-356`
  (`services/xstockstrat-analysis/acceptance/fix-analysis-held-position-drains.feature`) and `@AC-2
  @feature-180` — reuse the one drain; legacy loops read what they read today.
- **PRESERVE** `@AC-3 … @AC-9 @feature-154`, `@AC-1 @AC-2 @AC-3 @AC-7 @AC-8 @AC-9 @feature-158`,
  `@AC-1 … @AC-4 @feature-259` (analysis suites) — fundsignal loop, opportunity refresh, readiness
  materializer and loop supervision unchanged.
- **PRESERVE** `@AC-7 @AC-41 @feature-294`, `@AC-3 @feature-337`, `@AC-36 @feature-279`
  (`docs/sdd/business-rules/platform.feature`) — at most 8 loop names per service, no identifier
  labels, `host.provider` on every instrument, direct-pool budget.
- No durable marketdata scenario pins `GetDataCoverage`.

## Dependencies

- Proto/RPC: consumed as they are — marketdata `GetDataCoverage`
  (`packages/proto/marketdata/v1/marketdata.proto:173`, response `:186`), `GetFundamentals`
  (`:254-268`); ingest `TriggerBackfill`, `GetBackfillStatus`, `ListBackfillJobs`
  (`packages/proto/ingest/v1/ingest.proto:13-17`, request `:79-90`, job `:33-51`); portfolio
  `ListPositions`, `ListWatchlists` (`packages/proto/portfolio/v1/portfolio.proto:14`, `:23`);
  `BackfillSymbolOutcome` (`packages/proto/common/v1/common.proto:156-162`). Possible additive
  change: a way for analysis to learn the last closed session (none exists).
- Migration: analysis next `032`; config next `062`; marketdata next `011`, ingest next `019`,
  portfolio next `020` if the design touches them.
- Config keys: new `analysis` / `pipeline.data_stage_enabled`; changed default on `marketdata` /
  `fundamentals.snapshot_source`.
- Inter-service edges: analysis → marketdata (existing), analysis → portfolio (existing), analysis
  → ingest `QuerySignals` (existing); analysis → ingest `TriggerBackfill` / `GetBackfillStatus`
  would be new calls on an existing edge.
- New env vars / ports: none.

## Risks / Not-found

- **Who writes `no_vendor_data`.** A parent blocked by a child verdict never runs again
  (367 `@AC-9`). FR-8 requires a coverage record with that verdict.
- **`INCOMPLETE` and other outcomes.** FR-5 maps only `EMPTY` and `SKIPPED`. `INCOMPLETE`
  (`PARTIAL` job), `FAILED`, `CANCELED` and a backfill re-driven after an ingest restart have no
  stated mapping.
- **Backfill identity.** No identity lets a job with no end user call `TriggerBackfill`. The
  choices each cost something: impersonate an owner through the self-serve envelope (one symbol per
  job, dedup for free, about 4 ledger events per symbol), carry the admin bit (no dedup, widens
  what a background job may do), or add a SAN-bound grant in ingest (changes 343 `@AC-15`).
- **Backfill load.** Three concurrent ingest jobs. About 1,000 one-symbol jobs at the close would
  queue behind each other and write about 4,000 ledger events.
- **Fundamentals refresh meaning.** On the EDGAR axis a read does not fetch new filings; only a
  fundamentals backfill does. FR-6's "refreshes when older than the freshness window" needs a
  defined mechanism, and the `fresh` / `stale` / `unavailable` states need a mapping from what
  `GetFundamentals` returns (`as_of` is the filing date on the EDGAR path).
- **Users without strategies.** The only background owner list is `analysis.strategies`. FR-1 says
  "every user"; a user with positions and no strategy is invisible to it.
- **Signals scope.** System-scope signals belong to no user; whether they join every user's
  universe is not stated in the spec.
- **Late bar.** After 16:00 New York the session counts as closed while its final bar may not have
  arrived, and the forming bar written during the session passes the by-date presence check.
- **Calendar reach.** Closures after 2025-01-09 and early closes are not modelled; no non-Go access
  to the calendar exists.
- **Dead child key.** A `dead` backfill child blocks its parent and stays for 30 days; the next
  session's job uses a new epoch, so it is not blocked by it.
- **Lane upgrade.** An existing job keeps its lane; a symbol first enqueued as `watchlist` is not
  promoted if a holder appears later in the same session.
- **Handler DB gate.** One handler DB block at a time per instance, on the shared 2-connection
  service pool.
- **`pipeline_pg` test fixture.** It asserts no other migration mentions `pipeline_job`
  (`tests/conftest.py:520-525`); a 032 migration with a foreign key to the job table breaks it.
- **Vendor-default tests.** About 40 Go tests in `marketdata_service_test.go` (roughly lines
  389-1012 and 4863-5085) and the durable scenarios listed above rely on the `vendor` default. The
  classification is inferred from the absence of an explicit setting, not traced line by line.
- **Docs stating the default.** marketdata `CLAUDE.md:86`, `docs/patterns/config-governance.md:619`,
  marketdata `docs/fundamentals.md:14`, `scripts/config-heal/catalog.tsv:139`.
- Ledger traps that apply: feature 129 (literal-key audit on a provider change); feature-100 bool
  zero-value; fix-python-loop-supervision (a guard must wrap the whole loop body);
  delisted-symbol-handling (give cross-service derived state exactly one decider; state any
  cross-service tick a scenario depends on); pipeline-job-graph (state a bound as the invariants
  that produce it; plan review lenses up front).
- Not found: a generic periodic-job API; a child-outcome accessor for handlers; a cross-user
  positions or signals read; a system-callable user list; a Python calendar; a statement of when
  the vendor's final daily bar is available; a per-call gRPC timeout convention in analysis; an
  `ANALYSIS-*` invariant covering job handlers; a per-key `default_value`-only migration precedent.

## Recommended Scope

Advisory, for the debate and `/sdd-spec`:

1. Config: seed `pipeline.data_stage_enabled`; change `fundamentals.snapshot_source`
   `default_value`; regenerate the stored-set snapshot; catalog and docs.
2. Marketdata: flip the code default and the fallback; pin the vendor-default tests and scenarios;
   whatever the design chooses for the last closed session.
3. Analysis migration `032`: snapshot, coverage record, bar record.
4. Analysis: one shared universe read; the universe-run job kind and its daily ensure.
5. Analysis: the data job kind, the backfill child kind, fundamentals step, coverage and bar
   record writes.
6. Analysis: telemetry, kill switch, retention for the new tables, docs.
7. Ingest and portfolio: only what the design proves is missing.
