Feature: fix-telemetry-startup-log
  Promoted from docs/roadmap/features/329-fix-telemetry-startup-log/acceptance.feature (feature 329, bug fix).
  The telemetry startup log names the configured OTLP endpoint.

  @AC-2 @regression @feature-329
  Scenario: the startup log names the configured endpoint when the env var is set
    Given OTEL_ENABLED is "true" and OTEL_EXPORTER_OTLP_ENDPOINT is "http://otel-collector:4318"
    When xstockstrat-ui starts
    Then its telemetry startup log names "http://otel-collector:4318"
