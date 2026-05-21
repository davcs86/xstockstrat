# Observability — OTel Setup

**Stack**: OpenTelemetry SDK (per-language) → OTLP push → Grafana Cloud (Loki + Mimir + Tempo)

- **Local dev**: Services push OTLP to `otel-collector:4317` (Docker Compose). Config: `packages/otel/otel-collector-config.yaml`.
- **Production**: Services push OTLP directly to Grafana Cloud OTLP gateway (no collector needed on DO App Platform).
- **Toggle**: `OTEL_ENABLED=true` env var on each service. Config key `platform.otel.enabled` provides a live switch without restart.
- **Non-fatal**: OTel init errors must never prevent service startup.

## Required env vars (read by OTel SDK automatically)

| Variable | Local Dev | Production |
|---|---|---|
| `OTEL_ENABLED` | `true` | `true` |
| `SERVICE_NAME` | `<name>` | `<name>` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` | Grafana Cloud OTLP URL |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | `Authorization=Basic <token>` |

`environment`, `trading_mode`, and `platform` resource attributes are derived programmatically at startup inside each service's telemetry init module from `APPLICATION_ENV`, `TRADING_MODE`, and the hardcoded constant `xstockstrat` respectively. No `OTEL_RESOURCE_ATTRIBUTES` env var is needed or set.

## Per-language telemetry modules

| Language | Module path | Pattern |
|---|---|---|
| Go | `internal/telemetry/` | OTel SDK init + gRPC instrumentation |
| Python | `app/telemetry.py` | `init_telemetry()` — no-op when `OTEL_ENABLED != "true"` |
| Node.js | `src/telemetry.ts` | Same no-op guard |
| Next.js | `src/telemetry.ts` + `instrumentation.ts` | `initTelemetry()` via Next.js instrumentation hook — no-op when `OTEL_ENABLED != "true"` |

See Phase 7 in `docs/roadmap/implementation-roadmap.md` for per-language implementation patterns. For Grafana Cloud wiring: `docs/setup/grafana-cloud.md`.
