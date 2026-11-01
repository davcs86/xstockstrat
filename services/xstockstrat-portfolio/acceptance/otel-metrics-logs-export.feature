# Durable per-service business rules for xstockstrat-portfolio, promoted from feature 274's
# acceptance.feature at launch (Constitution C-16). Source-feature provenance is carried on every
# scenario's `@feature-274` tag. These are the guarantees a future feature must not silently break.

Feature: otel-metrics-logs-export
  An unreachable OTLP endpoint never blocks xstockstrat-portfolio startup or requests.

  @AC-6 @FR-4 @regression @feature-274
  Scenario: An unreachable metrics/logs endpoint never blocks startup or requests
    Given xstockstrat-portfolio runs with OTEL_ENABLED="true" and OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:1"
    When the service starts and serves a GetPortfolio call
    Then GetPortfolio returns OK
    And the time from process start to the first served RPC is no more than 1 second longer than with OTEL_ENABLED="false"
    And the export failure is logged to stdout without a further OTLP export attempt for that failure log
