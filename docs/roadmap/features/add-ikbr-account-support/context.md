# Context: add-ikbr-account-support

**Feature**: `docs/roadmap/features/add-ikbr-account-support/feature.md`
**Product Spec**: `docs/roadmap/features/add-ikbr-account-support/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/add-ikbr-account-support/implementation-spec.md`

---

## Session 2026-05-02T00:00:00Z — sdd-story

- Created `feature.md` (status: `draft`), `product-spec.md`, and `context.md` from user story.

**Key decisions:**
- Scope: order execution only; `xstockstrat-marketdata` unchanged; Alpaca remains sole market data provider.
- Routing model: platform-wide switch via `trading.broker.active` config key; dev = IBKR paper account, prod = IBKR live account (mirrors `ALPACA_PAPER` pattern).
- Proto changes are additive (new `BrokerType` enum + `broker_type` field on `Order` at field 19). Non-breaking; 1 service owner approval required.
- `trading.broker.active` is read at startup only — no hot-swap.
- IBKR credentials follow `ALPACA_*` env var pattern (env vars, not config service).
- No DB migration needed; `broker_type` column deferred to follow-up.

**Codebase state observed:**
- `services/xstockstrat-trading/internal/broker/alpaca.go`: concrete `Client` struct, no interface.
- `services/xstockstrat-trading/internal/service/trading.go`: `TradingService.broker` typed as `*broker.Client`.
- `packages/proto/trading/v1/trading.proto`: `Order` fields 1–18; field 19 is next available.
- `packages/proto/common/v1/common.proto`: `TradingMode` and `Environment` enums present; no `BrokerType` yet.
- No schema migration needed: `trading.orders` hypertable has `broker_order_id TEXT` (broker-agnostic).
