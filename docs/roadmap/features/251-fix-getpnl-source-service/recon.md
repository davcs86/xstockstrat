# Recon: fix-getpnl-source-service

**Created**: 2026-10-20
**From**: product-spec.md (Track C bug, SEV-2; report `docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md`)
**Affected services**: xstockstrat-portfolio (fix site), xstockstrat-trading (producer; fix site only under option (b) or a
shared constant), xstockstrat-ledger (read-only evidence), xstockstrat-ui (FR-3 fix site)

---

## Objective

`GetPnL` reports `realized_pnl = 0` for every user because it queries ledger fills with `SourceService: "trading"`,
while trading writes `"xstockstrat-trading"` and the ledger matches exactly (FR-1). Behind that, fill payloads carry
an unsigned qty with no `side`, so a sell folds as a buy (FR-2). Realized must equal `pnl.Fold` of the user's signed
fills, history included. The `/trader/positions` lineage sheet has the same filter bug, and fixing only the filter
would ship other users' fills to the browser (FR-3).

## Codebase Map

- **`xstockstrat-portfolio`** (Go)
  - Handler/servicer: `GetPnL` at `services/xstockstrat-portfolio/internal/service/portfolio_service.go:722`. The caller
    comes from `middleware.FromContext(ctx).UserID` (`:723`) and positions from `s.repo.ListPositions` (`:724`). A
    missing quote returns `ErrQuotesUnavailable` (`:718`, returned at `:731` and `:737`).
  - Pass 1 (`:751-790`): `QueryEvents{EventType: "order.filled", SourceService: "trading", Page{PageSize: 500,
    PageToken}}` (literal at `:753`).
    - A query error is `slog.Warn` + `break` (`:756-759`), a silent short fold.
    - User filter `fill.UserID != userID` (`:772`), then the mode filter (`:775-783`).
    - `filledOrderIDs[...] = true` (`:784`); the fill is appended with unsigned `Qty: fill.Qty` (`:785`).
    - The loop exits on an empty `GetNextPageToken()` (`:787-790`).
  - Pass 2 (`:796-835`): same shape for `order.partially_filled` (literal at `:798`), mode filter at `:820-828`, last
    partial per order kept (`:830`).
  - Dedup and fold: `if filledOrderIDs[orderID] { continue }` (`:839`), unsigned `Qty: fill.FilledQty` (`:842`),
    `realized := pnl.Fold(fills).Realized` (`:845`).
  - Payload struct: `orderFillPayload` (`:245-260`). Fields `UserID`, `Symbol`, `Qty`, `FilledQty`, `FillPrice`, `Mode`
    (json `trading_mode`), `AccountId`, `OrderID`, `StopPrice`, `Fees`; no side field.
  - Ledger client field: `ledgerv1.LedgerServiceClient` (`:43`).
  - Other ledger readers:
    - `HydrateStops` (`:530`) calls `QueryEvents{EventType: "order.filled"}` with no `SourceService` (`:534`).
    - The live fold `processOrderFill` (`:264`) runs off `StreamEvents` (`:211`). It has the same sign loss
      (`fill.Qty > 0 // buying more`, `:311`) and is out of scope.
  - Out-of-scope literals: `"portfolio"` at `:1013` (notify) and `:1028` (ledger `emitEvent`).
  - Last migration: `017_offline_realized_lifetime_fees.up.sql` (`services/xstockstrat-portfolio/migrations/`); next free
    `018`, none anticipated.
  - Config-read pattern: not touched. No config key is involved.
- **`packages/proto/pnl`** (Go, shared fold)
  - `Fill.Qty` is signed (`packages/proto/pnl/pnl.go:26`: `// signed: positive = buy, negative = sell`).
  - `foldInto` (`pnl.go:63`) treats a same-direction fill as an add (`:68-71`), which is how an unsigned sell becomes a
    buy.
  - `QtyEpsilon` (`:43`) is exported by feature 240. This package is read-only for this fix.
- **`xstockstrat-trading`** (Go)
  - The single ledger writer is `emitLedgerEvent` (`services/xstockstrat-trading/internal/service/trading.go:3661`).
    `SourceService: "xstockstrat-trading"` is an inline literal (`:3667`); `StreamKey: streamKey` (`:3668`).
  - Fill emits sit inside `applyBrokerOrderStatus` (`:1772`), called by `pollFills` (`:1713`, call at `:1766`) and by
    the `CancelOrder` not-cancelable path:
    - `order.filled` (`:1805-1812`): keys `order_id`, `symbol`, `qty` (unsigned `order.Qty`), `fill_price`, `user_id`,
      `trading_mode`, `account_id`, `fees`. No `side`. `stream_key` = bare `order.OrderId`.
    - `order.partially_filled` (`:1822-1829`): same, but `filled_qty` (`order.FilledQty`) in place of `qty`. No `side`.
    - `order` is a `*tradingv1.Order`, so `order.Side` is in scope at both sites.
  - Side-bearing siblings:
    - `order.created` in `submitOrder` (`:649-652`): `stream_key` = `orderID`; payload `symbol`, `side`
      (`order.Side.String()`), `qty`, `status`, `trading_mode`. No `order_id` key and no `user_id` key in the payload.
    - `order.submitted` (`:665-668`): payload `order_id`, `symbol`, `side`, `qty`, `trading_mode`. It is emitted only
      after the approval-pending early return (`:654-662`), so a pending-approval order has `order.created` only.
    - Offline `order.created` (`:842-845`) adds `account_id`. Offline accounts never emit fills.
  - Other `"xstockstrat-trading"` literals (`:1943`, `:2188`, `:2756`, `:3068`, `:3347`, `:3683`, `:3699`) are
    `notify.EmitAlert` sources, not ledger writes.
  - Last migration: `011_offline_fees_snapshot_headers.up.sql`; next free `012`, none anticipated.
- **`xstockstrat-ledger`** (Node/TS, read-only)
  - `queryEvents` (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:124-172`) builds exact-match predicates:
    `stream_key` (`:130-132`), `event_type`, `source_service` (`:138-141`), `occurred_at` range, and `sequence >=` from
    `fromSequence` (`:151-153`). There is no user predicate.
  - Default page size 100 (`:157`), fetched as limit+1. `ORDER BY recorded_at ASC` (`:162`).
  - `nextPageToken` is set to the last `event_id` when `hasMore` (`:171`). **The request `page_token` is never read.**
    A grep of `pageToken|page_token` over `services/xstockstrat-ledger/src` returns only that response line.
  - `appendEvent` stores `stream_key` (`:51`) and `source_service` (`:49`) verbatim.
  - `user_id` is resolved as req, then `x-user-id`, then NULL (`:37-39`, LEDGER-7). `rowToEvent` maps NULL to `''`
    (`:376`).
  - `exportEvents` (`:282`) is the only user-scoped read (`WHERE user_id = $1`, `:311`; LEDGER-5/LEDGER-6).
  - Last migration: `003_events_user_id.up.sql`; next free `004`, none anticipated.
- **`xstockstrat-ui`** (Next.js). No UI discovery digest was run; the lines below were confirmed by targeted grep.
  - Hook `usePositionLineage` (`services/xstockstrat-ui/src/hooks/usePositionLineage.ts:7`) issues
    `queryEvents({eventType: 'order.filled', sourceService: 'trading', page: {pageSize: 100, pageToken: ''}})`
    (`:16-20`). It filters client-side on symbol, account and mode (`:22-28`). Its header comment (`:5`) restates
    `"trading"`.
  - Called from `src/app/trader/positions/page.tsx:110`; the empty state is at `:682`.
  - The BFF `queryEvents` (`src/lib/traderBff.ts:118-127`) calls `requireSession(ctx)` and rewrites only copilot stream
    keys. Everything else is forwarded with `backendHeaders(claims, ctx)`, so no user scoping is applied.
  - The e2e mock answers `sourceService: 'trading'` (`e2e/mock-backend.ts:456`).
  - The canonical fixture `e2e/fixtures/ledgerEvents.ts` already uses `xstockstrat-trading` (`:26`). `INVENTORY.md:81`
    lists the `order.filled` branch as still inline in `mock-backend.ts`.

## Patterns to REUSE

- **Side → sign conversion** → reuse the trading precedent `offlineFillsFromOrders`
  (`trading.go:876-886`, `if o.Side == tradingv1.OrderSide_ORDER_SIDE_SELL {` at `:880`). In portfolio, the side
  arrives as the `side.String()` form `"ORDER_SIDE_SELL"` / `"ORDER_SIDE_BUY"` (`trading.proto:76-79`). Negate qty
  for SELL and feed `pnl.Fill` (`pnl.go:26`); do not fork the fold.
- **Signed fold** → reuse `pnl.Fold` (`packages/proto/pnl/pnl.go`) unchanged; the defect is in the inputs, not the
  fold.
- **Side source for history** → reuse the existing ledger `stream_key` filter (`ledgerServiceImpl.ts:130-132`) to
  read an order's `order.created` / `order.submitted` by bare order id (the producer's `stream_key`,
  `trading.go:649`, `:665`, `:1805`). Join on the bare id, not the documented `order:{id}` form (doc drift below).
- **Payload struct** → extend the hand-written-struct convention (PORTFOLIO-4,
  `services/xstockstrat-portfolio/docs/context-constitution.md:23`). Any new side-bearing struct's JSON tags must
  match the producer keys exactly (`side`, `symbol`, `qty`, `order_id`).
- **Never-fabricate outcome** → reuse the feature 229 / PORTFOLIO-16 posture (`:34`): `GetPnL` returns
  `ErrQuotesUnavailable` (`portfolio_service.go:718`, mapped to UNAVAILABLE) rather than a silent 0. This is the
  precedent for the unresolvable-side decision; no new error class is needed if design picks "error".
- **GetPnL unit-test harness** → reuse `newQuoteSvc` (`portfolio_quote_deadline_test.go:93`) and the
  `TestGetPnL_AC6_BrokerValuedWithoutQuoteFetch` template (`:293`). A broker-valued position needs no quote fetch. The
  test helpers are `ctxWithUser`, `anyArgs`, `positionCols` and `posRow`; positions come from
  `mock.ExpectQuery("FROM portfolio.positions")`.
  - `newQuoteSvc` returns `*fakeLedger`, which ignores the request (`watchlist_service_test.go:254`, `:269-271`). The
    RED test needs a request-honouring fake (exact `SourceService` / `EventType` / `StreamKey` match).
  - Per C-13, a fake or fixture with a second consumer lands in the existing Go home
    `services/xstockstrat-portfolio/internal/testdata/` (present today: `marks.go`, `offline_pnl.go`). It does not
    stay inline in several test files.
  - Existing doubles to adapt or keep green: `fakeLedger` (`watchlist_service_test.go:254`) and `stopLedger`
    (`portfolio_risk_test.go:143`, `:148`; returns `f.events` regardless of the request).
- **AC-name test convention** → follow `TestGetPnL_AC5_*` / `TestGetPnL_AC6_*` (`portfolio_quote_deadline_test.go:268`,
  `:293`) and `TestGetPnL_AC28_*` (`offline_account_pnl_test.go:297`).
- **Trading fill-payload test (option (b) only)** → reuse the `recordingLedger` / `requestsByType` AppendEvent recorder
  (`trading_offline_test.go:60`, `:84`). Drive `applyBrokerOrderStatus` through the `CancelOrder` not-cancelable path
  (`trading_cancel_not_cancelable_test.go`). Do not hand-copy the payload map: `trading_fees_test.go:20` and
  `trading_ledger_userid_test.go:23` copy it, so they cannot catch a producer regression.
- **UI fixtures (FR-3)** → reuse `e2e/fixtures/ledgerEvents.ts` (`:26` already `xstockstrat-trading`) plus an
  `INVENTORY.md` row (C-12). Migrate the inline `order.filled` branch of `e2e/mock-backend.ts` (`:456`,
  `INVENTORY.md:81`); do not edit literals in place.
- **Per-user ledger scoping precedent (FR-3)** → `ExportEvents` (`ledgerServiceImpl.ts:311`, LEDGER-6: an empty caller
  matches zero rows, never all). The BFF already has `requireSession(ctx)` claims in hand (`traderBff.ts:118-127`), so
  scoping can key on `claims.user_id` against `payload.user_id` (because `LedgerEvent.user_id` is empty for
  pre-migration rows, `ledger.proto:35`).

## Existing Business Rules (preserve / extend)

Folded from the scenario-recon digest. About 90 scenarios were scanned and 12 are relevant: 11 PRESERVE, 1 EXTEND,
**0 CHANGE** (after the 2026-10-21 design reconciliation below: 13 relevant, 11 PRESERVE, 2 EXTEND, 0 CHANGE). No existing `@AC-*` asserts the buggy `source_service: "trading"` value or an empty lineage.

- **EXTEND** (reconciled 2026-10-21 at design write; was PRESERVE) `@AC-5` "GetPnL refuses to report unrealized P&L
  when a needed quote is unavailable" (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature`,
  `@feature-229`). `GetPnL` returns UNAVAILABLE rather than a fabricated figure. An unresolved fill side follows the
  same never-fabricate posture. Design adds FAILED_PRECONDITION / DEADLINE_EXCEEDED / CANCELED under ctx-first
  `classifyGetPnLError(ctx, err)`; the live-ctx UNAVAILABLE path and backing `TestClassifyGetPnLError` (`:6-8`) stay.
- **PRESERVE** (added 2026-10-21 at design write) platform `@AC-7` "A system-managed watchlist cannot be deleted via
  API or UI" (`docs/sdd/business-rules/platform.feature:34-41`, `@feature-127`). Today `toGRPCError`
  (`portfolio_handler.go:432`) maps FailedPrecondition to INTERNAL; design brings the wire into conformance (rule text
  unchanged), backed by adapter case `TestWire_DeleteSystemManagedWatchlist_F127AC7`.
- **PRESERVE** `@AC-6` "GetPnL values broker-synced positions from the broker price without a quote fetch" (same file).
  Unrealized stays 500 with `GetLatestQuotes` not called; the fix is realized-only.
- **PRESERVE** `@AC-6` "A one-sided quote with no close inside the bound leaves the position unpriced"
  (`services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature`, `@feature-231`). `GetPnL`
  stays UNAVAILABLE on an unpriced holding; a corrected realized fold must not mask it.
- **PRESERVE** `@AC-13` "Every portfolio read path values the one-sided position identically" (same file). `GetPnL`
  unrealized_pnl (19.80) stays at parity with the other read paths.
- **PRESERVE** `@AC-14` "A broker account's P&L is unaffected by the presence of an offline account"
  (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`, `@feature-157`). Offline realized is
  never added to broker `GetPnL` totals.
- **PRESERVE** `@AC-7` "A confirmed offline fill updates positions via the shared absolute-sync path" (same file). No
  `order.filled` is emitted for offline accounts (PORTFOLIO-9).
- **PRESERVE** `@AC-11` "A sell-to-close offline confirmation removes the position" (same file). Offline realized
  (+97.50) is account-grain via signed `offlineFillsFromOrders`; FR-2 must not alter it.
- **PRESERVE** `@AC-8` "Broker pollers skip offline accounts"
  (`services/xstockstrat-trading/acceptance/offline-account-portfolios.feature`). `pollFills` skips OFFLINE accounts,
  and this holds under option (b).
- **PRESERVE** `@AC-1` "A broker position explained by the platform's own filled orders does not halt"
  (`services/xstockstrat-trading/acceptance/fix-reconciliation-false-halt.feature`, `@feature-206`). If option (b)
  edits `applyBrokerOrderStatus`, the persisted `filled_qty` and net-filled-qty reconciliation stay intact.
- **PRESERVE** `@AC-8` "Each exported row carries the required fields"
  (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`, `@feature-021`). `source_service`
  `"xstockstrat-trading"` is the canonical string and history is immutable. The fix conforms the reader; the writer
  and the stored rows are not renamed.
- **EXTEND** `@AC-11` "The export returns only the authenticated user's own events" (same file). FR-3 adds the same
  kind of user scoping to the lineage read (`QueryEvents` via the BFF); `ExportEvents` is unchanged. This is the
  precedent for AC-3's no-`u-2` clause.
- **PRESERVE** `@AC-10` "A per-fill fee flows through the fee-capture plumbing into the net win test"
  (`docs/sdd/business-rules/platform.feature`, `@feature-029`). The `order.filled` `fees` key and `fees_total`
  semantics stay; any option (b) addition is additive only.
- No existing acceptance suite covers `GetPnL` realized P&L from broker `order.filled` / `order.partially_filled` in
  portfolio, trading or ledger. FR-1, FR-2, AC-1 and AC-2 are net-new.
- No existing acceptance suite for xstockstrat-ui covers the `/trader/positions` fill lineage, `usePositionLineage`,
  or `order.filled` QueryEvents. FR-3 and AC-3 are net-new there.
- Not impacted:
  - Portfolio `snapshot-offline-positions`, `drawdown-enforcement`, the watchlist and fundsignal suites,
    `quote-fanout-batching`, `fix-book-portfolio-page` `@AC-1`, and `fix-after-hours-positions-priced`
    `@AC-1/2/3/8/9/14`.
  - Trading `fix-reconciliation-false-halt` `@AC-2/3` and `offline-account-portfolios` `@AC-1/2/4/5/9`.
  - Ledger `ledger-event-export` `@AC-3/4/5/10`.
  - UI `strategy-performance-dashboard` (realized comes from `portfolio.position.closed`, not `GetPnL`).
  - Platform mTLS `@AC-5` (applies only if FR-3 adds a new RPC hop).
- Ambiguities carried:
  - The unresolved-side outcome has no suite guarantee; `@AC-5` / `@AC-6` (UNAVAILABLE over a fabricated figure) are
    the nearest precedent.
  - A status class other than UNAVAILABLE would need a new FR/AC.
  - A new `QueryEvents` user predicate would be an EXTEND of ledger scoping, not a CHANGE.
- Coverage:
  - Read in full: `platform.feature`, portfolio `fix-book-portfolio-page`, `offline-account-portfolios` and
    `fix-after-hours-positions-priced`, ledger `ledger-event-export`, and trading `fix-reconciliation-false-halt`.
  - Read in part: trading `offline-account-portfolios` (AC-4/5/8) and `snapshot-offline-positions` (titles only).
  - The remaining suites and all ui suites were scanned by keyword grep only.

## Dependencies

- Proto/RPC: none for the options in the product spec.
  - `QueryEventsRequest` (`packages/proto/ledger/v1/ledger.proto:60-67`) has fields 1-6 (`stream_key`, `event_type`,
    `source_service`, `time_range`, `page`, `from_sequence`). It has no user field; the next free number is 7, needed
    only if FR-3 moves scoping into the ledger (proto approval gate, C-09).
  - `LedgerEvent.sequence = 9` is global-monotonic and `user_id = 11` is empty pre-migration (`ledger.proto:33`, `:35`).
  - The fill payload is a `google.protobuf.Struct` (`trading.go:3662`), so option (b) needs no `.proto` change.
  - `OrderSide`: `ORDER_SIDE_BUY = 1`, `ORDER_SIDE_SELL = 2` (`trading.proto:76-79`); `Order.side = 4` (`:50`).
- Migration: none.
  - Next free numbers if design needs one: portfolio `018`, trading `012`, ledger `004`.
  - Historical ledger rows cannot be backfilled: `deny_mutation` triggers block UPDATE
    (`services/xstockstrat-ledger/migrations/001_ledger_events_hypertable.up.sql`).
- Config keys: none (ledger keys `ledger.export.*` are unrelated).
- Inter-service edges:
  - Existing: portfolio → ledger `QueryEvents`, and ui BFF → ledger `QueryEvents`. Option (a) adds more
    `QueryEvents` calls on the existing portfolio → ledger edge (by `StreamKey` per order, or a bulk `order.created` /
    `order.submitted` read).
  - No new edge and no new RPC hop, so header propagation (C-03) is unchanged.
- New env vars / ports: none.

## Risks / Not-found

- **Latent: `GetPnL` pagination loops on a token the ledger ignores.**
  - GetPnL pages by `PageToken` (`portfolio_service.go:755`, `:787-790`), but the ledger never reads `page_token` and
    returns `nextPageToken` whenever more than `pageSize` rows match (`ledgerServiceImpl.ts:157-171`).
  - Today defect 1 makes the match set empty, so the loop exits at once. Once FR-1 makes the filter match and the
    matching set exceeds 500 events, each iteration re-fetches page 1 and re-appends the same fills.
  - That repeats until the ctx deadline fails `QueryEvents`, which then hits the silent `slog.Warn` + `break`
    (`:756-759`). The result is an inflated realized figure or a hang. Nothing filters per user server-side, so the
    500 counts platform-wide.
  - **FR-1 cannot ship safely without addressing this.** Design must choose:
    - client-side paging by `from_sequence`, which needs care because order is `recorded_at ASC`, not `sequence`;
    - a ledger `page_token` fix (ledger becomes a fix site, LEDGER-5);
    - or a bounded single page with an explicit error.
  - The same gap caps the FR-3 hook at one platform-wide 100-event page (`usePositionLineage.ts:19`), which is the
    product-spec's "fill beyond the first page" AC.
  - Ledger rule (fails.md:1441, 140-chart-data-freshness, `ORDER BY ... ASC LIMIT N` + page-1-only): "treat a paginated read whose
    consumer only ever fetches page 1 as a red flag."
  - Ledger rule (fails.md:577, field accepted but never read): verify a request field is applied server-side before
    designing on it.
- **Silent short fold on query error.** `slog.Warn` + `break` (`:756-759`, and the same in pass 2) yields a partial
    realized figure with no error. This conflicts with the PORTFOLIO-16 never-fabricate posture once the fold is
    non-empty. Design decides whether it becomes `UNAVAILABLE`, keeping `@AC-5` compatible.
- **Unresolvable side** (no `order.created` / `order.submitted` sibling, or one outside the fetched set) has no FR/AC
  yet. Design appends one (C-15, next free ID `AC-4`).
  - Pending-approval orders have only `order.created` (`trading.go:654-662`), so `order.created` must be the primary
    side source.
  - Not searched: whether historical `order.created` rows predate the `side` key. This needs ledger data or git
    history, not code.
- **`order.created` payload has no `order_id` and no `user_id` key** (`trading.go:649-652`). The join key is
  `stream_key` alone, and the user check must come from the fill (or `LedgerEvent.user_id`, which is empty
  pre-migration).
- **Stream-key doc drift.** `services/xstockstrat-trading/CLAUDE.md:143-158` and `services/xstockstrat-ledger/CLAUDE.md:34`,
  `:101` document `order:{order_id}`, but order events store the bare id (`trading.go:649`, `:1805`;
  `ledgerServiceImpl.ts:51`).
  - Some events do use the prefix: `order_intent.resolved_by_reconciliation` (`trading.go:2223`, `:2247`, `:2278`) and
    `account:%s` (`:1067`).
  - Trading tests use `"order:"+id` (`trading_fees_test.go`, `trading_ledger_userid_test.go:23`), a shape production
    never writes. Join on the code, not the docs; fix the docs in the teardown audit.
- **Test doubles mask both defects.**
  - `fakeLedger.QueryEvents` ignores the request (`watchlist_service_test.go:269-271`).
  - `stopLedger` likewise (`portfolio_risk_test.go:148`).
  - The independent mirror `computeRealizedPnL` (`portfolio_helpers_test.go:112-135`) feeds signed `Qty: -100`
    (`TestRealizedPnL_ClosedLong`, `:144`), which trading never emits. It drifts from production if side resolution
    changes only in `GetPnL`.
  - Ledger unit tests use a mock pool that returns rows regardless of SQL, so they cannot prove predicate semantics.
  - fails.md 2026-08-26 (`order.cancelled` vs `order.canceled`): a consumer's event string must be copied from, or
    asserted against, the producer emit site with a parity test. A spelling mismatch is invisible to normal tests,
    which is exactly defect 1.
- **No shared source-service constant** exists anywhere: trading, portfolio and the UI use bare literals. A Go
  constant cannot reach the TS site (FR-3). Per C-18/YAGNI and the DRY guard rail, design weighs a shared constant
  against a literal plus a producer↔consumer parity test.
- **Live fold sign loss** (`processOrderFill`, `portfolio_service.go:311`) is out of scope.
  - No defect report covers it yet. `docs/reports/2026-10-03-portfolio-fill-sync-lost-update-defect.md` and
    `2026-10-06-portfolio-fill-fold-not-exactly-once-defect.md` touch `processOrderFill` but not the side.
  - context.md carries this as `[ ] unaddressed`. Design decides whether the side-resolution helper is shared with the
    live fold.
- **Overlap** (context.md, feature-overlap WARN):
  - `portfolio_service.go` is shared with 240 (GetPnL untouched there) and 242 (`emitRiskAlert`).
  - An exact-match `fakeLedger` must keep 240's `TestGetPnL_AC5_QuotesUnavailable` (`portfolio_quote_deadline_test.go:268`)
    green.
  - Under option (b), `trading.go` also overlaps 249 (`ibkrCreds`) and 241.
  - Ledger rule (fails.md 2026-09-02, 021): changing a shared helper's signature, such as `emitLedgerEvent`, needs every
    call site listed.
- **IBKR hedged mode** caveat on `order.filled` ordering: `services/xstockstrat-trading/docs/ibkr.md:11-12` (not read
  beyond the digest mention).
- Not found:
  - A helper resolving a fill's side from a sibling event.
  - Any join-by-`stream_key` code in portfolio.
  - A request-honouring ledger fake in portfolio tests.
  - A trading test driving `applyBrokerOrderStatus` end-to-end that asserts a fill payload.
  - Any trading acceptance scenario on fill payload shape.
  - Any ledger `source_service` alias or normalization.
  - Any `page_token` handling in `QueryEvents`.
- Not searched:
  - A full UI discovery (`traderBff.ts` beyond `:118-127`, `positions.spec.ts:147`, `api-smoke.spec.ts:207`).
  - The `docs/roadmap/ledger` corpus beyond keyword grep.

## Recommended Scope

Advisory input to the grilling and `/sdd-spec`; not binding.

1. **Portfolio test harness (RED first).** Add a request-honouring ledger fake (exact `SourceService` / `EventType` /
   `StreamKey`, plus paging behaviour that matches the real ledger) and producer-shaped fill and `order.created`
   fixtures in `internal/testdata/` (C-13). Write RED tests for AC-1 and AC-2, plus the appended unresolved-side,
   pagination and partial-then-filled ACs. Keep 240's GetPnL tests green.
2. **Portfolio FR-1.** Correct the `SourceService` in both passes, choosing between a literal plus parity test, a
   shared constant, and dropping the filter. Address the page-token loop and the silent `break` in the same step,
   because FR-1 unmasks them.
3. **Portfolio FR-2.** Resolve each fill's side from its order's `order.created` (falling back to `order.submitted`),
   joined on the bare `stream_key`, and negate SELL qty before `pnl.Fold`. Keep the dedup (`:839`) and the mode filter
   unchanged. Settle the unresolvable-side outcome (never-fabricate precedent) and decide on the
   `computeRealizedPnL` mirror.
4. **(Optional, option (b)) Trading producer.** Additive `side` key on both fill payloads (`trading.go:1805-1812`,
   `:1822-1829`), keeping `fees` (`@AC-10`). Test it by driving `applyBrokerOrderStatus`, not with a copied map.
   Portfolio prefers the payload `side` when present and falls back to the sibling join for history.
5. **UI FR-3.** Correct the hook filter (`usePositionLineage.ts:18`, plus the comment at `:5`). Add user scoping in the
   BFF `queryEvents` lineage branch on `claims.user_id` versus `payload.user_id`, scoped to the lineage read only.
   Settle pagination beyond one platform-wide page. Centralize fixtures in `e2e/fixtures/ledgerEvents.ts` plus
   `INVENTORY.md`. Add a Playwright test for AC-3 and the appended pagination AC.
6. **Teardown.**
   - Fix the stream-key doc drift (trading and ledger CLAUDE.md).
   - Update the `services/xstockstrat-portfolio/CLAUDE.md` § Ledger Events Consumed `order.partially_filled` row.
   - Run the context-forge refresh (root CLAUDE.md § Teardown).
   - Promote ACs into the portfolio and ui suites (C-16).
