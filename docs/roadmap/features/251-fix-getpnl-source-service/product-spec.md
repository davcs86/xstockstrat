# Product Spec: fix-getpnl-source-service

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Who is affected.** A trader reading realized P&L through any gRPC consumer of `GetPnL` (no in-repo caller, see
Consumer Surface(s)), and a trader inspecting a position's fill lineage in `/trader/positions`.

**Observed (defect 1 — source_service filter).** `PortfolioService.GetPnL`
(`services/xstockstrat-portfolio/internal/service/portfolio_service.go:722`) folds `order.filled` and
`order.partially_filled` ledger events fetched with `QueryEvents{EventType: …, SourceService: "trading"}`
(`portfolio_service.go:753` pass 1, `:798` pass 2; the report cites `:670-672`/`:715-717` at 1302e6d). Trading stamps
ledger writes in one place: `emitLedgerEvent` (`services/xstockstrat-trading/internal/service/trading.go:3661`,
`SourceService: "xstockstrat-trading"` at `:3667`), called for fills at `:1805` (`order.filled`) and `:1822`
(`order.partially_filled`). The other seven `"xstockstrat-trading"` literals in `trading.go` (`:1943`, `:2188`, `:2756`,
`:3068`, `:3347`, `:3683`, `:3699`) are `notify.EmitAlert` sources, not ledger writes. The ledger applies `source_service`
as an exact-match predicate (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:138-141`). Both passes return
no events, so `PnLResponse.realized_pnl` is 0 for every user and mode, with no error or warning. Unrealized P&L is
unaffected.

**Observed (defect 2 — sell sign lost, masked by defect 1).** Trading's fill payloads carry an unsigned quantity and
no `side` key: `order.filled` writes `"qty": order.Qty` (`trading.go:1805-1812`), `order.partially_filled` writes
`"filled_qty": order.FilledQty` (`:1822-1829`). `Order.qty` is unsigned with direction in the separate `side` field
(`packages/proto/trading/v1/trading.proto:50`, `:53`). `GetPnL` passes `fill.Qty` / `fill.FilledQty` straight into
`pnl.Fill.Qty` (`portfolio_service.go:785`, `:842`), which is signed, positive = buy, negative = sell
(`packages/proto/pnl/pnl.go:23-26`), and `orderFillPayload` has no side field (`portfolio_service.go:245-260`). A sell
therefore folds as a same-direction add (`pnl.go:68-71`), so realized stays 0 even after defect 1 is fixed. Trading
records the side only on the order's `order.created` / `order.submitted` events (`"side": order.Side.String()`,
`trading.go:650`, `:666`, `:843`), whose `stream_key` is the order id (`:649`, as for the fills at `:1805`); the
`order.created` payload has no `order_id` key. The stream key is the bare id, stored verbatim
(`ledgerServiceImpl.ts:51`), not the `order:{order_id}` form `services/xstockstrat-trading/CLAUDE.md` and
`services/xstockstrat-ledger/CLAUDE.md` document (doc drift, teardown audit).

**Observed (defect 1, second reader — UI fill lineage).** The `/trader/positions` fill-lineage sheet queries
`{eventType: 'order.filled', sourceService: 'trading'}` (`services/xstockstrat-ui/src/hooks/usePositionLineage.ts:16-20`,
called at `src/app/trader/positions/page.tsx:110`). The BFF forwards it unchanged except copilot stream keys
(`src/lib/traderBff.ts:118-124`), so the sheet always renders its empty state (`page.tsx:680-682`). The e2e mock
answers `sourceService: 'trading'` whatever the filter (`e2e/mock-backend.ts:456`), hiding it as the `GetPnL` fake
does. Ledger `QueryEvents` has no user predicate (`ledgerServiceImpl.ts:124-162`; security audit
`docs/reports/2026-09-16-trading-system-security-audit.md:175-176`) and the hook filters by symbol/account/mode
client-side only (`usePositionLineage.ts:22-28`), so correcting the filter alone would ship every user's
`order.filled` events to the browser.

## Functional Requirements

- **FR-1.** `GetPnL`'s ledger queries match the `source_service` trading actually writes (design fork: literal
  `"xstockstrat-trading"`, a shared constant, or no `SourceService` filter since the event types are trading-owned).
- **FR-2.** Each fill folds with trading's recorded side: a SELL contributes a negative signed qty to `pnl.Fill.Qty`, a
  BUY a positive one. This holds for events in the shape trading writes today (unsigned `qty` / `filled_qty`, no
  `side` key), because ledger rows are immutable and history keeps that shape after any producer change.
- **FR-3.** The `/trader/positions` fill lineage lists the signed-in trader's `order.filled` events for the selected
  position as trading writes them (`source_service` `"xstockstrat-trading"`; same fork as FR-1, a Go constant does not
  reach this TypeScript site), and the ledger response delivered to the browser carries no other user's event.

Realized P&L then equals `pnl.Fold` of the user's signed fills.

**Mode and broker scope (C-2, C-3).** `GetPnL`'s `trading_mode` filter (`portfolio_service.go:775-783`, `:820-828`)
is unchanged: the fix changes which fills reach it and their sign, not mode scoping, so it is paper-safe (unit tests,
dev smoke on paper). Fill events reach the ledger only from `applyBrokerOrderStatus` (`trading.go:1772`, emits
`:1805`/`:1822`), called by `pollFills` (`:1766`) and the `CancelOrder` not-cancelable re-read (`:1394`), for ALPACA and
IBKR alike, so the fix is broker-agnostic. OFFLINE accounts never emit `order.filled` (`pollFills` skips them,
`:1715-1721`; `ConfirmOrder` emits `account.positions.synced` only, `:888-889`), keep the signed
`offlineFillsFromOrders` fold (`:874-886`), and stay out of `GetPnL` realized (feature 240 `product-spec.md:177`). No
order-execution or broker behavior changes.

## Consumer Surface(s)

- **`/trader` (xstockstrat-ui)** — positions page fill-lineage sheet (`page.tsx:110`, `:676-688`): goes from always
  empty to the trader's own fills (FR-3, AC-3).
- **`GetPnL`** — no in-repo UI or agent caller (verified; rpc at `packages/proto/portfolio/v1/portfolio.proto:15`, no
  hit under `services/xstockstrat-ui/src` or `services/xstockstrat-agent/app`). Internal/platform-only in this repo;
  any external gRPC consumer gets the corrected `realized_pnl` (FR-1, FR-2).
- **Agent tools** — none: no `xstockstrat-agent` tool calls `GetPnL` or reads `order.filled`.

## Reproduction Steps

1. In `services/xstockstrat-portfolio/internal/service/`, give the test ledger an exact-match `QueryEvents` (the existing
   `fakeLedger.QueryEvents` ignores the request, `watchlist_service_test.go:268-271`).
2. Store events in trading's real shape, source_service `"xstockstrat-trading"`: per order an `order.created`
   (`stream_key` = order id, payload `symbol`, `side`, `qty`), and per fill an `order.filled`
   (`order_id`, `symbol`, unsigned `qty`, `fill_price`, `user_id`, `trading_mode`, `account_id`, `fees`). Buy 10 AAPL @ 100,
   then sell 10 AAPL @ 150.
3. `GOWORK=off go test ./internal/service/ -run <test> -v` → `realized=0` (defect 1 empties the fold; with defect 1
   alone fixed, defect 2 still yields 0).
4. UI: on dev, open `/trader/positions`, select a position with a trading fill → the sheet shows "No order.filled
   events for this position." (`page.tsx:682`).

The report's scratch test lives in a session scratchpad, not the repo, and its control fixture stores the sell as
qty `-10` (`zz_getpnl_source_test.go:44`), a shape trading never emits (breaks PORTFOLIO-4). The `/sdd-spec` RED test
must use the producer shape above, not that file.

## Root Cause Hypothesis

1. The service name is a bare literal on both sides with no shared constant; portfolio assumed the short name.
2. The fill payload contract never carried direction. `pnl.Fill.Qty` expects a signed qty; trading's own offline fold
   re-applies the sign from `Side` (`trading.go:874-883`), but portfolio's broker-fill path has no side in the payload.
   Defect 1 hid this, since the fold always ran over an empty set.
3. CI never exercised either: the `GetPnL` test double ignores the request (`watchlist_service_test.go:268-271`), and
   the only fixture that produced a non-zero realized figure used a signed sell qty the producer never writes.

## Scope Decision (P-03 — escalated to operator, pending; recorded in context.md 2026-10-20)

The spec keeps FR-2 in scope so AC-1/AC-2 hold the unweakened requirement (realized = fold of the user's fills,
history included). Fix-site fork for `/sdd-design`:

- **(a) Portfolio-only.** `GetPnL` resolves each fill's side from the order's `order.created` / `order.submitted`
  `side`, joined by `stream_key` = order id. Corrects history without a backfill.
- **(b) (a) plus producer change.** Trading also adds `side` (or a signed qty) to both fill payloads
  (`trading.go:1805-1812`, `:1822-1829`). Payload is a `google.protobuf.Struct` (`trading.go:3662`), so no `.proto`
  change. Makes xstockstrat-trading a fix site. On its own it cannot satisfy AC-1/AC-2, since existing rows lack `side`.

Operator-only alternative: split defect 2 into a named follow-up and restate AC-1/AC-2 as source_service-only
outcomes. That drops FR-2 from this feature (a weakening) and needs explicit operator sign-off recorded in
`context.md`.

FR-3 is in scope per C-10 (same defect, second reader); the user-scoping clause is what keeps the filter fix from
turning an empty sheet into a cross-user read. Operator-only alternative: defer FR-3/AC-3 to a named follow-up
feature `fix-position-lineage-source-service`, which C-14 accepts only with operator sign-off recorded in `context.md`.

Open questions for design recon: every path that emits `order.filled` / `order.partially_filled` has a side-bearing
sibling event (`submitOrder` emits `order.created` at `trading.go:649`, covering `PlaceOrder` `:544` and the bracket
flatten `:2838`); whether any historical rows predate the `side` key; behaviour when a fill's side cannot be resolved;
where FR-3's user scoping lives (BFF `queryEvents` `traderBff.ts:118-124` vs a dedicated read) and whether the hook's
single 100-event page (`usePositionLineage.ts:19`) over the platform-wide `recorded_at ASC` stream
(`ledgerServiceImpl.ts:157-162`) must paginate; FR-3 scoping keys on `payload.user_id`, since `LedgerEvent.user_id`
is empty for pre-migration rows (`packages/proto/ledger/v1/ledger.proto:35`); whether the side-resolution helper is
shared with the live fold (Out of Scope, last item).

Product decisions design must settle, each as an appended FR and `@AC-*` (C-15, IDs append-only):

- The outcome when a fill's side cannot be resolved (no sibling `order.created`/`order.submitted`, or the sibling
  outside the fetched page): fold as a buy, skip the fill, or return an error. Feature 229's never-fabricate precedent
  (`UNAVAILABLE` over a silent 0, `services/xstockstrat-portfolio/CLAUDE.md`) applies.
- A lineage scenario where the trader's fill sits beyond the first platform-wide 100-event page; AC-3 (one `u-1`
  event, one `u-2` event) does not catch a BFF post-filter that misses it.

## Affected Services

- xstockstrat-portfolio (fix site)
- xstockstrat-trading (writer of `source_service` and the fill payloads; fix site only if design picks (b) or a shared
  source-service constant)
- xstockstrat-ledger (exact-match filter; read-only evidence, no change expected)
- xstockstrat-ui (fix site for FR-3: `usePositionLineage.ts` and its BFF read path)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

The proto box (and "ledger: no change expected") holds only while FR-3's user scoping stays in the BFF
(`traderBff.ts:118-124`). `QueryEventsRequest` has no user field (`ledger.proto:60-67`), so a dedicated ledger read
needs an additive proto field (proto approval gate) and a ledger change; design then re-opens these boxes and
Affected Services.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Other `SourceService` literals (portfolio's own `"portfolio"` at `portfolio_service.go:1013`, a notify `EmitAlert`, and
  `:1028`, the ledger `AppendEvent` in `emitEvent`). The only runtime readers using the short name `"trading"` are
  `portfolio_service.go:753`, `:798` and `usePositionLineage.ts:18` (repo grep 2026-10-20); all three are in scope.
- Test-fixture uses of `'trading'` (ledger, notify and analysis unit tests, `e2e/fixtures/alerts.ts`), except the
  lineage fixtures an FR-3 test needs (`e2e/mock-backend.ts:456`, `e2e/trader/positions.spec.ts:147`,
  `e2e/trader/api-smoke.spec.ts:207`). FR-3 test fixtures centralize in the canonical home
  `e2e/fixtures/ledgerEvents.ts` (its rows already use `xstockstrat-trading`, `:26`) with an `INVENTORY.md` entry
  (C-12/C-13), not in-place literal edits
- User-partitioning the BFF `queryEvents` for other event types or stream keys (security audit
  `2026-09-16-trading-system-security-audit.md:175-176`); FR-3 scopes only the lineage read
- The live position fold's identical sign loss: `processOrderFill` treats `fill.Qty > 0` as buying more
  (`portfolio_service.go:310-317`), so a trading sell `order.filled` (unsigned qty, `trading.go:1807`) grows the
  position until the next `account.positions.synced` reconciliation. Confirmed at product-spec review (2026-10-20).
  Named follow-up: a `/sdd-qa defect` report under `docs/reports/`, filed before `/sdd-design` and carried as
  `[ ] unaddressed` in context.md until its path is cited here; not a silent widening of this fix (P-03, C-10)
