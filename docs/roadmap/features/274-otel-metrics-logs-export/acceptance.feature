Feature: otel-metrics-logs-export
  As the on-call operator, I want every xstockstrat runtime to export OTel metrics (including the RPC server
  duration histogram) and logs over OTLP/HTTP to the collector, so the Grafana alerts and dashboards have data to
  evaluate and can page me.

  @AC-1 @FR-1
  Scenario: A Go backend exports metrics to the collector's OTLP/HTTP metrics path
    Given xstockstrat-trading runs with OTEL_ENABLED="true" and OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector:4318"
    And SERVICE_NAME="trading" and APPLICATION_ENV="staging"
    When one metric export interval elapses
    Then the collector receives a POST to "/v1/metrics"
    And the exported resource has service.name="trading", deployment.environment="staging" and platform="xstockstrat"

  @AC-2 @FR-2
  Scenario Outline: Every gRPC backend records the server duration histogram with its status code
    Given <service> runs with OTEL_ENABLED="true"
    When a client calls one of its unary RPCs and the handler returns gRPC status NOT_FOUND (5)
    Then the next metric export contains a histogram data point for that method with rpc.grpc.status_code=5
    And in Grafana Cloud the series rpc_server_duration_milliseconds_count{service_name="<name>",rpc_grpc_status_code="5"} increases by 1

    Examples:
      | service                | name        |
      | xstockstrat-trading    | trading     |
      | xstockstrat-portfolio  | portfolio   |
      | xstockstrat-marketdata | marketdata  |
      | xstockstrat-indicators | indicators  |
      | xstockstrat-ingest     | ingest      |
      | xstockstrat-analysis   | analysis    |
      | xstockstrat-ledger     | ledger      |
      | xstockstrat-identity   | identity    |
      | xstockstrat-notify     | notify      |
      | xstockstrat-config     | config      |

  @AC-3 @FR-3
  Scenario: An analysis log line inside a span reaches Loki correlated to its trace
    Given xstockstrat-analysis runs with OTEL_ENABLED="true"
    When a RunBacktest call is handled and the service logs "RunBacktest completed" at INFO inside the server span
    Then the collector receives a POST to "/v1/logs" containing that record with severity INFO
    And the record's trace_id and span_id equal the RunBacktest server span's ids
    And the Loki query count_over_time({service_name="analysis"} |~ "ScoreStrategy|RunBacktest" [30m]) returns at least 1

  @AC-4 @FR-3
  Scenario: Stdout logging is unchanged when the OTLP log bridge is active
    Given xstockstrat-ledger runs with OTEL_ENABLED="true"
    When it logs "event appended" at INFO through winston
    Then stdout contains the same line in the same format it had with OTEL_ENABLED="false"

  @AC-5 @FR-4
  Scenario: Telemetry disabled installs no metric or log pipeline
    Given xstockstrat-config runs with OTEL_ENABLED="false"
    When the service starts and handles 10 WatchConfig subscriptions
    Then no request is sent to "/v1/metrics" or "/v1/logs"
    And stdout logging is produced exactly as before this feature

  @AC-6 @FR-4
  Scenario: An unreachable metrics/logs endpoint never blocks startup or requests
    Given xstockstrat-portfolio runs with OTEL_ENABLED="true" and OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:1"
    When the service starts and serves a GetPositions call
    Then the gRPC health check reports SERVING within the existing healthcheck window
    And GetPositions returns OK
    And the export failure is logged to stdout without a further OTLP export attempt for that failure log

  @AC-7 @FR-5
  Scenario: Exported log records carry no secret plaintext
    Given xstockstrat-config runs with OTEL_ENABLED="true" and a secret row marketdata.alpaca.api_key whose plaintext is "AKTESTSECRET123"
    When GetSecret is served for an allow-listed caller and the service logs the request
    Then no exported OTLP log record body or attribute contains "AKTESTSECRET123"

  @AC-8 @FR-6
  Scenario: Restored alert rules query only produced series
    Given feature 250 has merged and this feature restores xstk-error-rate-high, xstk-p99-latency-high and the re-derived analysis scoring-stall rule
    When scripts/check-otel-produced-signals.sh runs in CI
    Then it exits 0
    And adding a rule that queries the unproduced metric "rpc_client_bogus_total" makes it exit non-zero

  @AC-9 @FR-7
  Scenario: Docs state the three exported signals
    Given docs/patterns/observability.md and docs/setup/grafana-cloud.md after this feature
    When an operator reads the signal list
    Then both list traces, metrics and logs with the endpoints "/v1/traces", "/v1/metrics" and "/v1/logs"
    And the root findings row for "metrics and logs are never sent" is marked RESOLVED (feature 274)
