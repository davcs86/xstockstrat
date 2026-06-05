# Product Spec: live-strategy-alert-engine

**Created**: 2026-06-01

---

## Problem Statement

Strategies (once feature `047-strategy-engine` lands) can be defined and backtested, but nothing
evaluates them against **live** market data. The only real-time alerts today come from signal
ingestion crossing a conviction threshold or explicit `emit_alert` calls — there is no engine that
watches the market and tells an operator when a defined strategy's entry/exit conditions actually
trigger. This feature adds that continuous **strategy → alert** runtime, reusing the exact same
evaluator the backtest uses so a strategy behaves identically live and in simulation.

## User Story

As a trader, I want the platform to continuously evaluate my active strategies against live market
data and alert me the moment a strategy's entry or exit rule triggers, so that I can act on the
same logic I validated in backtests without manually re-running anything. I also want a dashboard
panel in the trader UI where I can see which strategies are currently live, toggle them on/off,
and view their recent alert history — all without leaving the platform.

## Functional Requirements

FR-1. A continuous evaluation runtime must, on a configurable cadence for each strategy where
`live_enabled = true`, fetch the latest required OHLCV window from
`xstockstrat-marketdata` and active signals from `xstockstrat-ingest` (`QuerySignals`), and run the
**047 shared strategy evaluator** to determine current entry/exit state.

FR-2. **Evaluator parity:** the live runtime must call the *same* evaluator code path as
`RunBacktest` (feature 047), so a strategy's live entry/exit decision for a given bar is identical
to its backtest decision for that bar. No duplicated or divergent strategy logic.

FR-3. On an entry or exit **trigger** (a transition, not a steady state), the runtime must emit an
alert via `xstockstrat-notify` `EmitAlert` containing at minimum: `strategy_id`, symbol, trigger
type (entry/exit), the rule/components that fired, the bar timestamp, and combined conviction.
Alerts must use `category = "strategy"` and include `strategy_id` in both `tags`
(formatted as `"strategy_id:<id>"`) and `context`, so the UI BFF can filter via
`ListAlerts(categories=["strategy"])` without a new proto addition.

FR-4. **Edge-triggered, deduplicated:** an alert fires once per state transition per
(strategy, symbol), not repeatedly while the condition remains true. Per-(strategy, symbol) last
state must be tracked; restart behavior is defined (re-arm without replaying historical triggers).

FR-5. The runtime must support per-strategy enable/disable for live evaluation via a `live_enabled`
flag stored on the `analysis.strategies` row, independent of the strategy's `active` flag (which
gates backtest availability). An operator may backtest a strategy without it alerting live.
The `SetStrategyLive` RPC and `set_strategy_live` MCP tool control this flag; both are admin-scoped.

FR-6. **Safety invariant:** the engine emits **alerts only** — it must never place or trigger
orders, in any trading mode. This is explicit and must be enforced/tested. (Auto-execution, if ever
wanted, is a separate future feature gated on risk controls 023/030.)

FR-7. Observability: each evaluation cycle and each emitted alert must produce ledger events
(e.g. `analysis.strategy.evaluated`, `analysis.strategy.triggered`) and OTel spans, so operators can
audit why an alert did/didn't fire.

FR-8. Resilience: a failure evaluating one strategy or symbol must not halt the loop; market-data /
ingest errors are logged and that strategy is skipped for the cycle. The loop must not drift or
overlap runs (single-flight per cycle).

FR-9. Config keys in the `analysis.engine.*` namespace for cadence, max strategies per cycle,
and alert throttle — all hot-reloadable via the config WatchConfig stream (see Config Key Changes).

FR-10. A **Live Strategies panel** must be added to `xstockstrat-ui` in the `/trader` segment.
The panel must display all strategies (from `ListStrategyDefinitions`) with their `live_enabled`
status, most recent trigger type (entry/exit), and last trigger timestamp. Admin-authenticated
users must be able to toggle `live_enabled` per strategy directly from the panel via a BFF route
backed by `SetStrategyLive`; the toggle is hidden (read-only view) for non-admin sessions.

FR-11. The Live Strategies panel must display a **strategy alert feed**: for each strategy, the
10 most recent alerts where `category = "strategy"` and `strategy_id` matches (sourced from
`NotifyService.ListAlerts`). Each alert entry must show timestamp, symbol, trigger type, and
conviction. The alert feed does not require a new proto RPC — it uses the existing
`ListAlerts(categories=["strategy"])` endpoint and filters client-side by `strategy_id` in
`Alert.context`.

## Out of Scope

- The strategy **model, persistence, evaluator, and backtest** — all owned by feature 047 (hard
  dependency).
- **Order execution** of any kind (see FR-6). Position sizing (023), stop-loss/bracket (030).
- Backfilling or historical replay of triggers.
- Live tick streaming (feature `025-realtime-tick-streaming`) — this engine consumes bars/quotes via
  existing marketdata RPCs; sub-bar streaming is a separate concern.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — home of the runtime (asyncio background task loop, reuses the 047 evaluator directly; same Python process, no gRPC hop — see OQ-1 resolution)
- `xstockstrat-marketdata` — live OHLCV/quote reads each cycle
- `xstockstrat-ingest` — `QuerySignals` for signal-weighted strategies
- `xstockstrat-notify` — `EmitAlert` on triggers
- `xstockstrat-ledger` — evaluation/trigger events
- `xstockstrat-config` — cadence/throttle config via WatchConfig
- `xstockstrat-ui` — new Live Strategies panel in `/trader` segment; BFF API routes for `ListStrategyDefinitions`, `SetStrategyLive`, and `ListAlerts(categories=["strategy"])`

## Proto Contract Changes

New messages/RPCs in `analysis/v1/analysis.proto` (all additive/non-breaking):
- `SetStrategyLiveRequest { string strategy_id = 1; bool live_enabled = 2; }` — admin-scoped toggle
- `SetStrategyLiveResponse { StrategyDefinition definition = 1; }` — returns updated definition (with `live_enabled` reflected)
- `rpc SetStrategyLive(SetStrategyLiveRequest) returns (SetStrategyLiveResponse)` on `AnalysisService`

`StrategyDefinition` (defined by feature 047) must gain one additive field: `bool live_enabled = 8;`
This resolves the previously deferred design question — the UI's `ListStrategyDefinitions` response
must include `live_enabled` per strategy to render the panel without N+1 `GetStrategy` calls.
Field 8 is additive/non-breaking; all existing callers that do not read this field are unaffected.

No changes to `indicators`, `ingest`, or `marketdata` protos — this feature only consumes their
existing RPCs. `notify/v1/notify.proto` is unchanged — strategy alerts use the existing `category`
and `tags` fields of `EmitAlertRequest`.

## Config Key Changes

New keys in the `analysis` namespace (consistent with the analysis service's existing `analysis.backtest.*` / `analysis.scoring.*` keys):
- `analysis.engine.eval_interval_seconds` (int, default `60`) — evaluation polling cadence in seconds
- `analysis.engine.max_strategies_per_cycle` (int, default `50`) — cap on (strategy × symbol) pairs evaluated per cycle; pairs beyond the cap are skipped and logged
- `analysis.engine.alert_throttle_seconds` (int, default `300`) — minimum seconds between alerts for the same (strategy, symbol) pair; prevents alert floods on noisy conditions

## Database Changes

New migration in `services/xstockstrat-analysis/migrations/` (`002_strategy_live_enabled.up.sql` + `.down.sql`):
- `ALTER TABLE analysis.strategies ADD COLUMN IF NOT EXISTS live_enabled BOOLEAN NOT NULL DEFAULT FALSE;` — opt-in flag for live evaluation, independent of the `active` flag for backtests (FR-5). DBA review required (NNN numbering, up+down pair).

**No `analysis.strategy_live_state` table.** Per-cycle dedup state is held in-memory (see OQ-3 resolution — FR-4 explicitly defines restart policy as "re-arm without replaying"). The in-memory map `last_state: dict[tuple[strategy_id, symbol], bool]` is reset to neutral on service restart; no historical triggers are replayed.

## Feature Workflow Notes

Branch to create: `feature/live-strategy-alert-engine` (branch from `main-dev`)
**Merge after `047-strategy-engine`** (hard dependency — record in `merge-order.md`).
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval — additive proto/config + analysis + ui service changes
- [ ] Platform Lead — asyncio background task in `xstockstrat-analysis` (OQ-1 resolved; confirm no port/dependency-graph impact)
- [ ] DBA review + service owner — `analysis.strategies` `live_enabled` column migration (002_strategy_live_enabled)
- [ ] `xstockstrat-ui` owner — Live Strategies panel correctness, admin toggle enforcement, BFF route safety

## Acceptance Criteria

1. With an active strategy from 047 and live (or simulated-live) data, an entry transition emits
   exactly one alert via notify with `strategy_id`, symbol, trigger type, and timestamp.
2. While the entry condition stays true across cycles, no duplicate alerts fire; an exit transition
   emits one exit alert.
3. A live trigger for a given bar matches what `RunBacktest` decides for that same bar (parity test).
4. The engine never emits an order/trade in any trading mode (safety test).
5. One strategy's evaluation error does not stop evaluation of the others.
6. Cadence/throttle config changes take effect without restart.
7. The Live Strategies panel in `/trader` renders all strategies with correct `live_enabled`
   status. An admin session shows a toggle per strategy; toggling it calls `SetStrategyLive`
   and the updated status is reflected on the next page load. A non-admin session sees the panel
   as read-only (no toggle rendered).
8. The alert feed for at least one strategy shows its most recent strategy-triggered alert with
   correct `strategy_id`, symbol, trigger type, and timestamp (verified using a simulated-live
   trigger from AC-1).

## Open Questions

- [x] **Runtime placement:** RESOLVED — asyncio background task loop inside `xstockstrat-analysis`,
  started alongside the gRPC server in `app/main.py`. Feature 047 product spec AC-5 explicitly
  requires "feature 048 being able to call [the evaluator] directly with no changes to its
  signature or module path" — same Python process is the only interpretation that satisfies this
  without a gRPC hop. No new service; no Platform Lead approval threshold triggered. The agent
  scheduler (`010`) handles signal extraction; this loop handles strategy evaluation — different
  concerns, same pattern.
- [x] **Trigger cadence:** RESOLVED — fixed polling interval (default 60s, configurable via
  `analysis.engine.eval_interval_seconds`). Feature `025-realtime-tick-streaming` is explicitly out
  of scope. The loop calls `GetBars` for the most recent N bars per symbol; if no new bars have
  arrived since the last cycle (e.g. market closed), evaluation produces no new decisions — a
  silent no-op. Interaction with market hours (`017`) is deferred; the cadence config allows
  operators to lengthen the interval during off-hours as a workaround.
- [x] **Dedup durability:** RESOLVED — in-memory per-(strategy, symbol) state dict
  (`last_state: dict[tuple[str, str], bool]`). FR-4 already defines the restart policy as
  "re-arm without replaying historical triggers." Alert-only semantics (no financial transactions)
  make in-memory dedup acceptable for v1. Durable cross-restart dedup (e.g.
  `analysis.strategy_live_state` table) is a follow-up if operators require it.
- [x] **Live enable/disable surface:** RESOLVED — new `live_enabled BOOLEAN NOT NULL DEFAULT FALSE`
  column on `analysis.strategies` (migration `002_`) via `ALTER TABLE`. Controlled by a new
  `SetStrategyLive(SetStrategyLiveRequest)` RPC on `AnalysisService` (additive) and a
  `set_strategy_live` MCP tool on the agent (admin-scoped). The existing `ManageStrategy` RPC is
  not reused to avoid conflating model management with live-state toggling. The `active` flag
  (backtest availability) and `live_enabled` (live evaluation) remain independent, as required by
  FR-5.
- [x] **Scale:** RESOLVED — sequential evaluation for v1, capped by
  `analysis.engine.max_strategies_per_cycle` (default 50 strategy × symbol pairs per cycle).
  Single-flight enforcement: if a cycle exceeds the polling interval, the next cycle is skipped
  (asyncio.Lock or asyncio.Event). Parallelism (asyncio.gather across strategies) is a follow-up
  once the sequential baseline is profiled. Latency budget: evaluation must complete within the
  polling interval; the cap prevents runaway cycles.
