# Recon: order-snapshots-pnl-patterns

**Created**: 2026-08-19
**From**: product-spec.md
**Affected services**: xstockstrat-trading, xstockstrat-portfolio, xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis, xstockstrat-ledger, xstockstrat-ui (insights), packages/proto

---

## Objective

At each order lifecycle event, capture a snapshot of the symbol's indicator values, active signals, and
OHLCV; on position close, attribute realized P&L to the factors (indicators/signals) present, exposed
via a new `QueryPnLPatterns` RPC and an `/insights` P&L Patterns view. Correlation-only, query-on-demand.

## Codebase Map

- **`xstockstrat-trading`** (Go, 50051) — order lifecycle emits already async (`go emitLedgerEvent`):
  created in `submitOrder` (`internal/service/trading.go:540,578`); filled/partially_filled/canceled/rejected
  in the fill-poller status `switch` (`trading.go:1218-1256`) with the full `*Order` (symbol, qty, price,
  account_id, user_id, strategy_id, trading_mode) in scope. Clients dialed: ledger/notify/portfolio/marketdata
  (`trading.go:87-92,161-187`). **NOT dialed: indicators, ingest** (`IndicatorsEndpoint` is dead wiring
  `config.go:26,42`; no ingest var at all). `emitLedgerEvent` helper `trading.go:3044-3055`. Header
  interceptor `internal/middleware/propagation.go:27,39`. Last migration `007`. Pool PgBouncer, DB_POOL_MAX unset.
- **`xstockstrat-portfolio`** (Go, 50052) — **already emits `portfolio.position.closed`** to ledger when
  net qty ≤ 0 (`portfolio_service.go:287-291`), stream_key `portfolio:{user_id}`, **payload = `{user_id,
  symbol}` only** (no realized_pnl / account_id / trading_mode). Realized P&L computed lazily at query time
  in `GetPnL` (`:499-652`), NOT at close. `emitEvent`/AppendEvent `:783-809`. Consumes ledger StreamEvents
  (`:184`, consumers in `cmd/server/main.go:64-68`). Last migration `009`. Pool PgBouncer, DB_POOL_MAX unset.
  `PnLResponse.realized_pnl=1` (`portfolio.proto:113`); **no realized_pnl on `Position`**; no per-close P&L figure.
- **`xstockstrat-indicators`** (Python, 50054) — **no point-in-time "current values for a symbol" RPC.**
  `ComputeIndicator`/`ExecuteFormula` are stateless: caller supplies the input series, gets a series back
  (`indicators.proto:16,20,43-88`). "Latest value" is composed caller-side.
- **`xstockstrat-ingest`** (Python, 50055) — `QuerySignals(symbol=...)` returns active `ExternalSignal`s with
  `conviction` (`ingest.proto:22,128-139,105-117`).
- **`xstockstrat-analysis`** (Python, 50056) — **owns the composition logic already**: screener
  `_latest_indicator`/`_technical_value` do fetch-bars→ComputeIndicator→last-point with tail-align
  (`screener.py:301-388`); dials indicators+ingest (`servicer.py:131-132`, `main.py:62-63`), portfolio
  (`servicer.py:143`, `ListPositions :2850`), marketdata, ledger (write-only). **No StreamEvents consumer
  anywhere** (analysis only `AppendEvent`s). Background-loop pattern `fundsignal_loop.run_forever`
  (`fundsignal_loop.py:82`), boot tasks `main.py:127,153,159`. Repo template `BacktestRunsRepository`
  (`app/repositories/backtest_runs.py:22,25,70`), single pool budget 2 (`main.py:48`, F-06). Servicer RPC
  shape `async def X(self, request, context)` (`servicer.py:1626`), registered `main.py:73`. **Factor
  attribution is net-new** (evaluator does condition-tracing only; grep `attribution|factor` empty). Best-effort
  `try/except→log.warning` ledger/DB norm (`servicer.py:1982,1651`). Last migration `015` → **next 016**.
- **`xstockstrat-ledger`** (Node, 50057) — `AppendEvent` + `StreamEvents(stream_key?, event_type?,
  from_sequence)` replay-then-live, deduped by sequence, per-subscriber filter both fields optional
  (`ledger.proto:13-18,20-31,33-52,68-72`; `ledgerServiceImpl.ts:187-274`; `eventNotifier.ts:143-152`).
  Payload free-form `Struct`; `event_type` free TEXT (no allow-list) → new event types need no ledger change.
  Single dedicated LISTEN conn; direct-pool (DB_POOL_MAX=1 + 1 listener). Stream-key conventions:
  trading `order:{order_id}`, portfolio `portfolio:{user_id}` (`ledger/CLAUDE.md:96-104`).
- **`xstockstrat-ui`** (Next.js, insights) — **nav source of truth is `NAV_GROUPS`** (`navGroups.tsx:41,51-66`),
  NOT the legacy retained `PLATFORM_SUBNAV` (`PlatformHeader.tsx:68-84`); the reachability test walks
  `GROUPS` in `e2e/nav-reachability.spec.ts:21-89`. BFF: add `queryPnLPatterns` to the `AnalysisService`
  router (`insightsBff.ts:26,53,135`); browser client auto-exposes it (`browserClients/analysisClient.ts:5-6`).
  Page pattern `insights/strategies/page.tsx` + hook `useOpportunities.ts:17-23`. Fixtures home
  `e2e/fixtures/` + `INVENTORY.md` (new P&L-pattern fixture needed). Vitest `src/lib/**` (`scoreDisplay.ts` + `.test.ts`).

## Patterns to REUSE

- Snapshot composition (indicator values + signals + OHLCV for a symbol) → reuse analysis's screener
  `_latest_indicator`/`_technical_value`/`QuerySignals(symbol)` logic (`screener.py:301-388`) — do NOT
  reimplement in Go.
- Which indicators → resolve from the order's `strategy_id` → strategy definition components (analysis owns
  strategy defs + the evaluator's component resolution).
- New tables → mirror `BacktestRunsRepository` + `006_backtest_runs.up.sql` (schema-qualified, `IF NOT EXISTS`,
  `idx_`), single shared pool (no new pool — F-06).
- Async trigger → analysis's FIRST ledger `StreamEvents` consumer, mirroring portfolio's consumer goroutines
  (`portfolio cmd/server/main.go:64-68`) as an asyncio boot task like `fundsignal_loop.run_forever`.
- Audit events (FR-7) → reuse `emitLedgerEvent` (trading) / `AppendEvent` best-effort (analysis).
- UI → mirror `insights/strategies` page + `useOpportunities` hook + `insightsBff` router one-liner;
  register nav in `NAV_GROUPS` + `PLATFORM_SUBNAV` + the reachability spec `GROUPS`.
- Enum: `SnapshotEventType`/`FactorType` with `*_UNSPECIFIED = 0` (C-04).

## Dependencies

- Proto/RPC: new `analysis.proto` messages (`OrderSnapshot`, `PnLPatternFactor`) + `QueryPnLPatterns` RPC
  (additive; service block `analysis.proto:12`, last RPC `GetIndicatorSeries :46`; highest field numbers
  StrategyDefinition=14, Opportunity=12 — new messages number fresh). No breaking change.
- Migration: analysis **016** (two tables). No new migration in trading/portfolio if the design is
  analysis-centric (snapshots persisted in analysis).
- Config keys: `trading.snapshot.indicator_timeout_ms`, `trading.snapshot.signal_timeout_ms`,
  `analysis.patterns.min_sample_count`, `analysis.patterns.pnl_bucket_size` (spec) — **note:** if compose
  moves to analysis, the two `trading.snapshot.*` keys become `analysis.snapshot.*` (revisit at design).
- Inter-service edges: **no new synchronous edge / no cycle** in the analysis-centric design — analysis→ledger
  (StreamEvents read, new consumer), and analysis→{indicators,ingest,portfolio,marketdata} already exist.
  A trading-centric compose would add trading→indicators + trading→ingest (new edges) and risk a
  trading↔analysis cycle.
- New env vars: none new for the analysis-centric design (analysis already has all endpoints). Trading-centric
  would add `INGEST_ENDPOINT` to trading (+ wire the dead `INDICATORS_ENDPOINT`).

## Risks / Not-found

- **FR-2 "linked to position_id" has no backing field.** `Order` has no `position_id` (`trading.proto:32-55`);
  the close event carries only `{user_id, symbol}`. Position identity must be synthesized (e.g.
  `(user_id, symbol)` + open→close window) — a spec correction, must not be guessed (P-03).
- **FR-3 "realized P&L is finalized" is not true at close.** Realized P&L is derived lazily in `GetPnL`;
  the close event has no P&L. The consumer must call `GetPnL(user_id)` after the close to get it.
- **Snapshot fidelity fork.** No indicators "current values" RPC → composition is caller-side. Composing in
  analysis on the ledger event means values are as-of-consume-time (seconds after the order event), not
  exactly at the order moment (FR-1 "at that moment"). Composing in trading is point-in-time but requires
  2 new trading edges + reimplementing the screener composition in Go + a position lookup.
- **Subscription firehose.** `StreamEvents` filters one stream_key/one event_type per subscription; to see
  all `order.*` across all orders + `portfolio.position.closed`, analysis subscribes broadly (both filters
  null = all events) and filters in-process, or opens N subscriptions. Volume + the single-listener design
  (ledger) to weigh.
- **Which indicators for unattributed orders** (`strategy_id=""`): no strategy → no component set. Define
  the empty/default behavior.
- **Nav double-source** (`NAV_GROUPS` + legacy `PLATFORM_SUBNAV` + reachability spec `GROUPS`) — all three
  must gain the entry or the C-10(a) test/rendered nav drift (ledger 060 / C-10(a)).
- Not-found: no `QueryPnLPatterns`/`OrderSnapshot`/`PnLPatternFactor` anywhere yet; no snapshot tables; no
  point-in-time indicator RPC; no position-close→pattern consumer; no per-close realized-P&L; no explicit
  per-call timeout constant on the analysis indicator/signal reads (FR-6 timeout would be new).

## Recommended Scope

Advisory (input to grilling / `/sdd-spec`):
1. proto: `OrderSnapshot` + `PnLPatternFactor` + `QueryPnLPatterns` (+ `*_UNSPECIFIED` enums) in analysis.proto.
2. analysis migration **016**: `order_snapshots` (hypertable, PK incl. `event_ts`) + `pnl_pattern_factors`.
3. analysis: ledger `StreamEvents` consumer (snapshot capture on `order.*`; pattern trigger on
   `portfolio.position.closed` → `GetPnL` → factor attribution) reusing screener composition; best-effort.
4. analysis: `QueryPnLPatterns` RPC handler.
5. UI: `/insights` P&L Patterns page + hook + `insightsBff` one-liner + `NAV_GROUPS`/`PLATFORM_SUBNAV`/reachability-spec entry + fixture.
6. config keys (namespaced per the compose-location decision) + notify/CLAUDE.md doc.
