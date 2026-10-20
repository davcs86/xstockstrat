# Product Spec: fix-getpnl-source-service

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

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
`order.created` payload has no `order_id` key.

**Expected.**

- **FR-1.** `GetPnL`'s ledger queries match the `source_service` trading actually writes (design fork: literal
  `"xstockstrat-trading"`, a shared constant, or no `SourceService` filter since the event types are trading-owned).
- **FR-2.** Each fill folds with trading's recorded side: a SELL contributes a negative signed qty to `pnl.Fill.Qty`, a
  BUY a positive one. This holds for events in the shape trading writes today (unsigned `qty` / `filled_qty`, no
  `side` key), because ledger rows are immutable and history keeps that shape after any producer change.

Realized P&L then equals `pnl.Fold` of the user's signed fills.

## Consumer Surface(s)

None. Internal/platform-only: no in-repo UI or agent caller of `GetPnL` (verified; rpc at
`packages/proto/portfolio/v1/portfolio.proto:15`, no hit under `services/xstockstrat-ui/src` or
`services/xstockstrat-agent/app`). Any gRPC consumer gets the wrong realized figure.

## Reproduction Steps

1. In `services/xstockstrat-portfolio/internal/service/`, give the test ledger an exact-match `QueryEvents` (the existing
   `fakeLedger.QueryEvents` ignores the request, `watchlist_service_test.go:268-271`).
2. Store events in trading's real shape, source_service `"xstockstrat-trading"`: per order an `order.created`
   (`stream_key` = order id, payload `symbol`, `side`, `qty`), and per fill an `order.filled`
   (`order_id`, `symbol`, unsigned `qty`, `fill_price`, `user_id`, `trading_mode`, `account_id`, `fees`). Buy 10 AAPL @ 100,
   then sell 10 AAPL @ 150.
3. `GOWORK=off go test ./internal/service/ -run <test> -v` → `realized=0` (defect 1 empties the fold; with defect 1
   alone fixed, defect 2 still yields 0).

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

## Scope Decision (P-03 — escalated to operator, pending)

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

Open questions for design recon: every path that emits `order.filled` / `order.partially_filled` has a side-bearing
sibling event (`submitOrder` emits `order.created` at `trading.go:649`, covering `PlaceOrder` `:544` and the bracket
flatten `:2838`); whether any historical rows predate the `side` key; behaviour when a fill's side cannot be resolved.

## Affected Services

- xstockstrat-portfolio (fix site)
- xstockstrat-trading (writer of `source_service` and the fill payloads; fix site only if design picks (b) or a shared
  source-service constant)
- xstockstrat-ledger (exact-match filter; read-only evidence, no change expected)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Other `SourceService` literals (portfolio's own `"portfolio"` at `portfolio_service.go:1013`, a notify `EmitAlert`, and
  `:1028`, the ledger `AppendEvent` in `emitEvent`) unless design finds a consumer mismatch
- The live position fold's identical sign loss: `processOrderFill` treats `fill.Qty > 0` as buying more
  (`portfolio_service.go:310-317`), so a trading sell `order.filled` (unsigned qty, `trading.go:1807`) grows the
  position until the next `account.positions.synced` reconciliation. Design recon verifies it; it gets its own defect
  report, not a silent widening of this fix (P-03)
