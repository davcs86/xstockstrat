# packages/otel — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24; refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — line hints re-stamped); refreshed 2026-10-30 (feature 250 teardown — OTEL-1 re-grounded on Tempo, OTEL-2 retired, collector line hints re-stamped). Captures the **non-obvious**
invariants of the OTel package (Collector config + checked-in Grafana provisioning; local-dev only —
production pushes OTLP straight to Grafana Cloud). Does not restate documented/CI-enforced rules
(see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **packages/otel** (chiefly the short-`service.name` addressing rule; the env-only
> OTLP/HTTP export rule lives in the root as PLAT-3).

## Rules (`OTEL-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **OTEL-1** | **Alert and dashboard queries address a service by its **short** `service.name` (`analysis`), NOT the container name (`xstockstrat-analysis`).** The same short name is the metric label and Loki stream: `rpc_server_duration_milliseconds_*{service_name="analysis"}`, `{service_name="analysis"}`. | In TraceQL a container-name filter (`resource.service.name = "xstockstrat-analysis"`) matches no span, and `service_name="xstockstrat-analysis"` matches no series or stream, so the panel is silently empty. | `dashboards/service-health.json#resource.service.name = "analysis"` (panel (c)); `alerts/alert-rules.yaml#xstk-analysis-no-scoring` | `packages/otel/dashboards/service-health.json#resource.service.name = "analysis"` |
| **OTEL-2** | **Alert and dashboard metric names and Loki literals are exactly what the runtimes produce.** `rpc_server_duration_milliseconds_{count,bucket,sum}` (labels `service_name`, `rpc_service`, `rpc_method`, `rpc_grpc_status_code`), `mcp_tool_duration_milliseconds_*`, `http_server_duration_milliseconds_*`, the Loki stream `{service_name="<short name>"}` and the heartbeat line `live_loop: cycle complete` are **produced**; everything an asset queries is registered in `produced-signals.tsv` and enforced by `scripts/check-otel-produced-signals.sh`. Every `rpc_server_duration_*` selector excludes the proto-derived server-streaming methods. (Un-retired by feature 274; retired by feature 250 while nothing was produced.) | A series nothing produces makes an alert read empty and never fire, which is how the original gap went unnoticed. Accepted asymmetries (feature 274 design): an unsampled inbound `traceparent` records no Python/Node RPC point; Node cancelled streams and Go `os.Exit(1)` paths can lose the last points; the UI flush on shutdown is best-effort. | `produced-signals.tsv`; `scripts/check-otel-produced-signals.sh` (Parts 1, 4, 5) | `packages/otel/produced-signals.tsv` |

## Gotchas & scars

- **Every service exports OTLP/HTTP to `:4318`, configured only by the spec env vars** — **root PLAT-3**; the `:4317` gRPC receiver serves other OTLP clients only. See the root constitution; not restated here (CF-N3).

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Grafana Cloud OTLP exporter (single endpoint, gzip, retry) via `${env:…}` | `otel-collector-config.yaml#otlphttp/grafana (~L49-63)` |
| Prod has no collector; services push OTLP direct to Grafana Cloud | `otel-collector-config.yaml#no collector deployment is needed there (~L18-19)` |
| Alert-rule cleanup and the Tempo dashboard (purpose, import, removed assets) | `alerts/README.md`, `dashboards/README.md` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
