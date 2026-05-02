# Implementation Spec: add-ikbr-account-support

**Status**: `in-progress`
**Created**: 2026-05-02
**Feature**: `docs/roadmap/features/add-ikbr-account-support/feature.md`

---

## Overview

Add multi-broker account support: register Alpaca and/or IBKR accounts with AES-256-GCM encrypted credentials stored in the DB. Orders route to a specific account via `account_id`. Portfolio tracks positions per account. A position sync poller reconciles all broker accounts against broker truth every N ms (configurable, live-reloaded). Dev enforces paper-only. No existing env var changes required for existing single-Alpaca deployments.

**Affected services**: `xstockstrat-trading` (Go), `xstockstrat-portfolio` (Go)  
**Affected proto packages**: `common/v1`, `trading/v1`, `portfolio/v1`  
**New DB migrations**: trading `002`, `003`; portfolio `003`  
**Approval required**: 1 service owner (additive proto changes) + DBA review (schema migrations)

---

## Step Index

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

## Step 1 — Add `BrokerType` enum to `common/v1`

**Status**: `done`

**File**: `packages/proto/common/v1/common.proto`

Current last content (L61): `  ENVIRONMENT_PRODUCTION = 2;` followed by `}` at L62.

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

**Verification**: `buf lint packages/proto` passes; `buf breaking --against '.git#branch=main' packages/proto` passes.

---

## Step 2 — Add broker account messages + RPCs to `trading/v1`

**File**: `packages/proto/trading/v1/trading.proto`

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

**Verification**: `buf lint packages/proto` passes; `buf breaking --against '.git#branch=main' packages/proto` passes (all changes are additive).

---

## Step 3 — Add `account_id` fields + `ListPortfolios` to `portfolio/v1`

**File**: `packages/proto/portfolio/v1/portfolio.proto`

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

**Verification**: `buf lint packages/proto` passes; `buf breaking --against '.git#branch=main' packages/proto` passes.

---

## Step 4 — Regenerate proto stubs

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

**Commit generated stubs** to `packages/proto/gen/` as a separate commit per convention.

After this step, both `xstockstrat-trading` and `xstockstrat-portfolio` will **not compile** until the new handler methods are implemented (Steps 14 and 18). The compile-time assertions at:
- `services/xstockstrat-trading/internal/handler/trading.go` L17: `var _ tradingv1connect.TradingServiceHandler = (*TradingHandler)(nil)`
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` L17: `var _ portfoliov1connect.PortfolioServiceHandler = (*PortfolioHandler)(nil)`

...will fail until the 3 trading handler methods (Step 14) and `ListPortfolios` portfolio handler method (Step 18) are added.

---

## Step 5 — Migration: `trading` — `broker_accounts` table

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

**Note**: The `alpaca-default` seed row is inserted by migration `002` only if `ALPACA_API_KEY` and `ALPACA_API_SECRET` environment variables are set **and** a matching row does not already exist. Because migrations run in the `db-migrator` PRE_DEPLOY job where env vars may not be trading-service env vars, the seed is deferred to application startup (see Step 15 — `ensureAlpacaDefaultAccount`). The migration only creates the schema.

---

## Step 6 — Migration: `trading` — `orders.account_id` + `orders.broker_type`

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

---

## Step 7 — Migration: `portfolio` — `positions.account_id`

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

---

## Step 8 — Add `BrokerAccountsEncryptionKey` + `AppEnv` to trading config

**File**: `services/xstockstrat-trading/internal/config/config.go`

Current `Config` struct ends at approximately L33. Add two new fields to the struct and two corresponding `os.Getenv` calls in `LoadFromEnv`.

In the `Config` struct, add:
```go
BrokerAccountsEncryptionKey string // hex-encoded 32-byte key; required when broker_accounts table is in use
AppEnv                       string // "dev" | "production"
```

In `LoadFromEnv`, add:
```go
BrokerAccountsEncryptionKey: os.Getenv("BROKER_ACCOUNTS_ENCRYPTION_KEY"),
AppEnv:                      os.Getenv("APP_ENV"),
```

No default values; `main.go` validates `BrokerAccountsEncryptionKey` is non-empty at startup.

---

## Step 9 — Extract `Broker` interface; add `GetPositions` to Alpaca client

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
    Symbol    string
    Side      string
    OrderType string
    Qty       float64
    LimitPrice float64
    StopPrice  float64
    TimeInForce string
}
```

**Modify**: `services/xstockstrat-trading/internal/broker/alpaca.go`

Current `SubmitOrder` at L90 returns `*AlpacaOrder`. Change to return `*BrokerOrder`:

```go
func (c *Client) SubmitOrder(ctx context.Context, req OrderRequest) (*BrokerOrder, error) {
```

Inside the function body, replace the return statement (currently returns `&AlpacaOrder{...}`) with:
```go
return &BrokerOrder{BrokerOrderID: alpacaResp.ID, Status: alpacaResp.Status}, nil
```

Current `GetOrder` at L154 returns `*AlpacaOrder`. Change to return `*BrokerOrder`:
```go
func (c *Client) GetOrder(ctx context.Context, brokerOrderID string) (*BrokerOrder, error) {
```

Return:
```go
return &BrokerOrder{BrokerOrderID: alpacaResp.ID, Status: alpacaResp.Status}, nil
```

Keep `AlpacaOrder` struct exported (tests reference it directly).

Add `GetPositions` method to `Client` (add `strconv` to imports):

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
        Symbol   string `json:"symbol"`
        Qty      string `json:"qty"`
        AvgCost  string `json:"avg_entry_price"`
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

**Update `alpaca_test.go`**: At L55, `order.ID` → `order.BrokerOrderID` (the test now receives `*BrokerOrder` not `*AlpacaOrder`). Apply the same fix at L79. The `AlpacaOrder` struct itself remains for internal HTTP response unmarshaling.

---

## Step 10 — Create IBKR broker client

**New file**: `services/xstockstrat-trading/internal/broker/ibkr.go`

Implement `IBKRClient` satisfying the `Broker` interface using IBKR Web API (base URL configurable, default `https://api.ibkr.com/v1/api/`). Uses OAuth 1.0a HMAC-SHA256 signed requests.

Key struct fields:
```go
type IBKRClient struct {
    baseURL         string
    consumerKey     string
    accessToken     string
    accessTokenSecret string
    ibkrAccountID   string // e.g. "U1234567"
    isPaper         bool
    httpClient      *http.Client
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

---

## Step 11 — Create account repository (`broker_accounts` CRUD)

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

---

## Step 12 — Update order repository: `account_id` + `broker_type` columns

**File**: `services/xstockstrat-trading/internal/repository/trading_repo.go`

The `UpsertOrder` SQL at L41–68 inserts 19 columns. Add `account_id` and `broker_type` to the column list and values, making 21 columns total.

The `scanOrder` function at L175 scans 18 columns. Add scans for `account_id` (→ `order.AccountId`) and `broker_type` (→ `order.BrokerType`) as the 19th and 20th scan destinations.

Update `GetOrder` and `ListOrders` SELECT queries to include `account_id, broker_type` in the column list.

`ListOrders` currently filters by `trading_mode`. Optionally add `AND (account_id = $N OR $N = '')` for future account-scoped listing (can be a follow-up).

---

## Step 13 — Update `TradingService`: broker pool, account management, routing

**File**: `services/xstockstrat-trading/internal/service/trading.go`

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

---

## Step 14 — Add account management + position sync handler methods

**File**: `services/xstockstrat-trading/internal/handler/trading.go`

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

Add 3 corresponding gRPC adapter methods to `grpcTradingAdapter` (at L99, follows same pattern as existing adapters — wrap handler, convert Connect request/response to gRPC).

---

## Step 15 — Update `main.go` (trading): encryption key, pool init, new goroutine

**File**: `services/xstockstrat-trading/cmd/server/main.go`

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

`EnsureAlpacaDefault` is a method on `TradingService` (add in Step 13):
- Checks `len(s.brokers) == 0`
- If `cfg.AlpacaAPIKey` and `cfg.AlpacaAPISecret` are non-empty, creates a `broker_accounts` row with `id='alpaca-default'`, `broker_type=ALPACA`, `is_paper=cfg.AlpacaPaper`, `user_id='default'`, then calls `LoadBrokerPool` again
- If env vars absent and pool empty, logs a warning (not fatal — operator must register manually)

**15e — Start position sync poller** (add after L94 `go svc.StartFillPoller(ctx)`):

```go
go svc.StartPositionSyncPoller(ctx)
```

---

## Step 16 — Update portfolio repository: `account_id` on positions

**File**: `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go`

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

---

## Step 17 — Update `PortfolioService`: `ConsumePositionSyncs`, `ListPortfolios`

**File**: `services/xstockstrat-portfolio/internal/service/portfolio_service.go`

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

**Known deviation**: `user_id` is not carried in `account.positions.synced` ledger events per product spec FR-29. The implementation uses `"default"` as a placeholder. This is acceptable for the initial implementation. A follow-up should add `user_id` to the sync event payload (additive ledger event change, no proto impact).

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

---

## Step 18 — Add `ListPortfolios` handler; update portfolio `main.go`

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

---

## Governance Gates

| Gate | Requirement | Step |
|---|---|---|
| Proto approval | 1 service owner (additive changes only) | Before Step 4 merge |
| DBA review | trading migrations `002`, `003`; portfolio migration `003` | Before Step 5–7 merge |
| `buf lint` + `buf breaking` CI | Must pass on proto PR | Step 4 |
| Dev paper-only invariant | Enforced in `RegisterBrokerAccount` (Step 13i) | Step 15 |

---

## Config Keys Added

| Key | Type | Default | Description |
|---|---|---|---|
| `trading.position_sync.interval_ms` | int | 300000 | Position sync poll interval (all accounts); live-reloaded |

Register this key in `xstockstrat-config` before deploying. See `docs/runbooks/config-rollout.md`.

---

## New Environment Variables

| Variable | Service | Required | Description |
|---|---|---|---|
| `BROKER_ACCOUNTS_ENCRYPTION_KEY` | xstockstrat-trading | Yes | 64-char hex string (32 bytes AES-256) |

All other env vars (`ALPACA_API_KEY`, `ALPACA_API_SECRET`, `ALPACA_PAPER_URL`, `ALPACA_LIVE_URL`, `ALPACA_PAPER`) remain unchanged and serve as the seed for the `alpaca-default` fallback account (Step 15d).
