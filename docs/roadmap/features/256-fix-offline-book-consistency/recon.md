# Recon: fix-offline-book-consistency

**Created**: 2026-10-21
**From**: product-spec.md
**Affected services**: xstockstrat-portfolio, xstockstrat-trading, xstockstrat-ui (consumer surface: xstockstrat-agent, C-14)

---

## Objective

Offline accounts (`BROKER_TYPE_OFFLINE`, feature 240) have no broker poll to repair a missed write. Four
best-effort paths currently turn a transient failure or a bad input into a book that stays wrong. D-47: the
offline sync and deregistration consumers ack failed writes. D-48: a `GetOfflineStates` failure becomes
unrealized-only P&L that looks complete. D-49: `ConfirmOrder` accepts NaN, Inf or negative fill values.
D-63: `ConfirmOrder` returns success when the `account.positions.synced` emit fails. The fix makes these
paths fail closed and surface the failure. Redelivery is bounded so a poison event cannot block the stream.
All four defects reproduce at the cited lines, re-grepped on this branch on 2026-10-21. D-63 also has a
second, deeper swallow inside trading's `emitLedgerEvent`.

## Codebase Map

- **`xstockstrat-portfolio`** (Go)
  - Ledger consumer contract: `type eventHandler func(context.Context, *ledgerv1.LedgerEvent) error`. A
    non-nil return means "reconnect from the failed event". Defined at
    `services/xstockstrat-portfolio/internal/service/portfolio_service.go:173`; the
    `ackAlways` adapter, which always returns nil, is at `:176`.
  - `consumeEventStream`: `portfolio_service.go:185`.
    - It loops forever. On error it sleeps a fixed `2 * time.Second` (`:199`) and re-opens from `lastSeq+1`.
    - It has **no attempt counter, bound or park.** `lastSeq` is a local of the loop.
  - `streamEventsFrom`: `portfolio_service.go:206`.
    - On a handler error it returns `lastSeq` unadvanced (`:226-231`), wrapped as
      `handle event seq %d`.
    - The failed event's sequence is available only inside this loop or in the wrapped error.
  - D-47 sites:
    - Sync consumer: `:1117`, `consumeEventStream(ctx, "position sync", "account.positions.synced", ackAlways(s.processPositionSync))`.
    - Deregistration consumer: `:1129`, `ackAlways(s.processAccountDeregistered)`.
    - `processAccountDeregistered`: `:1132`. It is void and takes `positionsMu` at `:1152`.
      `DeletePositionsNotInSync` (`:1156-1158`) and `DeleteOfflineRealized` (`:1159-1161`) failures are Warn only.
    - `processPositionSync`: `:1175`. It is void and takes `positionsMu` at `:1192`.
      - Warn-only failures: `UpsertPositionFromSync` (`:1213-1215`), `DeletePositionsNotInSync`
        (`:1219-1221`) and `UpsertOfflineRealized` (`:1229-1231`, guarded by `sync.RealizedPnl != nil`).
      - Parse failures and a nil payload return early (`:1176-1190`). These are poison and must stay acked.
    - Fill consumer: `ConsumeOrderFills` passes `s.processOrderFill` (`:264`, already returns `error`)
      directly, at `:168`, through the same unbounded loop.
    - Out-of-scope `ackAlways` users: `:1249` (bracket) and `:1297` (balance).
  - D-48 site: `valueRead` at `services/xstockstrat-portfolio/internal/service/offline_valuation.go:75`. It
    returns `readValuation` (struct `:28`) and has no error return.
    - Offline account ids are derived from the positions' `Source` as well as the explicit ids (`:82-92`), so a
      `nil` ids argument still values offline positions.
    - When there are no ids it returns early (`:93-97`). Otherwise `GetOfflineStates` is called at `:99`, and on
      error it logs Warn `"offline state unavailable"` and substitutes an empty map (`:100-103`).
  - `valueRead` call sites in `portfolio_service.go`:
    - `:446`, in `enrichPositions` (`:445`). The result is discarded. `GetPosition` (`:682`) calls it at `:688`
      and `ListPositions` (`:693`) at `:709`.
    - `:630`, in `GetPortfolio` (`:589`).
    - `:1417` and `:1468`, in `ListPortfolios` (`:1387`): the single-account branch and the all-accounts branch.
  - Repository, in `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go`:
    - `UpsertOfflineRealized` `:474` and `DeleteOfflineRealized` `:534`.
    - `GetOfflineStates` `:499`. It is user-scoped (`WHERE user_id=$1 AND account_id = ANY($2)`). An account
      with no row is absent from the map. One undecodable `recent_fills` row fails the whole batch:
      `decode recent fills for %s` at `:522`.
  - Handler/servicer: `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go`.
    - `GetPortfolio` returns `CodeInternal` for any error (`:60`), and so does `ListPositions` (`:84`).
    - `classifyGetPositionError` (`:416`) returns only NotFound or Internal (`:420`).
    - `classifyGetPnLError` (`:425`) maps `service.ErrQuotesUnavailable` to `CodeUnavailable` (`:426-427`).
    - `toGRPCError` (`:432`, used by ListPortfolios) passes `Unavailable` through only for a `*connect.Error` (`:442`).
  - Existing UNAVAILABLE sentinel: `var ErrQuotesUnavailable = errors.New("quotes unavailable")` at `portfolio_service.go:718`.
  - Last migration: `017_offline_realized_lifetime_fees.up.sql` (`services/xstockstrat-portfolio/migrations/`).
  - Config-read pattern: not needed. The bound is a code constant (operator decision in product-spec Fix Scope).

- **`xstockstrat-trading`** (Go)
  - Service: `services/xstockstrat-trading/internal/service/trading.go`.
    - `deriveOfflineStatus(filledQty, qty float64)` (`:863-871`). NaN fails both `<= 0` and `< qty`, so it
      falls to `default`, which returns FILLED.
    - `ConfirmOrder` (`:890`):
      - `if req.FilledQty < 0 {` at `:894`. NaN passes this check.
      - The fees guard at `:897` (`*req.Fees < 0 || math.IsNaN(*req.Fees) || math.IsInf(*req.Fees, 0)`)
        returns "fees must be >= 0".
      - The order is loaded with `GetOrder` at `:901`, so the new guard must sit above that line.
      - `confirmLock(order.AccountId)` at `:918`.
      - `order.FilledAvgPrice = req.FilledAvgPrice` at `:924` is never validated.
      - `UpsertOrder` at `:943`, then the in-memory cache.
    - D-63 swallow: `trading.go:951-954`. `recomputeAndEmitOfflinePositions` fails, the code logs Warn
      `"ConfirmOrder: recompute failed; positions.synced not emitted"` and still returns `resp, nil`.
    - `recomputeAndEmitOfflinePositions(ctx, accountID, userID) error` (`:962`):
      - Its doc comment at `:961` reads "Fail-closed (a query error skips the emit). Caller must hold confirmLock".
      - It returns an error when the baseline or confirmed-orders query fails (`:964-978`).
      - The emit is `s.emitLedgerEvent(ctx, "account.positions.synced", ...)` at `:1067`. An unconditional
        `return nil` follows at `:1077`. There is no no-op or early-success path between `:978` and `:1077`,
        so every successful recompute emits, a frozen-window confirm included.
    - `emitLedgerEvent` (`:3661`) is **void**. It drops the `structpb.NewStruct` error (`:3662`) and bounds
      `AppendEvent` with `ledgerEmitTimeout = 10 * time.Second` (`:3657`). On failure it only logs Warn
      `"ledger emit failed"` (`:3671-3673`) and does not retry. It has 27 call sites in `trading.go`.
      So an `AppendEvent` failure is swallowed **inside** the helper and never reaches ConfirmOrder's check at `:951`.
    - `SnapshotOfflinePositions` (`:1116`):
      - Per-row finite checks: `math.IsInf(pos.Qty, 0) || math.IsNaN(pos.Qty)` at `:1156` and the same for
        `AvgCostPerShare` at `:1160`. Negative cost is rejected at `:1164`.
      - It takes `confirmLock` at `:1196`.
      - It calls `recomputeAndEmitOfflinePositions` at `:1224` and already handles the returned error.
  - Handler wrappers: `services/xstockstrat-trading/internal/handler/trading.go:71` (Connect) and `:172` (gRPC adapter).
  - Last migration: `011_offline_fees_snapshot_headers.up.sql` (`services/xstockstrat-trading/migrations/`).

- **`xstockstrat-ui`** (Next.js): consumer surface only. Current error paths, read for this recon:
  - `src/components/trader/ConfirmFillDialog.tsx`:
    - `onError` (`:47-49`) puts `ConnectError.rawMessage` into local error state, which renders in a destructive `Alert`.
    - The form sends `filledQty: filledQty ? parseFloat(filledQty) : 0` and the same for price (`:36-37`).
    - Inputs are `type="number" min="0"`, so the browser form cannot send NaN or Inf. D-49 reaches trading
      through the agent or a direct RPC.
  - `src/hooks/useConfirmOrder.ts`: `useInvalidatingMutation`. It invalidates `['orders']`, `['order', id]`,
    `['portfolios']` and `['positions']`, only on success (`:13-14`).
  - Generic error states that an UNAVAILABLE read already reaches. None has code-specific text.
    - `src/app/trader/portfolio/page.tsx:147`: `{error && <CardNotice variant="error">Portfolio unavailable</CardNotice>}`.
    - `src/components/trader/PortfolioPanel.tsx:67`: `if (error || !data) return <CardNotice variant="error">Portfolio unavailable</CardNotice>;`
      (from `usePortfolios` at `:64`).
    - `src/app/trader/positions/page.tsx:506`: `Failed to load positions` (from `usePositions` at `:62`).
  - `src/hooks/usePortfolio.ts`: `usePortfolio` `:7`, `usePortfolios` `:21`, `usePositions` `:39`, `usePosition` `:63`.
    `usePosition` retries any error except NotFound once (`:81`), so an UNAVAILABLE retries once and then errors.
  - No e2e test covers a ConfirmOrder error path. `e2e/trader/offline-accounts.spec.ts` stubs only the happy path.

- **`xstockstrat-agent`** (Python): consumer surface (C-14).
  - `app/tools.py`:
    - `_grpc_error_message` (`:223`) maps `INVALID_ARGUMENT` to `exc.details() or "invalid argument"` (`:238-239`).
      Any other code, `UNAVAILABLE` included, falls through to `exc.details() or str(code)` (`:240`).
    - `manage_offline_account` (`:2035`) catches `grpc.aio.AioRpcError` at `:2138`.
  - `app/client.py`: `stub.ConfirmOrder` (`:2276`) and `stub.ListPositions` (`:2374`) pass errors through unwrapped.

## Patterns to REUSE

- **Retryable sync and deregistration handlers (FR-1, FR-2).**
  - Reuse the `eventHandler` error contract (`portfolio_service.go:173`) and `streamEventsFrom`'s
    no-advance-on-error behaviour (`:226-231`).
  - Model them on `processOrderFill` (`:264`): return an error only for a DB write failure, and return `nil`
    (skip and ack) for a malformed payload.
  - Convert `processPositionSync` and `processAccountDeregistered` to return `error`, then drop `ackAlways`
    at `:1117` and `:1129`.
- **Bound and park (FR-3).**
  - Nothing exists to reuse. Add one constant next to the existing fixed `2 * time.Second` at `:199`.
  - The attempt state must outlive a single `streamEventsFrom` call, because that call returns on error. It
    can live in `consumeEventStream` (beside `lastSeq`) or in a handler wrapper keyed by `event.Sequence`.
- **Offline-state UNAVAILABLE (FR-4).**
  - Reuse the `ErrQuotesUnavailable` sentinel (`portfolio_service.go:718`) and the `classifyGetPnLError`
    `errors.Is` mapping to `CodeUnavailable` (`portfolio_handler.go:425-427`).
  - Add a sibling sentinel and extend all four handler mappings: `:60`, `:84`, `classifyGetPositionError`
    `:416`, and `toGRPCError` `:432`.
- **Shared finite guard (FR-5).**
  - Extract the inline `math.IsNaN(x) || math.IsInf(x, 0)` checks (`trading.go:897`, `:1156`, `:1160`) into
    one helper.
  - Each caller keeps its own error shape: `INVALID_ARGUMENT` in ConfirmOrder, a per-row reject reason in Snapshot.
  - insights.md:1936 notes that the inverted range form also rejects NaN.
- **Emit failure is not success (FR-6).**
  - `recomputeAndEmitOfflinePositions` already returns `error` (`:962`) for query failures, and
    `SnapshotOfflinePositions` (`:1224`) already acts on it.
  - Stopping the discard at `:951-954` is necessary but **not sufficient**. The ledger-append failure is
    swallowed inside the void `emitLedgerEvent` (`:3661`, `:3671-3673`). FR-6 needs an emit that returns an
    error for this call site, such as a sibling of `emitLedgerEvent` that returns the `AppendEvent` and
    `NewStruct` errors. The helper's other 26 callers should stay unchanged (fails.md:2092, feature 021).
  - Confirm is absolute (it replaces `FilledQty`, `FilledAvgPrice` and `Fees`), so a client re-confirm under
    `confirmLock` is idempotent (AC-10 @feature-157).
- **Error surfacing in the UI and agent (C-14).** Reuse the existing paths. `ConfirmFillDialog` `onError`
  shows the error, the Book page renders "Portfolio unavailable", and the agent's `_grpc_error_message`
  covers both codes. Under an UNAVAILABLE-only FR-4, no new consumer code is indicated.
- **Test harnesses.**
  - Portfolio uses `pgxmock/v4` against the concrete repo; there is no repo interface.
    - `portfolio_fill_errors_test.go` provides `errDBBlip` `:22`, `fillEvent` `:24`, `newFillSvc` `:56`, and
      `TestStreamEventsFrom_HandlerError_DoesNotAdvanceCursor` `:142`.
    - `offline_account_pnl_test.go` provides `expectStates` `:52` and `acctSvc` `:94`.
    - `offline_valuation_test.go` provides `expectOfflineStates` `:267` and `offlineListSvc` `:273`.
  - Trading uses `trading_offline_test.go`:
    - `recordingLedger` `:60`, `fakeBaselineStore` `:107`, `newConfirmHarness` `:1598`.
    - Existing tests: `TestDeriveOfflineStatus` `:471`, `TestConfirmOrder_Validation` `:615` and
      `TestSnapshotOfflinePositions_AC7_NonFiniteQtyRejected` `:1396`.
    - `TestConfirmOrder_AC9_NegativeFeesRejectedBeforeLoad` `:1710` is the direct template for AC-4. It loops
      over `-1`, `NaN` and `+Inf`, then asserts `InvalidArgument` and `mock.ExpectationsWereMet()`.
  - UI e2e: `e2e/trader/offline-accounts.spec.ts` with `e2e/mock-backend.ts`. Fixtures are catalogued in
    `e2e/fixtures/INVENTORY.md` (C-12/C-13).
  - Agent: `tests/test_offline_client.py`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-29 @FR-9 @feature-240` "Every portfolio read returns the same offline P&L for the same state" (`services/xstockstrat-portfolio/acceptance/offline-account-full-pnl.feature`) — FR-4 must apply identically to GetPortfolio (with and without account_id), GetPosition, ListPositions and ListPortfolios, and healthy figures must not change.
- **PRESERVE** `@AC-39 @FR-9 @FR-8 @feature-240` "GetPortfolio carries broker and offline P&L and aggregates them" (`services/xstockstrat-portfolio/acceptance/offline-account-full-pnl.feature`) — healthy offline, broker and aggregate `total_pnl` are unchanged, and an offline-state failure must not blank the broker figures.
- **PRESERVE** `@AC-4 @FR-2 @feature-240` "Total P&L is realized plus unrealized and total % is over open cost basis" (`services/xstockstrat-portfolio/acceptance/offline-account-full-pnl.feature`) — this is the complete figure that D-48 must never silently reduce to unrealized-only.
- **PRESERVE** `@AC-6 @FR-2 @feature-240` "A fully flat account reports 0% instead of dividing by zero" (`services/xstockstrat-portfolio/acceptance/offline-account-full-pnl.feature`) — a healthy read keeps its realized-only total.
- **PRESERVE** `@AC-13 @FR-5 @feature-240` "A symbol with neither quote nor bars is flagged unpriced and does not fail the read" (`services/xstockstrat-portfolio/acceptance/offline-account-full-pnl.feature`) — the quote and mark tolerance stays; FR-4 covers only a `GetOfflineStates` failure.
- **PRESERVE** `@AC-12 @FR-5 @feature-240`, `@AC-27 @FR-5 @feature-240`, `@AC-51 @FR-1 @FR-5 @feature-240` (`services/xstockstrat-portfolio/acceptance/offline-account-full-pnl.feature`) — when the quote or bars batch fails, the read still falls back to the last close or quote and succeeds.
- **PRESERVE** `@AC-28 @FR-8 @feature-240` "GetPnL keeps refusing an offline holding without a live quote" (`services/xstockstrat-portfolio/acceptance/offline-account-full-pnl.feature`) — GetPnL stays UNAVAILABLE and is the precedent for FR-4.
- **PRESERVE** `@AC-52 @FR-9 @feature-240` "GetPortfolio reveals nothing for an account the caller has no rows in" (`services/xstockstrat-portfolio/acceptance/offline-account-full-pnl.feature`) — a missing row is not a state-read error, so FR-4 must not turn it into UNAVAILABLE.
- **PRESERVE** `@AC-7 @FR-6 @feature-157` "A confirmed offline fill updates positions via the shared absolute-sync path" (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`) — FR-6 hardens the emit; the `account.positions.synced` shape and the absence of `order.filled` stay.
- **PRESERVE** `@AC-10 @FR-6 @feature-157` "Re-editing a confirmed offline fill does not double-count the position" (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`) — absolute recompute is idempotent, which is why redelivery (FR-1/FR-2) and re-confirm (FR-6) are safe.
- **PRESERVE** `@AC-11 @FR-6 @feature-157`, `@AC-12 @FR-6 @feature-157` (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`) — sell-to-close and sell-to-open reach the same end states through the sync write path.
- **PRESERVE** `@AC-14 @FR-6 @feature-157` "A broker account's P&L is unaffected by the presence of an offline account" (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`) — an offline-state failure must not change broker cards or totals.
- **PRESERVE** `@AC-4 @regression @feature-206` "An empty broker position snapshot does not delete order-fill-derived positions" (`services/xstockstrat-portfolio/acceptance/fix-reconciliation-false-halt.feature`) — FR-1 changes only ack and retry; the `shouldReconcileSyncDeletions` guard stays.
- **EXTEND** `@AC-9 @FR-3 @feature-240` "Negative fees are rejected" (`services/xstockstrat-trading/acceptance/offline-account-full-pnl.feature`) — FR-5 adds INVALID_ARGUMENT for a non-finite or negative `filled_qty`/`filled_avg_price` alongside it. Keep the "fees must be >= 0" message and the before-load ordering.
- **PRESERVE** `@AC-48 @FR-3 @feature-240` "Un-confirm hides fees and filled_at; a bare re-confirm restores them" (`services/xstockstrat-trading/acceptance/offline-account-full-pnl.feature`) — `filled_qty 0` must stay valid, and the price is validated only when filling.
- **PRESERVE** `@AC-8 @FR-3 @feature-240`, `@AC-21 @FR-3 @feature-240`, `@AC-37 @FR-3 @feature-240` (`services/xstockstrat-trading/acceptance/offline-account-full-pnl.feature`) — re-confirm and partial-to-full semantics, fee replace/keep and derived status (FR-7) stay.
- **PRESERVE** `@AC-46 @FR-4 @feature-240`, `@AC-47 @FR-3 @feature-240` (`services/xstockstrat-trading/acceptance/offline-account-full-pnl.feature`) — a confirm inside the frozen window still succeeds; FR-6 must not fail it for lack of an emit.
- **PRESERVE** `@AC-7 @FR-5 @feature-163` "One malformed baseline row is rejected while the valid rows commit" and `@AC-43 @FR-4 @feature-240` "A snapshot whose rows are all rejected changes nothing" (`services/xstockstrat-trading/acceptance/snapshot-offline-positions.feature`, `.../offline-account-full-pnl.feature`) — sharing the finite guard with `SnapshotOfflinePositions` must keep per-row reject-with-reason, not a whole-call error.
- **PRESERVE** `@AC-5 @FR-4 @feature-157` "Editing an offline order confirmation from the UI marks it filled" (`services/xstockstrat-trading/acceptance/offline-account-portfolios.feature`) — this is the FILLED baseline for a valid fill (FR-7).
- **PRESERVE** `@AC-9 @FR-8 @feature-157` "Order-confirmation edits are rejected for broker accounts" (`services/xstockstrat-trading/acceptance/offline-account-portfolios.feature`) — a broker order still gets FailedPrecondition; check the ordering against the new pre-load INVALID_ARGUMENT.
- **EXTEND** `@AC-15 @FR-1 @feature-157` "Deregistering an offline account purges its positions and realized P&L" (`docs/sdd/business-rules/platform.feature`) — FR-2 makes the purge survive a transient `DeleteOfflineRealized` failure through redelivery. The end state is unchanged.
- **PRESERVE** `@AC-18 @FR-8 @feature-163` "Deregistering an offline account purges its baseline rows" (`docs/sdd/business-rules/platform.feature`) — same `account.deregistered` event. The baseline purge is trading-side and unchanged.
- **PRESERVE** `@AC-14 @FR-3 @FR-4 @feature-163` "A later full-close snapshot reseats account realized P&L from 600.00 to 0.00" and `@AC-12 @FR-7 @feature-163` "Provenance is consistent across every portfolio read path" (`services/xstockstrat-portfolio/acceptance/snapshot-offline-positions.feature`) — the realized upsert from a sync event must still reseat under retry and park, and read-path parity holds.
- **PRESERVE** `@AC-1 @regression @feature-229 @feature-240` and `@AC-5 @regression @feature-229` (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature`) — the quote-deadline bound and WARN stay, and GetPnL stays UNAVAILABLE without a quote.
- **PRESERVE** `@AC-8 @FR-5 @feature-163` "A zero-qty baseline row flattens that symbol" and `@AC-15 @FR-5 @feature-163` (`services/xstockstrat-trading/acceptance/snapshot-offline-positions.feature`) — a shared finite guard must keep accepting qty 0 and avg 0.
- **PRESERVE** `@AC-13 @FR-6 @feature-157 @feature-240` "Offline realized P&L survives a full position close and is shown on the account card" (`services/xstockstrat-ui/acceptance/offline-account-portfolios.feature`) — a healthy card still shows both realized rows.
- **EXTEND** `@AC-15 @FR-6 @feature-240` "The Book page offline card shows the P&L summary" and `@AC-14 @FR-6 @feature-240` "The trader account card shows full P&L for an offline account" (`services/xstockstrat-ui/acceptance/offline-account-full-pnl.feature`) — FR-4 adds an error or degraded state for these cards. The healthy summary is unchanged, and an unrealized-only figure is never shown as the account total.
- **PRESERVE** `@AC-30 @FR-6 @feature-240` "The combined PortfolioPanel sums each account's own figures" (`services/xstockstrat-ui/acceptance/offline-account-full-pnl.feature`) — a degraded offline account must not produce a combined total that looks complete. See the ListPortfolios fork in Risks.
- **PRESERVE** `@AC-16 @FR-6 @feature-240`, `@AC-31 @FR-6 @feature-240`, `@AC-32 @FR-6 @FR-5 @feature-240` (`services/xstockstrat-ui/acceptance/offline-account-full-pnl.feature`) — the existing stale-mark and "No price" indicators stay; any degraded state is additive.
- **PRESERVE** `@AC-2 @FR-3 @feature-159 @feature-240 @regression`, `@AC-3 @FR-4 @feature-159 @regression`, `@AC-4 @FR-4 @feature-159 @feature-240 @regression` (`services/xstockstrat-ui/acceptance/fix-offline-account-ui-gaps.feature`) — the offline card never shows Cash or Buying Power, and offline balances never blend into broker aggregates, including in the error or degraded state.
- **PRESERVE** `@AC-3 @FR-2 @feature-157` "Offline accounts appear alongside broker accounts in the account selector" (`services/xstockstrat-ui/acceptance/offline-account-portfolios.feature`) — one failing offline account must not drop the broker accounts from the selector or the Book page.
- **EXTEND** (net-new cases with no existing `@AC-*` to attach to). The feature also adds:
  - (a) rejection of a non-finite or negative `filled_qty`/`filled_avg_price` (FR-5);
  - (b) an emit failure is not reported as success (FR-6);
  - (c) bounded redelivery of failed offline sync and deregistration events (FR-1..3);
  - (d) UNAVAILABLE or a degraded valuation when `GetOfflineStates` fails (FR-4).
  - No existing scenario asserts the buggy behaviour, so there is **no CHANGE**.
  - `@AC-*` numbers repeat across features and suites. Cite them by suite path plus `@feature-*`, as above.
- No existing acceptance suite for xstockstrat-agent yet. The agent and `ConfirmFillDialog` error displays are new EXTEND coverage under C-14.
- **Superseded design decision (not an `@AC`).** Feature 240 recorded "a `GetOfflineStates` error is non-fatal
  (WARN, empty map)" in `docs/roadmap/features/240-offline-account-full-pnl/context.md:399`. FR-4 supersedes it.
  This needs an explicit record in this feature's `context.md`, not a sign-off against a suite rule.

## Dependencies

- Proto/RPC:
  - None if OQ-1 resolves to `UNAVAILABLE`, which reuses the existing gRPC status as GetPnL does.
  - A per-account degraded marker would be an additive field in `packages/proto/portfolio/v1/portfolio.proto`
    and would go through the proto approval gate (C-04, C-09). The proto was **not opened** in this recon, so
    no field number is cited.
- Migration: none. If one were ever needed, the next numbers are `018` for `services/xstockstrat-portfolio/migrations/`
  and `012` for `services/xstockstrat-trading/migrations/`.
- Config keys: none. The FR-3 bound and any FR-6 retry are code constants (operator decision, product-spec Fix Scope).
- Inter-service edges: unchanged.
  - trading → ledger: the `account.positions.synced` append.
  - ledger → portfolio: `StreamEvents` consumers.
  - ui/agent → portfolio and trading: gRPC.
- New env vars / ports: none.

## Risks / Not-found

- **No bound or park mechanism exists anywhere.** The spec's claim that the fill consumer is "bounded" does not
  hold. `consumeEventStream` (`:185-202`) retries forever with a 2s sleep. FR-3 is net-new design (OQ-2).
  - **Scope fork:** putting the bound inside `consumeEventStream` would also change the `order.filled` path
    (`:168`), which is outside D-47 as written. Design must state whether the fill path is in scope.
  - **Park-vs-correctness trade-off:** after a parked offline sync the realized row stays stale until the next
    confirm or snapshot re-emits it. Absolute recompute heals it on the next emit, but there is no auto-heal.
  - **Deregistration is the sharper case.** A parked `account.deregistered` leaves an orphan realized row that
    nothing re-emits. Design should state the bound and what alerting, if any, follows the error log.
- **Whole-call vs per-account FR-4 in ListPortfolios.**
  - `GetOfflineStates` is batched over all of the user's offline ids (`offline_valuation.go:99`), and one bad
    `recent_fills` row fails the whole batch (`portfolio_repo.go:522`).
  - A whole-call `UNAVAILABLE` from the all-accounts branch (`:1468`) therefore also hides every **broker**
    account. That conflicts with AC-14 @feature-157 and AC-3 @feature-159/@feature-157.
  - This is the real OQ-1 fork: UNAVAILABLE without a proto change vs a per-account degraded marker that needs
    a proto change and UI work. A middle option is to decode per account in the repo, so one bad row degrades
    only its own account. Design decides.
- **`enrichPositions` discards the `valueRead` result** (`portfolio_service.go:445-446`). It has to return an
  error so that GetPosition (`:688`) and ListPositions (`:709`) can propagate it.
- **Handler mappings return `CodeInternal`** at `portfolio_handler.go:60`, `:84` and `:416-420`. A new
  sentinel without classifier changes would surface as INTERNAL, not UNAVAILABLE. All four handlers must change.
- **Tests that rely on the old non-fatal behaviour** will fail and need `expectStates` or `expectOfflineStates`.
  `portfolio_quote_deadline_test.go:115` says outright: "GetOfflineStates is left unexpected (its error is
  non-fatal)". The other offline suites need a sweep.
- **FR-5 gate order vs AC-9 @feature-157.**
  - The "before the load" check runs before the offline-only gate. A bad value on a broker order would then
    return INVALID_ARGUMENT instead of FailedPrecondition. Either way the order is unchanged; design records
    the choice.
  - `filled_qty 0` with price 0 must stay valid (AC-48 @feature-240). The UI form can send `0` but not NaN
    (`ConfirmFillDialog.tsx:36-37`), so the NaN case mainly reaches trading from the agent or direct gRPC callers.
- **The FR-6 emit failure is swallowed one level deeper than the spec cites.** `emitLedgerEvent`
  (`trading.go:3661`) is void and Warn-only (`:3671-3673`), with no retry. `recomputeAndEmitOfflinePositions`
  then returns `nil` unconditionally (`:1077`). Fixing only `:951-954` would leave D-63 open whenever the
  ledger is down.
  - Shared-helper trap (fails.md:2092, feature 021): changing `emitLedgerEvent`'s signature touches 27 call
    sites. Prefer a narrow variant that returns an error for this one emit. Design records the choice.
  - `SnapshotOfflinePositions` (`:1224-1227`) has the same swallow pattern around the same function. It is
    outside the spec's D-63 wording, but an emit that returns errors changes what it receives. Design states
    whether it is in scope.
- **FR-6 frozen-window confirm (AC-46 @feature-240).** Verified: there is no no-op path in `:962-1077`, so a
  frozen-window confirm still recomputes and emits. With a healthy ledger, returning the emit error does not
  turn AC-46 into a failure. The confirm fails only when the ledger append itself fails, which is FR-6's intent.
- **Not opened:**
  - `packages/proto/portfolio/v1/portfolio.proto`. A grep for `degraded` in it found nothing, so no marker
    exists today.
  - `positions/[symbol]/page.tsx` and `orders/[id]/page.tsx`. Their rendering under UNAVAILABLE is unverified.
  - `src/lib/connectClients.ts`. Its `Code.Unavailable` handling at `:138` is unread.
- **Ledger traps that apply:**
  - `fails.md:2028` (163, confirmLock): any retry of the recompute and emit must stay inside the same per-account
    `confirmLock`, which is non-reentrant. Do not re-acquire it in a retry helper.
  - `fails.md:2054` (163, user_id): the `account.positions.synced` payload must keep `user_id`. FR-6 must not
    build a new emitter that drops it.
  - `fails.md:2935` (240): before changing a shared read's failure behaviour, enumerate every caller.
    `valueRead` has four call sites across four RPCs, and `enrichPositions` hides two of them.
  - `fails.md:39` (read-path parity): the fix must reach every read path, not one (C-10(b)).
- **Overlaps (rebase only, from context.md):**
  - `portfolio_service.go`: 251, 257, 264, 242 and 248. Feature 248 touches `:185-202` and `:220-221`, which is
    **the same consumer loop FR-3 edits**, so check merge order with it explicitly.
  - `trading.go`: 267 (ConfirmOrder region `:863-954` is named in its context but excluded).
  - UI: 270-fix-ui-trader-feedback may touch `ConfirmFillDialog` or the Book page.

## Recommended Scope

Advisory input to the debate and /sdd-spec. Not binding.

1. **Trading FR-5/FR-7 (D-49).**
   - Add a shared finite helper and use it in `ConfirmOrder` before `:901` for `filled_qty` (finite, >= 0) and
     for `filled_avg_price` when `filled_qty > 0`.
   - Refactor `SnapshotOfflinePositions` `:1156-1160` onto the helper with no behaviour change.
   - Tests: extend `TestConfirmOrder_Validation`, `TestDeriveOfflineStatus` and the AC9 template.
2. **Trading FR-6 (D-63).**
   - Add an emit that returns an error for the `account.positions.synced` append, leaving `emitLedgerEvent`'s
     other callers alone, and have `recomputeAndEmitOfflinePositions` return that error.
   - Make ConfirmOrder return an error on a recompute or emit failure at `:951`; a bounded in-lock retry is optional.
   - Test with a failing `fakeBaselineStore` or `recordingLedger`, then show that a re-confirm succeeds and emits.
   - Verify frozen-window AC-46.
3. **Portfolio FR-1/FR-2 (D-47).**
   - Make `processPositionSync` and `processAccountDeregistered` return `error`: write failure means retry, a
     malformed payload means ack.
   - Drop `ackAlways` at `:1117` and `:1129`.
4. **Portfolio FR-3 (bound and park).**
   - Add an attempt bound constant plus a park with an error log carrying the event id and sequence.
   - Design picks the location (`consumeEventStream` vs a wrapper) and whether `order.filled` shares the bound.
5. **Portfolio FR-4 (D-48).**
   - Add an offline-state-unavailable sentinel. `valueRead` and `enrichPositions` return an error, and all four
     reads propagate it.
   - Add classifier mapping in all four handlers.
   - Update tests that depend on the non-fatal behaviour.
   - Supersede the 240 decision in context.md.
   - Resolve OQ-1, whole-call vs per-account, and update the Fix Scope proto box.
6. **Consumer surface and docs.**
   - UI and agent tests asserting UNAVAILABLE and INVALID_ARGUMENT are surfaced: Playwright mock-backend error
     route, and agent `test_offline_client.py`.
   - Expect no consumer code if FR-4 is UNAVAILABLE.
   - Update the "Offline valuation" paragraph and the `ConsumePositionSyncs` row in
     `services/xstockstrat-portfolio/CLAUDE.md`, and the portfolio `docs/context-constitution.md` invariants
     (context-forge teardown).
