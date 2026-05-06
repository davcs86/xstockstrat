# Implementation Spec: add-ikbr-account-support

**Status**: `in-progress`
**Created**: 2026-05-02
**Feature**: `docs/roadmap/features/add-ikbr-account-support/feature.md`
**Total Steps**: 18
**Feature Branch**: `feature/add-ikbr-account-support`

---

## Execution Summary

Add multi-broker account support: register Alpaca and/or IBKR accounts with AES-256-GCM encrypted credentials stored in the DB. Orders route to a specific account via `account_id`. Portfolio tracks positions per account. A position sync poller reconciles all broker accounts against broker truth every N ms (configurable, live-reloaded). Dev enforces paper-only. No existing env var changes required for existing single-Alpaca deployments.

**Affected services**: `xstockstrat-trading` (Go), `xstockstrat-portfolio` (Go)
**Affected proto packages**: `common/v1`, `trading/v1`, `portfolio/v1`
**New DB migrations**: trading `002`, `003`; portfolio `003`
**Approval required**: 1 service owner (additive proto changes) + DBA review (schema migrations)

One new config key: `trading.position_sync.interval_ms` (int, default 300000, live-reloaded) — register in `xstockstrat-config` before deploying (see `docs/runbooks/config-rollout.md`). One new env var: `BROKER_ACCOUNTS_ENCRYPTION_KEY` on `xstockstrat-trading` (64-char hex string, required).

### Step Index

| Step | Description | Service/Repo |
|---|---|---|
| 1 | Add `BrokerType` enum to `common/v1` | proto |
| 2 | Add broker account messages + RPCs to `trading/v1` | proto |
| 3 | Add `account_id` fields + `ListPortfolios` to `portfolio/v1` | proto |
| 4 | Regenerate proto stubs | proto |
| 5 | Migration: `trading` — `broker_accounts` table | trading |
| 6 | Migration: `trading` — `orders.account_id` + `orders.broker_type` | trading |
| 7 | Migration: `portfolio` — `positions.account_id` | portfolio |
| 8 | Add `BrokerAccountsEncryptionKey` + `AppEnv` to trading config | trading |
| 9 | Extract `Broker` interface; add `GetPositions` to Alpaca client | trading |
| 10 | Create IBKR broker client | trading |
| 11 | Create account repository (`broker_accounts` CRUD) | trading |
| 12 | Update order repository: `account_id` + `broker_type` columns | trading |
| 13 | Update `TradingService`: broker pool, account management, routing | trading |
| 14 | Add account management + position sync handler methods | trading |
| 15 | Update `main.go` (trading): encryption key, pool init, new goroutine | trading |
| 16 | Update portfolio repository: `account_id` on positions | portfolio |
| 17 | Update `PortfolioService`: `ConsumePositionSyncs`, `ListPortfolios` | portfolio |
| 18 | Add `ListPortfolios` handler; update portfolio `main.go` | portfolio |

---

## Step Dependencies

- Step 2 requires Step 1: `trading.proto` imports `common/v1.BrokerType` added in Step 1
- Step 4 requires Steps 1–3: stubs are generated from the updated proto files
- Step 10 requires Step 9: IBKR client implements `broker.Broker` interface defined in Step 9
- Step 11 requires Step 5: account repo reads/writes `trading.broker_accounts` table created in Step 5
- Step 11 requires Step 8: account repo uses `BrokerAccountsEncryptionKey` from config (Step 8)
- Step 12 requires Step 6: order repo references `account_id`/`broker_type` columns added in Step 6
- Step 12 requires Step 4: order repo returns proto `BrokerType` from generated stubs (Step 4)
- Step 13 requires Steps 9, 10, 11, 12: `TradingService` composes broker pool, account repo, order repo
- Step 14 requires Steps 4, 13: handler needs new proto stubs and new service methods
- Step 15 requires Steps 8, 11, 13, 14: `main.go` wires config key, account repo, service, handler
- Step 16 requires Step 7: portfolio repo uses `account_id` column added in Step 7
- Step 17 requires Steps 4, 16: `PortfolioService` uses `ListPortfolios` proto stub and updated repo
- Step 18 requires Steps 4, 17: handler uses new proto stub and new service method

---

### Step 1 — proto: Add `BrokerType` enum to `common/v1`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/common/v1/common.proto` — modify

**Codebase Evidence**:
- Confirmed via: `tail -5 packages/proto/common/v1/common.proto` → last line L62 is `}` closing the `Environment` enum
- Existing pattern: `  ENVIRONMENT_PRODUCTION = 2;` at L61, followed by `}` at L62

**Instructions**:

Append after L62 (end of file):

```protobuf
// BrokerType identifies the broker for a registered account.
enum BrokerType {
  BROKER_TYPE_UNSPECIFIED = 0;
  BROKER_TYPE_ALPACA = 1;
  BROKER_TYPE_IBKR = 2;
}
```

This is an additive enum addition. `buf breaking` will not flag it. Requires 1 service owner approval per governance rules.

**Verification**:
`buf lint packages/proto` passes; `buf breaking --against '.git#branch=main-dev' packages/proto` passes.

**Status**: `done`

---

### Step 2 — proto: Add broker account messages + RPCs to `trading/v1`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/trading/v1/trading.proto` — modify

**Codebase Evidence**:
- Confirmed via: `grep -n "broker_order_id\|stop_price\|rpc GetOrder" packages/proto/trading/v1/trading.proto`
- Existing pattern: `Order` field 18 = `string broker_order_id = 18;`; `PlaceOrderRequest` field 12 = `double stop_price = 12;`; current last RPC is `rpc GetOrder (GetOrderRequest) returns (GetOrderResponse);`

**Instructions**:

**2a — Add `account_id` and `broker_type` to `Order` message.**

Current field 18: `string broker_order_id = 18;`

Add after field 18:

```protobuf
  string account_id = 19;
  common.v1.BrokerType broker_type = 20;
```

**2b — Add `account_id` to `PlaceOrderRequest`.**

Current last field (12): `double stop_price = 12;`

Add after field 12:

```protobuf
  // account_id routes the order to a specific broker account.
  // Required when multiple accounts are registered; optional when only one exists.
  string account_id = 13;
```

**2c — Add `BrokerAccount` message and account management request/response messages.**

Add new messages (after existing message definitions, before the `TradingService` definition):

```protobuf
// BrokerAccount is a registered broker account (credentials never returned).
message BrokerAccount {
  string id = 1;
  string display_name = 2;
  common.v1.BrokerType broker_type = 3;
  bool is_paper = 4;
  string user_id = 5;
  bool is_active = 6;
}

message RegisterBrokerAccountRequest {
  string display_name = 1;
  common.v1.BrokerType broker_type = 2;
  bool is_paper = 3;
  // credentials_json: broker-type-specific JSON blob.
  // Alpaca: {"api_key":"...","api_secret":"..."}
  // IBKR:   {"consumer_key":"...","access_token":"...","access_token_secret":"...","ibkr_account_id":"..."}
  string credentials_json = 4;
}

message RegisterBrokerAccountResponse {
  BrokerAccount account = 1;
}

message ListBrokerAccountsRequest {}

message ListBrokerAccountsResponse {
  repeated BrokerAccount accounts = 1;
}

message DeregisterBrokerAccountRequest {
  string account_id = 1;
}

message DeregisterBrokerAccountResponse {}
```

**2d — Add 3 new RPCs to `TradingService`.**

Current last RPC: `rpc GetOrder (GetOrderRequest) returns (GetOrderResponse);`

Add after the last RPC:

```protobuf
  rpc RegisterBrokerAccount (RegisterBrokerAccountRequest) returns (RegisterBrokerAccountResponse);
  rpc ListBrokerAccounts (ListBrokerAccountsRequest) returns (ListBrokerAccountsResponse);
  rpc DeregisterBrokerAccount (DeregisterBrokerAccountRequest) returns (DeregisterBrokerAccountResponse);
```

**Verification**:
`buf lint packages/proto` passes; `buf breaking --against '.git#branch=main-dev' packages/proto` passes (all changes are additive).

**Status**: `done`

---

### Step 3 — proto: Add `account_id` fields + `ListPortfolios` to `portfolio/v1`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/portfolio/v1/portfolio.proto` — modify

**Codebase Evidence**:
- Confirmed via: `grep -n "realized_pnl\|last_updated\|snapshot_time\|StreamPortfolioUpdates" packages/proto/portfolio/v1/portfolio.proto`
- Existing pattern: `Portfolio` last field (10) = `double realized_pnl = 10;`; `Position` last field (10) = `google.protobuf.Timestamp last_updated = 10;`; `PortfolioSnapshot` last field (7) = `google.protobuf.Timestamp snapshot_time = 7;`; `PortfolioService` last RPC is `StreamPortfolioUpdates`

**Instructions**:

**3a — Add `account_id` to `Portfolio`, `Position`, `PortfolioSnapshot`.**

`Portfolio` current last field (10): `double realized_pnl = 10;`
Add: `  string account_id = 11;`

`Position` current last field (10): `google.protobuf.Timestamp last_updated = 10;`
Add: `  string account_id = 11;`

`PortfolioSnapshot` current last field (7): `google.protobuf.Timestamp snapshot_time = 7;`
Add: `  string account_id = 8;`

**3b — Add optional `account_id` to all read request messages.**

For each of: `GetPortfolioRequest`, `GetPositionRequest`, `ListPositionsRequest`, `GetPnLRequest`, `GetSnapshotRequest`, `StreamPortfolioUpdatesRequest` — append an `optional string account_id` field at the next available field number.

Example for `GetPortfolioRequest` (current fields 1–2):
```protobuf
  optional string account_id = 3;
```
Apply the same pattern to the remaining request messages, advancing the field number appropriately based on each message's current last field.

**3c — Add `ListPortfolios` RPC and messages.**

```protobuf
message ListPortfoliosRequest {
  optional string account_id = 1;
}

message ListPortfoliosResponse {
  repeated Portfolio portfolios = 1;
}
```

Add to `PortfolioService` after the last existing RPC (`StreamPortfolioUpdates`):

```protobuf
  rpc ListPortfolios (ListPortfoliosRequest) returns (ListPortfoliosResponse);
```

**Verification**:
`buf lint packages/proto` passes; `buf breaking --against '.git#branch=main-dev' packages/proto` passes.

---

### Step 4 — proto-gen: Regenerate proto stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/common/v1/` — regenerate
- `packages/proto/gen/go/trading/v1/` — regenerate
- `packages/proto/gen/go/portfolio/v1/` — regenerate
- `packages/proto/gen/ts/` — regenerate
- `packages/proto/gen/python/` — regenerate

**Codebase Evidence**:
- Confirmed via: `grep -n "UnimplementedTradingServiceHandler\|var _" packages/proto/gen/go/trading/v1/tradingv1connect/trading.connect.go` → `UnimplementedTradingServiceHandler` at L204 (5 stubs); compile-time assertion at L17
- Confirmed via: `grep -n "UnimplementedPortfolioServiceHandler\|var _" packages/proto/gen/go/portfolio/v1/portfoliov1connect/portfolio.connect.go` → `UnimplementedPortfolioServiceHandler` at L230 (6 stubs); compile-time assertion at L17

**Instructions**:

```bash
cd packages/proto
./../../scripts/buf-gen.sh
```

This regenerates:
- `packages/proto/gen/go/common/v1/` — adds `BrokerType` enum constants
- `packages/proto/gen/go/trading/v1/` — adds new fields + messages
- `packages/proto/gen/go/trading/v1/tradingv1connect/trading.connect.go` — `UnimplementedTradingServiceHandler` gains 3 new stub methods; existing 5 stubs unchanged
- `packages/proto/gen/go/portfolio/v1/` — adds new fields
- `packages/proto/gen/go/portfolio/v1/portfoliov1connect/portfolio.connect.go` — `UnimplementedPortfolioServiceHandler` gains `ListPortfolios` stub
- `packages/proto/gen/ts/` — TypeScript stubs updated
- `packages/proto/gen/python/` — Python stubs updated

Commit generated stubs to `packages/proto/gen/` as part of this step's commit.

After this step, both `xstockstrat-trading` and `xstockstrat-portfolio` will **not compile** until the new handler methods are implemented (Steps 14 and 18). The compile-time assertions at:
- `services/xstockstrat-trading/internal/handler/trading.go` L17: `var _ tradingv1connect.TradingServiceHandler = (*TradingHandler)(nil)`
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` L17: `var _ portfoliov1connect.PortfolioServiceHandler = (*PortfolioHandler)(nil)`

...will fail until the 3 trading handler methods (Step 14) and `ListPortfolios` portfolio handler method (Step 18) are added.

**Verification**:
`./scripts/buf-gen.sh` exits 0; `git diff packages/proto/gen/` shows new fields and stubs.

---

### Step 5 — migration: `trading` — `broker_accounts` table

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/migrations/002_broker_accounts.up.sql` — create
- `services/xstockstrat-trading/migrations/002_broker_accounts.down.sql` — create

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-trading/migrations/ | sort` → last file is `001_orders_hypertable.up.sql`; next migration number is `002`

**Instructions**:

**New file**: `services/xstockstrat-trading/migrations/002_broker_accounts.up.sql`

```sql
CREATE TABLE IF NOT EXISTS trading.broker_accounts (
    id              TEXT        NOT NULL PRIMARY KEY,
    display_name    TEXT        NOT NULL,
    broker_type     SMALLINT    NOT NULL, -- 1=ALPACA, 2=IBKR (matches BrokerType proto enum)
    is_paper        BOOLEAN     NOT NULL DEFAULT TRUE,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    user_id         TEXT        NOT NULL,
    credentials_enc BYTEA       NOT NULL, -- AES-256-GCM encrypted JSON blob
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS broker_accounts_user_id_idx ON trading.broker_accounts (user_id);
CREATE INDEX IF NOT EXISTS broker_accounts_active_idx  ON trading.broker_accounts (is_active) WHERE is_active = TRUE;
```

**New file**: `services/xstockstrat-trading/migrations/002_broker_accounts.down.sql`

```sql
DROP TABLE IF EXISTS trading.broker_accounts;
```

**Note**: The `alpaca-default` seed row is inserted by application startup (`ensureAlpacaDefaultAccount`) rather than this migration, because the `db-migrator` PRE_DEPLOY job runs without trading-service env vars. The migration only creates the schema.

**Verification**:
`./scripts/db-migrate.sh` exits 0; `\dt trading.*` in psql shows `broker_accounts` table.

---

### Step 6 — migration: `trading` — `orders.account_id` + `orders.broker_type`

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/migrations/003_orders_account_id.up.sql` — create
- `services/xstockstrat-trading/migrations/003_orders_account_id.down.sql` — create

**Codebase Evidence**:
- Confirmed via: migration `002_broker_accounts` created in Step 5; next number is `003`
- Existing pattern: `trading.orders` hypertable exists with `broker_order_id TEXT` (broker-agnostic column already present from phase 4)

**Instructions**:

**New file**: `services/xstockstrat-trading/migrations/003_orders_account_id.up.sql`

```sql
ALTER TABLE trading.orders
    ADD COLUMN IF NOT EXISTS account_id   TEXT     NOT NULL DEFAULT 'alpaca-default',
    ADD COLUMN IF NOT EXISTS broker_type  SMALLINT NOT NULL DEFAULT 1; -- 1=ALPACA

CREATE INDEX IF NOT EXISTS orders_account_id_idx ON trading.orders (account_id);
```

**New file**: `services/xstockstrat-trading/migrations/003_orders_account_id.down.sql`

```sql
ALTER TABLE trading.orders
    DROP COLUMN IF EXISTS account_id,
    DROP COLUMN IF EXISTS broker_type;
```

Defaults of `'alpaca-default'` and `1` preserve backward compatibility for all existing rows.

**Verification**:
`./scripts/db-migrate.sh` exits 0; `\d trading.orders` shows `account_id` and `broker_type` columns.

---

### Step 7 — migration: `portfolio` — `positions.account_id`

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/migrations/003_positions_account_id.up.sql` — create
- `services/xstockstrat-portfolio/migrations/003_positions_account_id.down.sql` — create

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-portfolio/migrations/ | sort` → last file is `002_add_trading_mode.up.sql`; next number is `003`
- Confirmed via: `grep "CONSTRAINT\|UNIQUE" services/xstockstrat-portfolio/migrations/002_add_trading_mode.up.sql` → constraint name `positions_user_id_symbol_trading_mode_key (user_id, symbol, trading_mode)`

**Instructions**:

**File to reference first**: `services/xstockstrat-portfolio/migrations/002_add_trading_mode.up.sql`

The current unique constraint is: `CONSTRAINT positions_user_id_symbol_trading_mode_key UNIQUE (user_id, symbol, trading_mode)`

**New file**: `services/xstockstrat-portfolio/migrations/003_positions_account_id.up.sql`

```sql
ALTER TABLE portfolio.positions
    ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT 'alpaca-default';

-- Drop old 3-column unique constraint; add new 4-column constraint.
ALTER TABLE portfolio.positions
    DROP CONSTRAINT IF EXISTS positions_user_id_symbol_trading_mode_key;

ALTER TABLE portfolio.positions
    ADD CONSTRAINT positions_user_symbol_mode_account_key
    UNIQUE (user_id, symbol, trading_mode, account_id);

CREATE INDEX IF NOT EXISTS positions_account_id_idx ON portfolio.positions (account_id);
```

**New file**: `services/xstockstrat-portfolio/migrations/003_positions_account_id.down.sql`

```sql
ALTER TABLE portfolio.positions
    DROP CONSTRAINT IF EXISTS positions_user_symbol_mode_account_key;

ALTER TABLE portfolio.positions
    DROP COLUMN IF EXISTS account_id;

ALTER TABLE portfolio.positions
    ADD CONSTRAINT positions_user_id_symbol_trading_mode_key
    UNIQUE (user_id, symbol, trading_mode);
```

**Verification**:
`./scripts/db-migrate.sh` exits 0; `\d portfolio.positions` shows `account_id` column and updated unique constraint.

---

### Step 8 — config: Add `BrokerAccountsEncryptionKey` + `AppEnv` to trading config

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/config/config.go` — modify

**Codebase Evidence**:
- Confirmed via: `grep -n "type Config\|AppEnv\|BrokerAccounts" services/xstockstrat-trading/internal/config/config.go` → `Config` struct at L16–33; `AppEnv` and `BrokerAccountsEncryptionKey` are not present

**Instructions**:

In the `Config` struct, add two new fields:
```go
BrokerAccountsEncryptionKey string // hex-encoded 32-byte key; required when broker_accounts table is in use
AppEnv                       string // "dev" | "production"
```

In `LoadFromEnv`, add the corresponding reads:
```go
BrokerAccountsEncryptionKey: os.Getenv("BROKER_ACCOUNTS_ENCRYPTION_KEY"),
AppEnv:                      os.Getenv("APP_ENV"),
```

No default values; `main.go` validates `BrokerAccountsEncryptionKey` is non-empty and is a valid 64-char hex string at startup (Step 15a).

**Verification**:
`GOWORK=off go build ./...` in `services/xstockstrat-trading/` exits 0.

---

### Step 9 — service: Extract `Broker` interface; add `GetPositions` to Alpaca client

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/broker.go` — create
- `services/xstockstrat-trading/internal/broker/alpaca.go` — modify
- `services/xstockstrat-trading/internal/broker/alpaca_test.go` — modify

**Codebase Evidence**:
- Confirmed via: `grep -n "func.*Client\|type Client\|SubmitOrder\|GetOrder" services/xstockstrat-trading/internal/broker/alpaca.go` → `Client` struct at L25; `SubmitOrder` at L90 returns `*AlpacaOrder`; `GetOrder` at L154 returns `*AlpacaOrder`
- Confirmed via: `grep -n "Broker\|GetPositions\|strconv" services/xstockstrat-trading/internal/broker/alpaca.go` → no `Broker` interface; no `GetPositions`; imports do NOT include `strconv`
- Confirmed via: `grep -n "order\.ID" services/xstockstrat-trading/internal/broker/alpaca_test.go` → `order.ID` at L55 and L79 (will break when return type changes to `*BrokerOrder`)

**Instructions**:

**New file**: `services/xstockstrat-trading/internal/broker/broker.go`

```go
package broker

import "context"

// BrokerOrder is the normalized order representation returned by any broker.
type BrokerOrder struct {
    BrokerOrderID string
    Status        string
}

// BrokerPosition is a normalized position snapshot from a broker.
type BrokerPosition struct {
    Symbol   string
    Quantity float64
    AvgCost  float64
}

// Broker is the interface all broker clients must satisfy.
type Broker interface {
    SubmitOrder(ctx context.Context, req OrderRequest) (*BrokerOrder, error)
    CancelOrder(ctx context.Context, brokerOrderID string) error
    GetOrder(ctx context.Context, brokerOrderID string) (*BrokerOrder, error)
    GetPositions(ctx context.Context) ([]BrokerPosition, error)
    IsPaper() bool
}

// OrderRequest is the normalized order placement request.
type OrderRequest struct {
    Symbol      string
    Side        string
    OrderType   string
    Qty         float64
    LimitPrice  float64
    StopPrice   float64
    TimeInForce string
}
```

**Modify**: `services/xstockstrat-trading/internal/broker/alpaca.go`

Change `SubmitOrder` at L90 to return `*BrokerOrder`:

```go
func (c *Client) SubmitOrder(ctx context.Context, req OrderRequest) (*BrokerOrder, error) {
```

Inside the function body, replace the return statement (currently returns `&AlpacaOrder{...}`) with:
```go
return &BrokerOrder{BrokerOrderID: alpacaResp.ID, Status: alpacaResp.Status}, nil
```

Change `GetOrder` at L154 to return `*BrokerOrder`:
```go
func (c *Client) GetOrder(ctx context.Context, brokerOrderID string) (*BrokerOrder, error) {
```

Return:
```go
return &BrokerOrder{BrokerOrderID: alpacaResp.ID, Status: alpacaResp.Status}, nil
```

Keep `AlpacaOrder` struct exported (tests reference it for internal HTTP response unmarshaling).

Add `strconv` to imports.

Add `GetPositions` method to `Client`:

```go
func (c *Client) GetPositions(ctx context.Context) ([]BrokerPosition, error) {
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v2/positions", nil)
    if err != nil {
        return nil, fmt.Errorf("alpaca GetPositions: build request: %w", err)
    }
    req.Header.Set("APCA-API-KEY-ID", c.apiKey)
    req.Header.Set("APCA-API-SECRET-KEY", c.apiSecret)
    resp, err := c.httpClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("alpaca GetPositions: http: %w", err)
    }
    defer resp.Body.Close()
    body, _ := io.ReadAll(resp.Body)
    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("alpaca GetPositions: status %d: %s", resp.StatusCode, body)
    }
    var raw []struct {
        Symbol  string `json:"symbol"`
        Qty     string `json:"qty"`
        AvgCost string `json:"avg_entry_price"`
    }
    if err := json.Unmarshal(body, &raw); err != nil {
        return nil, fmt.Errorf("alpaca GetPositions: unmarshal: %w", err)
    }
    positions := make([]BrokerPosition, 0, len(raw))
    for _, r := range raw {
        qty, _ := strconv.ParseFloat(r.Qty, 64)
        avg, _ := strconv.ParseFloat(r.AvgCost, 64)
        positions = append(positions, BrokerPosition{Symbol: r.Symbol, Quantity: qty, AvgCost: avg})
    }
    return positions, nil
}
```

Add compile-time assertion at bottom of `alpaca.go`:
```go
var _ Broker = (*Client)(nil)
```

**Update `alpaca_test.go`**: At L55, change `order.ID` → `order.BrokerOrderID`. Apply the same fix at L79. The `AlpacaOrder` struct itself remains for internal HTTP response unmarshaling.

**Verification**:
`GOWORK=off go build ./internal/broker/...` in `services/xstockstrat-trading/` exits 0; `GOWORK=off go test ./internal/broker/...` passes.

---

### Step 10 — service: Create IBKR broker client

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/ibkr.go` — create

**Codebase Evidence**:
- **Not found** — `services/xstockstrat-trading/internal/broker/ibkr.go` does not exist; create from scratch
- Confirmed via: `broker.Broker` interface defined in `broker.go` (Step 9); `IBKRClient` must satisfy it

**Instructions**:

**New file**: `services/xstockstrat-trading/internal/broker/ibkr.go`

Implement `IBKRClient` satisfying the `Broker` interface using IBKR Web API (base URL configurable, default `https://api.ibkr.com/v1/api/`). Uses OAuth 1.0a HMAC-SHA256 signed requests.

Key struct fields:
```go
type IBKRClient struct {
    baseURL           string
    consumerKey       string
    accessToken       string
    accessTokenSecret string
    ibkrAccountID     string // e.g. "U1234567"
    isPaper           bool
    httpClient        *http.Client
}
```

Constructor:
```go
func NewIBKRClient(cfg IBKRConfig) *IBKRClient
```

Where `IBKRConfig` is:
```go
type IBKRConfig struct {
    BaseURL           string
    ConsumerKey       string
    AccessToken       string
    AccessTokenSecret string
    IBKRAccountID     string
    IsPaper           bool
}
```

`SubmitOrder` → `POST /v1/api/iserver/account/{ibkrAccountID}/orders`
`CancelOrder` → `DELETE /v1/api/iserver/account/{ibkrAccountID}/order/{orderId}`
`GetOrder`    → `GET /v1/api/iserver/account/orders?orderId={id}`
`GetPositions` → `GET /v1/api/portfolio/{ibkrAccountID}/positions/0`

Each method must:
1. Build the base URL path
2. Generate OAuth 1.0a authorization header using HMAC-SHA256 (implement `signRequest(method, url, params string) string`)
3. Parse the IBKR response JSON
4. Return `*BrokerOrder` or `[]BrokerPosition` in the normalized shape

Order type mapping (from product spec FR-14 / context OQ-3):
- `MARKET` → `"MKT"`
- `LIMIT` → `"LMT"`
- `STOP` → `"STP"`
- `STOP_LIMIT` → `"STP LMT"`
- `TRAILING_STOP` → `"TRAIL"` (trail amount via `auxPrice`)

Compile-time assertion:
```go
var _ Broker = (*IBKRClient)(nil)
```

**Verification**:
`GOWORK=off go build ./internal/broker/...` in `services/xstockstrat-trading/` exits 0; compile-time assertion confirms `IBKRClient` satisfies `Broker`.

---

### Step 11 — service: Create account repository (`broker_accounts` CRUD)

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/account_repo.go` — create

**Codebase Evidence**:
- **Not found** — `services/xstockstrat-trading/internal/repository/account_repo.go` does not exist; create from scratch
- Confirmed via: `trading.broker_accounts` table schema defined in migration `002_broker_accounts.up.sql` (Step 5)
- Confirmed via: `grep -n "pgxpool\|type.*Repo" services/xstockstrat-trading/internal/repository/trading_repo.go` → existing repo pattern uses `*pgxpool.Pool`

**Instructions**:

**New file**: `services/xstockstrat-trading/internal/repository/account_repo.go`

```go
package repository

import (
    "context"
    "crypto/aes"
    "crypto/cipher"
    "crypto/rand"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "io"
    "time"

    "github.com/google/uuid"
    "github.com/jackc/pgx/v5/pgxpool"
    tradingv1 "github.com/xstockstrat/proto/gen/go/trading/v1"
    commonv1 "github.com/xstockstrat/proto/gen/go/common/v1"
)
```

`BrokerAccountRecord` struct:
```go
type BrokerAccountRecord struct {
    ID             string
    DisplayName    string
    BrokerType     int32
    IsPaper        bool
    IsActive       bool
    UserID         string
    CredentialsEnc []byte
    CreatedAt      time.Time
    UpdatedAt      time.Time
}
```

Interface `AccountRepository`:
```go
type AccountRepository interface {
    CreateBrokerAccount(ctx context.Context, rec *BrokerAccountRecord) error
    ListBrokerAccounts(ctx context.Context, userID string) ([]*BrokerAccountRecord, error)
    GetBrokerAccount(ctx context.Context, id string) (*BrokerAccountRecord, error)
    DeactivateBrokerAccount(ctx context.Context, id string) error
    ListActiveBrokerAccounts(ctx context.Context) ([]*BrokerAccountRecord, error)
}
```

`pgAccountRepo` struct implements `AccountRepository` with a `*pgxpool.Pool`.

Encryption helpers (package-level, used by service layer):
```go
func EncryptCredentials(encKeyHex string, credentialsJSON []byte) ([]byte, error)
func DecryptCredentials(encKeyHex string, ciphertext []byte) ([]byte, error)
```

Both use `aes.NewCipher` + `cipher.NewGCM`. `EncryptCredentials` prepends a 12-byte random nonce. `DecryptCredentials` splits the nonce prefix before calling `gcm.Open`.

`ListActiveBrokerAccounts` returns only rows where `is_active = TRUE`. Used at startup to populate the broker pool.

**Verification**:
`GOWORK=off go build ./internal/repository/...` in `services/xstockstrat-trading/` exits 0.

---

### Step 12 — service: Update order repository: `account_id` + `broker_type` columns

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/trading_repo.go` — modify

**Codebase Evidence**:
- Confirmed via: `grep -n "UpsertOrder\|scanOrder\|func.*Order" services/xstockstrat-trading/internal/repository/trading_repo.go` → `UpsertOrder` at L41–68 (19 columns); `scanOrder` at L175 (18 columns)
- Existing pattern: `UpsertOrder` INSERT has 19 columns ending at `broker_order_id`; `scanOrder` scans 18 fields ending at `broker_order_id`

**Instructions**:

The `UpsertOrder` SQL at L41–68 inserts 19 columns. Add `account_id` and `broker_type` to the column list and values, making 21 columns total.

The `scanOrder` function at L175 scans 18 columns. Add scans for `account_id` (→ `order.AccountId`) and `broker_type` (→ `order.BrokerType`) as the 19th and 20th scan destinations.

Update `GetOrder` and `ListOrders` SELECT queries to include `account_id, broker_type` in the column list.

`ListOrders` currently filters by `trading_mode`. Optionally add `AND (account_id = $N OR $N = '')` for future account-scoped listing (can be a follow-up).

**Verification**:
`GOWORK=off go build ./internal/repository/...` in `services/xstockstrat-trading/` exits 0.

---

### Step 13 — service: Update `TradingService`: broker pool, account management, routing

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Codebase Evidence**:
- Confirmed via: `grep -n "type TradingService\|broker \*broker\|NewTradingService\|StartFillPoller\|emitLedgerEvent" services/xstockstrat-trading/internal/service/trading.go` → `TradingService.broker` typed as `*broker.Client` at L33; `NewTradingService` at L55; `StartFillPoller` at L333–356; `emitLedgerEvent` at L549
- Existing pattern: `StartFillPoller` uses `cfgWatcher.GetFloat` and ticker loop — mirror for `StartPositionSyncPoller`

**Instructions**:

**13a — Update `TradingService` struct** (currently at L30–46).

Replace `broker *broker.Client` at L33 with:

```go
brokers    map[string]broker.Broker // key: account_id
brokersMu  sync.RWMutex
accountRepo repository.AccountRepository
encKey     string // hex-encoded AES-256-GCM key
```

**13b — Update `NewTradingService` signature** (currently at L55):

```go
func NewTradingService(
    cfg *config.Config,
    cfgWatcher *configwatcher.Watcher,
    accountRepo repository.AccountRepository,
    repo TradingRepository,
    encKey string,
) (*TradingService, error)
```

In the constructor, remove single-broker initialization. Set `s.encKey = encKey`, `s.accountRepo = accountRepo`, `s.brokers = make(map[string]broker.Broker)`.

**13c — Add `LoadBrokerPool` method**:

```go
func (s *TradingService) LoadBrokerPool(ctx context.Context) error
```

Calls `s.accountRepo.ListActiveBrokerAccounts(ctx)`. For each row:
1. Decrypts `credentials_enc` using `repository.DecryptCredentials(s.encKey, row.CredentialsEnc)`
2. Unmarshals JSON into the broker-type-specific credentials struct
3. Instantiates `broker.NewClient(...)` (Alpaca) or `broker.NewIBKRClient(...)` (IBKR)
4. Stores in `s.brokers[row.ID]` under write lock

**13d — Add `resolveAccount` helper**:

```go
func (s *TradingService) resolveAccount(accountID string) (broker.Broker, error)
```

- If `accountID` non-empty: look up under read lock; return `codes.NotFound` if absent
- If `accountID` empty: if exactly one account in pool, return it; else return `codes.InvalidArgument` requiring explicit account_id

**13e — Update `PlaceOrder`** (currently at L117):

- Extract `req.AccountId` from the proto request
- Call `s.resolveAccount(req.AccountId)` to get the `broker.Broker`
- Pass a `broker.OrderRequest` built from the existing proto→broker mapping logic
- Call `b.SubmitOrder(...)` (currently `s.broker.SubmitOrder(...)`)
- Populate `order.AccountId` and `order.BrokerType` before `UpsertOrder`

**13f — Update `CancelOrder`** (currently at L230):

- Retrieve the order first to get its `AccountId`
- Look up the broker via `s.resolveAccount(order.AccountId)`
- Call `b.CancelOrder(...)`

**13g — Update `pollFills`** (currently at L358):

- Iterate over all entries in `s.brokers` (under read lock, copy to local slice first)
- For each account+broker pair, poll open orders and process fills as before
- Scope the `ListOrders` query by `account_id` (add parameter or filter in-service)

**13h — Add `StartPositionSyncPoller`**:

```go
func (s *TradingService) StartPositionSyncPoller(ctx context.Context)
```

Pattern mirrors `StartFillPoller` (currently at L333–356): reads interval from `cfgWatcher.GetFloat("trading.position_sync.interval_ms", 300000)`, calls `s.syncPositions(ctx)` in a ticker loop.

```go
func (s *TradingService) syncPositions(ctx context.Context) {
    s.brokersMu.RLock()
    accounts := make(map[string]broker.Broker, len(s.brokers))
    for id, b := range s.brokers {
        accounts[id] = b
    }
    s.brokersMu.RUnlock()

    for accountID, b := range accounts {
        positions, err := b.GetPositions(ctx)
        if err != nil {
            // log and continue
            continue
        }
        payload, _ := json.Marshal(positionSyncPayload{AccountID: accountID, Positions: positions})
        s.emitLedgerEvent(ctx, "account.positions.synced", string(payload))
    }
}
```

Where `positionSyncPayload` is:
```go
type positionSyncPayload struct {
    AccountID string                  `json:"account_id"`
    Positions []broker.BrokerPosition `json:"positions"`
}
```

**13i — Add account management methods** on `TradingService`:

```go
func (s *TradingService) RegisterBrokerAccount(ctx context.Context, req *tradingv1.RegisterBrokerAccountRequest, userID string) (*tradingv1.BrokerAccount, error)
func (s *TradingService) ListBrokerAccountsSvc(ctx context.Context, userID string) ([]*tradingv1.BrokerAccount, error)
func (s *TradingService) DeregisterBrokerAccountSvc(ctx context.Context, accountID string, callerUserID string) error
```

`RegisterBrokerAccount`:
1. Validates `req.CredentialsJson` is valid JSON
2. If `s.cfg.AppEnv == "dev"` and `!req.IsPaper`: return error "paper-only accounts permitted in dev environment"
3. Encrypts credentials: `repository.EncryptCredentials(s.encKey, []byte(req.CredentialsJson))`
4. Calls `s.accountRepo.CreateBrokerAccount(ctx, rec)` where `rec.ID = uuid.NewString()`
5. Instantiates the broker client and adds to `s.brokers` under write lock
6. Returns the `BrokerAccount` proto (no credentials)

`DeregisterBrokerAccountSvc`:
1. Calls `s.accountRepo.GetBrokerAccount(ctx, accountID)`
2. If `row.UserID != callerUserID`: return `codes.PermissionDenied`
3. Calls `s.accountRepo.DeactivateBrokerAccount(ctx, accountID)`
4. Removes entry from `s.brokers` under write lock

**13j — Add `EnsureAlpacaDefault`** (called from `main.go` Step 15d):
- Checks `len(s.brokers) == 0`
- If `cfg.AlpacaAPIKey` and `cfg.AlpacaAPISecret` are non-empty, creates a `broker_accounts` row with `id='alpaca-default'`, `broker_type=ALPACA`, `is_paper=cfg.AlpacaPaper`, `user_id='default'`, then calls `LoadBrokerPool` again
- If env vars absent and pool empty, logs a warning (not fatal — operator must register manually)

**Verification**:
`GOWORK=off go build ./internal/service/...` in `services/xstockstrat-trading/` exits 0.

---

### Step 14 — service: Add account management + position sync handler methods

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/handler/trading.go` — modify

**Codebase Evidence**:
- Confirmed via: `grep -n "var _\|Unimplemented\|toGRPCError\|grpcTradingAdapter" services/xstockstrat-trading/internal/handler/trading.go` → compile-time assertion at L17; `UnimplementedTradingServiceHandler` embedded at L21; `toGRPCError` at L155; `grpcTradingAdapter` at L99

**Instructions**:

The compile-time assertion at L17 (`var _ tradingv1connect.TradingServiceHandler = (*TradingHandler)(nil)`) will fail until all 3 new handler methods are present.

Add 3 Connect-RPC handler methods to `TradingHandler`:

```go
func (h *TradingHandler) RegisterBrokerAccount(
    ctx context.Context,
    req *connect.Request[tradingv1.RegisterBrokerAccountRequest],
) (*connect.Response[tradingv1.RegisterBrokerAccountResponse], error) {
    userID := extractUserID(ctx) // existing auth helper
    account, err := h.svc.RegisterBrokerAccount(ctx, req.Msg, userID)
    if err != nil {
        return nil, toGRPCError(err)
    }
    return connect.NewResponse(&tradingv1.RegisterBrokerAccountResponse{Account: account}), nil
}

func (h *TradingHandler) ListBrokerAccounts(
    ctx context.Context,
    req *connect.Request[tradingv1.ListBrokerAccountsRequest],
) (*connect.Response[tradingv1.ListBrokerAccountsResponse], error) {
    userID := extractUserID(ctx)
    accounts, err := h.svc.ListBrokerAccountsSvc(ctx, userID)
    if err != nil {
        return nil, toGRPCError(err)
    }
    return connect.NewResponse(&tradingv1.ListBrokerAccountsResponse{Accounts: accounts}), nil
}

func (h *TradingHandler) DeregisterBrokerAccount(
    ctx context.Context,
    req *connect.Request[tradingv1.DeregisterBrokerAccountRequest],
) (*connect.Response[tradingv1.DeregisterBrokerAccountResponse], error) {
    userID := extractUserID(ctx)
    if err := h.svc.DeregisterBrokerAccountSvc(ctx, req.Msg.AccountId, userID); err != nil {
        return nil, toGRPCError(err)
    }
    return connect.NewResponse(&tradingv1.DeregisterBrokerAccountResponse{}), nil
}
```

Add `CodePermissionDenied` case to `toGRPCError` at L155:

```go
case connect.CodePermissionDenied:
    return status.Error(codes.PermissionDenied, err.Error())
```

Add 3 corresponding gRPC adapter methods to `grpcTradingAdapter` (at L99), following the same pattern as existing adapters — wrap handler, convert Connect request/response to gRPC.

**Verification**:
`GOWORK=off go build ./internal/handler/...` in `services/xstockstrat-trading/` exits 0 (compile-time assertion at L17 passes).

---

### Step 15 — service: Update `main.go` (trading): encryption key, pool init, new goroutine

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/cmd/server/main.go` — modify

**Codebase Evidence**:
- Confirmed via: `grep -n "broker\|NewTradingService\|StartFillPoller" services/xstockstrat-trading/cmd/server/main.go` → broker init at L77–83; `NewTradingService` at L87; `go svc.StartFillPoller(ctx)` at L94

**Instructions**:

**15a — Validate encryption key** (add after `cfg` is loaded, before service init):

```go
if cfg.BrokerAccountsEncryptionKey == "" {
    log.Fatal("BROKER_ACCOUNTS_ENCRYPTION_KEY is required")
}
keyBytes, err := hex.DecodeString(cfg.BrokerAccountsEncryptionKey)
if err != nil || len(keyBytes) != 32 {
    log.Fatal("BROKER_ACCOUNTS_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)")
}
```

**15b — Initialize account repository**:

```go
accountRepo := repository.NewPgAccountRepo(pool)
```

**15c — Update `NewTradingService` call** (currently at L87):

```go
svc, err := service.NewTradingService(cfg, cfgWatcher, accountRepo, repo, cfg.BrokerAccountsEncryptionKey)
if err != nil {
    log.Fatalf("failed to create trading service: %v", err)
}
```

**15d — Load broker pool + seed alpaca-default**:

```go
if err := svc.LoadBrokerPool(ctx); err != nil {
    log.Fatalf("failed to load broker pool: %v", err)
}

// Seed alpaca-default row if pool is empty and env vars are present.
if err := svc.EnsureAlpacaDefault(ctx); err != nil {
    log.Fatalf("failed to seed alpaca-default: %v", err)
}
```

**15e — Start position sync poller** (add after L94 `go svc.StartFillPoller(ctx)`):

```go
go svc.StartPositionSyncPoller(ctx)
```

**Verification**:
`GOWORK=off go build ./cmd/server/...` in `services/xstockstrat-trading/` exits 0.

---

### Step 16 — service: Update portfolio repository: `account_id` on positions

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify

**Codebase Evidence**:
- Confirmed via: `grep -n "UpsertPosition\|scanPositionRow\|ON CONFLICT" services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` → `UpsertPosition` ON CONFLICT at L32–40; `scanPositionRow` at L172 (6 columns)
- Existing pattern: ON CONFLICT `(user_id, symbol, trading_mode)` — must become `(user_id, symbol, trading_mode, account_id)` after migration Step 7

**Instructions**:

**16a — Update `UpsertPosition`** (currently at L32–40).

Current ON CONFLICT: `ON CONFLICT (user_id, symbol, trading_mode)`

Add `account_id` parameter to the function signature. Update the INSERT to include `account_id`. Update ON CONFLICT to `ON CONFLICT (user_id, symbol, trading_mode, account_id)`.

**16b — Update `scanPositionRow`** (currently at L172, scans 6 columns).

Add scan for `account_id` as the 7th column.

**16c — Update `GetPosition`, `ListPositions`** SELECT queries to include `account_id`.

Add optional `accountID string` parameter to `ListPositions`. When non-empty, append `AND account_id = $N`.

**16d — Add `UpsertPositionFromSync`**:

```go
func (r *pgPortfolioRepo) UpsertPositionFromSync(ctx context.Context, userID, symbol, tradingMode, accountID string, qty, avgCost float64) error
```

Uses the same upsert pattern but preserves `opened_at` (set only on INSERT, not updated on conflict).

**16e — Add `DeletePositionsNotInSync`**:

```go
func (r *pgPortfolioRepo) DeletePositionsNotInSync(ctx context.Context, accountID string, presentSymbols []string) error
```

Deletes rows for `account_id = $1` where `symbol NOT IN ($2, $3, ...)`. When `presentSymbols` is empty, deletes all positions for the account (position closed entirely on broker).

**16f — Add `ListPositionsByAccount`**:

```go
func (r *pgPortfolioRepo) ListPositionsByAccount(ctx context.Context, accountID string, tradingMode string) ([]*portfoliov1.Position, error)
```

Used by `ListPortfolios` to aggregate per-account positions.

**Verification**:
`GOWORK=off go build ./internal/repository/...` in `services/xstockstrat-portfolio/` exits 0.

---

### Step 17 — service: Update `PortfolioService`: `ConsumePositionSyncs`, `ListPortfolios`

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Codebase Evidence**:
- Confirmed via: `grep -n "ConsumeOrderFills\|streamFills\|processOrderFill\|GetPortfolio" services/xstockstrat-portfolio/internal/service/portfolio_service.go` → `ConsumeOrderFills` at L72; `streamFills` at L84; `processOrderFill` at L113; `GetPortfolio` at L175
- Existing pattern: `ConsumeOrderFills` → `streamFills` → `processOrderFill` goroutine chain; `ConsumePositionSyncs` mirrors this

**Instructions**:

**17a — Add `ConsumePositionSyncs`** (mirrors `ConsumeOrderFills` at L72):

```go
func (s *PortfolioService) ConsumePositionSyncs(ctx context.Context) {
    go s.streamPositionSyncs(ctx)
}
```

```go
func (s *PortfolioService) streamPositionSyncs(ctx context.Context) {
    // Subscribe to ledger "account.positions.synced" events (same mechanism as streamFills at L84)
    // On each event: unmarshal positionSyncPayload, call s.processPositionSync
}
```

```go
type positionSyncPayload struct {
    AccountID string `json:"account_id"`
    Positions []struct {
        Symbol   string  `json:"symbol"`
        Quantity float64 `json:"quantity"`
        AvgCost  float64 `json:"avg_cost"`
    } `json:"positions"`
}
```

```go
func (s *PortfolioService) processPositionSync(ctx context.Context, payload positionSyncPayload) error {
    // Upsert each position in payload.Positions (preserves opened_at for existing rows)
    presentSymbols := make([]string, 0, len(payload.Positions))
    for _, p := range payload.Positions {
        // user_id is not in the event payload; use "default" as a placeholder
        // (known deviation — see context.md)
        if err := s.repo.UpsertPositionFromSync(ctx, "default", p.Symbol, "paper", payload.AccountID, p.Quantity, p.AvgCost); err != nil {
            return err
        }
        presentSymbols = append(presentSymbols, p.Symbol)
    }
    // Delete positions for this account that were not in the sync snapshot
    return s.repo.DeletePositionsNotInSync(ctx, payload.AccountID, presentSymbols)
}
```

**Known deviation**: `user_id` is not carried in `account.positions.synced` ledger events per product spec FR-29. The implementation uses `"default"` as a placeholder. A follow-up should add `user_id` to the sync event payload (additive ledger event change, no proto impact).

**17b — Update `GetPortfolio`** (currently at L175):

Pass `req.AccountId` (if set) to `s.repo.ListPositions`. When absent, call existing path (all positions for user).

**17c — Add `ListPortfolios`**:

```go
func (s *PortfolioService) ListPortfolios(ctx context.Context, req *portfoliov1.ListPortfoliosRequest) (*portfoliov1.ListPortfoliosResponse, error) {
    // If req.AccountId is set: return single-account portfolio
    // Else: aggregate across all accounts (group positions by account_id via ListPositions or ListPositionsByAccount)
    // Build Portfolio proto for each account: sum up quantities, P&L via existing calculation helpers
}
```

**Verification**:
`GOWORK=off go build ./internal/service/...` in `services/xstockstrat-portfolio/` exits 0.

---

### Step 18 — service: Add `ListPortfolios` handler; update portfolio `main.go`

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify
- `services/xstockstrat-portfolio/cmd/server/main.go` — modify

**Codebase Evidence**:
- Confirmed via: `grep -n "var _\|grpcPortfolioAdapter" services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` → compile-time assertion at L17; `grpcPortfolioAdapter` at L122
- Confirmed via: `grep -n "ConsumeOrderFills" services/xstockstrat-portfolio/cmd/server/main.go` → `go svc.ConsumeOrderFills(ctx)` at L70

**Instructions**:

**File**: `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go`

The compile-time assertion at L17 will fail until `ListPortfolios` is added.

```go
func (h *PortfolioHandler) ListPortfolios(
    ctx context.Context,
    req *connect.Request[portfoliov1.ListPortfoliosRequest],
) (*connect.Response[portfoliov1.ListPortfoliosResponse], error) {
    resp, err := h.svc.ListPortfolios(ctx, req.Msg)
    if err != nil {
        return nil, toGRPCError(err)
    }
    return connect.NewResponse(resp), nil
}
```

Add corresponding gRPC adapter method to `grpcPortfolioAdapter` (at L122) following the existing adapter pattern.

**File**: `services/xstockstrat-portfolio/cmd/server/main.go`

At L70, after `go svc.ConsumeOrderFills(ctx)`, add:

```go
go svc.ConsumePositionSyncs(ctx)
```

**Verification**:
`GOWORK=off go build ./...` in `services/xstockstrat-portfolio/` exits 0 (compile-time assertion at L17 passes).

---

## Deviation Log

### Deviation: Step 1 — proto: Add `BrokerType` enum to `common/v1`
**Spec said**: `buf` available as a tool
**Actual**: `buf` not pre-installed; installed buf 1.69.0 to `/usr/local/bin/buf` at runtime
**Reason**: Environment did not have `buf` in PATH; runtime install unblocked verification

### Deviation: Step 2 — proto: Add broker account messages + RPCs to `trading/v1`
**Spec said**: `PlaceOrderRequest` field 12 = `stop_price`; last RPC = `GetOrder`
**Actual**: `PlaceOrderRequest` field 12 = `trading_mode` (field 13 used for `account_id`); last RPC = `StreamOrderUpdates` (new RPCs appended correctly regardless). `buf breaking` required `--against '.git#branch=feature/...,subdir=packages/proto'` syntax.
**Reason**: Codebase had evolved since spec-generation time; field numbers and RPC list differed. New RPCs and field numbers are still additive and non-breaking.

### Deviation: Step 4 — proto-gen: Regenerate proto stubs
**Spec said**: `./scripts/buf-gen.sh` exits 0 (implies all plugins available)
**Actual**: `buf`, `protoc-gen-ts_proto`, `protoc-gen-grpc_python`, and `protoc` not pre-installed. Installed at runtime: `buf` 1.69.0, `protoc-gen-ts_proto` (via npm), `protobuf-compiler` (via apt). Python gRPC stubs generated via `python3 -m grpc_tools.protoc` directly (not via buf plugin) due to absence of standalone `protoc-gen-grpc_python` binary. TypeScript stubs compiled (files emitted) but `pnpm --filter @xstockstrat/proto run build` exits 2 due to pre-existing TS6.0 deprecation of `moduleResolution=node` — unrelated to this feature's changes. All Go, TypeScript, and Python stubs correctly regenerated with new fields and RPCs.
**Reason**: CI environment lacks proto toolchain binaries; runtime installation unblocked generation. TypeScript deprecation is a pre-existing tsconfig compatibility issue with TypeScript 6.0 (upgraded in main-dev). Output stubs are correct.
