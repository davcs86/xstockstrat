# _tasks/x-observability-otel-grafana.md
# xstockstrat — Observability Rollout: OpenTelemetry + Grafana Cloud

## Overview

This runbook covers the end-to-end implementation of centralized logging, metrics, and
distributed tracing across all xstockstrat services using:

- **OpenTelemetry** (OTEL) — vendor-neutral instrumentation SDK for all three runtimes
- **OpenTelemetry Collector** — central fan-out gateway; services push OTLP to it, it
  forwards to the configured backend
- **Grafana Cloud** — managed backend (Loki for logs, Mimir for metrics, Tempo for traces)

All services already emit structured JSON to stdout. The goal is to route that data plus
metrics and traces into a single queryable platform.

---

## Architecture

```
Services (Go / Python / Node.js / Next.js)
  └── OTel SDK (per-language, configured via env vars)
        └── OTLP push (gRPC :4317 or HTTP :4318)
              └── OTel Collector  ← central gateway
                    ├── Loki exporter  → Grafana Cloud (logs)
                    ├── Prometheus/Mimir exporter → Grafana Cloud (metrics)
                    └── Tempo exporter → Grafana Cloud (traces)
                          └── Grafana UI → dashboards, alerts, SLOs
```

**Push model** is required because DO App Platform does not expose the underlying host for
Prometheus pull scrapes.

**Local dev:** OTel Collector runs as a Docker Compose service (`packages/otel/`).
**Production:** Services push directly to Grafana Cloud's OTLP gateway endpoint
(no collector needed in prod — simplifies the deployment surface).

---

## Cost Profile

| Tier | Logs | Metrics | Traces | Retention | Cost |
|---|---|---|---|---|---|
| Free | 50 GB/mo | 10 k active series | 50 GB/mo | 14 days | **$0** |
| Paid | +$0.50/GB | +$8/1k series | +$0.50/GB | 30–90 days | Pay-as-you-go |

Free tier is sufficient for dev + paper-trading. Scale to paid on production go-live.

---

## Phase 0 — Grafana Cloud Setup (manual, one-time)

> Performed by: platform lead

1. Create a Grafana Cloud account at `https://grafana.com/auth/sign-up/create-user`
2. Create a **stack** (e.g. `xstockstrat`). Note your:
   - Stack slug (e.g. `xstockstrat`)
   - Region (e.g. `prod-us-central-0`)
3. Under **Home → Connections → Add new connection → OpenTelemetry**, Grafana generates
   a ready-to-use OTLP endpoint + token. Copy:
   - `GRAFANA_OTLP_ENDPOINT` — e.g. `https://otlp-gateway-prod-us-central-0.grafana.net/otlp`
   - `GRAFANA_OTLP_TOKEN`    — base64-encoded `<instanceId>:<apiKey>` (Grafana provides this pre-encoded)
4. Store both values in your secret store. They will be set as env vars on all services
   and on the OTel Collector container in prod.
5. For dev, add them to your local `.env` file (never commit `.env`).

> **Grafana Cloud OTLP gateway** accepts all three signal types (logs, metrics, traces)
> on a single endpoint, which is why no per-signal exporter config is needed in prod.

---

## Phase 1 — OTel Collector (Local Dev)

File: `packages/otel/otel-collector-config.yaml`
Docker Compose service: `otel-collector` (added to `docker-compose.yml`)

The collector is included in `docker-compose.yml` as an infrastructure dependency.
All services send OTLP to `otel-collector:4317` (gRPC) locally; the collector forwards
to Grafana Cloud using `GRAFANA_OTLP_ENDPOINT` and `GRAFANA_OTLP_TOKEN` from `.env`.

### Verify collector is running

```bash
docker compose up -d otel-collector
docker compose logs otel-collector --tail=20
# Expect: "Everything is ready. Begin running and processing data."
```

### Test pipeline with telemetrygen

```bash
docker run --rm --network xstockstrat \
  ghcr.io/open-telemetry/opentelemetry-collector-contrib/telemetrygen:latest \
  traces --otlp-endpoint otel-collector:4317 --otlp-insecure --duration 5s
```

---

## Phase 2 — Go Service Instrumentation

Applies to: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`

### 2.1 — Add dependencies to each `go.mod`

```bash
cd services/xstockstrat-trading   # repeat for portfolio, marketdata
go get go.opentelemetry.io/otel@v1.28.0
go get go.opentelemetry.io/otel/sdk@v1.28.0
go get go.opentelemetry.io/otel/sdk/metric@v1.28.0
go get go.opentelemetry.io/otel/sdk/log@v0.6.0
go get go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp@v0.50.0
go get go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp@v0.50.0
go get go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp@v0.6.0
go get go.opentelemetry.io/contrib/bridges/otelslog@v0.4.0
go get go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc@v0.53.0
```

### 2.2 — Create `internal/telemetry/otel.go` in each service

```go
package telemetry

import (
    "context"
    "os"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
    "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/propagation"
    sdklog "go.opentelemetry.io/otel/sdk/log"
    sdkmetric "go.opentelemetry.io/otel/sdk/metric"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
    "go.opentelemetry.io/otel/sdk/resource"
)

// Init configures the global OTEL tracer, meter, and log providers.
// OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_SERVICE_NAME must be set in env.
// Returns a shutdown function — call it with a context on process exit.
func Init(ctx context.Context, serviceName string) (shutdown func(context.Context) error, err error) {
    if os.Getenv("OTEL_ENABLED") != "true" {
        return func(context.Context) error { return nil }, nil
    }

    res, err := resource.New(ctx,
        resource.WithAttributes(semconv.ServiceName(serviceName)),
        resource.WithFromEnv(),
    )
    if err != nil {
        return nil, err
    }

    // Trace provider
    traceExp, err := otlptracehttp.New(ctx)
    if err != nil {
        return nil, err
    }
    tp := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(traceExp),
        sdktrace.WithResource(res),
    )
    otel.SetTracerProvider(tp)
    otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
        propagation.TraceContext{}, propagation.Baggage{},
    ))

    // Metric provider
    metricExp, err := otlpmetrichttp.New(ctx)
    if err != nil {
        return nil, err
    }
    mp := sdkmetric.NewMeterProvider(
        sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp)),
        sdkmetric.WithResource(res),
    )
    otel.SetMeterProvider(mp)

    // Log provider (bridges slog → OTLP logs)
    logExp, err := otlploghttp.New(ctx)
    if err != nil {
        return nil, err
    }
    lp := sdklog.NewLoggerProvider(
        sdklog.WithProcessor(sdklog.NewBatchProcessor(logExp)),
        sdklog.WithResource(res),
    )

    shutdown = func(ctx context.Context) error {
        _ = tp.Shutdown(ctx)
        _ = mp.Shutdown(ctx)
        _ = lp.Shutdown(ctx)
        return nil
    }
    return shutdown, nil
}
```

### 2.3 — Wire into `cmd/server/main.go`

```go
// After slog.SetDefault(logger), before cfgWatcher.WaitForSnapshot:
otelShutdown, err := telemetry.Init(ctx, "xstockstrat-trading")
if err != nil {
    slog.Error("otel init failed", "error", err)
    // Non-fatal: observability is best-effort
}
defer func() {
    shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    _ = otelShutdown(shutCtx)
}()
```

### 2.4 — Add gRPC interceptors (optional, for trace propagation)

```go
// On the grpc.NewServer call, add:
grpc.NewServer(
    grpc.StatsHandler(otelgrpc.NewServerHandler()),
)
// On outbound grpc.Dial calls:
grpc.WithStatsHandler(otelgrpc.NewClientHandler())
```

---

## Phase 3 — Python Service Instrumentation

Applies to: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`

### 3.1 — Add dependencies to each `pyproject.toml`

```toml
# In [project].dependencies:
"opentelemetry-sdk>=1.26.0",
"opentelemetry-exporter-otlp-proto-http>=1.26.0",
"opentelemetry-instrumentation-grpc>=0.47b0",
"opentelemetry-instrumentation-logging>=0.47b0",
```

### 3.2 — Create `app/telemetry.py` in each service

```python
import os
import logging

from opentelemetry import trace, metrics
from opentelemetry.sdk.resources import Resource, SERVICE_NAME
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.instrumentation.logging import LoggingInstrumentor

log = logging.getLogger(__name__)


def init(service_name: str) -> None:
    """Configure global OTEL providers. No-op when OTEL_ENABLED != 'true'."""
    if os.environ.get("OTEL_ENABLED") != "true":
        return

    resource = Resource(attributes={SERVICE_NAME: service_name})

    # Traces — OTEL_EXPORTER_OTLP_ENDPOINT read automatically
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)

    # Metrics
    reader = PeriodicExportingMetricReader(OTLPMetricExporter(), export_interval_millis=10_000)
    meter_provider = MeterProvider(resource=resource, metric_readers=[reader])
    metrics.set_meter_provider(meter_provider)

    # Bridge stdlib logging → OTLP logs (injects trace_id / span_id into log records)
    LoggingInstrumentor().instrument(set_logging_format=True)

    log.info("opentelemetry initialized", extra={"service": service_name})
```

### 3.3 — Wire into `app/main.py`

```python
# Before config watcher, after basicConfig:
from app.telemetry import init as init_otel
init_otel("xstockstrat-indicators")  # use the service name
```

---

## Phase 4 — Node.js Service Instrumentation

Applies to: `xstockstrat-config`, `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`

### 4.1 — Add dependencies to each `package.json`

```bash
pnpm add \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/sdk-logs \
  @opentelemetry/winston-transport
```

### 4.2 — Create `src/telemetry.ts` in each service

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

let sdk: NodeSDK | undefined;

export function initTelemetry(serviceName: string): void {
  if (process.env.OTEL_ENABLED !== 'true') return;

  // OTEL_EXPORTER_OTLP_ENDPOINT is read automatically by each exporter
  sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 10_000,
    }),
    logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false }, // noisy
      }),
    ],
  });

  sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown();
}
```

### 4.3 — Add Winston → OTLP bridge in `src/services/logger.ts`

```typescript
import { OpenTelemetryTransportV3 } from '@opentelemetry/winston-transport';

// In getLogger(), add to transports array when OTEL is enabled:
const otelEnabled = process.env.OTEL_ENABLED === 'true';

return createLogger({
  // ...existing config...
  transports: [
    new transports.Console(),
    ...(otelEnabled ? [new OpenTelemetryTransportV3()] : []),
  ],
});
```

### 4.4 — Wire into service entry point

```typescript
// src/index.ts — before anything else:
import { initTelemetry, shutdownTelemetry } from './telemetry';
initTelemetry('xstockstrat-config'); // use the service name

process.on('SIGTERM', async () => {
  await shutdownTelemetry();
  process.exit(0);
});
```

---

## Phase 5 — DO App Platform Env Vars

> Performed by: platform lead, using `doctl` or the DO console.

For production (`app.yaml`) and dev (`app.dev.yaml`), add the following env vars to
**every service** block. These reference DigitalOcean App Platform secrets:

```yaml
# Add to each service's envs: block in .do/app.yaml and .do/app.dev.yaml
- key: OTEL_ENABLED
  value: "true"
- key: OTEL_SERVICE_NAME
  value: "xstockstrat-<service-name>"   # e.g. xstockstrat-trading
- key: OTEL_EXPORTER_OTLP_ENDPOINT
  type: SECRET
  value: "<set via doctl or DO console — GRAFANA_OTLP_ENDPOINT value>"
- key: OTEL_EXPORTER_OTLP_HEADERS
  type: SECRET
  value: "Authorization=Basic <set via doctl or DO console — GRAFANA_OTLP_TOKEN value>"
```

> In production, services push OTLP **directly** to the Grafana Cloud gateway.
> No separate OTel Collector deployment is required on DO App Platform.

### Apply with doctl

```bash
# Store secrets (run once per environment)
doctl apps create-deployment $APP_ID --wait

# Or update env vars via spec update:
doctl apps update $APP_ID --spec .do/app.yaml
```

---

## Phase 6 — Grafana Dashboards

After data starts flowing, import or build the following dashboards in Grafana:

### Recommended starter dashboards

| Dashboard | Source |
|---|---|
| Go service metrics (goroutines, GC, HTTP) | Grafana Dashboard ID `10826` |
| gRPC server metrics | Build from `rpc.server.*` OTEL semantic conventions |
| Service request rate / error rate / latency | Build from `http.server.request.duration` histogram |
| Log volume by service + level | Loki: `sum by (service_name, level) (rate({job="xstockstrat"}[5m]))` |
| Distributed trace explorer | Grafana Tempo — use TraceQL |

### Key Loki label selectors

Services emit structured JSON with a `service` field in every log line. Loki labels:

```logql
{service_name="xstockstrat-trading"} | json | level="error"
{service_name=~"xstockstrat-.*"}     | json | line_format "{{.message}}"
```

### Key Tempo TraceQL queries

```traceql
# All trading service traces with errors
{ span.service.name = "xstockstrat-trading" && status = error }

# Slow gRPC calls (> 500ms)
{ span.rpc.system = "grpc" && duration > 500ms }

# Cross-service trace fan-out from a ledger write
{ span.service.name = "xstockstrat-ledger" && span.rpc.method = "AppendEvent" }
```

---

## Phase 7 — Alerting

Configure Grafana Alerting on these initial rules:

| Alert | Query | Threshold |
|---|---|---|
| High error rate | `sum(rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m])) by (service_name)` | > 5 req/s |
| Service log errors | `sum(rate({service_name=~"xstockstrat-.*"} \| json \| level="error" [5m]))` | > 10/min |
| p99 latency spike | `histogram_quantile(0.99, rate(http_server_request_duration_seconds_bucket[5m]))` | > 2s |
| Platform maintenance mode | Loki alert on `maintenance_mode=true` config event | Any |

Route alerts via Grafana's notification policies to your existing notify channel
(Slack, email, PagerDuty) — or wire through `xstockstrat-notify` via a Grafana webhook.

---

## Environment Variable Reference

All OTel env vars follow the OpenTelemetry specification and are read automatically by
each SDK. No custom parsing required in service code.

| Variable | Example Value | Set In |
|---|---|---|
| `OTEL_ENABLED` | `true` | `.env`, docker-compose, DO app spec |
| `OTEL_SERVICE_NAME` | `xstockstrat-trading` | `.env`, docker-compose, DO app spec |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` (local) / Grafana Cloud URL (prod) | `.env`, DO secret |
| `OTEL_EXPORTER_OTLP_HEADERS` | `Authorization=Basic <token>` | `.env`, DO secret |
| `OTEL_RESOURCE_ATTRIBUTES` | `environment=dev,trading_mode=paper` | `.env`, docker-compose |

### Config service keys to register

Following the `<service-short-name>.<category>.<key>` naming convention:

| Key | Type | Default | Description |
|---|---|---|---|
| `platform.otel.enabled` | bool | false | Master switch for OTEL export |
| `platform.otel.endpoint` | string | — | OTLP endpoint (set via secret) |
| `platform.otel.sample_rate` | float | 1.0 | Trace sample rate (0.0–1.0) |

---

## Migration Path Summary

| Phase | Action | Cost |
|---|---|---|
| Phase 0–1 | Grafana Cloud free tier + local Collector | $0 |
| Phase 2–4 | SDK instrumentation across all services | $0 |
| Phase 5 | DO App Platform env vars wired | $0 |
| Phase 6–7 | Dashboards + alerts live | Free tier |
| Production go-live | Upgrade Grafana Cloud if > 50 GB logs/mo | ~$10–30/mo |
| Data sovereignty option | Migrate backend to self-hosted PLG on DO Droplet (~$24/mo flat) | ~$24/mo |

---

## Rollback

OTEL instrumentation is designed to be non-fatal. If an exporter fails:
- Go: `otelShutdown` returns an error but `main()` continues
- Python: `init_otel` catches exceptions and logs them; server still starts
- Node.js: `sdk.start()` errors are caught; app still starts

To disable globally without redeploying: set `OTEL_ENABLED=false` (or remove the var).
Config key `platform.otel.enabled=false` can also be pushed via xstockstrat-config for
a live switch without a restart.
