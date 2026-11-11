Feature: otel-env-provider-scoped-alerts
  As the operator of a shared Grafana Cloud stack that receives telemetry from DO dev, homelab staging and homelab production, I want the alert rules and the service-detail dashboard scoped by deployment_environment and host_provider, so that an error in one stack pages with a label naming that stack and a live loop in one stack cannot hide a dead loop in another.

  @AC-1 @FR-1
  Scenario: The error-rate rule is evaluated per stack
    Given packages/otel/alerts/alert-rules.yaml after this feature
    When the xstk-error-rate-high expression is read
    Then both its numerator and denominator aggregate by service_name, deployment_environment and host_provider, and each rpc_server_duration_milliseconds_count selector keeps the rpc_method!~ exclusion byte-identical to the one before this feature

  @AC-2 @FR-1
  Scenario: An error-rate alert names its stack
    Given synthetic series in which homelab staging trading has a 5% gRPC error rate for 5 minutes while DO dev trading has 0%
    When the error-rate rule's expression is evaluated offline against them
    Then exactly one alert instance fires, with labels service_name="trading", deployment_environment="staging" and host_provider="homelab"

  @AC-3 @FR-2
  Scenario: The P99 latency rule is evaluated per stack
    Given packages/otel/alerts/alert-rules.yaml after this feature
    When the xstk-p99-latency-high expression is read
    Then its histogram_quantile aggregates by le, service_name, deployment_environment and host_provider, and its selector keeps the rpc_method!~ exclusion

  @AC-4 @FR-3
  Scenario: A dead loop in one stack fires the heartbeat even while another stack is live
    Given synthetic input in which the homelab staging analysis loop logs "live_loop: cycle complete" every minute and the DO dev analysis loop has logged nothing for 31 minutes
    When the heartbeat check for each expected pair is evaluated offline against it
    Then an alert fires with labels deployment_environment="staging" and host_provider="digitalocean", and no alert fires for the homelab staging stack

  @AC-5 @FR-3
  Scenario: The expected-stack list is explicit
    Given packages/otel/alerts/alert-rules.yaml and the alerts README after this feature
    When a reader looks up which stacks the heartbeat watches
    Then the rule file names the pairs staging/digitalocean, staging/homelab and production/homelab, and the README states how to add or remove a pair

  @AC-6 @FR-4
  Scenario: The service-detail dashboard filters by host_provider
    Given packages/otel/dashboards/service-detail.json after this feature
    When its templating variables and panel queries are read
    Then it has a host_provider variable next to environment whose options come from target_info, every metric panel query keeps deployment_environment=~"$environment" and restricts to host_provider=~"$host_provider" through the target_info join, and every log panel query keeps its deployment_environment filter and adds the pipeline filter | host_provider=~"$host_provider"

  @AC-7 @FR-5
  Scenario: The produced-signal guard stays green
    Given the changed alert rules, the dashboard and packages/otel/produced-signals.tsv
    When scripts/check-otel-produced-signals.py runs
    Then it exits 0, and removing the rpc_method!~ exclusion from any changed selector makes it exit non-zero with an AC-17 P4 hit

  @AC-8 @FR-6
  Scenario: Documentation states the scoping and the manual re-import
    Given docs/patterns/observability.md, packages/otel/alerts/README.md and packages/otel/dashboards/README.md after this feature
    When a reader looks up the alert and dashboard scoping
    Then they name the three stacks, the labels each alert carries, the expected-stack list and how to change it, the manual Grafana re-import of alert-rules.yaml, and a post-import check that each scoped rule appears in Grafana with its deployment_environment and host_provider labels

  @AC-9 @FR-3
  Scenario: Every expected stack has its own heartbeat check in the rule file
    Given packages/otel/alerts/alert-rules.yaml after this feature
    When the heartbeat rules are read
    Then each of staging/digitalocean, staging/homelab and production/homelab is evaluated by its own check (a separate rule, or a separate query within one rule), each check counts live_loop: cycle complete for its own deployment_environment and host_provider only, over a [30m] window with a threshold evaluator of type lt and params [1], and a check that returns no data alerts (noDataState: Alerting)
