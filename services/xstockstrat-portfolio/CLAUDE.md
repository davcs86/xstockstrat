# xstockstrat-portfolio — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (broker-authoritative valuation, total-signed `cost_basis`, ledger reconnect/resume, hand-written JSON payload structs) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (P&L/equity/risk parity break) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Go gRPC service that tracks open positions, portfolio equity, and P&L. Maintains portfolio snapshots in TimescaleDB. All portfolio state changes are sourced from ledger events (order fills, manual adjustments).

**Paper vs Live separation**: Positions and P&L are tracked independently per `TradingMode` (PAPER / LIVE). Callers can filter by `trading_mode` on `ListPositions`, `GetPortfolio`, `GetPnL`, and `StreamPortfolioUpdates`. Paper positions and P&L never mix with live figures. `ListPositions` additionally accepts additive `symbol` (exact match) and `side` (long/short, derived from the sign of `qty`) filters (feature 056), and enriches each returned position with current price / market value / unrealized P&L (the same enrichment `GetPortfolio`/`GetPosition` apply).

**Caller identity comes from the `x-user-id` header, not the request body.** The self-scoped read
RPCs — `GetPortfolio`, `GetPosition`, `ListPositions`, `GetPnL`, `StreamPortfolioUpdates` — resolve
the caller from the propagated **`x-user-id`** header (unary RPCs via
`middleware.FromContext(ctx).UserID`; the streaming RPC reads incoming metadata directly, since no
stream interceptor is registered), exactly like the watchlist RPCs. Their request-body `user_id`
field is **deprecated and ignored** (a client cannot spoof the header, which the edge injects/strips
after auth). Internal callers with no inbound header (e.g. `xstockstrat-trading`'s reconciliation and
flatten pollers) inject `x-user-id` explicitly on the outbound call
(`metadata.AppendToOutgoingContext`). A missing header still yields `InvalidArgument "user_id
required"`.

**Cross-user watchlist enumeration & first authz gate (feature 154).** `ListAllWatchlistSymbols`
returns the **distinct union of watchlist symbols across ALL users** (`SELECT DISTINCT symbol FROM
portfolio.watchlist_symbols`, no user filter/join, no migration) — the fundamentals-signal producer's
universe source. Unlike every other watchlist RPC (which is `x-user-id`-scoped self-service), this is
a **cross-user read of per-user data**, so it is portfolio's **first authz gate**
(`internal/service/authz.go`): callable only by an allow-listed **`x-internal-caller`** (grant
`analysis-fundsignal`), read from incoming gRPC metadata, fail-closed. It deliberately **ignores** the
admin `x-access-scope` bit — the admin bit never reaches another user's per-user rows (PR #994) — so an
admin-only caller is also denied. See the `PORTFOLIO-*` invariant in `docs/context-constitution.md`.

## Language

Go 1.27

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
| `portfolio.risk.max_drawdown_pct` | float | `0.10` | **Read but not yet enforced** — intended drawdown alert; the value is currently read then discarded (`_ = maxDrawdownPct`) |
| `portfolio.risk.concentration_limit_pct` | float | `0.20` | Alert if single position > 20% of portfolio |
| `portfolio.watchlist.max_per_user` | int | `50` | Max watchlists a single user may own (feature 058) |
| `portfolio.watchlist.max_symbols_per_list` | int | `500` | Max symbols allowed in one watchlist (feature 058) |
| `portfolio.exposure.factor_map` | string (JSON) | `"{}"` | JSON object mapping symbol → factor name for the Exposure screen's factor grouping (feature 083). marketdata exposes no sector, so this operator-defined map is the factor source; unmapped symbols group as "Unclassified". Read via `Watcher.FactorMap()`; invalid JSON → empty map. |

> `platform.ledger_endpoint` was removed from this table by the 2026-08-07 config audit — no code
> in this service reads it via the config watcher. The ledger address is the `LEDGER_ENDPOINT` env
> var (see Environment Variables below), matching `xstockstrat-trading`'s own findings log
> (`docs/context-constitution-findings.md:14`), which flagged the same stale row.

## Ledger Events Consumed

| Event Type | Consumer | Effect |
|---|---|---|
| `order.filled` | `ConsumeOrderFills` (live stream) | Live-update the `positions` table from completed order fills (`user_id` + `account_id` from payload). Uses the incremental `qty` field. |
| `order.partially_filled` | `GetPnL` (query time) | Consumed in `GetPnL` Pass 2 for realized P&L on orders that never reached `order.filled`, deduplicated per order ID keeping the highest cumulative `filled_qty`. **Not** consumed by the live `positions` stream — partial fills converge into the positions table via the `account.positions.synced` broker reconciliation poller. |
| `account.positions.synced` | `ConsumePositionSyncs` (live stream) | Reconcile positions against a broker snapshot (`user_id` + `account_id`); also stores the broker's per-position mark-to-market valuation (`current_price`/`market_value`/`unrealized_pl`/`unrealized_plpc`) so `ListPortfolios` reconciles with broker equity instead of recomputing from marketdata mid-quotes, plus the broker's intraday/today's P&L (`day_pnl`/`day_pnl_pct`; migration `006`) surfaced as the positions table's "Today's P/L". Per-position `source` and `as_of` provenance fields (feature 163) are passed through when present: `source` = `ORDERS`/`BASELINE`/`MIXED`; `as_of` = baseline effective date |
| `account.balance.synced` | `ConsumeBalanceSyncs` (live stream) | Upsert the latest broker balance (cash, buying power, equity, last_equity) per account; surfaced by `ListPortfolios` |
| `order.bracket_updated` | `ConsumeBracketUpdates` (live stream) | Upsert `stop_order_id`/`take_profit_order_id` from trading's bracket state machine (feature 030); empty string clears |

## Database

- Schema: `portfolio`
- Table: `portfolio.positions` — current open positions, including the broker's last-synced mark-to-market valuation (`current_price`, `market_value`, `unrealized_pnl`, `unrealized_pnl_pct`; migration `005`), the broker's intraday/today's P&L (`day_pnl`, `day_pnl_pct`; migration `006`), the resting bracket leg order IDs (`stop_order_id`, `take_profit_order_id`; migration `009`, feature 030) — display-only, sourced from trading's `order.bracket_updated` ledger event, and distinct from the existing ledger-derived, in-memory `stop_price`/`risk_at_stop` (feature 083), which are computed on read, not persisted — and per-position provenance (`source` INTEGER DEFAULT 0, `as_of` TIMESTAMPTZ; migration `013`, feature 163): `source` encodes how the position was seeded (`ORDERS`=1 / `BASELINE`=2 / `MIXED`=3 / `UNSPECIFIED`=0), `as_of` is the baseline effective date (NULL for pure-order positions). These are authoritative for broker-synced positions; order-fill-only positions leave the valuation fields `0` and the service enriches from marketdata mid-quotes as a fallback (intraday P&L stays `0` since marketdata mid-quotes have no previous-close basis).
- Table: `portfolio.account_balances` — latest broker balance snapshot per account (cash, buying power, equity, last_equity); upserted from `account.balance.synced`. **Offline accounts have no row here** (feature 157) — their equity derives from position market value and cash/buying-power/day-P&L are `0`.
- Table: `portfolio.offline_account_realized` — the offline-exclusive account marker + account-grain realized P&L (feature 157, migration `012`); broker accounts never get a row. `ListPortfolios`' **all-accounts** view enumerates `account_balances` ∪ this offline set (`ListOfflineAccountIdsByUser`, feature 159), so an offline account is **shown** in the combined view with meaningful-only fields (excluded from the summed cash/buying-power aggregates, since it contributes `0`) — closing the `ListPositions`↔`ListPortfolios` read-path parity gap (C-10(b)).
- Hypertable: `portfolio.snapshots` — point-in-time portfolio state (partition by `time`, chunk = 1 day)
- Migration tool: `golang-migrate`

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `portfolio.position.opened` | New position created |
| `portfolio.position.closed` | Position fully closed |
| `portfolio.risk.drawdown_breach` | Max drawdown exceeded |
| `portfolio.snapshot` | Periodic snapshot written |

**`portfolio.position.closed` payload — producer contract (feature 042).** The full-close emit in
`ConsumeOrderFills` carries `{user_id, symbol, account_id, trading_mode, realized_pnl}`, where
`trading_mode` is `mode.String()` (e.g. `TRADING_MODE_PAPER`) and `realized_pnl` is the position's
sealed realized P&L (`realized_accum` accumulated over the reducing fills **plus** the closing fill's
delta). `xstockstrat-analysis`'s P&L-pattern consumer reads this back to seal a position's window
without recomputing P&L, so the key set is a **contract** — do not drop or rename these keys.
**Additive extensions (base keys unchanged, C-16):** feature 029 adds `fees_total` (JSON number,
the sealed cumulative fees — `realized_pnl` stays gross/authoritative, `net = realized_pnl −
fees_total` downstream); feature 031 adds `cost_basis` (JSON number, `existing.CostBasis`,
total-signed) and `opened_at` (RFC3339 string, `existing.OpenedAt`) **when the closing position row
was present** (both omitted on the redelivered-post-close `existing == nil` edge, alongside the
`realized_pnl`/`fees_total` `0` it already emits there). The `xstockstrat-ui` `/insights` performance
dashboard reads `cost_basis` for average return per trade and `opened_at` for average hold time; the
payload is built by the pure `closedPositionPayload` helper (unit-tested in
`portfolio_close_payload_test.go`). The
`positions.realized_accum` column (migration `010`) that backs it is **attribution-stats-only and
never a user-facing figure** — `GetPnL` remains the authoritative realized P&L. **Named v1 scope
limitation:** `realized_accum` is exact only for **long, order-fill-originated** positions; a short
opened via `account.positions.synced` and covered by a live buy takes the "buying more" branch, so
`realizedDelta` is not invoked and `realized_accum` understates (attribution-only impact; `GetPnL`
still returns the true figure). It is deliberately **not** accumulated in `ConsumePositionSyncs`
(sync has no per-leg price — would reintroduce the feature-056 dual-source bug).

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
APPLICATION_ENV=development            # development | production
TRADING_MODE=paper                     # paper | live
```
