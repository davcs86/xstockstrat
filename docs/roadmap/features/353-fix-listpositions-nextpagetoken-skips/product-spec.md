# Product Spec: fix-listpositions-nextpagetoken-skips

**Type**: bug
**Defect Report**: `docs/reports/2026-11-16-portfolio-listpositions-page-token-skips-boundary-row-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-16

---

## Problem Statement

A full traversal of `ListPositions` drops positions. (1) `next_page_token` is the look-ahead row's symbol (`positions[pageSize].Symbol`) and the next page filters `symbol > token`, so the boundary row is never returned. (2) Ordering/filtering is on `symbol` alone, but the table is unique on `(user_id, symbol, trading_mode, account_id)`; a symbol held in several accounts/modes straddling a page boundary loses its remaining rows. Expected: every position exactly once regardless of page size.

## Reproduction Steps

1. As user U hold A, B, C (one account, one mode); call with `page_size=1`, empty token, then the returned token: B is skipped.
2. Hold A in two accounts; repeat with `page_size=1`: the second A row is dropped.

## Root Cause Hypothesis

`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:162,193-194`: look-ahead token plus non-unique keyset. Fix needs an opaque composite cursor matching an `ORDER BY` on the full key.

## Affected Services

xstockstrat-portfolio (callers: xstockstrat-analysis `_drain_held` and servicer ListPositions drains; xstockstrat-agent `get_positions`)

## Consumer Surface(s)

- UI `/trader/positions` (`xstockstrat-ui`): paginates with `nextPageToken` (`src/app/trader/positions/page.tsx:54-55,548-551`); no code change expected — its Next button stops skipping rows once the server is fixed.
- Agent tool `get_positions` / `get_positions_by_account_id` (`xstockstrat-agent`): opaque-token passthrough; no code change expected.
- Internal: analysis held-symbol drains (`live_loop._drain_held`, `servicer._drain_held_symbols`), trading reconcile (first page).

## Fix Scope

- [ ] No proto changes anticipated — `PageResponse.next_page_token` is already an opaque string (verify in design)
- [ ] No database migrations anticipated (an index on the full key is a design question)
- [ ] No config key changes anticipated

(Update after investigation)

## Acceptance Criteria

See `acceptance.feature`. Plus: a real-backend (`dbtest`) test traverses a multi-account symbol at page_size 1 and yields every position exactly once; existing tests pass; caller behavior reviewed.

## Out of Scope

- The sibling `ListByUser`/ListWatchlists defect (another session)
- Refactoring unrelated to the bug
