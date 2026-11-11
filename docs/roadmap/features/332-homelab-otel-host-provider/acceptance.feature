Feature: homelab-otel-host-provider
  As an operator running the homelab Compose stack alongside DO, I want homelab services to export telemetry to the same Grafana Cloud stack with a host.provider resource attribute, so that I can separate homelab from DO data even when deployment.environment collides.

  @AC-1 @FR-1
  Scenario: Every runtime stamps host.provider on all three signals
    Given a service of each of the 12 runtimes starts with OTEL_ENABLED=true and HOST_PROVIDER=homelab
    When it records one span, one metric data point and one log record through an in-memory exporter
    Then each of the three exported resources contains the attribute host.provider="homelab" alongside service.name, deployment.environment and platform="xstockstrat"

  @AC-2 @FR-1
  Scenario: host.provider is stamped for DO as well
    Given the trading service starts with OTEL_ENABLED=true and HOST_PROVIDER=digitalocean
    When it exports a span
    Then the span's resource has host.provider="digitalocean"

  @AC-3 @FR-2
  Scenario: Unset HOST_PROVIDER yields the documented default and does not block startup
    Given the ingest service starts with OTEL_ENABLED=true and HOST_PROVIDER unset
    When telemetry initialises
    Then the service reaches SERVING and its exported resource has host.provider="unknown"

  @AC-4 @FR-2
  Scenario: Unrecognised HOST_PROVIDER is normalised, not fatal
    Given the ledger service starts with OTEL_ENABLED=true and HOST_PROVIDER="aws"
    When telemetry initialises
    Then the service reaches SERVING and exports host.provider="unknown" rather than "aws"

  @AC-13 @FR-2
  Scenario: Only the exact lowercase value is accepted
    Given the config service starts with OTEL_ENABLED=true and HOST_PROVIDER="Homelab"
    When telemetry initialises
    Then the service reaches SERVING and exports host.provider="unknown"

  @AC-5 @FR-2
  Scenario: Telemetry disabled still starts cleanly
    Given any service starts with OTEL_ENABLED=false and HOST_PROVIDER=homelab
    When the process initialises
    Then it reaches SERVING and exports no telemetry

  @AC-6 @FR-3 @FR-6
  Scenario: Rendered homelab compose enables telemetry for every service
    Given the homelab release .env carries OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp-gateway-prod-us-central-0.grafana.net/otlp" and HOST_PROVIDER=homelab
    When scripts/homelab-render-check.sh renders deploy/homelab/compose.yml
    Then for each of the 12 runtime services (every service except db-migrator) OTEL_ENABLED is "true", HOST_PROVIDER is "homelab", and OTEL_EXPORTER_OTLP_ENDPOINT is non-empty, and the failed-check list is []

  @AC-7 @FR-3 @FR-6
  Scenario: Render check fails when a service would ship without telemetry wiring
    Given a rendered compose in which the xstockstrat-ui service has OTEL_ENABLED "false"
    When deploy/homelab/render-assert.jq runs
    Then its failed-check list contains "otel:xstockstrat-ui" and the check exits non-zero

  @AC-14 @FR-6
  Scenario: Render check fails when a service would ship with the wrong host provider
    Given a rendered compose in which the xstockstrat-analysis service has HOST_PROVIDER "digitalocean"
    When deploy/homelab/render-assert.jq runs
    Then its failed-check list contains "host-provider:xstockstrat-analysis" and the check exits non-zero

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

  @AC-10 @FR-5 @smoke
  Scenario: Metrics can be restricted by host.provider (label host_provider)
    Given a post-deploy smoke run with homelab and DO dev both exporting rpc_server_duration_milliseconds_count for service_name="trading" with deployment_environment="staging"
    When the PromQL query documented in docs/patterns/observability.md for host_provider="homelab" is evaluated over the last 15 minutes
    Then the result is non-empty, every returned series joins to target_info with host_provider="homelab", and no returned series has a host_name matching ".+-[a-z0-9]{8,10}-[a-z0-9]{5}$"

  @AC-11 @FR-5 @smoke
  Scenario: Logs can be restricted by host.provider (label host_provider)
    Given a post-deploy smoke run with homelab and DO dev both shipping logs for {service_name="analysis"}
    When the LogQL query documented in docs/patterns/observability.md filtering host_provider="homelab" is evaluated over the last 15 minutes
    Then at least 1 line is returned and the same query with host_provider="digitalocean" returns 0 of those lines

  @AC-12 @FR-7
  Scenario: Documentation states the attribute contract
    Given docs/patterns/observability.md after this feature
    When a reader looks up the resource attributes
    Then it lists host.provider with values "digitalocean", "homelab" and "unknown", states that an unset value resolves to "unknown", and gives one copy-paste PromQL and one LogQL example

  @AC-15 @FR-8
  Scenario: Every deployment target sets HOST_PROVIDER per the target table
    Given the app specs .do/app.dev.yaml and .do/app.yaml and the local docker-compose.yml after this feature
    When their top-level envs are read
    Then .do/app.dev.yaml and .do/app.yaml each contain key HOST_PROVIDER with value "digitalocean", .do/app.yaml keeps OTEL_ENABLED "false", and docker-compose.yml sets no HOST_PROVIDER
