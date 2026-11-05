Feature: grafana-dashboards-ci-deploy
  As a platform engineer, I want a merge that touches packages/otel/dashboards/ to upsert those dashboards into Grafana Cloud, so that the repo and the live stack cannot drift and no operator imports JSON by hand.

  # Scenarios run offline: curl is stubbed by a fake Grafana API recording every request.

  @AC-1 @FR-1
  Scenario: Every checked-in dashboard is upserted into the managed folder
    Given packages/otel/dashboards/ holds service-health.json, service-detail.json, signal-pipeline-throughput.json, infrastructure.json and trading-service.json
    And the fake Grafana returns HTTP 404 for GET /api/folders/xstockstrat
    When scripts/grafana-deploy-dashboards.sh runs with GRAFANA_URL "https://xstk.grafana.net/" and a token
    Then the fake receives POST /api/folders with uid "xstockstrat"
    And it receives 5 POST /api/dashboards/db requests, each with folderUid "xstockstrat" and overwrite true
    And the uids posted are xstk-service-health, xstk-service-detail, xstk-signal-pipeline, xstk-infrastructure and xstk-trading-service
    And the exit code is 0

  @AC-2 @FR-2
  Scenario: The Tempo placeholder is resolved alongside Prometheus and Loki
    Given the fake Grafana lists datasources prometheus "prom-uid-1", loki "loki-uid-1" and tempo "tempo-uid-1"
    When the script uploads service-health.json
    Then the posted payload contains 0 occurrences of the substring "${DS_"
    And it contains 6 datasource references to "tempo-uid-1"
    And the payload has no "__inputs" and no "__requires" key

  @AC-3 @FR-2
  Scenario: Discovery does not bind panels to a non-stack datasource of the same type
    Given the fake Grafana lists loki datasources "grafanacloud-alert-state-history" (uid "alert-hist-uid") first, "grafanacloud-logs" (uid "loki-uid-1") second and "grafanacloud-usage-insights" (uid "usage-ins-uid") third, none with isDefault true
    When the script runs without GRAFANA_LOKI_DS_UID
    Then every posted Loki datasource reference is "loki-uid-1"
    And no payload contains "alert-hist-uid" or "usage-ins-uid"

  @AC-4 @FR-2
  Scenario: Env overrides skip discovery for that type
    Given GRAFANA_PROMETHEUS_DS_UID is "override-prom", GRAFANA_LOKI_DS_UID is "override-loki" and GRAFANA_TEMPO_DS_UID is "override-tempo"
    When the script runs
    Then the fake receives 0 requests to GET /api/datasources
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
  Scenario: A missing token fails before any HTTP call
    Given GRAFANA_SERVICE_ACCOUNT_TOKEN is unset
    When the script runs
    Then stderr contains "GRAFANA_SERVICE_ACCOUNT_TOKEN is not set"
    And the fake receives 0 requests
    And the exit code is 1

  @AC-8 @FR-4
  Scenario: A stack with no Loki datasource uploads nothing
    Given the fake Grafana lists only a prometheus datasource "prom-uid-1" and a tempo datasource "tempo-uid-1"
    When the script runs without GRAFANA_LOKI_DS_UID
    Then stderr contains "no Loki datasource found"
    And the fake receives 0 POST /api/dashboards/db requests
    And the exit code is 1

  @AC-9 @FR-4
  Scenario: A rejected upload is reported with its HTTP status and fails the run
    Given the fake returns HTTP 412 for the dashboard with uid "xstk-infrastructure"
    When the script runs
    Then stderr contains "infrastructure.json" and "HTTP 412"
    And the other 4 dashboards are still posted
    And the exit code is 1

  @AC-10 @FR-5 @FR-6
  Scenario: The workflow is path-filtered, serialized per stack and least-privilege
    Given .github/workflows/grafana-dashboards.yml
    Then its push trigger lists branches main-dev and main and paths "packages/otel/dashboards/**", "scripts/grafana-deploy-dashboards.sh" and ".github/workflows/grafana-dashboards.yml"
    And its concurrency group does not contain "github.ref" and has cancel-in-progress false
    And it declares permissions contents read
    And every "uses:" of actions/checkout is pinned to a 40-hex SHA
    And the token is referenced only in the deploy step env block

  @AC-11 @FR-7
  Scenario: The offline transform test runs in CI on the real dashboards
    Given scripts/grafana-deploy-dashboards.test.sh and the five real files under packages/otel/dashboards/
    When bash scripts/grafana-deploy-dashboards.test.sh runs
    Then it exits 0 and prints one PASS line per scenario AC-1 to AC-9
    And .github/workflows/ci.yml runs it when scripts/grafana-deploy-dashboards*.sh changes

  @AC-12 @FR-8
  Scenario: Docs describing the CI path name only real assets and keep the guard green
    Given the updated docs/setup/grafana-cloud.md and packages/otel/dashboards/README.md
    When bash scripts/check-otel-produced-signals.sh runs
    Then it exits 0
    And both docs name ".github/workflows/grafana-dashboards.yml" and "scripts/grafana-deploy-dashboards.sh"

  # @AC-13 @FR-9 withdrawn 2026-11-05: the Grafana MCP part is split out (Q3). ID not reused.
