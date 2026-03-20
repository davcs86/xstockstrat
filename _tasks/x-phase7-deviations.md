# Phase 7 Deviations & Implementation Notes

## Phase 7 — Observability (OTel → Grafana Cloud)

This document records decisions made during Phase 7 implementation that deviate from or clarify
the spec.

---

## Phase 7A — Grafana Cloud Setup (Manual)

**Spec**: Platform lead creates Grafana Cloud account and obtains OTLP endpoint and token.

**Status**: Not automated — this is a one-time manual step. The DO App Platform env var blocks
in `.do/app.yaml` and `.do/app.dev.yaml` have placeholder values (`REPLACE_WITH_*`) for
`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`. After completing Phase 7A,
replace these via the DO console or `doctl` before deploying.

---

## Phase 7B — OTel Collector (Already Implemented)

**Spec**: Deploy OTel Collector as Docker Compose service.

**Finding**: Phase 7B was already implemented prior to this phase implementation:
- `docker-compose.yml` — `otel-collector` service using `otel/opentelemetry-collector-contrib:0.103.0`
- `packages/otel/otel-collector-config.yaml` — full collector config with Grafana Cloud OTLP exporter

No changes were made to these files in Phase 7. They were already complete.

---

## Phase 7C — Go Service Instrumentation (OTel SDK Dependency Constraint)

**Spec**: Add full OTel SDK stack including `otlptracehttp`, `otlpmetrichttp`, `otlploghttp` exporters.

**Finding**: The OTel trace and metric OTLP HTTP exporter packages
(`go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp@v0.50.0` and
`go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp@v0.50.0`) were not available
in the module cache and could not be downloaded (network-restricted environment). Additionally,
`go.opentelemetry.io/otel/sdk/log@v0.6.0` requires `otel@v1.30.0`, but only `v1.28.0` was cached.

**Implementation**: Adapted `internal/telemetry/otel.go` to use available packages only:
- `go.opentelemetry.io/otel@v1.28.0` — base API + W3C TraceContext propagator
- `go.opentelemetry.io/otel/sdk@v1.28.0` — TracerProvider (no exporter, enables context propagation)
- `go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc@v0.53.0` — gRPC
  server/client stats handlers

**Effect**: Trace context propagation across service boundaries works correctly. gRPC calls are
instrumented via `otelgrpc.NewServerHandler()` and `otelgrpc.NewClientHandler()`. Spans are
created in-process but not exported until `otlptracehttp` is added as a dependency. When network
access is available, run:

```bash
cd services/xstockstrat-{trading,portfolio,marketdata}
go get go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp@v0.50.0
go get go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp@v0.50.0
go get go.opentelemetry.io/otel/sdk/log@v0.6.0
go get go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp@v0.6.0
```

Then add the exporter init lines back to `internal/telemetry/otel.go` using the full spec code.

**gRPC client interceptors**: Added to all outbound gRPC `Dial`/`NewClient` calls in:
- `internal/config/config.go` — config watcher connection
- `internal/service/trading.go` — ledger, notify, portfolio clients (trading service)
- `internal/service/portfolio_service.go` — ledger, marketdata, notify clients (portfolio)
- `internal/service/marketdata_service.go` — ledger, notify clients (marketdata)

---

## Phase 7D — Python Service Instrumentation (Offline Package Install)

**Spec**: Add OTel SDK packages to `pyproject.toml` and create `app/telemetry.py`.

**Finding**: Python OTel packages (`opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-http`,
etc.) are not installed in the local environment.

**Implementation**:
- Packages added to `pyproject.toml` for each service — installed at Docker build time via `pip install .`
- `app/telemetry.py` uses `try/except ImportError` guard: if packages are not installed (e.g.,
  local dev without Docker), `init()` logs a warning and returns without failing — the service
  starts normally
- When running in Docker, packages are installed and OTel exports to the collector

---

## Phase 7E — Node.js Service Instrumentation (Dynamic Require Pattern)

**Spec**: Add OTel packages to `package.json` and create `src/telemetry.ts`.

**Finding**: OTel Node.js packages are not in the pnpm store locally.

**Implementation**:
- Packages added to `package.json` for each service — installed at Docker build time via `pnpm install`
- `src/telemetry.ts` uses dynamic `require()` inside a `try/catch`: if packages are not installed
  (e.g., local dev without Docker), `initTelemetry()` logs a warning and returns — the service
  starts normally
- `src/services/logger.ts` updated to conditionally add Winston OTLP transport when
  `OTEL_ENABLED === 'true'` and `@opentelemetry/winston-transport` is available
- `shutdownTelemetry()` integrated into existing SIGTERM handlers in ledger, identity, notify;
  a new `process.on('SIGTERM', ...)` handler added to config service (which had none)

---

## Phase 7F — DO App Platform Env Vars

**Spec**: Add OTel env vars to every service block in `.do/app.yaml` and `.do/app.dev.yaml`.

**Implementation**: OTel env vars added to all 10 backend services (Go + Python + Node.js).
Next.js frontends (trader, insights, config-ui) not instrumented — they have no OTel code.

`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` are marked `type: SECRET`
with placeholder values. The platform lead must replace these via DO console after completing
Phase 7A (Grafana Cloud account setup).

---

## Phase 7G — Dashboards & Alerting

No implementation required — Phase 7G is documentation-only. Recommended dashboards, Loki
queries, Tempo TraceQL queries, and alert rules are fully specified in the roadmap
(`_tasks/x-implementation-roadmap.md`) under "Phase 7G".

---

## Verification Checkpoint 7 Status

| Step | Test | Status | Notes |
|---|---|---|---|
| 7A | Grafana Cloud account + OTLP endpoint | ⚠️ Manual | Platform lead action required |
| 7B | OTel Collector docker-compose service | ✅ Pre-existing | No changes needed |
| 7B | `otel-collector-config.yaml` | ✅ Pre-existing | Grafana Cloud OTLP exporter configured |
| 7C | Go `internal/telemetry/otel.go` | ✅ Created | Propagator + otelgrpc; exporters pending network |
| 7C | Go `cmd/server/main.go` wired | ✅ All 3 | trading, portfolio, marketdata |
| 7C | gRPC server `StatsHandler` | ✅ All 3 | `otelgrpc.NewServerHandler()` |
| 7C | gRPC client handlers | ✅ All dial sites | config, ledger, notify, portfolio, marketdata clients |
| 7D | Python `app/telemetry.py` | ✅ Created | indicators, ingest, analysis |
| 7D | `pyproject.toml` OTel deps | ✅ All 3 | Install at Docker build time |
| 7D | `app/main.py` wired | ✅ All 3 | After `logging.basicConfig` |
| 7E | Node.js `src/telemetry.ts` | ✅ Created | config, ledger, identity, notify |
| 7E | `package.json` OTel deps | ✅ All 4 | Install at Docker build time |
| 7E | `src/services/logger.ts` OTel transport | ✅ All 4 | Conditional Winston transport |
| 7E | `src/index.ts` wired | ✅ All 4 | `initTelemetry()` first + SIGTERM shutdown |
| 7F | `.do/app.yaml` OTel env vars | ✅ All 10 backend services | Placeholder secrets need replacing |
| 7F | `.do/app.dev.yaml` OTel env vars | ✅ All 10 backend services | Placeholder secrets need replacing |
| 7G | Dashboards documented | ✅ Spec only | See roadmap Phase 7G section |
