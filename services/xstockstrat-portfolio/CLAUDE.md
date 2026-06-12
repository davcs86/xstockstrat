# xstockstrat-portfolio — CLAUDE.md

## Role

Go gRPC service that tracks open positions, portfolio equity, and P&L. Maintains portfolio snapshots in TimescaleDB. All portfolio state changes are sourced from ledger events (order fills, manual adjustments).

**Paper vs Live separation**: Positions and P&L are tracked independently per `TradingMode` (PAPER / LIVE). Callers can filter by `trading_mode` on `ListPositions`, `GetPortfolio`, `GetPnL`, and `StreamPortfolioUpdates`. Paper positions and P&L never mix with live figures. `ListPositions` additionally accepts additive `symbol` (exact match) and `side` (long/short, derived from the sign of `qty`) filters (feature 056), and enriches each returned position with current price / market value / unrealized P&L (the same enrichment `GetPortfolio`/`GetPosition` apply).

## Language

Go 1.22

## Docker Build Pattern

Go pattern — see `docs/patterns/docker-build.md` for multi-stage builder, static binary compilation (`CGO_ENABLED=0`), and distroless final images.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50052` | Internal service-to-service (protobuf) |

This service is **gRPC-only**. All callers connect over gRPC `50052`. The former
HTTP/Connect-RPC server on `8052` (and its `/webhooks/n8n/portfolio-report` handler) was removed.

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

## Ledger Events Consumed

| Event Type | Effect |
|---|---|
| `order.filled` / `order.partially_filled` | Update positions from order fills (`user_id` + `account_id` from payload) |
| `account.positions.synced` | Reconcile positions against a broker snapshot (`user_id` + `account_id`) |
| `account.balance.synced` | Upsert the latest broker balance (cash, buying power, equity, last_equity) per account; surfaced by `ListPortfolios` |

## Database

- Schema: `portfolio`
- Table: `portfolio.positions` — current open positions
- Table: `portfolio.account_balances` — latest broker balance snapshot per account (cash, buying power, equity, last_equity); upserted from `account.balance.synced`
- Hypertable: `portfolio.snapshots` — point-in-time portfolio state (partition by `time`, chunk = 1 day)
- Migration tool: `golang-migrate`

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `portfolio.position.opened` | New position created |
| `portfolio.position.closed` | Position fully closed |
| `portfolio.risk.drawdown_breach` | Max drawdown exceeded |
| `portfolio.snapshot` | Periodic snapshot written |

## Environment Variables

```text
GRPC_PORT=50052
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development            # development | production
TRADING_MODE=paper                     # paper | live
```
