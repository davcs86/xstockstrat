# Product Spec: fix-getpnl-source-service

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** `PortfolioService.GetPnL` folds `order.filled` and `order.partially_filled` ledger events fetched with
`QueryEvents{EventType: …, SourceService: "trading"}` (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:683`
pass 1, `:728` pass 2; the report cites `:670-672`/`:715-717` at 1302e6d). Trading's `emitLedgerEvent` stamps
`SourceService: "xstockstrat-trading"` (`services/xstockstrat-trading/internal/service/trading.go:1861`, `:2106`,
`:2674`). The ledger applies `source_service` as an exact-match predicate
(`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:138-140`). Both passes return no events, so
`PnLResponse.realized_pnl` is 0 for every user and mode, with no error or warning. Unrealized P&L is unaffected.
No in-repo caller invokes `GetPnL` today; any gRPC consumer gets the wrong realized figure.

**Expected.** `GetPnL` matches the source service trading actually writes (shared constant or literal
`"xstockstrat-trading"`, or no `SourceService` filter since the event types are trading-owned). Realized P&L equals
the fold of the user's fills.

## Reproduction Steps

1. Copy the report's scratch test `zz_getpnl_source_test.go` into `services/xstockstrat-portfolio/internal/service/`.
2. `GOWORK=off go test ./internal/service/ -run TestZZ_ -v`. Its fake ledger mirrors the exact-match filter and
   stores two fills: buy 10 @ 100, then sell 10 @ 150.
3. Events stored as `"xstockstrat-trading"` → `realized=0`; control stored as `"trading"` → `realized=500`.

## Root Cause Hypothesis

The service name is a bare literal on both sides with no shared constant; portfolio assumed the short name. The
`GetPnL` test double ignores the request (`watchlist_service_test.go:268`), so CI never exercised the filter.

## Affected Services

- xstockstrat-portfolio (fix site)
- xstockstrat-trading (writer of `source_service`; changes only if a shared constant is adopted)
- xstockstrat-ledger (exact-match filter; read-only evidence, no change expected)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Other `SourceService` literals (e.g. portfolio's own `"portfolio"` emits at `portfolio_service.go:943`, `:958`) unless design finds a consumer mismatch
