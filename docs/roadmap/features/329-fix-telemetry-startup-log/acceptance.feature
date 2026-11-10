Feature: fix-telemetry-startup-log (bug fix)
  Regression guard for defect report: telemetry startup log prints the raw OTLP endpoint env var.

  # guards: docs/reports/2026-10-19-telemetry-startup-log-raw-endpoint-defect.md
  @AC-1 @regression
  Scenario Outline: the startup log names the effective export endpoint when the env var is unset
    Given OTEL_ENABLED is "true" and OTEL_EXPORTER_OTLP_ENDPOINT is unset
    When the <runtime> service <service> starts
    Then its telemetry startup log names the SDK default endpoint (or "SDK default")
    And the log contains neither "undefined" nor "None" as the endpoint

    Examples:
      | runtime | service                |
      | Node    | xstockstrat-ui         |
      | Node    | xstockstrat-config     |
      | Python  | xstockstrat-analysis   |
      | Python  | xstockstrat-agent      |

  # guards: docs/reports/2026-10-19-telemetry-startup-log-raw-endpoint-defect.md
  @AC-2 @regression
  Scenario: the startup log names the configured endpoint when the env var is set
    Given OTEL_ENABLED is "true" and OTEL_EXPORTER_OTLP_ENDPOINT is "http://otel-collector:4318"
    When xstockstrat-ui starts
    Then its telemetry startup log names "http://otel-collector:4318"
