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

---

## Session 2026-05-02T00:01:00Z — open question resolution

Resolved OQ-1, OQ-2, OQ-3. Status advanced `draft` → `spec-ready`.

**OQ-1 — IBKR API surface: IBKR Web API selected.**
Rationale: Client Portal Gateway requires a running local Java/Docker proxy and browser-based session login that expires — incompatible with automated server deployments. IBKR Web API uses OAuth 1.0a-style HMAC-SHA256 signed requests (Consumer Key + Access Token), server-to-server, no browser required. Matches the existing `ALPACA_API_KEY`/`ALPACA_API_SECRET` credential pattern. Base URL: `https://api.ibkr.com/v1/api/`.
New env vars: `IBKR_BASE_URL`, `IBKR_CONSUMER_KEY`, `IBKR_ACCESS_TOKEN`, `IBKR_ACCESS_TOKEN_SECRET`, `IBKR_ACCOUNT_ID`, `IBKR_PAPER`.

**OQ-2 — Paper account: confirmed available.**

**OQ-3 — Order type mapping: all five map cleanly.**
`MARKET`→`MKT`, `LIMIT`→`LMT`, `STOP`→`STP`, `STOP_LIMIT`→`STP LMT`, `TRAILING_STOP`→`TRAIL` (fixed trail amount via `auxPrice`←`stop_price`; trailing percentage out of scope). No new `OrderType` enum values needed. Documented as FR-16.
