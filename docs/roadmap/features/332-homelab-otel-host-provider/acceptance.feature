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
    Given a render fixture .env carrying the placeholder OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp.example.test/otlp", OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic dGVzdA==" and HOST_PROVIDER=homelab
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
  Scenario: Homelab resolves the OTLP keys from SOPS and never logs them
    Given a SOPS file whose common namespace holds OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp.example.test/otlp" and OTEL_EXPORTER_OTLP_HEADERS="Basic dGVzdA=="
    When "sops_secrets.py resolve --env staging --target homelab" runs
    Then the APP_ENV export contains both keys, the summary lists each as "sops", and no output line contains "dGVzdA=="

  @AC-9 @FR-4
  Scenario: Release env prefixes the header exactly once
    Given the resolved OTEL_EXPORTER_OTLP_HEADERS is "Basic dGVzdA=="
    When scripts/homelab-release-env.sh builds the release .env
    Then OTEL_EXPORTER_OTLP_HEADERS in it is "Authorization=Basic dGVzdA==", and a resolved value already starting "Authorization=Basic " is left with a single prefix

  @AC-16 @FR-4
  Scenario: A missing OTLP key fails the compose render before any ship step
    Given a release .env without OTEL_EXPORTER_OTLP_HEADERS
    When scripts/homelab-render-check.sh renders deploy/homelab/compose.yml
    Then it exits non-zero with a message naming "OTEL_EXPORTER_OTLP_HEADERS is required"

  @AC-17 @FR-4
  Scenario: DO secret resolution is unchanged
    Given the same SOPS file
    When the DO app spec is rendered with scripts/do-render-app-spec.py
    Then OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS are filled exactly as before this feature, and the keys remain optional (required=False) for the DO target

  @AC-10 @FR-5
  Scenario: The documented PromQL query selects by host_provider
    Given the fenced promql block for the homelab filter in docs/patterns/observability.md
    When a repo test extracts the block and parses it
    Then it parses without error, selects rpc_server_duration_milliseconds_count, and contains the matcher host_provider="homelab"

  @AC-11 @FR-5
  Scenario: The documented LogQL query selects by host_provider
    Given the fenced logql block for the homelab filter in docs/patterns/observability.md
    When a repo test extracts the block and parses it
    Then it parses without error, selects the stream {service_name="analysis"}, and contains the matcher host_provider="homelab"

  @AC-12 @FR-7
  Scenario: Documentation states the attribute contract
    Given docs/patterns/observability.md after this feature
    When a reader looks up the resource attributes
    Then it lists host.provider with values "digitalocean", "homelab" and "unknown", states that an unset value resolves to "unknown", gives one copy-paste PromQL and one LogQL example, and lists a manual post-deploy check naming the expected result: the homelab query returns series whose host_name does not match ".+-[a-z0-9]{8,10}-[a-z0-9]{5}$" and the digitalocean query returns none that do

  @AC-15 @FR-8
  Scenario: Every deployment target sets HOST_PROVIDER per the target table
    Given the app specs .do/app.dev.yaml and .do/app.yaml and the local docker-compose.yml after this feature
    When their top-level envs are read
    Then .do/app.dev.yaml and .do/app.yaml each contain key HOST_PROVIDER with value "digitalocean", .do/app.yaml keeps OTEL_ENABLED "false", and docker-compose.yml sets no HOST_PROVIDER
