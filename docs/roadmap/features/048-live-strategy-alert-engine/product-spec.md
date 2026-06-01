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
same logic I validated in backtests without manually re-running anything.

## Functional Requirements

FR-1. A continuous evaluation runtime must, on a configurable cadence (e.g. per bar close /
polling interval) for each **active** strategy, fetch the latest required OHLCV window from
`xstockstrat-marketdata` and active signals from `xstockstrat-ingest` (`QuerySignals`), and run the
**047 shared strategy evaluator** to determine current entry/exit state.

FR-2. **Evaluator parity:** the live runtime must call the *same* evaluator code path as
`RunBacktest` (feature 047), so a strategy's live entry/exit decision for a given bar is identical
to its backtest decision for that bar. No duplicated or divergent strategy logic.

FR-3. On an entry or exit **trigger** (a transition, not a steady state), the runtime must emit an
alert via `xstockstrat-notify` `EmitAlert` containing at minimum: `strategy_id`, symbol, trigger
type (entry/exit), the rule/components that fired, the bar timestamp, and combined conviction.

FR-4. **Edge-triggered, deduplicated:** an alert fires once per state transition per
(strategy, symbol), not repeatedly while the condition remains true. Per-(strategy, symbol) last
state must be tracked; restart behavior is defined (re-arm without replaying historical triggers).

FR-5. The runtime must support per-strategy enable/disable for live evaluation independent of the
strategy's `active` flag for backtests (an operator may backtest a strategy without it alerting
live). Enable/disable is admin-scoped.

FR-6. **Safety invariant:** the engine emits **alerts only** — it must never place or trigger
orders, in any trading mode. This is explicit and must be enforced/tested. (Auto-execution, if ever
wanted, is a separate future feature gated on risk controls 023/030.)

FR-7. Observability: each evaluation cycle and each emitted alert must produce ledger events
(e.g. `analysis.strategy.evaluated`, `analysis.strategy.triggered`) and OTel spans, so operators can
audit why an alert did/didn't fire.

FR-8. Resilience: a failure evaluating one strategy or symbol must not halt the loop; market-data /
ingest errors are logged and that strategy is skipped for the cycle. The loop must not drift or
overlap runs (single-flight per cycle).

FR-9. Config keys (namespace `analysis` or a new `engine` namespace — TBD) for cadence, max
strategies per cycle, and alert throttle, all hot-reloadable via the config WatchConfig stream.

## Out of Scope

- The strategy **model, persistence, evaluator, and backtest** — all owned by feature 047 (hard
  dependency).
- **Order execution** of any kind (see FR-6). Position sizing (023), stop-loss/bracket (030).
- Backfilling or historical replay of triggers.
- A UI for live strategy status/alerts (possible follow-up in insights/trader; alerts surface via
  the existing notify stream).
- Live tick streaming (feature `025-realtime-tick-streaming`) — this engine consumes bars/quotes via
  existing marketdata RPCs; sub-bar streaming is a separate concern.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — most likely home of the runtime (reuses the 047 evaluator) **or** a new
  dedicated service / the agent scheduler — see Open Questions
- `xstockstrat-marketdata` — live OHLCV/quote reads each cycle
- `xstockstrat-ingest` — `QuerySignals` for signal-weighted strategies
- `xstockstrat-notify` — `EmitAlert` on triggers
- `xstockstrat-ledger` — evaluation/trigger events
- `xstockstrat-config` — cadence/throttle config via WatchConfig

## Proto Contract Changes

- [ ] Possibly none if the runtime is an internal loop driven by stored strategies + existing RPCs
  (`GetBars`, `QuerySignals`, `EmitAlert`).
- OR: a small `analysis` RPC to enable/disable live evaluation per strategy and report live status
  (`SetStrategyLive`, `GetLiveStrategyStatus`) — additive/non-breaking. Decide at /sdd-spec.

## Config Key Changes

Likely new keys (final namespace TBD):
- `analysis.engine.eval_interval_seconds` (int) — evaluation cadence
- `analysis.engine.max_strategies_per_cycle` (int) — throughput cap
- `analysis.engine.alert_throttle_seconds` (int) — minimum gap between alerts per (strategy, symbol)

## Database Changes

- [ ] Likely no new schema if live enable/disable + last-state are stored on the `analysis.strategies`
  row (047) or in memory with a documented restart policy.
- OR: a small `analysis.strategy_live_state` table (strategy_id, symbol, last_state, last_triggered_at)
  if durable cross-restart dedup is required — DBA review if added.

## Feature Workflow Notes

Branch to create: `feature/live-strategy-alert-engine` (branch from `main-dev`)
**Merge after `047-strategy-engine`** (hard dependency — record in `merge-order.md`).
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval — additive proto/config + service changes
- [ ] Platform Lead — runtime placement / dependency-graph impact (new loop or new service)
- [ ] DBA review — only if `analysis.strategy_live_state` table is added

## Acceptance Criteria

1. With an active strategy from 047 and live (or simulated-live) data, an entry transition emits
   exactly one alert via notify with `strategy_id`, symbol, trigger type, and timestamp.
2. While the entry condition stays true across cycles, no duplicate alerts fire; an exit transition
   emits one exit alert.
3. A live trigger for a given bar matches what `RunBacktest` decides for that same bar (parity test).
4. The engine never emits an order/trade in any trading mode (safety test).
5. One strategy's evaluation error does not stop evaluation of the others.
6. Cadence/throttle config changes take effect without restart.

## Open Questions

- [ ] **Runtime placement:** extend `xstockstrat-analysis` with an evaluation loop, build a new
  dedicated service, or run it inside `xstockstrat-agent` alongside `010-agent-scheduler`? Drives
  the dependency graph and Platform Lead review.
- [ ] **Trigger cadence:** bar-close driven (needs a bar-close signal/stream) vs fixed polling
  interval. Interaction with market hours / `017-premarket-aftermarket-session-toggle`.
- [ ] **Dedup durability:** in-memory last-state (simple, lost on restart) vs persisted
  `strategy_live_state` (survives restart, needs migration).
- [ ] **Live enable/disable surface:** new analysis RPC + MCP tool, or a flag on the 047
  strategy definition?
- [ ] **Scale:** how many (strategy × symbol) pairs must be evaluated per cycle, and within what
  latency budget? Determines polling vs streaming and batching strategy.
