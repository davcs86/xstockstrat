# Defect: CopilotRail fires a duplicate ListOpportunities RPC instead of sharing the page-1 cache

**Recorded**: 2026-09-26
**Severity**: SEV-3
**Impact type**: redundant-backend-rpc
**Environment**: production (present in both main and main-dev)
**Affected service(s)**: xstockstrat-ui (extra read fan-out to xstockstrat-analysis)
**Config-only fix possible**: no

## Observed

On `/insights/opportunities`, two `ListOpportunities` RPCs fire. `CopilotRail` calls
`useOpportunities(0)`, which defaults `sort` to `OpportunitySort.UNSPECIFIED` (0), producing the
React-Query key `['opportunities', 0, [], 0, 0]`. The Opportunities page calls the same hook with
`sortEnum` — which defaults to `OpportunitySort.CONVICTION` (1) — producing
`['opportunities', 0, [], 0, 1]`. The keys differ only in the trailing `sort` element, so React
Query holds two cache entries and issues two backend reads. CopilotRail's hook runs unconditionally
(above its `if (!showCopilot) return null` guard), so the second RPC fires even with the copilot rail
closed.

This violates feature 187 acceptance scenario @AC-7 ("CopilotRail shares the page-1 opportunities
cache; no separate ListOpportunities RPC"). Because the behavior is wrong on the shipped tree, the
strict @AC-7 single-RPC E2E assertion is not writable as a passing test — the @AC-7 regression guard
is deferred pending this fix (the other four 187 scenarios — @AC-2/3/5/8 — are covered).

## Expected

CopilotRail shares the Opportunities page's page-1 cache entry: exactly one `ListOpportunities` RPC,
with no duplicate read fan-out to xstockstrat-analysis (@AC-7).

## Reproduction

1. Open `/insights/opportunities`.
2. Observe the network: two POSTs to `xstockstrat.analysis.v1.AnalysisService/ListOpportunities` —
   one with `sort: CONVICTION`, one with `sort: UNSPECIFIED` — present even with the copilot rail
   toggled off.

## Evidence

`services/xstockstrat-ui/src/components/copilot/CopilotRail.tsx:37`
> const { data: oppData } = useOpportunities(0);

`services/xstockstrat-ui/src/app/insights/opportunities/page.tsx:116`
> useOpportunities(minConviction, effectiveSources, actionFilterEnum, sortEnum);

`services/xstockstrat-ui/src/app/insights/opportunities/page.tsx:100-105`
> const sortEnum: OpportunitySort = … : OpportunitySort.CONVICTION;

`services/xstockstrat-ui/src/hooks/useOpportunities.ts:30`
> queryKey: ['opportunities', minConviction, [...sources].sort(), actionFilter, sort],

## Root cause hypothesis

Feature 190 widened the query key from `['opportunities', minConviction]` to a five-element tuple and
made the page default `sort=CONVICTION`, but CopilotRail (and its `:36` comment, which still says
"Share the ['opportunities', 0] cache") was not updated and keeps the pre-190 `useOpportunities(0)`
call defaulting to `sort=UNSPECIFIED`. The keys therefore no longer match. One-line fix: align
CopilotRail's `sort` argument with the page's default (`OpportunitySort.CONVICTION`), or make both
call sites default to the same sort.

## Confidence

high
