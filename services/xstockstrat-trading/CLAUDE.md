# xstockstrat-trading — CLAUDE.md

## Role

Go gRPC service responsible for order execution and trade lifecycle management. Submits orders to Alpaca's broker REST API (paper or live). Writes all order events to xstockstrat-ledger.

**Alpaca API ownership**: `xstockstrat-trading` is the sole integration point for Alpaca's **broker/order APIs** (`/v2/orders`, `/v2/account`). `xstockstrat-marketdata` owns Alpaca's **market data APIs** — these are separate API surfaces and separate responsibilities.

**Paper vs live**: Mode is resolved per order. Priority: `PlaceOrderRequest.trading_mode` > `trading.broker.paper` (live config) > `ALPACA_PAPER` (env). Paper routes to `https://paper-api.alpaca.markets`; live routes to `https://api.alpaca.markets`.

**Order types & trailing stops**: `PlaceOrder` supports `market`/`limit`/`stop`/`stop_limit`/`trailing_stop`. A `trailing_stop` order requires **exactly one** of `PlaceOrderRequest.trail_price` / `trail_percent` (sent to Alpaca as `trail_price`/`trail_percent`); any other order type must leave both zero — both rules are validated up front with `InvalidArgument` so a bad request never reaches the broker as a 422. `ReplaceOrder.trail` updates a working trailing stop (Alpaca's PATCH body uses a single `trail`).

**Idempotency**: `PlaceOrder` forwards the internally-minted order ID as Alpaca's `client_order_id`, so a retried submission (`trading.order.max_retries`) is de-duplicated by the broker instead of placing a second order.

**Broker account registration mode is environment-owned**: `RegisterBrokerAccount` ignores the (deprecated) `is_paper` request field and derives the account's mode from the environment (`trading.broker.paper` config / `TRADING_MODE` env), so users cannot register an account in a mode the deployment does not run. The UI reads `GetTradingEnvironment` to display the fixed mode instead of offering a paper/live choice.

**Credential health**: every registered account's API secrets are validated against the broker (Alpaca `GET /v2/account`, IBKR `GET /portfolio/accounts`) on register, on credential update (`UpdateBrokerAccountCredentials`), and periodically by a background poller. The latest `CredentialStatus` (OK / INVALID / UNKNOWN) is persisted on `trading.broker_accounts` and returned by `ListBrokerAccounts` so the UI can surface accounts whose secrets stopped working.

## Language

Go 1.22

## Docker Build Pattern

Go pattern — see `docs/patterns/docker-build.md` for multi-stage builder, static binary compilation (`CGO_ENABLED=0`), and distroless final images.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50051` | Internal service-to-service (protobuf) |

This service is **gRPC-only**. All callers (internal services, the frontends, and the MCP
agent) connect over gRPC `50051`. The former HTTP/Connect-RPC server on `8051` was removed.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig stream | Live config at startup |
| xstockstrat-ledger | gRPC write | Emit order lifecycle events |
| xstockstrat-portfolio | gRPC read | Check position/buying power before order |
| xstockstrat-indicators | gRPC read | Validate signal before execution |
| xstockstrat-notify | gRPC write | Emit order fill/rejection alerts |
| TimescaleDB | DB (schema: `trading`) | Persist orders hypertable |

## Config Keys Consumed

All config values are served by **xstockstrat-config** namespace `trading`.

| Key | Type | Default | Description |
|---|---|---|---|
| `trading.approval.require_above_qty` | float | `500` | Orders above this qty require manual approval |
| `trading.approval.require_above_notional` | float | `50000` | Orders above this USD notional require approval |
| `trading.order.max_retries` | int | `3` | Max broker submission retries |
| `trading.order.retry_delay_ms` | int | `500` | Delay between retries |
| `trading.risk.max_position_pct` | float | `0.05` | Max 5% of portfolio in single position |
| `trading.risk.daily_loss_limit` | float | `0.02` | Halt trading if day loss exceeds 2% |
| `trading.maintenance_mode` | bool | `false` | If true, reject all new orders |
| `platform.ledger_endpoint` | string | — | xstockstrat-ledger address |
| `platform.maintenance_mode` | bool | `false` | Platform-wide halt |
| `trading.broker.paper` | bool | `true` | Route orders to paper API when true; live API when false. Also the source of truth for the mode new broker accounts are registered in. |
| `trading.broker.timeout_ms` | int | `5000` | Alpaca broker HTTP call timeout. Read at account-client construction and applied as the broker HTTP client's `Timeout`. |
| `trading.credential_health.interval_ms` | int | `300000` | Interval for the background poller that re-validates each broker account's API secrets. Read live on every cycle; set to `0` (or negative) to disable/pause the poller without a restart. |

## Webhooks

_No webhooks. Call the gRPC RPCs on port 50051 directly._

## Database

- Schema: `trading`
- Hypertable: `trading.orders` (partition: `created_at`, chunk: 1 day)
- Migration tool: `golang-migrate`
- Run: `migrate -path ./migrations -database $DATABASE_URL up`

## Approval Flow

Orders requiring approval (above configured thresholds) are placed in `ORDER_STATUS_PENDING_APPROVAL` state and emit an alert via xstockstrat-notify. They do not proceed to broker until approved. See `_tasks/x-approval-flow.md` for the full runbook.

## Ledger Events Emitted

| Event Type | Stream Key | Trigger |
|---|---|---|
| `order.created` | `order:{order_id}` | New order placed |
| `order.submitted` | `order:{order_id}` | Order sent to broker |
| `order.filled` | `order:{order_id}` | Order fully filled |
| `order.partially_filled` | `order:{order_id}` | Partial fill received |
| `order.canceled` | `order:{order_id}` | Order canceled |
| `order.replaced` | `order:{order_id}` | Working order modified via `ReplaceOrder` (qty/price/TIF) |
| `order.rejected` | `order:{order_id}` | Broker rejected order |
| `order.approval_requested` | `approval:{order_id}` | Approval required |
| `order.approved` | `approval:{order_id}` | Manual approval granted |
| `order.broker_submitted` | `order:{order_id}` | Order accepted by Alpaca broker |
| `order.broker_rejected` | `order:{order_id}` | Alpaca broker rejected the order |
| `account.positions.synced` | `account:{account_id}` | Periodic broker position snapshot (poller); carries `user_id` + `account_id` |
| `account.balance.synced` | `account:{account_id}` | Periodic broker balance snapshot (poller): cash, buying power, equity, last_equity |

## Order Replace (`ReplaceOrder`)

`ReplaceOrder` (feature `055-orders-management-ui`) modifies a working order's quantity,
limit price, stop price, and/or time-in-force. It is **broker-agnostic at the proto surface**:
the service routes by the persisted order's `broker_type` via `resolveAccount`, so the same RPC
covers both Alpaca and IBKR with no broker-specific branch in the caller. A zero/empty field in
`ReplaceOrderRequest` means "leave unchanged".

Replace is allowed **only** while the order is `ORDER_STATUS_NEW` or
`ORDER_STATUS_PARTIALLY_FILLED` — terminal states (`FILLED`/`CANCELED`/`EXPIRED`/`REJECTED`) and
an order with no `broker_order_id` yet are rejected with `FailedPrecondition`. For a
`PARTIALLY_FILLED` order the new `qty` is passed straight through; each broker interprets it as
the new total/remaining per its adapter. A successful replace persists the order, emits the
`order.replaced` ledger event, and broadcasts to `StreamOrderUpdates` subscribers.

### Per-broker replaceable-field matrix

| Field (proto) | Alpaca — `PATCH /v2/orders/{id}` | IBKR — modify `POST /iserver/account/{acct}/order/{id}` |
|---|---|---|
| `qty` | `qty` | `quantity` |
| `limit_price` | `limit_price` | `price` |
| `stop_price` | `stop_price` | `auxPrice` |
| `trail` | `trail` | _(not mapped — IBKR ignores)_ |
| `time_in_force` | `time_in_force` | `tif` |

The IBKR **netting-mode** assumption documented in _Known Limitations_ applies to replace as
well: a replaced quantity is the new total order quantity (no hedged-mode lot semantics).

## Environment Variables

```text
GRPC_PORT=50051
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052
INDICATORS_ENDPOINT=xstockstrat-indicators:50054
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development            # development | production
TRADING_MODE=paper                     # paper | live
BROKER_ACCOUNTS_ENCRYPTION_KEY=<hex>  # hex-encoded 32-byte AES-256 key; required when broker_accounts table is in use. Generate: openssl rand -hex 32
```

## Running Locally

```bash
go mod download
go run ./cmd/server
```

## Known Limitations

### IBKR: Hedged Mode not supported

The IBKR integration (`internal/broker/ibkr.go`) assumes the account uses **netting mode** (the default for standard and margin accounts), where a buy order automatically offsets an open short position in the same security. IBKR also offers **Hedged Mode** (available to portfolio-margin and institutional accounts), which allows simultaneous long and short lots in the same security without automatic netting.

If an IBKR account is configured for Hedged Mode:

1. `pollFills` may emit `order.filled` events for both a buy and a sell in the same security that coexist rather than net — the fill payloads will be structurally valid but represent distinct lots.
2. `xstockstrat-portfolio`'s `GetPnL` two-pass algorithm (feature `013-phase-2-data-layer`) applies all `order.filled` events before all `order.partially_filled` events regardless of chronological order. In netting-mode accounts this produces correct P&L because opposing positions cannot coexist; in Hedged Mode the ordering may produce incorrect cost-basis calculations for interleaved fills.

**To add Hedged Mode support**: add an `IsHedged bool` field to `IBKRConfig`, propagate it to `BrokerOrder` or a separate signal, and update `GetPnL` in `xstockstrat-portfolio` to merge and sort both event types by `recorded_at` before feeding the accumulator.

Alpaca is unaffected: Alpaca prohibits simultaneous long and short positions in the same security at the API level (returns `position intent mismatch` if attempted).
