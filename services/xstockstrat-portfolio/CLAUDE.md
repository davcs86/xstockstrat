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
| `portfolio.watchlist.max_per_user` | int | `50` | Max watchlists a single user may own (feature 058) |
| `portfolio.watchlist.max_symbols_per_list` | int | `500` | Max symbols allowed in one watchlist (feature 058) |
| `platform.ledger_endpoint` | string | — | Ledger address |

## Ledger Events Consumed

| Event Type | Consumer | Effect |
|---|---|---|
| `order.filled` | `ConsumeOrderFills` (live stream) | Live-update the `positions` table from completed order fills (`user_id` + `account_id` from payload). Uses the incremental `qty` field. |
| `order.partially_filled` | `GetPnL` (query time) | Consumed in `GetPnL` Pass 2 for realized P&L on orders that never reached `order.filled`, deduplicated per order ID keeping the highest cumulative `filled_qty`. **Not** consumed by the live `positions` stream — partial fills converge into the positions table via the `account.positions.synced` broker reconciliation poller. |
| `account.positions.synced` | `ConsumePositionSyncs` (live stream) | Reconcile positions against a broker snapshot (`user_id` + `account_id`); also stores the broker's per-position mark-to-market valuation (`current_price`/`market_value`/`unrealized_pl`/`unrealized_plpc`) so `ListPortfolios` reconciles with broker equity instead of recomputing from marketdata mid-quotes, plus the broker's intraday/today's P&L (`day_pnl`/`day_pnl_pct`; migration `006`) surfaced as the positions table's "Today's P/L" |
| `account.balance.synced` | `ConsumeBalanceSyncs` (live stream) | Upsert the latest broker balance (cash, buying power, equity, last_equity) per account; surfaced by `ListPortfolios` |

## Database

- Schema: `portfolio`
- Table: `portfolio.positions` — current open positions, including the broker's last-synced mark-to-market valuation (`current_price`, `market_value`, `unrealized_pnl`, `unrealized_pnl_pct`; migration `005`) and the broker's intraday/today's P&L (`day_pnl`, `day_pnl_pct`; migration `006`). These are authoritative for broker-synced positions; order-fill-only positions leave them `0` and the service enriches from marketdata mid-quotes as a fallback (intraday P&L stays `0` since marketdata mid-quotes have no previous-close basis).
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

All emissions go through `emitEvent`, which sends a per-emit `idempotency_key` and **retries
transient `Unavailable` failures** (bounded backoff, 4 attempts). A ledger restart sends an
HTTP/2 GOAWAY that fails the in-flight append; previously the event was logged-and-dropped, so
a deploy-time ledger bounce lost audit events. The idempotency key makes the retry safe — the
ledger dedups it, so a retry after a committed-but-unacked append returns the stored event
rather than writing a duplicate. The ledger/marketdata/notify client connections also set gRPC
keepalive so an idle link the server GOAWAYs is re-established promptly.

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
