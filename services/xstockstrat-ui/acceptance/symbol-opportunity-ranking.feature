# Promoted from docs/roadmap/features/200-symbol-opportunity-ranking/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-200` tag.
# Durable business rules xstockstrat-ui guarantees for ranking the /insights opportunities queue by
# symbol_score: the server-applied order is authoritative and the client never re-sorts.

Feature: symbol-opportunity-ranking (ui-service guarantees)
  As a trader, I want to sort the opportunities queue by one comparable symbol-level score,
  so that I can see which symbol to trade first.

  @AC-8 @FR-5 @feature-200
  Scenario: The opportunities queue can be ranked by symbol_score, server-authoritative
    Given a set of symbols with computed symbol_scores
    When a trader sorts the /insights opportunities queue by symbol score
    Then the SymbolGroupCard groups render in descending symbol_score order as returned by the server
    And the client does not re-sort the groups locally (server order is authoritative)
