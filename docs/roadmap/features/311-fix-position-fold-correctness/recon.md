# Recon: fix-position-fold-correctness

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: detached origin/main-dev@c4fd48b0 (no `feature/fix-position-fold-correctness` branch on origin yet). The discovery digests were UNSTAMPED; the orchestrator re-grepped every cited site below at this commit.
**Affected services**: xstockstrat-portfolio, xstockstrat-trading (consumer surfaces read the folded rows: xstockstrat-ui `/trader` positions and P&L, xstockstrat-agent `get_positions`)

---

## Objective

The portfolio live fold of `order.filled` applies fills more than once, with the wrong sign, and never sees bracket exits. It applies them more than once because the in-memory cursor replays history on every boot and position writes are serialized only in-process. It gets the sign wrong because sells are unsigned and folded as buys. It misses bracket exits because no trading poller observes leg fills. This feature makes the fold exactly-once, signed and complete. Exactly-once is backed by a DB guard (portfolio migration `019`). Concurrency control moves to the row level. Trading emits ledger fill events for bracket stop and take-profit legs, so both the live fold and `GetPnL` realized include the exit.

## Codebase Map

- **`xstockstrat-portfolio`** (Go)
  - Consumer entry: `ConsumeOrderFills` — `services/xstockstrat-portfolio/internal/service/portfolio_service.go:176`. Handler type `eventHandler` is at `:182`.
  - Stream plumbing:
    - `consumeEventStream` (`:260`) holds an in-memory `var lastSeq int64` (`:261`).
    - `streamEventsFrom` (`:305`) resumes at `lastSeq+1` only when `lastSeq > 0`, so every boot replays from 0.
  - Fold handler: `processOrderFill` — `:373`.
    - It takes `positionsMu.Lock()` at `:396` and unlocks manually at `:400`/`:483` so quote-calling paths run unlocked.
    - Unsigned add: `newQty = existing.Qty + fill.Qty` (`:419`), then `if fill.Qty > 0 { // buying more` (`:420`).
    - Realized: `pnl.RealizedDelta(existing.Qty, existing.CostBasis, fill.Qty, fill.FillPrice)` (`:442`). It is 0 for an unsigned sell.
    - Empty `account_id` falls back to `"alpaca-default"` (`:435`).
    - Close branch `if newQty <= 0` (`:445-467`, per digest): reads `GetRealizedAccum`/`GetFeesAccum`, calls `ClosePosition`, then emits `portfolio.position.closed` via `closedPositionPayload`. A negative qty is treated as closed; there is no flip or short handling.
  - Payload struct `orderFillPayload` (`:353-369`, per digest).
    - `Qty` (`json:"qty"`, the total for `order.filled`).
    - `FilledQty` (`json:"filled_qty"`, cumulative for `order.partially_filled`).
    - `Side` (`json:"side"`, `:362`, "absent on pre-feature-251 events").
    - `Fees`.
  - Mutex: `positionsMu sync.Mutex` (`:61`, comment at `:59`). Other lock sites are `processAccountDeregistered` (`:1540`, locks at `:1560`) and `processPositionSync` (`:1589`, locks at `:1607`). `services/xstockstrat-portfolio/CLAUDE.md:127` says it is "correct only while portfolio runs `instance_count: 1`".
  - Retry and park: `boundedRetry` (`:1500`, doc comment at `:1498`). It withholds the cursor until the event parks ("event parked", `:1532`). Its state is unlocked because there is one goroutine per consumer. Wrapped consumers: position sync `:1440` and account deregistration `:1452`. Bounds are at `:1455`.
  - Emit:
    - `emitEvent` (`:1337`) → `emitEventAs` (`:1342`). It sets `IdempotencyKey: uuid.NewString()` (`:1356`), which is stable across retries of one emit and fresh per call.
    - A replayed fill that re-emits `portfolio.position.closed` therefore gets a new key, so the ledger does not dedup it.
  - Side lookup (feature 251): `orderSide(ctx, orderID)` — `:1077`. It tries `order.created`, then `order.submitted`, by `StreamKey: orderID` and trading's source service. It caches in `s.sideCache`. Its errors are `ErrFillUnattributable` and a wrapped `ErrLedgerUnavailable`. Today only `GetPnL` uses it.
  - Repo: `PortfolioRepo{pool; db queryRower}` (`internal/repository/portfolio_repo.go:29-34`, per digest).
    - The `queryRower` interface (`:22-26`) has only `QueryRow`, `Query` and `Exec`. It has **no `Begin`**.
    - `NewPortfolioRepoWithDB(db queryRower)` (`:49`) is the pgxmock seam; there `Pool()` is nil.
    - Additive upsert (`:61-69`): `realized_accum = portfolio.positions.realized_accum + $8`, `fees_accum = … + $9`, `ON CONFLICT (user_id, symbol, trading_mode, account_id)`.
    - `UpsertPositionFromSync` is at `:319`. `GetPosition` and `GetRealizedAccum` are separate non-transactional reads.
  - Pool: `internal/repository/pool.go:29-31`. With `DB_PGBOUNCER` set (prod `:25061`, transaction pooling) it runs exec mode with no named prepared statements. A session-level advisory lock is unsafe there; only `pg_advisory_xact_lock` inside a tx is safe.
  - Last migration: `018_watchlist_signal_expiry.up.sql` (`services/xstockstrat-portfolio/migrations/`). Prior art: `010_positions_realized_accum`, `012_offline_account_realized`, `014_positions_fees_accum`.
  - Config-read pattern: n/a. The feature adds no config key.
  - Deploy: `.do/app.yaml:99` (`name: xstockstrat-portfolio`), `instance_count: 1` at `:107`.
- **`xstockstrat-trading`** (Go)
  - Poller: `StartFillPoller` (`services/xstockstrat-trading/internal/service/trading.go:1749`) → `pollFills` (`:1772`).
    - It builds candidates only from in-memory `s.orders` (`for _, o := range s.orders`, `:1788`), skipping an empty `BrokerOrderId` and terminal statuses.
    - It calls `entry.client.GetOrder(ctx, order.BrokerOrderId)` and resolves the broker via `brokerMap[order.AccountId]`, with a sole-account fallback (`:1805-1829`, per digest).
  - Single fill-emission path: `applyBrokerOrderStatus` (`:1852`). It is also used by `CancelOrder`'s not-cancelable reconcile.
    - No-op guard: status unchanged and `FilledQty` unchanged (`:1861`, per digest).
    - FILLED: `go s.emitLedgerEvent(context.WithoutCancel(ctx), "order.filled", order.OrderId, order.UserId, filledPayload)` (`:1896`). Payload keys: `order_id, symbol, qty` (= `order.Qty`, the total), `fill_price, user_id, trading_mode, account_id, fees`, and `side` when set (`:1885-1895`).
    - PARTIALLY_FILLED: `"order.partially_filled"` (`:1917`), with cumulative `filled_qty`.
    - Both branches call `maybeSubmitBracket` (`:1903`, `:1921` read `risk.bracket_orders_enabled`). They also run `updateOrder`/`UpsertOrder`, which assume a tracked order. Reusing this path for a leg would re-trigger bracket submission.
  - Bracket lifecycle:
    - `maybeSubmitBracket` (`:3521`) → `createBracket` (`:3553`).
    - Alpaca records the atomic leg ids from `brokerOrder.StopLegOrderID`/`TakeProfitLegOrderID` (`:3571`, per digest).
    - IBKR calls `SubmitBracketLegs` (`:3577`) with `Side: oppositeSide(order.Side), Qty: order.FilledQty` (`:3578`).
    - `resizeBracket` (`:3598`, resubmits at `:3619-3620`).
    - `oppositeSide` is at `:3463`.
    - `StartBracketProtectionWatchdog` is at `:3020`.
  - Emit: `emitLedgerEvent` (`:3879`) → `appendLedgerEvent` (`:3836`). It sets `IdempotencyKey: uuid.NewString()` (`:3848`) per emit and logs WARN on failure.
  - Bracket repo: `internal/repository/bracket_repo.go`.
    - `OrderBracketRecord` (`:14`, leg fields `StopLegOrderID`/`TakeProfitLegOrderID` at `:22-23`).
    - `BracketRepository` (`:30-38`): `CreateBracket`, `GetBracketByOrderID`, `UpdateBracketStatus`, `ReArmProtection`, `ListExpiredProtection`. It has **no list-active-brackets method**.
    - DDL is in `migrations/005_broker_accounts_halted.up.sql:12`.
  - Leg-id lookup precedent: `TradingRepo.KnownBrokerOrderIDs` (`internal/repository/trading_repo.go:130`, UNION over `stop_leg_order_id` at `:141-144`). Reconciliation ground truth: `NetFilledQtyBySymbol` (`:171`), summed over `trading.orders` only.
  - Broker interface: `internal/broker/broker.go:72` `SubmitBracketLegs` (per digest). Alpaca returns "not supported" (`alpaca.go:548`). IBKR is at `ibkr.go:303`.
  - Last migration: `011_offline_fees_snapshot_headers.up.sql`. The next free is `012`, needed only if the leg poller requires a schema change.
  - Config-read pattern: `s.cfgW.GetBool("risk.bracket_orders_enabled", true)` (`trading.go:725,790,1903,1921`); `fill_poller.interval_ms` (default 5000) is read live.
- **Shared fold**: `packages/proto/pnl/pnl.go`.
  - `RealizedDelta` (`:10`).
  - `Fill.Qty` "signed: positive = buy, negative = sell" (`:26`).
  - `Lot.Qty` is signed (`:32`).
  - `QtyEpsilon = 1e-9` (`:43`).
  - `Fold` (`:48`) and `FoldFrom(baseline, fills)` (`:54`) handle flips (`:80-92`).
  - The package is hand-written; its tests live in consuming services.
- **Ledger** (not modified): `services/xstockstrat-ledger/migrations/001_ledger_events_hypertable.up.sql:12,22` (`event_id UUID`, PK `(event_id, recorded_at)`) and `002_idempotency_keys.up.sql` (caller-key dedup map). `LedgerEvent.event_id` is a stable per-event identity that a portfolio applied-event key can use.

## Patterns to REUSE

- Signed fold math → reuse `pnl.FoldFrom` / `pnl.RealizedDelta` (`packages/proto/pnl/pnl.go:10,54`) with `Fill.Qty` signed from `fill.Side`. Do not hand-roll another add-or-reduce branch. Note that `portfolio_helpers_test.go:23-36` `computeNewPosition` is a test-local copy of the buggy logic and should be retired or re-pointed.
- Side resolution for pre-251 events (OQ-3) → reuse `PortfolioService.orderSide` (`portfolio_service.go:1077`) and its `ErrFillUnattributable`/`ErrLedgerUnavailable` classification, from payload `side` first.
- Retry and park → keep the `boundedRetry` + `classifyConsumerErr` semantics (`:1498-1532`). A persisted cursor or applied-event key must be written atomically with the position write, and never on a handler error, so withhold-until-park still holds.
- Emit dedup → the ledger `AppendEvent` idempotency key (`emitEventAs` `:1356`; `002_idempotency_keys`). A deterministic key derived from the source fill `event_id` would make a re-run `portfolio.position.closed` emit idempotent. The current key is a fresh `uuid.NewString()`.
- PgBouncer-safe SQL → `pool.go:29-31` exec mode. Use a tx-scoped `pg_advisory_xact_lock`, never a session lock. Bind JSON as `string`, not `[]byte` (`portfolio_repo.go:483`; fails.md 2026-09-01 / 142).
- Leg emission → `emitLedgerEvent` (`trading.go:3879`) with the entry-fill payload key set (`:1885-1895`).
  - `side = oppositeSide(parent.Side)` (`:3463`).
  - `account_id`, `trading_mode` and `user_id` come from the parent order.
  - `source_service` stays trading's canonical one.
- Leg-id-to-bracket lookup → model on `KnownBrokerOrderIDs`' UNION over `order_brackets` leg columns (`trading_repo.go:130-147`). It needs a new active-bracket listing on `BracketRepository`.
- Test scaffolds:
  - Portfolio: `portfolio_fill_errors_test.go` (`fillEvent` `:24`, `positionRow` `:51`, `newFillSvc` `:56` over pgxmock), `portfolio_sync_retry_test.go:78,85` (`lastSeq` assertions), and `portfolio_fill_sync_race_test.go` (two-writer race, fix `69c8554f`).
  - Trading: `trading_bracket_test.go` (`fakeBroker` `:26` with `getOrderFn`; `TestMaybeSubmitBracket_AlpacaAtomicRecordsLegs` `:224`; `_IBKRSubmitsFollowUpLegs` `:248`; `TestPollFills_PartialFillResizesActiveBracket` `:416`), `trading_fill_side_test.go:15`, and `trading_telemetry_test.go:594-620` (injected clock).
- DB-backed proof for AC-2 → `DB_PGBOUNCER=true` against any real Postgres satisfies the PgBouncer-mode repro without Docker (fails.md 2026-09-01 / 142; insights.md ~2566).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-10 @feature-029` "A per-fill fee flows through the fee-capture plumbing into the net win test" (`docs/sdd/business-rules/platform.feature`). The new sell-closes path (feature AC-3) must emit `portfolio.position.closed` with `fees_total` and a gross `realized_pnl`.
- **PRESERVE** `@AC-56 @feature-294` "…portfolio writes one record per batch" (`docs/sdd/business-rules/platform.feature`). `portfolio.consumer.events{consumer=order_fill,outcome=ok}` goes up by 4 for 4 events, with one "loop tick ok" per batch. How exactly-once skips are counted must not break this.
- **PRESERVE** `@AC-50 @feature-294` "Reconnect-log reduction applies to the indicators watcher and portfolio consumers too" (`docs/sdd/business-rules/platform.feature`). The 2 s retry and the GOAWAY log levels are unchanged by any cursor or resume change.
- **PRESERVE** `@AC-4 @feature-206` "An empty broker position snapshot does not delete order-fill-derived positions" (`services/xstockstrat-portfolio/acceptance/fix-reconciliation-false-halt.feature`).
- **PRESERVE** `@AC-1`..`@AC-5`, `@AC-10` `@feature-290` "A canceled context stops the position-sync loop…" (`services/xstockstrat-portfolio/acceptance/fix-ctx-cancel-warn-flood.feature`).
  - These cover cancel-stop, park and cursor-withhold.
  - They also cover **boot replay from 0 for the position-sync consumer**, which is the self-heal contract.
  - A persisted cursor scoped to the order-fill consumer is safe. Applying it to the sync, deregistration, bracket or balance consumers would be a **CHANGE** and needs sign-off in `context.md`.
- **PRESERVE** `@AC-1`, `@AC-2`, `@AC-4`, `@AC-5`, `@AC-11`, `@AC-14`, `@AC-15`, `@AC-16`, `@AC-17`, `@AC-18` `@feature-251` (`services/xstockstrat-portfolio/acceptance/fix-getpnl-source-service.feature`). These are the `GetPnL` rules: unsigned-sell folding by side lookup, cumulative partials, unresolvable side → FAILED_PRECONDITION, per-user, per-account, a mixed `account_id` group refused, sequence order, partial+full counted once using the `order.filled` total qty (AC-17), and mode isolation. Leg events must carry `side`, `account_id`, `trading_mode` and `user_id`.
- **PRESERVE** `@AC-6`..`@AC-9` `@feature-251` (same file). These cover `GetPnL` fail-closed on ledger error, deadline, replay detection and 501-fill paging.
- **PRESERVE** `@AC-3`, `@AC-4`, `@AC-6` `@feature-257` (`services/xstockstrat-portfolio/acceptance/fix-ledger-query-pagination.feature`). These cover exactly-once across pages, keeping the largest cumulative partial, and a failed page giving an error.
- **EXTEND** `@AC-10 @feature-251` "Trading's fill events carry the order side, the canonical source_service and the fee" (`services/xstockstrat-trading/acceptance/fix-getpnl-source-service.feature`). Bracket-leg fill events gain the same shape (feature AC-4/AC-5).
- **PRESERVE** `@AC-4`, `@AC-6`, `@AC-45`, `@AC-3`, `@AC-1`, `@AC-2`, `@AC-57` `@feature-294` (`services/xstockstrat-trading/acceptance/signal-map-instrumentation.feature`). These cover:
  - the `trading.ledger_emit` outcome counter (leg emits must go through `emitLedgerEvent`);
  - `pollFills` one "loop tick ok" per tick, with the injected clock and **no diff hunk inside `StartFillPoller`**, which constrains where the leg poll is wired;
  - unchanged parent PARTIALLY_FILLED→FILLED handling;
  - `trading.bracket.outcome` metrics;
  - `flattenAndHalt` outcomes via portfolio `GetPosition`.
- **PRESERVE** `@AC-1`, `@AC-2`, `@AC-3` `@feature-206` (`services/xstockstrat-trading/acceptance/fix-reconciliation-false-halt.feature`). Reconciliation must not false-halt, must still halt on a foreign position, and must fail safe. This is untouched while leg fills go to the ledger only. Persisting legs into `trading.orders` would change `NetFilledQtyBySymbol`.
- **PRESERVE** `@AC-4`, `@AC-5`, `@AC-7`, `@AC-10` `@feature-256` (`services/xstockstrat-trading/acceptance/fix-offline-book-consistency.feature`), plus `offline-account-portfolios.feature` (portfolio and trading) and portfolio `fix-offline-book-consistency.feature`. Offline accounts stay on the absolute `account.positions.synced` path, never `order.filled`, and their `boundedRetry`/ack semantics are unchanged.
- No CHANGE flags. No existing `@AC` encodes the buggy live-fold behavior (an unsigned sell folded as a buy, the in-memory `lastSeq` on the fill consumer, `positionsMu`). Suites exist for portfolio, trading, ui and agent. The ui and agent suites were only name-scanned (glob truncated), which is a possible C-16 blind spot to re-check at `/sdd-spec`.

## Dependencies

- Proto/RPC: none. Fill events are ledger JSON payloads, `LedgerEvent.event_id` and `Sequence` already exist, and `side` already rides the payload.
- Migration:
  - Portfolio: next number `019` in `services/xstockstrat-portfolio/migrations/` (max is `018_watchlist_signal_expiry`). It adds a persisted per-consumer cursor or an applied-event table unique on `(consumer, event_id)`, and must be additive. Approval: DBA + portfolio owner.
  - Overlap: feature 318 also touches portfolio migrations (review overlap WARN), so re-check the max at `/sdd-spec`.
  - Trading: `012` only if the leg poller needs schema. The `order_brackets` `order_id` index exists (`005_…:27`).
- Config keys: none new. Existing: `trading.risk.bracket_orders_enabled` (default `true`), `trading.fill_poller.interval_ms` (5000), `trading.position_sync.interval_ms`.
- Inter-service edges: no new edges.
  - trading → ledger (`AppendEvent`) gains leg fill events.
  - portfolio → ledger (`StreamEvents`, `QueryEvents` for `orderSide`) is unchanged.
  - Header propagation on the leg emit follows the existing `emitLedgerEvent` path (C-03).
- New env vars / ports: none. `.do/app.yaml:107` `instance_count: 1` stays unless OQ-5 decides to raise it.

## Risks / Not-found

- **Not found:** there is no persisted cursor or applied-event table in the portfolio schema (judged by migration names; the SQL bodies were not grepped). There is no `Begin`/tx on `queryRower` (`portfolio_repo.go:22-26`), and no `pg_advisory`/`FOR UPDATE` in `portfolio_repo.go`.
  - Row-level serialization needs a tx-capable repo seam, which is a pgxmock surface change.
  - The design must decide whether `PortfolioRepo` gains `WithTx` over `pgx.Tx` (pgxmock supports `ExpectBegin`).
- **Not found:** no trading code polls bracket leg ids or emits leg fills. There is no `BracketRepository` method that lists ACTIVE brackets (`ListExpiredProtection` filters on non-active statuses).
- **Ambiguity — leg fill qty semantics:** feature AC-5 says "`order.filled` with qty 6 (the remaining)", while 251 `@AC-17` (PRESERVE) treats an `order.filled` qty as the order total after a partial (and `applyBrokerOrderStatus` emits `qty = order.Qty`).
  - With rule 17's reading, a leg `order.filled` qty 6 after a partial 4 folds as 6 total. GetPnL realized would be 60, not 100.
  - The live consumer ignores `order.partially_filled`, so AC-5's "position qty 0" requires the leg `order.filled` qty to be the total (10).
  - The design must pin this. The likely resolution is to amend AC-5's wording to total 10, append-only per C-15 (the `@AC` ID is kept, the text corrected with the reason logged). It must not alter 251 `@AC-17`.
- **Ambiguity — which stream key carries a leg fill** (OQ-4): the leg broker id or the parent order id.
  - `orderSide` and GetPnL's AC-17 partial/full grouping key on the order id, so a leg keyed by the parent id would merge with the entry's fills.
  - A distinct leg key needs `side` always present, because no `order.created` sibling exists for a leg (251 `@AC-4` → FAILED_PRECONDITION otherwise).
- **Replay re-emits close:** `emitEventAs` uses a fresh `uuid.NewString()` per call (`:1356`), so exactly-once on the fold does not by itself make the emitted `portfolio.position.closed` exactly-once (analysis's P&L-pattern consumer seals on it). The applied-event guard must sit before the emit, or the emit key must derive from the source `event_id`.
- **Pre-251 replay side:** a historical `order.filled` with no `side` and no resolvable sibling raises `ErrFillUnattributable` on the live path. That must not stall the consumer (GetPnL refuses, the live fold must park or skip explicitly). The fails.md 2026-11-04 rule: name what re-delivers a skipped event, and never silently advance.
- **Data repair (OQ-2):** the `realized_accum`/`fees_accum` already inflated in production are permanent (fails.md 2026-11-04 race entry: accumulators keep errors that snapshots do not heal). A rebuild is a data-repair decision with DBA + owner approval, and it is out of AC scope unless the design adds it.
- **Cutover hazard:** the first boot after the migration must not replay history onto already-folded rows. The guard must be seeded, either with a cursor at the current ledger head or by backfilling applied ids, or the fix triggers the very inflation it prevents.
- **Self-heal contract:** insights.md 2026-08-26 (157) and `~3721` (256) both rely on boot replay from `lastSeq=0` healing absolute consumers. Scope the persistence to the incremental `order.filled` consumer only, unless the operator signs off a CHANGE to 290 `@AC-3`.
- **Reconciliation coupling:** fails.md 2026-10-07 (206) and the 2535-2552 rule family say that any new persisted home of platform-originated identity or fills must extend the reconciliation known-set. Leg fills reaching the ledger do not fix `NetFilledQtyBySymbol`, which counts `trading.orders` only, so the bracket-leg false-halt residual (trading CLAUDE.md § Broker State Reconciliation) remains. Record it as a named residual or extend it deliberately; do not leave it silent.
- **Race testing:** fails.md 2026-11-04 says CI `-race` green is not evidence of race-freedom. AC-2 needs a real two-writer (two-process) test against a real Postgres. pgxmock cannot prove it. The `DB_PGBOUNCER=true` + local Postgres route is available (fails.md 2026-09-01).
- **`StartFillPoller` no-hunk constraint** (294 `@AC-6`): wire the leg poll inside `pollFills` or a callee, not in `StartFillPoller`.
- **Fold-sign trap:** the old offline `applyFill` was signed (insights 157 evidence `portfolio_service.go:508-581`, older line numbers). Grep for any surviving local signed-fold helper before adding one (DRY guard rail, C-18).
- **Not verified:** the ui and agent acceptance suites were not read in full. `services/xstockstrat-trading/docs/ibkr.md` (hedged-mode and fill-netting caveat) was not read; check it for IBKR leg qty netting.

## Recommended Scope

Advisory, not binding:

1. **portfolio migration `019`** — an applied-event table `portfolio.applied_events(consumer, event_id)` PK, or a per-consumer cursor row, additive with a `.down.sql`. It must include a cutover seed strategy.
2. **portfolio repo tx seam** — a `WithTx`/`pgx.Tx`-capable `PortfolioRepo` path covering: `pg_advisory_xact_lock(hash(user_id,symbol,trading_mode,account_id))`, `SELECT … FOR UPDATE`, the upsert or close, and the applied-event insert, all in one tx (PgBouncer-transaction-safe). Add pgxmock tests.
3. **portfolio fold** — sign `fill.Qty` from `Side` (falling back to `orderSide`), fold via `pnl.FoldFrom`, close on `|qty| < QtyEpsilon`, decide flip handling, and make the close emit idempotent (an `event_id`-derived key). Tests: AC-1, AC-3, and 029 `@AC-10`/294 `@AC-56` preserved.
4. **portfolio concurrency** — retire `positionsMu` from the fill path, or keep it as belt-and-braces per OQ-5. Add a real-Postgres two-writer test (AC-2).
5. **trading leg fill observer** — add a `BracketRepository` active-bracket listing. `pollFills` (not `StartFillPoller`) polls the leg ids via `entry.client.GetOrder` and emits `order.partially_filled`/`order.filled` through `emitLedgerEvent` with the parent's account, mode and user, `oppositeSide`, fees, and the pinned qty semantics. Track per-leg last-seen filled qty so it emits once. Tests: AC-4 and AC-5 for both Alpaca and IBKR, plus the 251 `@AC-10` EXTEND.
6. **docs** — portfolio and trading `CLAUDE.md` (Ledger Events Consumed row, `positionsMu` note, the bracket-leg reconciliation residual), and promote the scenarios at integration (C-16).
7. **(conditional, OQ-2)** an operator-approved one-off rebuild of inflated `realized_accum`/`fees_accum`, only if the design admits it into scope.
