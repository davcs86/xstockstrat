Feature: fix-otel-trace-export (bug fix)
  Regression guard for defect report docs/reports/2026-10-14-otel-trace-export-broken-defect.md:
  OTel trace export fails for every service against the Grafana Cloud OTLP/HTTP gateway.

  @AC-1 @FR-1 @regression
  Scenario Outline: A backend service exports traces over OTLP/HTTP to a path-prefixed gateway URL
    Given OTEL_ENABLED is "true"
    And OTEL_EXPORTER_OTLP_ENDPOINT is the receiver's base URL with path "/otlp"
    And OTEL_EXPORTER_OTLP_HEADERS is "<headers>"
    When the service initialises telemetry, records a span, and flushes on shutdown
    Then the receiver gets an HTTP POST to "/otlp/v1/traces"
    And the request carries the header "Authorization: Basic dGVzdDprZXk="

    Examples:
      | form    | headers                              |
      | raw     | Authorization=Basic dGVzdDprZXk=     |
      | encoded | Authorization=Basic%20dGVzdDprZXk%3D |

  @AC-2 @FR-2 @regression
  Scenario: The UI registers its instrumentation hook and exports over OTLP/HTTP
    Given the xstockstrat-ui server runtime is "nodejs" and OTEL_ENABLED is "true"
    And OTEL_EXPORTER_OTLP_ENDPOINT is "http://<otlp-receiver>/otlp"
    When Next.js loads the instrumentation hook from the src directory
    Then telemetry initialises and logs "[otel] tracing enabled"
    And spans are exported to "/otlp/v1/traces"

  @AC-3 @FR-3 @regression
  Scenario: A failed trace export is visible in service logs
    Given OTEL_ENABLED is "true"
    And OTEL_EXPORTER_OTLP_ENDPOINT points at a receiver that rejects the export
    When the service flushes a span
    Then the service log contains an OTel export error

  @AC-4 @FR-4 @regression
  Scenario: Local compose routes every service to the collector's OTLP/HTTP receiver
    Given the local docker-compose stack with OTEL_ENABLED "true"
    When any service's OTEL_EXPORTER_OTLP_ENDPOINT is read from docker-compose.yml
    Then it is "http://otel-collector:4318"
