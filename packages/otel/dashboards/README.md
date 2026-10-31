# xstockstrat Grafana Dashboards

File-based, version-controlled Grafana dashboards for the Phase 7 observability stack
(feature `033-phase7-observability`), restored by feature `274-otel-metrics-logs-export` now that the
runtimes export traces, metrics and logs over OTLP/HTTP.

| File | Dashboard | UID | Panels |
|---|---|---|---|
| `service-health.json` | Service Health | `xstk-service-health` | Request rate; error rate; P99 latency; error-log volume (all by `$service`); Tempo: server error spans, slow server spans (>2s), analysis scoring RPC activity |
| `signal-pipeline-throughput.json` | Signal Pipeline | `xstk-signal-pipeline` | Analysis scoring latency (P99 by `rpc_method`); analysis live-loop cycles (10m) |
| `infrastructure.json` | Infrastructure | `xstk-infrastructure` | gRPC transport errors per service (status 4, 8, 14); services reporting telemetry |
| `trading-service.json` | Trading Service | `xstk-trading-service` | `PlaceOrder` rate by status; `PlaceOrder` P50/P99; trading error logs |

## Importing

Each dashboard declares its datasources as `__inputs`, bound at import time:

- **Prometheus** — your Grafana Cloud metrics datasource (`grafanacloud-<stack>-prom`), input `DS_PROMETHEUS`
- **Loki** — your Grafana Cloud logs datasource (`grafanacloud-<stack>-logs`), input `DS_LOKI`
- **Tempo** — your Grafana Cloud traces datasource (`grafanacloud-<stack>-traces`), input `DS_TEMPO` (Service Health only)

**Via the UI:** Grafana → Dashboards → New → Import → Upload JSON file → pick the datasources when prompted.

**Via file-based provisioning** (self-hosted Grafana or Grafana Agent): drop the files in a provisioned
dashboards path and add a provider entry pointing at this directory. The `${DS_*}` template variables resolve
to the provisioned datasource UIDs.

## Query assumptions

Every series and log literal a panel queries is registered in `../produced-signals.tsv`, and
`scripts/check-otel-produced-signals.sh` fails CI when a panel references anything unregistered.

- **Metrics:** `rpc_server_duration_milliseconds_{count,bucket,sum}` with `service_name`, `rpc_service`,
  `rpc_method` and `rpc_grpc_status_code`. Every selector excludes the server-streaming methods
  (`rpc_method!~"…"`, derived from `packages/proto` by the guard): a stream call ends on each deploy and
  would look like an error or a slow call. The `$service` variable is the one exempt query.
- **Python and Node** record `rpc.server.duration` from the gRPC server span, so the Python and Node
  numbers depend on inbound spans being sampled; the guard rejects a trace sampler or gRPC-exclusion env in
  the deploy specs.
- **Logs:** the Loki stream label is `service_name` (the short service name). `platform`, `trace_id` and the
  level are structured metadata, so panels use `| detected_level="error"` rather than a stream selector on
  them.
- **Resource attributes** `service.name`, `deployment.environment` and `platform=xstockstrat` are attached by
  every service's telemetry module; in TraceQL they are `resource.service.name`,
  `resource.deployment.environment` and `resource.platform`.
- **Slow server spans** (Tempo) exclude server-streaming RPCs (`Watch*`, `Stream*`, `Export*`). Long-lived
  spans that are not gRPC RPCs, such as the agent's `subscriptions/listen`, still appear.
- **Analysis scoring RPC activity** (Tempo) lists `RunBacktest` and `ScoreStrategy` server spans. Both RPCs are
  client-invoked, so an empty panel does not mean scoring has stalled; the live-loop heartbeat panel and the
  `xstk-analysis-no-scoring` alert are the stall signal.

## Not restored

The earlier Signal Pipeline "signals ingested" and "agent scheduler" panels, Infrastructure's database
connection-error logs and OTLP export errors, and Trading Service's "order fills" panel are gone: no runtime
emits their log literals, and OTLP export failures are deliberately stdout-only (they would otherwise recurse
into the log exporter). The panel-by-panel decision table is in
`docs/roadmap/features/274-otel-metrics-logs-export/context.md`.

## Relationship to docs/setup/grafana-cloud.md

`docs/setup/grafana-cloud.md` documents the manual UI walkthrough and ad-hoc Explore queries.
This directory is the **reproducible, checked-in source of truth** for the dashboards
referenced there.
