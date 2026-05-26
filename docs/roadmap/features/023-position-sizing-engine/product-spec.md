# Product Spec: position-sizing-engine

**Created**: 2026-05-26

---

## Problem Statement

The trading service currently executes orders with quantities specified by the caller (the agent or a manual request). There is no platform-enforced position sizing logic. A high-conviction signal could result in an oversized position that risks a disproportionate fraction of account equity on a single trade. This is the primary risk control gap before the platform can be trusted with real capital.

## User Story

As a trader, I want the platform to automatically compute a safe order quantity based on my account size, the stock's volatility, and my configured risk tolerance so that no single trade can lose more than my defined risk limit, regardless of the signal's conviction.

## Functional Requirements

FR-1. The trading service must expose an internal `ComputePositionSize` function (not a new gRPC RPC in V1) that takes: symbol, signal confidence (0.0–1.0), ATR (14-period, sourced from marketdata or indicators), and returns: recommended quantity (integer shares), dollar risk, and stop price.
FR-2. Position size formula: `quantity = floor((equity × max_risk_pct × confidence_multiplier) / (atr_multiplier × ATR))` where `confidence_multiplier` scales linearly from 0.5 (confidence=0.5) to 1.0 (confidence=1.0).
FR-3. A portfolio concentration cap must apply: the computed position's value (quantity × current_price) must not exceed `max_concentration_pct` of current equity. If it would, quantity is reduced to meet the cap.
FR-4. All sizing parameters must be configurable via config keys with no restart required.
FR-5. When an order is submitted to the trading service without an explicit quantity, `ComputePositionSize` is called automatically and the computed quantity is used.
FR-6. When an explicit quantity is provided, it is used as-is (override mode) — sizing logic is bypassed. This preserves backward compatibility with the agent's existing tool calls.
FR-7. The computed quantity, dollar risk, stop price, and the values of each input parameter must be logged at INFO level for every sized order.
FR-8. In paper trading mode (dev), the logic runs identically but against paper account equity from the portfolio service.

## Out of Scope

- Kelly Criterion or other optimization-based sizing methods (V2 extension)
- Per-symbol sizing overrides
- Portfolio-level risk (correlation-adjusted sizing across open positions)
- Stop-loss order placement (this feature only computes size; stop order submission is a separate feature)

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trading` — `ComputePositionSize` logic, order submission path modification
- `xstockstrat-portfolio` — queried for current account equity and open position values
- `xstockstrat-marketdata` — queried for current ATR (or sourced from `xstockstrat-indicators` — TBD at impl-spec)
- `xstockstrat-config` — new config keys for sizing parameters

## Proto Contract Changes

- [ ] No proto changes required in V1 (internal function; no new gRPC RPCs)
- Note: a `ComputePositionSize` RPC may be warranted in V2 to expose sizing to the agent as a tool

## Config Key Changes

- `trading.risk.max_risk_per_trade_pct` — float 0.0–1.0; fraction of equity to risk per trade (default: 0.02 = 2%)
- `trading.risk.atr_multiplier` — float; stop distance as a multiple of ATR (default: 1.5)
- `trading.risk.max_concentration_pct` — float 0.0–1.0; max fraction of equity in any single position (default: 0.10 = 10%)
- `trading.risk.sizing_enabled` — boolean; if false, all orders require explicit quantity (default: true)

## Database Changes

- [ ] No schema changes

## Feature Workflow Notes

Branch to create: `feature/position-sizing-engine` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (trading + portfolio service modification, no proto changes)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. An order submitted without explicit quantity at 2% risk, 1.5× ATR, on a $10,000 paper account with ATR=$2.00 and confidence=1.0 results in: `quantity = floor((10000 × 0.02 × 1.0) / (1.5 × 2.0)) = 66 shares`.
2. The concentration cap reduces quantity if the resulting position value would exceed 10% of equity.
3. An order submitted with explicit quantity bypasses sizing logic entirely.
4. Setting `trading.risk.sizing_enabled=false` disables auto-sizing; orders without explicit quantity are rejected with a clear error.
5. Changing `max_risk_per_trade_pct` via the config service takes effect on the next order without a restart.
6. All sizing decisions are logged at INFO with full parameter values.
7. Unit tests cover: normal case, concentration cap triggered, confidence=0.5 scaling, disabled sizing rejection.

## Open Questions

- [ ] Should ATR be sourced from `xstockstrat-marketdata` (raw OHLCV computation) or `xstockstrat-indicators` (formula engine)? Indicators is more flexible but adds a dependency. Decide at impl-spec time.
- [ ] Should `ComputePositionSize` be exposed as a gRPC RPC in V1 so the agent MCP server can call it as a tool before submitting an order? Useful for agent transparency but increases scope.
