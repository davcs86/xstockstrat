# Implementation Spec: fundamentals-signal-producer

**Status**: `pending`
**Created**: 2026-06-27
**Feature**: `docs/roadmap/features/062-fundamentals-signal-producer/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/fundamentals-signal-producer`

---

## Execution Summary

This feature adds a scheduled "fundamentals signal producer" to `xstockstrat-analysis`: a daily
asyncio background task (mirroring `app/engine/live_loop.py`) that builds a deduplicated symbol
universe, reads cached fundamentals **only** via marketdata `GetFundamentalsMulti`, scores each
symbol, maps the score to a `buy`/`sell`/`hold` direction by cross-sectional quantile, and emits an
`ExternalSignal` per symbol through ingest's `IngestSignal` RPC — plus a manual `RunFundamentalsScan`
RPC. Order: proto first (additive RPC) → gen stubs → DB migrations (run-state + idempotency guard) →
config keys (seed migration) → the producer module + universe/scoring/budget logic + main.py wiring →
the `RunFundamentalsScan` handler → tests → docs. The producer **never** calls FMP; the
idempotency guard lives in analysis's own `fundsignal_emitted` table because ingest's `IngestSignal`
does **not** dedup.

## Hard Upstream Dependencies (must merge first)

Confirmed by discovery — **the fundamentals data path and watchlists do not exist in committed code today**:

- **Feature 059 `fundamentals-data-source`** (`implementation-ready`, branch `feature/fundamentals-data-source`):
  provides the `GetFundamentalsMulti` RPC, the `marketdata.fundamentals` table, the 24h cache, and the
  `marketdata.fmp.*` config keys (incl. `marketdata.fmp.daily_request_cap` default 250). None of its 11
  steps are executed. The producer's "cache-mediated read" (FR-2) binds `stub.GetFundamentalsMulti`,
  which is generated only after 059 Step 2 regenerates the marketdata Python stubs.
  Evidence: `docs/roadmap/features/059-fundamentals-data-source/implementation-spec.md:56,59,63-82,156-176,238-243`;
  `packages/proto/marketdata/v1/marketdata.proto:12-35` (no fundamentals RPC today).
- **Feature 058 `watchlist-management`** (spec-only): provides the watchlist tables/RPCs. **Caveat:**
  058's `ListWatchlists` is **user-scoped** (`x-user-id`), so it cannot return the *global* union of all
  users' symbols that FR-3 requires. See Step 8 for the resolution (read `portfolio.watchlist_symbols`
  via a global RPC, OR fall back to `universe_source=explicit` until 058 ships a global variant).
  Evidence: `docs/roadmap/features/058-watchlist-management/product-spec.md:10-11,22-26,77-84`;
  no `watchlist` token in `services/xstockstrat-portfolio` or `portfolio.proto`.

`docs/roadmap/features/merge-order.md` already sequences 059 + 063 ahead of 062 (058 optional).

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the new RPC.
- Step 5 (config migration) is independent but should land before Step 6/9 so the producer reads real keys.
- Step 6 (producer module) requires Step 2 (needs the `RunFundamentalsScanRequest`/`FundamentalsScanSummary`
  + `GetFundamentalsMulti` stubs from 059) and Steps 3–4 (run-state + idempotency tables).
- Step 7 [test] covers Step 6 [service].
- Step 8 (universe/scoring/budget helpers) is part of the same producer module as Step 6; split for
  reviewability — Step 6 wires the loop, Step 8 implements the pure helpers it calls.
- Step 9 (`RunFundamentalsScan` handler) requires Step 2 (proto stubs) and Step 6 (the producer it invokes).
- Step 10 [test] covers Step 9 [service].
- Step 11 (config rollout) requires Step 5 (the keys must exist before rollout).
- Step 13 (ingest `derived` source_type migration) must be applied **before** Step 8's
  `_ensure_source_registered()` runs — the `derived` value must exist in the CHECK or the source upsert
  fails the constraint. It is an independent, cross-service (ingest-owned) migration with no dependency on
  Steps 1–12, so it can be executed early; sequence it ahead of the first producer run.
- Step 12 (docs) last — reflects all of the above (incl. the new ingest `derived` source_type).

---

### Step 1 — proto: Add `RunFundamentalsScan` RPC to analysis.proto

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — additive RPC, field-number uniqueness, `buf lint`/`buf breaking` pass;
`xstockstrat-analysis` (service owner) — RPC shape matches the scheduler/producer it triggers

**Codebase Evidence**:
- Service block confirmed at `packages/proto/analysis/v1/analysis.proto:11-20`; last RPC is
  `rpc SetStrategyLive(SetStrategyLiveRequest) returns (SetStrategyLiveResponse);` at line 19.
- Package `xstockstrat.analysis.v1` (`analysis.proto:3`); imports already include
  `google/protobuf/timestamp.proto` (`:7`) and `common/v1/common.proto` (`:9`).
- Highest existing field number in the file is `13` (`BacktestResult.coverage_gaps = 13`, `:63`) —
  new messages start their own field numbering at 1, so no collision risk.
- **Cross-feature coordination**: feature 060 (`ScreenSymbols`) also extends this same file additively
  (`docs/roadmap/features/062-.../context.md:36`). Append `RunFundamentalsScan` after `SetStrategyLive`;
  do not assume any 060 message exists. New messages use distinct names (`RunFundamentalsScanRequest`,
  `FundamentalsScanSummary`) — confirmed absent today (grep `RunFundamentalsScan` matches only 062 spec docs).

**Instructions**:
1. Add one RPC line to the `AnalysisService` block (after line 19, before the closing `}` at line 20):
   `rpc RunFundamentalsScan(RunFundamentalsScanRequest) returns (FundamentalsScanSummary);`
2. Add two new messages at the end of the file (field numbering starts at 1 per message):
   - `RunFundamentalsScanRequest` with: `bool force = 1;` (ignore the day's idempotency guard / re-emit),
     `bool dry_run = 2;` (score + report but do not emit or spend cache calls), `repeated string symbols = 3;`
     (optional explicit override of the computed universe).
   - `FundamentalsScanSummary` with: `string run_id = 1;`, `int32 symbols_processed = 2;`,
     `int32 signals_emitted = 3;`, `int32 calls_spent = 4;`, `int32 deferred_count = 5;`,
     `string status = 6;` (e.g. `"completed"` | `"budget_deferred"`), `google.protobuf.Timestamp finished_at = 7;`.
3. This is admin-scoped at runtime (Step 9 enforces via `_has_admin_scope`); no proto-level option needed
   (matches `ManageSignalSource`'s runtime-only admin gate at `services/xstockstrat-ingest/app/handlers/servicer.py:858`).

**Verification**:
`cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/fundamentals-signal-producer"`
— both pass (additive RPC + new messages are non-breaking).

---

### Step 2 — proto-gen: Regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/analysis/v1/` — modify (generated)
- `packages/proto/gen/python/analysis/v1/` — modify (generated)
- `packages/proto/gen/ts/analysis/v1/` — modify (generated)

**Reviewers**: Proto Reviewer — inherited from Step 1; verify stubs match proto (`proto-freshness`)

**Codebase Evidence**:
- Codegen entrypoint is `./scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs).
- Python caller import form confirmed: `services/xstockstrat-analysis/app/handlers/servicer.py:23`
  `from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc` (the `gen.` namespace maps to
  `packages/proto/gen/python/`). The new analysis stub will be importable as
  `from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc`.

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Commit the regenerated Go/Python/TS stubs together with the Step 1 proto change in the same PR
   (per `docs/runbooks/proto-versioning.md` — proto source + generated stubs in one commit).

**Verification**:
`./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/` — empty diff (stubs are fresh,
matching the `proto-freshness` CI job).

---

### Step 3 — migration: `003_fundsignal_runs` (run-state / resumability + budget accounting)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/003_fundsignal_runs.up.sql` — create
- `services/xstockstrat-analysis/migrations/003_fundsignal_runs.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gap), up+down pair, index correctness;
`xstockstrat-analysis` (service owner) — run-state schema supports resumability + budget accounting

**Codebase Evidence**:
- Last existing migration is `002` — confirmed: `services/xstockstrat-analysis/migrations/` contains
  `001_strategies.up.sql`/`.down.sql` and `002_strategy_live_enabled.up.sql`/`.down.sql`. Next free is `003`.
- Schema prefix is `analysis.` with `IF NOT EXISTS`, e.g. `001_strategies.up.sql:1`
  `CREATE TABLE IF NOT EXISTS analysis.strategies (...)`; the `analysis` schema is assumed to already
  exist (002 is a bare `ALTER TABLE analysis.strategies ...`).
- Product-spec schema target: `product-spec.md:113-115`
  (`run_id uuid PK, started_at, finished_at, status, symbols_total, symbols_done, calls_spent, deferred_count`).

**Instructions**:
1. `003_fundsignal_runs.up.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS analysis.fundsignal_runs (
     run_id         uuid PRIMARY KEY,
     started_at     timestamptz NOT NULL DEFAULT now(),
     finished_at    timestamptz,
     status         text NOT NULL DEFAULT 'running',  -- running | completed | budget_deferred | failed
     symbols_total  int  NOT NULL DEFAULT 0,
     symbols_done   int  NOT NULL DEFAULT 0,
     calls_spent    int  NOT NULL DEFAULT 0,
     deferred_count int  NOT NULL DEFAULT 0
   );
   CREATE INDEX IF NOT EXISTS idx_fundsignal_runs_started_at
     ON analysis.fundsignal_runs (started_at DESC);
   ```
2. `003_fundsignal_runs.down.sql`: `DROP TABLE IF EXISTS analysis.fundsignal_runs;`
3. Match the `IF NOT EXISTS` style of `001_strategies.up.sql`. Do not create the `analysis` schema
   here (already created upstream, per the 001/002 convention).

**Verification**:
`./scripts/db-migrate.sh` applies cleanly, then `\d analysis.fundsignal_runs` shows the columns +
the `idx_fundsignal_runs_started_at` index; the `.down.sql` drops the table without error.

---

### Step 4 — migration: `004_fundsignal_emitted` (idempotency guard, FR-5)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/004_fundsignal_emitted.up.sql` — create
- `services/xstockstrat-analysis/migrations/004_fundsignal_emitted.down.sql` — create

**Reviewers**: DBA — uniqueness on `(symbol, source, as_of_date)`, up+down pair;
`xstockstrat-analysis` (service owner) — guard correctly enforces at-most-one-signal-per-day

**Codebase Evidence**:
- Next free after Step 3 is `004` (confirmed last on-disk is `002`).
- **Why analysis owns idempotency, not ingest**: ingest's `IngestSignal` has **no** DB UNIQUE
  constraint — `services/xstockstrat-ingest/migrations/001_newsletter_signals.up.sql:20`
  `PRIMARY KEY (id, ingested_at)` only; every `IngestSignal` INSERT creates a new row
  (`services/xstockstrat-ingest/app/handlers/servicer.py:658-665`, straight INSERT). The producer
  must therefore guard re-emits itself (FR-5, Acceptance #1).
- Product-spec schema target: `product-spec.md:116-118`.
- `ExternalSignal` has **no** `as_of_date` field (`packages/proto/ingest/v1/ingest.proto:105-115`);
  `as_of_date` here is analysis-local run-date bookkeeping, not a wire field.

**Instructions**:
1. `004_fundsignal_emitted.up.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS analysis.fundsignal_emitted (
     symbol      text   NOT NULL,
     source      text   NOT NULL,
     as_of_date  date   NOT NULL,
     signal_id   bigint,            -- the int64 returned by IngestSignalResponse.signal_id
     score       numeric,
     direction   text,              -- 'buy' | 'sell' | 'hold'
     run_id      uuid REFERENCES analysis.fundsignal_runs(run_id),
     PRIMARY KEY (symbol, source, as_of_date)
   );
   ```
2. `004_fundsignal_emitted.down.sql`: `DROP TABLE IF EXISTS analysis.fundsignal_emitted;`
3. The PK `(symbol, source, as_of_date)` is the idempotency guard: a re-run on the same `as_of_date`
   uses `INSERT ... ON CONFLICT (symbol, source, as_of_date) DO NOTHING` and, when no row is inserted,
   skips both the `IngestSignal` call and the cache read (Acceptance #1: re-running emits nothing new,
   spends zero FMP calls). `force=true` (Step 1) bypasses by deleting/upserting the day's rows first.

**Verification**:
`./scripts/db-migrate.sh` applies, then a duplicate INSERT for the same `(symbol, source, as_of_date)`
is rejected by the PK; `.down.sql` drops cleanly.

---

### Step 5 — config: Seed `analysis.fundsignal.*` keys via config migration

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/008_analysis_fundsignal_keys.up.sql` — create
- `services/xstockstrat-config/migrations/008_analysis_fundsignal_keys.down.sql` — create

**Reviewers**: `xstockstrat-config` (service owner) — key naming `<service>.<category>.<key>`,
dev+prod rows, `trading_mode='all'`; `xstockstrat-analysis` (service owner) — defaults match the
producer's reads

**Codebase Evidence**:
- Config keys are seeded via SQL `INSERT` migrations, not a code seed. Pattern + columns:
  `services/xstockstrat-config/migrations/003_analysis_signal_source_weights.up.sql:5-14`
  `INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value,
  consuming_service, environment, trading_mode) VALUES (...) ON CONFLICT ... DO NOTHING;` — two rows
  (dev + production), both `trading_mode='all'`.
- Last config migration on trunk is `005_ingest_backfill_chunking`. To avoid a three-way `006` collision
  in the shared `xstockstrat-config` migrations dir, this feature is pre-assigned **008** (058 keeps
  `006_watchlist_config`, 059 takes `007_marketdata_fmp`; see merge-order.md "Screener config-migration
  ordering"). Because golang-migrate applies in numeric order, this config migration must land after 058's
  `006` and 059's `007`.
- `analysis.signals.source_weights` already exists (`003_analysis_signal_source_weights.up.sql:8`) —
  **do not re-create it**; the producer reuses it (Step 8/11).
- **Namespace coordination with 063**: 063 may add `analysis.fundsignal.value_weight`/`quality_weight`.
  062 declares neither (context.md:38). Only seed the keys in `product-spec.md:95-106` here.

**Instructions**:
1. Seed the 12 keys from `product-spec.md:95-106`, each as a dev row + a production row
   (`environment` `'dev'`/`'production'`), `trading_mode='all'`, `consuming_service='xstockstrat-analysis'`,
   mirroring the column order and `ON CONFLICT ... DO NOTHING` of
   `003_analysis_signal_source_weights.up.sql`:
   - `analysis.fundsignal.enabled` bool `false`
   - `analysis.fundsignal.run_interval_hours` int `24`
   - `analysis.fundsignal.universe_source` string `watchlists`
   - `analysis.fundsignal.explicit_symbols` string `""`
   - `analysis.fundsignal.max_symbols_per_run` int `200`
   - `analysis.fundsignal.daily_call_budget` int `200`
   - `analysis.fundsignal.source_slug` string `fundamentals`
   - `analysis.fundsignal.scoring_formula_id` string `""`
   - `analysis.fundsignal.buy_quantile` float `0.80`
   - `analysis.fundsignal.sell_quantile` float `0.20`
   - `analysis.fundsignal.min_conviction_to_emit` float `0.0`
   - `analysis.fundsignal.valid_days` int `90`
2. `.down.sql`: `DELETE FROM config.config_values WHERE namespace='analysis' AND key LIKE 'fundsignal.%';`
   (Note: keys are stored split — namespace `analysis`, key `fundsignal.<rest>` — matching how
   `signals.source_weights` is stored at `003_analysis_signal_source_weights.up.sql:8`.)
3. The producer reads these via the `ConfigWatcher` typed getters with the **full** key string
   (`self._cfg.get_bool("analysis.fundsignal.enabled", default=False)`, etc.) — see Step 6.

**Verification**:
`./scripts/db-migrate.sh` applies; `SELECT namespace, key FROM config.config_values WHERE
key LIKE 'fundsignal.%';` returns 12 keys × 2 environments = 24 rows; `.down.sql` removes them.

---

### Step 6 — service: Fundamentals producer background loop

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — create
- `services/xstockstrat-analysis/app/main.py` — modify (wire the background task + new stubs/env)
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (construct portfolio stub + expose producer for Step 9)
- `docker-compose.yml` — modify (add `PORTFOLIO_ENDPOINT`)
- `.do/app.dev.yaml` — modify (add `PORTFOLIO_ENDPOINT`)
- `.do/app.yaml` — modify (add `PORTFOLIO_ENDPOINT`)

**Reviewers**: `xstockstrat-analysis` (service owner) — scheduler-loop safety (reuse of the live-engine
interval pattern, no interference with the live-strategy loop), determinism, no look-ahead;
`xstockstrat-marketdata` (service owner) — producer consumes only cached `GetFundamentalsMulti`, never
FMP directly, pacing respects `marketdata.fmp.daily_request_cap`;
`xstockstrat-ingest` (service owner) — `IngestSignal` write contract + source-registry validation

**Codebase Evidence**:
- **Loop pattern to mirror** (`app/engine/live_loop.py`):
  - `class LiveEvaluationLoop.__init__(config_watcher, db_pool, marketdata_stub, ingest_stub, notify_stub,
    ledger_stub, evaluator)` — `live_loop.py:36-56`.
  - `async def run_forever(self)` — `live_loop.py:58-70`: reads interval each cycle
    (`self._cfg.get_int("analysis.engine.eval_interval_seconds", default=60)`, `:61`),
    `await asyncio.sleep(interval)` (`:62`), `asyncio.Lock` skip-if-running guard (`:63-64`),
    broad `try/except` so one bad cycle never kills the loop (`:67-70`).
  - Ledger emit pattern — `live_loop.py:169-186` (`AppendEvent(event_type=..., source_service=
    "xstockstrat-analysis", stream_key=..., payload=Struct)`).
  - Notify alert pattern — `live_loop.py:156-167` (`EmitAlert(severity=..., category=..., title=...,
    source_service="xstockstrat-analysis", context=Struct)`).
- **main.py wiring**: env reads `:26-33` (has `CONFIG/MARKETDATA/INDICATORS/INGEST/LEDGER/NOTIFY_ENDPOINT`,
  **no `PORTFOLIO_ENDPOINT`**); asyncpg pool `:44-47`
  (`asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=int(os.environ.get("DB_POOL_MAX","2")))` —
  **reuse this pool, no new pool**, budget stays 2); background-task wiring to copy `:81-95`
  (`LiveEvaluationLoop(...)` then `asyncio.get_event_loop().create_task(live_loop.run_forever())`).
- **Stub construction** in servicer `__init__` — `servicer.py:62-70`
  (`self._marketdata/_indicators/_ingest/_ledger/_notify`, e.g. `:65`
  `self._ingest = ingest_pb2_grpc.IngestServiceStub(ingest_channel)`). Add a `portfolio` stub here.
- **Config typed getters** — `app/config/watcher.py`: `get_str:60`, `get_int:68`, `get_bool:76`
  (uses `HasField("bool_val")`), `get_float:84`. Read the full key string.
- **`ExternalSignal` emit shape** — `packages/proto/ingest/v1/ingest.proto:105-118`:
  `source(1)`, `symbol(2)`, `direction(3)` = string `"buy"|"sell"|"hold"`, `conviction(4)` double 0–1,
  `valid_from(5)`/`valid_until(6)` Timestamps; `IngestSignalRequest{signal=1}`,
  `IngestSignalResponse{signal_id int64 =1}`. Map FR-6: `direction` from quantile, `conviction`=score,
  `valid_from`=run date, `valid_until`=run date + `valid_days`.
- **Cached fundamentals read** (FR-2): bind `stub.GetFundamentalsMulti` (provided by 059;
  `docs/roadmap/features/059-.../implementation-spec.md:59,63-82`). The producer **never** imports an FMP
  client — confirmed no FMP symbol exists in analysis.
- **PORTFOLIO_ENDPOINT deployment audit (all absent — must add)**:
  `docker-compose.yml:346-359` (analysis env block) — no `PORTFOLIO_ENDPOINT`;
  `.do/app.dev.yaml:205-234` and `.do/app.yaml:205-234` — no `PORTFOLIO_ENDPOINT`.
  Portfolio gRPC port is `50052` (root `CLAUDE.md` Service Registry).

**Instructions**:
1. Create `app/engine/fundsignal_loop.py` with a `FundamentalsSignalLoop` class modeled on
   `LiveEvaluationLoop` (`live_loop.py:36-70`):
   - `__init__(config_watcher, db_pool, marketdata_stub, ingest_stub, portfolio_stub, notify_stub, ledger_stub)`.
   - `run_forever()`: each cycle read `interval_hours = self._cfg.get_int("analysis.fundsignal.run_interval_hours",
     24)`, `await asyncio.sleep(interval_hours * 3600)`; gate on
     `self._cfg.get_bool("analysis.fundsignal.enabled", default=False)` (skip the cycle when disabled);
     use the same `asyncio.Lock` skip-if-running guard and broad `try/except`.
   - The cycle body calls `await self.run_once(force=False, dry_run=False, override_symbols=None)`,
     which is the same method Step 9's `RunFundamentalsScan` invokes (single code path).
2. `run_once(...)` orchestrates (helpers implemented in Step 8):
   a. Insert a `analysis.fundsignal_runs` row (status `running`), capture `run_id`.
   b. Resolve the universe (Step 8 `_resolve_universe`), capped at `max_symbols_per_run`.
   c. Filter out symbols already emitted today via `analysis.fundsignal_emitted` PK (skip = no cache call) —
      unless `force`.
   d. Read fundamentals in paced chunks via `marketdata_stub.GetFundamentalsMulti`, honoring the
      `daily_call_budget` reservation (Step 8 `_paced_fetch`): when the budget would be exceeded, stop,
      mark remaining symbols deferred, set run status `budget_deferred`, log, and emit a notify alert
      (FR-4/FR-9).
   e. Score (Step 8 `_score`), map to direction by cross-sectional quantile (Step 8 `_map_directions`),
      drop below `min_conviction_to_emit`.
   f. For each surviving symbol: `INSERT ... ON CONFLICT (symbol, source, as_of_date) DO NOTHING` into
      `analysis.fundsignal_emitted`; only if the row was inserted, call `ingest_stub.IngestSignal(
      IngestSignalRequest(signal=ExternalSignal(source=source_slug, symbol=..., direction=..., conviction=...,
      valid_from=run_date_ts, valid_until=run_date+valid_days_ts)))` and store the returned `signal_id`.
   g. Update the `fundsignal_runs` row (`finished_at`, `status`, `symbols_done`, `calls_spent`,
      `deferred_count`); emit `analysis.fundsignal.run_started` / `.run_completed` ledger events
      (mirror `live_loop.py:169-186`).
   h. Return a `FundamentalsScanSummary` (Step 1 message) for Step 9's RPC.
3. **Outbound header propagation**: the background loop has no inbound request context — like
   `LiveEvaluationLoop`, it calls stubs with no `metadata=` (confirmed `live_loop.py:110,156,177` omit
   metadata). The source registration in Step 8 (`ManageSignalSource`, admin-scoped) is the one call that
   needs `x-access-scope` with the admin bit (`0x04`) — see Step 8. Step 9's RPC-triggered path
   propagates the caller's metadata (see Step 9).
4. `app/main.py`: add `PORTFOLIO_ENDPOINT = os.environ.get("PORTFOLIO_ENDPOINT", "xstockstrat-portfolio:50052")`
   near `:26-33`; create a `portfolio_channel = grpc.aio.insecure_channel(PORTFOLIO_ENDPOINT)` near the
   other channels (`:50-58`); pass it into the servicer; after the existing `live_loop` create_task
   (`:81-95`), construct `FundamentalsSignalLoop(...)` reusing the **same** asyncpg pool and stubs, and
   `asyncio.get_event_loop().create_task(fundsignal_loop.run_forever())`. Hold a reference on the servicer
   so Step 9 can call `run_once`.
5. `servicer.py`: in `__init__` (`:62-70`) add `self._portfolio = portfolio_pb2_grpc.PortfolioServiceStub(
   portfolio_channel)` and `from gen.portfolio.v1 import portfolio_pb2, portfolio_pb2_grpc` (import form
   per `servicer.py:23`).
6. Deployment: add `PORTFOLIO_ENDPOINT: xstockstrat-portfolio:50052` to the `xstockstrat-analysis`
   `environment:` block in `docker-compose.yml` (after `:352` `INGEST_ENDPOINT`); add
   `- key: PORTFOLIO_ENDPOINT` / `value: ${xstockstrat-portfolio.PRIVATE_DOMAIN}:50052` to the analysis
   `envs:` block in both `.do/app.dev.yaml` and `.do/app.yaml` (matching the existing
   `INGEST_ENDPOINT`/`MARKETDATA_ENDPOINT` entries' value form in those files).

**Verification**:
`cd services/xstockstrat-analysis && ruff check . && ruff format --check .` passes; service starts and
the new loop logs a startup line; `grep -n "PORTFOLIO_ENDPOINT" docker-compose.yml .do/app.dev.yaml
.do/app.yaml` shows it present in all three (coverage threshold checked in Step 7).

---

### Step 7 — test: Producer loop (cache-only, dedup, idempotency, budget defer)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — create

**Reviewers**: `xstockstrat-analysis` (service owner) — tests prove cache-only FMP discipline,
dedup, idempotency, budget defer, no look-ahead

**Codebase Evidence**:
- Test/mocking pattern: `tests/test_live_loop.py:20-35` `_make_loop()` — `cfg.get_int` returns the
  default arg; `db_pool` + stubs are `AsyncMock`; `GetBars`/`EmitAlert`/`AppendEvent` overridden with
  `AsyncMock`. Forbidden-import guard test enumerating symbols — `test_live_loop.py:86`.
- pytest config: `pyproject.toml:30-32` (`testpaths=["tests"]`, `asyncio_mode="auto"`);
  `conftest.py:11-29` puts the proto `gen` namespace on `sys.path` (no running container needed).

**Instructions**:
Add tests mirroring `test_live_loop.py`'s `AsyncMock` style (mock `cfg`, `db_pool`, and the
marketdata/ingest/portfolio/notify/ledger stubs):
1. **Cache-only (Acceptance #2 / FR-2)**: assert the producer calls `marketdata_stub.GetFundamentalsMulti`
   and that no FMP symbol is importable from the producer module — replicate the forbidden-import guard at
   `test_live_loop.py:86` listing FMP/`financialmodelingprep`/`requests`-to-FMP symbols.
2. **Idempotency (Acceptance #1 / FR-5)**: with the `fundsignal_emitted` mock returning "row exists" for
   a symbol, assert `IngestSignal` is **not** called and `GetFundamentalsMulti` is not called for it
   (re-run emits nothing, spends zero calls).
3. **Dedup (Acceptance #3 / FR-3)**: a symbol present in two watchlists appears once in the resolved
   universe → fetched once.
4. **Budget defer (Acceptance #4 / FR-4)**: with `daily_call_budget` low, assert the run processes up to
   budget, marks the remainder deferred (run status `budget_deferred`), logs, emits a notify alert, and
   never exceeds the budget; a follow-up `run_once` resumes the deferred symbols.
5. **Score→direction (FR-6)**: top-quantile symbol → `"buy"`, bottom → `"sell"`, middle → `"hold"`;
   below `min_conviction_to_emit` → dropped.

**Verification**:
`cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app
--cov-fail-under=40` — passes the 40% threshold (per ci-overview; analysis threshold is 40%).

---

### Step 8 — service: Universe / scoring / budget / source-registration helpers

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify (pure helper methods)

**Reviewers**: `xstockstrat-analysis` (service owner) — deterministic scoring, cross-sectional quantile
correctness, no look-ahead; `xstockstrat-ingest` (service owner) — idempotent source registration via
`ManageSignalSource`, admin scope; `xstockstrat-marketdata` (service owner) — pacing respects the FMP
daily cap

**Codebase Evidence**:
- **Universe source (FR-3) — watchlists caveat**: portfolio has **no** watchlist code today; 058 owns it
  (`docs/roadmap/features/058-.../product-spec.md:22-26,77-84`) and its `ListWatchlists` is user-scoped,
  so it cannot return the global union. Resolution: when `universe_source` ∈ {`watchlists`,`both`}, the
  producer needs a **global** read of `portfolio.watchlist_symbols`. Two acceptable implementations
  (pick at execute time based on whether 058 has shipped a global RPC):
  (a) a global `ListWatchlists`/`ListAllWatchlistSymbols` variant added by 058, or
  (b) until then, fall back to `universe_source=explicit` (read `analysis.fundsignal.explicit_symbols`
  CSV) and log that the watchlist union is pending 058's global variant. Flag this in the Deviation Log.
- **Source registration (FR-7)**: idempotently register the `fundamentals` source via
  `ingest_stub.ManageSignalSource` (`packages/proto/ingest/v1/ingest.proto:155-159`,
  `ManageSignalSourceRequest{source, credentials_ref, operation}`); admin-gated at
  `services/xstockstrat-ingest/app/handlers/servicer.py:858` (`_has_admin_scope`, requires
  `x-access-scope` bit `0x04`, `servicer.py:118-131`). **CHECK-constraint — RESOLVED (user decision)**:
  ingest's `signal_sources.source_type` CHECK allows only
  `('simple_email','email_attachment','linked_email','simple_website','authenticated_website')`
  (`services/xstockstrat-ingest/migrations/002_add_signal_sources_registry.up.sql:8-10`). The producer
  registers its source as the **new `source_type='derived'`** — a generic bucket for internally-produced
  (non-extraction) signals — added by the additive ingest migration in **Step 13**. The registration row
  uses `extractor_module='app.extractors.noop'` (the existing canonical no-op extractor for
  non-extracting source types, `services/xstockstrat-ingest/app/extractors/noop.py`), `config_json=NULL`,
  `credentials_ref=NULL`. No validation change is needed: `validate_config_json`
  (`services/xstockstrat-ingest/app/repositories/signal_sources.py:70-103`) returns `None` (passes) for any
  `source_type` outside the email/website branches, and `IngestSignal` checks only `slug`+`active`
  (`servicer.py:639`) — it never branches on `source_type`, so emitted signals flow through unchanged.
- **Source weight (FR-7)**: ensure the source has a weight in `analysis.signals.source_weights` (already
  exists; read at `servicer.py:129` `self._cfg.get_str("analysis.signals.source_weights", default="{}")`).
  Reuse this existing key — do not add a new one.
- **Scoring default**: `analysis.fundsignal.scoring_formula_id` empty → built-in default
  (`product-spec.md:102`; 063 supplies the real formula). The built-in default is a trivial deterministic
  function of the `GetFundamentalsMulti` metrics (e.g. normalized blend) — no look-ahead, run-local only.

**Instructions**:
1. `_resolve_universe()` → distinct, sorted list of symbols (dedup, FR-3) from
   `universe_source` (`watchlists`|`explicit`|`both`): explicit = parse `explicit_symbols` CSV;
   watchlists = global read per the caveat above. Cap at `max_symbols_per_run`.
2. `_paced_fetch(symbols, budget)` → fetch fundamentals via `GetFundamentalsMulti` in chunks, tracking a
   running call count; stop when adding the next chunk would exceed `daily_call_budget`; return
   `(fetched, deferred)`. Pace per-second to respect FMP limits (sleep between chunks). Cite that this is
   the only fundamentals access path (never FMP directly).
3. `_score(fundamentals_by_symbol)` → `dict[symbol, float in 0..1]` using the formula_id when set, else
   the built-in default. Deterministic given the same inputs (Acceptance #6 / no look-ahead).
4. `_map_directions(scores, buy_quantile, sell_quantile)` → cross-sectional quantile within the run:
   `≥ buy_quantile` → `"buy"`, `≤ sell_quantile` → `"sell"`, else `"hold"` (FR-6). `conviction` = the
   (normalized) score; drop `< min_conviction_to_emit`.
5. `_ensure_source_registered()` → idempotently `ManageSignalSource(operation="register", source=
   SignalSource(slug=source_slug, display_name="Fundamentals Signal Producer",
   source_type="derived", extractor_module="app.extractors.noop", active=True))` with admin metadata
   `("x-access-scope","4")`; tolerate already-registered (no-op). Run once per process (cache a bool) or
   on first cycle. **Requires Step 13's ingest migration to be applied first** (the `derived` `source_type`
   must exist in the CHECK, else `upsert_source` fails the constraint).

**Verification**:
Helper-level unit assertions are in Step 7's test file (dedup, quantile mapping, budget defer). Lint:
`cd services/xstockstrat-analysis && ruff check . && ruff format --check .` passes.

---

### Step 9 — service: `RunFundamentalsScan` RPC handler (manual trigger, admin-scoped)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (add `RunFundamentalsScan` method)

**Reviewers**: `xstockstrat-analysis` (service owner) — admin gate, reuses the producer's single
`run_once` path, returns an accurate summary

**Codebase Evidence**:
- Existing RPC method style + insertion point: last method `SetStrategyLive` at
  `servicer.py:802`; add `RunFundamentalsScan` after it. Methods are `async def Name(self, request, context)`.
- **Admin gate**: reuse `_has_admin_scope(context)` — confirmed present in ingest
  (`services/xstockstrat-ingest/app/handlers/servicer.py:72-85,118-131`); analysis has its own
  `_has_admin_scope` at `services/xstockstrat-analysis/app/handlers/servicer.py:72-85` (per the analysis
  digest). Use the analysis one. Return `PERMISSION_DENIED` if not admin.
- **Header propagation**: extract propagated metadata from the inbound `context` and forward to the
  producer's outbound calls — pattern at `servicer.py:147-151`
  (`propagation_meta = [(k,v) for k,v in context.invocation_metadata() if k in ("x-user-id",
  "x-access-scope","x-trace-id")]`), then pass `metadata=propagation_meta` on outbound stub calls.
  Since `RunFundamentalsScan` is admin-scoped, the inbound `x-access-scope` already carries the admin
  bit, so `_ensure_source_registered` can reuse it instead of a synthetic value.

**Instructions**:
1. Add `async def RunFundamentalsScan(self, request, context)`:
   - Gate with `self._has_admin_scope(context)` → `PERMISSION_DENIED` "admin scope required" on failure.
   - Build `propagation_meta` (`servicer.py:147-151` pattern) and hand it to the producer call.
   - Call the shared producer: `summary = await self._fundsignal_loop.run_once(force=request.force,
     dry_run=request.dry_run, override_symbols=list(request.symbols) or None, metadata=propagation_meta)`
     (the loop reference held on the servicer from Step 6).
   - Return the `FundamentalsScanSummary` (Step 1 message) populated from the run row (`run_id`,
     `symbols_processed`, `signals_emitted`, `calls_spent`, `deferred_count`, `status`, `finished_at`).
2. Register the method on the servicer the same way existing RPCs are wired (the servicer is added to the
   server via `add_AnalysisServiceServicer_to_server` in `main.py` — regenerated stubs from Step 2 expose
   the new method slot).

**Verification**:
`cd services/xstockstrat-analysis && ruff check . && ruff format --check .` passes; a `grpcurl`
`RunFundamentalsScan` with admin scope returns a summary, without admin scope returns `PERMISSION_DENIED`
(coverage in Step 10).

---

### Step 10 — test: `RunFundamentalsScan` RPC

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (add `RunFundamentalsScan` cases)

**Reviewers**: `xstockstrat-analysis` (service owner) — admin gate enforced, summary fields correct

**Codebase Evidence**:
- Servicer test harness: `tests/test_analysis_servicer.py:22-34` `make_servicer()` — `cfg` is a
  `MagicMock` returning defaults; channels are bare `MagicMock()`; stubs overridden with `AsyncMock`
  (`:77-78`). `_has_admin_scope` keys off `context.invocation_metadata()` carrying `x-access-scope`.

**Instructions**:
1. Add a case asserting `RunFundamentalsScan` with a non-admin `context` (no/insufficient `x-access-scope`)
   aborts with `PERMISSION_DENIED`.
2. Add a happy-path case: admin `context`, the producer's `run_once` mocked to return a known summary →
   assert the response fields map through (`run_id`, `signals_emitted`, `calls_spent`, `deferred_count`,
   `status`). Mock `self._fundsignal_loop.run_once` as an `AsyncMock`.
3. Add a `dry_run=True` case asserting no `IngestSignal` call propagates (pass through to the mocked loop).

**Verification**:
`cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app
--cov-fail-under=40` — passes the 40% threshold.

---

### Step 11 — config: Roll out `analysis.fundsignal.*` defaults to running environments

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- (operational — no source change; uses `SetConfig`/`RolloutConfig` per the runbook)

**Reviewers**: `xstockstrat-config` (service owner) — rollout follows the runbook, `enabled=false` until
upstream deps (059/058) land

**Codebase Evidence**:
- Rollout via `SetConfig`/`RolloutConfig` — `docs/runbooks/config-rollout.md` Steps 2–4; `SetConfig`
  handler `services/xstockstrat-config/src/grpc/configServiceImpl.ts:251` (upsert + `pg_notify`).
- The 24 seed rows already arrive via Step 5's migration; this step only flips/tunes values on a live env
  if needed (defaults are already correct — `enabled=false`).

**Instructions**:
1. After Step 5's migration applies, no value change is required to ship safely — `analysis.fundsignal.enabled`
   defaults `false`, so the producer is dormant. Document the go-live toggle:
   `SetConfig(namespace="analysis", key="fundsignal.enabled", value={bool_val:true})` **only after**
   059 (cached fundamentals) and 058/explicit-universe are in the target environment, per
   `config-rollout.md` Pre-Rollout Checklist.
2. Tune `daily_call_budget`/`buy_quantile`/`sell_quantile` per `config-rollout.md` Step 2 as needed,
   keeping `daily_call_budget` ≤ `marketdata.fmp.daily_request_cap` (250) with headroom for the screener
   (Resolved Decision OQ-062-e: 200 of 250).

**Verification**:
`config-rollout.md` Step 4 propagation check — `GetConfig(namespace="analysis")` returns the
`fundsignal.*` keys with expected values; audit row present in `config.config_audit`.

---

### Step 12 — docs: Update service + root docs

**Status**: `pending`
**Service**: `docs/` + service CLAUDE.md
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `CLAUDE.md` (root) — modify (Recently added config keys table)

**Reviewers**: none

**Codebase Evidence**:
- Analysis config-key table to extend — `services/xstockstrat-analysis/CLAUDE.md` § "Config Keys Consumed".
- Ledger-events table to extend — same file § "Ledger Events Emitted" (existing rows like
  `analysis.strategy.triggered`).
- Root "Recently added keys" convention — root `CLAUDE.md` § Config Governance Rules.

**Instructions**:
1. In `services/xstockstrat-analysis/CLAUDE.md`: add the 12 `analysis.fundsignal.*` keys to the Config
   Keys table; add `analysis.fundsignal.run_started` / `.run_completed` to the Ledger Events table; add a
   short "Fundamentals signal producer" subsection describing the daily background loop (cache-only FMP
   discipline, dedup, idempotency table, budget reservation), the `RunFundamentalsScan` RPC, the new
   `PORTFOLIO_ENDPOINT` env var, and the new dependency edge **analysis → ingest write** (via
   `IngestSignal`/`ManageSignalSource`, RPC not DB) and **analysis → portfolio read**.
2. In root `CLAUDE.md`: add a "Recently added keys (feature 062 — fundamentals signal producer, owned by
   `xstockstrat-analysis`)" block listing the 12 keys; note the new `PORTFOLIO_ENDPOINT` for analysis in
   the env-var context if appropriate.

**Verification**:
Manual read-through; `grep -n "fundsignal" services/xstockstrat-analysis/CLAUDE.md CLAUDE.md` shows the
new entries; markdown links resolve.

---

### Step 13 — migration (xstockstrat-ingest): add `derived` to the `signal_sources.source_type` CHECK

**Status**: `pending`
**Service**: `xstockstrat-ingest` (cross-service change owned by this feature — requires ingest-service-owner + DBA sign-off)

**Files**:
- `services/xstockstrat-ingest/migrations/006_signal_source_type_derived.up.sql` — create
- `services/xstockstrat-ingest/migrations/006_signal_source_type_derived.down.sql` — create

**Reviewers**: `xstockstrat-ingest` (service owner) — additive `source_type` allow-list extension, no
existing value removed, no behavioral change to extraction; DBA — CHECK drop/re-add correctness, down
migration safety, constraint name

**Codebase Evidence**:
- The CHECK is an inline 5-value allow-list (`services/xstockstrat-ingest/migrations/002_add_signal_sources_registry.up.sql:8-10`);
  Postgres names an inline column CHECK `<table>_<column>_check` → `signal_sources_source_type_check`
  (confirm at execute with `\d ingest.signal_sources`).
- This is **purely additive** — adds one value (`derived`), removes none; existing rows and types stay valid.
  The change does not loosen validation: `validate_config_json` already passes any non-email/website type
  (`app/repositories/signal_sources.py:70-103`), and the allow-list is already behind the code (the
  validation references `mediated_*` types absent from the CHECK), so extending it is consistent with how
  the code already treats this set.
- `006` is the next free ingest migration number (trunk tops out at `005_add_backfill_job_chunk_counts`,
  `services/xstockstrat-ingest/migrations/`).

**Instructions**:
1. Create `006_signal_source_type_derived.up.sql`:
   ```sql
   -- 006_signal_source_type_derived.up.sql
   -- Add 'derived' to signal_sources.source_type — a generic bucket for internally-produced
   -- (non-extraction) signals (e.g. the fundamentals signal producer, feature 062). Additive only.
   ALTER TABLE ingest.signal_sources DROP CONSTRAINT signal_sources_source_type_check;
   ALTER TABLE ingest.signal_sources ADD CONSTRAINT signal_sources_source_type_check
       CHECK (source_type IN (
           'simple_email', 'email_attachment', 'linked_email',
           'simple_website', 'authenticated_website',
           'derived'));
   ```
2. Create `006_signal_source_type_derived.down.sql` — restore the original 5-value CHECK. Because
   re-adding the stricter constraint fails if any `derived` row exists, **remove derived rows first**:
   ```sql
   -- 006_signal_source_type_derived.down.sql
   DELETE FROM ingest.signal_sources WHERE source_type = 'derived';
   ALTER TABLE ingest.signal_sources DROP CONSTRAINT signal_sources_source_type_check;
   ALTER TABLE ingest.signal_sources ADD CONSTRAINT signal_sources_source_type_check
       CHECK (source_type IN (
           'simple_email', 'email_attachment', 'linked_email',
           'simple_website', 'authenticated_website'));
   ```
3. No application-code change in ingest: `IngestSignal` ignores `source_type` (`servicer.py:639`),
   `validate_config_json` passes `derived` (`signal_sources.py:103`), and `app/extractors/noop.py` is the
   `extractor_module` the registration row uses — all pre-existing.

**Verification**:
```bash
cd services/xstockstrat-ingest
# confirm next-free number and files present
ls migrations/ | sort | grep -E '00[56]_'
# round-trip the migration, then confirm a 'derived' source registers and rejects an unknown type
../../scripts/db-migrate.sh up && ../../scripts/db-migrate.sh down && ../../scripts/db-migrate.sh up
```
Then assert (via the ingest test suite / psql) that an `INSERT … source_type='derived'` succeeds and an
unknown value still raises a CHECK violation (the constraint stays strict — only the allow-list grew).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- **RESOLVED (user decision, pre-execute)** — Step 8 source registration: the producer registers with the
  **new `source_type='derived'`** (a generic bucket for internally-produced, non-extraction signals), added
  by the additive ingest migration in **Step 13** (`006_signal_source_type_derived`). Registration row uses
  `extractor_module='app.extractors.noop'`; no ingest validation/emit-path change is needed. Chosen over
  reusing an email/website value (semantically wrong) and over a literal `fundamentals` value (less reusable
  for future synthetic producers). Requires ingest-service-owner + DBA sign-off on the cross-service migration.
- (Anticipated) Step 8: watchlist global-union read depends on 058 shipping a global `ListWatchlists`
  variant — record whether the implementation used a global RPC or the `explicit` fallback.
