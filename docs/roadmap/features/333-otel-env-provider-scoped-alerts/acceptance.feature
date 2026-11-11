Feature: otel-env-provider-scoped-alerts
  As the operator of a shared Grafana Cloud stack that receives telemetry from DO dev, homelab staging and homelab production, I want the alert rules and the service-detail dashboard scoped by deployment_environment and host_provider, so that an error in one stack pages with a label naming that stack and a live loop in one stack cannot hide a dead loop in another.

  @AC-1 @FR-1
  Scenario: The error-rate rule is evaluated per stack
    Given packages/otel/alerts/alert-rules.yaml after this feature
    When the xstk-error-rate-high expression is read
    Then both its numerator and denominator aggregate by service_name, deployment_environment and host_provider, and each rpc_server_duration_milliseconds_count selector keeps the rpc_method!~ exclusion byte-identical to the one before this feature

  @AC-2 @FR-1
  Scenario: An error-rate alert names its stack
    Given homelab staging trading has a 5% gRPC error rate for 5 minutes while DO dev trading has 0%
    When the error-rate rule evaluates
    Then exactly one alert instance fires, with labels service_name="trading", deployment_environment="staging" and host_provider="homelab"

  @AC-3 @FR-2
  Scenario: The P99 latency rule is evaluated per stack
    Given packages/otel/alerts/alert-rules.yaml after this feature
    When the xstk-p99-latency-high expression is read
    Then its histogram_quantile aggregates by le, service_name, deployment_environment and host_provider, and its selector keeps the rpc_method!~ exclusion

  @AC-4 @FR-3
  Scenario: A dead loop in one stack fires the heartbeat even while another stack is live
    Given the homelab staging analysis loop logs "live_loop: cycle complete" every minute and the DO dev analysis loop has logged nothing for 31 minutes
    When the heartbeat rule evaluates
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
    Then it has a host_provider variable next to environment, and every panel query filters both deployment_environment=~"$environment" and host_provider=~"$host_provider"

  @AC-7 @FR-5
  Scenario: The produced-signal guard stays green
    Given the changed alert rules, the dashboard and packages/otel/produced-signals.tsv
    When scripts/check-otel-produced-signals.sh runs
    Then it exits 0, and removing the rpc_method!~ exclusion from any changed selector makes it exit non-zero with an AC-17 P4 hit

  @AC-8 @FR-6
  Scenario: Documentation states the scoping and the manual re-import
    Given docs/patterns/observability.md, packages/otel/alerts/README.md and packages/otel/dashboards/README.md after this feature
    When a reader looks up the alert and dashboard scoping
    Then they name the three stacks, the labels each alert carries, the expected-stack list, and the manual Grafana re-import of alert-rules.yaml
