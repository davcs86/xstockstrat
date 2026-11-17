# Product Spec: fix-trading-reconcile-reads

**Type**: bug
**GitHub Issue**: none — defect report `docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-17

---

## Problem Statement

Who is affected: the trader (and the operator on call) of any broker account with more than 500 open
positions — their account can be halted for trading by a false reconciliation finding.

Observed: `reconcileTick` (`services/xstockstrat-trading/internal/service/trading.go:2235-2238`) calls portfolio
`ListPositions` with `PageSize: 500` once per account and ignores `next_page_token`. For an account with more
than 500 positions, symbols past the first page are absent from `platformBySymbol` (:2244), read as qty 0, and
diverge from the broker. Unless `NetFilledQtyBySymbol` explains the broker qty, the symbol becomes a
reconciliation candidate and, after the grace ticks, `emitReconciliationFinding` halts the account
(`HALT_SOURCE_RECONCILIATION`), which blocks `PlaceOrder`/`ReplaceOrder` for that account.

Expected: reconcile compares the broker against the account's full platform position set, or skips the
account for the tick on a page error (like the existing `ppErr` path) — never compares against a truncated set.

## Reproduction Steps

1. `reconcileTick` unit test: fake portfolio client with 501 positions for the account, paging at 500 with a
   non-empty `next_page_token`; the 501st symbol's qty matches the broker; fake `NetFilledQtyBySymbol` does not
   explain it.
2. Run `reconcileTick` for `graceTicks + 1` ticks.
3. A quantity-discrepancy finding (and halt) is emitted for the 501st symbol.

## Root Cause Hypothesis

Reconcile assumed one page per account while the token was unreliable (fixed by feature 353). Fix: drain the cursor, failing closed per `docs/roadmap/ledger/fails.md:3309-3312` (page error → skip the account for the tick; reject a repeated token), tested against a fake that ignores the token.

## Functional Requirements

- **FR-1** `reconcileTick` reads an account's platform positions from portfolio `ListPositions` page by
  page, following `next_page_token` until it is empty, and compares the broker against the full set.
  A held position on page 2 or later whose quantity matches the broker produces no finding and no halt.
- **FR-2** If any page of that read fails (error or deadline), the account's position-side check is
  skipped for that tick, as the existing `ppErr` path does today: no reconciliation candidate is recorded
  from a partial set and no halt is raised. The account is checked again on the next tick.
- **FR-3** If portfolio returns a `next_page_token` equal to the token the read just sent, the read
  stops and is treated as failed (FR-2 applies): the account's position-side check is skipped for that
  tick and the read does not loop.
- **FR-4** Applies to every broker type that `reconcileTick` covers today; the broker-side
  `GetPositions` read, the order-side reconcile and fill handling are unchanged.

## Consumer Surface(s)

No surface changes (C-14). The only observable effect is that a trader/operator no longer sees a false
reconciliation halt on an account with more than 500 positions — via the existing trader UI halt badge
(`HaltBadge`, shown in the trader account selector and the accounts panel) and the existing reconciliation alert. No MCP tool, RPC, proto or UI
change.

## Affected Services

xstockstrat-trading (upstream, unchanged: xstockstrat-portfolio `ListPositions`)

## Fix Scope

- [x] No proto changes (portfolio `ListPositions` already carries `page_token`/`next_page_token`)
- [x] No database migrations
- [x] No config key changes — the page read uses the existing reconcile per-call timeout; no new key

Dependency: rests on feature 353 (`fix-listpositions-nextpagetoken-skips`, code-completed), which makes
portfolio's `next_page_token` reliable. 358 must merge after 353 reaches `main-dev`.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Any portfolio-side change (feature 353 owns the token fix; other internal readers are feature 357)
- The broker `GetPositions` read and the order-side reconcile
- Features 351, 353 and 354 (not touched)
