# Product Spec: fix-trading-reconcile-reads

**Type**: bug
**GitHub Issue**: none — defect report `docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-17

---

## Problem Statement

Observed: `reconcileTick` (`services/xstockstrat-trading/internal/service/trading.go:2235-2238`) calls portfolio
`ListPositions` with `PageSize: 500` once per account and ignores `next_page_token`. For an account with more
than 500 positions, symbols past the first page are absent from `platformBySymbol` (:2244), read as qty 0, and
diverge from the broker. Unless `NetFilledQtyBySymbol` explains the broker qty, the symbol becomes a
reconciliation candidate and, after the grace ticks, `emitReconciliationFinding` halts the account
(`HALT_SOURCE_RECONCILIATION`).

Expected: reconcile compares the broker against the account's full platform position set, or skips the
account for the tick on a page error (like the existing `ppErr` path) — never compares against a truncated set.

## Reproduction Steps

1. `reconcileTick` unit test: fake portfolio client with 501 positions for the account, paging at 500 with a
   non-empty `next_page_token`; the 501st symbol's qty matches the broker; fake `NetFilledQtyBySymbol` does not
   explain it.
2. Run `reconcileTick` for `graceTicks + 1` ticks.
3. A quantity-discrepancy finding (and halt) is emitted for the 501st symbol.

## Root Cause Hypothesis

Reconcile assumed one page per account while the token was unreliable (fixed by feature 353). Fix: drain the cursor, failing closed per `docs/roadmap/ledger/fails.md:3311` (page error → skip the account for the tick), tested against a fake that ignores the token.

## Affected Services

xstockstrat-trading (upstream, unchanged: xstockstrat-portfolio `ListPositions`)

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
