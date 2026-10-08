# Promoted from docs/roadmap/features/200-symbol-opportunity-ranking/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-200` tag.
# Durable business rules xstockstrat-agent guarantees for exposing the symbol-level score through
# the MCP list_opportunities tool.

Feature: symbol-opportunity-ranking (agent-service guarantees)
  As an MCP agent, I want each symbol's roll-up score in the ranked opportunities response,
  so that I can compare symbols directly.

  @AC-9 @FR-5 @feature-200
  Scenario: The MCP agent can compare symbols by symbol_score
    Given AAPL has symbol_score 0.62 and MSFT has symbol_score 0.48
    When the agent requests the ranked opportunities
    Then the response exposes each symbol's symbol_score and AAPL is presented above MSFT
