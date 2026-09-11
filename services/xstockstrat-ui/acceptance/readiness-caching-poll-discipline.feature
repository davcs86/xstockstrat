# Promoted from docs/roadmap/features/177-readiness-caching-poll-discipline/acceptance.feature at
# launch (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-177`
# tag. Durable business rules xstockstrat-ui already guarantees — a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring.

Feature: readiness-caching-poll-discipline
  What xstockstrat-ui guarantees on the Watchlist detail pane: the readiness query's per-query
  staleTime suppresses a refetch on remount within the freshness window, so switching away and back
  does not re-issue the backend readiness fan-out through the BFF.

  @AC-3 @FR-2 @feature-177
  Scenario: Remounting the watchlist detail pane within staleTime does not refetch
    Given the readiness useQueries staleTime is 30 seconds
    And the watchlist detail pane was rendered 10 seconds ago
    When the user switches away and back to the same watchlist
    Then no new EvaluateReadiness request is issued to the BFF
