# Recon: fix-trading-order-state-audit

**Created**: 2026-10-21
**From**: product-spec.md
**Affected services**: xstockstrat-trading (fix site), xstockstrat-ledger (receives a reused event type; no change)

---

## Objective

Four order-state writes on error and terminal paths (`_ = s.repo.UpsertOrder(...)`, D-04) and three
reactive stale-intent reclaims (`_, _, _ = s.orderIntentRepo.ReclaimOrphanIntent(...)`, D-62) throw
away their results. A failed `trading.orders` write is never logged, and a successful reactive reclaim
emits no `order_intent.reclaimed_unknown`, unlike the sweeper. The fix adds error-level logs for the
upsert failures (FR-1..FR-4). For the reclaims it logs failures and emits the event on success, using a
`reactive_*` trigger (FR-5/FR-6). Every site is in `xstockstrat-trading`. There is no proto,
migration or config change.

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - Handler/servicer (all fix sites): `services/xstockstrat-trading/internal/service/trading.go`
    - `PlaceOrder` — `trading.go:400`. It delegates to `submitOrder` at `:544`.
    - `submitOrder` — `trading.go:550`. It holds the PlaceOrder-side fix sites `:603`, `:688` and `:703`.
      **Correction to the spec's wording:** these lines sit in `submitOrder`, not in `PlaceOrder` itself.
      `submitOrder` has a second caller, the flatten-and-halt retry loop at `trading.go:2838` (see Risks).
    - D-62 reclaim (submit path) — `trading.go:603`, inside `default: // intentActionRejectPending` → `if isStale {`.
      It follows the inline comment at `:602` ("Best-effort — the caller need not distinguish…"). It returns
      `FailedPrecondition "order intent %q is still pending"` at `:605-606`.
    - D-04 timeout write — `trading.go:688`, `_ = s.repo.UpsertOrder(context.Background(), order)`. The order is
      still at its pre-call status. It is followed by `slog.Warn("broker call uncertain (timeout)", …)` at `:692`.
    - D-04 reject write — `trading.go:703`, the same call. It is followed by `slog.Error("broker rejected order", …)` at `:711`.
    - `recordOfflineOrder` — `trading.go:767`. Its intent switch is at `:789` (`action, _ := classifyIntentLookup(...)`).
      It **discards `isStale` and has no reclaim**: `default:` returns "already in progress" (`:800-803`). This
      fourth copy of the switch is therefore **not** a D-62 site. Discovery left it unread; it was opened this session.
    - `CancelOrder` — `trading.go:1239`. The intent switch is at `:1285` and the reclaim at `:1301` ("cancel on order %s is still
      pending"). The final write is at `:1367` (`_ = s.repo.UpsertOrder(ctx, order)`), followed by `finalizeCancelIntent` (`:1400`).
    - `ReplaceOrder` — `trading.go:1412`. The intent switch is at `:1482`, the reclaim at `:1498` and the final write at `:1550`.
    - Emit helper — `trading.go:3661`: `emitLedgerEvent(ctx, eventType, streamKey, userID string, payload map[string]interface{})`.
      It sets `SourceService: "xstockstrat-trading"`, bounds the call with `ledgerEmitTimeout` (10s per discovery), and logs
      `slog.Warn("ledger emit failed")` on error.
  - Intent helpers: `services/xstockstrat-trading/internal/service/order_intent.go`
    - `classifyIntentLookup` — `order_intent.go:74`.
    - `sweepOrderIntents` (the reference behavior) — `order_intent.go:136-159`.
      - reclaim at `:144`.
      - `slog.Warn("order intent sweep: reclaim failed", "intent_id", …, "error", err)` at `:146`.
      - `if !reclaimed { continue }` at `:149-151`.
      - `emitLedgerEvent(ctx, "order_intent.reclaimed_unknown", fmt.Sprintf("order:%s", out.OrderID), "", {trigger:"sweep", order_id, intent_id, was_pending_since})` at `:152-157`.
  - Repository:
    - `ReclaimOrphanIntent` — declared at `internal/repository/order_intent_repo.go:43`. The comment at `:41` reads "the single
      CAS shared by the reactive path and the sweeper". The implementation is at `:111`. It returns `(false, nil, nil)` on
      `pgx.ErrNoRows` (a benign no-op). A reclaimed row's `order_id` is `RETURNING` from the row (`:105-109`).
    - `NewTradingRepoWithDB(db dbQuerier)` — `internal/repository/trading_repo.go:41`. `UpsertOrder` is at `:53`.
  - Last migration: `011_offline_fees_snapshot_headers.up.sql` (`services/xstockstrat-trading/migrations/`). None needed.
  - Config-read pattern: `staleThreshold(s.cfgW)` (used at each reclaim) reads the existing keys `trading.order_intent.stale_multiplier` and
    `trading.broker.timeout_ms`. Nothing new.
  - Logging: plain `slog` with key-value pairs. There is no logger field on `TradingService`. The nearest checked-write precedents are
    `trading.go:646` `slog.Warn("db upsert order failed", "order_id", orderID, "error", err)` and `:745`
    `slog.Warn("db upsert after broker submit failed", …)`. Both log at Warn, and FR-1..FR-4 require Error.
- **`xstockstrat-ledger`** (Node.js) — no change.
  - `AppendEvent` inserts `req.eventType` verbatim, with no allow-list, CHECK or enum: `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:41-48`.
  - Proto: `AppendEventRequest` at `packages/proto/ledger/v1/ledger.proto:38-52` (fields 1–9, `payload=5` is a Struct).
  - Last migration: `003_events_user_id`. None needed.

## Patterns to REUSE

- Reactive reclaim handling (FR-5/FR-6) → copy the sweeper's three-way result handling at `order_intent.go:144-157`:
  - error → log with `intent_id` and `error`;
  - `!reclaimed` → silent no-op;
  - reclaimed → `emitLedgerEvent("order_intent.reclaimed_unknown", "order:<order_id>", …)` with the same four payload keys.
  Only `trigger` changes.
- Ledger emit → `emitLedgerEvent` at `trading.go:3661`. Do not add a new client call. Whether to call it synchronously (as the
  sweeper does) or as `go s.emitLedgerEvent(context.Background(), …)` (as the request-path sites do) is a design choice.
- Upsert-failure logging → follow the key-value style of `trading.go:646` / `:745` (`"order_id", …, "error", err`),
  add `user_id` (`order.UserId`) and `status` (FR-1..FR-4), and log at `slog.Error`.
- Ledger event docs → add the `order_intent.reclaimed_unknown` row to the "Ledger Events Emitted" table at
  `services/xstockstrat-trading/CLAUDE.md:139`, with triggers `sweep` and `reactive_*`. This closes the logged drift at
  `services/xstockstrat-trading/docs/context-constitution-findings.md:13`.
- Test harness (package `service`, `internal/service/`):
  - Service literal with fakes → `notCancelableSvc` in `trading_cancel_not_cancelable_test.go` (`repo: repository.NewTradingRepoWithDB(execOnlyDB{})`, `orderIntentRepo`, `ledger`, `brokers`, `orders`). Use it for CancelOrder (AC-3/5/8) and as the template for ReplaceOrder (AC-6/7/9).
  - Driving `submitOrder` to the broker `SubmitOrder` → `newFlattenHarness(submit func(call int) …)` at
    `trading_flatten_rejection_test.go:88`. It already drives the reject path and the uncertain-timeout path
    (`TestFlattenAndHalt_UncertainTimeout_KeepsClientOrderID`, `:176`). This **narrows the harness gap discovery reported**:
    a test can reach `:688` / `:703` through flatten or by calling the package-internal `submitOrder` directly, without
    first clearing every `PlaceOrder` risk, sizing and approval gate.
  - Log assertions → `captureLogs(t)` at `trading_sync_test.go:16`. It swaps `slog.Default`, so tests that use it run without `t.Parallel`.
  - Ledger assertions → `recordingLedgerClient` at `trading_reconciliation_test.go:136` (`eventTypes()` at `:157`, full `events` requests for the payload).
  - Broker fake → `fakeBroker` at `trading_bracket_test.go:26` (`submitOrderFn`, `cancelOrderFn`, `getOrderFn`).
  - Intent fakes → `fakeOrderIntentRepo` at `trading_bracket_test.go:496` (`InsertIntent` returns true; `GetIntentByID` and `ReclaimOrphanIntent` panic). `memIntentRepo` at `trading_flatten_rejection_test.go:39` is stateful but has no `ReclaimOrphanIntent`.
  - DB fakes → `execOnlyDB` at `trading_flatten_rejection_test.go:27` always succeeds. pgxmock `newConfirmHarness` at `trading_offline_test.go:1598` supports `ExpectExec(...).WillReturnError(...)`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-202` "A GTC market order is placed with the TimeInForce enum" (`services/xstockstrat-trading/acceptance/order-time-in-force-enum.feature`) — the PlaceOrder happy path is unchanged by the added logging and emit.
- **PRESERVE** `@AC-3 @FR-3 @feature-202` "A broker-unsupported TIF is rejected before broker submission" (`services/xstockstrat-trading/acceptance/order-time-in-force-enum.feature`) — the pre-broker reject is distinct from the `trading.go:703` broker reject. It gains no `UpsertOrder` or log side effect.
- **PRESERVE** `@AC-3 @regression @feature-206` "A net-filled-qty lookup error never causes a false halt" (`services/xstockstrat-trading/acceptance/fix-reconciliation-false-halt.feature`) — reconciliation reads `trading.orders`. The new logging must not change its halt and mismatch behavior.
- **PRESERVE** `@AC-1 @regression @feature-206` "A broker position explained by the platform's own filled orders does not halt" (`services/xstockstrat-trading/acceptance/fix-reconciliation-false-halt.feature`) — order and fill state semantics are unchanged.
- **PRESERVE** `@AC-2 @regression @feature-206` "A genuinely foreign broker position still halts" (`services/xstockstrat-trading/acceptance/fix-reconciliation-false-halt.feature`) — the genuine-halt path is unchanged.
- **PRESERVE** `@AC-1 @regression @feature-192` "an order is accepted when the platform trading state is ACTIVE" (`services/xstockstrat-trading/acceptance/fix-trading-config-key-mismatch.feature`) — the PlaceOrder gate is unchanged.
- **PRESERVE** `@AC-5 @FR-4 @feature-157` "Editing an offline order confirmation from the UI marks it filled" (`services/xstockstrat-trading/acceptance/offline-account-portfolios.feature`) — ConfirmOrder is out of scope (D-63) and must stay untouched.
- No existing acceptance suite covers `order_intent.reclaimed_unknown`, `UpsertOrder` error handling, or cancel/replace in xstockstrat-trading. The new `@AC-1..@AC-9` are net-new guarantees, so nothing is EXTENDED or CHANGED.
- No existing acceptance suite for xstockstrat-ledger touches `AppendEvent` or event types (`ledger-event-export.feature` and `snapshot-offline-positions.feature` cover export and snapshot only).
- No CHANGE flags apply: nothing guarantees the old silent-discard behavior. If the design chose to **surface** the `UpsertOrder` failure (Open Question 1) and so changed an RPC's return code, re-check `@AC-1`/`@AC-3 @feature-202` and `@AC-1 @feature-192`.
- The sweeper's `trigger="sweep"` payload is guarded by no `@AC-*`, so keep it unchanged by review.
- At promotion this feature's `@AC-1..@AC-3` collide by number with existing trading-suite tags, so promotion must carry `@feature-267`.

## Dependencies

- Proto/RPC: none. The ledger `AppendEventRequest` (`packages/proto/ledger/v1/ledger.proto:38-52`) is reused as-is.
- Migration: none. For reference, the next numbers would be trading `012` and ledger `004`.
- Config keys: none new. The existing `trading.order_intent.stale_multiplier` and `trading.broker.timeout_ms` are read through `staleThreshold`.
- Inter-service edges: the existing trading → ledger `AppendEvent` (gRPC). Three new emit sites reuse the existing ledger write path.
- New env vars / ports: none.

## Risks / Not-found

- **`submitOrder` is shared with flatten-and-halt (`trading.go:2838`).** FR-1/FR-2 logging and the `:603` reactive reclaim
  also fire on the internal flatten retry loop, not only on the `PlaceOrder` RPC. If design keeps one `trigger` value at
  `:603`, `reactive_place` will also label flatten-originated reclaims. The design must either accept that (and document it)
  or pass the caller context in. Flatten generates its client order id per attempt (`TestFlattenAndHalt_UncertainTimeout_KeepsClientOrderID`),
  so a stale-PENDING collision there is unlikely but not impossible.
- **`order_id` source for cancel/replace emits (AC-8/AC-9 expect "o-1").** This was open in discovery and is now resolved: cancel and replace insert
  their intent with `OrderID: req.OrderId` (`trading.go:1273-1276`, `:1470-1473`), and `ReclaimOrphanIntent` returns the row's
  `order_id`, so `out.OrderID == req.OrderId`. Test fakes must populate `rec.OrderID` to match.
- **Emit user id.** The sweeper passes `""`. The reactive sites know the caller (`order.UserId` / request context). Choosing user-scoped vs `""` is a design
  decision, and the AC payload assertions should state which.
- **Sync vs async emit.** Request-path emits are `go s.emitLedgerEvent(context.Background(), …)`. An async emit makes the ledger assertions in
  AC-4/8/9 need a poll or wait, while a sync emit adds up to the 10s `ledgerEmitTimeout` to the `FailedPrecondition` response. This is a design choice.
- **Log assertions must discriminate.** In the submit path the `:645` pre-broker `UpsertOrder` fails first under an always-failing repo
  and logs `Warn "db upsert order failed"`. So AC-1/AC-2 must select the new Error record by message or status, not by level and order id alone.
- **Harness extensions required (no existing fakes):**
  - a `dbQuerier` whose `Exec` errors, or the pgxmock harness;
  - an `OrderIntentRepository` fake with `InsertIntent → false`, a stale-PENDING `GetIntentByID`, and a configurable
    `ReclaimOrphanIntent (reclaimed, rec, err)`.
  There is no existing test of `order_intent.reclaimed_unknown`, sweeper or reactive. Per **C-13**, the second consumer of a new fake moves it
  into `internal/testdata/`; that home does not yet exist, so lazy materialization applies.
- **Not opened:** the `PlaceOrder` gate code between `trading.go:400` and `:544` (risk/sizing/approval/account). This matters only if design insists that
  AC-1/AC-2 enter through the RPC rather than through `submitOrder` or flatten.
- **DRY / switch extraction (Open Question 2).** Three copies (`:586`, `:1285`, `:1482`) carry the identical reject-pending/reclaim
  branch and differ only in message text and in the cancel `ReturnStored` response shape. The fourth copy (`:789`) differs
  structurally (no stale reclaim). The minimum dedup is a single `reclaimStaleIntent(ctx, intentID, existing, trigger)` helper called from the
  three sites. A full switch extraction would also have to parameterize three different return types. Weigh this against **C-18** (YAGNI vs DRY).
- **Open Question 1 (log-only vs surface).** On every D-04 path the broker side effect has already happened. Surfacing would change RPC
  return codes and reopen the PRESERVE rules above. Ledger insight (`insights.md` 2026-08-06 fix-mcp-extract-credentials): classify each
  post-side-effect write explicitly as best-effort (log) or must-surface.
- **Applicable ledger traps:**
  - `fails.md` 2026-08-16 position-sizing-engine ("discard is never correct") — the same family as D-04/D-62.
  - `fails.md` 2026-09-02 029-signal-performance-attribution — verify emit sites by grepping the event string, not line proximity. Done here for `order_intent.reclaimed_unknown`, which has only one current emit site (`order_intent.go:152`).
  - `fails.md` feature-159 entry (`CancelOrder` local transition unguarded, `trading.go` CancelOrder) — `CancelOrder`'s fail-open semantics (debt-radar NC-C) are out of scope here, so don't widen them.
- **Merge overlap:** `trading.go` is also edited by in-flight 241, 242 and 249 (`implementation-ready`) and by sibling 256 (`ConfirmOrder`, `:863-954` region). No call site here is shared with them, but expect textual conflicts. Sequence via `docs/roadmap/features/merge-order.md`.

## Recommended Scope

Advisory, not binding.

1. **test (RED)** — Add the harness extensions: a failing `dbQuerier` and a configurable stale-intent fake. Add RED tests for AC-1/AC-2 (via `submitOrder`/flatten harness), AC-3/AC-5/AC-8 (`CancelOrder`), AC-6/AC-7/AC-9 (`ReplaceOrder`) and AC-4 (submit-path reactive reclaim).
2. **service** — D-04: replace the four `_ = s.repo.UpsertOrder` calls with checked writes that call `slog.Error` with `order_id`, `user_id`, `status` and `error`. Log only, unless design decides otherwise.
3. **service** — D-62: replace the three discarded reclaims with sweeper-equivalent handling, ideally one small shared helper taking the `trigger`. Keep the `FailedPrecondition` "still pending" responses and the sweeper's `trigger="sweep"` unchanged.
4. **docs** — Add the `order_intent.reclaimed_unknown` row (`sweep` / `reactive_*`) to the trading `CLAUDE.md` "Ledger Events Emitted" table, and mark `docs/context-constitution-findings.md:13` resolved.
