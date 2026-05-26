# Product Spec: phase7-observability

**Created**: 2026-05-26

---

## Problem Statement

Phase 7 (OTel + Grafana Cloud) is marked Pending in the implementation roadmap. Every service already has an OTel telemetry module stubbed (`internal/telemetry/` in Go, `app/telemetry.py` in Python, `src/telemetry.ts` in Node.js) and the `OTEL_ENABLED` toggle exists — but the OTLP exporter endpoint is not configured in the DO app specs and no Grafana dashboards exist. In production with live capital, a silent service degradation (analysis service hanging, ingest webhook timing out, config stream dropping) produces no alert and is invisible until a trade is missed or a position goes unmanaged.

## User Story

As a platform operator, I want service health, latency, and error rate dashboards in Grafana Cloud so that I am paged immediately if any service degrades while live capital is at risk.

## Functional Requirements

FR-1. `OTEL_ENABLED=true` and `OTEL_EXPORTER_OTLP_ENDPOINT` must be set in both `.do/app.dev.yaml` and `.do/app.yaml` for all 14 services.
FR-2. The OTel Collector (`packages/otel/otel-collector-config.yaml`) must be configured to export to Grafana Cloud OTLP endpoint with the correct authentication headers.
FR-3. The following Grafana dashboards must be created and checked into `packages/otel/dashboards/`:
   - **Service Health**: request rate, error rate, P99 latency per service (one row per service)
   - **Signal Pipeline Throughput**: signals ingested per hour, analysis scoring latency, agent scheduler run duration and success rate
   - **Trading Service**: order submission rate, fill latency, open position count, bracket order success rate
   - **Infrastructure**: TimescaleDB connection pool utilization, gRPC connection error rates
FR-4. Grafana alerting rules must be defined for: any service error rate > 1% for 5 minutes, any service P99 latency > 2s for 3 minutes, analysis service producing no scoring events for > 30 minutes during market hours.
FR-5. OTel init errors in any service must not prevent service startup (existing invariant — verify all stubs comply).
FR-6. The `docs/setup/grafana-cloud.md` runbook must be updated to reflect the final configuration steps.

## Out of Scope

- Distributed trace visualization (traces collected but no Tempo/Jaeger setup in V1 — metrics and logs only)
- Custom business metrics beyond the dashboards listed above (V2 extension)
- On-call rotation or PagerDuty wiring (Grafana alerts → email/Slack is sufficient in V1; Slack fanout via feature 020)

## Affected Services

All 14 services (configuration change only — `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT` env vars):
- `xstockstrat-{trading,portfolio,marketdata,indicators,ingest,analysis,ledger,identity,notify,config,trader,insights,config-ui,nginx}`

Code changes only if any service's OTel stub is found incomplete at impl-spec time.

## Proto Contract Changes

- [ ] No proto changes required

## Config Key Changes

- [ ] No new config service keys (OTel credentials are environment variables, not config service keys — they are infrastructure secrets set in DO app spec)

## Database Changes

- [ ] No schema changes

## Feature Workflow Notes

Branch to create: `feature/phase7-observability` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (cross-service config + DO app spec changes)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. With `OTEL_ENABLED=true`, every service emits traces and metrics to the OTel Collector without startup errors.
2. The Grafana Service Health dashboard displays request rate, error rate, and P99 latency for all 14 services populated with real data from the dev environment.
3. The Signal Pipeline Throughput dashboard shows signal ingestion count updating within 60 seconds of a test signal ingestion.
4. A simulated service error (intentional 500 response) triggers the error-rate Grafana alert within 6 minutes.
5. `OTEL_ENABLED=false` (default in local docker-compose) produces no telemetry traffic and no startup errors.
6. `docs/setup/grafana-cloud.md` contains accurate, complete steps to reproduce the setup from scratch.

## Open Questions

- [ ] Grafana Cloud free tier has metric retention limits — confirm the current plan covers 14 services at expected request volumes. Verify at impl-spec time.
- [ ] Should dashboard JSON be stored as files in the repo and provisioned via Grafana's provisioning API, or managed manually in the Grafana UI? File-based provisioning (in `packages/otel/dashboards/`) is preferred for reproducibility. Confirm tooling at impl-spec.
