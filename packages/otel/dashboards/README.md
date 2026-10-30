# xstockstrat Grafana Dashboards

File-based, version-controlled Grafana dashboards for the Phase 7 observability stack
(feature `033-phase7-observability`). The only dashboard is Tempo-backed: runtimes export traces
over OTLP/HTTP and every panel is a TraceQL query.

Metrics and logs are not exported (feature 226).

| File | Dashboard | UID | Panels |
|---|---|---|---|
| `service-health.json` | Service Health | `xstk-service-health` | Server error spans; slow server spans (>2s); analysis scoring RPC activity |

## Importing

The dashboard declares one `__inputs` datasource, bound at import time:

- **Tempo** — your Grafana Cloud traces datasource (`grafanacloud-<stack>-traces`), input name `DS_TEMPO`

**Via the UI:** Grafana → Dashboards → New → Import → Upload JSON file → pick the Tempo
datasource when prompted.

**Via file-based provisioning** (self-hosted Grafana or Grafana Agent): drop the file in a
provisioned dashboards path and add a provider entry pointing at this directory. The `${DS_TEMPO}`
template variable resolves to the provisioned datasource UID.

## Query assumptions

Panels are TraceQL tables over the spans the existing OTel SDK modules already emit — no custom
instrumentation is required for them to populate:

- **Server spans** come from the per-language gRPC instrumentation (otelgrpc in Go,
  `GrpcAioInstrumentor*` in Python, `@opentelemetry/instrumentation-grpc` in Node) and are
  selected with `kind = server`.
- **Resource attributes** `service.name`, `deployment.environment` and `platform=xstockstrat`
  are attached by every service's telemetry module and are queryable in TraceQL as
  `resource.service.name`, `resource.deployment.environment` and `resource.platform`.
- **Slow server spans** exclude server-streaming RPCs (`Watch*`, `Stream*`, `Export*`), which are
  long-lived by design. Long-lived spans that are not gRPC RPCs, such as the agent's
  `subscriptions/listen`, still appear.
- **Analysis scoring RPC activity** lists `RunBacktest` and `ScoreStrategy` server spans. Both RPCs
  are client-invoked, so an empty panel does not mean scoring has stalled.

## Removed assets

Dashboards removed from this directory stay in Grafana Cloud until deleted by hand under
Dashboards.

<!-- otel-guard:removed-assets -->
- `xstk-signal-pipeline` — dashboard
- `xstk-infrastructure` — dashboard
- `xstk-trading-service` — dashboard
- `signal-pipeline-throughput.json` — file
- `infrastructure.json` — file
- `trading-service.json` — file
<!-- /otel-guard:removed-assets -->

## Relationship to docs/setup/grafana-cloud.md

`docs/setup/grafana-cloud.md` documents the manual UI walkthrough and ad-hoc Explore queries.
This directory is the **reproducible, checked-in source of truth** for the dashboard
referenced there.
