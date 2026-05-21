# Context: fix-grafana-otel-variables

**Feature**: `docs/roadmap/features/015-fix-grafana-otel-variables/feature.md`
**Product Spec**: `docs/roadmap/features/015-fix-grafana-otel-variables/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/015-fix-grafana-otel-variables/implementation-spec.md`

---

## Session 2026-05-21T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Identified three concrete inconsistencies by diffing docker-compose.yml, .do/app.dev.yaml, .do/app.yaml against docs/setup/grafana-cloud.md and docs/patterns/observability.md:
  1. `docker-compose.yml` x-common-env uses `environment=development` but docs and otel-collector processor use `environment=dev`; `platform=xstockstrat` is also absent from service-level OTEL_RESOURCE_ATTRIBUTES.
  2. Both DO app specs (`app.dev.yaml`, `app.yaml`) have `OTEL_ENABLED: "false"` globally but are entirely missing `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, and `OTEL_RESOURCE_ATTRIBUTES` for all 13 services.
  3. `docs/patterns/observability.md` env var table omits `platform=xstockstrat` from the Local Dev `OTEL_RESOURCE_ATTRIBUTES` row.

**Decision — APPLICATION_ENV as source of truth**: Use `APPLICATION_ENV` (values `development`/`production`) for the OTel `environment` attribute; `TRADING_MODE` drives `trading_mode`. `OTEL_RESOURCE_ATTRIBUTES` references both. Consequence: OTel collector resource processor `environment: dev` upsert must be removed (would override correct `development` → `dev`).

**Decision — OTEL_EXPORTER_OTLP_HEADERS**: Single global SECRET in both DO app specs (not per-service).

**Decision — service.name in OTEL_RESOURCE_ATTRIBUTES**: Add `service.name=${OTEL_SERVICE_NAME}` to `OTEL_RESOURCE_ATTRIBUTES` in docker-compose (Docker Compose resolves per-container at runtime so the per-service `OTEL_SERVICE_NAME` is in scope). In DO app specs, global env vars cannot reference component-level vars, so `service.name` is omitted from the global `OTEL_RESOURCE_ATTRIBUTES`; the OTel SDK promotes `OTEL_SERVICE_NAME` to `service.name` automatically.

## Session 2026-05-21T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: Affected Services section lists infrastructure files rather than service names (advisory — Platform Lead to confirm 13-service count and no source code changes).
- Overlap findings: none — features 003, 008, 013, 014 touch different files entirely.
