# Implementation Spec: order-snapshots-pnl-patterns

**Status**: `pending`
**Created**: 2026-08-20
**Feature**: `docs/roadmap/features/042-order-snapshots-pnl-patterns/feature.md`
**Total Steps**: 14
**Feature Branch**: `feature/order-snapshots-pnl-patterns`

---

## Execution Summary

This feature is **analysis-centric and ledger-event-driven** (design.md § Chosen Approach): all
snapshot capture and P&L pattern attribution live in `xstockstrat-analysis`, driven off ledger
events that trading and portfolio **already** emit. The only non-analysis code change is a small,
durable enrichment in `xstockstrat-portfolio` (a per-position `realized_accum` and an enriched
`portfolio.position.closed` payload) so analysis can seal a position's realized P&L without a
second P&L computation.

Order: proto + codegen first (everything else consumes the generated stubs), then the two
migrations (portfolio 010, analysis 016 — both verified next-free across **all** remote branches,
see § Step Dependencies), then portfolio's producer change with its paired test, then the analysis
consumer + `QueryPnLPatterns` RPC with their paired tests, then the `/insights` P&L Patterns
consumer surface (C-14) with its e2e + nav-reachability tests, and finally the docs/CLAUDE.md
updates.

**No new inter-service edge, no new env var, no new DB pool** (design.md § Chosen Approach; recon
§ Dependencies "New env vars: none"). Analysis already dials indicators, ingest, marketdata,
portfolio, and ledger (`services/xstockstrat-analysis/app/main.py:28,61,64,109-153`), and reuses its
single shared asyncpg pool (F-06). Because no new env var or port is introduced, **no
`docker-compose.yml` / `.do/app.dev.yaml` / `.do/app.yaml` change is required** — confirmed by the
recon dependency audit.

### Consumer Surface Coverage (C-14)

Product spec names exactly one consumer surface: **UI** `/insights` P&L Patterns view (Agent: none).
Step 12 lands that surface (page + hook + BFF + nav triple-registration); Step 13 proves it (e2e +
nav-reachability). No Agent step is required — the product spec marks Agent `none`.

### Scenario Coverage (C-15)

| `@AC-*` | Covered by step(s) |
|---|---|
| AC-1 (fill captures snapshot w/ indicator+signal context) | Step 9 (analysis consumer test) |
| AC-2 (position close → `pnl_pattern_factors`/samples within 10 s) | Step 9 (analysis consumer test); Step 5/6 provide the enriched close-event producer half |
| AC-3 (`QueryPnLPatterns` ranked positive+negative factors) | Step 11 (analysis RPC test) |
| AC-4 (Insights P&L Patterns view renders ranked factor cards) | Step 13 (UI e2e test) |
| AC-5 (view reachable from insights sub-nav) | Step 13 (nav-reachability test) |
| AC-6 (snapshot timeout never blocks; partial snapshot; WARN to ledger) | Step 9 (analysis consumer test) |
| AC-7 (ledger has snapshot-captured + pattern-computed events) | Step 9 (analysis consumer test) |

## Step Dependencies

- **Migration numbering re-verified against ALL remote branches** (design Open Risk / ledger 081):
  `git ls-remote` + `git ls-tree` over every `origin/*` branch shows the highest `xstockstrat-analysis`
  migration is `015` (→ **016** free) and the highest `xstockstrat-portfolio` migration is `009`
  (→ **010** free). No remote branch carries an analysis `016` or a portfolio `010`.
- **Feature 029 (`029-signal-performance-attribution`) collision cleared** (design Open Risk):
  029 is `status.md = draft`, has **no remote branch**, and its migration targets the **trading**
  `orders` table (`signal_id` column), **not** analysis. Its proto additions (`GetAttribution`,
  `SourceAttribution`) have distinct names from ours and no committed field numbers. No collision
  on analysis migration `016` or on our new proto messages/RPC.
- Step 2 (proto-gen) requires Step 1 (proto) — codegen consumes the edited `.proto`.
- Steps 4, 8, 10, 12 (all service steps) require Step 2 — they import the generated stubs.
- Step 8 (analysis consumer) requires Step 6 (analysis migration 016) tables to exist and Step 5
  (portfolio enriched `portfolio.position.closed` payload) as its data source.
- Step 5 requires Step 3 (portfolio migration 010 `realized_accum` column).
- Test steps 5-paired (Step 5's test is Step 5b? — no: see below), 9, 11, 13 pair with service
  steps 4, 8, 10, 12 respectively. Step 6→9 covers the analysis migration behavior via the consumer
  test. Portfolio service Step 5 pairs with test Step 6? — numbering is explicit below.

> Step numbering note: to keep every non-frontend `service` step immediately followed by its paired
> `test` step, the order is: 1 proto · 2 proto-gen · 3 migration(portfolio) · 4 service(portfolio)
> · 5 test(portfolio) · 6 migration(analysis) · 7 config · 8 service(analysis consumer) · 9
> test(analysis consumer) · 10 service(analysis RPC) · 11 test(analysis RPC) · 12 service(UI) · 13
> test(UI) · 14 docs.

---

### Step 1 — proto: add OrderSnapshot / PnLPatternFactor / QueryPnLPatterns to analysis.proto

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify
- `packages/proto/ledger/v1/ledger.proto` — modify (comment-only, see Instructions)

**Reviewers**: Proto Reviewer — field number uniqueness / no breaking change / naming; xstockstrat-analysis owner — backtest reproducibility, no look-ahead bias; xstockstrat-ledger owner — event ordering (the global-sequence comment fix)

**Codebase Evidence**:
- Service block: `grep -n "^service AnalysisService"` → `packages/proto/analysis/v1/analysis.proto:12`; last RPC `GetIndicatorSeries` at `:46`. New RPC appends inside the service block.
- Existing messages number their own fields fresh (per-message); highest existing message field numbers are `StrategyDefinition=14`, `Opportunity=12` (recon § Dependencies) — new messages start their field numbering at 1.
- Enum-with-`_UNSPECIFIED=0` precedent already in this file: `READINESS_RULE_UNSPECIFIED = 0` (`:545`), `OPPORTUNITY_ACTION_UNSPECIFIED = 0` (`:565`) — mirror the style (C-04).
- `ExternalSignal.conviction` is the "0.0–1.0 confidence" field (`packages/proto/ingest/v1/ingest.proto:110`) — the `SignalEntry.value` carried in a snapshot is this conviction (do **not** wire `Opportunity.conviction`, which is an ordinal — fails.md 2026-08-05/023).
- Stale ledger comment: `packages/proto/ledger/v1/ledger.proto:29` reads `int64 sequence = 9;  // monotonically increasing per stream_key`. The consumer (Step 8) relies on **global** sequence order across stream keys (design § 2); fix the comment to state the global ordering, matching the ledger invariant. **Comment-only — no field number, type, or name change.**

**TDD**: `N/A (proto)`

**Covers**: `—`

**Instructions**:
1. In `packages/proto/analysis/v1/analysis.proto`, add the new RPC inside the `AnalysisService` block (after `GetIndicatorSeries`, `:46`):
   `rpc QueryPnLPatterns(QueryPnLPatternsRequest) returns (QueryPnLPatternsResponse);`
2. Add enum `SnapshotEventType` with the mandatory zero sentinel and FR-1's four events:
   `SNAPSHOT_EVENT_TYPE_UNSPECIFIED = 0; SNAPSHOT_EVENT_TYPE_ORDER_CREATED = 1; SNAPSHOT_EVENT_TYPE_ORDER_FILLED = 2; SNAPSHOT_EVENT_TYPE_ORDER_PARTIALLY_FILLED = 3; SNAPSHOT_EVENT_TYPE_ORDER_CANCELLED = 4;` (C-04).
3. Add enum `FactorType`: `FACTOR_TYPE_UNSPECIFIED = 0; FACTOR_TYPE_INDICATOR = 1; FACTOR_TYPE_SIGNAL = 2;` (C-04).
4. Add message `SignalEntry { string name = 1; double value = 2; string source = 3; }` (the per-signal shape stored in a snapshot; `value` = ingest conviction).
5. Add message `OrderSnapshot` with fields per product spec § Proto Contract Changes: `string order_id = 1; string position_id = 2; string symbol = 3; SnapshotEventType event_type = 4; google.protobuf.Timestamp event_ts = 5; string side = 6; double quantity = 7; double price = 8; google.protobuf.Struct ohlcv_bar = 9; map<string, double> indicator_values = 10; repeated SignalEntry signals = 11;`
6. Add message `PnLPatternFactor`: `string factor_name = 1; FactorType factor_type = 2; double value_range_low = 3; double value_range_high = 4; int32 sample_count = 5; double avg_pnl_impact = 6;`
7. Add `QueryPnLPatternsRequest { string symbol = 1; string strategy_id = 2; google.protobuf.Timestamp from_ts = 3; google.protobuf.Timestamp to_ts = 4; int32 limit = 5; }` and `QueryPnLPatternsResponse { repeated PnLPatternFactor positive_factors = 1; repeated PnLPatternFactor negative_factors = 2; }`.
8. Confirm the `import "google/protobuf/timestamp.proto";` and `import "google/protobuf/struct.proto";` lines exist at the top of the file (both are used by existing messages — verify, add only if absent).
9. In `packages/proto/ledger/v1/ledger.proto:29`, change the trailing comment on `int64 sequence = 9;` from `// monotonically increasing per stream_key` to note it is a **global** monotonic sequence (`nextval('ledger.global_sequence')`) ordered across all stream keys — comment text only.

**Verification**:
```
cd packages/proto && buf lint && buf breaking --against ".git#branch=main-dev"
```
Expect `buf lint` clean and `buf breaking` to report no breaking changes (all additions are new messages/enums/RPC; the ledger edit is a comment). Then Step 2 regenerates and proves the stub diff.

---

### Step 2 — proto-gen: regenerate and compile stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/**` — modify (generated)
- `packages/proto/gen/python/**` — modify (generated)
- `packages/proto/gen/ts/**` (+ `gen/ts/dist/**`) — modify (generated)

**Reviewers**: Proto Reviewer — field number uniqueness / no breaking change / naming; xstockstrat-analysis owner — backtest reproducibility, no look-ahead bias; xstockstrat-ledger owner — event ordering (inherited from Step 1)

**Codebase Evidence**:
- Codegen entry point: root `CLAUDE.md` § Generating Proto Stubs → `./scripts/buf-gen.sh` (generates TS, Python, Go and compiles the TS package). Path: `scripts/buf-gen.sh`.
- Toolchain provisioning when Docker/egress is unavailable: `docs/runbooks/codegen-toolchain-host-setup.md` (validate an empty stub diff before the first proto edit — insights.md 2026-07-09 ordering).

**TDD**: `N/A (proto-gen)`

**Covers**: `—`

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Stage all regenerated files under `packages/proto/gen/` (Go, Python, TS + compiled `dist/`).
3. Do not hand-edit any generated file.

**Verification**:
```
./scripts/buf-gen.sh
git status --porcelain packages/proto/gen/    # only expected: new analysis messages/RPC + ledger comment
```
Confirm the diff contains the new `QueryPnLPatterns`/`OrderSnapshot`/`PnLPatternFactor`/`SignalEntry`/enums across all three languages and nothing unrelated (a re-run must be byte-identical — insights.md 2026-07-09).

---

### Step 3 — migration: portfolio 010 add realized_accum to positions

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/migrations/010_positions_realized_accum.up.sql` — create
- `services/xstockstrat-portfolio/migrations/010_positions_realized_accum.down.sql` — create

**Reviewers**: DBA — migration NNN numbering / up+down pair / index correctness; xstockstrat-portfolio owner — P&L calculation accuracy, concurrent write safety

**Codebase Evidence**:
- Last portfolio migration is `009_bracket_order_ids` (`ls services/xstockstrat-portfolio/migrations/`), and no remote branch carries a `010` (§ Step Dependencies) → **010** is next-free (C-07).
- Target table `portfolio.positions` is upserted by `UpsertPosition` (`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:55-63`, `ON CONFLICT (user_id, symbol, trading_mode, account_id) DO UPDATE`).
- `portfolio.positions` is **not** a hypertable (the hypertable is `portfolio.snapshots`, portfolio CLAUDE.md § Database), so a plain `ADD COLUMN` needs no partition-column consideration.

**TDD**: `N/A (migration)`

**Covers**: `—`

**Instructions**:
1. `.up.sql`: `ALTER TABLE portfolio.positions ADD COLUMN IF NOT EXISTS realized_accum NUMERIC NOT NULL DEFAULT 0;` (design § 1 — cumulative realized P&L for order-fill-reduced positions; attribution-stats-only, never a user-facing figure).
2. `.down.sql`: `ALTER TABLE portfolio.positions DROP COLUMN IF EXISTS realized_accum;`
3. Match the schema-qualified, `IF NOT EXISTS` style of the existing portfolio migrations.

**Verification** (offline, no DB — spec-template § Migration step verification):
```
ls services/xstockstrat-portfolio/migrations/010_*.up.sql services/xstockstrat-portfolio/migrations/010_*.down.sql
```
Read both: confirm the `.up.sql` `ADD COLUMN` has its inverse `DROP COLUMN` in `.down.sql`.

---

### Step 4 — service: portfolio realized_accum accumulation + enriched close payload + account-scoped ClosePosition

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify

**Reviewers**: xstockstrat-portfolio owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `GetPnL`'s `applyFill` closure (the realized reduce math) is at `portfolio_service.go:519` with `realized += (-closeQty) * (fillPrice - avgEntry)` at `:535` — a pure function of `(accQty, accCost/avgEntry, fillQty, fillPrice)` (design § 1). Live pass call sites `:589`, `:646`.
- The live reducing branch in `ConsumeOrderFills` is `portfolio_service.go:272-275` (`else { // selling ... newAvgEntry = existing.AvgEntryPrice }`); `existing` fetched at `:261`, `newQty` at `:268`.
- The `portfolio.position.closed` emit is `portfolio_service.go:289-291`, currently `{"user_id": fill.UserID, "symbol": fill.Symbol}` only. In scope at that site: `fill.UserID`, `fill.Symbol`, `acctID` (`:282`), `mode` (trading mode, `:261`).
- `UpsertPosition` signature has 7 params → `$1..$7` (`portfolio_repo.go:55-63`); `$8` is the next free bind slot for the `realized_accum` delta.
- `ClosePosition` DELETE is **not** account-scoped: `DELETE FROM portfolio.positions WHERE user_id=$1 AND symbol=$2 AND trading_mode=$3` (`portfolio_repo.go:66-70`); its only call site is `portfolio_service.go:288`. (Sync-path DELETEs at `:317`/`:329` are already account-scoped and are out of scope for this step.)
- `emitEvent` retry/idempotency contract already exists (portfolio CLAUDE.md § Ledger Events Emitted) — reuse it unchanged.

**TDD**: `red-green required`

**Covers**: `—` (producer half of AC-2 / AC-7; asserted in Step 5)

**Instructions**:
1. Extract a package-level pure helper `realizedDelta(accQty, accCost, fillQty, fillPrice float64) float64` capturing the direction-aware reduce math from `GetPnL`'s `applyFill` (`:519-550`). It returns the realized P&L contributed by `fillQty@fillPrice` reducing a position of `accQty` at average cost `accCost/accQty`; a non-reducing (opening/adding) fill returns `0`. Do **not** write a second formula — this is the ONE realized-P&L implementation (C-10(b); the 056 dual-source fail).
2. Route `GetPnL`'s `applyFill` closure through `realizedDelta` (call it, add to `realized`), so `GetPnL`'s figure is provably unchanged.
3. In `ConsumeOrderFills` (`:267-301`): compute `delta := realizedDelta(existing.Qty, existing.CostBasis, fill.Qty, fill.FillPrice)` when `existing != nil` (guard `existing == nil` → delta `0`, and a redelivered post-close sell must not nil-deref — design § 1).
   - Partial reduce branch (`newQty > 0`, `:292-301`): persist the delta by passing it as the new `$8` arg to `UpsertPosition` (see step 5 below), so `realized_accum` accumulates via `ON CONFLICT ... SET realized_accum = portfolio.positions.realized_accum + $8`.
   - Full-close branch (`newQty <= 0`, `:287-291`): the row is DELETEd, so the cumulative goes into the **emitted payload only** — never persisted onto the deleted row. Enrich the `portfolio.position.closed` payload to `{"user_id": fill.UserID, "symbol": fill.Symbol, "account_id": acctID, "trading_mode": <mode string>, "realized_pnl": existing.RealizedAccum + delta}` (guard `existing == nil` → `realized_pnl` 0). For the trading-mode string use `mode.String()` (the same form `UpsertPosition` writes at `portfolio_repo.go:61`) — no existing `portfolio.position.*` payload carries `trading_mode` today, so this establishes the form; the Step 8 consumer's `position_id` synthesis and seal must read it back as `mode.String()`.
4. In `portfolio_repo.go`: extend `UpsertPosition` to take a `realizedDelta float64` param and add `realized_accum = portfolio.positions.realized_accum + $8` to the `ON CONFLICT ... DO UPDATE SET` clause; on insert set `realized_accum` to the delta. Load `RealizedAccum` when reading a position (so `existing.RealizedAccum` is populated at `:261`'s `GetPosition`).
5. Account-scope `ClosePosition`: change its SQL to `... AND trading_mode=$3 AND account_id=$4`, add an `accountID string` param to the signature, and pass `acctID` at the `:288` call-site. Grep-confirm no other caller of `ClosePosition` exists before changing the signature.

**Named v1 scope limitation** (design § 1, must be stated, not silently dropped — P-03): `realized_accum`
accumulation is exact only for **long, order-fill-originated positions**. A short opened via
`account.positions.synced` and covered by a live buy takes the "buying more" branch, so `realizedDelta`
is not invoked and `realized_accum` understates — `GetPnL` still returns the true figure. This is
attribution-stats-only (the load-bearing invariant, design § 3). Do **not** accumulate in
`ConsumePositionSyncs` (rejected — sync has no per-leg price, reintroduces the 056 dual-source path).

**Header propagation (C-03/step-constraints §B)**: this step adds **no new outbound gRPC call** — the
only new emission reuses the existing `emitEvent`/ledger path. No propagation change required; state
this in the PR.

**Verification** (lint; behavior asserted in Step 5):
```
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 5 — test: portfolio realizedDelta characterization + close-payload parity + account-scope

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go` — modify

**Reviewers**: xstockstrat-portfolio owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- The existing byte-for-byte `applyFill` mirror lives in `portfolio_helpers_test.go:114-166` (`TestPositionMath_*`, `TestRealizedPnL_*`) — a duplicated copy of the reduce math (design Open Risk: collapse it to call `realizedDelta` so no third DRY copy exists).
- Portfolio has **no** `internal/testdata/` home (`ls services/xstockstrat-portfolio/internal/testdata/` → absent); tests declare inline literals. The realized-P&L scenario values have a single consumer here → inline is C-13-compliant.

**TDD**: `red-green required`

**Covers**: `AC-2` (producer half — the enriched `portfolio.position.closed` payload analysis seals on), `AC-7` (the close event that becomes the pattern-computed audit event)

**Instructions**:
1. **Characterization pin (red-before-green)**: before Step 4's extraction, add a test asserting the *current* `GetPnL` realized figure for a known multi-fill long (open + partial sell + full close). After extraction it must be byte-identical — proves the extraction is behavior-preserving (design Open Risk).
2. **Collapse the DRY mirror**: rewrite `TestRealizedPnL_*` (`:114-166`) to call `realizedDelta` directly instead of re-declaring the closure, so the reduce math has exactly one implementation + one test surface (C-10(b), insights.md 2026-07-24 shared-helper).
3. **Enriched-payload parity test** (C-10(b), 056 fail): drive `ConsumeOrderFills` through a full close of a multi-leg long and assert the emitted `portfolio.position.closed` payload carries `account_id`, `trading_mode`, and a `realized_pnl` equal to `GetPnL`'s realized figure for the **same** fills, **for the long order-fill-originated scope only** (the parity assertion is scoped per the named v1 limitation). Include a **partial-reduce** case asserting `realized_accum` accumulates the delta (fill-state completeness: partial + full, step-constraints §A).
4. `existing == nil` guard test: a redelivered post-close sell must emit `realized_pnl: 0` and not panic.
5. Account-scope test: `ClosePosition` deletes only the matching `account_id`'s row (a second account's position for the same `(user, symbol, mode)` survives).

**Verification**:
```
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```
Confirm total coverage ≥ 40%. Note: `realizedDelta` and the reduce/close logic live in the
`service` package (excluded from CI coverage measurement — spec-template) — the pin/parity tests are
the substantive proof; coverage gate is still asserted on the module total.

---

### Step 6 — migration: analysis 016 order_snapshots + pnl_positions + pnl_pattern_samples + ledger_stream_cursor

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/016_order_snapshots_pnl_patterns.up.sql` — create
- `services/xstockstrat-analysis/migrations/016_order_snapshots_pnl_patterns.down.sql` — create

**Reviewers**: DBA — migration NNN numbering / up+down pair / hypertable partitioning / index correctness; xstockstrat-analysis owner — no look-ahead bias, backtest reproducibility

**Codebase Evidence**:
- Last analysis migration is `015_backtest_runs_user_id` (`ls services/xstockstrat-analysis/migrations/`); no remote branch carries `016` (§ Step Dependencies) → **016** next-free (C-07).
- Template: `006_backtest_runs.up.sql` (schema-qualified `analysis.*`, `IF NOT EXISTS`, `idx_` index naming) — recon § Patterns to REUSE.
- Timescale hypertable PK/UNIQUE must include the partition column (`event_ts`) — product spec § Database note; design § 2.

**TDD**: `N/A (migration)`

**Covers**: `—` (table behavior asserted by Step 9)

**Instructions** — create four tables in the `analysis` schema (design § 2):
1. `analysis.order_snapshots` — Timescale hypertable on `event_ts`; `PRIMARY KEY (id, event_ts)` (partition column in PK); `UNIQUE (event_id, event_ts)` for `INSERT ... ON CONFLICT DO NOTHING` dedup; `event_ts` set from `LedgerEvent.recorded_at` (immutable server ts — byte-identical on redelivery, design § 2). Columns: `id BIGSERIAL`, `event_id TEXT NOT NULL`, `order_id TEXT NOT NULL`, `position_id TEXT NOT NULL`, `symbol TEXT NOT NULL`, `event_type TEXT NOT NULL`, `event_ts TIMESTAMPTZ NOT NULL`, `strategy_id TEXT`, `side TEXT`, `quantity NUMERIC`, `price NUMERIC`, `ohlcv_bar JSONB`, `indicators JSONB`, `signals JSONB`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. `SELECT create_hypertable('analysis.order_snapshots', 'event_ts', if_not_exists => TRUE);` Indexes on `(position_id, event_ts DESC)` and `(symbol, event_ts DESC)`.
2. `analysis.pnl_positions` — the synthesized open→close window: `position_id TEXT` (synthesized), `user_id`, `account_id`, `symbol`, `trading_mode`, `strategy_id`, `opened_at`, `closed_at TIMESTAMPTZ`, `realized_pnl NUMERIC`, `open_event_id`, `close_event_id`. Partial unique index `... (user_id, account_id, symbol, trading_mode) WHERE closed_at IS NULL` (one open per identity key — account_id included, design § 2). Not a hypertable → plain `BIGSERIAL PRIMARY KEY`.
3. `analysis.pnl_pattern_samples` — raw store, one row per (sealed position × factor): `symbol`, `strategy_id`, `factor_name`, `factor_type` (`'indicator'|'signal'`), `indicator_value NUMERIC` (NULLABLE), `signal_present BOOLEAN`, `realized_pnl NUMERIC`, `closed_at TIMESTAMPTZ`, `close_event_id TEXT`, `position_id TEXT`. **No factor UNIQUE** (dissolves the NULL-in-UNIQUE signal bug, design § 2). Index on `(symbol, factor_type, closed_at DESC)`.
4. `analysis.ledger_stream_cursor` — `(consumer TEXT PRIMARY KEY, last_sequence BIGINT NOT NULL DEFAULT 0)`, single row per consumer.
5. `.down.sql`: `DROP TABLE IF EXISTS` all four in reverse dependency order (samples, positions, then the hypertable `order_snapshots`, then cursor) — Timescale drops the hypertable with the table.

**Verification** (offline, no DB):
```
ls services/xstockstrat-analysis/migrations/016_*.up.sql services/xstockstrat-analysis/migrations/016_*.down.sql
```
Read both: confirm every `CREATE TABLE`/`create_hypertable`/`CREATE INDEX` in `.up.sql` has an inverse `DROP` in `.down.sql`, and the hypertable PK/UNIQUE include `event_ts`.

---

### Step 7 — config: declare the four analysis snapshot/pattern config keys

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (declare defaults)
- `docs/patterns/config-governance.md` — modify (Per-Feature Registered Keys log row)

**Reviewers**: xstockstrat-analysis owner — config key adder; config team (new config key governance gate — root CLAUDE.md § Config Governance Rules; product-spec § Config correction supersedes the two `trading.snapshot.*` keys and `analysis.patterns.pnl_bucket_size`)

**Codebase Evidence**:
- Config-read pattern in analysis is `self._cfg.get_int(...)` / `self._cfg.get_float(...)` via `ConfigWatcher` (`services/xstockstrat-analysis/app/handlers/servicer.py:36,156,316,410`, e.g. `self._cfg.get_int("analysis.backtest.max_range_days", 730)`). New keys are read the same way in Steps 8/10 (F-07 — no hardcoded values).
- Naming `<service>.<category>.<key>` (C-05); defaults declared in the service CLAUDE.md.

**TDD**: `N/A (config)`

**Covers**: `—`

**Instructions**:
1. Declare in `services/xstockstrat-analysis/CLAUDE.md` (new "Config Keys Consumed" rows) the four keys with defaults (design § Config — these **replace** the product spec's `trading.snapshot.*` and `analysis.patterns.pnl_bucket_size`):
   - `analysis.snapshot.indicator_timeout_ms` — int, `500` — max ms to wait for indicator values during snapshot compose; timeout → empty indicators map (FR-6).
   - `analysis.snapshot.signal_timeout_ms` — int, `500` — max ms to wait for signal values; timeout → empty signals list (FR-6).
   - `analysis.patterns.min_sample_count` — int, `5` — minimum samples in a bucket before a factor appears in `QueryPnLPatterns` results.
   - `analysis.patterns.indicator_bucket_count` — int, `5` — number of quantile buckets for indicator-value factor grouping at query time.
2. Add a Per-Feature Registered Keys row for feature 042 in `docs/patterns/config-governance.md`.

**Verification**:
```
grep -n "analysis.snapshot.indicator_timeout_ms\|analysis.snapshot.signal_timeout_ms\|analysis.patterns.min_sample_count\|analysis.patterns.indicator_bucket_count" services/xstockstrat-analysis/CLAUDE.md
```
Confirm all four keys with their defaults are declared; confirm the governance log row exists.

---

### Step 8 — service: analysis ledger StreamEvents consumer (snapshot capture + position seal + pattern samples)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/order_snapshots.py` — create
- `services/xstockstrat-analysis/app/repositories/pnl_positions.py` — create
- `services/xstockstrat-analysis/app/repositories/pnl_pattern_samples.py` — create
- `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py` — create
- `services/xstockstrat-analysis/app/main.py` — modify (register the boot task)
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (expose the compose helper / stubs if needed)

**Reviewers**: xstockstrat-analysis owner — no look-ahead bias, backtest reproducibility, determinism

**Codebase Evidence**:
- Repo template: `services/xstockstrat-analysis/app/repositories/backtest_runs.py` (recon § Patterns to REUSE); single shared asyncpg pool (`app/main.py:48`, F-06) — **no new pool**.
- Background-loop pattern: `FundamentalsSignalLoop.run_forever` (`app/engine/fundsignal_loop.py:82`), registered as a boot task in `app/main.py:153` (`asyncio.get_event_loop().create_task(fundsignal_loop.run_forever())`); mirror this registration for the new consumer.
- Ledger client already dialed: `app/main.py:31,64` (`LEDGER_ENDPOINT`, `ledger_channel`); servicer holds `self._ledger` and calls `AppendEvent` (`servicer.py:340,667,1341,1990`) and can open `StreamEvents` on the same stub.
- Snapshot composition to REUSE (do NOT reimplement): screener `_latest_indicator` (`app/services/screener.py:301`), `_technical_value` (`:344`), and `QuerySignals(symbol=...)` (`:333`) — indicator resolution from the order's `strategy_id` via the strategy definition components (recon § Patterns to REUSE).
- Marketdata (OHLCV bar) already dialed: `self._marketdata` (`servicer.py:130`, `app/main.py:61`), with the feature-071 pagination helper for `GetBars` (`servicer.py:680`).
- `StreamEvents` contract: `packages/proto/ledger/v1/ledger.proto:16,68-71` — `StreamEventsRequest{stream_key, event_type, from_sequence}`, both filters optional; `LedgerEvent.sequence` global monotonic (`:29`, comment fixed Step 1); `recorded_at` (`:26`) immutable server ts.
- Best-effort ledger/DB norm: `try/except → log.warning` (`servicer.py:1982`, recon).
- **Emitted `order.*` event strings (match exactly)**: trading emits `order.created` (`trading.go:578`), `order.filled` (`:1220`), `order.partially_filled` (`:1236`), and `order.canceled` (`:828,1248` — American one-`l` spelling; documented in `services/xstockstrat-trading/CLAUDE.md:117`). The consumer must match these literal strings.

**TDD**: `red-green required`

**Covers**: `—` (behavior asserted in Step 9)

**Instructions** (design § 2 — single broad subscription, strict sequence order, compose-before-txn):
1. Add three thin asyncpg repos (mirror `backtest_runs.py`) over the Step 6 tables, using the shared pool.
2. New `pnl_pattern_consumer.py` with a `run_forever()` entry (mirror `fundsignal_loop.run_forever`): open **one** `StreamEvents(from_sequence=cursor.last_sequence)` with **both filters null** (preserves the ledger's global sequence order — design § 2). Per event:
   - (1) **short-circuit** if `event.sequence <= cursor.last_sequence` before any mutation (kills replay phantom-opens).
   - (2) skip analysis's own `analysis.*` emissions (never self-consume).
   - (3) On `order.*` events (`order.created`/`order.filled`/`order.partially_filled`/`order.canceled` — note the American one-`l` spelling: trading emits these exact strings at `services/xstockstrat-trading/internal/service/trading.go:578,1220,1236,828,1248`; matching the British `order.cancelled` would silently never capture cancels): **compose the snapshot BEFORE opening the DB transaction** — gRPC reads to indicators/ingest/marketdata via the screener composition, indicators resolved from the order's `strategy_id`; wrap each read in best-effort `try/except` bounded by `analysis.snapshot.indicator_timeout_ms` / `analysis.snapshot.signal_timeout_ms` → on timeout/error, a **partial** snapshot (empty indicators map / empty signals list), never abort (FR-6). `position_id` is synthesized from `(user_id, account_id, symbol, trading_mode)` + open window (recon Risk — `Order` has no `position_id`; do not guess a nonexistent field).
   - (4) In ONE DB transaction: insert `order_snapshots` (`ON CONFLICT (event_id, event_ts) DO NOTHING`), open/seal `pnl_positions`, and `UPDATE ledger_stream_cursor` — atomic so a crash never advances the cursor past unwritten data. On a `portfolio.position.closed` event: seal the matching open `pnl_positions` row (stamp `closed_at`/`realized_pnl` from the **enriched** payload's `realized_pnl` — Step 4 — /`close_event_id`, deduped on `close_event_id`), then write one `pnl_pattern_samples` row per factor present in that position's entry/exit snapshots (indicator value buckets deferred to query time — raw store). An empty-window close (pre-deploy open, no snapshots) **no-ops** (out-of-scope: no historical backfill, product spec § Out of Scope).
   - (5) After commit, emit best-effort audit events (FR-7): `analysis.snapshot.captured` per snapshot and `analysis.pattern.sealed` per sealed position via `AppendEvent`; on a degraded/partial snapshot emit a WARN-level `analysis.snapshot.degraded` (AC-6). Use the existing best-effort `try/except → log.warning` around `AppendEvent`.
3. **Seal-time completeness diagnostic** (design Open Risk — v1 named limitation): at seal, log a WARN if the snapshot count for the position is lower than expected (a `QueryEvents` count check); v1 accepts a possibly-incomplete window. Name the v2 reconciliation (rebuild from ledger) as the tracked follow-up in the Step 14 docs.
4. Register the consumer as a boot task in `app/main.py` beside the fundsignal loop (`:153`): `asyncio.get_event_loop().create_task(pnl_pattern_consumer.run_forever())`. It must be non-blocking and never delay server start (matches `:131` note).

**Header propagation (C-03/step-constraints §B)**: the consumer's outbound reads to
indicators/ingest/marketdata run in a **background** context (no inbound per-request user context to
propagate) and reuse the screener composition, which already threads `propagation_meta`
(`screener.py:301,333,344`). Cite this reuse in the PR; no new propagation mechanism is added.

**Verification** (lint; behavior asserted in Step 9):
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 9 — test: analysis consumer idempotency / ordering / timeout / seal / audit

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py` — create
- `services/xstockstrat-analysis/tests/conftest.py` — modify (only if a snapshot/event domain fixture gains a **second** consumer — C-13)

**Reviewers**: xstockstrat-analysis owner — no look-ahead bias, determinism, backtest reproducibility

**Codebase Evidence**:
- C-13 home exists: `services/xstockstrat-analysis/tests/conftest.py`. A snapshot/ledger-event literal stays inline while it has one consumer; a second consumer moves it to `conftest.py` (materialize lazily — do not create fixtures speculatively).
- Existing servicer/consumer test style: `services/xstockstrat-analysis/tests/test_analysis_servicer.py`, `test_analysis_helpers.py`.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-6, AC-7`

**Instructions** (each assertion written to fail against the pre-Step-8 tree — P-06):
1. **AC-1**: feed an `order.filled` event (indicators+ingest return within timeout) → assert an `order_snapshots` row exists keyed to the order id and synthesized position id, `event_type = filled`, non-empty `indicators` map and non-empty `signals` list.
2. **AC-2**: given ≥5 completed trades' snapshots for a symbol, feed the enriched `portfolio.position.closed` event → assert the open `pnl_positions` row seals and `pnl_pattern_samples` rows are written; assert the seal happens on consuming the close event (the "within 10 s" bound is satisfied by synchronous consume-and-write — assert the write occurs in the same consume call, not a wall-clock sleep). Include the **partial-fill** path (`order.partially_filled`) alongside the full-fill path (fill-state completeness, step-constraints §A).
3. **AC-6**: indicators do not respond within `analysis.snapshot.indicator_timeout_ms` → assert the order still yields a stored **partial** snapshot with an **empty** indicators map, and a WARN-level `analysis.snapshot.degraded` event is emitted to the ledger. Add the **teeth** companion (insights.md 2026-07-27): a non-degraded control that emits `captured`, not `degraded`, so an inert timeout patch can't masquerade as a pass.
4. **AC-7**: assert the ledger receives an `analysis.snapshot.captured` event and an `analysis.pattern.sealed` (pattern-computed) event with the correct `event_type` values.
5. **Idempotency/ordering** (design § 2): redeliver the same event (same `sequence`) → assert exactly one `order_snapshots` row (`ON CONFLICT DO NOTHING`) and the cursor does not regress; feed an out-of-order lower-`sequence` event after a higher one → assert the short-circuit skips it before any mutation.

**Verification**:
```
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```
Confirm coverage ≥ 40% and lint clean.

---

### Step 10 — service: analysis QueryPnLPatterns RPC (query-time quantile bucketing)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (add the RPC)
- `services/xstockstrat-analysis/app/repositories/pnl_pattern_samples.py` — modify (add the query)

**Reviewers**: xstockstrat-analysis owner — determinism, no look-ahead bias

**Codebase Evidence**:
- Servicer RPC shape: `async def <Name>(self, request, context)` (e.g. `RunBacktest` `servicer.py:314`, `ScoreStrategy` `:1272`); RPC registered via `analysis_pb2_grpc.add_AnalysisServiceServicer_to_server(servicer, grpc_server)` (`app/main.py:73`) — a new method on the servicer is picked up automatically once the stub (Step 2) declares it.
- Config reads for bucketing thresholds: `self._cfg.get_int("analysis.patterns.min_sample_count", 5)` and `self._cfg.get_int("analysis.patterns.indicator_bucket_count", 5)` (Step 7; pattern `servicer.py:410`) — F-07, no hardcoded values.

**TDD**: `red-green required`

**Covers**: `—` (behavior asserted in Step 11)

**Instructions** (design § 3 — bucket at query time, not incrementally):
1. Add `async def QueryPnLPatterns(self, request, context)` to the servicer.
2. Read `pnl_pattern_samples` filtered by `request.symbol` (and `strategy_id`/`from_ts`/`to_ts` when set) via the repo.
3. For **indicator** factors: split each factor's samples into `analysis.patterns.indicator_bucket_count` quantile buckets (data-dependent boundaries), drop buckets with fewer than `analysis.patterns.min_sample_count` samples, and compute `avg_pnl_impact` per surviving bucket with its `value_range_low`/`value_range_high`. For **signal** factors: group by `signal_present`, same min-sample drop.
4. Split factors into `positive_factors` (`avg_pnl_impact > 0`) and `negative_factors` (`< 0`), rank each by `|avg_pnl_impact|` descending, apply `request.limit`.
5. Return `QueryPnLPatternsResponse{positive_factors, negative_factors}` populating `PnLPatternFactor` fields incl. `factor_type` enum (never leave it `FACTOR_TYPE_UNSPECIFIED`).

**Header propagation (C-03)**: this RPC makes **no outbound gRPC call** (DB-only read) — no propagation change; state this in the PR.

**Verification** (lint; behavior asserted in Step 11):
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 11 — test: analysis QueryPnLPatterns ranked factors

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_query_pnl_patterns.py` — create

**Reviewers**: xstockstrat-analysis owner — determinism, no look-ahead bias

**Codebase Evidence**:
- Test style + servicer fixtures: `services/xstockstrat-analysis/tests/test_analysis_servicer.py`; C-13 home `tests/conftest.py`.

**TDD**: `red-green required`

**Covers**: `AC-3`

**Instructions**:
1. Seed `pnl_pattern_samples` for AAPL with ≥5 analyzed trades spanning indicator-value ranges and signal presence, `analysis.patterns.min_sample_count = 5`.
2. Call `QueryPnLPatterns(symbol="AAPL", limit=10)` → assert `positive_factors` has ≥1 and `negative_factors` has ≥1, and each returned factor carries `factor_name`, a set `factor_type` (`FACTOR_TYPE_INDICATOR` or `FACTOR_TYPE_SIGNAL`), `sample_count`, and `avg_pnl_impact`.
3. Assert a factor whose only bucket has `< min_sample_count` samples is **absent** (the min-sample drop has teeth).

**Verification**:
```
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 12 — service: /insights P&L Patterns view + hook + BFF forward + nav triple-registration

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/pnl-patterns/page.tsx` — create
- `services/xstockstrat-ui/src/hooks/usePnLPatterns.ts` — create
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify (add `queryPnLPatterns` forward)
- `services/xstockstrat-ui/src/components/shared/navGroups.tsx` — modify (register nav entry)
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify (register legacy `PLATFORM_SUBNAV` entry)

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, Connect-RPC call safety, no secret values rendered

**Codebase Evidence**:
- Page pattern: `services/xstockstrat-ui/src/app/insights/strategies/page.tsx` (recon § UI); hook pattern `services/xstockstrat-ui/src/hooks/useOpportunities.ts:1,17-20` (`useQuery` + `analysisClient.<method>`).
- Browser client auto-exposes the new method: `analysisClient = createClient(AnalysisService, transport)` (`src/lib/browserClients/analysisClient.ts:6`) — no edit needed; `queryPnLPatterns` appears once the stub (Step 2) declares the RPC.
- BFF router: `router.service(AnalysisService, { ... })` (`src/lib/insightsBff.ts:26`), existing one-liner forward `listOpportunities: forward((req, opts) => analysisClient.listOpportunities(req, opts))` (`:53`) — add `queryPnLPatterns` the same way (a **read**, so no `requireAdminScope`).
- **Nav is triple-sourced** (recon Risk / C-10(a)): the real rendered source `NAV_GROUPS` (`src/components/shared/navGroups.tsx:41`, entries under the "Engine" group `:62-67`), the legacy `PLATFORM_SUBNAV` (`src/components/shared/PlatformHeader.tsx:72-84`, insights block `:79-83`), and the reachability-spec `GROUPS` (Step 13). All three must gain the entry or the C-10(a) test / rendered nav drift.

**TDD**: `red-green required`

**Covers**: `—` (surfaces AC-4/AC-5; asserted in Step 13)

**Instructions**:
1. Add `queryPnLPatterns: forward((req, opts) => analysisClient.queryPnLPatterns(req, opts))` to the `AnalysisService` router in `insightsBff.ts` (no admin gate — it is a read).
2. `usePnLPatterns.ts`: mirror `useOpportunities` — `useQuery` calling `analysisClient.queryPnLPatterns({ symbol, limit })`.
3. `pnl-patterns/page.tsx`: mirror `insights/strategies/page.tsx` — render **top positive-contributing** and **top negative-contributing** factor cards from `positive_factors`/`negative_factors`, plus a per-order snapshot timeline placeholder (FR-5). Client component using the hook.
4. Register the nav entry in **all three** sources:
   - `navGroups.tsx` — add `{ label: 'P&L Patterns', href: '/insights/pnl-patterns' }` under the "Engine" insights group (`:62-67`).
   - `PlatformHeader.tsx` `PLATFORM_SUBNAV` — add the same `{ label: 'P&L Patterns', href: '/insights/pnl-patterns' }` to the insights block (`:79-83`).
   - (the reachability spec `GROUPS` entry is added in Step 13.)

**Verification** (lint; behavior asserted in Step 13):
```
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 13 — test: UI P&L Patterns e2e render + nav reachability + fixture

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/pnlPatterns.ts` — create (new fixture)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog row)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (`queryPnLPatterns` handler)
- `services/xstockstrat-ui/e2e/insights/pnl-patterns.spec.ts` — create
- `services/xstockstrat-ui/e2e/nav-reachability.spec.ts` — modify (add `GROUPS` entry)

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Fixtures home + catalog: `services/xstockstrat-ui/e2e/fixtures/` + `INVENTORY.md` (C-12). No P&L-pattern fixture exists (`grep -in "pnl\|pattern" e2e/fixtures/INVENTORY.md` → none) → **new fixture required** with a catalog row.
- Auth helpers (never re-implement JWT): `addAuthCookie`/`addAdminCookie` (`e2e/nav-reachability.spec.ts:2` imports from `./helpers/auth`).
- Reachability spec walks `GROUPS` (`e2e/nav-reachability.spec.ts:21,69`) — the new nav entry must be added to `GROUPS` and asserted navigable.
- Fixture shape follows the proto (Connect-JSON camelCase): `xstockstrat.analysis.v1.QueryPnLPatternsResponse` (`positiveFactors`/`negativeFactors` of `PnLPatternFactor`).

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5`

**Instructions**:
1. `pnlPatterns.ts`: export a `QueryPnLPatternsResponse` fixture (`PNL_PATTERNS_AAPL`) with ≥1 positive and ≥1 negative `PnLPatternFactor` (camelCase, distinct field values so the assertion tests which field the UI reads — insights.md 2026-07-27 fixture-distinguishability). Add an `INVENTORY.md` row (entity, symbol, module, proto type, consumers).
2. `mock-backend.ts`: add a `queryPnLPatterns` handler returning the fixture, importing it from `e2e/fixtures/` (never an inline literal — C-12).
3. `pnl-patterns.spec.ts` (**AC-4**): open `/insights/pnl-patterns`, assert the page loads without error and renders ranked top-positive and top-negative factor cards from the fixture.
4. `nav-reachability.spec.ts` (**AC-5**): add the `{ label: 'P&L Patterns', href: '/insights/pnl-patterns' }` entry to `GROUPS` and assert it is present and navigable from the insights sub-nav. Run at least once against a broader scope, not just the single spec (fails.md 2026-08-09 — nav locator collisions surface on a different spec).

**Verification**:
```
cd services/xstockstrat-ui && pnpm test:e2e -- pnl-patterns nav-reachability
cd services/xstockstrat-ui && pnpm run lint
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/insights/pnl-patterns.spec.ts services/xstockstrat-ui/e2e/mock-backend.ts
```
Confirm the two specs pass, the mock/spec import fixtures (no inline domain literals), and `INVENTORY.md` carries the new row. (`xstockstrat-ui` has no numeric coverage threshold — e2e is the gate, spec-template.)

---

### Step 14 — docs: analysis consumer/retention + portfolio producer contract + named v2 follow-up

**Status**: `pending`
**Service**: `docs` / service CLAUDE.md files
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (consumer + retention note)
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (enriched `portfolio.position.closed` producer contract)
- `docs/roadmap/features/042-order-snapshots-pnl-patterns/context.md` — modify (named v2 follow-up)

**Reviewers**: none (docs)

**Codebase Evidence**:
- Portfolio CLAUDE.md § "Ledger Events Emitted" already documents `portfolio.position.closed` (the payload contract lives here) — extend it with the new keys.
- Analysis CLAUDE.md documents its background loops (§ fundsignal loop) — add the new consumer beside it.

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. Portfolio CLAUDE.md: document the enriched `portfolio.position.closed` payload keys (`user_id, symbol, account_id, trading_mode, realized_pnl`) as a **producer contract** (C-10(b)), and note `realized_accum` is attribution-stats-only, never a user-facing figure (the load-bearing invariant, design § 3). Record the named v1 scope limitation (long order-fill-originated positions only).
2. Analysis CLAUDE.md: document the new ledger `StreamEvents` consumer (single broad subscription, global-sequence order, atomic snapshot+seal+cursor txn, best-effort compose), the four migration-016 tables, and that **snapshot retention is v1-absent and MUST be position-lifecycle-keyed** (drop only after seal — design Open Risk), never time-based Timescale retention.
3. context.md: name the **v2 snapshot reconciliation** (rebuild an incomplete window from the ledger via `QueryEvents`) as a concrete tracked follow-up (add-ikbr lesson — a documented follow-up left vague becomes a production bug).
4. Run `/context-scrubber scan` scoped to the touched CLAUDE.md files (root CLAUDE.md § Teardown); fix grounded findings. If the context-forge plugin is unavailable, say so in the PR body.

**Verification**:
```
grep -n "account_id\|trading_mode\|realized_pnl\|realized_accum" services/xstockstrat-portfolio/CLAUDE.md
grep -n "StreamEvents\|order_snapshots\|retention" services/xstockstrat-analysis/CLAUDE.md
```
Confirm the producer contract, consumer, and retention note are present.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
