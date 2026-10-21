Feature: fix-otel-metrics-logs-gap (bug fix)
  Regression guard for docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md:
  no service exports OTel metrics or logs, so the Grafana alerts and dashboards read nothing.
  Scenarios state the invariant, not the mechanism; fix direction is narrow-to-traces (product-spec.md Expected).

  @AC-1 @FR-1 @FR-3 @regression
  Scenario: Every alert rule queries a metric series or log stream that some workload produces
    Given the provisioned alert rules in packages/otel/alerts/alert-rules.yaml
    And the produced-signal set: the metric names and log streams exported by the 12 runtimes or the collector, plus the metric names that a Grafana-side span-metrics path, verified to return series for the stack, derives from exported traces
    And today that set holds no PromQL metric name and no Loki log stream, because the runtimes export traces only (feature 226)
    When each alert rule's PromQL and LogQL query is checked against that set
    Then every PromQL metric name the rule queries, including "rpc_server_duration_milliseconds_count" and "rpc_server_duration_milliseconds_bucket" if still present, is in the produced set
    And every LogQL stream selector the rule queries, including {service_name="analysis"} of "xstk-analysis-no-scoring" if still present, matches a log stream in the produced set

  @AC-2 @FR-2 @FR-3 @regression
  Scenario: Every dashboard query targets a metric series or log stream that some workload produces
    Given the dashboards in packages/otel/dashboards/
    And the same produced-signal set as AC-1
    When each panel query and template-variable query is checked against that set
    Then no query references a PromQL metric name outside the produced set
    And every LogQL stream selector, including those of the LogQL panels in signal-pipeline-throughput.json, infrastructure.json, service-health.json and trading-service.json if still present, matches a log stream in the produced set

  @AC-3 @FR-4 @regression
  Scenario: The observability docs list only the signals actually exported
    Given the FR-4 docs: docs/setup/grafana-cloud.md, docs/setup/CLAUDE.md, docs/patterns/observability.md, docs/launch-pdfs/product-features.md, packages/otel/dashboards/README.md, the packages/otel/otel-collector-config.yaml header comment, packages/otel/CLAUDE.md and packages/otel/docs/context-constitution.md
    And any other doc under docs/ or packages/otel/ outside docs/roadmap/ and docs/reports/
    When each states which OTLP signals the workloads emit, or which series the provisioned alerts and dashboards read
    Then each signal type it says a workload emits (traces, metrics, logs) has an exporter in every runtime's telemetry module, or the claim is scoped to the workloads that have one
    And each metric series or log stream it says an alert or dashboard reads is in the produced-signal set of AC-1
    And docs/setup/grafana-cloud.md does not state that every workload "emits traces, metrics, and logs via OTLP" while no runtime exports metrics or logs
