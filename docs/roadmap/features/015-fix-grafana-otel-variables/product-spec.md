# Product Spec: fix-grafana-otel-variables

**Created**: 2026-05-21

---

## Problem Statement

The OpenTelemetry environment variables are inconsistent across the three deployment targets (Docker Compose, DO dev, DO prod), making it impossible to enable Grafana Cloud telemetry on DigitalOcean App Platform without manual per-service edits that are not captured in the app specs. Phase 7 (Observability) is still "Pending" partly because the DO app specs lack the OTel wiring needed to activate it.

## User Story

As a platform operator, I want the OTel environment variables to be consistent and complete across Docker Compose and both DigitalOcean app specs, so that I can enable Grafana Cloud telemetry on any environment by setting `OTEL_ENABLED=true` and the Grafana secret values without editing the spec structure.

## Functional Requirements

FR-1. The `OTEL_RESOURCE_ATTRIBUTES` common-env anchor in `docker-compose.yml` must reference `${APPLICATION_ENV}`, `${TRADING_MODE}`, and `${OTEL_SERVICE_NAME}` (all defined per-service or in `x-common-env`) and include `platform=xstockstrat`. Docker Compose resolves all three per-container at start time, producing e.g. `environment=development,trading_mode=paper,platform=xstockstrat,service.name=xstockstrat-trading` for the trading service. Note: `OTEL_SERVICE_NAME` is already set per-service in docker-compose; adding it to `OTEL_RESOURCE_ATTRIBUTES` makes `service.name` explicit in the attribute bag without relying solely on SDK convention.

FR-2. The `resource` processor in `packages/otel/otel-collector-config.yaml` must have its `environment: dev` upsert removed. Services now set the correct `environment` value via their own `OTEL_RESOURCE_ATTRIBUTES`; the collector upsert would silently override `development` → `dev`, creating an inconsistency.

FR-3. Every service entry in `.do/app.dev.yaml` must have `OTEL_SERVICE_NAME` set to its canonical service name (e.g. `xstockstrat-trading`).

FR-4. `.do/app.dev.yaml` must declare global-level env vars for `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (single global SECRET — DO App Platform global vars cannot reference component-level vars, so a shared token is the correct approach), and `OTEL_RESOURCE_ATTRIBUTES` referencing `${APPLICATION_ENV}` and `${TRADING_MODE}` plus `platform=xstockstrat`. `service.name` is intentionally omitted from the global `OTEL_RESOURCE_ATTRIBUTES` because DO global vars cannot reference per-service `OTEL_SERVICE_NAME`; the OTel SDK automatically promotes `OTEL_SERVICE_NAME` to `service.name` at runtime.

FR-5. Every service entry in `.do/app.yaml` must have `OTEL_SERVICE_NAME` set to its canonical service name.

FR-6. `.do/app.yaml` must declare global-level env vars for `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (single global SECRET), and `OTEL_RESOURCE_ATTRIBUTES` referencing `${APPLICATION_ENV}` and `${TRADING_MODE}` plus `platform=xstockstrat`, resolving to `environment=production,trading_mode=live,platform=xstockstrat` in production. Same `service.name` handling as FR-4 applies.

FR-7. The `docs/patterns/observability.md` env var table must be updated to document `OTEL_RESOURCE_ATTRIBUTES` as `environment=${APPLICATION_ENV},trading_mode=${TRADING_MODE},platform=xstockstrat,service.name=${OTEL_SERVICE_NAME}` for Docker Compose, with a note that in DO app specs `service.name` is omitted from the global var and comes from `OTEL_SERVICE_NAME` via the SDK.

## Out of Scope

- Implementing the Phase 7 OTel SDK wiring inside any service (telemetry modules already exist; this is only config/spec alignment)
- Changing `OTEL_ENABLED` from `false` to `true` in any committed file (the operator sets this secret or env var at deploy time)
- Adding OTel variables to `.env.example` (already documented there)

## Affected Services

No service source code changes. All 13 services receive `OTEL_SERVICE_NAME` additions in the DO specs as passive env var recipients:

- `xstockstrat-trading` — receives `OTEL_SERVICE_NAME` in `.do/app.dev.yaml` and `.do/app.yaml`
- `xstockstrat-portfolio` — same
- `xstockstrat-marketdata` — same
- `xstockstrat-indicators` — same
- `xstockstrat-ingest` — same
- `xstockstrat-analysis` — same
- `xstockstrat-ledger` — same
- `xstockstrat-identity` — same
- `xstockstrat-notify` — same
- `xstockstrat-config` — same
- `xstockstrat-trader` — same
- `xstockstrat-insights` — same
- `xstockstrat-config-ui` — same

Infrastructure files changed (not services):

- `docker-compose.yml` — fix `OTEL_RESOURCE_ATTRIBUTES` value in `x-common-env` anchor
- `.do/app.dev.yaml` — add global OTel vars + per-service `OTEL_SERVICE_NAME` for all 13 services
- `.do/app.yaml` — same as above for production
- `packages/otel/otel-collector-config.yaml` — remove `environment` upsert from resource processor
- `docs/patterns/observability.md` — update env var table to show variable reference pattern

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/fix-grafana-otel-variables` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking config-only change — docs + infra spec edits)

## Acceptance Criteria

1. `docker-compose.yml` `x-common-env.OTEL_RESOURCE_ATTRIBUTES` equals `environment=${APPLICATION_ENV},trading_mode=${TRADING_MODE},platform=xstockstrat,service.name=${OTEL_SERVICE_NAME}` (resolves per-container, e.g. `environment=development,trading_mode=paper,platform=xstockstrat,service.name=xstockstrat-trading` for the trading service).
2. `packages/otel/otel-collector-config.yaml` resource processor no longer has an `environment` key upsert.
3. All 13 services in `.do/app.dev.yaml` have `OTEL_SERVICE_NAME` set to their canonical `xstockstrat-<name>` value.
4. `.do/app.dev.yaml` global `envs` block contains `OTEL_EXPORTER_OTLP_ENDPOINT`, a single `OTEL_EXPORTER_OTLP_HEADERS` SECRET, and `OTEL_RESOURCE_ATTRIBUTES: environment=${APPLICATION_ENV},trading_mode=${TRADING_MODE},platform=xstockstrat` (no `service.name` — handled by per-service `OTEL_SERVICE_NAME` via SDK).
5. All 13 services in `.do/app.yaml` have `OTEL_SERVICE_NAME` set to their canonical `xstockstrat-<name>` value.
6. `.do/app.yaml` global `envs` block contains `OTEL_EXPORTER_OTLP_ENDPOINT`, a single `OTEL_EXPORTER_OTLP_HEADERS` SECRET, and `OTEL_RESOURCE_ATTRIBUTES: environment=${APPLICATION_ENV},trading_mode=${TRADING_MODE},platform=xstockstrat`.
7. `docs/patterns/observability.md` documents the split: Docker Compose `OTEL_RESOURCE_ATTRIBUTES` includes `service.name=${OTEL_SERVICE_NAME}`; DO global `OTEL_RESOURCE_ATTRIBUTES` does not.
8. Setting `OTEL_ENABLED=true` plus `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` secrets on the DO dev app causes all services to export OTLP without further spec edits.
