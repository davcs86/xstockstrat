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

- **Trace propagation:** every hop must both extract and inject W3C `traceparent`, or the next service starts a
  new root trace. Go: global `TraceContext` propagator + `telemetry.ClientStatsHandler()` on per-request dials
  (noop MeterProvider, so no `rpc.client.*` series); Python: `GrpcAioInstrumentorServer` + `GrpcAioInstrumentorClient`.
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
  `packages/otel/produced-signals.tsv`; `scripts/check-otel-produced-signals.py` (CI job `OTel produced-signal
  guard`) fails on anything unregistered.

## Required env vars (read by OTel SDK automatically)

| Variable | Local Dev | Production |
|---|---|---|
| `OTEL_ENABLED` | `true` | `true` |
| `SERVICE_NAME` | `<name>` | `<name>` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | Grafana Cloud OTLP URL |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | Stored as `Basic <base64(instanceId:apiKey)>`; the deploy workflow prefixes `Authorization=` (the encoded `Authorization=Basic%20…` form is also accepted) |
| `HOST_PROVIDER` | unset → `unknown` | `digitalocean` (DO app specs); `homelab` (a literal in the homelab compose, so no `.env` line can change it) |

`service.name`, `deployment.environment`, and `platform` resource attributes are set programmatically at startup inside each service's telemetry init module from `SERVICE_NAME`, `APPLICATION_ENV`, and the hardcoded constant `xstockstrat` respectively (`trading_mode` was removed by feature 171). `host.provider` comes from `HOST_PROVIDER` (`digitalocean` | `homelab` | `unknown`, exact lowercase); an unset or unrecognised value resolves to `unknown` and never blocks startup. Go, Node, UI and Python all set `service.instance.id` to `<host.provider>-<service.name>` in code (for example `homelab-analysis`), which relies on one replica per service per stack. Do not set `OTEL_RESOURCE_ATTRIBUTES`: several runtimes merge it into the resource and may override `host.provider` (precedence unverified per SDK); CI rejects it in every deploy spec.

## Separating DO and homelab (host.provider)

DO dev and homelab staging both report `deployment_environment="staging"`, and staging and production share one
Grafana Cloud instance, so every query filters both axes: `deployment_environment` and `host_provider`.

- **What Grafana promotes:** `job`, `instance` and `deployment_environment` are labels on every metric series;
  `host_provider` is a datapoint label on every metric series the workloads export, and also a resource attribute on
  `target_info` (set by the exporter wrapper, feature 337). Metric queries filter `host_provider` directly; the
  `target_info` join below is the fallback. On logs, `deployment_environment` and
  `service_instance_id` are stream labels and `host_provider` is structured metadata, so `host_provider` is a
  pipeline filter (`| host_provider="homelab"`), not a stream selector.
- **Why `group by` before the join:** each restart writes a new `target_info` row for the same
  `(job, instance)`, and a many-to-many join fails. `group by` collapses them to one row per key.
- **Why the join's left operand is `sum without (host_provider)`:** for about 5 minutes after each stack's first
  labelled deploy, old unlabelled and new labelled series share one `instance`, and `group_left` would otherwise
  produce duplicate result label sets.
- **Why `deployment_environment` is a join key:** homelab staging and homelab production both run
  `instance=homelab-<service>`, so joining on `(job, instance)` alone would leak production rows into a staging query.

Request rate per service on homelab staging (streams excluded), preferred form:

```promql otel-guard:host-provider-label
sum by (service_name, host_provider) (rate(rpc_server_duration_milliseconds_count{deployment_environment="staging", host_provider="homelab", rpc_method!~"ExportEvents|StreamAlerts|StreamBars|StreamEvents|StreamOrderUpdates|StreamPortfolioUpdates|StreamQuotes|WatchConfig"}[5m]))
```

Fallback through `target_info`, for series that predate the label:

```promql otel-guard:host-provider
sum by (service_name, host_provider) (
  sum without (host_provider) (rate(rpc_server_duration_milliseconds_count{deployment_environment="staging", rpc_method!~"ExportEvents|StreamAlerts|StreamBars|StreamEvents|StreamOrderUpdates|StreamPortfolioUpdates|StreamQuotes|WatchConfig"}[5m]))
  * on (job, instance, deployment_environment) group_left (host_provider)
    group by (job, instance, deployment_environment, host_provider) (
      target_info{deployment_environment="staging", host_provider="homelab"}
    )
)
```

Analysis logs from homelab staging:

```logql otel-guard:host-provider
{service_name="analysis"} | deployment_environment="staging" | host_provider="homelab"
```

For DO dev, use `host_provider="digitalocean"`. For homelab production, use `deployment_environment="production"`
on both selectors (the `rpc_server_duration_milliseconds_count` selector and the `target_info` selector).

Every Loki stream also carries `service_instance_id`, which is `<host.provider>-<service.name>` for every runtime, so
`{service_instance_id=~"homelab-.+"}` selects the homelab streams of all 12 services. Homelab staging and homelab
production share the `homelab-` prefix, so add `deployment_environment="staging"` (or `"production"`);
`| host_provider="homelab"` remains the documented log filter.

**Post-deploy check (manual):**

- `count(group by (job) (target_info{deployment_environment="staging", host_provider="homelab"}))`
  returns at least 11 jobs on an idle stack and 12 after one UI login.
- `count(group by (job) (target_info{deployment_environment="staging", instance=~"homelab-.+"}))`
  returns at least 11 jobs on an idle stack and 12 after one UI login.
- Each PromQL block above returns at least 1 series after one RPC.
- `instance` is `homelab-<job>` for all 12 jobs.
- Empty `target_info` 5 minutes after a healthy deploy means telemetry egress is blocked. Services still pass
  their healthchecks, so the VM does not roll back.

**Homelab egress precondition:** the VM needs outbound HTTPS to the OTLP gateway host, with no TLS-intercepting
proxy in the path.

**Open risks:**

- DO rolling deploys briefly run two processes that push identical `(job, instance, deployment_environment)`
  series, now including the Python services, whose id no longer changes per process; replicas of one service would
  also share one `service.instance.id`. Homelab `compose up` stops before it starts.
- Homelab staging and DO dev share the staging OTLP token, so rotating or revoking it hits both stacks.
- The first deploy of the `host_provider` datapoint label forks each series once (the old unlabelled series go stale after about 5 minutes) on DO dev, homelab staging and homelab production.
- Series budget: three exporting stacks at roughly 1,200 series each come to about 3,600 active series.
- The first deploy with a fixed instance id relabels each runtime's series once: Go, Node and UI on DO dev (the old instance-less series go stale), Python on DO dev and homelab (the old per-process UUID series go stale).
- Alerts are not provider-scoped yet: homelab errors page the same alerts as DO dev, and a live homelab analysis
  loop can mask a dead DO dev loop. The follow-up feature `otel-env-provider-scoped-alerts` scopes them.

## Service `CLAUDE.md` Observability sections (feature 294 conventions)

Each service's `CLAUDE.md` § Observability lists only its own loops, instruments and load-bearing logs; these conventions apply to all of them:

- Any fixed value below (N, caps, truncation lengths) is a code constant, not a config key. Label values are closed sets; the service's telemetry allowlist test fails on any identifier or secret label.
- The throttles, N, windows and caps below are code constants, not config keys; loop cadences are defaults, and several are config keys (see Config Keys Consumed).
- INFO `loop tick ok` carries `loop`, `duration_ms` and optional `state` (no `state` = work was done); a tick writes no record when every item that reached its fallible call failed.

## Per-language telemetry modules

| Language | Module path | Pattern |
|---|---|---|
| Go | `internal/telemetry/` | `otel.go` (providers + `rpc.server.duration` view), `logbridge.go` (`slog` → OTLP), `shutdown.go` (`StopServer`: flush, then bounded stop) |
| Python | `app/telemetry.py` | `init_telemetry()` — no-op when `OTEL_ENABLED != "true"`; span-derived `rpc.server.duration` recorder, cancel/deadline interceptor, `logging` handler (agent: `app/tool_metrics.py` for `mcp.tool.duration`) |
| Node.js | `src/telemetry.ts`, `src/services/logger.ts` | Same no-op guard; `RpcDurationProcessor`, awaited `shutdownTelemetry()`, `winston` → OTLP transport |
| Next.js | `src/telemetry.ts` + `src/instrumentation.ts`, `src/lib/bffMetrics.ts`, `src/lib/serverLog.ts` | `initTelemetry()` via the Next.js instrumentation hook, which must live in `src/` (a `src/` project ignores a root-level hook) — no-op when `OTEL_ENABLED != "true"`; `http.server.duration` and log bridge |

The modules above are the current per-language patterns; Phase 7 of `docs/roadmap/implementation-roadmap.md` is historical (its gRPC `:4317` / `--otlp-insecure` setup predates the OTLP/HTTP `:4318` contract). For Grafana Cloud wiring: `docs/setup/grafana-cloud.md`.
