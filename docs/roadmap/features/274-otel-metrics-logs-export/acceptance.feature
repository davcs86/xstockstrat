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
    And rpc_server_duration_milliseconds_bucket{service_name="<name>"} exists, which is the same series name the alert rules and dashboards query

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
    When a RunBacktest call with strategy_id="s-1" and symbols ["AAPL"] is handled
    Then the collector receives a POST to "/v1/logs" containing the INFO record "running backtest id=<backtest_id> strategy=s-1 symbols=['AAPL']"
    And the record's trace_id and span_id equal the RunBacktest server span's ids
    And the Loki query count_over_time({service_name="analysis"} |= "running backtest" [30m]) returns at least 1

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
    When the service starts and serves a GetPortfolio call
    Then GetPortfolio returns OK
    And the time from process start to the first served RPC is no more than 1 second longer than with OTEL_ENABLED="false"
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
    And the PLAT-3 row of docs/context-constitution.md names the "/v1/metrics" and "/v1/logs" exporters
    And OTEL-1 and OTEL-2 in packages/otel/docs/context-constitution.md name rpc_server_duration_milliseconds and the service_name Loki stream as produced
    And packages/otel/CLAUDE.md and the packages/otel findings row for the unproduced RPC metric state the signals as produced

  # AC-1 and AC-10 sample one runtime per language; AC-2 exercises metric export on all 10 gRPC backends.
  @AC-10 @FR-1
  Scenario Outline: Each runtime language exports metrics with its resource attributes
    Given <service> runs with OTEL_ENABLED="true", SERVICE_NAME="<name>" and APPLICATION_ENV="staging"
    When one metric export interval elapses
    Then the collector receives a POST to "/v1/metrics" whose resource has service.name="<name>", deployment.environment="staging" and platform="xstockstrat"

    Examples:
      | service                | name       |
      | xstockstrat-indicators | indicators |
      | xstockstrat-agent      | agent      |
      | xstockstrat-notify     | notify     |
      | xstockstrat-ui         | ui         |

  @AC-11 @FR-3
  Scenario Outline: Each runtime language bridges its logger to OTLP with trace correlation
    Given <service> runs with OTEL_ENABLED="true"
    When it logs a WARN record through <logger> inside an active server span
    Then the collector receives a POST to "/v1/logs" containing that record with severity WARN
    And the record's trace_id equals the active span's trace_id

    Examples:
      | service                | logger           |
      | xstockstrat-trading    | log/slog         |
      | xstockstrat-agent      | Python logging   |
      | xstockstrat-identity   | winston          |
      | xstockstrat-ui         | the server logger |

  @AC-12 @FR-4
  Scenario: Shutdown flushes buffered metrics and logs
    Given xstockstrat-marketdata runs with OTEL_ENABLED="true" and OTEL_METRIC_EXPORT_INTERVAL="600000"
    And it has logged 3 INFO records and served 2 RPCs since the last export
    When the process receives SIGTERM
    Then before it exits the collector receives a POST to "/v1/metrics" with the 2 RPC data points
    And a POST to "/v1/logs" with the 3 records

  @AC-13 @FR-5
  Scenario: Identity authentication logs export no credential plaintext
    Given xstockstrat-identity runs with OTEL_ENABLED="true"
    When an AuthenticateUser call is served with password "Hunter2!Plain" and returns an access token
    Then no exported OTLP log record body or attribute contains "Hunter2!Plain" or the issued access token string

  @AC-14 @FR-6
  Scenario: Restored mute timing and dashboards reference only produced series
    Given feature 250 has merged and this feature's packages/otel assets are applied
    When packages/otel/alerts/ and packages/otel/dashboards/*.json are inspected
    Then the mute timing "outside-us-market-hours" exists and is referenced by the re-derived analysis scoring-stall rule
    And the service-health dashboard's $service variable queries rpc_server_duration_milliseconds_count
    And scripts/check-otel-produced-signals.sh reports 0 panel exprs targeting an unproduced series

  # Added by /sdd-design (2026-10-21, design.md § Acceptance additions)
  @AC-15 @FR-2
  Scenario: Python and Node RPC recorders satisfy the shared status vectors
    Given scripts/testdata/rpc-status-vectors.json with vectors "ok", "abort NOT_FOUND", "unhandled ValueError", "bare Exception", "node error without code", "node string code" and "ERROR status only"
    When each vector's span is ended through the Python recorder and through the Node recorder
    Then each recorded rpc.grpc.status_code equals the vector's expected code (0, 5, 2, 2, 2, 2, 2)
    And every histogram data point uses bucket boundaries [0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000]

  @AC-16 @FR-1
  Scenario: The UI records BFF route durations for unary and REST calls only
    Given xstockstrat-ui runs with OTEL_ENABLED="true"
    When a unary /trader Connect call to TradingService returns 200, GET /accounts/api/profile returns 200, and a StreamAlerts subscription stays open for 60 seconds
    Then http.server.duration has a data point with xstk.segment="trader", rpc.service="xstockstrat.trading.v1.TradingService", http.response.status_code=200
    And a data point with xstk.segment="accounts", http.route="/accounts/api/profile", http.response.status_code=200
    And no data point carries rpc.service="xstockstrat.notify.v1.NotifyService" for the open StreamAlerts call

  @AC-17 @FR-6
  Scenario: The guard pins the proto-derived stream exclusion on every restored selector
    Given packages/otel/alerts/alert-rules.yaml restored by this feature
    When a rule's rpc_server_duration_milliseconds_sum selector omits the rpc_method stream matcher
    Then scripts/check-otel-produced-signals.sh exits non-zero
    And adding "rpc StreamFoo(Req) returns (stream Resp);" to a proto without updating the matcher also makes it exit non-zero

  @AC-18 @FR-4
  Scenario: SIGTERM flushes telemetry even with an open server stream
    Given xstockstrat-marketdata runs with OTEL_ENABLED="true" and a client holds a StreamQuotes stream open
    And it has served 2 unary RPCs and logged 3 INFO records since the last export
    When the process receives SIGTERM
    Then the collector receives the 2 RPC data points on "/v1/metrics" and the 3 records on "/v1/logs"
    And the process exits within 10 seconds of SIGTERM

  @AC-19 @FR-1
  Scenario Outline: Metrics and logs honour the path-prefixed gateway and both header forms
    Given <service> runs with OTEL_ENABLED="true", OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:<port>/otlp" and OTEL_EXPORTER_OTLP_HEADERS="<headers>"
    When it records one metric and one log record and exports
    Then the receiver gets POST "/otlp/v1/metrics" and POST "/otlp/v1/logs", each with Authorization "Basic dGVzdDprZXk="

    Examples:
      | service                | headers                                  |
      | xstockstrat-trading    | Authorization=Basic dGVzdDprZXk=         |
      | xstockstrat-analysis   | Authorization=Basic%20dGVzdDprZXk%3D     |
      | xstockstrat-ledger     | Authorization=Basic dGVzdDprZXk=         |
      | xstockstrat-ui         | Authorization=Basic%20dGVzdDprZXk%3D     |

  @AC-20 @FR-5
  Scenario: The identity seed-admin refusal logs the user id, not the email
    Given xstockstrat-identity runs with OTEL_ENABLED="true" and a seed admin "admin@example.com" with user_id "u-seed-1"
    When a default-admin login is refused
    Then the stdout line and the exported OTLP record contain "u-seed-1"
    And neither contains "admin@example.com"

  @AC-21 @FR-1
  Scenario: The agent records MCP tool duration with outcome
    Given xstockstrat-agent runs with OTEL_ENABLED="true"
    When tool "get_strategy" raises an error, tool "list_formulas" returns an isError result, and tools/call names "no_such_tool"
    Then mcp.tool.duration has data points with gen_ai.tool.name="get_strategy" outcome="error", gen_ai.tool.name="list_formulas" outcome="error", and gen_ai.tool.name="unregistered"

  @AC-22 @FR-2
  Scenario: Python deadline and cancel map to Go's status codes
    Given xstockstrat-indicators runs with OTEL_ENABLED="true"
    When a client calls a unary RPC with a 50 ms deadline that the handler outlives, and another client cancels an in-flight call
    Then rpc.server.duration records rpc.grpc.status_code=4 for the first call and 1 for the second
