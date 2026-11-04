# Durable per-service business rules for xstockstrat-agent, promoted from feature 274's
# acceptance.feature at launch (Constitution C-16). Source-feature provenance is carried on every
# scenario's `@feature-274` tag. These are the guarantees a future feature must not silently break.

Feature: otel-metrics-logs-export
  xstockstrat-agent records MCP tool duration with outcome.

  @AC-21 @FR-1 @regression @feature-274
  Scenario: The agent records MCP tool duration with outcome
    Given xstockstrat-agent runs with OTEL_ENABLED="true"
    When tool "get_strategy" raises an error, tool "list_formulas" returns an isError result, and tools/call names "no_such_tool"
    Then mcp.tool.duration has data points with gen_ai.tool.name="get_strategy" outcome="error", gen_ai.tool.name="list_formulas" outcome="error", and gen_ai.tool.name="unregistered"
