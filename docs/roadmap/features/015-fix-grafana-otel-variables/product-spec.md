# Product Spec: fix-grafana-otel-variables

**Created**: 2026-05-21

---

## Problem Statement

The OpenTelemetry environment variables are inconsistent across the three deployment targets (Docker Compose, DO dev, DO prod), making it impossible to enable Grafana Cloud telemetry on DigitalOcean App Platform without manual per-service edits that are not captured in the app specs. Phase 7 (Observability) is still "Pending" partly because the DO app specs lack the OTel wiring needed to activate it.

## User Story

As a platform operator, I want the OTel environment variables to be consistent and complete across Docker Compose and both DigitalOcean app specs, so that I can enable Grafana Cloud telemetry on any environment by setting `OTEL_ENABLED=true` and the Grafana secret values without editing the spec structure.

## Functional Requirements

FR-1. The `OTEL_RESOURCE_ATTRIBUTES` common-env anchor in `docker-compose.yml` must reference `${APPLICATION_ENV}` and `${TRADING_MODE}` (both already defined in `x-common-env`) and include `platform=xstockstrat`. Docker Compose resolves these at container start, producing `environment=development,trading_mode=paper,platform=xstockstrat` in local dev.

FR-2. The `resource` processor in `packages/otel/otel-collector-config.yaml` must have its `environment: dev` upsert removed. Services now set the correct `environment` value via their own `OTEL_RESOURCE_ATTRIBUTES`; the collector upsert would silently override `development` → `dev`, creating an inconsistency.

FR-3. Every service entry in `.do/app.dev.yaml` must have `OTEL_SERVICE_NAME` set to its canonical service name (e.g. `xstockstrat-trading`).

FR-4. `.do/app.dev.yaml` must declare global-level env vars for `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (as a SECRET), and `OTEL_RESOURCE_ATTRIBUTES` referencing `${APPLICATION_ENV}` and `${TRADING_MODE}` (already defined as global vars in the same spec) plus `platform=xstockstrat`.

FR-5. Every service entry in `.do/app.yaml` must have `OTEL_SERVICE_NAME` set to its canonical service name.

FR-6. `.do/app.yaml` must declare global-level env vars for `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (as a SECRET), and `OTEL_RESOURCE_ATTRIBUTES` referencing `${APPLICATION_ENV}` and `${TRADING_MODE}` plus `platform=xstockstrat`, resolving to `environment=production,trading_mode=live,platform=xstockstrat` in production.

FR-7. The `docs/patterns/observability.md` env var table must be updated to document `OTEL_RESOURCE_ATTRIBUTES` as `environment=${APPLICATION_ENV},trading_mode=${TRADING_MODE},platform=xstockstrat` with a note that it resolves from the existing `APPLICATION_ENV` and `TRADING_MODE` variables.

## Out of Scope

- Implementing the Phase 7 OTel SDK wiring inside any service (telemetry modules already exist; this is only config/spec alignment)
- Changing `OTEL_ENABLED` from `false` to `true` in any committed file (the operator sets this secret or env var at deploy time)
- Adding OTel variables to `.env.example` (already documented there)

## Affected Services

All 13 application services are affected in the DO specs (env var additions), but no service source code changes:

- `.do/app.dev.yaml` — add global OTel vars + per-service `OTEL_SERVICE_NAME` for all 13 services
- `.do/app.yaml` — same as above for production
- `docker-compose.yml` — fix `OTEL_RESOURCE_ATTRIBUTES` value in `x-common-env` anchor
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

1. `docker-compose.yml` `x-common-env.OTEL_RESOURCE_ATTRIBUTES` equals `environment=${APPLICATION_ENV},trading_mode=${TRADING_MODE},platform=xstockstrat` (resolves to `environment=development,trading_mode=paper,platform=xstockstrat` at container start).
2. `packages/otel/otel-collector-config.yaml` resource processor no longer has an `environment` key upsert.
3. All 13 services in `.do/app.dev.yaml` have `OTEL_SERVICE_NAME` set to their canonical `xstockstrat-<name>` value.
4. `.do/app.dev.yaml` global `envs` block contains `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (SECRET), and `OTEL_RESOURCE_ATTRIBUTES` using `${APPLICATION_ENV}` and `${TRADING_MODE}` references plus `platform=xstockstrat`.
5. All 13 services in `.do/app.yaml` have `OTEL_SERVICE_NAME` set to their canonical `xstockstrat-<name>` value.
6. `.do/app.yaml` global `envs` block contains `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (SECRET), and `OTEL_RESOURCE_ATTRIBUTES` using `${APPLICATION_ENV}` and `${TRADING_MODE}` references plus `platform=xstockstrat`.
7. `docs/patterns/observability.md` documents `OTEL_RESOURCE_ATTRIBUTES` as the variable reference form with a note showing resolved values per environment.
8. Setting `OTEL_ENABLED=true` plus `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` secrets on the DO dev app causes all services to export OTLP without further spec edits.

## Open Questions

- [ ] Should `OTEL_EXPORTER_OTLP_HEADERS` be a single global SECRET in the DO spec, or set per-service? (Global is simpler; per-service allows different tokens per service if needed in the future.)
