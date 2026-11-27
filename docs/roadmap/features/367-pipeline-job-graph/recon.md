# Recon: pipeline-job-graph

**Created**: 2026-11-27
**From**: product-spec.md
**Tree**: ccr-fe135a59-nyslbm@eda1880 ≡ origin/main-dev
**Affected services**: `xstockstrat-analysis`, `xstockstrat-config`

---

## Objective

Add a durable, multi-instance-safe job graph and worker runtime inside `xstockstrat-analysis`:
keyed idempotent jobs, fenced leases, classified retries, park-and-wake dependencies, lanes, a run
id and queue telemetry. Its only production job kind is a daily retention prune of its own tables.
No existing loop moves and no RPC response changes.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Entry point: `services/xstockstrat-analysis/app/main.py:55-62` creates the asyncpg pool
    (`min_size=1`, `max_size=int(DB_POOL_MAX or "2")`, `statement_cache_size=0` when
    `DB_PGBOUNCER` is true). Background tasks start only `if db_pool is not None` (`:127`).
  - Loop startup: `spawn(coro, "name", forever=…)` at `main.py:144,168,175,197,214,218,224,228`;
    the last is the template-intent sweep (`:228`), before `grpc_server.wait_for_termination()`
    (`:231`).
  - Shutdown: `handle_shutdown` (`main.py:120`) only stops the gRPC server; no task cancel, no
    pool close.
  - Supervision: `app/supervision.py:16` `spawn`, `:40` `retry_until_ok`, `:55` `run_supervised`;
    fixed `_LOOP_ERROR_BACKOFF_SECONDS = 30` (`:10`). Both helpers catch `Exception` only.
  - Last migration: `030_opportunity_compute_state_live_only_cursor` → next is `031`. Tables are
    plain (only `016` uses `create_hypertable`).
  - Config-read pattern: `ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="analysis")`
    (`main.py:43`), passed as `config_watcher=cfg_watcher`; `int_positive` at
    `app/config/watcher.py:72`; bool via `get_bool(key, default)` at `app/config/watch_core.py:223`.
  - Existing scheduler (must stay disjoint): `app/engine/durable_schedule.py:32` `DurableSchedule`,
    table `analysis.job_schedule` (`migrations/020_job_schedule.up.sql:8-11`).
  - Telemetry: `app/telemetry.py:404` `Loop` StrEnum (5 members), `:414` `log_tick_ok`, wrappers
    `Counter` (`:325`), `Histogram` (`:341`), `Gauge` (`:365`).
- **`xstockstrat-config`** (Node.js)
  - Last migration: `059_trading_broker_paper_per_environment` → next is `060`.
  - Bounds registry: `SCALAR_BOUNDS_REGISTRY` at
    `services/xstockstrat-config/src/grpc/configServiceImpl.ts:115`; cross-key ordering
    `CROSS_KEY_ORDERING` at `:202` (deadline keys only).

## Patterns to REUSE

- Start the worker task → `supervision.spawn(coro, name, forever=True)`
  (`app/supervision.py:16`; call sites `app/main.py:144-228`). ANALYSIS-15 requires boot tasks to
  use it.
- Repository shape → class taking `db_pool` positionally with an `asynccontextmanager`
  `transaction()` and methods accepting `conn=None`
  (`app/repositories/opportunities.py:82,86-90,92`).
- Row locking precedent → `SELECT … FOR UPDATE` inside `acquire()` + `transaction()`
  (`app/repositories/strategies.py:119-122`).
- Transient DB error classification → `is_transient_db_error` and `_TRANSIENT`
  (`app/repositories/read_budget.py:17,31`).
- Poison classification precedent → positive allow-list `_POISON`, anything unlisted is replayed
  (`app/engine/pnl_pattern_consumer.py:63-77`). Same default direction as FR-3.
- Int config reads → `int_positive(cfg, key, default)` (`app/config/watcher.py:72`), already a
  registered forwarder in `scripts/config-wiring.json`. Bool reads →
  `self._cfg.get_bool("fundsignal.enabled", default=False)`
  (`app/engine/fundsignal_loop.py:147`).
- Live-resizable concurrency bound → `ResizableLimiter` (`app/config/live_limits.py:12`) wired by
  `_live_limit` + `self._cfg.on_change(lim.wake)` (`app/handlers/servicer.py:544-546,590`).
  PLAT-16 forbids a `Semaphore(n)` built once. `live_limits.py` is byte-identical across three
  services (`scripts/check-watcher-copies.py`); do not edit it.
- Loop tick record → add a `Loop` member and call `log_tick_ok` (`app/telemetry.py:404,414`).
- Counters → module-level `Counter(...)` plus a `record_x(outcome)` helper with `KEY_*` label
  constants (`app/telemetry.py:423-507`); extend `tests/test_telemetry_allowlist.py:16-46`.
- Migration layout → header comment, `CREATE TABLE IF NOT EXISTS analysis.<t>`,
  `idx_<t>_<cols>` / `uidx_…` index names, `DROP TABLE IF EXISTS` down
  (`migrations/022_readiness_cache.up.sql:8`, `023_opportunity_compute_state.up.sql:8`,
  `011_opportunities.up.sql:24`, `016…:51`).
- Config seed → copy `services/xstockstrat-config/migrations/056_analysis_live_only_cycle_max_days.up.sql:4-13`
  and its `.down.sql:4-10`: two rows (staging, production), relative key, `'int'` / `'bool'`
  value types, `ON CONFLICT … DO NOTHING`, guarded `DELETE` down.
- Seed-migration test → `services/xstockstrat-config/src/__tests__/liveOnlyCycleMaxDaysSeedMigration.test.ts`;
  bounds test → `setConfigScalarBounds.test.ts`.
- Real-Postgres tests for the claim, lease and fencing SQL → the `local_pg` fixture and
  `pytest.mark.real_pg` (`services/xstockstrat-analysis/tests/conftest.py:439`,
  `tests/test_read_budget_real_pg.py:20`).
- Stopping a loop in tests → a local `BaseException` subclass
  (`tests/test_loop_supervision.py:16`).
- Test fixture home (C-13) → `services/xstockstrat-analysis/tests/conftest.py`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @AC-2 @AC-3 @AC-7 @AC-8 @AC-9 @feature-158`
  (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`) — `DurableSchedule`
  and `analysis.job_schedule` semantics stay unchanged and disjoint from the job graph.
- **PRESERVE** `@AC-1 @AC-2 @AC-3 @AC-6 @AC-7 @AC-9 @AC-10 @feature-259`
  (`services/xstockstrat-analysis/acceptance/fix-python-loop-supervision.feature`) — existing loops
  and the P&L consumer keep their supervision, retry and park behavior.
- **EXTEND** `@AC-4 @FR-2 @feature-259` "Analysis keeps a reference to every background task and
  logs an unexpected exit" (same file) — the worker starts through `supervision.spawn`.
- **PRESERVE** `@AC-5 @FR-3 @feature-259` "A config watcher reconnects after a non-gRPC exception"
  (`docs/sdd/business-rules/platform.feature`).
- **EXTEND** `@AC-1 @AC-4 @AC-6 @feature-244` (`platform.feature`) — stored-zero and unset-default
  getter rules apply to the six new keys.
- **EXTEND** `@AC-14 @FR-5 @feature-295` "Every read key has a complete seed row in both
  environments" (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`).
- **PRESERVE** `@AC-1 @FR-1 @feature-296`
  (`services/xstockstrat-config/acceptance/fix-config-keys-contract.feature`) and
  `@AC-6 @AC-24 @feature-296`, `@AC-1 @AC-2 @AC-3 @feature-278`, `@AC-13 @AC-19 @feature-295`
  (`platform.feature`) — relative stored keys, a reader for every seed, a seed for every read.
- **PRESERVE** `@AC-7 @FR-2 @feature-294` (`platform.feature`) — at most 8 fixed loop names per
  service (analysis has 5) and no user, symbol or order identifiers in loop attributes.
- **EXTEND** `@AC-3 @FR-1 @feature-337` "Non-RPC instruments are labeled too" (`platform.feature`)
  — new instruments carry `host.provider`.
- **PRESERVE** `@AC-4 @FR-4 @feature-176`
  (`services/xstockstrat-analysis/acceptance/analysis-concurrency-offload.feature`) — the worker
  must not block the event loop.
- **PRESERVE** `@AC-2 @FR-2 @feature-274` (`platform.feature`) — no RPC response or status changes.
- No CHANGE found. No existing scenario guards the analysis pool size, lease fencing or
  deploy-overlap behavior; this feature's own scenarios carry those guards.

## Dependencies

- Proto/RPC: none.
- Migration: `031` for `services/xstockstrat-analysis/migrations/`; `060` for
  `services/xstockstrat-config/migrations/`. Run order is config first, analysis last
  (`docs/patterns/database.md:35`; `scripts/db-migrate.sh:150-175`).
- Config keys (new, namespace `analysis`, stored relative): `pipeline.worker_enabled`,
  `pipeline.worker_concurrency`, `pipeline.poll_interval_ms`, `pipeline.lease_seconds`,
  `pipeline.max_attempts`, `pipeline.retention_days`.
- Config governance work the keys trigger:
  - `SCALAR_BOUNDS_REGISTRY` entries for the int keys (`configServiceImpl.ts:115`; enforced at
    `SetConfig` only; bools need none).
  - A `registry.receivers` entry in `scripts/config-wiring.json` for the new reader file
    (`:78-89`), otherwise the reads are `unattributed`.
  - Regenerated `scripts/config-wiring-stored.json` (CI job `config-wiring-stored`,
    `.github/workflows/ci.yml:1444-1487`; needs a migrated database).
  - A `### feature 367` entry at the top of the per-feature log in
    `docs/patterns/config-governance.md:148` and six rows in
    `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed (L211).
- Database access: analysis is pooled through PgBouncer in transaction mode with pool `size` 5
  (`docs/patterns/database.md:152,185`); `DB_POOL_MAX` is unset, so the client pool is 2
  (`:175-180`; `.do/app.yaml:326-332`; `deploy/homelab/compose.yml:21-22,257-284`).
  `LISTEN`/`NOTIFY`, session advisory locks and prepared statements do not work through the pooler
  (`database.md:160-172`).
- Deployment: `instance_count: 1` for analysis in `.do/app.yaml:282-290` and
  `.do/app.dev.yaml:282-290`. A DigitalOcean rolling deploy runs the old and new instance
  concurrently (`database.md:140-142`); homelab compose stops before it starts
  (`docs/patterns/observability.md:131`).
- Inter-service edges: none new.
- New env vars / ports: none.

## Risks / Not-found

- **No prior `SKIP LOCKED` or advisory-lock use in analysis.** Only a plain `FOR UPDATE`
  (`strategies.py:122`). The claim path is greenfield in this service.
- **No doc covers `SKIP LOCKED` or transaction-level advisory locks through PgBouncer.**
  `database.md` rules out only session-level locks. Both are transaction-scoped and should work,
  but the claim is unverified until a real-Postgres test runs through the pooler settings.
- **Pool contention (F-06).** Client pool 2 with `worker_concurrency` 4, heartbeats, the claim poll
  and the existing loops and RPC reads all share it. No guard scenario exists.
- **`Gauge` carries no attributes** (`telemetry.py:365`: one callback, one `Observation`) and is
  unused in production code. FR-8 wants depth and age per lane.
- **Loop-name budget.** 5 of 8 names are used (`@AC-7 @feature-294`).
- **No injected clock and no UTC calendar-day helper.** `durable_schedule.py:20,25,52` uses
  `datetime.now(UTC)`; no existing SQL uses database time for a claim.
- **Instance clocks.** Lease expiry compared against an instance clock would let skew between two
  instances shorten or extend a lease.
- **No vacuum or bloat guidance** exists for a high-churn table on the shared cluster.
- **No shutdown path** cancels tasks or closes the pool (`main.py:120`); a job in flight at
  shutdown is recovered only by lease expiry.
- **No test fixture for job rows** exists in `tests/conftest.py`. The conftest fakes (`FakeConn`,
  `:204`) assert a read-only transaction and do not fit claim writes.
- **Config-wiring stored set** must be regenerated against a migrated database; the local path for
  that was not located beyond the CI job.
- Ledger traps that apply:
  - 2026-08-26 fundsignal entries (`insights.md`): a lease taken before a crash wedged the schedule
    for the full hold. D-11 reverses the no-lease ruling; heartbeat expiry must bound the wedge.
  - fix-offline-book-consistency (`fails.md`): `except: log` plus a monotonic cursor lost events.
  - fix-python-loop-supervision (`fails.md`): the guard covered only the cycle body, and the
    `except` handler itself did unguarded DB I/O.
  - fix-python-loop-supervision (`insights.md`): a hang raises nothing, so a supervisor cannot see
    it; use `acquire(timeout)` and per-query timeouts.
  - readiness-materializer-config-keys, fix-analysis-live-loop-budget-seed (`fails.md`): keys
    double-prefixed, seeded but unread, or seeded twice.
  - fix-mcp-deadline-budget (`fails.md`): a bound mandated "from measured p99" with no metric.
  - fix-analysis-per-symbol-isolation (`fails.md`, 2026-11-26): find every test that pins a
    behavior with a repo-wide grep before a step changes it.

## Recommended Scope

Advisory step boundaries:

1. Config seed migration `060`, bounds registry entries and their tests (config service).
2. Analysis migration `031`: job table, dependency-edge table, indexes.
3. Job repository: enqueue, claim, heartbeat, complete, fail, park and wake, list by run, prune.
   Real-Postgres tests.
4. Settings reader (`JobGraphSettings`) and the config-wiring registry entry.
5. Worker runtime: poll loop, concurrency bound, heartbeat, error classification, handler registry.
6. Retention-prune job kind and its daily ensure.
7. Telemetry: loop record, counters, per-lane depth and age.
8. Startup wiring in `main.py`.
9. Docs: analysis `CLAUDE.md`, config-governance log, regenerated stored set.
