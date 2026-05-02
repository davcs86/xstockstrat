# Product Spec: add-ikbr-account-support

**Created**: 2026-05-02
**Last Revised**: 2026-05-02

---

## Problem Statement

The platform assumes a single broker account globally. `xstockstrat-trading` is hard-wired to one Alpaca account with no account abstraction, `xstockstrat-portfolio` tracks a single set of positions with no broker-side reconciliation, and there is no concept of a named broker account in the proto contract. A user who holds both Alpaca and IBKR accounts — or multiple accounts of the same broker type — cannot manage and track all of them together. Adding multi-account support requires an account registry with encrypted credential storage (so new accounts are registered via API, not env var changes), a broker client pool, account-scoped positions, and periodic IBKR position sync to reconcile portfolio state against broker truth — without relaxing the staging (paper-only) safety invariant.

## User Story

As a platform user, I want to register multiple broker accounts (Alpaca and/or IBKR) by calling an API and supplying credentials once, so that I can place orders against a specific account, track positions and P&L per account, have IBKR positions reconciled against the broker periodically, and never need to touch env vars or restart the service to add a new account. Dev always enforces paper mode regardless of which accounts are registered.

---

## Functional Requirements

### Account Registry

FR-1. Introduce a `broker_accounts` table in the `trading` schema (new migration):

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Stable slug (e.g. `alpaca-paper`, `ibkr-live`). |
| `display_name` | `TEXT NOT NULL` | Human-readable label. |
| `broker_type` | `TEXT NOT NULL CHECK (broker_type IN ('alpaca', 'ibkr'))` | |
| `is_paper` | `BOOLEAN NOT NULL DEFAULT true` | |
| `credentials_enc` | `TEXT NOT NULL` | AES-256-GCM encrypted JSON blob of broker credentials. Encrypted with `BROKER_ACCOUNTS_ENCRYPTION_KEY` env var. Never returned in API responses. |
| `is_active` | `BOOLEAN NOT NULL DEFAULT true` | Soft-delete flag for deregistered accounts. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

FR-2. A single new env var `BROKER_ACCOUNTS_ENCRYPTION_KEY` (32-byte key, base64-encoded) is the only credential-related env var added in this feature. It is used to encrypt/decrypt `credentials_enc`. The service refuses to start if this env var is absent. Existing `ALPACA_API_KEY`, `ALPACA_API_SECRET`, etc. are retained for the backwards-compatibility fallback only (FR-5).

FR-3. The credential JSON blobs stored in `credentials_enc` have the following shapes per broker type:
- Alpaca: `{"api_key": "...", "api_secret": "..."}`
- IBKR: `{"consumer_key": "...", "access_token": "...", "access_token_secret": "..."}`

FR-4. At startup, `xstockstrat-trading` reads all rows from `broker_accounts` where `is_active = true`, decrypts each `credentials_enc`, and instantiates one broker client per account. Clients are held in an in-memory map keyed by account `id`.

FR-5. On the dev environment (`ENVIRONMENT=dev`), the service must verify at startup that every active account has `is_paper = true`. If any active account has `is_paper = false`, the service logs fatal and refuses to start. This enforces the staging paper-only invariant regardless of registered accounts.

FR-6. The existing single-account Alpaca env vars (`ALPACA_API_KEY`, `ALPACA_API_SECRET`, `ALPACA_PAPER`, `ALPACA_PAPER_URL`, `ALPACA_LIVE_URL`) are **retained** and seed a virtual `alpaca-default` account if `broker_accounts` contains no active rows. This ensures zero-config backwards compatibility — existing deployments continue to work exactly as before.

### Account Management API

FR-7. Add three RPCs to `TradingService` in `trading/v1/trading.proto`:

```protobuf
rpc RegisterBrokerAccount(RegisterBrokerAccountRequest) returns (BrokerAccount);
rpc ListBrokerAccounts(ListBrokerAccountsRequest) returns (ListBrokerAccountsResponse);
rpc DeregisterBrokerAccount(DeregisterBrokerAccountRequest) returns (DeregisterBrokerAccountResponse);
```

FR-8. `RegisterBrokerAccount` accepts plaintext credentials in the request, encrypts them with `BROKER_ACCOUNTS_ENCRYPTION_KEY`, writes the row to DB, and immediately loads the new broker client into the in-memory pool. No service restart required to begin routing orders to the new account.

FR-9. `DeregisterBrokerAccount` sets `is_active = false` in DB and removes the client from the in-memory pool immediately. In-flight orders on the deregistered account continue to run to completion (the fill poller holds its own reference); new `PlaceOrder` calls targeting the deregistered account return `codes.NotFound`.

FR-10. `ListBrokerAccounts` returns all accounts with `credentials_enc` omitted from the response — callers never see plaintext or ciphertext credentials.

FR-11. The `BrokerAccount` proto message exposes: `id`, `display_name`, `broker_type` (`BrokerType` enum), `is_paper`, `is_active`, `created_at`. No credential fields.

### Broker Interface and Client Pool

FR-12. Extract a `Broker` interface in `services/xstockstrat-trading/internal/broker/`:
```go
type Broker interface {
    SubmitOrder(ctx context.Context, req SubmitOrderRequest) (*BrokerOrder, error)
    CancelOrder(ctx context.Context, brokerOrderID string) error
    GetOrder(ctx context.Context, brokerOrderID string) (*BrokerOrder, error)
    GetPositions(ctx context.Context) ([]BrokerPosition, error)
}
```
The Alpaca client implements all four methods. `GetPositions` calls Alpaca's `GET /v2/positions` but position sync polling is only enabled for IBKR accounts in this feature (see FR-22); Alpaca's implementation must exist but is not invoked by the sync poller.

FR-13. Create `services/xstockstrat-trading/internal/broker/ibkr.go` implementing `Broker` against the **IBKR Web API** (`https://api.ibkr.com/v1/api/`) using OAuth 1.0a-style HMAC-SHA256 signed requests. `GetPositions` calls `GET /v1/api/portfolio/{accountId}/positions`.

FR-14. `TradingService` holds a `map[string]broker.Broker` (keyed by account id) instead of a single `*broker.Client`. All broker call sites resolve the correct client using `account_id`.

### Proto Contract Changes

FR-15. Add a `BrokerType` enum to `packages/proto/common/v1/common.proto` (additive):
```protobuf
enum BrokerType {
  BROKER_TYPE_UNSPECIFIED = 0;
  BROKER_TYPE_ALPACA      = 1;
  BROKER_TYPE_IBKR        = 2;
}
```

FR-16. Add new fields to the `Order` message in `trading/v1/trading.proto` (additive, fields 19–20):
```protobuf
string account_id = 19;
xstockstrat.common.v1.BrokerType broker_type = 20;
```

FR-17. Add `account_id` (string, optional) to `PlaceOrderRequest`. If omitted when multiple accounts are registered, returns `codes.InvalidArgument`. Omitting it when only one account is active uses that account (backwards-compatible).

FR-18. Add `account_id` (string) to both `Portfolio` and `Position` messages in `portfolio/v1/portfolio.proto`.

FR-19. Add `ListPortfolios` RPC to `PortfolioService`:
```protobuf
rpc ListPortfolios(ListPortfoliosRequest) returns (ListPortfoliosResponse);
```

FR-20. Add three new RPCs to `TradingService` for account management (FR-7), plus their request/response messages (`RegisterBrokerAccountRequest`, `BrokerAccount`, `ListBrokerAccountsRequest`, `ListBrokerAccountsResponse`, `DeregisterBrokerAccountRequest`, `DeregisterBrokerAccountResponse`).

FR-21. Update comment on `Order.broker_order_id` (field 18): "Broker-assigned order ID. Interpretation is broker-specific; populated after broker submission." — non-breaking.

All proto changes are additive. Must pass `buf lint` and `buf breaking --against '.git#branch=main'`.

### Order Routing

FR-22 (was FR-15). When `PlaceOrder` is called with an `account_id`, `TradingService` looks up the broker client. Unknown `account_id` → `codes.NotFound`. `account_id` and `broker_type` are written onto the `Order` row and all downstream ledger events.

FR-23. The IBKR client maps `OrderType` proto enum values to IBKR `orderType` strings:

| Proto `OrderType` | IBKR `orderType` | Additional IBKR fields |
|---|---|---|
| `ORDER_TYPE_MARKET` | `MKT` | — |
| `ORDER_TYPE_LIMIT` | `LMT` | `lmtPrice` ← `Order.limit_price` |
| `ORDER_TYPE_STOP` | `STP` | `auxPrice` ← `Order.stop_price` |
| `ORDER_TYPE_STOP_LIMIT` | `STP LMT` | `lmtPrice` + `auxPrice` |
| `ORDER_TYPE_TRAILING_STOP` | `TRAIL` | `auxPrice` ← `Order.stop_price` (fixed trail amount only) |

FR-24. The IBKR client maps IBKR native order status strings to the existing `OrderStatus` proto enum. No new enum values.

### Portfolio — Account-Scoped Positions

FR-25. `xstockstrat-portfolio` tracks positions per `(user_id, symbol, trading_mode, account_id)`. The `portfolio.positions` table gains an `account_id TEXT` column (new migration) and the unique constraint is updated to include it.

FR-26. When a fill event arrives from `xstockstrat-trading`, it includes `account_id`; `ConsumeOrderFills` updates the position row for that specific account.

FR-27. `ListPortfolios` returns one `Portfolio` per active account for the given `user_id`, each with `account_id` populated.

### IBKR Position Sync

FR-28. Add a `StartPositionSyncPoller` goroutine to `xstockstrat-trading`, started alongside `StartFillPoller`. It polls on a configurable interval (`trading.position_sync.ibkr_interval_ms` config key, default: 300000 ms / 5 min).

FR-29. On each tick, the poller iterates over all IBKR accounts in the client pool and calls `GetPositions(ctx)` on each. Results are used to emit an `account.positions.synced` ledger event with payload:
```json
{
  "account_id": "ibkr-live",
  "broker_type": "ibkr",
  "sync_time": "<ISO timestamp>",
  "positions": [
    {"symbol": "AAPL", "qty": 10.0, "avg_cost": 172.50, "market_value": 1850.00, "unrealized_pnl": 125.00}
  ]
}
```

FR-30. `xstockstrat-portfolio` adds a `ConsumePositionSyncs` goroutine (parallel to `ConsumeOrderFills`) that subscribes to `account.positions.synced` events on the ledger stream. On each event, it atomically replaces all positions for the given `account_id` with the synced snapshot within a single DB transaction. This makes IBKR broker-reported positions the source of truth for IBKR accounts, overriding fill-event-derived state if they drift.

FR-31. Position sync only runs for IBKR accounts. Alpaca accounts continue to use fill-event-based position tracking exclusively in this feature.

### Ledger Events

FR-32. All ledger events carrying broker context (`order.submitted`, `order.broker_submitted`, `order.broker_rejected`, `order.filled`) include both `account_id` and `broker_type` in their payload.

### Fill Polling

FR-33. `StartFillPoller` is extended to run one polling goroutine per account. Each goroutine is bound to an `account_id` and calls `GetOrder` on that account's client. When `RegisterBrokerAccount` is called at runtime, a new fill-polling goroutine is started for the new account.

---

## Out of Scope

- **IBKR market data**: `xstockstrat-marketdata` is not modified. Alpaca remains the sole market data provider.
- **Alpaca position sync**: The `GetPositions` method is implemented on the Alpaca client (FR-12) but the sync poller does not invoke it. Alpaca sync is a trivial follow-up once the sync infrastructure exists.
- **Portfolio aggregation across accounts**: The UI can sum across per-account portfolios from `ListPortfolios`. Server-side aggregation is deferred.
- **IBKR-specific order types**: New `OrderType` enum values (adaptive, midprice, etc.) are deferred.
- **xstockstrat-trader UI changes**: `account_id` and `broker_type` are available on `Order` proto; account selector UI and per-account portfolio view are follow-up features.
- **Trailing stop by percentage**: IBKR `TRAIL` with `trailingPercent` is out of scope; only fixed trail amount is implemented.
- **Credential rotation**: Updating credentials for an existing account requires `DeregisterBrokerAccount` + `RegisterBrokerAccount`. An `UpdateBrokerAccountCredentials` RPC is deferred.

---

## Affected Services

Exact service names from root `CLAUDE.md` Service Registry:

- `xstockstrat-trading` (Go, gRPC 50051 / HTTP 8051) — primary: broker interface, client pool, account management RPCs, encrypted credential storage, IBKR client, per-account fill poller, position sync poller
- `xstockstrat-portfolio` (Go, gRPC 50052 / HTTP 8052) — `account_id` on positions, `ListPortfolios` RPC, `ConsumePositionSyncs` goroutine, IBKR position reconciliation
- `xstockstrat-ledger` (Node.js, gRPC 50057 / HTTP 8057) — no code changes; event payloads gain `account_id` + `broker_type`; new `account.positions.synced` event type stored opaquely
- `xstockstrat-trader` (Next.js, HTTP 3000) — proto stub regeneration only
- `xstockstrat-insights` (Next.js, HTTP 3001) — proto stub regeneration only

Services with **no changes**: `xstockstrat-marketdata`, `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-config-ui`, `xstockstrat-config`.

---

## Proto Contract Changes

All changes are **non-breaking** (additive only). Files in `packages/proto/`.

**1. New `BrokerType` enum — `common/v1/common.proto`**
```protobuf
enum BrokerType {
  BROKER_TYPE_UNSPECIFIED = 0;
  BROKER_TYPE_ALPACA      = 1;
  BROKER_TYPE_IBKR        = 2;
}
```

**2. Additions to `trading/v1/trading.proto`**
- Fields 19–20 on `Order`: `account_id`, `broker_type`
- New field on `PlaceOrderRequest`: `account_id` (optional)
- New messages: `BrokerAccount`, `RegisterBrokerAccountRequest`, `ListBrokerAccountsRequest/Response`, `DeregisterBrokerAccountRequest/Response`
- New RPCs on `TradingService`: `RegisterBrokerAccount`, `ListBrokerAccounts`, `DeregisterBrokerAccount`
- Comment update on `broker_order_id` field 18

**3. Additions to `portfolio/v1/portfolio.proto`**
- New field `account_id` on `Portfolio` and `Position`
- New messages: `ListPortfoliosRequest`, `ListPortfoliosResponse`
- New RPC on `PortfolioService`: `ListPortfolios`

Approval gate: additive-only → **1 service owner approval** (trading + portfolio owners).

---

## Config Key Changes

One new env var (not a config service key):

| Variable | Where | Default | Description |
|---|---|---|---|
| `BROKER_ACCOUNTS_ENCRYPTION_KEY` | `xstockstrat-trading` | — | 32-byte base64-encoded AES-256-GCM master key. Required; service refuses to start if absent. |

One new config service key:

| Key | Type | Default | Scope | Description |
|---|---|---|---|---|
| `trading.position_sync.ibkr_interval_ms` | int | `300000` | `all` | IBKR position sync poll interval in ms (5 min default). Live-reloaded via WatchConfig. |

No per-account env vars. Existing `ALPACA_*` env vars retained for backwards-compatibility fallback only.

---

## Database Changes

**`services/xstockstrat-trading/migrations/`**

Migration A — `NNN_broker_accounts.up.sql`:
```sql
CREATE TABLE IF NOT EXISTS trading.broker_accounts (
    id               TEXT PRIMARY KEY,
    display_name     TEXT        NOT NULL,
    broker_type      TEXT        NOT NULL CHECK (broker_type IN ('alpaca', 'ibkr')),
    is_paper         BOOLEAN     NOT NULL DEFAULT true,
    credentials_enc  TEXT        NOT NULL,
    is_active        BOOLEAN     NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Migration B — `NNN_orders_account_id.up.sql`:
```sql
ALTER TABLE trading.orders ADD COLUMN IF NOT EXISTS account_id TEXT;
```

**`services/xstockstrat-portfolio/migrations/`**

Migration C — `NNN_positions_account_id.up.sql`:
```sql
ALTER TABLE portfolio.positions ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT 'alpaca-default';
ALTER TABLE portfolio.positions DROP CONSTRAINT IF EXISTS positions_user_id_symbol_trading_mode_key;
ALTER TABLE portfolio.positions ADD CONSTRAINT positions_user_symbol_mode_account_key
    UNIQUE (user_id, symbol, trading_mode, account_id);
```

Down migrations provided for all three. Approval gate: DBA review + service owner required.

---

## Feature Workflow Notes

Branch to create: `feature/add-ikbr-account-support` (branch from `main-dev`)

Approval gates:
- [x] **1 service owner approval** — required (non-breaking proto additions)
- [ ] 2 service owners + platform lead — NOT required
- [x] **DBA review + service owner** — required (3 schema migrations)
- [ ] Config team — NOT required (no new config service keys beyond `trading.position_sync.ibkr_interval_ms`)

CI requirements: `buf lint` + `buf breaking --against '.git#branch=origin/main'` must pass. Regenerate stubs via `./scripts/buf-gen.sh`.

Deployment sequence:
1. Merge to `main-dev` → backwards-compat fallback keeps existing Alpaca behaviour
2. Migrations auto-run via `db-migrator` PRE_DEPLOY job
3. Set `BROKER_ACCOUNTS_ENCRYPTION_KEY` on dev environment
4. Validate Alpaca paper path (no `broker_accounts` rows → fallback)
5. Call `RegisterBrokerAccount` to register paper Alpaca + paper IBKR accounts on dev
6. Validate multi-account routing, per-account portfolio, and IBKR position sync on dev
7. Merge `main-dev` → `main` for production; set `BROKER_ACCOUNTS_ENCRYPTION_KEY` on prod

---

## Acceptance Criteria

1. With no rows in `broker_accounts`, existing Alpaca paper/live flows continue unchanged via the fallback.
2. After calling `RegisterBrokerAccount` (Alpaca + IBKR), orders route to the correct broker immediately — no restart.
3. `Order.account_id` and `Order.broker_type` are set in all responses and persisted.
4. On dev, service refuses to start if any active account has `is_paper = false`.
5. `ListBrokerAccounts` returns accounts without any credential data.
6. `DeregisterBrokerAccount` removes the client from the pool; subsequent `PlaceOrder` calls return `codes.NotFound`.
7. `ListPortfolios` returns one `Portfolio` per active account, each with `account_id` populated.
8. Every 5 minutes (default), `account.positions.synced` events are emitted for each IBKR account and portfolio positions are reconciled.
9. Ledger events `order.submitted`, `order.broker_submitted`, `order.broker_rejected`, `order.filled` include `account_id` and `broker_type`.
10. `buf lint` and `buf breaking` pass in CI; stubs regenerated and committed.
11. Existing `xstockstrat-trading` and `xstockstrat-portfolio` tests pass; new unit tests cover IBKR order/status mapping, credential encrypt/decrypt, and position sync reconciliation.
12. `PlaceOrder` without `account_id` returns `codes.InvalidArgument` when multiple accounts are registered.

---

## Open Questions

- [x] **OQ-1 — RESOLVED**: IBKR Web API selected over Client Portal Gateway.
- [x] **OQ-2 — RESOLVED**: IBKR paper account available for dev testing.
- [x] **OQ-3 — RESOLVED**: All five `OrderType` values map cleanly to IBKR (see FR-23).
- [x] **OQ-4 — RESOLVED**: Multi-account model with encrypted DB credential storage (FR-1 through FR-11). No per-account env vars.
- [x] **OQ-5 — RESOLVED**: IBKR position sync in scope via `StartPositionSyncPoller` + `ConsumePositionSyncs` (FR-28 through FR-31).
