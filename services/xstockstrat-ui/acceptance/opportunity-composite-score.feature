# Promoted from docs/roadmap/features/199-opportunity-composite-score/acceptance.feature at
# launch (Constitution C-16). Source-feature provenance on every scenario's `@feature-199` tag.
# Durable business rule xstockstrat-ui guarantees for the /insights opportunities queue: the persisted
# composite_score is shown as a 3-decimal scalar on the existing scoreColor scale, with no letter grade
# and no client-side re-sort. (The analysis compute/persistence guarantees and the agent
# list_opportunities projection are promoted to their own service suites.)

Feature: opportunity-composite-score (ui-service guarantees)
  As a trader, I want each opportunity to carry a single consolidated 0-1 composite score so that I can
  rank and compare opportunities at a glance without manually combining separate axes.

  @AC-8 @FR-7 @feature-199
  Scenario: The composite is exposed on the opportunities queue as a 3-decimal scalar
    Given an opportunity with a persisted composite_score of 0.732
    When a trader opens the /insights opportunities queue
    Then the opportunity row displays "0.732" colored via the existing scoreColor scale
    And no A-F letter grade is shown for the composite
    And the client does not re-sort the queue by the composite (server order is authoritative)
