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
FR-5. When an order is submitted to the trading service without an explicit quantity, `ComputePositionSize` is called automatically and the computed quantity is used. `PlaceOrderRequest.qty` (`packages/proto/trading/v1/trading.proto:85`) is a non-`optional` proto3 `double`, so the platform has no wire-level presence tracking for "unset" — the convention is: `qty <= 0` (unset, zero, or negative) means "no explicit quantity, auto-size me"; `qty > 0` means override mode (FR-6).
FR-6. When an explicit quantity is provided (`qty > 0`, see FR-5), it is used as-is (override mode) — sizing logic is bypassed. This preserves backward compatibility with the trader UI's existing order flow, which today always sends an explicit `qty` (`services/xstockstrat-ui/src/lib/traderBff.ts:28`) — the only caller of `PlaceOrder` in the repo; the agent MCP server has no order-placement tool (`services/xstockstrat-agent/app/tools.py` — confirmed no `PlaceOrder`/`place_order` reference).
FR-7. The computed quantity, dollar risk, stop price, and the values of each input parameter must be logged at INFO level for every sized order, and returned in the order-placement response so the caller (trader UI, agent tool) can display why an order was sized as it was — see Consumer Surface(s).
FR-8. In paper trading mode (dev), the logic runs identically but against paper account equity from the portfolio service.

## Out of Scope

- Kelly Criterion or other optimization-based sizing methods (V2 extension)
- Per-symbol sizing overrides
- Portfolio-level risk (correlation-adjusted sizing across open positions)
- Stop-loss order placement (this feature only computes size; stop order submission is a separate feature)
- Existing `OrderType` handling (MARKET/LIMIT/STOP/STOP_LIMIT/TRAILING_STOP) is unaffected — the "stop
  price" this feature computes (FR-1/FR-2) is a risk-sizing output only, never submitted to the broker
  as an actual `ORDER_TYPE_STOP`/`STOP_LIMIT` order (`packages/proto/trading/v1/trading.proto:86,98-102`)

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trading` — `ComputePositionSize` logic, order submission path modification
- `xstockstrat-portfolio` — queried for current account equity and open position values
- `xstockstrat-marketdata` — queried for current ATR (or sourced from `xstockstrat-indicators` — TBD at impl-spec)
- `xstockstrat-config` — new config keys for sizing parameters
- `xstockstrat-ui` — the `/trader` order-placement flow surfaces the computed sizing decision (see
  Consumer Surface(s))

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — the `/trader` segment's order-placement flow (order form / confirmation) must display
  the computed quantity, dollar risk, and stop price returned per FR-7 before/at submission, so a
  trader can see why an automated order was sized as it was — not just from a service log. This is
  the only live caller of `PlaceOrder` today (`services/xstockstrat-ui/src/lib/traderBff.ts:28`).
  Exact component/placement is an `/sdd-spec` detail.
- [ ] **Agent** — no order-placement tool exists today (`services/xstockstrat-agent/app/tools.py`);
  N/A until one is added.
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required in V1 (internal function; no new gRPC RPCs)
- Note: a `ComputePositionSize` RPC may be warranted in V2 to expose sizing to the agent as a tool

## Config Key Changes

- `trading.risk.max_risk_per_trade_pct` — float 0.0–1.0; fraction of equity to risk per trade (default: 0.02 = 2%)
- `trading.risk.atr_multiplier` — float; stop distance as a multiple of ATR (default: 1.5)
- `trading.risk.max_concentration_pct` — float 0.0–1.0; max fraction of equity in any single position (default: 0.10 = 10%)
- `trading.risk.sizing_enabled` — boolean; if false, all orders require explicit quantity (default: true)

**Existing key to reconcile (named design question, not resolved here — C-10):** `checkPortfolioRisk`
(`services/xstockstrat-trading/internal/service/trading.go:1288-1326`) already reads a similarly-named
`trading.risk.max_position_pct` (default 5%) as a **warn-only, non-blocking** single-position
concentration check. FR-3's new `max_concentration_pct` (default 10%) is **enforcing** (reduces
quantity). Two differently-scoped, differently-enforced keys governing the same concept would be a
real duplicate-mechanism trap (root `CLAUDE.md` DRY guard rail). `/sdd-design` must decide one of:
retire `max_position_pct`/its warn-only check in favor of the new enforcing cap, or state an explicit,
justified reason the two coexist (e.g. warn threshold below the hard cap as an early-warning signal)
— not carry both forward with an unstated relationship.

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
2. The concentration cap reduces quantity if the resulting position value would exceed 10% of equity: e.g. a raw sizing result of 66 shares at a $200 current price ($13,200, 132% of a $10,000 equity account) is reduced to `floor((10000 × 0.10) / 200) = 5 shares` ($1,000, exactly the 10% cap).
3. An order submitted with explicit quantity bypasses sizing logic entirely.
4. Setting `trading.risk.sizing_enabled=false` disables auto-sizing; orders without explicit quantity are rejected with a clear error.
5. Changing `max_risk_per_trade_pct` via the config service takes effect on the next order without a restart.
6. All sizing decisions are logged at INFO with full parameter values.
7. Unit tests cover: normal case, concentration cap triggered, confidence=0.5 scaling, disabled sizing rejection.

## Open Questions

- [ ] Should ATR be sourced from `xstockstrat-marketdata` (raw OHLCV computation) or `xstockstrat-indicators` (formula engine)? Indicators is more flexible but adds a dependency. **Decide at `/sdd-design`.**
- [ ] Should `ComputePositionSize` be exposed as a gRPC RPC in V1 so the agent MCP server can call it as a tool before submitting an order? Useful for agent transparency but increases scope, and there is no agent order-placement tool today to consume it (see Consumer Surface(s)). **Decide at `/sdd-design`.**
- [ ] Should `checkPortfolioRisk`'s existing warn-only `trading.risk.max_position_pct` check be retired, superseded, or kept alongside the new enforcing `max_concentration_pct` cap (see Config Key Changes)? **Decide at `/sdd-design`.**
- [ ] Fail-open vs. fail-closed when portfolio/price/config data is unavailable — `checkPortfolioRisk` is currently deliberately fail-open (`trading.go:1288` comment); this feature's sizing engine must explicitly decide whether it keeps that stance (see `context.md` 2026-08-04 session for the tradeoff). **Decide at `/sdd-design`.**
