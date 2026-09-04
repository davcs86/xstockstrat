Feature: fix-agent-trading-mode-otel-attr (bug fix)
  Regression guard for comment-audit report item 1: the agent's OTel resource attributes must
  reflect the post-feature-147 model, not the retired trading_mode config/scope axis.

  @AC-1 @regression
  Scenario: Agent OTel resource attributes carry no retired trading_mode axis label
    Given OTEL_ENABLED is "true" and TRADING_MODE is set to "paper"
    When xstockstrat-agent initialises telemetry and builds its OTel Resource
    Then the resource attributes reflect the decided post-147 shape (the "trading_mode" attribute is
      either absent or renamed to an explicitly-scoped key)
    And deployment.environment continues to carry the environment derived from APPLICATION_ENV

  @AC-2 @regression
  Scenario: Telemetry init never blocks agent startup
    Given OTEL_ENABLED is "true"
    When the OTel packages are present and the Resource is built with the corrected attribute set
    Then init_telemetry() completes without raising
    And the agent proceeds to serve its MCP transport
