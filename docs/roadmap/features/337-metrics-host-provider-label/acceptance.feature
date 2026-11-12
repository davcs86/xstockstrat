Feature: metrics-host-provider-label
  As an operator comparing homelab and DO on one Grafana Cloud stack, I want host_provider as a label on every metric series, so that I can filter by provider without a target_info join.

  @AC-1 @FR-1
  Scenario: An RPC duration series is selectable by provider with no join
    Given trading runs in staging with HOST_PROVIDER=digitalocean on DO dev and HOST_PROVIDER=homelab on homelab staging, both after this change and homelab staging exporting (count(group by (job)(target_info{deployment_environment="staging", host_provider="homelab"})) >= 11)
    When sum by (host_provider) (rate(rpc_server_duration_milliseconds_count{deployment_environment="staging", service_name="trading", rpc_method!~"ExportEvents|StreamAlerts|StreamBars|StreamEvents|StreamOrderUpdates|StreamPortfolioUpdates|StreamQuotes|WatchConfig"}[5m])) runs 10 minutes after the later deploy and one RPC to trading on each stack
    Then it returns exactly the host_provider values "digitalocean" and "homelab", and no series has an empty host_provider

  @AC-2 @FR-1 @FR-2
  Scenario Outline: Every runtime exports host.provider on each datapoint through its real init pipeline
    Given <service> starts with OTEL_ENABLED=true, HOST_PROVIDER=digitalocean and APPLICATION_ENV=staging against a local OTLP receiver
    When it records one counter increment and flushes through its real init pipeline
    Then every datapoint decoded from the /v1/metrics request body has attribute host.provider="digitalocean", equal to that request's resource host.provider

    Examples:
      | service                |
      | xstockstrat-trading    |
      | xstockstrat-portfolio  |
      | xstockstrat-marketdata |
      | xstockstrat-ledger     |
      | xstockstrat-identity   |
      | xstockstrat-notify     |
      | xstockstrat-config     |
      | xstockstrat-ui         |
      | xstockstrat-analysis   |
      | xstockstrat-ingest     |
      | xstockstrat-indicators |
      | xstockstrat-agent      |

  @AC-3 @FR-1
  Scenario: Non-RPC instruments are labeled too
    Given config initialised by initTelemetry with HOST_PROVIDER=homelab
    When setListenerUp(true) and recordWatchTerminated('client_error') run and metrics flush
    Then the decoded datapoints of config.listener_up and config.watch.terminated each carry host.provider="homelab", and config.watch.terminated still carries reason="client_error"

  @AC-4 @FR-2
  Scenario: The label reuses the 332 normaliser
    Given the ledger service starts with OTEL_ENABLED=true and HOST_PROVIDER="Homelab"
    When it exports one counter increment and its resource
    Then the datapoint has host.provider="unknown" and the resource has host.provider="unknown"

  @AC-5 @FR-3
  Scenario Outline: A labeling failure never loses a batch
    Given <service>'s exporter wrapper with provider "homelab" around a fake inner exporter, each batch holding 2 datapoints, and <seam> on every export
    When two batches are exported
    Then the inner exporter receives both original batches with no host.provider added and unchanged values, and exactly one warning containing "host_provider" is logged

    Examples:
      | service                | seam                                        |
      | xstockstrat-trading    | the stamp function panics from its 2nd call |
      | xstockstrat-portfolio  | the stamp function panics from its 2nd call |
      | xstockstrat-marketdata | the stamp function panics from its 2nd call |
      | xstockstrat-ledger     | the scopeMetrics getter throws              |
      | xstockstrat-identity   | the scopeMetrics getter throws              |
      | xstockstrat-notify     | the scopeMetrics getter throws              |
      | xstockstrat-config     | the scopeMetrics getter throws              |
      | xstockstrat-ui         | the scopeMetrics getter throws              |
      | xstockstrat-analysis   | _labelled raises                            |
      | xstockstrat-ingest     | _labelled raises                            |
      | xstockstrat-indicators | _labelled raises                            |
      | xstockstrat-agent      | _labelled raises                            |

  @AC-6 @FR-5
  Scenario: Series count stays under the free-tier cap and no series is left unlabeled
    Given T0 = 2671 active series from max_over_time(grafanacloud_instance_active_series[1h]) on datasource grafanacloud-usage on 2026-11-12 with only DO dev exporting, and count by (__name__) ({deployment_environment="staging"}) taken at T0 shows only metrics the workloads export
    When the same query runs 30 minutes after the last of DO dev, homelab staging and homelab production deploys the change
    Then the 1-hour peak is below 10000, count by (service_name) ({deployment_environment="staging", host_provider=""}) and the same for "production" return no series, and count({deployment_environment="staging"}) equals count({deployment_environment="staging", host_provider!=""}) at one instant

  @AC-7 @FR-6
  Scenario: The logs filter and the resource attribute are unchanged
    Given the change is deployed
    When the LogQL {service_name="analysis"} | host_provider="homelab" and the query target_info{host_provider="homelab"} run
    Then both still return results

  @AC-8 @FR-6
  Scenario: Existing label-allowlist tests stay green with no edit
    Given the UI bffAllowlist test and each service's telemetry label test
    When they run against the changed code
    Then they pass with no edit to any expected key set, because the label is added after aggregation and in-memory readers never see it

  @AC-9 @FR-7
  Scenario: The documented label query is guarded
    Given docs/patterns/observability.md has exactly one promql block tagged otel-guard:host-provider-label whose rpc_server_duration_milliseconds_count selector carries deployment_environment="staging", host_provider="homelab" and the stream exclusion, and no target_info
    When scripts/check-otel-produced-signals.py runs
    Then it exits 0, and exits 1 with a "337-AC-9 P6" row when host_provider="homelab" or deployment_environment="staging" is removed from that selector, when a second label-tagged block is added, or when target_info is added, and with an "AC-17 P4" row when the stream exclusion is removed

  @AC-10 @FR-7
  Scenario: Both documented queries return the same services
    Given the label block and the feature-332 join block, homelab staging running the change, and one RPC to each of trading, portfolio, marketdata, ledger, identity, notify, config, analysis, ingest and indicators
    When count by (service_name) (<block>) is evaluated for each block 10 minutes later, and count(http_server_duration_milliseconds_count{deployment_environment="staging", host_provider="homelab", service_name="ui"}) is evaluated after one UI login, and the join is evaluated over a range spanning the rollout
    Then both blocks return the same 10 service_name values, the UI count is at least 1, and the range query returns no error

  @AC-11 @FR-8
  Scenario: Dashboards and alerts are untouched
    Given the feature's merged pull request
    When it is checked for changed paths matching packages/otel/dashboards/*.json and packages/otel/alerts/*.yaml
    Then no such path is changed

  @AC-12 @FR-4
  Scenario: A mechanism with a manual operator step needs the operator's approval first
    Given the design selects option B whose step 1 needs the operator to push a smoke datapoint to the staging OTLP gateway with the staging token from their own shell
    When the design is presented for approval
    Then the status does not advance to design-approved until context.md records the operator's explicit approval naming that manual step

  @AC-13 @FR-1 @FR-6
  Scenario Outline: A datapoint that already carries host.provider ends with exactly one such key
    Given <service> records a counter with attributes {host.provider="x", outcome="ok"} and HOST_PROVIDER=homelab
    When it is exported through its exporter wrapper
    Then the exported datapoint has exactly one host.provider key with value "homelab" and outcome="ok", and the input batch afterwards has host.provider="<input after>"

    Examples:
      | service                | input after |
      | xstockstrat-trading    | homelab     |
      | xstockstrat-portfolio  | homelab     |
      | xstockstrat-marketdata | homelab     |
      | xstockstrat-ledger     | x           |
      | xstockstrat-identity   | x           |
      | xstockstrat-notify     | x           |
      | xstockstrat-config     | x           |
      | xstockstrat-ui         | x           |
      | xstockstrat-analysis   | x           |
      | xstockstrat-ingest     | x           |
      | xstockstrat-indicators | x           |
      | xstockstrat-agent      | x           |

  @AC-14 @FR-6
  Scenario Outline: A delta temporality preference survives the wrapper
    Given OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta and <service> initialised with HOST_PROVIDER=homelab
    When a counter is exported through its real init pipeline
    Then the decoded sum has aggregationTemporality 1 (DELTA) and carries host.provider="homelab"

    Examples:
      | service            |
      | xstockstrat-ledger |
      | xstockstrat-ui     |

  @AC-15 @FR-1
  Scenario Outline: The Go wrapper labels every data type
    Given a ResourceMetrics holding one datapoint each of Gauge, Sum, Histogram and ExponentialHistogram over int64 and float64
    When <service>'s exporter wrapper exports it
    Then all 8 datapoints carry host.provider="homelab"

    Examples:
      | service                |
      | xstockstrat-trading    |
      | xstockstrat-portfolio  |
      | xstockstrat-marketdata |

  @AC-16 @FR-6
  Scenario Outline: The Python wrapper forwards shutdown with a timeout keyword
    Given <service>'s MeterProvider reader uses the wrapped exporter
    When reader.shutdown() runs
    Then it returns without raising and the inner exporter's shutdown is called once with a timeout keyword

    Examples:
      | service                |
      | xstockstrat-analysis   |
      | xstockstrat-ingest     |
      | xstockstrat-indicators |
      | xstockstrat-agent      |

  @AC-17 @FR-1
  Scenario: Gate: a datapoint attribute becomes the host_provider label on the staging gateway
    Given one counter smoke337.probe is pushed to the staging OTLP gateway with datapoint attribute host.provider="homelab" and resource attributes service.name="smoke-337", deployment.environment="smoke" and host.provider="unknown"
    When smoke337_probe_total{deployment_environment="smoke"} and its label names are queried within 5 minutes of the export
    Then exactly one series returns with host_provider="homelab", and the label names contain host_provider and not host.provider

  @AC-18 @FR-1 @FR-6
  Scenario Outline: The export adds host.provider and no other key to an existing instrument
    Given <service> initialised with OTEL_ENABLED=true and HOST_PROVIDER=homelab, exporting to a local OTLP receiver
    When one <instrument> sample is recorded and metrics are flushed
    Then the decoded datapoint's attribute keys are exactly <recorded keys> plus host.provider="homelab"
    And an in-memory reader of the same instrument records exactly <recorded keys>

    Examples:
      | service           | instrument                        | recorded keys                                             |
      | trading           | rpc.server.duration               | rpc.grpc.status_code, rpc.method, rpc.service, rpc.system |
      | agent             | mcp.tool.duration                 | gen_ai.tool.name, outcome                                 |
      | ui (REST route)   | http.server.duration              | xstk.segment, http.response.status_code, http.route       |
      | ui (Connect call) | http.server.duration              | xstk.segment, http.response.status_code, rpc.service      |
      | analysis          | analysis.live_loop.cycle.duration | (none)                                                    |

  @AC-19 @FR-7
  Scenario: The documented join pre-aggregates its left operand
    Given the promql block tagged otel-guard:host-provider in docs/patterns/observability.md
    When scripts/check-otel-produced-signals.py runs
    Then it exits 0, and exits 1 with a "337-AC-19 P6" row when "sum without (host_provider) (" is removed from that block

  @AC-20 @FR-7
  Scenario: Documentation gives the label query first and the join as fallback
    Given docs/patterns/observability.md after this feature
    When a reader looks up how to filter metrics by provider
    Then it gives the otel-guard:host-provider-label PromQL as preferred and the otel-guard:host-provider join as fallback, states that host_provider is a datapoint label on every metric the workloads export as well as a target_info attribute, and its post-deploy check states each PromQL block returns at least 1 series after one RPC

  @AC-21 @FR-6
  Scenario Outline: The wrapper keeps the exporter contract
    Given <service>'s exporter wrapper around a fake inner exporter that prefers DELTA for counters
    When the wrapper's temporality choice, force flush and shutdown are called
    Then it reports DELTA for a counter, and the inner exporter receives exactly one force flush and one shutdown

    Examples:
      | service                |
      | xstockstrat-trading    |
      | xstockstrat-portfolio  |
      | xstockstrat-marketdata |
      | xstockstrat-ledger     |
      | xstockstrat-identity   |
      | xstockstrat-notify     |
      | xstockstrat-config     |
      | xstockstrat-ui         |
      | xstockstrat-analysis   |
      | xstockstrat-ingest     |
      | xstockstrat-indicators |
      | xstockstrat-agent      |

  @AC-22 @FR-7
  Scenario: Gate: the unaggregated join errors and the pre-aggregated join returns one row
    Given counter smoke337.join is exported once with no attribute and once with host.provider="homelab" under one resource with service.instance.id="smoke-337" and deployment.environment="smoke"
    When last_over_time(smoke337_join_total{deployment_environment="smoke"}[15m]) is joined to target_info with and without sum without (host_provider) around the left operand, within 5 minutes of the export
    Then the pre-aggregated form returns exactly 1 row with value 2, and the unaggregated form either errors with a many-to-one duplicate-labels message or its non-reproduction is recorded in context.md
