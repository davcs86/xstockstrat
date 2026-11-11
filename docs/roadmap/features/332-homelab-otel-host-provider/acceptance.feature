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
    Given the notify service starts with OTEL_ENABLED=false and HOST_PROVIDER=homelab
    When the process initialises
    Then it reaches SERVING and exports no telemetry

  @AC-6 @FR-3 @FR-6
  Scenario: Rendered homelab compose enables telemetry for every service
    Given a release .env built by scripts/homelab-release-env.sh from an APP_ENV carrying OTEL_EXPORTER_OTLP_ENDPOINT='https://otlp.example.test/otlp' and OTEL_EXPORTER_OTLP_HEADERS='Authorization=Basic dGVzdA=='
    When scripts/homelab-render-check.sh renders deploy/homelab/compose.yml
    Then for each of the 12 runtime services (every service except db-migrator) OTEL_ENABLED is "true", HOST_PROVIDER is "homelab", OTEL_EXPORTER_OTLP_ENDPOINT is non-empty and OTEL_EXPORTER_OTLP_HEADERS starts with "Authorization=", and the failed-check list is []

  @AC-7 @FR-3 @FR-6
  Scenario Outline: Render check fails when a service would ship without telemetry wiring
    Given a rendered compose in which the <service> service has <broken>
    When deploy/homelab/render-assert.jq runs
    Then its failed-check list contains "<label>", contains no environment value, and the check exits non-zero

    Examples:
      | service            | broken                                  | label                      |
      | xstockstrat-ui     | OTEL_ENABLED "false"                    | otel:xstockstrat-ui        |
      | xstockstrat-trading | OTEL_EXPORTER_OTLP_HEADERS "SECRETPROBE" | otel:xstockstrat-trading |

  @AC-14 @FR-6
  Scenario: Render check fails when a service would ship with the wrong host provider
    Given a rendered compose in which the xstockstrat-analysis service has HOST_PROVIDER "digitalocean"
    When deploy/homelab/render-assert.jq runs
    Then its failed-check list contains "host-provider:xstockstrat-analysis", contains no environment value, and the check exits non-zero

  @AC-8 @FR-4
  Scenario: Homelab resolves the OTLP keys from SOPS and never logs them
    Given a SOPS file whose common namespace holds OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp.example.test/otlp" and OTEL_EXPORTER_OTLP_HEADERS="Basic dGVzdA=="
    When "sops_secrets.py resolve --env staging --target homelab" runs
    Then the APP_ENV export contains both keys, the summary lists each as "sops", and "dGVzdA==" appears in no stderr line and in no stdout line other than an "::add-mask::" command

  @AC-9 @FR-4
  Scenario: The homelab resolver prefixes the header exactly once
    Given the SOPS common.OTEL_EXPORTER_OTLP_HEADERS is "Basic dGVzdA=="
    When "sops_secrets.py resolve --env staging --target homelab" runs
    Then the exported APP_ENV contains the line OTEL_EXPORTER_OTLP_HEADERS='Authorization=Basic dGVzdA==', and a resolved value already starting "Authorization=" is exported with a single prefix

  @AC-16 @FR-4
  Scenario: A missing OTLP key fails the compose render before any ship step
    Given a release .env with OTEL_EXPORTER_OTLP_ENDPOINT but without OTEL_EXPORTER_OTLP_HEADERS
    When scripts/homelab-render-check.sh renders deploy/homelab/compose.yml
    Then it exits non-zero and its filtered output reads "required variable OTEL_EXPORTER_OTLP_HEADERS is missing a value"

  @AC-17 @FR-4
  Scenario: DO secret resolution is unchanged
    Given the same SOPS file
    When the DO app spec is rendered with scripts/do-render-app-spec.py
    Then OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS are filled exactly as before this feature, and the keys remain optional (required=False) for the DO target

  @AC-10 @FR-5
  Scenario: The documented PromQL query selects by host_provider within one environment
    Given the single fenced promql block tagged otel-guard:host-provider in docs/patterns/observability.md
    When scripts/check-otel-produced-signals.sh scans it
    Then its brackets balance; every metric it selects is registered in packages/otel/produced-signals.tsv (rpc_server_duration_milliseconds_count and target_info); the rpc_server_duration_milliseconds_count selector carries deployment_environment="staging" and the server-streaming rpc_method!~ exclusion byte-identical to the one in packages/otel/alerts/alert-rules.yaml; the target_info selector carries deployment_environment="staging" and host_provider="homelab"; and the join is on (job, instance, deployment_environment) group_left (host_provider) over group by (job, instance, deployment_environment, host_provider)

  @AC-11 @FR-5
  Scenario: The documented LogQL query selects by host_provider within one environment
    Given the single fenced logql block tagged otel-guard:host-provider in docs/patterns/observability.md
    When scripts/check-otel-produced-signals.sh scans it
    Then its brackets and quotes balance, its stream {service_name="analysis"} is registered, and it filters both deployment_environment="staging" and host_provider="homelab"

  @AC-12 @FR-7
  Scenario: Documentation states the attribute contract
    Given docs/patterns/observability.md after this feature
    When a reader looks up the resource attributes
    Then it lists host.provider with values "digitalocean", "homelab" and "unknown", states that an unset or unrecognised value resolves to "unknown", states that Go, Node and UI set service.instance.id to "<host.provider>-<service.name>", states "Do not set OTEL_RESOURCE_ATTRIBUTES", gives one copy-paste PromQL and one LogQL example that each filter both deployment_environment and host_provider (staging and production share one Grafana instance), states the homelab egress precondition, and lists a manual post-deploy check: count(group by (job) (target_info{deployment_environment="staging", host_provider="homelab"})) returns at least 11 jobs on an idle homelab stack and 12 after one UI login, the documented PromQL returns at least 1 series after one RPC, and an empty target_info result 5 minutes after a healthy deploy means blocked egress

  @AC-15 @FR-8
  Scenario: Every deployment target sets HOST_PROVIDER per the target table
    Given the app specs .do/app.dev.yaml and .do/app.yaml and the local docker-compose.yml after this feature
    When their top-level envs are read
    Then .do/app.dev.yaml and .do/app.yaml each contain key HOST_PROVIDER with value "digitalocean", .do/app.yaml keeps OTEL_ENABLED "false", and docker-compose.yml sets no HOST_PROVIDER

  @AC-18 @FR-3
  Scenario: Homelab staging reports the staging environment
    Given TARGET_ENV=staging
    When scripts/homelab-release-env.sh builds the release .env and scripts/homelab-render-check.sh renders it
    Then all 12 app services have APPLICATION_ENV "staging" and TRADING_MODE "paper"

  @AC-19 @FR-1
  Scenario Outline: The series discriminator is deterministic per provider and service
    Given the <service> service starts with OTEL_ENABLED=true and HOST_PROVIDER=homelab
    When it exports a metric data point
    Then its resource has service.instance.id="<instance>"

    Examples:
      | service  | instance        |
      | trading  | homelab-trading |
      | ledger   | homelab-ledger  |
      | ui       | homelab-ui      |

  @AC-20 @FR-3 @FR-6
  Scenario: A release .env cannot switch off homelab telemetry or change its provider
    Given an APP_ENV carrying OTEL_ENABLED=false and HOST_PROVIDER=digitalocean, which reach the pipeline-built release .env unchanged
    When scripts/homelab-render-check.sh renders deploy/homelab/compose.yml with that .env
    Then every one of the 12 runtime services still has OTEL_ENABLED "true" and HOST_PROVIDER "homelab", and the failed-check list is []

  @AC-21 @FR-1
  Scenario: Python services keep an SDK-generated instance id
    Given the indicators service starts with OTEL_ENABLED=true and HOST_PROVIDER=homelab
    When it exports a metric data point
    Then its resource has a non-empty service.instance.id that does not start with "homelab-"

  @AC-22 @FR-1
  Scenario: A deploy spec that sets OTEL_RESOURCE_ATTRIBUTES is rejected
    Given deploy/homelab/compose.yml sets OTEL_RESOURCE_ATTRIBUTES to "host.provider=digitalocean"
    When scripts/check-otel-produced-signals.sh scans the deploy specs (.do/app.yaml, .do/app.dev.yaml, docker-compose.yml, deploy/homelab/compose.yml)
    Then it exits non-zero with a hit tagged "AC-22 P4-resattr" that names deploy/homelab/compose.yml and the line

  @AC-23 @FR-3
  Scenario: The span-derived metrics guard covers the homelab compose
    Given deploy/homelab/compose.yml sets OTEL_TRACES_SAMPLER to "traceidratio"
    When scripts/check-otel-produced-signals.sh scans the deploy specs
    Then it exits non-zero with a hit tagged "AC-17 P4-sampler" that names deploy/homelab/compose.yml and the line
