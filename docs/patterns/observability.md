# Observability — OTel Setup

**Stack**: OpenTelemetry SDK (per-language) → OTLP/HTTP push (traces) → Grafana Cloud Tempo

Metrics and logs are not exported (feature 226).

- **Local dev**: Every service exports traces over OTLP/HTTP to `http://otel-collector:4318` (Docker Compose). Config: `packages/otel/otel-collector-config.yaml`.
- **Production**: Services push OTLP directly to Grafana Cloud OTLP gateway (no collector needed on DO App Platform).
- **Toggle**: `OTEL_ENABLED=true` env var on each service, read once at init — changing it needs a restart. There is no live switch: `platform.otel.enabled` is not a config key and no code reads it.
- **Non-fatal**: OTel init errors must never prevent service startup.
- **Env-only exporters**: every runtime constructs its OTLP/HTTP trace exporter with **no** endpoint/url/insecure argument, so the SDK appends `/v1/traces` to `OTEL_EXPORTER_OTLP_ENDPOINT`, derives TLS from the scheme, and reads `OTEL_EXPORTER_OTLP_HEADERS` itself. Export failures are logged (Go/Python logging; Node/Next via a WARN `diag` logger).

## Required env vars (read by OTel SDK automatically)

| Variable | Local Dev | Production |
|---|---|---|
| `OTEL_ENABLED` | `true` | `true` |
| `SERVICE_NAME` | `<name>` | `<name>` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | Grafana Cloud OTLP URL |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | Stored as `Basic <base64(instanceId:apiKey)>`; the deploy workflow prefixes `Authorization=` (the encoded `Authorization=Basic%20…` form is also accepted) |

`service.name`, `deployment.environment`, and `platform` resource attributes are set programmatically at startup inside each service's telemetry init module from `SERVICE_NAME`, `APPLICATION_ENV`, and the hardcoded constant `xstockstrat` respectively (`trading_mode` was removed by feature 171). No `OTEL_RESOURCE_ATTRIBUTES` env var is needed or set.

## Per-language telemetry modules

| Language | Module path | Pattern |
|---|---|---|
| Go | `internal/telemetry/` | OTel SDK init + gRPC instrumentation |
| Python | `app/telemetry.py` | `init_telemetry()` — no-op when `OTEL_ENABLED != "true"` |
| Node.js | `src/telemetry.ts` | Same no-op guard |
| Next.js | `src/telemetry.ts` + `src/instrumentation.ts` | `initTelemetry()` via the Next.js instrumentation hook, which must live in `src/` (a `src/` project ignores a root-level hook) — no-op when `OTEL_ENABLED != "true"` |

See Phase 7 in `docs/roadmap/implementation-roadmap.md` for per-language implementation patterns. For Grafana Cloud wiring: `docs/setup/grafana-cloud.md`.
