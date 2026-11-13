# xstockstrat-trading — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (the Connect+gRPC adapter twin, enum→string/0→NULL persistence, broker credential sentinel) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects/doc-drift (dead retry config, IBKR timeout oversight) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Go gRPC service responsible for order execution and trade lifecycle management. Submits orders to Alpaca's broker REST API (paper or live). Writes all order events to xstockstrat-ledger.

**Alpaca API ownership**: `xstockstrat-trading` is the sole integration point for Alpaca's **broker/order APIs** (`/v2/orders`, `/v2/account`). `xstockstrat-marketdata` owns Alpaca's **market data APIs** — these are separate API surfaces and separate responsibilities.

**Paper vs live**: Mode is resolved per order from the account's persisted `is_paper` / the `trading.broker.paper` live config, falling back to the `TRADING_MODE` env var (there is **no** `ALPACA_PAPER` env var — no code reads one). Paper routes to `https://paper-api.alpaca.markets`; live routes to `https://api.alpaca.markets`.

**Order types & trailing stops**: `PlaceOrder` supports `market`/`limit`/`stop`/`stop_limit`/`trailing_stop`. A `trailing_stop` order requires **exactly one** of `PlaceOrderRequest.trail_price` / `trail_percent` (sent to Alpaca as `trail_price`/`trail_percent`); any other order type must leave both zero — both rules are validated up front with `InvalidArgument` so a bad request never reaches the broker as a 422. `ReplaceOrder.trail` updates a working trailing stop (Alpaca's PATCH body uses a single `trail`).

**Idempotency**: `PlaceOrder` forwards the internally-minted order ID as Alpaca's `client_order_id`, so a retried submission (a caller retry, or the emergency-flatten loop's `trading.order.max_retries`) is de-duplicated by the broker instead of placing a second order.

**Automatic position sizing**: `ComputePositionSize` triggers whenever `PlaceOrder` receives `qty <= 0` (FR-5) — an explicit `qty` bypasses it entirely (override mode). It sizes from account equity (`ListPortfolios`, not `GetPortfolio` — see the Config Keys table's `risk.max_concentration_pct` row), a Wilder ATR(14)-derived stop distance (`xstockstrat-marketdata` `GetBars`), the request's `confidence` (0.0–1.0, defaults to 1.0 when unset), and a portfolio concentration cap. **Fail-closed**, unlike the pre-existing warn-only `checkPortfolioRisk` below: missing/insufficient equity, bar history, or quote data aborts the order rather than sizing to a fallback value. `trading.risk.sizing_enabled=false` rejects any order submitted without an explicit `qty` instead of silently bypassing sizing.

**Broker account registration mode is environment-owned**: `RegisterBrokerAccount` ignores the (deprecated) `is_paper` request field and derives the account's mode from the environment (`trading.broker.paper` config / `TRADING_MODE` env), so users cannot register an account in a mode the deployment does not run. The UI reads `GetTradingEnvironment` to display the fixed mode instead of offering a paper/live choice.

**Credential health and offline accounts** (feature 157/159/240): credential validation and its poller, the `BROKER_TYPE_OFFLINE` record-not-route path (incl. the `CancelOrder` offline guard) and the `ConfirmOrder` offline fields live in this service's `docs/` folder (**`offline-accounts.md`**).

**Automatic stop-loss/take-profit brackets** (feature 030): whenever an auto-sized (`ComputePositionSize`) `MARKET`/`LIMIT` entry fills, `maybeSubmitBracket` opens a persisted bracket (`trading.order_brackets`) protecting it — Alpaca attaches the stop/take-profit atomically at entry `SubmitOrder`; IBKR submits them as a follow-up linked pair (`SubmitBracketLegs`, `isSingleGroup`+`parentId`) after the fill is confirmed, since IBKR's Client Portal Web API has no client-settable OCA group field. A per-account **protection-window watchdog** (`StartBracketProtectionWatchdog`, piggybacking on the fill-poller tick) flattens the position and halts the account (`trading.risk.max_unprotected_seconds`) if no bracket confirms in time; a broker-**rejected** flatten counts as a failure (a fresh client order id is minted only after a definitive rejection, never after a timeout/unknown outcome), and an exhausted retry budget always halts. The halt is **persisted** on `trading.broker_accounts` (`halted`/`halted_at`/`halt_reason`, boot-hydrated) and blocks `PlaceOrder`/`ReplaceOrder` — never `CancelOrder`, the operator's sole remaining manual de-risk tool.

**Caller identity is the `x-user-id` header (root PLAT-11)** on `PlaceOrder`, `CancelOrder`,
`ReplaceOrder` and `ConfirmOrder`; their body `user_id` is deprecated and ignored. For `PlaceOrder` the order **owner** is the server-resolved account owner
(`accountEntry.userID` / the `recordOfflineOrder` `userID` param), not a client-claimed body field —
so it is correct for the internal bracket-flatten path too. **Ownership is enforced fail-closed on
the execution/mutation RPCs** (2026-09-16 security audit, C-1/C-2/H-2): `PlaceOrder` requires the
caller to own the resolved account (`accountEntry.userID`); `CancelOrder`/`ReplaceOrder`/`ConfirmOrder`
require the caller to own the order (`order.UserId`); `SnapshotOfflinePositions` requires the caller
to own the account (`rec.UserID`). Each returns `PermissionDenied` on a mismatch or a missing caller,
so a caller cannot place, cancel, replace, confirm, or snapshot on another user's account/order. The
internal bracket-flatten path is unaffected (it calls `submitOrder` directly, not `PlaceOrder`). The
warn-only `checkPortfolioRisk` gate also reads the header. When trading calls **`xstockstrat-portfolio`** (`ListPositions`/`GetPosition`) from a
background context with no inbound header (reconciliation, flatten), it injects `x-user-id` explicitly
via `metadata.AppendToOutgoingContext`. **Exception:** `ListOrders` and `StreamOrderUpdates` keep
their body `user_id` — there it is a **cross-user filter/subscription selector** (empty = all users,
for trusted internal callers), not the caller's own identity, so it is not deprecated.
`StreamOrderUpdates`' live broadcast (`broadcastOrder`) now delivers each order update **only** to
subscribers whose selector matches the order's owner (`orderSubscriber.userID`; empty = all users),
so a scoped subscriber never receives another user's live order updates (2026-09-16 security audit,
H-1) — the initial snapshot already applied this filter.

## Docker Build Pattern

Go pattern — see `docs/patterns/docker-build.md` for multi-stage builder, static binary compilation (`CGO_ENABLED=0`), and distroless final images.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig stream | Live config at startup |
| xstockstrat-ledger | gRPC write | Emit order lifecycle events |
| xstockstrat-portfolio | gRPC read | Check position/buying power before order |
| xstockstrat-indicators | gRPC read | Validate signal before execution |
| xstockstrat-marketdata | gRPC read | ATR bars + current price for ComputePositionSize |
| xstockstrat-notify | gRPC write | Emit order fill/rejection alerts |
| TimescaleDB | DB (schema: `trading`) | Persist orders hypertable |

## Config Keys Consumed

Namespace `trading` (own keys, read through the `trading` watcher) and namespace `platform` (`trading_state`,
`maintenance_mode`, read through a **separate, required** single-namespace `platform` watcher: `NewTradingService`
errors on a nil one and boot exits if either snapshot misses the shared 90 s budget). Keys are listed and read as
namespace-relative; logs and errors may print the FQN (`platform.trading_state`).

| Key | Type | Default | Description |
|---|---|---|---|
| `approval.require_above_qty` | float | `500` | Orders above this qty require manual approval |
| `approval.require_above_notional` | float | `50000` | Orders above this USD notional require approval |
| `order.max_retries` | int | `3` | Max broker submission retries for the emergency-flatten order only (`flattenAndHalt`); `PlaceOrder` submits once |
| `order.retry_delay_ms` | int | `500` | Delay between `flattenAndHalt` retries |
| `risk.max_position_pct` | float | `0.05` | Max 5% of portfolio in single position — warn-only, covers only override-mode (explicit-qty) orders; auto-sized orders are covered by the new enforcing `risk.max_concentration_pct` below |
| `risk.max_risk_per_trade_pct` | float | `0.02` | Fraction of equity to risk per trade for auto-sized orders |
| `risk.atr_multiplier` | float | `1.5` | Stop distance as a multiple of ATR(14) |
| `risk.max_concentration_pct` | float | `0.10` | Max fraction of equity in any single auto-sized position — enforcing, unlike the warn-only `max_position_pct` above |
| `risk.sizing_enabled` | bool | `true` | Master gate for `ComputePositionSize`; `false` rejects any order submitted without an explicit `qty` |
| `broker.paper` | bool | `true` | Route orders to paper API when true; live API when false. Also the source of truth for the mode new broker accounts are registered in. |
| `broker.timeout_ms` | int | `5000` | Alpaca broker HTTP call timeout. Read at account-client construction and applied as the broker HTTP client's `Timeout`. |
| `ibkr.lst_refresh_margin_ms` | int | `60000` | Refresh an IBKR account's cached live session token (LST) this long before its `live_session_token_expiration`. Read live per handshake; `<= 0` reads as the default. |
| `ibkr.handshake_timeout_ms` | int | `10000` | Detached bound on one IBKR LST + `ssodh/init` handshake. Read live per handshake; `<= 0` reads as the default. Independent of `IBKRRequestTimeout`. |
| `ibkr.reauth_min_interval_ms` | int | `30000` | IBKR negative-cache and 401-invalidation throttle: at most one LST request per interval per account with bad credentials. Read live per handshake; `<= 0` reads as the default. |
| `credential_health.interval_ms` | int | `300000` | Interval for the background poller that re-validates each broker account's API secrets. Read live on every cycle; set to `0` (or negative) to disable/pause the poller without a restart. |
| `fill_poller.interval_ms` | float | `5000` | Interval for the order-fill reconciliation poller (`pollFills`). Read live on every cycle. |
| `position_sync.interval_ms` | float | `300000` | Interval for the broker position/balance sync poller (`syncPositions`). Read live on every cycle. |
| `order_intent.stale_multiplier` | float | `3.0` | Multiplier applied to `max(live trading.broker.timeout_ms, IBKRRequestTimeout)` to derive the PENDING-intent staleness threshold; read live, floor-clamped in code to ≥1.5 so a misconfigured multiplier can never push the threshold below the live broker timeout. |
| `order_intent.sweep_interval_ms` | int | `5000` | Interval for `StartOrderIntentSweeper`, the proactive reclaim loop that transitions orphaned `PENDING` intents to `UNKNOWN` after an unattended crash (no retry needed). Matches `fill_poller.interval_ms`'s existing default. |
| `risk.bracket_orders_enabled` | bool | `true` (all environments) | Master gate for automatic stop-loss/take-profit bracket orders on auto-sized entries. Production was seeded `false` (pending feature 103) by feature 030, but the pre-189 config bug meant the getter always returned its code default `true`, so production actually ran with brackets ON; feature 189 (migration 029) bumped the production seed to `true` to preserve that behavior once config resolution was fixed (operator sign-off, feature 189 context.md). |
| `risk.take_profit_rr_multiple` | float | `2.0` | Reward-to-risk multiple for the take-profit leg; `0` disables the take-profit leg (stop-loss only) |
| `risk.max_unprotected_seconds` | int | `30` | Provisional default — max seconds an auto-sized position may go without a confirmed bracket before an automatic flatten+halt |
| `reconciliation.interval_ms` | float | `60000` | Interval for the broker-state-reconciliation poller (`reconcileTick`). Read live on every cycle. |
| `reconciliation.grace_ticks` | int | `1` | Consecutive ticks a mismatch must persist before it's a real finding (not a benign propagation delay). |
| `reconciliation.systemic_threshold_pct` | float | `0.5` | Share of accounts erroring/unprotected in one tick that escalates to `trading_state=REDUCE_ONLY` (namespace `platform`). |
| `reconciliation.halted_poll_interval_ms` | float | `300000` (5 min) | Cooldown between `reconcileTick` broker polls (`ListOrders`/`GetPositions`) for an **already-halted** account — slower than the ordinary `interval_ms` cadence, since a halted account can't place new orders regardless (`isAccountHalted` gates `PlaceOrder`/`ReplaceOrder`) and only needs occasional re-observation to notice broker-side drift (e.g. a manual dashboard order). Read live on every cycle; `<= 0` disables the throttle (polls every tick, matching `interval_ms`'s own convention). |
| **Namespace `platform`** (separate watcher) | | | |
| `maintenance_mode` | bool | `false` | Platform-wide halt (the real halt key; there is no `trading.maintenance_mode`) |
| `trading_state` | string | `ACTIVE` | Richer halt state (`ACTIVE`/`REDUCE_ONLY`/`HALTED`), independent of `maintenance_mode`. `HALTED` blocks `PlaceOrder`/`ReplaceOrder`; `REDUCE_ONLY` blocks only exposure-increasing orders (verified via an account-scoped `PortfolioService.GetPosition` for `PlaceOrder`, a local qty comparison for `ReplaceOrder`). `CancelOrder` is deliberately ungated. Unrecognized/unset values fail closed to `HALTED`. Seeded by `config` migration 011 (feature 100); the former per-`trading_mode` seeding was collapsed to one row per environment by feature 147 (`config` migration 017 dropped the `trading_mode` column). |

`broker.timeout_ms` also bounds each broker REST call made by `syncPositions` (an explicit
per-call `context` deadline, matching the credential-health poller), so a black-holed connection can
never wedge the sync loop. Likewise every ledger `AppendEvent` is bounded (`ledgerEmitTimeout`, 10s).

## Database

- Schema: `trading`
- Hypertable: `trading.orders` (partition: `created_at`, chunk: 1 day)
- `trading.order_brackets` — the per-order bracket (stop-loss/take-profit) state machine (feature 030): `NONE→SUBMITTING→PENDING_VERIFY→ACTIVE→CANCELING→CANCELED`, with a `FAILED` terminal on any submission error. Plain indexed `order_id` column (no FK — `trading.orders`' composite hypertable PK has no single-column FK target, matching this service's existing avoidance of cross-hypertable FKs).
- `trading.offline_snapshot_headers` — one header per offline snapshot (feature 240). The carry is computed atomically with the snapshot write and frozen: a re-submit with the same id and `as_of` keeps it, an `as_of` change on a non-latest snapshot is `FAILED_PRECONDITION`, and an all-rejected re-submit commits nothing. Migration `011` also adds `trading.orders.fees` (`NUMERIC`, NULL for broker orders).
- `trading.offline_position_baselines` — effective-dated brokerage-statement baseline rows per offline account (feature 163). The effective baseline for an account is the rows of its latest snapshot header (greatest `as_of`, then `created_at`; a header with no rows is a full flatten); a re-submitted snapshot replaces its own rows atomically (DELETE + INSERT in the same tx as its header). Only offline accounts may have baselines.

## Approval Flow

Orders requiring approval (above configured thresholds) are placed in `ORDER_STATUS_PENDING_APPROVAL` state and emit an alert via xstockstrat-notify. They never reach the broker: no Approve RPC or approval path exists yet, so `PENDING_APPROVAL` is currently terminal.

## Ledger Events Emitted

| Event Type | Stream Key | Trigger |
|---|---|---|
| `order.created` | `{order_id}` | New order placed |
| `order.submitted` | `{order_id}` | Order sent to broker |
| `order.filled` | `{order_id}` | Order fully filled |
| `order.partially_filled` | `{order_id}` | Partial fill received |
| `order.canceled` | `{order_id}` | Order canceled |
| `order.replaced` | `{order_id}` | Working order modified via `ReplaceOrder` (qty/price/TIF) |
| `order.rejected` | `{order_id}` | Broker rejected order |
| `order.approval_requested` | `{order_id}` | Approval required |
| `order.approved` | `approval:{order_id}` | **Documented, not yet implemented** — intended manual-approval grant event; no emit site / Approve RPC exists yet |
| `order.broker_submitted` | `{order_id}` | Order accepted by Alpaca broker |
| `order.broker_rejected` | `{order_id}` | Alpaca broker rejected the order |
| `account.positions.synced` | `account:{account_id}` | Periodic broker position snapshot (poller), or an offline recompute — which alone also carries `realized_pnl`, `fees_since_snapshot`, `realized_carried`, `fees_carried` and `recent_fills` (fills of the last 10 calendar days, a fixed window covering the longest NYSE gap; feature 240); carries `user_id` + `account_id`, each position's broker mark-to-market valuation (`current_price`/`market_value`/`unrealized_pl`/`unrealized_plpc`), and its intraday/today's P&L (`day_pnl`/`day_pnl_pct`, from Alpaca `unrealized_intraday_pl`/`unrealized_intraday_plpc`) |
| `account.balance.synced` | `account:{account_id}` | Periodic broker balance snapshot (poller): cash, buying power, equity, last_equity |
| `order.bracket_updated` | `{order_id}` | Bracket leg order IDs assigned/cleared (feature 030) — consumed by `xstockstrat-portfolio` to populate `Position.stop_order_id`/`take_profit_order_id` |
| `reconciliation.mismatch_found` | `account:{account_id}` | Non-propagation-delay mismatch found by the reconciliation poller (feature 102) |
| `order_intent.resolved_by_reconciliation` | `order:{order_id}` | A `101` `UNKNOWN` order intent resolved against broker truth by the reconciliation poller (feature 102) |
| `order_intent.reclaimed_unknown` | `order:{order_id}` | A stale PENDING order intent reclaimed to UNKNOWN. `trigger`: `sweep` (sweeper, `user_id` `""`), `reactive_place` (PlaceOrder retry, including the internal flatten retry, which carries no trace id and may carry `user_id` `""`), `reactive_cancel`, `reactive_replace` (owner `user_id`). Payload: `trigger`, `order_id`, `intent_id`, `was_pending_since` (RFC3339Nano string, the pre-reclaim pending time) |
| `account.halt.resumed` | `account:{account_id}` | Halt cleared by the admin-gated `ResumeAccount` RPC (`ResumeAccountSvc`): `reason`, `operator`, `prior_halt_reason`, `prior_halt_source` |
| `order_intent.late_response_conflict` | `order:{order_id}` | **Read, not emitted** — `resolveUnknownIntents` queries it before broker reconciliation; no emit site exists yet |
| `account.positions.baseline_set` | `account:{account_id}` | Offline position baseline recorded (feature 163) — emitted after a `SnapshotOfflinePositions` call replaces the prior baseline and re-folds the account's positions |

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
| `trail` | `trail` | *(not mapped — IBKR ignores)* |
| `time_in_force` | `time_in_force` | `tif` |

The IBKR **netting-mode** assumption documented in *Known Limitations* applies to replace as
well: a replaced quantity is the new total order quantity (no hedged-mode lot semantics).

## Order Status Reconciliation

`pollFills` status mapping (unrecognized statuses → `UNSPECIFIED`, skipped; `done_for_day` is non-terminal) → this service's `docs/` folder (**`reconciliation.md`**).

## Broker State Reconciliation

`reconcileTick` (feature 102/206): DB-grounded mismatch classification, per-account halt, systemic `REDUCE_ONLY` escalation → this service's `docs/` folder (**`reconciliation.md`**).

## Position & Balance Sync Observability

Position-sync heartbeat/watchdog, `loop tick ok` loops, instruments and load-bearing logs (feature 294) → this service's `docs/` folder (**`reconciliation.md`**).

## Environment Variables

> mTLS: requires `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` (fail-closed) — see root CLAUDE.md § Environment Variable Naming Convention.

```text
# GRPC_PORT and the *_ENDPOINT vars: see docker-compose.yml / internal/config/config.go
TRADING_MODE=paper                     # paper | live
BROKER_ACCOUNTS_ENCRYPTION_KEY=<hex>  # hex-encoded 32-byte AES-256 key; required when broker_accounts table is in use. Generate: openssl rand -hex 32
```

## Known Limitations

**IBKR Hedged Mode is not supported** — the integration assumes netting mode. The P&L cost-basis caveat for interleaved fills and the steps to add support are in this service's `docs/` folder (**`ibkr.md`**).
