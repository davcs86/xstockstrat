Feature: fix-agent-trading-mode-otel-attr (bug fix — fleet-wide, re-scoped)
  Regression guard for comment-audit report item 1: the redundant `trading_mode` OTel resource
  attribute is removed from every telemetry module (it duplicated `deployment.environment` 1:1 and was
  queried by nothing), leaving the rest of the attribute set and telemetry init intact.

  @AC-1 @FR-1 @regression
  Scenario Outline: A telemetry module's built Resource no longer carries the trading_mode attribute
    Given OTEL_ENABLED is "true" and TRADING_MODE is set to "paper"
    When <service> initialises telemetry and builds its OTel Resource
    Then the resource attributes do NOT include "trading_mode"
    And they still include "service.name", "deployment.environment", and "platform"

    # Every backend telemetry module is tested (no representative waiver) — one assertion per module.
    Examples:
      | service                 |
      | xstockstrat-trading     |
      | xstockstrat-portfolio   |
      | xstockstrat-marketdata  |
      | xstockstrat-agent       |
      | xstockstrat-ingest      |
      | xstockstrat-indicators  |
      | xstockstrat-analysis    |
      | xstockstrat-ledger      |
      | xstockstrat-identity    |
      | xstockstrat-config      |
      | xstockstrat-notify      |

  @AC-2 @FR-3 @regression
  Scenario: Telemetry init remains non-blocking after the attribute is removed
    Given OTEL_ENABLED is "true"
    When a telemetry module builds its Resource with the trading_mode attribute removed
    Then telemetry initialisation completes without raising
    And the service proceeds to start normally

  @AC-3 @FR-2 @regression
  Scenario: The dashboards README documents the emitted attribute set, without trading_mode
    Given packages/otel/dashboards/README.md lists the resource attributes every service attaches
    When the documented attribute list is inspected
    Then it does NOT list "trading_mode"
    And it still lists "service.name", "deployment.environment", and "platform"
