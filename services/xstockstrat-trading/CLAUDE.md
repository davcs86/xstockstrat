# xstockstrat-trading — CLAUDE.md

## Role
Go gRPC service responsible for order execution and trade lifecycle management. Submits orders to Alpaca's broker REST API (paper or live). Writes all order events to xstockstrat-ledger.

**Alpaca API ownership**: `xstockstrat-trading` is the sole integration point for Alpaca's **broker/order APIs** (`/v2/orders`, `/v2/account`). `xstockstrat-marketdata` owns Alpaca's **market data APIs** — these are separate API surfaces and separate responsibilities.

**Paper vs live**: Mode is resolved per order. Priority: `PlaceOrderRequest.trading_mode` > `trading.broker.paper` (live config) > `ALPACA_PAPER` (env). Paper routes to `https://paper-api.alpaca.markets`; live routes to `https://api.alpaca.markets`.

## Language
Go 1.22

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50051` | Internal service-to-service (protobuf) |
| HTTP (Connect-RPC) | `8051` | Connect-RPC + n8n webhooks (HTTP/1.1 + HTTP/2 via h2c) |

## Connect-RPC

Connect-RPC HTTP server runs alongside gRPC on `HTTP_PORT=8051`. Both servers delegate to the same handler implementation.

- Handler registration: `cmd/server/main.go` — uses `tradingv1connect.NewTradingServiceHandler` wrapped with `h2c.NewHandler`
- Callers (frontends, n8n) use HTTP `8051`; internal services use gRPC `50051`
- Transport: `golang.org/x/net/http2/h2c` supports HTTP/1.1 and HTTP/2 cleartext on same port

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
| `trading.broker.paper` | bool | `true` | Route orders to paper API when true; live API when false |
| `trading.broker.timeout_ms` | int | `5000` | Alpaca broker HTTP call timeout |

## n8n Webhooks

| Endpoint | Method | Payload | Action |
|---|---|---|---|
| `/webhooks/n8n/place-order` | POST | `{symbol, side, qty, order_type, limit_price, strategy_id, user_id}` | Places order via gRPC |
| `/webhooks/n8n/cancel-order` | POST | `{order_id, user_id}` | Cancels order via gRPC |

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
| `order.rejected` | `order:{order_id}` | Broker rejected order |
| `order.approval_requested` | `approval:{order_id}` | Approval required |
| `order.approved` | `approval:{order_id}` | Manual approval granted |
| `order.broker_submitted` | `order:{order_id}` | Order accepted by Alpaca broker |
| `order.broker_rejected` | `order:{order_id}` | Alpaca broker rejected the order |

## Environment Variables

```
GRPC_PORT=50051
HTTP_PORT=8051
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052
INDICATORS_ENDPOINT=xstockstrat-indicators:50054
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://user:pass@timescaledb:5432/xstockstrat?sslmode=disable
APPLICATION_ENV=development            # development | production
TRADING_MODE=paper                     # paper | live
```

## Running Locally

```bash
go mod download
go run ./cmd/server
```
