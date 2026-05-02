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
- **Credentials per account (FR-4, now superseded)**: per-account env vars approach — superseded by encrypted DB storage in session 2026-05-02T00:03:00Z below.
- **Multi-account order routing**: `PlaceOrder` with absent `account_id` returns error when multiple accounts registered; succeeds with default when only one exists.

---

## Session 2026-05-02T00:03:00Z — follow-up revisions

Two user follow-ups incorporated into product-spec.md. Status remains `draft`.

**Change 1: Encrypted credential storage (replaces per-account env vars)**
- Problem: per-account env vars still require env var changes + restart to add accounts.
- Decision: credentials stored AES-256-GCM encrypted in `broker_accounts.credentials_enc`. Single `BROKER_ACCOUNTS_ENCRYPTION_KEY` env var is the only new env var. New accounts registered via `RegisterBrokerAccount` RPC — no restart, no env var touch.
- `credentials_enc` stores a broker-type-specific JSON blob (`{"api_key":"...","api_secret":"..."}` or `{"consumer_key":"...","access_token":"...","access_token_secret":"..."}`).
- `ListBrokerAccounts` never returns credentials. `DeregisterBrokerAccount` sets `is_active=false` + removes from in-memory pool immediately. Credential rotation requires deregister+register (UpdateCredentials deferred).
- Three new RPCs on `TradingService`: `RegisterBrokerAccount`, `ListBrokerAccounts`, `DeregisterBrokerAccount`.

**Change 2: IBKR position sync added to scope (FR-28 through FR-31)**
- Problem: portfolio is purely fill-event-driven with no reconciliation; IBKR positions could drift.
- Decision: `StartPositionSyncPoller` in `xstockstrat-trading` polls IBKR accounts every 5 min (configurable: `trading.position_sync.ibkr_interval_ms`). Emits `account.positions.synced` ledger event with full position snapshot.
- `ConsumePositionSyncs` in `xstockstrat-portfolio` atomically replaces positions for the account on each event (broker truth wins for IBKR accounts).
- Alpaca continues fill-event-based tracking. `GetPositions` is on the `Broker` interface (Alpaca implements it) but the poller does not invoke it — trivial follow-up.
- `portfolio.positions` table gains `account_id TEXT NOT NULL DEFAULT 'alpaca-default'`; unique constraint updated to `(user_id, symbol, trading_mode, account_id)`.
- New config key: `trading.position_sync.interval_ms` (int, default 300000, live-reloaded).

---

## Session 2026-05-02T00:04:00Z — broker feature parity

User confirmed goal is feature parity between brokers. Position sync poller (FR-28–31) now runs for **all** registered accounts, not IBKR-only. `GetPositions` was already on the `Broker` interface and Alpaca already implements it — only the poller scope changed. Config key renamed `trading.position_sync.ibkr_interval_ms` → `trading.position_sync.interval_ms`. "Alpaca position sync" removed from Out of Scope.

---

## Session 2026-05-02T00:05:00Z — spec-ready audit; five blocking gaps resolved

Spec audited against proto contracts and codebase. Five design-decision gaps identified and resolved. Status advanced `draft` → `spec-ready`.

**Gap 1 — Read-side portfolio RPCs (FR-27a added)**
Optional `account_id` added to request messages of `GetPortfolio`, `GetPosition`, `ListPositions`, `GetPnL`, `GetSnapshot`, `StreamPortfolioUpdates`. When absent: aggregate/all-accounts (backwards-compatible). When present: filter to account, return `codes.NotFound` if not found. Also added `account_id` to `PortfolioSnapshot`.

**Gap 2 — IBKR account ID in credentials (FR-3 updated)**
`ibkr_account_id` (the IBKR-assigned account ID, e.g. `U1234567`) added to the IBKR credentials JSON blob. Required for `GetPositions` (`GET /v1/api/portfolio/{ibkr_account_id}/positions`) and order submission.

**Gap 3 — `alpaca-default` fallback (FR-6 updated)**
Fallback is a real `broker_accounts` row (not a synthetic in-memory construct), inserted by Migration A using `ALPACA_API_KEY`/`ALPACA_API_SECRET` env vars at migration time. Credentials encrypted before storage. If env vars absent, no row inserted — operator registers manually. `user_id = 'default'` for the seed row.

**Gap 4 — Position sync replacement semantics (FR-30 updated; then revised again)**
Initially spec'd as full replace (delete + insert). Revised to upsert semantics after user raised concern about losing historical data. Final approach: update existing rows (preserve `opened_at`), insert new rows (opened outside platform), delete rows absent from snapshot (closed on broker). Realized P&L and snapshots are in append-only tables and unaffected by sync.

**Gap 5 — Auth for account management RPCs (FR-10a added; FR-1 updated)**
`broker_accounts` gains `user_id TEXT NOT NULL` column. `RegisterBrokerAccount` derives `user_id` from caller's auth claims. `ListBrokerAccounts` filters to caller's accounts. `DeregisterBrokerAccount` validates ownership; returns `codes.PermissionDenied` on mismatch. No new auth scope required.
