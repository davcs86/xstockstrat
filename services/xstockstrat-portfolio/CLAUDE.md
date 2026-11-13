# xstockstrat-portfolio — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (broker-authoritative valuation, total-signed `cost_basis`, ledger reconnect/resume, hand-written JSON payload structs) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (P&L/equity/risk parity break) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Go gRPC service that tracks open positions, portfolio equity, and P&L. Maintains portfolio snapshots in TimescaleDB. All portfolio state changes are sourced from ledger events (order fills, manual adjustments).

**Paper vs Live separation**: Positions and P&L are tracked independently per `TradingMode` (PAPER / LIVE). Callers can filter by `trading_mode` on `ListPositions`, `GetPortfolio`, `GetPnL`, and `StreamPortfolioUpdates`. Paper positions and P&L never mix with live figures. `ListPositions` additionally accepts additive `symbol` (exact match) and `side` (long/short, derived from the sign of `qty`) filters (feature 056), and enriches each returned position with current price / market value / unrealized P&L (the same enrichment `GetPortfolio`/`GetPosition` apply).

**Caller identity is the `x-user-id` header (root PLAT-11)** on the self-scoped reads — `GetPortfolio`,
`GetPosition`, `ListPositions`, `GetPnL`, `StreamPortfolioUpdates` (the stream reads incoming metadata directly; no
stream interceptor is registered). Their body `user_id` is deprecated and ignored; a missing header still yields
`InvalidArgument "user_id required"`.

**Quote-dependent reads are bounded and never fabricate (feature 229)** — every quote fetch goes through
`latestQuotesFor` under `portfolio.marketdata.quote_timeout_ms`; an unavailable quote is `UNAVAILABLE`, never a
silent 0, and valuation is broker-first, then `mark_price`, then a two-sided mid. Detail: PORTFOLIO-16 / PORTFOLIO-1.

**Offline valuation (feature 240).** In the four reads (`GetPortfolio`, `GetPosition`, `ListPositions`,
`ListPortfolios`) an offline position (`source ≠ 0`) goes through one shared valuation step (`valueRead`,
`internal/service/offline_valuation.go`): one quote batch plus one `allow_partial` daily-bars batch, then a mark
with provenance (`mark_source`/`mark_as_of`) and broker-style Day P&L from trading's `recent_fills`. Mark rule
(operator D-1): a quote counts only if two-sided and from the reference session; off-session the session's own
close wins; otherwise the last close in the lookback; else `MARK_SOURCE_NONE` (listed, excluded from sums).
An unreadable offline-state read degrades per account (PORTFOLIO-11).
`GetPnL`, `broadcastSnapshot` and `checkRiskLimits` never use it (231 behaviour kept). Fixed invariants, not
config: the NYSE calendar (`internal/marketsession`, rule holidays, no early closes), a bar's session date =
NY date of `time + 6h`, and the 1-minute truncation of the bars `End` (singleflight coalescing).

**Account/portfolio-scoped reads are ownership-gated (2026-09-16 security audit, H-3).**
`ListPortfolios` with a caller-supplied `account_id` returns `PermissionDenied` unless the account is
in the caller's owned universe (`callerOwnsAccount` — the same `ListAccountBalancesByUser ∪
ListOfflineAccountIdsByUser` set the all-accounts branch trusts). `GetSnapshot` returns
`PermissionDenied` unless `portfolio_id == caller` — a snapshot's `portfolio_id` **is** the owning
`user_id` (snapshots are written as `InsertSnapshot(userID, userID, …)`), so a caller can read only
their own. Previously both returned another user's equity/positions for any supplied id.
`StreamPortfolioUpdates` delivers only snapshots whose `portfolio_id == x-user-id`; an empty caller is
rejected `InvalidArgument` on both paths before subscribing (feature 264).

**Cross-user watchlist enumeration (feature 154).** `ListAllWatchlistSymbols` is cross-user; it is gated on
`x-internal-caller` `analysis-fundsignal` only, never the admin bit (PORTFOLIO-8).

**Watchlist servability filter (feature 282).** The three watchlist insert paths store only symbols marketdata
`GetSymbolServability` calls servable and return the rest in `refused_symbols`; fail-open on error/timeout — see
PORTFOLIO-19.

## Docker Build Pattern

Go pattern — see `docs/patterns/docker-build.md` for multi-stage builder, static binary compilation (`CGO_ENABLED=0`), and distroless final images.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config |
| xstockstrat-ledger | gRPC stream | Consume `order.filled` events to update positions |
| xstockstrat-marketdata | gRPC read | Current prices for unrealized P&L + `BatchGetBars` (`allow_partial`) daily closes for offline marks/Day P&L (feature 240) + `GetSymbolServability` on watchlist inserts (feature 282) |
| xstockstrat-notify | gRPC write | Risk limit breach alerts |
| TimescaleDB | DB (schema: `portfolio`) | Positions + snapshots hypertable |

## Config Keys Consumed

Namespace: `portfolio`. Keys are listed and read as namespace-relative (`risk.max_drawdown_pct`); logs and errors
may print the FQN `portfolio.<key>`.

| Key | Type | Default | Description |
|---|---|---|---|
| `risk.max_drawdown_pct` | float | `0.10` | Per-account drawdown alert — a WARNING alert is emitted when an account's peak-to-current drawdown (broker `account_balances.equity` vs persisted `peak_equity` HWM) exceeds this pct (feature 172) |
| `risk.concentration_limit_pct` | float | `0.20` | Alert if single position > 20% of portfolio |
| `watchlist.max_per_user` | int | `50` | Max watchlists a single user may own (feature 058) |
| `watchlist.max_symbols_per_list` | int | `500` | Max symbols allowed in one watchlist (feature 058), checked on the post-servability-filter set. SetConfig-bounded `[1,1000]` (feature 282) so a within-cap write never exceeds marketdata's 1000-symbol `GetSymbolServability` bound — change both together. |
| `watchlist.signal_prune_interval_seconds` | int | `300` | Feature 281 — seconds between signal-entry expiry prune ticks, read live each iteration. Read clamp: `≤ 0` → `300`, `1..59` → `60`, `> 86400` → `86400`; SetConfig-bounded `[60,86400]` (`SCALAR_BOUNDS_REGISTRY`). Seeded by config migration `037_portfolio_signal_prune_interval` (global staging + production rows at `300`). No pause switch — raising it is not a pause. |
| `exposure.factor_map` | string (JSON) | `"{}"` | JSON object mapping symbol → factor name for the Exposure screen's factor grouping (feature 083). marketdata exposes no sector, so this operator-defined map is the factor source; unmapped symbols group as "Unclassified". Read via `Watcher.FactorMap()`; invalid JSON → empty map. |
| `marketdata.last_close_lookback_days` | int | `21` | Feature 240 — how many calendar days back the offline-valuation `BatchGetBars` (`allow_partial`) searches for a daily close to mark an offline position that has no live quote (`MARK_SOURCE_LAST_CLOSE`), and the window for Day P&L's previous close. Read live per read; nil/`≤ 0` → `21`. Seeded by config migration `041`; SetConfig-bounded `[5,60]`. |
| `marketdata.quote_timeout_ms` | int | `4000` | Feature 229 — deadline on the marketdata `GetLatestQuotes` fetch (`latestQuotesFor`, the single choke point for every read and background path). On expiry the un-broker-valued positions stay unenriched (never fabricated) and the read still answers. Must exceed max(`marketdata.quotes.batch_timeout_ms` (2500), `marketdata.quotes.mark_timeout_ms` (500)) plus the warm read so a cold timeout still returns the warm subset. Read live; nil/`≤ 0` → `4000`. Seeded by config migration `041`; SetConfig-bounded `[500,8000]`. |
| `marketdata.servability_timeout_ms` | int | `2000` | Feature 282 — deadline on the marketdata `GetSymbolServability` check (`refuseUnservable`) on the three watchlist insert paths. On timeout or error the write proceeds unfiltered with a WARN (fail-open). Read live per write; nil/`≤ 0` → `2000`, `< 500` → `500`, `> 4000` → `4000`. SetConfig-bounded `[500,4000]`. Seeded by config migration `039_portfolio_servability_timeout` (global staging + production rows at `2000`). |

## Ledger Events Consumed

| Event Type | Consumer | Effect |
|---|---|---|
| `order.filled` | `ConsumeOrderFills` (live stream); also `GetPnL` (query time) | `GetPnL` folds fills at query time, resolving `side` from the payload, then `order.created`, then `order.submitted` (`orderSide`, stream_key = bare order id). Live: update the `positions` table from completed order fills (`user_id` + `account_id` from payload). Uses the incremental `qty` field. Serialized with the sync/deregistration consumers (PORTFOLIO-14). |
| `order.partially_filled` | `GetPnL` (query time) | Consumed in `GetPnL` Pass 2 for realized P&L on orders that never reached `order.filled`, deduplicated per order ID keeping the highest cumulative `filled_qty`, with the same `side` resolution as `order.filled`; the fold is account-grain and sequence-ordered. **Not** consumed by the live `positions` stream — partial fills converge into the positions table via the `account.positions.synced` broker reconciliation poller. |
| `account.positions.synced` | `ConsumePositionSyncs` (live stream) | Reconcile positions against an absolute broker/offline snapshot (`user_id` + `account_id`), storing the broker's per-position valuation, intraday P&L and `source`/`as_of` provenance (feature 163). Empty-snapshot delete guard, retry/park and cancel-stop: PORTFOLIO-10, PORTFOLIO-3. |
| `account.deregistered` | `ConsumeAccountDeregistrations` (live stream) | Purge the account's positions and offline realized row. Same `boundedRetry` retry/park/self-heal contract as the sync row, applied to every deregistration including broker accounts (the payload carries no account type; both deletes are idempotent; feature 256 option (a)). |
| `account.balance.synced` | `ConsumeBalanceSyncs` (live stream) | Upsert the latest broker balance (cash, buying power, equity, last_equity) per account; surfaced by `ListPortfolios` |
| `order.bracket_updated` | `ConsumeBracketUpdates` (live stream) | Upsert `stop_order_id`/`take_profit_order_id` from trading's bracket state machine (feature 030); empty string clears |

## Database

- Schema: `portfolio`
- Table: `portfolio.positions` — current open positions plus the broker's last-synced valuation and intraday P&L, the display-only bracket leg order IDs (from trading's `order.bracket_updated`), and `source`/`as_of` provenance (feature 163). Broker valuation is authoritative for broker-synced positions; order-fill-only positions are enriched from the marketdata mark (`markOf`).
- Table: `portfolio.account_balances` — latest broker balance snapshot per account (cash, buying power, equity, last_equity); upserted from `account.balance.synced`. **Offline accounts have no row here** (feature 157) — their equity derives from position market value and cash/buying-power/day-P&L are `0`.
- Table: `portfolio.offline_account_realized` — the offline-exclusive account marker + account-grain realized P&L (feature 157/240); lifetime realized = `realized_carried + realized_pnl`; broker accounts never get a row. `ListPortfolios`' all-accounts view enumerates `account_balances` ∪ this offline set.
- Table: `portfolio.watchlist_signal_expiry` — per-entry expiry of system-managed SIGNAL watchlist entries (feature 281, migration `018`): PK `(watchlist_id, symbol)`, `valid_until`, `signal_id`. FKs to `portfolio.watchlists` only (`ON DELETE CASCADE`), never `watchlist_symbols`, because replace-all `Update` deletes and reinserts bindings. No row = open-ended (never pruned); `signal_id NULL` = a backfill "untracked" mark.
- Hypertable: `portfolio.snapshots` — point-in-time portfolio state (partition by `time`, chunk = 1 day)

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `portfolio.position.opened` | New position created |
| `portfolio.position.closed` | Position fully closed |
| `portfolio.risk.drawdown_breach` | Max drawdown exceeded |
| `portfolio.snapshot` | Snapshot written after each processed fill |
| `portfolio.watchlist.signal_entry_expired` | Prune removed a tracked SIGNAL entry whose `valid_until` passed — payload `{user_id, watchlist_id, symbol, strategy_id, signal_id, valid_until}` (RFC3339), stream key `watchlist:<watchlist_id>`; the owner also rides in `AppendEventRequest.user_id` (feature 281) |
| `portfolio.watchlist.signal_entry_removed_untracked` | Prune removed a backfill-marked (`signal_id NULL`) SIGNAL entry — payload `{user_id, watchlist_id, symbol, strategy_id}`, same stream key and `AppendEventRequest.user_id` owner (feature 281) |

**Signal-entry expiry prune (feature 281)** — see PORTFOLIO-18; legacy entries are classified by `portfolio backfill-signal-expiry` (procedure → [`docs/runbooks/signal-watchlist-expiry-backfill.md`](../../docs/runbooks/signal-watchlist-expiry-backfill.md)).

**`portfolio.position.closed` payload is a contract (feature 042)** — analysis's P&L-pattern consumer and the
`/insights` dashboard read it back, so do not drop or rename its keys; extensions are additive only. Full key set and
`realized_accum` scope → this service's `docs/` folder (**`position-closed-contract.md`**).

`emitEvent` retries `Unavailable` (4×) under one idempotency key.

## Observability (feature 294-signal-map-instrumentation)

- `loop tick ok` is written per event consumer (`order_fill`, `position_sync`, `deregistration`, `bracket`, `balance`) on outcome ok/acked only, throttled to one record per consumer per 60 s. These are event-driven, so there is no idle heartbeat and silence is ambiguous. `signal_prune` keeps its `signal watchlist prune tick` record. Trading also has a `position_sync` loop: filter on `service_name` too.
- Instruments: `portfolio.consumer.events{consumer, outcome ok|error|parked|acked}`, `portfolio.marketdata_fetch{op=quotes, outcome ok|error|timeout}`, `portfolio.snapshot{outcome written|skipped_unpriced|db_error}`, `portfolio.mark_source{mark_source, path read|pnl|snapshot|risk}` (a rate, not a state).
- Stream consumers retry every 2 s (`streamRetryDelay`), log failures at N=10 (`streamLogEvery`) and reset their counters after a 10-minute quiet window (`streamQuietWindow`; counters only, never the retry timing). INFO `<name> stream resumed` marks a recovery.
- Load-bearing logs: ERROR `portfolio snapshot insert failed` (the ledger emit and broadcast still run); WARN `latest quote has no usable price` is one aggregate per pass with `count` and at most 5 `sample_symbols`.

## Environment Variables

> mTLS: requires `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` (fail-closed) — see root CLAUDE.md § Environment Variable Naming Convention.

```text
# GRPC_PORT, *_ENDPOINT, APPLICATION_ENV, TRADING_MODE: see docker-compose.yml / internal/config/config.go
```
