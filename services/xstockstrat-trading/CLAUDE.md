# xstockstrat-trading — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (the Connect+gRPC adapter twin, enum→string/0→NULL persistence, broker credential sentinel) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects/doc-drift (dead retry config, IBKR timeout oversight) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Go gRPC service responsible for order execution and trade lifecycle management. Submits orders to Alpaca's broker REST API (paper or live). Writes all order events to xstockstrat-ledger.

**Alpaca API ownership**: `xstockstrat-trading` is the sole integration point for Alpaca's **broker/order APIs** (`/v2/orders`, `/v2/account`). `xstockstrat-marketdata` owns Alpaca's **market data APIs** — these are separate API surfaces and separate responsibilities.

**Paper vs live**: Mode is resolved per order from the account's persisted `is_paper` / the `trading.broker.paper` live config, falling back to the `TRADING_MODE` env var (there is **no** `ALPACA_PAPER` env var — no code reads one). Paper routes to `https://paper-api.alpaca.markets`; live routes to `https://api.alpaca.markets`.

**Order types & trailing stops**: `PlaceOrder` supports `market`/`limit`/`stop`/`stop_limit`/`trailing_stop`. A `trailing_stop` order requires **exactly one** of `PlaceOrderRequest.trail_price` / `trail_percent` (sent to Alpaca as `trail_price`/`trail_percent`); any other order type must leave both zero — both rules are validated up front with `InvalidArgument` so a bad request never reaches the broker as a 422. `ReplaceOrder.trail` updates a working trailing stop (Alpaca's PATCH body uses a single `trail`).

**Idempotency**: `PlaceOrder` forwards the internally-minted order ID as Alpaca's `client_order_id`, so a retried submission (`trading.order.max_retries`) is de-duplicated by the broker instead of placing a second order.

**Automatic position sizing**: `ComputePositionSize` triggers whenever `PlaceOrder` receives `qty <= 0` (FR-5) — an explicit `qty` bypasses it entirely (override mode). It sizes from account equity (`ListPortfolios`, not `GetPortfolio` — see the Config Keys table's `risk.max_concentration_pct` row), a Wilder ATR(14)-derived stop distance (`xstockstrat-marketdata` `GetBars`), the request's `confidence` (0.0–1.0, defaults to 1.0 when unset), and a portfolio concentration cap. **Fail-closed**, unlike the pre-existing warn-only `checkPortfolioRisk` below: missing/insufficient equity, bar history, or quote data aborts the order rather than sizing to a fallback value. `trading.risk.sizing_enabled=false` rejects any order submitted without an explicit `qty` instead of silently bypassing sizing.

**Broker account registration mode is environment-owned**: `RegisterBrokerAccount` ignores the (deprecated) `is_paper` request field and derives the account's mode from the environment (`trading.broker.paper` config / `TRADING_MODE` env), so users cannot register an account in a mode the deployment does not run. The UI reads `GetTradingEnvironment` to display the fixed mode instead of offering a paper/live choice.

**Credential health**: every registered account's API secrets are validated against the broker (Alpaca `GET /v2/account`, IBKR `GET /portfolio/accounts`) on register, on credential update (`UpdateBrokerAccountCredentials`), and periodically by a background poller. The latest `CredentialStatus` (OK / INVALID / UNKNOWN) is persisted on `trading.broker_accounts` and returned by `ListBrokerAccounts` so the UI can surface accounts whose secrets stopped working.

**Automatic stop-loss/take-profit brackets** (feature 030): whenever an auto-sized (`ComputePositionSize`) `MARKET`/`LIMIT` entry fills, `maybeSubmitBracket` opens a persisted bracket (`trading.order_brackets`) protecting it — Alpaca attaches the stop/take-profit atomically at entry `SubmitOrder`; IBKR submits them as a follow-up linked pair (`SubmitBracketLegs`, `isSingleGroup`+`parentId`) after the fill is confirmed, since IBKR's Client Portal Web API has no client-settable OCA group field. A per-account **protection-window watchdog** (`StartBracketProtectionWatchdog`, piggybacking on the fill-poller tick) flattens the position and halts the account (`trading.risk.max_unprotected_seconds`) if no bracket confirms in time. The halt is **persisted** on `trading.broker_accounts` (`halted`/`halted_at`/`halt_reason`, boot-hydrated) and blocks `PlaceOrder`/`ReplaceOrder` — never `CancelOrder`, the operator's sole remaining manual de-risk tool. `trading.risk.bracket_orders_enabled` seeds `false` in production (pending feature 103 or a documented manual verification) — a deliberate override of the default `true`, see `docs/roadmap/features/030-stop-loss-bracket-orders/context.md` § Archive Synthesis (Rejected alternatives).

**Offline (manually-tracked) accounts** (feature 157, hardened by feature 159): a `BROKER_TYPE_OFFLINE` account has no broker client — its orders are recorded, not routed. `PlaceOrder` routes to `recordOfflineOrder` (persists `NEW`, empty `broker_order_id`, no broker submit) whenever **either** the in-memory pool tag **or** the **authoritative persisted** `broker_type` (`accountRepo.GetBrokerAccount`) is OFFLINE — a divergence-safe union, so an offline account can never fall through to a broker path even if its pool entry is stale (best-effort: a DB read error falls back to the pool tag). `CancelOrder` **rejects** an offline order with `FailedPrecondition` (offline orders are un-placed via `ConfirmOrder` edits, never a broker cancel) — this is an offline-**type** guard, orthogonal to the halt gating above: `CancelOrder` remains **never halt-gated** (the operator's manual de-risk tool for *broker* accounts).

**Caller identity comes from the `x-user-id` header, not the request body.** `PlaceOrder`,
`CancelOrder`, `ReplaceOrder`, and `ConfirmOrder` resolve the caller from the propagated
**`x-user-id`** header (`middleware.FromContext(ctx).UserID`); their request-body `user_id` field is
**deprecated and ignored**. For `PlaceOrder` the order **owner** is the server-resolved account owner
(`accountEntry.userID` / the `recordOfflineOrder` `userID` param), not a client-claimed body field —
so it is correct for the internal bracket-flatten path too, and a caller cannot place an order owned
by someone else. `ConfirmOrder`'s ownership guard and the warn-only `checkPortfolioRisk` gate both
read the header. When trading calls **`xstockstrat-portfolio`** (`ListPositions`/`GetPosition`) from a
background context with no inbound header (reconciliation, flatten), it injects `x-user-id` explicitly
via `metadata.AppendToOutgoingContext`. **Exception:** `ListOrders` and `StreamOrderUpdates` keep
their body `user_id` — there it is a **cross-user filter/subscription selector** (empty = all users),
not the caller's own identity, so it is not deprecated.

## Language

Go 1.27

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
| xstockstrat-marketdata | gRPC read | ATR bars + current price for ComputePositionSize |
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
| `trading.risk.max_position_pct` | float | `0.05` | Max 5% of portfolio in single position — warn-only, covers only override-mode (explicit-qty) orders; auto-sized orders are covered by the new enforcing `risk.max_concentration_pct` below |
| `trading.risk.daily_loss_limit` | float | `0.02` | **Documented, not yet implemented** — intended daily-loss halt; no code reads this key yet (see `docs/context-constitution-findings.md`). |
| `trading.risk.max_risk_per_trade_pct` | float | `0.02` | Fraction of equity to risk per trade for auto-sized orders |
| `trading.risk.atr_multiplier` | float | `1.5` | Stop distance as a multiple of ATR(14) |
| `trading.risk.max_concentration_pct` | float | `0.10` | Max fraction of equity in any single auto-sized position — enforcing, unlike the warn-only `max_position_pct` above |
| `trading.risk.sizing_enabled` | bool | `true` | Master gate for `ComputePositionSize`; `false` rejects any order submitted without an explicit `qty` |
| `platform.maintenance_mode` | bool | `false` | Platform-wide halt (the real halt key; there is no `trading.maintenance_mode`) |
| `platform.trading_state` | string | `ACTIVE` | Richer halt state (`ACTIVE`/`REDUCE_ONLY`/`HALTED`), independent of `platform.maintenance_mode`. `HALTED` blocks `PlaceOrder`/`ReplaceOrder`; `REDUCE_ONLY` blocks only exposure-increasing orders (verified via `PortfolioService.GetPosition` for `PlaceOrder`, a local qty comparison for `ReplaceOrder`). `CancelOrder` is deliberately ungated. Unrecognized/unset values fail closed to `HALTED`. Seeded by `config` migration 011 (feature 100); the former per-`trading_mode` seeding was collapsed to one row per environment by feature 147 (`config` migration 017 dropped the `trading_mode` column). |
| `trading.broker.paper` | bool | `true` | Route orders to paper API when true; live API when false. Also the source of truth for the mode new broker accounts are registered in. |
| `trading.broker.timeout_ms` | int | `5000` | Alpaca broker HTTP call timeout. Read at account-client construction and applied as the broker HTTP client's `Timeout`. |
| `trading.credential_health.interval_ms` | int | `300000` | Interval for the background poller that re-validates each broker account's API secrets. Read live on every cycle; set to `0` (or negative) to disable/pause the poller without a restart. |
| `trading.fill_poller.interval_ms` | float | `5000` | Interval for the order-fill reconciliation poller (`pollFills`). Read live on every cycle. |
| `trading.position_sync.interval_ms` | float | `300000` | Interval for the broker position/balance sync poller (`syncPositions`). Read live on every cycle. |
| `trading.order_intent.stale_multiplier` | float | `3.0` | Multiplier applied to `max(live trading.broker.timeout_ms, IBKRRequestTimeout)` to derive the PENDING-intent staleness threshold; read live, floor-clamped in code to ≥1.5 so a misconfigured multiplier can never push the threshold below the live broker timeout. |
| `trading.order_intent.sweep_interval_ms` | int | `5000` | Interval for `StartOrderIntentSweeper`, the proactive reclaim loop that transitions orphaned `PENDING` intents to `UNKNOWN` after an unattended crash (no retry needed). Matches `trading.fill_poller.interval_ms`'s existing default. |
| `trading.risk.bracket_orders_enabled` | bool | `true` dev/staging, **`false` production** | Master gate for automatic stop-loss/take-profit bracket orders on auto-sized entries; `false` in production pending feature 103 (broker-failure-simulator) or a documented manual paper verification |
| `trading.risk.take_profit_rr_multiple` | float | `2.0` | Reward-to-risk multiple for the take-profit leg; `0` disables the take-profit leg (stop-loss only) |
| `trading.risk.max_unprotected_seconds` | int | `30` | Provisional default — max seconds an auto-sized position may go without a confirmed bracket before an automatic flatten+halt |
| `trading.reconciliation.interval_ms` | float | `60000` | Interval for the broker-state-reconciliation poller (`reconcileTick`). Read live on every cycle. |
| `trading.reconciliation.grace_ticks` | int | `1` | Consecutive ticks a mismatch must persist before it's a real finding (not a benign propagation delay). |
| `trading.reconciliation.systemic_threshold_pct` | float | `0.5` | Share of accounts erroring/unprotected in one tick that escalates to `platform.trading_state=REDUCE_ONLY`. |
| `trading.reconciliation.halted_poll_interval_ms` | float | `300000` (5 min) | Cooldown between `reconcileTick` broker polls (`ListOrders`/`GetPositions`) for an **already-halted** account — slower than the ordinary `interval_ms` cadence, since a halted account can't place new orders regardless (`isAccountHalted` gates `PlaceOrder`/`ReplaceOrder`) and only needs occasional re-observation to notice broker-side drift (e.g. a manual dashboard order). Read live on every cycle; `<= 0` disables the throttle (polls every tick, matching `interval_ms`'s own convention). |

`trading.broker.timeout_ms` also bounds each broker REST call made by `syncPositions` (an explicit
per-call `context` deadline, matching the credential-health poller), so a black-holed connection can
never wedge the sync loop. Likewise every ledger `AppendEvent` is bounded (`ledgerEmitTimeout`, 10s).

## Database

- Schema: `trading`
- Hypertable: `trading.orders` (partition: `created_at`, chunk: 1 day)
- `trading.order_brackets` — the per-order bracket (stop-loss/take-profit) state machine (feature 030): `NONE→SUBMITTING→PENDING_VERIFY→ACTIVE→CANCELING→CANCELED`, with a `FAILED` terminal on any submission error. Plain indexed `order_id` column (no FK — `trading.orders`' composite hypertable PK has no single-column FK target, matching this service's existing avoidance of cross-hypertable FKs).
- `trading.offline_position_baselines` — effective-dated brokerage-statement baseline rows per offline account (feature 163, migration `009`). Each row is `(account_id, symbol, qty, avg_cost_per_share, as_of, client_snapshot_id, created_at)`. The effective baseline for an account is the set of rows with the greatest `as_of`; a new snapshot replaces the prior baseline atomically (DELETE + INSERT in tx). Only offline accounts may have baselines.
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
| `order.approved` | `approval:{order_id}` | **Documented, not yet implemented** — intended manual-approval grant event; no emit site / Approve RPC exists yet |
| `order.broker_submitted` | `order:{order_id}` | Order accepted by Alpaca broker |
| `order.broker_rejected` | `order:{order_id}` | Alpaca broker rejected the order |
| `account.positions.synced` | `account:{account_id}` | Periodic broker position snapshot (poller); carries `user_id` + `account_id`, each position's broker mark-to-market valuation (`current_price`/`market_value`/`unrealized_pl`/`unrealized_plpc`), and its intraday/today's P&L (`day_pnl`/`day_pnl_pct`, from Alpaca `unrealized_intraday_pl`/`unrealized_intraday_plpc`) |
| `account.balance.synced` | `account:{account_id}` | Periodic broker balance snapshot (poller): cash, buying power, equity, last_equity |
| `order.bracket_updated` | `order:{order_id}` | Bracket leg order IDs assigned/cleared (feature 030) — consumed by `xstockstrat-portfolio` to populate `Position.stop_order_id`/`take_profit_order_id` |
| `reconciliation.mismatch_found` | `account:{account_id}` | Non-propagation-delay mismatch found by the reconciliation poller (feature 102) |
| `order_intent.resolved_by_reconciliation` | `order:{order_id}` | A `101` `UNKNOWN` order intent resolved against broker truth by the reconciliation poller (feature 102) |
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

The fill poller (`pollFills`) calls `GetOrder` for every non-terminal order and maps the broker
status via `alpacaStatusToProto`. Terminal statuses (`FILLED`/`CANCELED`/`EXPIRED`/`REJECTED`)
stop reconciliation for that order. **Transient or unrecognized broker statuses map to
`ORDER_STATUS_UNSPECIFIED` and are skipped** — they never overwrite the order's current status,
so reconciliation continues until a real terminal status arrives. In particular, Alpaca's
**`done_for_day`** is non-terminal: it is reported for a `day` order at market close before the
order settles to its true terminal state (`expired` or `filled`). It must **not** map to
`CANCELED` — doing so previously froze the order in a wrong terminal state, after which the poller
stopped and never captured the eventual `expired` (UI showed CANCELED while the broker showed
expired).

## Broker State Reconciliation

`StartReconciliationPoller`/`reconcileTick` (feature 102) periodically compares open orders and
positions against broker truth via `Broker.ListOrders()`/`GetPositions()`, independent of the
fill poller — it is the only path that detects an order placed directly through the broker's own
dashboard, regardless of fill state. A candidate mismatch (unknown broker order, quantity
discrepancy, or missing broker order) must persist across `1 + trading.reconciliation.grace_ticks`
consecutive ticks before it becomes a real finding — a routine partial fill or propagation delay
resolves on its own with no ledger event and no halt (self-heal). A real finding emits
`reconciliation.mismatch_found`, a CRITICAL alert, and routes to the **ordinary, per-account**
halt (`HaltSource_HALT_SOURCE_RECONCILIATION`, reusing feature 030's `broker_accounts.halted`
mechanism).

The `unknown_broker_order` classification is **DB-grounded, not memory-only**. A broker order the
in-memory map (`s.orders`) doesn't recognize is not immediately foreign: `s.orders` holds only this
process's own orders plus `LoadInflightOrders`' NEW/PARTIALLY_FILLED hydrate, so a legitimate order
the platform placed that has since reached a terminal state (FILLED/CANCELED/EXPIRED/REJECTED) is
absent from memory yet still persisted in `trading.orders`. Before flagging any unmatched broker
order, `reconcileTick` calls `reconcileOrderLookup.KnownBrokerOrderIDs` (one DB round-trip per tick,
scoped to the account's unmatched IDs) — only an order the platform has **no persisted record of at
all** is a genuine `unknown_broker_order`. Comparing against memory alone previously misclassified
every historical terminal order the platform itself placed as foreign, halting the account on a
routine restart; that was an observed production false halt. A transient DB lookup error is
**fail-safe**: the account's unknown-order check is skipped for that tick (re-evaluated next tick),
never a false halt. `emitReconciliationFinding`/`haltAccount` still no-op once the account is
already halted (any source) — defense-in-depth so any residual re-observation of the same order
can't re-fire the ledger event, CRITICAL alert, and ERROR log every tick; nothing in this service
ever clears a halt (resuming is a manual DB edit), so a later finding against an already-halted
account changes no trading behavior.
`reconcileTick` itself also throttles the broker calls (`ListOrders`/`GetPositions`) for an
already-halted account to `trading.reconciliation.halted_poll_interval_ms` (default 5 min) instead
of the ordinary `interval_ms` cadence (`shouldPollHaltedAccount`) — still eventually observing the
account (e.g. a manual broker-dashboard order), just not at full rate for one that already can't
trade. Only a **rare, systemic** finding — `trading.reconciliation.systemic_threshold_pct`
or more of registered accounts erroring/unreachable in one tick — escalates platform-wide to
`platform.trading_state=REDUCE_ONLY` via `xstockstrat-config`'s internal-caller authz channel
(`x-internal-caller`, distinct from the human-role `x-access-scope` header; see
`services/xstockstrat-config/CLAUDE.md`). The same tick also resolves feature 101's `UNKNOWN`
order intents against broker truth (FR-6) — a ledger `order_intent.late_response_conflict` event
first (not yet emitted by 101 today, see the code comment on `resolveUnknownIntents`), falling
back to a broker-side scan by the derived client-order-id nonce for **Alpaca accounts only** (IBKR
never sends a customer-order tag on submission, so its `ListOrders` results never carry one to
match against) — a genuinely inconclusive intent is retried next tick, never guessed.

## Position & Balance Sync Observability

The position-sync poller (`syncPositions`) emits no events on a quiet cycle, which previously made a
silent stall (every account skipped for invalid credentials, or a wedged broker/ledger call)
indistinguishable from a healthy idle service — zero log output for days. The poller now:

- Logs a per-cycle **heartbeat** at INFO: `position sync cycle complete accounts_synced=N accounts_skipped=M accounts_failed=K`.
- Runs a **watchdog**: WARNs `position sync stalled` when accounts are registered but none have synced for >3 intervals.
- WARNs (throttled to once per 15 min/account) when an account is **skipped for invalid credentials**, instead of a DEBUG line invisible at INFO.
- Logs broker **credential status transitions** (OK→INVALID at WARN; recoveries/first-observations at INFO) from the credential-health poller, so a credential that stops working is visible in logs, not only in the UI.

## Environment Variables

```text
GRPC_PORT=50051
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052
INDICATORS_ENDPOINT=xstockstrat-indicators:50054
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
NOTIFY_ENDPOINT=xstockstrat-notify:50059
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

**IBKR Hedged Mode is not supported** — the integration assumes netting mode. The P&L cost-basis caveat for interleaved fills and the steps to add support are in this service's `docs/` folder (**`ibkr.md`**).
