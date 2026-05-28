# xstockstrat-trading — CLAUDE.md

## Role
Go gRPC service responsible for order execution and trade lifecycle management. Submits orders to Alpaca's broker REST API (paper or live). Writes all order events to xstockstrat-ledger.

**Alpaca API ownership**: `xstockstrat-trading` is the sole integration point for Alpaca's **broker/order APIs** (`/v2/orders`, `/v2/account`). `xstockstrat-marketdata` owns Alpaca's **market data APIs** — these are separate API surfaces and separate responsibilities.

**Paper vs live**: Mode is resolved per order. Priority: `PlaceOrderRequest.trading_mode` > `trading.broker.paper` (live config) > `ALPACA_PAPER` (env). Paper routes to `https://paper-api.alpaca.markets`; live routes to `https://api.alpaca.markets`.

## Language
Go 1.22

## Docker Build Pattern
Go pattern — see `docs/patterns/docker-build.md` for multi-stage builder, static binary compilation (`CGO_ENABLED=0`), and distroless final images.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50051` | Internal service-to-service (protobuf) |
| HTTP (Connect-RPC) | `8051` | Connect-RPC (HTTP/1.1 + HTTP/2 via h2c) |

## Connect-RPC

Connect-RPC HTTP server runs alongside gRPC on `HTTP_PORT=8051`. Both servers delegate to the same handler implementation.

- Handler registration: `cmd/server/main.go` — uses `tradingv1connect.NewTradingServiceHandler` wrapped with `h2c.NewHandler`
- Callers (frontends, agent) use HTTP `8051`; internal services use gRPC `50051`
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

## Webhooks

_Webhook layer removed in feature-011. Use Connect-RPC directly on port 8051._

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
