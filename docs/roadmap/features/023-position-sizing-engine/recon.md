# Recon: position-sizing-engine

**Created**: 2026-08-05
**From**: product-spec.md
**Affected services**: xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-config, xstockstrat-ui

---

## Objective

Add a risk-adjusted position-sizing engine (`ComputePositionSize`) inside `xstockstrat-trading` that
computes order quantity from account equity, ATR-based stop distance, signal confidence, and a
portfolio concentration cap — replacing an implicit "the caller decides quantity" model with a
platform-enforced one, activated whenever an order arrives with `qty <= 0`. Existing explicit-quantity
orders (the trader UI's only flow today) stay backward compatible via override mode.

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - Entry point: `services/xstockstrat-trading/cmd/server/main.go:129`
  - Connect handler (served path via `grpcTradingAdapter` twin, `TRADING-1`): `services/xstockstrat-trading/internal/handler/trading.go:31-43`
  - Service logic: `services/xstockstrat-trading/internal/service/trading.go:242` (`PlaceOrder`)
  - Existing single-position risk check (to reconcile — see Risks): `checkPortfolioRisk`, `trading.go:1288-1326`
  - Last migration: `004_broker_accounts_credential_status.up.sql` (`services/xstockstrat-trading/migrations/`)
  - Config-read idiom: `s.cfgW.GetFloat("trading.risk.max_position_pct", 0.05)` — `trading.go:1292`
  - Existing portfolio client (reuse target): `portfolio portfoliov1.PortfolioServiceClient` field, `trading.go:69`; dialed `trading.go:111-113,123`
  - Trading-mode resolution: `resolveTradingMode`, `trading.go:1330-1339`

- **`xstockstrat-portfolio`** (Go)
  - Entry point: `services/xstockstrat-portfolio/cmd/server/main.go:26-105`
  - Equity RPC #1 (position-value-summed): `GetPortfolio`, `packages/proto/portfolio/v1/portfolio.proto:11`; impl `services/xstockstrat-portfolio/internal/service/portfolio_service.go:440-459`
  - Equity RPC #2 (broker-authoritative): `ListPortfolios`/`buildAccountPortfolio`, `portfolio.proto:17`; impl `portfolio_service.go:947-983` (`portfolio.Equity = bal.Equity`, line 976)
  - Position values: `ListPositions`, `portfolio.proto:13`; impl `portfolio_service.go:472-493`; fields `Position.market_value`/`qty`/`current_price`, `portfolio.proto:44-51`
  - Last migration: `008_watchlist_symbol_strategy.{up,down}.sql`

- **`xstockstrat-marketdata`** (Go)
  - Entry point: `services/xstockstrat-marketdata/cmd/server/main.go:142`
  - `GetLatestQuote`: proto `packages/proto/marketdata/v1/marketdata.proto:23`; impl `services/xstockstrat-marketdata/internal/service/marketdata_service.go:353`; DB-cache-first, live-Alpaca-fallback
  - `Quote` message: `marketdata.proto:60-68` — **no single current-price field**, only `ask_price`(63)/`bid_price`(65)
  - `GetBars` (raw OHLCV, has high/low/close): `marketdata.proto:20`; impl `marketdata_service.go:110`
  - Last migration: `003_canonicalize_ohlcv_timeframe` (next would be `004`)
  - No ATR/volatility computation anywhere in this service (confirmed, zero grep hits)

- **`xstockstrat-config`** (Node)
  - Seed migrations: `services/xstockstrat-config/migrations/001_config_tables.up.sql` (schema + original seed), `008_analysis_fundsignal_keys.up.sql` (template for a new scoped-key migration)
  - Existing `trading.risk.max_position_pct` seed row: `001_config_tables.up.sql:59`
  - Last migration: `010_config_audit_insert_trigger.up.sql` → next would be `011`
  - Existence gate: a key must be seeded before `SetConfig` can write it (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:315-327`)

- **`xstockstrat-ui`** (Next.js)
  - Order form (always sends required, non-empty `qty` today): `services/xstockstrat-ui/src/components/trader/OrderForm.tsx:60,75,147-154`
  - BFF passthrough: `services/xstockstrat-ui/src/lib/traderBff.ts:28-34`
  - Post-submit feedback (extension point): `OrderForm.tsx:82-94` (orderId+status only, no toast component exists anywhere in `src/`)
  - Orders table (has `Qty` column, no `stop_price` column): `services/xstockstrat-ui/src/components/trader/OrdersTable.tsx:79-89`
  - e2e fixtures: `ORDER_FILLED`/`ORDER_WORKING`/`ORDERS` in `e2e/fixtures/orders.ts` (`e2e/fixtures/INVENTORY.md:25`); `BROKER_ACCOUNT_*` in `e2e/fixtures/accounts.ts` (`INVENTORY.md:14`)

- **`xstockstrat-indicators`** (Python, not in Affected Services but relevant to the ATR-source Open Question)
  - `_atr` dispatch entry: `services/xstockstrat-indicators/app/services/indicators_engine.py:30`
  - Implementation: `indicators_engine.py:103-109` — **a close-only approximation** (rolling mean of `|close.diff()|`), not Wilder's true-range ATR (`max(high-low, |high-prevClose|, |low-prevClose|)`)

## Patterns to REUSE

- New `ComputePositionSize` config reads → reuse the exact `s.cfgW.Get<Type>("<ns>.<cat>.<key>", <default>)` idiom already used by `checkPortfolioRisk` (`trading.go:1292,1334`) — live per-call reads, no caching, matches FR-4's no-restart requirement.
- Equity lookup → reuse the existing `portfolio portfoliov1.PortfolioServiceClient` already dialed on `TradingService` (`trading.go:69,111-113,123`) — do not create a second portfolio client.
- New config-key seed migration → follow `008_analysis_fundsignal_keys.up.sql`'s pattern (per-env `dev`+`production`, `trading_mode='all'`, `ON CONFLICT ... DO NOTHING`).
- UI order-confirmation surface → extend the existing `OrderForm.tsx:82-94` post-submit message (no toast system exists to build on instead).
- e2e tests → reuse `ORDER_FILLED`/`ORDER_WORKING`/`ORDERS` (`e2e/fixtures/orders.ts`) and `BROKER_ACCOUNT_*` (`e2e/fixtures/accounts.ts`) fixtures per C-12.

## Dependencies

- Proto/RPC: none required (product spec confirms V1 stays internal-function-only). `Order.qty`/`stop_price` at `trading.proto:39,42`; `PlaceOrderRequest.qty`/`stop_price` at `trading.proto:85,87`.
- Migration: `xstockstrat-config` next is `011` (sizing config keys); no migration in `xstockstrat-trading`/`xstockstrat-portfolio`/`xstockstrat-marketdata` (no schema change).
- Config keys: `trading.risk.max_risk_per_trade_pct`, `trading.risk.atr_multiplier`, `trading.risk.max_concentration_pct`, `trading.risk.sizing_enabled` (all new) — plus the existing `trading.risk.max_position_pct` to reconcile.
- Inter-service edges: `xstockstrat-trading → xstockstrat-portfolio` (existing, reuse); `xstockstrat-trading → xstockstrat-marketdata` (**new** — no client exists today); `xstockstrat-trading → xstockstrat-indicators` (**endpoint configured but unused** — `IndicatorsEndpoint` wired in config, no client ever constructed, per Open Question OQ-1).
- New env vars: `MARKETDATA_ENDPOINT` — **absent** from `xstockstrat-trading`'s `docker-compose.yml` block (present for ingest/analysis/portfolio at lines 315/351/393, absent for trading) — needed only if the design routes current-price/ATR lookups through marketdata.

## Risks / Not-found

- **Blocker (new, from recon) — the served gRPC path rejects `qty <= 0` today.** `internal/handler/trading.go:35-37` returns `InvalidArgument("qty must be positive")` **before** `TradingService.PlaceOrder` is ever called. FR-5's entire "`qty <= 0` means auto-size me" convention is unreachable until this validation is relaxed or moved past the sizing call. This must be an explicit design decision, not an assumed given.
- **Two candidate equity sources with different semantics.** `GetPortfolio.Equity` (position-value-summed, always available) vs. `ListPortfolios`/`buildAccountPortfolio.Equity` (broker-balance-authoritative when synced, falls back to summed otherwise) — the product spec doesn't pick one, and they can disagree. `checkPortfolioRisk`'s existing precedent uses `GetPortfolio`.
- **`checkPortfolioRisk` calls `GetPortfolio` with `req.TradingMode` before `resolveTradingMode` runs** (`trading.go:268` vs. `1330-1339`) — if the caller leaves `PlaceOrderRequest.trading_mode` unspecified, today's risk check queries `TRADING_MODE_UNSPECIFIED` equity, not the mode `PlaceOrder` ultimately resolves. FR-8 (paper-mode parity) needs an explicit stance on whether `ComputePositionSize` resolves mode first.
- **No true ATR exists anywhere.** `xstockstrat-indicators`' `_atr` is a close-price-only approximation (ignores high/low), not Wilder's true-range ATR. If OQ-1 picks indicators as the ATR source, the formula itself may need fixing or the discrepancy must be an accepted, stated tradeoff.
- **`Quote` has no single current-price field** (only `ask_price`/`bid_price`) — FR-3's concentration cap (`quantity × current_price`) needs an explicit mid/last-price convention.
- **No `xstockstrat-trading → xstockstrat-marketdata` client exists today** — genuinely new wiring (client construction, `MARKETDATA_ENDPOINT` env var, docker-compose entry), not a reuse case, regardless of which ATR source OQ-1 picks (current-price is needed from marketdata either way for FR-3).
- **`trading.risk.max_position_pct` reconciliation** (already named in product-spec, confirmed real by recon): warn-only, 5% default, single-position check inside `checkPortfolioRisk`, vs. this feature's new enforcing `max_concentration_pct` (10% default). Product spec already frames this as a named `/sdd-design` decision — recon confirms both sides are real, current code, not a stale claim.
- **Fail-open precedent**: `checkPortfolioRisk` is deliberately fail-open on a portfolio-call error (`trading.go:1304-1307`, "portfolio unavailability must not halt trading"). Already flagged as an explicit `/sdd-design` decision in the product spec's Open Questions.
- fails.md **C-10(b)** (2026-07-01, 056-open-positions-ui): a displayed value with an authoritative source must be surfaced consistently by every read path — relevant if the design surfaces dollar-risk/sizing-input data anywhere beyond the log in a later increment.
- fails.md **P-03** (multiple entries): absence/scope claims must be grep-verified, not assumed — applies to the "no proto changes needed" claim, which recon confirms holds (no RPC required for V1) as long as FR-7 stays scoped to `qty`/`stop_price` only (already true in the current product-spec).

## Recommended Scope

Advisory only — not binding.

1. `xstockstrat-config`: migration `011_trading_risk_sizing` seeding the four new keys.
2. `xstockstrat-trading`: relax/move the `qty <= 0` `InvalidArgument` gate in `internal/handler/trading.go:35-37` so `ComputePositionSize` can run.
3. `xstockstrat-trading`: new `xstockstrat-marketdata` gRPC client (env var + docker-compose + client construction), reusing the existing dial pattern at `trading.go:111-123`.
4. `xstockstrat-trading`: `ComputePositionSize` function — equity (reuse portfolio client), ATR (per OQ-1's resolution), current-price (new marketdata client), formula (FR-2/FR-3), config reads (reuse idiom).
5. `xstockstrat-trading`: wire `ComputePositionSize` into `PlaceOrder` per FR-5/FR-6, INFO logging per FR-7.
6. `xstockstrat-trading`: reconcile `max_position_pct`/`max_concentration_pct` per the design's decision.
7. `xstockstrat-ui`: extend `OrderForm.tsx`'s post-submit message to show `Order.qty`/`Order.stop_price` when auto-sized.
8. Tests per C-08/C-13 pairing at each service step.
