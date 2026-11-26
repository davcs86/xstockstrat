# Product Spec: fix-a-filtered-listopportunities

**Type**: bug
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-25-analysis-filtered-empty-opportunity-read-kicks-full-recompute-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-25

---

## Problem Statement

Persona: a trader viewing a symbol's position page (`/trader/positions/[symbol]`), or an operator /
agent calling the MCP `list_opportunities` tool with filters.

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

`services/xstockstrat-analysis/app/handlers/servicer.py` `_read_opportunity_queue` tests emptiness
on the **filtered** fresh read (`opps.read(..., include_expired=False, ...)`, ~4765-4774); its `else`
branch (from ~4790) calls `count_for_user` (~4791) and sets `q.kick_full = True` (~4792) on every
no-rows path. The branch predates the feature 190/215 server-side filters and never checks for
unfiltered fresh rows (the repo already has `has_fresh`, `app/repositories/opportunities.py:340`).

## Functional Requirements

- **FR-1**: When the user has at least one unexpired (`valid_until > now()`) queue row, a
  ListOpportunities read whose filters (`min_conviction`, `sources`, `action_filter`, `symbol`)
  match no fresh row returns an empty page with `computing` false and does **not** start a
  background full recompute; the queue rows' `valid_until` is unchanged.
- **FR-2**: The existing revalidation paths are preserved: a cold read (no rows ever materialized
  and no still-fresh empty stamp — features 177/185) and an all-stale read (rows exist, none
  unexpired) still kick a background full recompute, with their current `computing` /
  `compute_failed` / serve-stale semantics. The fix gates the kick on "no fresh rows for the user"
  (e.g. `has_fresh`); it must not remove the kick from those paths.

## Consumer Surface(s)

- **xstockstrat-ui** `/trader/positions/[symbol]` — reads ListOpportunities with a `symbol` filter
  via `useOpportunities` (15s `refetchInterval`); also `/insights/opportunities` when filtered.
- **xstockstrat-agent** MCP `list_opportunities` tool — forwards the same filters.

No UI or tool code change: the response shape is unchanged; only the server-side recompute side
effect is removed.

## Affected Services

- xstockstrat-analysis

## Fix Scope

- [x] No proto changes (servicer-only fix)
- [x] No database migrations (`has_fresh` already exists)
- [x] No config key changes

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- A deliberate manual-recompute / invalidate RPC (the fix removes the `min_conviction=1.01`
  side-effect lever; any replacement is a separate capability — decision recorded at design)
- Event-driven queue invalidation on watchlist/position/signal change (separate capability, /sdd-story)
