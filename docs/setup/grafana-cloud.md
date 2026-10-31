# Grafana Cloud & OpenTelemetry Setup

This runbook walks through creating a Grafana Cloud account and wiring the xstockstrat platform's OpenTelemetry (OTEL) telemetry pipeline into it. Every deployable workload — the eleven backend/UI services plus the `xstockstrat-agent` MCP server — exports **traces, metrics and logs** via OTLP/HTTP (`/v1/traces`, `/v1/metrics`, `/v1/logs`) when `OTEL_ENABLED=true`. The series and log streams, the stream-method exclusion and the optional SDK env vars are listed in `docs/patterns/observability.md` § Exported signals.

In local dev, an `otel-collector` Docker container aggregates and forwards signals. In production (DO App Platform), services push OTLP directly to Grafana Cloud.

The dashboards and alert rules are checked into the repo as the reproducible source of truth — see `packages/otel/dashboards/` and `packages/otel/alerts/`. Steps 6 and 7 below explain how to use them.

---

## Overview

```
Local Dev:
  Services → otel-collector:4318 (OTLP/HTTP) → Grafana Cloud OTLP gateway

Production (DO App Platform):
  Services → Grafana Cloud OTLP gateway (direct, no collector)
```

**Collector config:** `packages/otel/otel-collector-config.yaml`

**Signal types sent:**
- **Traces** — distributed request traces across gRPC service calls (Tempo)
- **Metrics** — `rpc_server_duration_milliseconds_*` (gRPC services), `mcp_tool_duration_milliseconds_*` (agent), `http_server_duration_milliseconds_*` (UI) (Mimir / Prometheus)
- **Logs** — each service's application log records, stream `{service_name="<name>"}` (Loki)

**Resource attributes attached to all telemetry:**

| Attribute | Dev value | Prod value |
|---|---|---|
| `deployment.environment` | `APPLICATION_ENV` (e.g. `development`) | `production` |
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

- Listens for OTLP on **HTTP :4318** — every xstockstrat service exports traces here
- Also listens on **gRPC :4317** for other OTLP clients (e.g. `telemetrygen` smoke tests)
- Applies a **memory limiter** (256 MiB max) to prevent OOM in dev
- **Batches** telemetry (10s window, 1000 items/batch) before forwarding
- Receives the `service.name`, `deployment.environment`, and `platform` resource attributes each service sets at startup (from `SERVICE_NAME`, `APPLICATION_ENV`, and the constant `xstockstrat`)
- Forwards to Grafana Cloud via `otlphttp/grafana` exporter with gzip compression and retry

Each service in docker-compose has these environment variables pre-set:

```
OTEL_ENABLED=${OTEL_ENABLED}
SERVICE_NAME=<service>
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318   # every service (OTLP/HTTP)
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

In production there is no collector container — each service pushes OTLP **directly** to Grafana Cloud. The endpoint and auth header are declared at the **global `envs:` level** in `.do/app.yaml` / `.do/app.dev.yaml` as `YOUR_*` placeholder tokens, substituted at deploy time by the GitHub Actions deploy workflow from GitHub Secrets.

### 4a. Add GitHub Secrets

Add these four secrets in your GitHub repo (**Settings → Secrets and variables → Actions → New repository secret**):

| GitHub Secret | Value | Example |
|---|---|---|
| `DEV_OTEL_EXPORTER_OTLP_ENDPOINT` | Grafana Cloud OTLP gateway URL (dev stack) | `https://otlp-gateway-prod-us-central-0.grafana.net/otlp` |
| `DEV_OTEL_EXPORTER_OTLP_HEADERS` | `Basic <base64(instanceId:apiKey)>` (dev stack) | `Basic MjM0NTY3OmdsY19l...` |
| `PROD_OTEL_EXPORTER_OTLP_ENDPOINT` | Grafana Cloud OTLP gateway URL (prod stack) | Same URL if sharing one Grafana stack |
| `PROD_OTEL_EXPORTER_OTLP_HEADERS` | `Basic <base64(instanceId:apiKey)>` (prod stack) | Same token if sharing one Grafana stack |

> If you use the **same** Grafana Cloud stack for dev and prod (differentiated by the `deployment.environment` resource attribute), set identical values for the dev and prod pairs.

### 4b. Enable OTel in the app spec

The app specs ship with `OTEL_ENABLED: "false"` by default. To enable telemetry, change the value in `.do/app.yaml` and/or `.do/app.dev.yaml`:

```yaml
- key: OTEL_ENABLED
  value: "true"
```

Commit and push — the next deploy will have OTel active.

### 4c. How the substitution works

The deploy chain (`deploy-dev.yml` / `deploy-prod.yml` → `deploy.yml`) passes the environment-specific GitHub Secrets into the reusable workflow, which `sed`+Python-replaces the `YOUR_DEV_*` / `YOUR_PROD_*` placeholder tokens in the app spec before calling `doctl apps update`. The `prod-up.yml` (manual prod bring-up) uses `scripts/do-inject-prod-secrets.py` for the same substitution.

Each component inherits the global `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` and sets its own `SERVICE_NAME`.

Resource attributes (`service.name`, `deployment.environment`, `platform`) are set at startup from each service's `SERVICE_NAME` and `APPLICATION_ENV` env vars — no `OTEL_RESOURCE_ATTRIBUTES` setting required.

**All runtimes (Go, Python, Node.js, Next.js) use OTLP/HTTP**, configured only by these env vars: the SDK appends `/v1/traces` to the gateway URL (`…/otlp` → `…/otlp/v1/traces`), uses TLS for the `https://` scheme, and sends the `Authorization` header. Never pass an endpoint/url option to an exporter in code — it overrides all three (feature 226).

> **GitHub Secret format: just `Basic <token>`** — the same format as the local-dev `.env`. The deploy workflow automatically prepends `Authorization=` before injecting the value into the DO app spec, so the OTel SDK (which expects `key=value` pairs) receives the correct `Authorization=Basic <token>` format. Both `deploy.yml` and `scripts/do-inject-prod-secrets.py` apply this transform; if the value already starts with `Authorization=` it is left as-is.

---

## Step 5 — Verify Telemetry Is Arriving in Grafana Cloud

After starting the stack (dev) or deploying to DO (prod):

### Check Traces (Tempo)

1. Grafana Cloud → **Explore**
2. Datasource: **Tempo**
3. Query type: **Search**
4. Service name: `config`
5. Run query — you should see traces from startup (WatchConfig handshakes)

---

## Step 6 — Dashboard (checked into the repo)

The dashboards are version-controlled JSON under **`packages/otel/dashboards/`** — that directory is the
source of truth, not the Grafana UI. See its `README.md` for the panel/query assumptions.

| File | Dashboard | Covers |
|---|---|---|
| `service-health.json` | Service Health (`xstk-service-health`) | request rate, error rate and P99 latency per service, error-log volume, plus Tempo drill-downs (server error spans, slow server spans, analysis scoring RPC activity) |
| `signal-pipeline-throughput.json` | Signal Pipeline (`xstk-signal-pipeline`) | analysis latency by RPC method, analysis live-loop cycles |
| `infrastructure.json` | Infrastructure (`xstk-infrastructure`) | transport-level gRPC errors, services reporting |
| `trading-service.json` | Trading Service (`xstk-trading-service`) | `PlaceOrder` rate and latency, trading error logs |

**Import (UI):** Grafana → Dashboards → New → **Import** → upload the JSON → select your Prometheus, Loki and
(for Service Health) Tempo datasources when prompted (the `DS_PROMETHEUS`, `DS_LOKI` and `DS_TEMPO` `__inputs`).

**Import (file-based provisioning):** point a Grafana dashboard provider at
`packages/otel/dashboards/`; the `${DS_*}` template variables resolve to the provisioned datasource UIDs.

### Ad-hoc Tempo queries (supplementary)

```traceql
# Full order-flow span tree: trading → portfolio → indicators → ledger
{ name =~ ".*/PlaceOrder" }
```

---

## Step 7 — Alert Rules (checked into the repo)

`packages/otel/alerts/alert-rules.yaml` provisions three rules (error rate, P99 latency, analysis live-loop
heartbeat) and `mute-timings.yaml` the `outside-us-market-hours` mute timing; see its `README.md` for the
datasource-UID substitutions, the stream-method exclusion and the stall rule's meaning.

**Apply:** file-based provisioning (self-hosted) applies both files itself. Grafana Cloud does not apply
the file: import each rule under Alerting → Alert rules and create the mute timing under Alerting →
Notification policies → Mute timings.

Routing (contact points + notification policies) is left to each environment — route to email or
to Slack via feature `020-notify-external-fanout`.

---

## Step 8 — Service Name Reference

Use these exact service names when querying by `resource.service.name` in Tempo:

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
| xstockstrat-ui | `xstockstrat-ui` |
| xstockstrat-agent | `agent` |
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

### Production services not sending telemetry

Verify the `*_OTEL_EXPORTER_OTLP_HEADERS` GitHub secret is `Basic <base64(instanceId:apiKey)>` without surrounding quotes (the deploy workflow adds `Authorization=`). Export failures are logged by every service — Go: `traces export: …`; Python: `Failed to export span batch code: …`; Node/Next: `OTLPExporterError …` — and a Next.js boot logs `[otel] tracing enabled` when the hook is registered.
