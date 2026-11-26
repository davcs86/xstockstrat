# Product Spec: fix-a-filtered-listopportunities

**Type**: bug
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-25-analysis-filtered-empty-opportunity-read-kicks-full-recompute-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-25

---

## Problem Statement

Observed: a ListOpportunities call whose filters (min_conviction, sources, action_filter, symbol)
match no rows triggers a full background universe recompute even when the user's queue holds
unexpired rows. On homelab staging `list_opportunities(min_conviction=1.01)` returned an empty page
and the queue was rebuilt (valid_until 2026-11-27T05:00Z → 2026-11-28T05:00Z). The UI position page
(`/trader/positions/[symbol]`) reads with a `symbol` filter and polls every 15s, so viewing a symbol
with no queue rows re-kicks the full compute on every poll.

Expected: when fresh rows exist for the user, a filtered read that matches nothing returns an empty
page without starting a recompute; background revalidation fires only on the cold and all-stale
paths.

## Reproduction Steps

1. Have a materialized, unexpired opportunity queue for a user.
2. Call ListOpportunities with `min_conviction` > 1.0, or `symbol` = a ticker absent from the queue.
3. Observe a background full recompute for the user (analysis reads the compute-only
   `opportunity.*` keys) and a new `valid_until` on the queue rows.

## Root Cause Hypothesis

`services/xstockstrat-analysis/app/handlers/servicer.py:4765-4788` tests emptiness on the
**filtered** fresh read and sets `q.kick_full = True` on every no-rows branch; the branch predates the
feature 190/215 server-side filters and never checks for unfiltered fresh rows (the repo already has
`has_fresh`, `app/repositories/opportunities.py:340`).

## Affected Services

- xstockstrat-analysis

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
- Event-driven queue invalidation on watchlist/position/signal change (separate capability, /sdd-story)
