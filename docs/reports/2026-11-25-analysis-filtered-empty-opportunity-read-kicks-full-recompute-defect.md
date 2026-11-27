# Defect: a filtered ListOpportunities read with no matches kicks a full recompute

**Recorded**: 2026-11-25
**Severity**: SEV-3
**Impact type**: excess-compute-load
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no

## Observed

A ListOpportunities call whose filters match no rows triggers a full background universe recompute
even when the user's queue holds unexpired rows. On homelab staging,
`list_opportunities(min_conviction=1.01)` returned an empty page and analysis began a full compute
within seconds (config reads of the compute-only keys at 2026-11-25T20:53Z); the queue was rebuilt
(valid_until moved 2026-11-27T05:00Z → 2026-11-28T05:00Z). The UI position page
(`/trader/positions/[symbol]`) reads with a `symbol` filter and polls every 15s, so viewing a symbol
with no queue rows re-kicks the full compute on every poll.

## Expected

When fresh rows exist for the user, a filtered read that matches nothing returns an empty page and
does not start a recompute; the background revalidation fires only on the cold and all-stale paths.

## Reproduction

1. Have a materialized, unexpired opportunity queue for a user.
2. Call ListOpportunities with `min_conviction` > 1.0 (or `symbol` = a ticker absent from the queue).
3. Observe a background `_kick_opportunity_recompute` for the user (analysis logs read
   `opportunity.max_universe_size` etc.) and a new `valid_until` on the queue rows.

## Evidence

`services/xstockstrat-analysis/app/handlers/servicer.py:4765-4788`
> q.kick_full = True  # every no-rows branch revalidates in the background

The emptiness test runs on the filtered read (`include_expired=False` plus sources, action_filter,
symbol, min_conviction) before `count_for_user`, so "no rows matched the filter" and "no fresh rows"
take the same branch.

`services/xstockstrat-ui/src/hooks/useOpportunities.ts:30,49`
> symbol = '',
> refetchInterval: 15_000,

## Root cause hypothesis

The no-rows branch predates the feature 190/215 server-side filters; it was not narrowed to check
for fresh rows unfiltered (`has_fresh`) before deciding to revalidate.

## Confidence

high
