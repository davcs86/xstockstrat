Feature: metrics-host-provider-label
  As an operator comparing homelab and DO on one Grafana Cloud stack, I want host_provider as a label on every metric series, so that I can filter by provider without a target_info join.

  @AC-1 @FR-1
  Scenario: An RPC duration series is selectable by provider with no join
    Given the trading service exports metrics with HOST_PROVIDER=homelab and deployment_environment="staging"
    When the query rpc_server_duration_milliseconds_count{host_provider="homelab", service_name="trading"} runs after one RPC
    Then it returns at least 1 series and every returned series has host_provider="homelab"

  @AC-2 @FR-1
  Scenario Outline: Every runtime's metrics carry the label
    Given the <service> runtime exports metrics with HOST_PROVIDER=digitalocean
    When its exported metric data points are collected through an in-memory reader
    Then every data point has host_provider="digitalocean"

    Examples:
      | service             |
      | xstockstrat-trading |
      | xstockstrat-ledger  |
      | xstockstrat-ui      |
      | xstockstrat-analysis |

  @AC-3 @FR-1
  Scenario: Non-RPC metric families are labeled too
    Given the config service exports metrics with HOST_PROVIDER=homelab
    When its process and runtime metric families are collected
    Then each has host_provider="homelab", not only rpc_server_duration_milliseconds

  @AC-4 @FR-2
  Scenario: The label reuses the 332 normaliser
    Given the ledger service starts with OTEL_ENABLED=true and HOST_PROVIDER="Homelab"
    When it exports one metric data point and its resource
    Then the data point has host_provider="unknown" and the resource has host.provider="unknown"

  @AC-5 @FR-3
  Scenario: A labeling failure never blocks startup
    Given the mechanism cannot be applied in the notify service (forced failure in the test)
    When telemetry initialises with HOST_PROVIDER=homelab
    Then the service reaches SERVING, logs one warning, and exports series without the host_provider label

  @AC-6 @FR-5
  Scenario: Series count does not exceed the documented budget
    Given the DO dev stack exports about 1,200 active series before the change
    When the active series count is measured 10 minutes after the first deploy with the change
    Then the count is at most the budget in docs/patterns/observability.md and the measured delta is recorded there

  @AC-7 @FR-6
  Scenario: The logs filter and the resource attribute are unchanged
    Given the change is deployed
    When the LogQL {service_name="analysis"} | host_provider="homelab" and the query target_info{host_provider="homelab"} run
    Then both still return results

  @AC-8 @FR-6
  Scenario: Metric-label allowlist tests accept host_provider and nothing else new
    Given the UI bffAllowlist test and each service's telemetry label test
    When they run against the changed code
    Then they pass, and the only label added to any allowlist is "host_provider"

  @AC-9 @FR-7
  Scenario: The documented simple query is guarded
    Given docs/patterns/observability.md contains the block rpc_server_duration_milliseconds_count{host_provider="homelab"}
    When scripts/check-otel-produced-signals.py runs
    Then it exits 0, and removing the host_provider matcher from that block makes it exit non-zero

  @AC-10 @FR-7
  Scenario: The target_info join remains valid
    Given the documented join block from feature 332
    When it is evaluated against the changed series
    Then it still returns the same service_name set as the simple query

  @AC-11 @FR-8
  Scenario: Dashboards and alerts are untouched
    Given the diff of this feature
    When files under packages/otel/dashboards and packages/otel/alerts are listed
    Then the list is empty
