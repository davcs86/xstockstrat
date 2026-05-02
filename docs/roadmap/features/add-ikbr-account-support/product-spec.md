# Product Spec: add-ikbr-account-support

**Created**: 2026-05-02
**Last Revised**: 2026-05-02

---

## Problem Statement

The platform assumes a single broker account globally. `xstockstrat-trading` is hard-wired to one Alpaca account with no account abstraction, `xstockstrat-portfolio` tracks a single set of positions, and there is no concept of a named broker account in the proto contract. A user who holds both Alpaca and IBKR accounts — or multiple accounts of the same broker type — cannot use the platform to manage and track all of them together. Adding multi-account support requires an account registry, a broker client pool, and account-scoped positions in the portfolio, without relaxing the staging (paper-only) safety invariant.

## User Story

As a platform user, I want to register multiple broker accounts (Alpaca and/or IBKR) and place orders against a specific account, so that my portfolio tracks positions and P&L across all my accounts in one place, with dev always running in paper mode regardless of which accounts are registered.

---

## Functional Requirements

### Account Registry

FR-1. Introduce a `broker_accounts` table in the `trading` schema (new migration). Each row represents one registered broker account:

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Stable slug chosen by the operator (e.g. `alpaca-paper`, `ibkr-live`). Used as credential env var suffix. |
| `display_name` | `TEXT NOT NULL` | Human-readable label. |
| `broker_type` | `TEXT NOT NULL` | `"alpaca"` or `"ibkr"`. |
| `is_paper` | `BOOLEAN NOT NULL` | Whether this account is a paper/simulated account. |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Row creation timestamp. |

FR-2. At startup, `xstockstrat-trading` reads all rows from `broker_accounts` and instantiates one broker client per account. The service refuses to start if the table is empty. Clients are held in an in-memory map keyed by account `id`.

FR-3. On the dev environment (`ENVIRONMENT=dev`), the service must verify at startup that every registered account has `is_paper = true`. If any account has `is_paper = false`, the service logs fatal and refuses to start. This enforces the staging paper-only invariant regardless of what accounts are registered.

FR-4. Credentials for each account are supplied as env vars keyed by account ID slug:
- Alpaca accounts: `ALPACA_KEY_<ID>`, `ALPACA_SECRET_<ID>`
- IBKR accounts: `IBKR_CONSUMER_KEY_<ID>`, `IBKR_ACCESS_TOKEN_<ID>`, `IBKR_ACCESS_TOKEN_SECRET_<ID>`

Where `<ID>` is the uppercased, hyphen-to-underscore conversion of the account `id` slug (e.g. account id `ibkr-live` → `IBKR_CONSUMER_KEY_IBKR_LIVE`). The service logs fatal at startup if any registered account is missing its required credentials.

FR-5. The existing single-account Alpaca env vars (`ALPACA_API_KEY`, `ALPACA_API_SECRET`, `ALPACA_PAPER`, `ALPACA_PAPER_URL`, `ALPACA_LIVE_URL`) are **retained** and seed a default account named `alpaca-default` if no `broker_accounts` rows exist. This ensures zero-config backwards compatibility — existing deployments with no `broker_accounts` rows continue to work exactly as before.

### Broker Interface and Client Pool

FR-6. Extract a `Broker` interface from `services/xstockstrat-trading/internal/broker/` exposing `SubmitOrder`, `CancelOrder`, and `GetOrder`. The existing Alpaca `Client` struct must implement this interface without behavioural changes.

FR-7. Create `services/xstockstrat-trading/internal/broker/ibkr.go` implementing the `Broker` interface against the **IBKR Web API** (`https://api.ibkr.com/v1/api/`) using OAuth 1.0a-style HMAC-SHA256 signed requests (Consumer Key + Access Token, server-to-server).

FR-8. `TradingService` holds a `map[string]broker.Broker` (keyed by account id) instead of a single `*broker.Client`. All broker call sites resolve the client from this map using the `account_id` on the incoming request.

### Proto Contract Changes

FR-9. Add a `BrokerType` enum to `packages/proto/common/v1/common.proto` (additive — new enum):
```protobuf
enum BrokerType {
  BROKER_TYPE_UNSPECIFIED = 0;
  BROKER_TYPE_ALPACA      = 1;
  BROKER_TYPE_IBKR        = 2;
}
```

FR-10. Add two new optional fields to the `Order` message in `packages/proto/trading/v1/trading.proto` (additive — next available field numbers 19 and 20):
```protobuf
string account_id = 19;                               // Registered broker account that executed this order
xstockstrat.common.v1.BrokerType broker_type = 20;   // Derived from the account's broker_type at order creation
```

FR-11. Add `account_id` (string, optional) to `PlaceOrderRequest` in `trading/v1/trading.proto`. If omitted, `TradingService` uses the single registered account (backwards-compatible default when only one account is configured). If multiple accounts are registered and `account_id` is absent, the service returns an error.

FR-12. Add `account_id` (string) to the `Portfolio` message in `packages/proto/portfolio/v1/portfolio.proto` at the next available field number. One portfolio document exists per registered broker account.

FR-13. Update the comment on `Order.broker_order_id` (field 18): "Broker-assigned order ID. Interpretation is broker-specific; populated after broker submission."

FR-14. All proto changes are additive (new enum, new optional fields on existing messages). They must pass `buf lint` and `buf breaking --against '.git#branch=main'`.

### Order Routing

FR-15. When `PlaceOrder` is called with an `account_id`, `TradingService` looks up the broker client in the pool. If the account ID is not found, it returns `codes.NotFound`. The `account_id` and `broker_type` are written onto the persisted `Order` row and all downstream ledger events.

FR-16. The IBKR client maps `OrderType` proto enum values to IBKR `orderType` strings. All five existing types map cleanly; no new enum values are introduced:

| Proto `OrderType` | IBKR `orderType` | Additional IBKR fields |
|---|---|---|
| `ORDER_TYPE_MARKET` | `MKT` | — |
| `ORDER_TYPE_LIMIT` | `LMT` | `lmtPrice` ← `Order.limit_price` |
| `ORDER_TYPE_STOP` | `STP` | `auxPrice` ← `Order.stop_price` |
| `ORDER_TYPE_STOP_LIMIT` | `STP LMT` | `lmtPrice` + `auxPrice` |
| `ORDER_TYPE_TRAILING_STOP` | `TRAIL` | `auxPrice` ← `Order.stop_price` (fixed trail amount; trailing % out of scope) |

FR-17. The IBKR client maps IBKR native order status strings to the existing `OrderStatus` proto enum. No new `OrderStatus` values are introduced.

### Portfolio — Account-Scoped Positions

FR-18. `xstockstrat-portfolio` tracks one `Portfolio` document per registered broker account. When a fill event arrives from `xstockstrat-trading`, it includes `account_id`; the portfolio service updates the correct account's portfolio.

FR-19. `xstockstrat-portfolio` exposes a `ListPortfolios` RPC (or equivalent) that returns all account portfolios for a given `user_id`, so the UI can display aggregate and per-account views.

### Ledger Events

FR-20. All ledger events that carry broker context (`order.submitted`, `order.broker_submitted`, `order.broker_rejected`, `order.filled`) must include both `account_id` and `broker_type` in their payload.

### Fill Polling

FR-21. The existing `StartFillPoller`/`pollFills` mechanism is extended to poll each account's broker client independently. Each polling goroutine is bound to an `account_id` and calls `GetOrder` on that account's client.

---

## Out of Scope

- **IBKR market data**: `xstockstrat-marketdata` is not modified. Alpaca remains the sole market data provider.
- **Portfolio aggregation across accounts**: The UI can sum across the per-account portfolios returned by `ListPortfolios`. Server-side aggregation is deferred.
- **Runtime account addition/removal**: Adding or removing an account requires a DB migration + service restart. Hot-reloading the account registry mid-run is deferred.
- **IBKR portfolio position sync**: Syncing IBKR broker-side position data back into the portfolio (reconciliation) is out of scope.
- **IBKR-specific order types**: New `OrderType` enum values (adaptive, midprice, etc.) are deferred.
- **xstockstrat-trader UI changes**: `account_id` and `broker_type` are available on the `Order` proto; account selector UI and per-account portfolio view are follow-up features.
- **Trailing stop by percentage**: IBKR `TRAIL` with `trailingPercent` field is out of scope; only fixed trail amount (`auxPrice`) is implemented.

---

## Affected Services

Exact service names from root `CLAUDE.md` Service Registry:

- `xstockstrat-trading` (Go, gRPC 50051 / HTTP 8051) — primary: broker interface, client pool, account registry read, IBKR client, fill poller per account
- `xstockstrat-portfolio` (Go, gRPC 50052 / HTTP 8052) — add `account_id` to Portfolio, add `ListPortfolios` RPC, per-account position tracking
- `xstockstrat-ledger` (Node.js, gRPC 50057 / HTTP 8057) — no code changes; event payloads gain `account_id` + `broker_type` fields stored opaquely
- `xstockstrat-config` (Node.js, gRPC 50060 / HTTP 8060) — no new config keys (account config is now DB-backed, not config-service-backed)
- `xstockstrat-trader` (Next.js, HTTP 3000) — proto stub regeneration only
- `xstockstrat-insights` (Next.js, HTTP 3001) — proto stub regeneration only

Services with **no changes**: `xstockstrat-marketdata`, `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-config-ui`.

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

**2. New fields on `Order` — `trading/v1/trading.proto`** (fields 19, 20)
```protobuf
string account_id = 19;
xstockstrat.common.v1.BrokerType broker_type = 20;
```

**3. New field on `PlaceOrderRequest` — `trading/v1/trading.proto`** (next available field)
```protobuf
string account_id = <N>;  // optional; required when multiple accounts are registered
```

**4. New field on `Portfolio` — `portfolio/v1/portfolio.proto`** (next available field)
```protobuf
string account_id = <N>;
```

**5. New RPC on `PortfolioService` — `portfolio/v1/portfolio.proto`**
```protobuf
rpc ListPortfolios(ListPortfoliosRequest) returns (ListPortfoliosResponse);
```

**6. Comment update on `Order.broker_order_id` (field 18)** — non-breaking.

Approval gate: additive-only changes → **1 service owner approval** required (trading + portfolio owners).

---

## Config Key Changes

- [ ] No new config keys required.

Account configuration moves from config service keys to the `broker_accounts` DB table (FR-1). The existing `trading.broker.*` keys continue to apply only when the backwards-compatibility fallback (FR-5) is in effect.

New env vars for `xstockstrat-trading` (secrets, never in config service or DB):

Per-account, where `<ID>` = uppercased slug with hyphens replaced by underscores:

| Variable | Broker type | Required when |
|---|---|---|
| `ALPACA_KEY_<ID>` | alpaca | account registered with `broker_type=alpaca` |
| `ALPACA_SECRET_<ID>` | alpaca | account registered with `broker_type=alpaca` |
| `IBKR_CONSUMER_KEY_<ID>` | ibkr | account registered with `broker_type=ibkr` |
| `IBKR_ACCESS_TOKEN_<ID>` | ibkr | account registered with `broker_type=ibkr` |
| `IBKR_ACCESS_TOKEN_SECRET_<ID>` | ibkr | account registered with `broker_type=ibkr` |

Existing global env vars (`ALPACA_API_KEY`, `ALPACA_API_SECRET`, `ALPACA_PAPER`, `ALPACA_PAPER_URL`, `ALPACA_LIVE_URL`) are retained for the backwards-compatibility fallback.

---

## Database Changes

New migration required in `services/xstockstrat-trading/migrations/`:

**Up (`NNN_broker_accounts.up.sql`)**:
```sql
CREATE TABLE IF NOT EXISTS trading.broker_accounts (
    id          TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    broker_type TEXT NOT NULL CHECK (broker_type IN ('alpaca', 'ibkr')),
    is_paper    BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Down (`NNN_broker_accounts.down.sql`)**:
```sql
DROP TABLE IF EXISTS trading.broker_accounts;
```

New column on `trading.orders` (separate migration):
```sql
ALTER TABLE trading.orders ADD COLUMN IF NOT EXISTS account_id TEXT;
```

Approval gate: DBA review + service owner required for schema migrations.

---

## Feature Workflow Notes

Branch to create: `feature/add-ikbr-account-support` (branch from `main-dev`)

Approval gates required (per `docs/runbooks/feature-workflow.md`):
- [x] **1 service owner approval** — required (non-breaking proto additions; trading + portfolio owners)
- [ ] 2 service owners + platform lead — NOT required (no breaking proto changes)
- [x] **DBA review + service owner** — required (new `broker_accounts` table + `orders.account_id` column)
- [ ] Config team — NOT required (no new config keys)

CI requirements: `buf lint` + `buf breaking --against '.git#branch=origin/main'` must pass. Regenerate stubs via `./scripts/buf-gen.sh` and commit `packages/proto/gen/`.

Deployment sequence:
1. Merge to `main-dev` → backwards-compatibility fallback (FR-5) keeps existing Alpaca behaviour unchanged
2. Run `db-migrate.sh` on dev to create `broker_accounts` table (auto-run by `db-migrator` PRE_DEPLOY)
3. Validate Alpaca paper path still works on dev (regression; zero rows in `broker_accounts`)
4. Insert a paper Alpaca row and a paper IBKR row into `broker_accounts` on dev; set per-account env vars
5. Validate multi-account order routing and per-account portfolio on dev
6. Merge `main-dev` → `main` for production deploy

---

## Acceptance Criteria

1. With no rows in `broker_accounts`, existing single-account Alpaca paper/live flows continue to work using the `ALPACA_API_KEY`/`ALPACA_API_SECRET` fallback.
2. With two rows in `broker_accounts` (one Alpaca, one IBKR), `PlaceOrder` routes to the correct broker based on `account_id`. Both accounts can receive orders in the same running instance.
3. `Order.account_id` and `Order.broker_type` are set correctly in all gRPC responses and persisted to `trading.orders`.
4. On the dev environment, if any `broker_accounts` row has `is_paper = false`, the service refuses to start with a fatal log.
5. `ListPortfolios` returns one `Portfolio` per registered account, each with `account_id` populated.
6. Ledger events `order.submitted`, `order.broker_submitted`, `order.broker_rejected`, `order.filled` include `account_id` and `broker_type`.
7. `buf lint` and `buf breaking` pass in CI.
8. Generated stubs in `packages/proto/gen/go/`, `gen/python/`, `gen/ts/` are regenerated and committed.
9. All existing `xstockstrat-trading` and `xstockstrat-portfolio` tests pass. New unit tests cover IBKR order status mapping and account-id routing.
10. `PlaceOrder` without `account_id` returns `codes.InvalidArgument` when multiple accounts are registered.

---

## Open Questions

- [x] **OQ-1 — RESOLVED**: Use **IBKR Web API** (`https://api.ibkr.com/v1/api/`) with OAuth 1.0a HMAC-SHA256 signed requests. Client Portal Gateway excluded: requires a local proxy and browser session that expires — not suitable for automated servers.
- [x] **OQ-2 — RESOLVED**: IBKR paper account confirmed available for dev testing.
- [x] **OQ-3 — RESOLVED**: All five `OrderType` enum values map cleanly to IBKR order types (see FR-16).
- [x] **OQ-4 — RESOLVED**: Multi-account model adopted (FR-1 through FR-5). Single `trading.broker.active` config key approach superseded by `broker_accounts` DB table with per-account credentials.
