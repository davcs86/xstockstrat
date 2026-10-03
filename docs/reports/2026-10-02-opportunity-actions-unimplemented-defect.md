# Defect: Opportunity Snooze/Dismiss/Take return Unimplemented (BFF method not registered)

**Recorded**: 2026-10-02
**Severity**: SEV-2
**Impact type**: broken-ui-action
**Environment**: production (main)
**Affected service(s)**: xstockstrat-ui
**Config-only fix possible**: no

## Observed

The Opportunities page (the shell's home, `HOME_HREF = '/insights/opportunities'`) calls
`analysisClient.setOpportunityAction` for Snooze/Dismiss, but the insights BFF router never
registers `setOpportunityAction` on `AnalysisService`, so connect-node answers `Unimplemented` and
every action fails. CI stays green because the e2e spec mocks the call in the browser with
`page.route`, bypassing the BFF.

## Expected

`setOpportunityAction` is registered in the insights BFF (owner-scoped via `backendHeaders`, like
the sibling analysis methods) and the actions persist. A BFF-level test exercises the real router
registration so the mock cannot mask it again.

## Reproduction

1. Sign in; open `/insights/opportunities` with at least one opportunity.
2. Click Snooze or Dismiss.
3. The request to `/insights/api/.../SetOpportunityAction` returns Unimplemented; nothing persists.

## Evidence

`services/xstockstrat-ui/src/hooks/useOpportunities.ts:63`
> (input) => analysisClient.setOpportunityAction(input),

`services/xstockstrat-ui/src/lib/insightsBff.ts:30-68` — `AnalysisService` registration has no
`setOpportunityAction` (grep across `src/lib/*Bff.ts`: 0 hits).

`services/xstockstrat-ui/e2e/insights/opportunities.spec.ts:79` — browser-level `page.route` mock.

`packages/proto/analysis/v1/analysis.proto:39` — the RPC exists.

## Root cause hypothesis

Missing one-line `forward(...)` registration when the action UI was added; the e2e mock sits above
the BFF so no test traverses the router.

## Confidence

high
