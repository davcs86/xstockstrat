# xstockstrat-portfolio — CLAUDE.md

## Role
Go gRPC service that tracks open positions, portfolio equity, and P&L. Maintains portfolio snapshots in TimescaleDB. All portfolio state changes are sourced from ledger events (order fills, manual adjustments).

**Paper vs Live separation**: Positions and P&L are tracked independently per `TradingMode` (PAPER / LIVE). Callers can filter by `trading_mode` on `ListPositions`, `GetPortfolio`, `GetPnL`, and `StreamPortfolioUpdates`. Paper positions and P&L never mix with live figures.

## Language
Go 1.22

## Docker Build Pattern
Go pattern — see `docs/patterns/docker-build.md` for multi-stage builder, static binary compilation (`CGO_ENABLED=0`), and distroless final images.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50052` | Internal service-to-service (protobuf) |
| HTTP (Connect-RPC) | `8052` | Connect-RPC + n8n webhooks (HTTP/1.1 + HTTP/2 via h2c) |

## Connect-RPC

Connect-RPC HTTP server runs alongside gRPC on `HTTP_PORT=8052`.

- Handler registration: `cmd/server/main.go` — uses `portfoliov1connect.NewPortfolioServiceHandler` wrapped with `h2c.NewHandler`
- Callers (frontends, n8n) use HTTP `8052`; internal services use gRPC `50052`
- Transport: `golang.org/x/net/http2/h2c` supports HTTP/1.1 and HTTP/2 cleartext on same port

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config |
| xstockstrat-ledger | gRPC stream | Consume `order.filled` events to update positions |
| xstockstrat-marketdata | gRPC read | Current prices for unrealized P&L |
| xstockstrat-notify | gRPC write | Risk limit breach alerts |
| TimescaleDB | DB (schema: `portfolio`) | Positions + snapshots hypertable |

## Config Keys Consumed

Namespace: `portfolio`

| Key | Type | Default | Description |
|---|---|---|---|
| `portfolio.snapshot.interval_minutes` | int | `5` | How often to write portfolio snapshots |
| `portfolio.risk.max_drawdown_pct` | float | `0.10` | Alert if drawdown exceeds 10% |
| `portfolio.risk.concentration_limit_pct` | float | `0.20` | Alert if single position > 20% of portfolio |
| `platform.ledger_endpoint` | string | — | Ledger address |

## Database

- Schema: `portfolio`
- Table: `portfolio.positions` — current open positions
- Hypertable: `portfolio.snapshots` — point-in-time portfolio state (partition by `time`, chunk = 1 day)
- Migration tool: `golang-migrate`

## n8n Webhooks

| Endpoint | Method | Payload | Action |
|---|---|---|---|
| `/webhooks/n8n/portfolio-report` | POST | `{user_id, range}` | Returns P&L summary |

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `portfolio.position.opened` | New position created |
| `portfolio.position.closed` | Position fully closed |
| `portfolio.risk.drawdown_breach` | Max drawdown exceeded |
| `portfolio.snapshot` | Periodic snapshot written |

## Environment Variables

```
GRPC_PORT=50052
HTTP_PORT=8052
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development            # development | production
TRADING_MODE=paper                     # paper | live
```
