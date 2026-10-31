# Durable per-service business rules for xstockstrat-trading, promoted from feature 274's
# acceptance.feature at launch (Constitution C-16). Source-feature provenance is carried on every
# scenario's `@feature-274` tag. These are the guarantees a future feature must not silently break.

Feature: otel-metrics-logs-export
  xstockstrat-trading exports OTel metrics over OTLP/HTTP to the collector.

  @AC-1 @FR-1 @regression @feature-274
  Scenario: A Go backend exports metrics to the collector's OTLP/HTTP metrics path
    Given xstockstrat-trading runs with OTEL_ENABLED="true" and OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector:4318"
    And SERVICE_NAME="trading" and APPLICATION_ENV="staging"
    When one metric export interval elapses
    Then the collector receives a POST to "/v1/metrics"
    And the exported resource has service.name="trading", deployment.environment="staging" and platform="xstockstrat"
