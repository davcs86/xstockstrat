# Durable per-service business rules for xstockstrat-config, promoted from feature 274's
# acceptance.feature at launch (Constitution C-16). Source-feature provenance is carried on every
# scenario's `@feature-274` tag. These are the guarantees a future feature must not silently break.

Feature: otel-metrics-logs-export
  xstockstrat-config installs no metric/log pipeline when disabled and never exports secret plaintext.

  @AC-5 @FR-4 @regression @feature-274
  Scenario: Telemetry disabled installs no metric or log pipeline
    Given xstockstrat-config runs with OTEL_ENABLED="false"
    When the service starts and handles 10 WatchConfig subscriptions
    Then no request is sent to "/v1/metrics" or "/v1/logs"
    And stdout logging is produced exactly as before this feature

  @AC-7 @FR-5 @regression @feature-274
  Scenario: Exported log records carry no secret plaintext
    Given xstockstrat-config runs with OTEL_ENABLED="true" and a secret row marketdata.alpaca.api_key whose plaintext is "AKTESTSECRET123"
    When GetSecret is served for an allow-listed caller and the service logs the request
    Then no exported OTLP log record body or attribute contains "AKTESTSECRET123"
