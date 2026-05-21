# Feature: fix-grafana-otel-variables

**Lifecycle Status**: `in-progress`
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
| 2026-05-21 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec regenerated with 9 steps (Path B: runtime derivation in telemetry init across all 13 services + infra cleanup) |
| 2026-05-21 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 complete — xstockstrat-trading Go telemetry updated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 9 steps, regenerated for Path B (runtime derivation)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Fixes three inconsistencies in the OpenTelemetry environment variable configuration across `docker-compose.yml`, `.do/app.dev.yaml`, and `.do/app.yaml`: corrects the `OTEL_RESOURCE_ATTRIBUTES` value in Docker Compose, and adds the full set of missing OTel service variables (`OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_RESOURCE_ATTRIBUTES`) to both DigitalOcean app specs so Phase 7 observability can be enabled by flipping `OTEL_ENABLED` without further structural edits.

## Reviewers

_(Snapshot finalized by /sdd-spec 2026-05-21. Re-run /sdd-spec if registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service architecture, port assignments, service registry consistency, inter-service dependency graph correctness |
| Service owner (xstockstrat-trading) | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| Service owner (xstockstrat-portfolio) | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| Service owner (xstockstrat-marketdata) | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| Service owner (xstockstrat-indicators) | Formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution |
| Service owner (xstockstrat-ingest) | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| Service owner (xstockstrat-analysis) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| Service owner (xstockstrat-ledger) | Append-only invariant, event ordering, hypertable partition safety |
| Service owner (xstockstrat-identity) | JWT expiry and rotation, API key scoping, secret store integration |
| Service owner (xstockstrat-notify) | Stream delivery guarantees, backpressure handling, alert deduplication |
| Service owner (xstockstrat-config) | Config key naming, environment/trading_mode scoping, WatchConfig stream stability |
| Service owner (xstockstrat-trader) | Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend |
| Service owner (xstockstrat-insights) | Analytics display accuracy, SSE polling resilience, read-only access pattern |
| Service owner (xstockstrat-config-ui) | Config mutation safety, environment scope correctness, no secret values rendered in UI |

## Next Action

`/sdd-execute fix-grafana-otel-variables next` — continue with Step 2 (xstockstrat-portfolio Go telemetry)
