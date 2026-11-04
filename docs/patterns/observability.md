# Observability — OTel Setup

**Stack**: OpenTelemetry SDK (per-language) → OTLP/HTTP push (traces, metrics, logs) → Grafana Cloud (Tempo, Mimir, Loki)

- **Local dev**: Every service exports traces, metrics and logs over OTLP/HTTP to `http://otel-collector:4318` (Docker Compose). Config: `packages/otel/otel-collector-config.yaml`.
- **Production**: Services push OTLP directly to Grafana Cloud OTLP gateway (no collector needed on DO App Platform).
- **Toggle**: `OTEL_ENABLED=true` env var on each service, read once at init — changing it needs a restart. There is no live switch: `platform.otel.enabled` is not a config key and no code reads it.
- **Non-fatal**: OTel init errors must never prevent service startup.
- **Env-only exporters**: every runtime constructs its OTLP/HTTP trace, metric and log exporters with **no** endpoint/url/insecure argument, so the SDK appends `/v1/traces`, `/v1/metrics` and `/v1/logs` to `OTEL_EXPORTER_OTLP_ENDPOINT`, derives TLS from the scheme, and reads `OTEL_EXPORTER_OTLP_HEADERS` itself. Export failures are logged (Go/Python logging; Node/Next via a WARN `diag` logger).

## Exported signals

Every runtime exports three signals over OTLP/HTTP, all configured only by the OTel spec env vars (no
endpoint, url, header or TLS argument is passed to any exporter): traces to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
metrics to `/v1/metrics`, logs to `/v1/logs`. Each runtime's `OTEL_ENABLED` gate covers all three.

| Signal | Series / stream (as proven on the dev deploy, feature 274 G1) | Producers |
|---|---|---|
| Metric | `rpc_server_duration_milliseconds_{count,bucket,sum}` with `service_name`, `rpc_service`, `rpc_method`, `rpc_grpc_status_code` | 10 gRPC services (Go: otelgrpc server stats; Python and Node: derived from the gRPC server span) |
| Metric | `mcp_tool_duration_milliseconds_{count,bucket,sum}` with `gen_ai_tool_name`, `outcome` | `xstockstrat-agent` (it is a gRPC client, so it records MCP tool calls instead) |
| Metric | `http_server_duration_milliseconds_{count,bucket,sum}` with `xstk_segment`, `http_response_status_code`, and `rpc_service` (Connect) or `http_route` (REST) | `xstockstrat-ui` BFF (unary Connect calls and the wrapped REST routes) |
| Logs | Loki stream `{service_name="<short name>"}`, e.g. `{service_name="analysis"}`; `platform`, `trace_id`, `span_id`, `severity_text`, `detected_level` are structured metadata, not stream labels | all 12 runtimes (Go `slog`, Python `logging`, Node `winston`, UI `serverLog`) |

`service_name` is the short name (`trading`, `analysis`, `ui`, …), set from `SERVICE_NAME`. Python writes
`severity_text` upper-case (`INFO`) and Node lower-case (`info`); `detected_level` is lower-case for both, so
filter on it (`| detected_level="error"`).

- **Stream exclusion:** server-streaming RPCs (`WatchConfig`, `Stream*`, `ExportEvents`) end on every deploy, so
  alert and dashboard queries exclude them with `rpc_method!~"…"`; the list is derived from `packages/proto`.
- **Optional SDK env vars:** `OTEL_METRIC_EXPORT_INTERVAL` (default 60 s) and `OTEL_BLRP_SCHEDULE_DELAY`
  (default 5 s) are honoured by every runtime; they matter for tests, not for production.
- **Failure behaviour:** SDK and exporter failures stay on stdout (the OTel diag logger and the `opentelemetry*`
  Python loggers are never bridged to the log exporter), so a failing export cannot recurse into itself.
- **Flush on shutdown:** Go, Python and Node flush on SIGTERM (`StopServer`, interpreter `atexit`,
  `shutdownTelemetry()`); the UI's flush is best-effort because Next.js owns the process lifecycle. Go's
  `os.Exit(1)` paths and Node's cancelled streams can lose the last points.
- **Cost (dev, 2026-10-31):** about 1,200 active series across the three duration families (marketdata 270,
  ui 198, identity 126, analysis 126, agent 90, ingest 90, portfolio 90, indicators 72, trading 54, ledger 36,
  config 36, notify 18). Loki bytes per day has not been measured yet.
- **Idle processes:** on dev, a process that recorded nothing for a few minutes (an idle agent or UI) dropped out of an instant query
  while its history was still queryable with `last_over_time(…[6h])`; write alerts and panels on `rate()` and treat a missing
  series as "no traffic", not as an outage.
- **Registry:** every series and log literal an alert or dashboard queries is listed in
  `packages/otel/produced-signals.tsv`; `scripts/check-otel-produced-signals.sh` (CI job `OTel produced-signal
  guard`) fails on anything unregistered.

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
| Go | `internal/telemetry/` | `otel.go` (providers + `rpc.server.duration` view), `logbridge.go` (`slog` → OTLP), `shutdown.go` (`StopServer`: flush, then bounded stop) |
| Python | `app/telemetry.py` | `init_telemetry()` — no-op when `OTEL_ENABLED != "true"`; span-derived `rpc.server.duration` recorder, cancel/deadline interceptor, `logging` handler (agent: `app/tool_metrics.py` for `mcp.tool.duration`) |
| Node.js | `src/telemetry.ts`, `src/services/logger.ts` | Same no-op guard; `RpcDurationProcessor`, awaited `shutdownTelemetry()`, `winston` → OTLP transport |
| Next.js | `src/telemetry.ts` + `src/instrumentation.ts`, `src/lib/bffMetrics.ts`, `src/lib/serverLog.ts` | `initTelemetry()` via the Next.js instrumentation hook, which must live in `src/` (a `src/` project ignores a root-level hook) — no-op when `OTEL_ENABLED != "true"`; `http.server.duration` and log bridge |

See Phase 7 in `docs/roadmap/implementation-roadmap.md` for per-language implementation patterns. For Grafana Cloud wiring: `docs/setup/grafana-cloud.md`.
