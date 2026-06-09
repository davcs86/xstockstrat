# xstockstrat Grafana Dashboards

File-based, version-controlled Grafana dashboards for the Phase 7 observability stack
(feature `033-phase7-observability`). These are the V1 **metrics + logs** dashboards;
distributed-trace visualization (Tempo) is explicitly out of scope for V1.

| File | Dashboard | UID | Primary signals |
|---|---|---|---|
| `service-health.json` | Service Health | `xstk-service-health` | gRPC request rate, error rate, P99 latency, log error volume — one series per service |
| `signal-pipeline-throughput.json` | Signal Pipeline Throughput | `xstk-signal-pipeline` | signals ingested/hour, analysis scoring latency, agent scheduler run duration & success |
| `trading-service.json` | Trading Service | `xstk-trading-service` | order submission rate, PlaceOrder latency, fills/5m, trading error logs |
| `infrastructure.json` | Infrastructure | `xstk-infrastructure` | gRPC connection errors, DB connection error logs, services-reporting count, OTLP export errors |

## Importing

Each dashboard declares two `__inputs` datasources, bound at import time:

- **Prometheus / Mimir** — your Grafana Cloud metrics datasource (`grafanacloud-<stack>-prom`)
- **Loki** — your Grafana Cloud logs datasource (`grafanacloud-<stack>-logs`)

**Via the UI:** Grafana → Dashboards → New → Import → Upload JSON file → pick the two
datasources when prompted.

**Via file-based provisioning** (self-hosted Grafana or Grafana Agent): drop these files in
a provisioned dashboards path and add a provider entry pointing at this directory. The
`${DS_PROMETHEUS}` / `${DS_LOKI}` template variables resolve to the provisioned datasource UIDs.

## Metric & label assumptions

Panels are built on the telemetry the existing OTel SDK stubs already emit — no custom
instrumentation is required for them to populate:

- **gRPC server metrics** come from the per-language gRPC instrumentation (otelgrpc in Go,
  `GrpcAioInstrumentor*` in Python, `@opentelemetry/instrumentation-grpc` in Node). The OTLP →
  Prometheus translation yields the histogram `rpc_server_duration_milliseconds` with
  `_count` / `_sum` / `_bucket` series and labels `service_name`, `rpc_method`,
  `rpc_grpc_status_code` (`"0"` = OK). If your Grafana Cloud stack maps the histogram under a
  different name (e.g. `rpc_server_duration_milliseconds` vs `rpc_server_duration_ms`), adjust
  the panel `expr` accordingly — see the metric in **Explore** first.
- **Resource attributes** (`service.name`, `deployment.environment`, `trading_mode`,
  `platform=xstockstrat`) are attached by every service's telemetry module and surface as the
  `service_name` / `platform` labels (Grafana Cloud promotes `service.name`).
- **Log-derived panels** (signals ingested, fills, scheduler runs, DB/OTLP errors) query Loki
  by `service_name` and string match on log lines the services already emit. They depend on
  log content, not on new metrics.

The agent scheduler success/failure panel matches `run.completed` / `run.failed` lines; if the
scheduler (feature 010) logs different markers, update the two Loki expressions in
`signal-pipeline-throughput.json`.

## Relationship to docs/setup/grafana-cloud.md

`docs/setup/grafana-cloud.md` documents the manual UI walkthrough and ad-hoc Explore queries.
This directory is the **reproducible, checked-in source of truth** for the four dashboards
referenced there.
