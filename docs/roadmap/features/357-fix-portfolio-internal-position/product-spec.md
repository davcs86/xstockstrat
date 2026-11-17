# Product Spec: fix-portfolio-internal-position

**Type**: bug
**GitHub Issue**: none — defect report `docs/reports/2026-11-17-portfolio-internal-position-reads-truncate-at-500-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-17

---

## Problem Statement

Observed: four internal readers in `services/xstockstrat-portfolio/internal/service/portfolio_service.go` call
`s.repo.ListPositions(..., 500, "", ...)` once and discard `next_page_token`: `GetPortfolio` (:787), `GetPnL`
(:932), `broadcastSnapshot` (:1214), `checkRiskLimits` (:1283). A user holding more than 500 positions in the
call's scope gets results built from the first 500 rows, with no log, metric or error.

Expected: every internal reader covers all of the user's positions in scope (following the feature-353
composite cursor to the end) or fails visibly.

## Reproduction Steps

1. With the dbtest harness (`internal/repository/dbtest_helpers_test.go`, `seedPosition`), seed 501 positions
   for user U in one trading mode.
2. Call `GetPnL` (or `GetPortfolio`) for U in that mode.
3. The result covers 500 positions; the last row in `(symbol, trading_mode, account_id)` order is missing.

## Root Cause Hypothesis

The internal readers predate a working cursor (feature 353) and treated one 500-row page as all positions. Repo-level drain vs per-site loop is a design decision; enrichment must stay one batched call per RPC page (`@AC-1 @feature-178`).

## Affected Services

xstockstrat-portfolio

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
