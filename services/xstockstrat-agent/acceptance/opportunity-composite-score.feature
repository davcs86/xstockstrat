# Promoted from docs/roadmap/features/199-opportunity-composite-score/acceptance.feature at
# launch (Constitution C-16). Source-feature provenance on every scenario's `@feature-199` tag.
# Durable business rule xstockstrat-agent guarantees for the list_opportunities MCP tool: the persisted
# composite_score is projected through to the tool response. (The analysis compute/persistence
# guarantees and the /insights render are promoted to their own service suites.)

Feature: opportunity-composite-score (agent-service guarantees)
  What the xstockstrat-agent list_opportunities MCP tool guarantees: it surfaces the composite score
  ListOpportunities returns on each opportunity.

  @AC-9 @FR-7 @feature-199
  Scenario: The composite reaches the list_opportunities MCP tool response
    Given an opportunity with a persisted composite_score of 0.512
    When the list_opportunities MCP tool returns that opportunity
    Then the returned opportunity object includes the composite score field valued 0.512
