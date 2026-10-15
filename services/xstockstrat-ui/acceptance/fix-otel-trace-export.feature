# Durable per-service business rules for xstockstrat-ui, promoted from feature 226's
# acceptance.feature at launch (Constitution C-16). Source-feature provenance is carried on every
# scenario's `@feature-226` tag. These are the guarantees a future feature must not silently break.

Feature: fix-otel-trace-export
  xstockstrat-ui registers its Next.js instrumentation hook from src/ and exports traces over OTLP/HTTP.

  @AC-2 @FR-2 @regression @feature-226
  Scenario: The UI registers its instrumentation hook and exports over OTLP/HTTP
    Given the xstockstrat-ui server runtime is "nodejs" and OTEL_ENABLED is "true"
    And OTEL_EXPORTER_OTLP_ENDPOINT is "http://<otlp-receiver>/otlp"
    When Next.js loads the instrumentation hook from the src directory
    Then telemetry initialises and logs "[otel] tracing enabled"
    And spans are exported to "/otlp/v1/traces"
