# Product Spec: fix-grafana-otel-variables

**Created**: 2026-05-21

---

## Problem Statement

The OpenTelemetry environment variables are inconsistent across the three deployment targets (Docker Compose, DO dev, DO prod), making it impossible to enable Grafana Cloud telemetry on DigitalOcean App Platform without manual per-service edits that are not captured in the app specs. Phase 7 (Observability) is still "Pending" partly because the DO app specs lack the OTel wiring needed to activate it.

## User Story

As a platform operator, I want the OTel environment variables to be consistent and complete across Docker Compose and both DigitalOcean app specs, so that I can enable Grafana Cloud telemetry on any environment by setting `OTEL_ENABLED=true` and the Grafana secret values without editing the spec structure.

## Functional Requirements

FR-1. The `OTEL_RESOURCE_ATTRIBUTES` common-env anchor in `docker-compose.yml` must use `environment=dev` (not `environment=development`) and include `platform=xstockstrat`, matching the value the OTel collector's `resource` processor upserts and the value documented in `docs/setup/grafana-cloud.md`.

FR-2. Every service entry in `.do/app.dev.yaml` must have `OTEL_SERVICE_NAME` set to its canonical service name (e.g. `xstockstrat-trading`).

FR-3. `.do/app.dev.yaml` must declare global-level env vars for `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (as a SECRET), and `OTEL_RESOURCE_ATTRIBUTES: environment=dev,trading_mode=paper,platform=xstockstrat` so they are inherited by all services.

FR-4. Every service entry in `.do/app.yaml` must have `OTEL_SERVICE_NAME` set to its canonical service name.

FR-5. `.do/app.yaml` must declare global-level env vars for `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (as a SECRET), and `OTEL_RESOURCE_ATTRIBUTES: environment=production,trading_mode=live,platform=xstockstrat`.

FR-6. The `docs/patterns/observability.md` env var table must be updated to reflect the corrected `OTEL_RESOURCE_ATTRIBUTES` value for Local Dev (`environment=dev,trading_mode=paper,platform=xstockstrat`).

## Out of Scope

- Implementing the Phase 7 OTel SDK wiring inside any service (telemetry modules already exist; this is only config/spec alignment)
- Changing `OTEL_ENABLED` from `false` to `true` in any committed file (the operator sets this secret or env var at deploy time)
- Modifying the OTel Collector config (`packages/otel/otel-collector-config.yaml`)
- Adding OTel variables to `.env.example` (already documented there)

## Affected Services

All 13 application services are affected in the DO specs (env var additions), but no service source code changes:

- `.do/app.dev.yaml` — add global OTel vars + per-service `OTEL_SERVICE_NAME` for all 13 services
- `.do/app.yaml` — same as above for production
- `docker-compose.yml` — fix `OTEL_RESOURCE_ATTRIBUTES` value in `x-common-env` anchor
- `docs/patterns/observability.md` — update env var table row for Local Dev

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

1. `docker-compose.yml` `x-common-env.OTEL_RESOURCE_ATTRIBUTES` equals `environment=dev,trading_mode=paper,platform=xstockstrat`.
2. All 13 services in `.do/app.dev.yaml` have `OTEL_SERVICE_NAME` set to their canonical `xstockstrat-<name>` value.
3. `.do/app.dev.yaml` global `envs` block contains `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (SECRET), and `OTEL_RESOURCE_ATTRIBUTES: environment=dev,trading_mode=paper,platform=xstockstrat`.
4. All 13 services in `.do/app.yaml` have `OTEL_SERVICE_NAME` set to their canonical `xstockstrat-<name>` value.
5. `.do/app.yaml` global `envs` block contains `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (SECRET), and `OTEL_RESOURCE_ATTRIBUTES: environment=production,trading_mode=live,platform=xstockstrat`.
6. `docs/patterns/observability.md` Local Dev `OTEL_RESOURCE_ATTRIBUTES` row shows `environment=dev,trading_mode=paper,platform=xstockstrat`.
7. Setting `OTEL_ENABLED=true` plus `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` secrets on the DO dev app causes all services to export OTLP without further spec edits.

## Open Questions

- [ ] Should `OTEL_EXPORTER_OTLP_HEADERS` be a single global SECRET in the DO spec, or set per-service? (Global is simpler; per-service allows different tokens per service if needed in the future.)
- [ ] The DO Next.js frontends (trader, insights, config-ui) don't currently have `OTEL_SERVICE_NAME` in docker-compose but use the common-env anchor. Confirm they should also receive `OTEL_SERVICE_NAME` in the DO specs (they do in docker-compose).
