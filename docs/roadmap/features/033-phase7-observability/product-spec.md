# Product Spec: phase7-observability

**Created**: 2026-05-26
**Last Updated**: 2026-05-30

---

## Problem Statement

Phase 7 (OTel + Grafana Cloud) is still marked **Pending** in the implementation roadmap
(`docs/roadmap/implementation-roadmap.md`, root CLAUDE.md §Implementation Roadmap Status). Every
service already ships an OTel telemetry module (`internal/telemetry/` in Go, `app/telemetry.py`
in Python, `src/telemetry.ts` in Node.js) gated behind the `OTEL_ENABLED` toggle, and an OTel
Collector config exists at `packages/otel/otel-collector-config.yaml`. But the OTLP exporter
endpoint and credentials are not wired into the DO app specs for the service workloads, there is
no `packages/otel/dashboards/` directory, and no Grafana dashboards or alert rules exist.

In production with live capital, a silent service degradation (analysis hanging, ingest
timing out, the config `WatchConfig` stream dropping) produces no signal and stays invisible
until a trade is missed or a position goes unmanaged. This feature activates the existing
telemetry stubs end-to-end and delivers operational dashboards and alerts before live capital
is at risk.

## User Story

As a platform operator, I want service health, latency, error-rate, and signal-pipeline
throughput dashboards in Grafana Cloud, with alerts that page me, so that I am notified
immediately if any service degrades while live capital is at risk.

## Functional Requirements

FR-1. `OTEL_ENABLED=true` and `OTEL_EXPORTER_OTLP_ENDPOINT` (plus any required auth headers)
must be set for all service workloads in both `.do/app.dev.yaml` and `.do/app.yaml`. (Today only
the collector component references OTEL vars; the per-service workloads do not.)

FR-2. The OTel Collector (`packages/otel/otel-collector-config.yaml`) must export metrics and
logs to the Grafana Cloud OTLP endpoint with the correct authentication, sourcing credentials
from environment/secrets rather than hardcoded values.

FR-3. Grafana dashboards must be created and checked into `packages/otel/dashboards/`:
   - **Service Health** — request rate, error rate, P99 latency per service (one row per service)
   - **Signal Pipeline Throughput** — signals ingested per hour, analysis scoring latency, agent
     scheduler run duration and success rate
   - **Trading Service** — order submission rate, fill latency, open position count, bracket
     order success rate
   - **Infrastructure** — TimescaleDB connection pool utilization, gRPC connection error rates

FR-4. Grafana alert rules must be defined for: any service error rate > 1% for 5 minutes; any
service P99 latency > 2s for 3 minutes; analysis service producing no scoring events for
> 30 minutes during market hours.

FR-5. OTel init errors in any service must never prevent service startup (existing platform
invariant — verify every stub complies during impl-spec discovery).

FR-6. `docs/setup/grafana-cloud.md` must be updated to reflect the final, reproducible
configuration steps.

## Out of Scope

- Distributed trace **visualization** (Tempo/Jaeger). V1 collects traces but ships metrics +
  logs dashboards only.
- Custom business metrics beyond the four dashboards above (V2 extension).
- On-call rotation / PagerDuty wiring. V1 routes Grafana alerts to email/Slack; Slack fanout is
  covered by feature 020 (`notify-external-fanout`).

## Affected Services

All 14 deployable services receive the env-var configuration change only
(`OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`):
`xstockstrat-{trading,portfolio,marketdata,indicators,ingest,analysis,ledger,identity,notify,config,trader,insights,config-ui,nginx}`.

Code changes are expected **only if** a service's OTel stub is found incomplete during
implementation-spec discovery.

**Build artifact (not a registered service):** `packages/otel/` — collector config and the new
`dashboards/` directory.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config service keys — OTLP endpoint and credentials are infrastructure secrets set
  in the DO app spec / environment, not `xstockstrat-config` keys.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/phase7-observability` (branch from `main-dev`).
Approval gates required (per `docs/runbooks/feature-workflow.md`):
- [x] 1 service owner approval (cross-service config + DO app-spec changes)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

1. With `OTEL_ENABLED=true`, every service emits metrics and logs to the OTel Collector with no
   startup errors.
2. The Service Health dashboard displays request rate, error rate, and P99 latency for all 14
   services, populated with real data from the dev environment.
3. The Signal Pipeline Throughput dashboard shows signal-ingestion count updating within 60
   seconds of a test signal ingestion.
4. A simulated service error (intentional failure response) triggers the error-rate Grafana
   alert within 6 minutes.
5. `OTEL_ENABLED=false` (the default in local docker-compose) produces no telemetry traffic and
   no startup errors.
6. `docs/setup/grafana-cloud.md` contains accurate, complete steps to reproduce the setup from
   scratch.

## Open Questions

_Left open for the `/sdd-review product-spec` gate — do not resolve inline._

- [ ] **Grafana Cloud plan limits.** Does the current Grafana Cloud plan cover metric retention
  and active-series volume for 14 services at expected request rates? Confirm tier and limits
  before impl-spec.
- [ ] **Dashboard provisioning method.** Store dashboard JSON as files in
  `packages/otel/dashboards/` and provision via Grafana's provisioning API/Terraform, or manage
  manually in the Grafana UI? File-based provisioning is the suggested default for
  reproducibility, but the tooling choice is unconfirmed.
- [ ] **Per-service OTEL var injection mechanism.** Should `OTEL_ENABLED` /
  `OTEL_EXPORTER_OTLP_ENDPOINT` be set once at the DO app/global env level and inherited by all
  components, or declared per-component in each service block? Affects how FR-1 is implemented.
- [ ] **Alert routing target for V1.** Email, Grafana OnCall, or Slack via feature 020? Feature
  020's launch status determines whether Slack fanout is available when this ships.
