# Product Spec: fix-copilotrail-duplicate-rpc

**Type**: bug
**Defect Report**: `docs/reports/2026-09-26-copilotrail-duplicate-listopportunities-rpc-defect.md`
**Severity**: SEV-3
**Created**: 2026-09-26

---

## Problem Statement

**Observed:** On `/insights/opportunities`, two `ListOpportunities` RPCs fire on load. `CopilotRail`
calls `useOpportunities(0)`, which defaults `sort` to `OpportunitySort.UNSPECIFIED` (0), producing
the React-Query key `['opportunities', 0, [], 0, 0]`. The Opportunities page calls the same hook with
`sortEnum`, which defaults to `OpportunitySort.CONVICTION` (1), producing `['opportunities', 0, [], 0, 1]`.
The keys differ only in the trailing `sort` element, so React Query holds two cache entries and issues
two backend reads. CopilotRail's hook runs unconditionally (above its `if (!showCopilot) return null`
guard), so the second RPC fires even with the rail closed.

**Expected:** CopilotRail shares the Opportunities page's page-1 cache entry — exactly one
`ListOpportunities` RPC, with no duplicate read fan-out to `xstockstrat-analysis` (feature 187 @AC-7).

## Reproduction Steps

1. Open `/insights/opportunities`.
2. Observe the network: two POSTs to `xstockstrat.analysis.v1.AnalysisService/ListOpportunities` —
   one with `sort: CONVICTION`, one with `sort: UNSPECIFIED` — present even with the copilot rail
   toggled off.

## Root Cause Hypothesis

Feature 190 widened the query key from `['opportunities', minConviction]` to a five-element tuple and
made the page default `sort=CONVICTION`, but `CopilotRail` (and its `:36` comment, still reading
"Share the ['opportunities', 0] cache") was not updated and keeps the pre-190
`useOpportunities(0)` call defaulting to `sort=UNSPECIFIED`. The keys therefore no longer match.
One-line fix: align CopilotRail's `sort` argument with the page's default (`OpportunitySort.CONVICTION`),
or make both call sites default to the same sort.

## Affected Services

- `xstockstrat-ui` (`src/components/copilot/CopilotRail.tsx`; the shared hook
  `src/hooks/useOpportunities.ts`; consumer parity with `src/app/insights/opportunities/page.tsx`).
  Extra read fan-out reaches `xstockstrat-analysis` but no analysis-side change is anticipated.

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

Single-file front-end fix (align the CopilotRail sort argument so its query key matches the page's
page-1 key).

## Acceptance Criteria

See `acceptance.feature` — the regression scenario that must fail on the buggy behavior (two RPCs)
and pass after the fix (one shared page-1 read). Plus: existing `opportunities.spec.ts` continues to
pass (35/35), and the deferred feature-187 @AC-7 strict single-RPC guard becomes writable once this
fix lands.

## Out of Scope

- Refactoring `useOpportunities` or the query-key shape beyond the sort alignment
- Any change to the CopilotRail note-thread / ledger behavior
- Performance work unrelated to the duplicate read
