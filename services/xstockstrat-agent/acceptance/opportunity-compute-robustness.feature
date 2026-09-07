# Promoted from docs/roadmap/features/185-opportunity-compute-robustness/acceptance.feature at
# code-completion (Constitution C-16). Source-feature provenance on every scenario's `@feature-185` tag.
# Durable business rule xstockstrat-agent guarantees for the list_opportunities MCP tool: the
# data-unavailable state is projected through to the tool response, and the Opportunity descriptor-parity
# test asserts every proto field is projected (no silent drift). (The analysis compute/recovery
# guarantees and the /insights render are promoted to their own service suites.)

Feature: opportunity-compute-robustness (agent-service guarantees)
  What the xstockstrat-agent list_opportunities MCP tool guarantees: it surfaces the data-unavailable
  state ListOpportunities returns, and a descriptor-parity test keeps every Opportunity proto field from
  being silently dropped in the projection.

  @AC-10 @FR-6 @feature-185
  Scenario: The agent list_opportunities tool surfaces the data-unavailable state
    Given ListOpportunities returns a row with data_unavailable set
    When the list_opportunities MCP tool projects the response
    Then the projected row carries data_unavailable
    And the Opportunity descriptor-parity test asserts every proto field is projected (no silent drift)
