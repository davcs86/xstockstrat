# Feature: fix-grafana-otel-variables

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/fix-grafana-otel-variables`
**Created**: 2026-05-21
**Last Updated**: 2026-05-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-21 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning) |
| 2026-05-21 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 4 steps |
| 2026-05-21 | `implementation-ready` → `spec-ready` | scope-revision | Path B adopted: runtime derivation in telemetry init; impl-spec reset for regeneration |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Fixes three inconsistencies in the OpenTelemetry environment variable configuration across `docker-compose.yml`, `.do/app.dev.yaml`, and `.do/app.yaml`: corrects the `OTEL_RESOURCE_ATTRIBUTES` value in Docker Compose, and adds the full set of missing OTel service variables (`OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_RESOURCE_ATTRIBUTES`) to both DigitalOcean app specs so Phase 7 observability can be enabled by flipping `OTEL_ENABLED` without further structural edits.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service architecture, port assignments, service registry consistency, inter-service dependency graph correctness |

## Next Action

`` `/sdd-review fix-grafana-otel-variables impl-spec` — validate implementation spec, then `/sdd-execute fix-grafana-otel-variables` ``
