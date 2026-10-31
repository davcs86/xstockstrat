# Durable per-service business rules for xstockstrat-marketdata, promoted from feature 274's
# acceptance.feature at launch (Constitution C-16). Source-feature provenance is carried on every
# scenario's `@feature-274` tag. These are the guarantees a future feature must not silently break.

Feature: otel-metrics-logs-export
  xstockstrat-marketdata flushes buffered metrics and logs on SIGTERM.

  @AC-12 @FR-4 @regression @feature-274
  Scenario: Shutdown flushes buffered metrics and logs
    Given xstockstrat-marketdata runs with OTEL_ENABLED="true" and OTEL_METRIC_EXPORT_INTERVAL="600000"
    And it has logged 3 INFO records and served 2 RPCs since the last export
    When the process receives SIGTERM
    Then before it exits the collector receives a POST to "/v1/metrics" with the 2 RPC data points
    And a POST to "/v1/logs" with the 3 records

  @AC-18 @FR-4 @regression @feature-274
  Scenario: SIGTERM flushes telemetry even with an open server stream
    Given xstockstrat-marketdata runs with OTEL_ENABLED="true" and a client holds a StreamQuotes stream open
    And it has served 2 unary RPCs and logged 3 INFO records since the last export
    When the process receives SIGTERM
    Then the collector receives the 2 RPC data points on "/v1/metrics" and the 3 records on "/v1/logs"
    And the process exits within 10 seconds of SIGTERM
