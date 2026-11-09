Feature: grafana-dashboards-ci-deploy
  As a platform engineer, I want a merge that touches packages/otel/dashboards/ to upsert those dashboards into Grafana Cloud, so that the repo and the live stack cannot drift and no operator imports JSON by hand.

  # Scenarios run offline: curl is stubbed by a fake Grafana API recording every request.

  Background:
    Given the fake Grafana serves GET /api/datasources/uid/<uid> with HTTP 200 for "grafanacloud-prom", "grafanacloud-logs" and "grafanacloud-traces"

  @AC-1 @FR-1
  Scenario: Every checked-in dashboard is upserted into the managed folder
    Given packages/otel/dashboards/ holds service-health.json, service-detail.json, signal-pipeline-throughput.json, infrastructure.json and trading-service.json
    And the fake Grafana returns HTTP 404 for GET /api/folders/xstockstrat
    When scripts/grafana-deploy-dashboards.sh runs with GRAFANA_URL "https://xstk.grafana.net/" and GRAFANA_SERVICE_ACCOUNT_TOKEN "tok-123"
    Then the fake receives POST /api/folders with uid "xstockstrat"
    And it receives 5 POST /api/dashboards/db requests, each with folderUid "xstockstrat" and overwrite true
    And the uids posted are xstk-service-health, xstk-service-detail, xstk-signal-pipeline, xstk-infrastructure and xstk-trading-service
    And neither stdout nor stderr contains "tok-123"
    And the exit code is 0

  @AC-2 @FR-2
  Scenario: The Tempo placeholder is resolved alongside Prometheus and Loki
    When the script uploads service-health.json with no overrides
    Then the posted payload contains 0 occurrences of the substring "${DS_"
    And it contains 6 datasource references to "grafanacloud-traces"
    And the payload has no "__inputs" and no "__requires" key

  @AC-3 @FR-2
  Scenario: Datasources are chosen by uid, never by type or list order
    Given the fake Grafana's list endpoint returns loki datasources "grafanacloud-alert-state-history" first, "grafanacloud-logs" second and "grafanacloud-usage-insights" third, none with isDefault true
    When the script runs without overrides
    Then the fake receives 0 requests to the list endpoint GET /api/datasources (exact path, no /uid/ suffix)
    And every posted Loki datasource reference is "grafanacloud-logs"
    And no payload contains "grafanacloud-alert-state-history" or "grafanacloud-usage-insights"

  @AC-4 @FR-2
  Scenario: Env overrides replace the default uids
    Given GRAFANA_PROMETHEUS_DS_UID is "override-prom", GRAFANA_LOKI_DS_UID is "override-loki" and GRAFANA_TEMPO_DS_UID is "override-tempo", all three served by the fake
    When the script runs
    Then the fake receives GET /api/datasources/uid/override-prom, /override-loki and /override-tempo
    And it receives 0 requests for "grafanacloud-prom", "grafanacloud-logs" and "grafanacloud-traces"
    And the posted payloads reference "override-prom", "override-loki" and "override-tempo"

  @AC-5 @FR-3
  Scenario: A second run with unchanged inputs changes nothing
    Given the script has run once against the fake and the folder holds 5 dashboards
    When the script runs again with the same inputs
    Then the fake still holds exactly 5 dashboards with the same 5 uids
    And every posted payload has "id" null
    And the exit code is 0

  @AC-6 @FR-4
  Scenario: One invalid dashboard file does not block the others but fails the run
    Given trading-service.json is truncated to the text "{ \"uid\": "
    When the script runs
    Then the fake receives 4 POST /api/dashboards/db requests
    And stderr contains "trading-service.json" and "INVALID JSON"
    And the exit code is 1

  @AC-7 @FR-4
  Scenario Outline: A missing required variable fails before any HTTP call
    Given <var> is unset and the other required variable is set
    When the script runs
    Then stderr contains "<var> is not set"
    And the fake receives 0 requests
    And the exit code is 1

    Examples:
      | var                           |
      | GRAFANA_URL                   |
      | GRAFANA_SERVICE_ACCOUNT_TOKEN |

  @AC-8 @FR-2 @FR-4
  Scenario: A missing datasource uid uploads nothing
    Given the fake instead returns HTTP 404 for GET /api/datasources/uid/grafanacloud-logs
    When the script runs without overrides
    Then stderr contains "datasource uid grafanacloud-logs not found"
    And the fake receives 0 POST /api/dashboards/db requests
    And the exit code is 1

  @AC-9 @FR-4
  Scenario: A rejected upload is reported with its HTTP status and fails the run
    Given GRAFANA_SERVICE_ACCOUNT_TOKEN is "tok-123" and the fake returns HTTP 412 for the dashboard with uid "xstk-infrastructure"
    When the script runs
    Then stderr contains "infrastructure.json" and "HTTP 412"
    And the other 4 dashboards are still posted
    And neither stdout nor stderr contains "tok-123"
    And the exit code is 1

  @AC-10 @FR-1 @FR-5 @FR-6
  Scenario: The workflow deploys from main-dev only, is serialized and least-privilege
    Given .github/workflows/grafana-dashboards.yml
    Then its push trigger lists branch main-dev only and paths "packages/otel/dashboards/**", "scripts/grafana-deploy-dashboards.sh" and ".github/workflows/grafana-dashboards.yml"
    And its triggers also include workflow_dispatch
    And its triggers do not include pull_request or pull_request_target
    And no job or step "if:" condition tests whether the Grafana secrets are set
    And its concurrency group is the constant "grafana-dashboards" (no "github.ref") with cancel-in-progress false
    And its job declares "environment: grafana" and permissions contents read
    And every "uses:" of actions/checkout in it is pinned to a 40-hex SHA
    And the token is referenced only in the deploy step env block

  @AC-11 @FR-7
  Scenario: The offline transform test runs in CI on the real dashboards
    Given scripts/grafana-deploy-dashboards.test.sh and the five real files under packages/otel/dashboards/
    When bash scripts/grafana-deploy-dashboards.test.sh runs
    Then it exits 0 and prints one PASS line per scenario AC-1 to AC-9
    And .github/workflows/ci.yml runs it when scripts/grafana-deploy-dashboards*.sh or packages/otel/dashboards/** changes

  @AC-12 @FR-8
  Scenario: Docs describing the CI path name only real assets, state the policies and keep the guard green
    Given the updated docs/setup/grafana-cloud.md and packages/otel/dashboards/README.md
    When bash scripts/check-otel-produced-signals.sh runs
    Then it exits 0
    And both docs name ".github/workflows/grafana-dashboards.yml" and "scripts/grafana-deploy-dashboards.sh"
    And both docs state that UI edits are overwritten and that dashboards removed from the repo are not deleted
    And docs/setup/grafana-cloud.md states that the "grafana" environment restricts deployment branches to main-dev
    And both docs show the manual invocation "scripts/grafana-deploy-dashboards.sh"
    And .env.example names GRAFANA_URL and GRAFANA_SERVICE_ACCOUNT_TOKEN in its GitHub-secrets comment block
    And root CLAUDE.md Key File Paths lists ".github/workflows/grafana-dashboards.yml"
    And docs/setup/CLAUDE.md's grafana-cloud.md row mentions the CI dashboard deploy

  @AC-14 @FR-10
  Scenario: Every query target in the four dashboards is environment-scoped
    Given service-health.json, signal-pipeline-throughput.json, infrastructure.json and trading-service.json as checked in
    Then each declares a templating variable "environment" with multi true and includeAll true
    And all 9 PromQL targets contain 'deployment_environment=~"$environment"'
    And all 3 LogQL targets contain 'deployment_environment=~"$environment"' in the stream selector
    And all 3 TraceQL targets contain 'resource.deployment.environment =~ "$environment"'
    And each variable's current selection is All (value "$__all")
    And no expression in the 4 files contains "development" as an excluded value
    And service-detail.json has the same content hash as before this feature

  # Operator check on the staging stack after the first deploy; not run in CI.
  @AC-15 @FR-10 @manual
  Scenario: Selecting one environment isolates its series
    Given the stack holds rpc_server_duration_milliseconds_count{service_name="trading", deployment_environment="staging"} at 2 req/s and {service_name="trading", deployment_environment="development"} at 5 req/s
    When Service Health "Request rate (gRPC req/s)" is rendered with environment "staging"
    Then the "trading" series shows 2 req/s
    And with environment "development" it shows 5 req/s
    And with All selected it shows 7 req/s

  @AC-16 @FR-10
  Scenario: The edited dashboards still satisfy the produced-signals guard
    Given the four edited dashboards
    When bash scripts/check-otel-produced-signals.sh runs
    Then it exits 0
    And every rpc_server_duration_milliseconds_* selector in them still carries the proto-derived rpc_method!~ stream exclusion

  # @AC-17 @FR-11 withdrawn 2026-11-05: alert rules are out of scope (Q9). ID not reused.
  # @AC-13 @FR-9 withdrawn 2026-11-05: the Grafana MCP part is split out (Q3). ID not reused.
