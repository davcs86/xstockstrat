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
