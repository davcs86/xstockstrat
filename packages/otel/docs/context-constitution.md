# packages/otel — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24; refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — line hints re-stamped; OTEL-2 evidence-weakened note: no service exports metrics). Captures the **non-obvious**
invariants of the OTel package (Collector config + checked-in Grafana provisioning; local-dev only —
production pushes OTLP straight to Grafana Cloud). Does not restate documented/CI-enforced rules
(see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **packages/otel** (chiefly the alert/dashboard metric contracts; the env-only
> OTLP/HTTP export rule lives in the root as PLAT-3).

## Rules (`OTEL-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **OTEL-1** | **Alerts and dashboards address a service by its **short** `service.name` (`analysis`), NOT the container name (`xstockstrat-analysis`).** | Grafana promotes the OTel `service.name` resource attr to the `service_name` label; an alert filtering on the container name silently never fires. | `alerts/alert-rules.yaml#{service_name="analysis"} (~L134)`; `dashboards/README.md#Grafana Cloud promotes (~L42)` | `packages/otel/alerts/alert-rules.yaml#{service_name="analysis"} (~L134)` |
| **OTEL-2** | **Alerts/dashboards hard-code the OTLP→Prometheus histogram `rpc_server_duration_milliseconds` and label `rpc_grpc_status_code="0"` (=OK).** A service emitting a differently-named histogram (or Grafana mapping it `_ms`) makes the alerts silently never fire. | The metric name is the cross-cutting contract between each service's gRPC instrumentation and the provisioned alerts. | `alerts/alert-rules.yaml#rpc_server_duration_milliseconds_count (~L44-45)`, `#rpc_server_duration_milliseconds_bucket (~L88)`; all 4 dashboards. > ⚠ evidence weakened as of 2026-10-19: no service creates a MeterProvider/OTLP metric exporter (`rg 'MeterProvider\|OTLPMetricExporter\|otlpmetric\|PeriodicExportingMetricReader' services/` empty; `services/xstockstrat-ui/src/telemetry.ts#metricReaders: [] (~L31)`), so the histogram these alerts depend on may never be produced — see findings. | `packages/otel/alerts/alert-rules.yaml#rpc_server_duration_milliseconds_count (~L44-45)` |

## Gotchas & scars

- **Every service exports OTLP/HTTP to `:4318`, configured only by the spec env vars** — **root PLAT-3**; the `:4317` gRPC receiver serves other OTLP clients only. See the root constitution; not restated here (CF-N3).

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Grafana Cloud OTLP exporter (single endpoint, gzip, retry) via `${env:…}` | `otel-collector-config.yaml#otlphttp/grafana (~L48-62)` |
| Prod has no collector; services push OTLP direct to Grafana Cloud | `otel-collector-config.yaml#no collector deployment is needed there (~L17-18)` |
| Alert/dashboard purpose, UIDs, substitution steps; market-hours mute timing | `alerts/README.md`, `dashboards/README.md`, `alerts/mute-timings.yaml` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
