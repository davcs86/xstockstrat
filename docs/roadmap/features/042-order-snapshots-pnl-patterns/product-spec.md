# Product Spec: order-snapshots-pnl-patterns

**Created**: 2026-05-26

---

## Problem Statement

Orders are placed and filled based on indicator signals and market conditions, but there is currently no record of *what the indicators and signals looked like* at the moment each order event occurred. Without that context it is impossible to determine which factors drove profitable or unprofitable outcomes, making strategy improvement purely qualitative.

## User Story

As a trader using the xstockstrat platform, I want to see which indicator values, signals, and market conditions were present at each order event so that I can understand which factors consistently lead to positive or negative realized P&L and improve my strategies accordingly.

## Functional Requirements

FR-1. At each order lifecycle event (created, filled, partially-filled, cancelled), the system must capture a **snapshot** containing: symbol, event timestamp, order metadata (side, quantity, price), the current OHLCV bar for the symbol, all active indicator values for that symbol at that moment, and all active signals for that symbol.

FR-2. Snapshots must be stored persistently and linked to their originating order ID and position ID so they can be retrieved when the position closes.

FR-3. When a position closes and realized P&L is finalized, the system must automatically trigger a **pattern analysis** over all snapshots associated with that position. The analysis must attribute P&L to the indicator values and signal combinations present at entry and exit events.

FR-4. Pattern analysis results must be queryable via a new RPC exposed by `xstockstrat-analysis`: return a ranked list of factors (indicator name + value range, or signal name) that correlate with positive P&L and those that correlate with negative P&L, scoped by symbol, strategy, or time window.

FR-5. The `xstockstrat-insights` UI must display a **P&L Patterns** view showing: top positive-contributing factors, top negative-contributing factors, and a per-order snapshot timeline.

FR-6. Snapshot capture must be non-blocking — a failure to read indicators or signals at order time must log a warning and continue with a partial snapshot rather than blocking order execution.

FR-7. All snapshot and pattern events must be emitted to `xstockstrat-ledger` for audit purposes.

## Out of Scope

- Causal inference or machine-learning-based attribution (correlation only in v1).
- Modifying indicator formulas or signal definitions as part of this feature.
- Real-time (streaming) pattern alerts — query-on-demand only.
- Cross-symbol or cross-strategy correlation analysis.
- Backfilling snapshots for historical orders placed before this feature is deployed.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trading` — hooks into order lifecycle events to trigger snapshot capture; calls indicators and ingest for current values
- `xstockstrat-portfolio` — emits a realized P&L event when a position closes, which triggers pattern analysis
- `xstockstrat-indicators` — queried synchronously (with timeout) at order event time to return current indicator values for the symbol
- `xstockstrat-ingest` — queried at order event time via `QuerySignals` RPC to return active signals for the symbol
- `xstockstrat-analysis` — owns snapshot persistence, runs pattern analysis on position close, exposes new `QueryPnLPatterns` RPC
- `xstockstrat-ledger` — receives snapshot and pattern events for append-only audit storage
- `xstockstrat-insights` — new P&L Patterns view; consumes `QueryPnLPatterns` from analysis service
- `packages/proto` — new `OrderSnapshot` message, new `PnLPatternFactor` message, new `QueryPnLPatterns` RPC in analysis proto

## Proto Contract Changes

- New message `OrderSnapshot` in `packages/proto/trading/v1/trading.proto` or a new `snapshot/v1/snapshot.proto`:
  - `order_id`, `position_id`, `symbol`, `event_type` (enum: ORDER_CREATED / ORDER_FILLED / ORDER_CANCELLED), `event_ts`, `side`, `quantity`, `price`, `ohlcv_bar`, `indicator_values` (map<string, double>), `signals` (repeated SignalEntry)
- New message `PnLPatternFactor` in `packages/proto/analysis/v1/analysis.proto`:
  - `factor_name`, `factor_type` (enum: INDICATOR / SIGNAL), `value_range_low`, `value_range_high`, `sample_count`, `avg_pnl_impact`
- New RPC in `packages/proto/analysis/v1/analysis.proto`:
  - `QueryPnLPatterns(QueryPnLPatternsRequest) returns (QueryPnLPatternsResponse)`
  - Request: `symbol`, `strategy_id`, `from_ts`, `to_ts`, `limit`
  - Response: `positive_factors` (repeated PnLPatternFactor), `negative_factors` (repeated PnLPatternFactor)

## Config Key Changes

- `trading.snapshot.indicator_timeout_ms` — max ms to wait for indicator values during snapshot capture (default: 500); falls back to empty map on timeout
- `trading.snapshot.signal_timeout_ms` — max ms to wait for signal values during snapshot capture (default: 500); falls back to empty list on timeout
- `analysis.patterns.min_sample_count` — minimum number of position snapshots required before a factor appears in results (default: 5)
- `analysis.patterns.pnl_bucket_size` — P&L bucket width in dollars for grouping (default: 50)

## Database Changes

New table in `xstockstrat-analysis` (TimescaleDB hypertable partitioned on `event_ts`):

```sql
CREATE TABLE order_snapshots (
  id           BIGSERIAL,
  order_id     TEXT        NOT NULL,
  position_id  TEXT        NOT NULL,
  symbol       TEXT        NOT NULL,
  event_type   TEXT        NOT NULL,  -- 'created' | 'filled' | 'cancelled'
  event_ts     TIMESTAMPTZ NOT NULL,
  side         TEXT        NOT NULL,  -- 'buy' | 'sell'
  quantity     NUMERIC     NOT NULL,
  price        NUMERIC,
  ohlcv_bar    JSONB,
  indicators   JSONB,                 -- map<name, value>
  signals      JSONB,                 -- [{name, value, source}]
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT create_hypertable('order_snapshots', 'event_ts');
CREATE INDEX ON order_snapshots (position_id, event_ts DESC);
CREATE INDEX ON order_snapshots (symbol, event_ts DESC);
```

New table in `xstockstrat-analysis` for materialized pattern results (refreshed on position close):

```sql
CREATE TABLE pnl_pattern_factors (
  id              BIGSERIAL PRIMARY KEY,
  symbol          TEXT        NOT NULL,
  strategy_id     TEXT,
  factor_name     TEXT        NOT NULL,
  factor_type     TEXT        NOT NULL,  -- 'indicator' | 'signal'
  value_range_low NUMERIC,
  value_range_high NUMERIC,
  sample_count    INT         NOT NULL,
  avg_pnl_impact  NUMERIC     NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON pnl_pattern_factors (symbol, factor_type, avg_pnl_impact DESC);
```

## Feature Workflow Notes

Branch to create: `feature/order-snapshots-pnl-patterns` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change — new messages/RPCs are additive, not breaking)
- [x] DBA review + service owner (schema migration — two new tables in xstockstrat-analysis)

## Acceptance Criteria

1. Placing and filling an order in the paper trading environment produces an `order_snapshots` row with non-empty `indicators` and `signals` fields (or a logged warning if unavailable within timeout).
2. Closing a position triggers a background pattern analysis job; `pnl_pattern_factors` rows are created within 10 seconds of the position close event.
3. `QueryPnLPatterns` RPC returns at least one positive and one negative factor for positions with ≥5 completed trades on the same symbol.
4. The Insights UI P&L Patterns view loads without error and displays ranked factor cards.
5. A snapshot capture failure (simulated timeout from indicators service) does not block order execution — the order proceeds and a warning is emitted to the ledger.
6. All snapshot and pattern events appear in `xstockstrat-ledger` with the correct event type.

## Open Questions

- [ ] Should `order_snapshots` live in `xstockstrat-analysis` DB or `xstockstrat-trading` DB? (Analysis owns the query; Trading owns the capture event — a cross-service write may be needed.)
- [ ] Should pattern analysis run synchronously on position close or as an async background job queued via the ledger event stream?
- [ ] Is `strategy_id` available on the order object today, or does it need to be added to the trading proto?
- [ ] Should `QueryPnLPatterns` support pagination for large result sets, or is a fixed `limit` sufficient for v1?
