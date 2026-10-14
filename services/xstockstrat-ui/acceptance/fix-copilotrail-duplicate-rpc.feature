# Promoted from docs/roadmap/features/213-fix-copilotrail-duplicate-rpc/acceptance.feature on launch
# (C-16). Scenarios are verbatim; each carries its source `@AC-*` and a `@feature-213` tag.
# Durable business rule xstockstrat-ui guarantees: the Opportunities page and CopilotRail share one
# page-1 ListOpportunities query. A rule enters only by promotion.
Feature: fix-copilotrail-duplicate-rpc (bug fix)
  Regression guard for the defect
  docs/reports/2026-09-26-copilotrail-duplicate-listopportunities-rpc-defect.md (pruned 2026-10-05; git show 2ce8de0a:docs/reports/<file>):
  CopilotRail must share the Opportunities page-1 query cache instead of issuing a
  second ListOpportunities RPC (feature 187 @AC-7).

  @AC-1 @regression @feature-213
  Scenario: the Opportunities page issues a single ListOpportunities RPC for page 1
    Given the Opportunities page and the CopilotRail both read the page-1 opportunity queue
    When the Opportunities page loads at its default sort
    Then exactly one ListOpportunities RPC is issued for page 1
    And CopilotRail renders from the shared page-1 cache rather than a second request with a different sort
