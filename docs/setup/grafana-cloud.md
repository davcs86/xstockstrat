# Grafana Cloud & OpenTelemetry Setup

This runbook walks through creating a Grafana Cloud account and wiring the xstockstrat platform's OpenTelemetry (OTEL) telemetry pipeline into it. All 13 services emit traces, metrics, and logs via OTLP. In local dev, an `otel-collector` Docker container aggregates and forwards signals. In production (DO App Platform), services push OTLP directly to Grafana Cloud.

---

## Overview

```
Local Dev:
  Services → otel-collector:4317/4318 → Grafana Cloud OTLP gateway

Production (DO App Platform):
  Services → Grafana Cloud OTLP gateway (direct, no collector)
```

**Collector config:** `packages/otel/otel-collector-config.yaml`

**Signal types sent:**
- **Traces** — distributed request traces across gRPC service calls
- **Metrics** — request counts, latencies, DB query times, stream subscriber counts
- **Logs** — structured logs from all services (errors, warnings, audit events)

**Resource attributes attached to all telemetry:**

| Attribute | Dev value | Prod value |
|---|---|---|
| `environment` | `dev` | `production` |
| `trading_mode` | `paper` | `live` |
| `platform` | `xstockstrat` | `xstockstrat` |
| `service.name` | per-service | per-service |

---

## Step 1 — Create a Grafana Cloud Account

1. Go to **grafana.com** and click **Create free account**.
2. Sign up with email, GitHub, or Google.
3. Choose an organization name (e.g., `xstockstrat`). This becomes your Grafana Cloud slug.
4. Select the **Free** plan to start — it includes:
   - 14-day trace retention
   - 10,000 active metric series
   - 50 GB log ingestion per month
   - Unlimited dashboards and alerting

> The free tier is sufficient for local dev and low-volume paper trading. Upgrade to a paid plan when running production live trading at scale.

---

## Step 2 — Get the OTLP Connection Details

The OTLP gateway is how services push telemetry to Grafana Cloud.

1. In Grafana Cloud, click **Connections** in the left sidebar
2. Click **Add new connection**
3. Search for **OpenTelemetry** and select it
4. Click **Create a Grafana Cloud Stack** if not already done, or select your existing stack
5. On the OpenTelemetry connection page you will see:

**Endpoint URL** (copy this):
```
https://otlp-gateway-<region>.grafana.net/otlp
```
Example: `https://otlp-gateway-prod-us-central-0.grafana.net/otlp`

**Token** — Grafana provides a pre-encoded base64 token in the format `Basic <base64(instanceId:apiKey)>`. The full string including `Basic ` is your `OTEL_EXPORTER_OTLP_HEADERS` value.

> If Grafana does not show a pre-encoded token, generate an API key manually:
> 1. Grafana Cloud → **My Account → Security → API Keys → Add API key**
> 2. Role: **MetricsPublisher** (or **Editor** for full access)
> 3. Then encode: `echo -n "<instanceId>:<apiKey>" | base64`
> 4. Your instance ID is shown on the Grafana Cloud portal home page.

---

## Step 3 — Local Dev Setup

### 3a. Update your `.env` file

Copy `.env.example` to `.env` if you have not already:

```bash
cp .env.example .env
```

Set the OTEL variables in your `.env` file (both endpoint and headers live together in `.env` — they are tightly coupled):

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Basic <base64-encoded-instance-id:api-key>
```

Leave `OTEL_ENABLED=false` if you do not want to send telemetry during local dev (the collector will still start but export nothing).

### 3b. Start the stack

```bash
docker compose up
```

The `otel-collector` container starts automatically and reads `packages/otel/otel-collector-config.yaml`. It:

- Listens for OTLP on **gRPC :4317** (Go + Python services connect here)
- Listens for OTLP on **HTTP :4318** (Node.js services connect here)
- Applies a **memory limiter** (256 MiB max) to prevent OOM in dev
- **Batches** spans/metrics/logs (10s window, 1000 items/batch) before forwarding
- **Derives** `environment`, `trading_mode`, and `platform` resource attributes from each service's `APPLICATION_ENV`, `TRADING_MODE` env vars and the hardcoded constant `xstockstrat` at startup
- Forwards to Grafana Cloud via `otlphttp/grafana` exporter with gzip compression and retry

Each service in docker-compose has these environment variables pre-set:

```
OTEL_ENABLED=${OTEL_ENABLED}
SERVICE_NAME=<service>
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317   # Go/Python
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318   # Node.js
```

### 3c. Verify the collector is running

```bash
# Health check
curl http://localhost:13133/

# Collector stdout shows telemetry summaries (debug exporter):
docker compose logs -f otel-collector
```

Expected output:
```
2024-01-01T00:00:00.000Z    info    TracesExporter  {"kind": "exporter", "data_type": "traces", "name": "otlphttp/grafana", "resource spans": 12, "spans": 48}
```

---

## Step 4 — Production Setup (DO App Platform)

In production there is no collector container — each service pushes OTLP **directly** to Grafana Cloud. Set these environment variables on all 13 services via the DO App Platform console or `doctl`:

```
OTEL_ENABLED=true
SERVICE_NAME=<service-name>
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64-token>
```

Resource attributes (`environment`, `trading_mode`, `platform`) are derived automatically at startup from each service's `APPLICATION_ENV` and `TRADING_MODE` env vars — no `OTEL_RESOURCE_ATTRIBUTES` setting required.

**Go services** use gRPC OTLP — point them at the gateway's gRPC port. Grafana Cloud's OTLP gateway accepts both HTTP and gRPC on port 443. Use the same HTTPS endpoint URL.

**Node.js services** use HTTP OTLP — same endpoint URL works.

**Python services** use gRPC OTLP — same endpoint URL works.

> `OTEL_EXPORTER_OTLP_HEADERS` must be set as a single string: `Authorization=Basic <base64-token>` — note no quotes around the value. DigitalOcean App Platform passes this directly as an HTTP header.

Set these as **encrypted** environment variables in the DO console (App → Settings → App-Level Environment Variables → Add → check **Encrypt**) so the token is never exposed in logs.

---

## Step 5 — Verify Telemetry Is Arriving in Grafana Cloud

After starting the stack (dev) or deploying to DO (prod):

### Check Traces (Tempo)

1. Grafana Cloud → **Explore**
2. Datasource: **Tempo**
3. Query type: **Search**
4. Service name: `config`
5. Run query — you should see traces from startup (WatchConfig handshakes)

### Check Logs (Loki)

1. Grafana Cloud → **Explore**
2. Datasource: **Loki**
3. Query:
   ```logql
   {service_name="trading"} |= "order"
   ```
4. You should see structured log lines from the trading service

### Check Metrics (Prometheus/Mimir)

1. Grafana Cloud → **Explore**
2. Datasource: **grafanacloud-<stack>-prom**
3. Query:
   ```promql
   {job="marketdata"}
   ```

---

## Step 6 — Recommended Dashboards

Create these dashboards in Grafana Cloud (Dashboards → New → New Dashboard):

### Dashboard 1: Service Health Overview

Panels:

| Panel | Query |
|---|---|
| Services Up | Count of services with traces in last 5 min, grouped by `service.name` |
| Request Rate | `rate(http_server_request_duration_count[1m])` by service |
| Error Rate (%) | `rate(errors_total[1m]) / rate(requests_total[1m]) * 100` |
| p99 Latency | `histogram_quantile(0.99, rate(http_server_request_duration_bucket[5m]))` |

### Dashboard 2: Order Flow Traces

Use Tempo's **Trace to logs** and **Trace to metrics** features:

- Search for `root.name = "PlaceOrder"` in Tempo
- Enable trace correlation in Loki and Prometheus datasources
- Shows the full span tree: trading → portfolio → indicators → ledger

### Dashboard 3: Market Data & Alpaca

| Panel | Description |
|---|---|
| OHLCV Ingestion Rate | Bars stored per minute by symbol |
| Alpaca Stream Reconnects | Count of WebSocket reconnect events from xstockstrat-marketdata |
| Backfill Job Duration | Histogram of historical backfill durations |
| Quote Tick Rate | Quotes received per second from Alpaca stream |

### Dashboard 4: Config Change Audit

Query Loki for config change events:

```logql
{service_name="config"} |= "SetConfig" | json | line_format "{{.namespace}}.{{.key}} = {{.value}} by {{.author}}"
```

### Dashboard 5: WatchConfig Stream Health

| Panel | Description |
|---|---|
| Active Subscribers | Count of open WatchConfig gRPC streams on config |
| Config Delta Broadcast Latency | Time from DB `pg_notify` to subscriber delivery |
| Reconnect Events | Count of subscriber reconnections (indicates instability) |

---

## Step 7 — Recommended Alert Rules

Create these in Grafana Cloud → **Alerting → Alert Rules → New alert rule**:

### Alert: Service Down

```promql
# Trigger when no OTLP data received from a service for > 2 minutes
absent(rate(http_server_request_duration_count{job=~"xstockstrat-.*"}[2m]))
```

Severity: **Critical** | Notification: Slack/PagerDuty

### Alert: Trading Service Error Rate High

```promql
rate(errors_total{service_name="trading"}[5m]) /
rate(requests_total{service_name="trading"}[5m]) > 0.05
```

Severity: **Critical** (> 5% error rate on order execution)

### Alert: Alpaca Stream Reconnect Loop

```promql
increase(alpaca_stream_reconnect_total{service_name="marketdata"}[5m]) > 3
```

Severity: **Warning** — indicates Alpaca WebSocket instability

### Alert: Maintenance Mode Enabled

Query Loki for config change event:

```logql
count_over_time({service_name="config"} |= "platform.maintenance_mode" |= "true" [1m]) > 0
```

Severity: **Warning** — all trading halted when this key is set

### Alert: Ledger Write Failures

```promql
rate(errors_total{service_name="ledger"}[5m]) > 0
```

Severity: **Critical** — ledger is append-only; write failures mean audit trail gaps

---

## Step 8 — Service Name Reference

Use these exact service names when querying by `service.name` or `service_name` in Grafana:

| Service | `service.name` |
|---|---|
| xstockstrat-trading | `trading` |
| xstockstrat-portfolio | `portfolio` |
| xstockstrat-marketdata | `marketdata` |
| xstockstrat-indicators | `indicators` |
| xstockstrat-ingest | `ingest` |
| xstockstrat-analysis | `analysis` |
| xstockstrat-ledger | `ledger` |
| xstockstrat-identity | `identity` |
| xstockstrat-notify | `notify` |
| xstockstrat-config | `config` |
| xstockstrat-ui | `ui` |
| otel-collector | `otel-collector` (local dev only) |

---

## Troubleshooting

### No data in Grafana after starting the stack

1. Check `OTEL_ENABLED=true` is set in `.env`
2. Check collector can reach Grafana: `docker compose logs otel-collector | grep -i error`
3. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` are set correctly
4. Test with `curl`:
   ```bash
   curl -v -H "Authorization: $OTEL_EXPORTER_OTLP_HEADERS" \
     "${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces" \
     -d '{}'
   ```
   A `400 Bad Request` (not 401/403) means credentials are valid.

### Collector OOM in dev

The memory limiter is set to 256 MiB. If your machine is under heavy load, the collector will drop telemetry. Reduce `limit_mib` in `packages/otel/otel-collector-config.yaml` or set `OTEL_ENABLED=false` during local-only development.

### Traces not correlating with logs

Enable **Derived fields** in Loki datasource settings pointing to Tempo:
- Grafana → Connections → Data sources → Loki → Derived fields
- Name: `TraceID`
- Regex: `trace_id=(\w+)`
- Query: `${__value.raw}` in Tempo datasource

### Production services not sending telemetry

Verify `OTEL_EXPORTER_OTLP_HEADERS` is set **without** surrounding quotes on the value. DO App Platform sometimes requires the header string in `Key=Value` format without quotes. Check the service logs for OTLP export errors.
