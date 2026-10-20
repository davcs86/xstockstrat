Feature: fix-otel-metrics-logs-gap (bug fix)
  Regression guard for docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md:
  no service exports OTel metrics or logs, so the Grafana alerts and dashboards read nothing.
  Neutral between fix (a) narrow to traces and fix (b) add metric/log export; see context.md.

  @AC-1 @regression
  Scenario: Every alert rule queries a series that some workload produces
    Given the provisioned alert rules in packages/otel/alerts/alert-rules.yaml
    And the set of metric series exported by the 12 runtimes, the collector, or a documented Grafana-side span-metrics path
    When each alert rule's query is checked against that set
    Then every metric name the rule queries, including "rpc_server_duration_milliseconds_count" and "rpc_server_duration_milliseconds_bucket" if still present, is in the produced set

  @AC-2 @regression
  Scenario: Every dashboard panel queries a series that some workload produces
    Given the dashboards in packages/otel/dashboards/
    And the same produced-series set as AC-1
    When each panel query is checked against that set
    Then no panel references a metric name outside the produced set

  @AC-3 @regression
  Scenario: The setup docs list only the signals actually exported
    Given docs/setup/grafana-cloud.md
    When it states which OTLP signals each workload emits
    Then each listed signal (traces, metrics, logs) has an exporter in every runtime's telemetry module, or the claim is scoped to the workloads that have one
