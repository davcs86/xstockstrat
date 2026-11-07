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

  # Promoted from docs/roadmap/features/289-fix-analysis-admin-formula-refusal/acceptance.feature
  # (Constitution C-16). Every @feature-289 scenario below assumes that feature's Background:
  #   Given admin user "admin-1" (x-access-scope admin) owns live strategies "s-1" and "s-2", both bound to symbol "MYSZ" (and "s-2" also to symbol "AAPL")
  #   And a component formula "f-9" of "s-1" is authored by user "user-2", while all components of "s-2" are readable by "admin-1"
  #   And the entry rule of "s-1" references "f-9"
  # "the unreadable-formula marker" is the bool formula_unreadable (Opportunity field 25, SymbolReadiness field 6; provenance token and readiness_json key "formula_unreadable").

  @AC-6 @FR-2 @feature-289
  Scenario: The agent exposes the unreadable-formula marker
    Given the "s-1" row for "MYSZ" carries the unreadable-formula marker
    When the agent tool list_opportunities is called as "admin-1"
    Then the returned "MYSZ" row for "s-1" carries the unreadable-formula marker
