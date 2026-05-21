# Product Spec: fix-grafana-otel-variables

**Created**: 2026-05-21

---

## Problem Statement

The OpenTelemetry resource attributes (`environment`, `trading_mode`, `platform`, `service.name`) are inconsistent across deployment targets and are set via an external `OTEL_RESOURCE_ATTRIBUTES` env var whose value diverges between Docker Compose (`environment=development`) and the documented expectation (`environment=dev`). The DO app specs are missing the variable entirely. The correct fix is to derive these attributes at runtime inside each service's existing telemetry init code from env vars already present in every environment (`APPLICATION_ENV`, `TRADING_MODE`, `OTEL_SERVICE_NAME`), eliminating the external env var and its associated inconsistencies entirely.

## User Story

As a platform operator, I want OTel resource attributes (`environment`, `trading_mode`, `platform`, `service.name`) to be derived automatically from env vars already present in every deployment target, so that enabling Grafana Cloud telemetry requires only setting `OTEL_ENABLED=true` and the Grafana endpoint/token — no manual attribute string maintenance across config files.

## Functional Requirements

FR-1. Each service's telemetry init module must read `APPLICATION_ENV` and `TRADING_MODE` from the environment at startup and set them as OTel resource attributes (`environment` and `trading_mode` respectively). It must also hardcode `platform=xstockstrat`. The `service.name` attribute is already handled natively by all OTel SDKs via `OTEL_SERVICE_NAME` — no explicit code needed for it. All attribute setting must be a no-op when `OTEL_ENABLED != "true"` (existing guard must be preserved).

FR-2. `OTEL_RESOURCE_ATTRIBUTES` must be removed from the `x-common-env` anchor in `docker-compose.yml`. With telemetry init owning resource attributes, this env var is redundant and would conflict with programmatically-set attributes.

FR-3. All attribute upserts must be removed from the `resource:` processor in `packages/otel/otel-collector-config.yaml`. The collector's upserts were compensating for missing/wrong service-level attributes; with FR-1 in place they would silently override correct values.

FR-4. Every service entry in `.do/app.dev.yaml` must have `OTEL_SERVICE_NAME` set to its canonical `xstockstrat-<name>` value. The global `envs` block must add `OTEL_EXPORTER_OTLP_ENDPOINT` (empty string placeholder) and `OTEL_EXPORTER_OTLP_HEADERS` (`scope: RUN_TIME`, `type: SECRET`). No `OTEL_RESOURCE_ATTRIBUTES` entry — telemetry init derives it in code.

FR-5. Same as FR-4 for `.do/app.yaml` (production).

FR-6. `docs/patterns/observability.md` must be updated: remove `OTEL_RESOURCE_ATTRIBUTES` from the required env vars table; document that `environment`, `trading_mode`, and `platform` are set programmatically from `APPLICATION_ENV`, `TRADING_MODE`, and the hardcoded constant respectively.

FR-7. `docs/setup/grafana-cloud.md` Step 3b and Step 4 must be updated to remove references to manually setting `OTEL_RESOURCE_ATTRIBUTES` and instead describe the runtime derivation approach.

FR-8. The `OTEL_EXPORTER_OTLP_HEADERS` comment in `.env.example` must be updated from "set per service via DO dashboard" to "set as a single global secret via DO dashboard".

## Out of Scope

- Changing `OTEL_ENABLED` from `false` to `true` in any committed file (operator sets this at deploy time)
- Adding new OTel instrumentation (spans, metrics, logs) beyond resource attribute wiring
- Changing the OTel exporter protocol or endpoint structure

## Affected Services

All 13 services have their telemetry init updated (source code change, same pattern per language):

- `xstockstrat-trading` — Go: `internal/telemetry/`
- `xstockstrat-portfolio` — Go: `internal/telemetry/`
- `xstockstrat-marketdata` — Go: `internal/telemetry/`
- `xstockstrat-indicators` — Python: `app/telemetry.py`
- `xstockstrat-ingest` — Python: `app/telemetry.py`
- `xstockstrat-analysis` — Python: `app/telemetry.py`
- `xstockstrat-ledger` — Node.js: `src/telemetry.ts`
- `xstockstrat-identity` — Node.js: `src/telemetry.ts`
- `xstockstrat-notify` — Node.js: `src/telemetry.ts`
- `xstockstrat-config` — Node.js: `src/telemetry.ts`
- `xstockstrat-trader` — Next.js: `src/telemetry.ts`
- `xstockstrat-insights` — Next.js: `src/telemetry.ts`
- `xstockstrat-config-ui` — Next.js: `src/telemetry.ts`

Infrastructure files changed:

- `docker-compose.yml` — remove `OTEL_RESOURCE_ATTRIBUTES` from `x-common-env` anchor
- `.do/app.dev.yaml` — add `OTEL_SERVICE_NAME` per service + `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` globally
- `.do/app.yaml` — same as above for production
- `packages/otel/otel-collector-config.yaml` — remove all attribute upserts from resource processor
- `docs/patterns/observability.md` — update env var table
- `docs/setup/grafana-cloud.md` — update Step 3b and Step 4
- `.env.example` — update OTEL_EXPORTER_OTLP_HEADERS comment

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/fix-grafana-otel-variables` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking — telemetry init changes only, no business logic)

## Acceptance Criteria

1. Each service's telemetry init sets `environment=<APPLICATION_ENV value>`, `trading_mode=<TRADING_MODE value>`, and `platform=xstockstrat` as OTel resource attributes when `OTEL_ENABLED=true`.
2. `docker-compose.yml` `x-common-env` anchor no longer contains `OTEL_RESOURCE_ATTRIBUTES`.
3. `packages/otel/otel-collector-config.yaml` resource processor has an empty `attributes: []` list.
4. All 13 services in `.do/app.dev.yaml` have `OTEL_SERVICE_NAME` set to `xstockstrat-<name>`.
5. `.do/app.dev.yaml` global `envs` contains `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` (SECRET, `scope: RUN_TIME`). No `OTEL_RESOURCE_ATTRIBUTES` entry.
6. All 13 services in `.do/app.yaml` have `OTEL_SERVICE_NAME` set to `xstockstrat-<name>`.
7. `.do/app.yaml` global `envs` contains `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` (SECRET, `scope: RUN_TIME`). No `OTEL_RESOURCE_ATTRIBUTES` entry.
8. `docs/patterns/observability.md` no longer lists `OTEL_RESOURCE_ATTRIBUTES` as a required env var; documents programmatic derivation from `APPLICATION_ENV` and `TRADING_MODE`.
9. Setting `OTEL_ENABLED=true` plus `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` on any deployment target causes all services to export OTLP with correct resource attributes — no manual attribute string required.
