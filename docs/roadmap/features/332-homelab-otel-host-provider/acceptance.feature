Feature: homelab-otel-host-provider
  As an operator running the homelab Compose stack alongside DO, I want homelab services to export telemetry to the same Grafana Cloud stack with a host_provider resource attribute, so that I can separate homelab from DO data even when deployment.environment collides.

  @AC-1 @FR-1
  Scenario: Every runtime stamps host_provider on all three signals
    Given a service of each of the 12 runtimes starts with OTEL_ENABLED=true and HOST_PROVIDER=homelab
    When it records one span, one metric data point and one log record through an in-memory exporter
    Then each of the three exported resources contains the attribute host_provider="homelab" alongside service.name, deployment.environment and platform="xstockstrat"

  @AC-2 @FR-1
  Scenario: host_provider is stamped for DO as well
    Given the trading service starts with OTEL_ENABLED=true and HOST_PROVIDER=digitalocean
    When it exports a span
    Then the span's resource has host_provider="digitalocean"

  @AC-3 @FR-2
  Scenario: Unset HOST_PROVIDER yields the documented default and does not block startup
    Given the ingest service starts with OTEL_ENABLED=true and HOST_PROVIDER unset
    When telemetry initialises
    Then the service reaches SERVING and its exported resource has the documented default host_provider value

  @AC-4 @FR-2
  Scenario: Unrecognised HOST_PROVIDER is normalised, not fatal
    Given the ledger service starts with OTEL_ENABLED=true and HOST_PROVIDER="aws"
    When telemetry initialises
    Then the service reaches SERVING and exports the documented default host_provider value rather than "aws"

  @AC-5 @FR-2
  Scenario: Telemetry disabled still starts cleanly
    Given any service starts with OTEL_ENABLED=false and HOST_PROVIDER=homelab
    When the process initialises
    Then it reaches SERVING and exports no telemetry

  @AC-6 @FR-3 @FR-6
  Scenario: Rendered homelab compose enables telemetry for every service
    Given the homelab release .env carries OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp-gateway-prod-us-east-0.grafana.net/otlp" and HOST_PROVIDER=homelab
    When scripts/homelab-render-check.sh renders deploy/homelab/compose.yml
    Then for each of the 12 runtime services OTEL_ENABLED is "true", HOST_PROVIDER is "homelab", and OTEL_EXPORTER_OTLP_ENDPOINT is non-empty

  @AC-7 @FR-3 @FR-6
  Scenario: Render check fails when a service would ship without telemetry wiring
    Given a rendered compose in which the ui service has OTEL_ENABLED "false"
    When the render assertion runs
    Then it exits non-zero naming "xstockstrat-ui" and "OTEL_ENABLED"

  @AC-8 @FR-4
  Scenario: OTLP credentials come from SOPS and never appear in logs
    Given the production SOPS file holds the Grafana Cloud OTLP header value
    When deploy-homelab resolves secrets with "sops_secrets.py resolve --env production --target homelab"
    Then OTEL_EXPORTER_OTLP_HEADERS is present in the release .env as "Authorization=Basic …" and no workflow log line contains the base64 token

  @AC-9 @FR-4
  Scenario: Missing OTLP secret fails the release rather than shipping silent no-export
    Given the SOPS file for staging lacks the OTLP header key
    When deploy-homelab builds the release .env
    Then the job fails with an error naming the missing key and no compose is shipped

  @AC-10 @FR-5
  Scenario: Metrics can be restricted by host_provider
    Given homelab and DO both export rpc_server_duration_milliseconds_count with deployment_environment="staging"
    When the documented PromQL query for host_provider="homelab" is run over the last 15 minutes
    Then only series whose service_instance_id belongs to homelab containers are returned and none with a k8s pod host_name

  @AC-11 @FR-5
  Scenario: Logs can be restricted by host_provider
    Given homelab and DO both ship logs for service_name="analysis"
    When the documented LogQL query for host_provider="homelab" is run over the last 15 minutes
    Then every returned line originates from a homelab instance and none from a DO pod

  @AC-12 @FR-7
  Scenario: Documentation states the attribute contract
    Given docs/patterns/observability.md after this feature
    When a reader looks up the resource attributes
    Then it lists host_provider with values "digitalocean" and "homelab", the default for an unset value, and one copy-paste PromQL and one LogQL example
