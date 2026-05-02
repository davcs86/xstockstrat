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

---

## Session 2026-05-02T00:02:00Z — scope revision

User clarified the user story: not a platform-wide broker switch, but a **multi-account portfolio model** where a user tracks multiple Alpaca and/or IBKR accounts simultaneously. Status reverted `spec-ready` → `draft`; product-spec.md fully revised.

**Key architectural changes from this revision:**

- **`trading.broker.active` config key removed.** Replaced by `broker_accounts` table in the `trading` DB schema.
- **Account registry (FR-1 through FR-5)**: `broker_accounts` table (`id`, `display_name`, `broker_type`, `is_paper`). At startup, `xstockstrat-trading` reads all rows and instantiates one broker client per account (broker client pool, `map[string]broker.Broker`).
- **Backwards-compatibility fallback (FR-5)**: If `broker_accounts` is empty, the service falls back to the single `ALPACA_API_KEY`/`ALPACA_API_SECRET` env vars and creates an implicit `alpaca-default` account. Existing deployments require no changes.
- **Staging invariant (FR-3)**: On `ENVIRONMENT=dev`, the service refuses to start if any `broker_accounts` row has `is_paper=false`. Enforces paper-only across all registered accounts.
- **Proto additions (FR-9 through FR-14)**: `BrokerType` enum in `common/v1`; `account_id` (field 19) + `broker_type` (field 20) on `Order`; `account_id` on `PlaceOrderRequest`; `account_id` on `Portfolio`; new `ListPortfolios` RPC on `PortfolioService`. All additive — 1 service owner approval.
- **DB migrations added**: `broker_accounts` table + `orders.account_id` column. DBA review now required.
- **`xstockstrat-portfolio` now in scope**: Tracks one `Portfolio` per registered account; fill events carry `account_id` to route updates. `ListPortfolios` returns all per-account portfolios.
- **Credentials per account (FR-4)**: `ALPACA_KEY_<ID>`, `ALPACA_SECRET_<ID>`, `IBKR_CONSUMER_KEY_<ID>`, etc. `<ID>` = uppercased slug with hyphens→underscores.
- **Multi-account order routing (FR-15)**: `PlaceOrder` with absent `account_id` returns error when multiple accounts registered; succeeds with default when only one exists.
