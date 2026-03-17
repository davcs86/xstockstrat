# xstockstrat-portfolio — CLAUDE.md

## Role
Go gRPC service that tracks open positions, portfolio equity, and P&L. Maintains portfolio snapshots in TimescaleDB. All portfolio state changes are sourced from ledger events (order fills, manual adjustments).

**Paper vs Live separation**: Positions and P&L are tracked independently per `TradingMode` (PAPER / LIVE). Callers can filter by `trading_mode` on `ListPositions`, `GetPortfolio`, `GetPnL`, and `StreamPortfolioUpdates`. Paper positions and P&L never mix with live figures.

## Language
Go 1.22

## gRPC Port
`50052`

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
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://user:pass@timescaledb:5432/xstockstrat?sslmode=disable
```
