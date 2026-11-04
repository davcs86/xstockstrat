# Durable per-service business rules for xstockstrat-ledger, promoted from feature 274's
# acceptance.feature at launch (Constitution C-16). Source-feature provenance is carried on every
# scenario's `@feature-274` tag. These are the guarantees a future feature must not silently break.

Feature: otel-metrics-logs-export
  xstockstrat-ledger bridges winston to OTLP without changing stdout.

  @AC-4 @FR-3 @regression @feature-274
  Scenario: Stdout logging is unchanged when the OTLP log bridge is active
    Given xstockstrat-ledger runs with OTEL_ENABLED="true"
    When it logs "event appended" at INFO through winston
    Then stdout contains the same line in the same format it had with OTEL_ENABLED="false"
