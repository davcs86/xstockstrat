# DigitalOcean Account & App Platform Setup

This runbook walks through creating and configuring the DigitalOcean infrastructure that hosts all 13 xstockstrat services. Two App Platform deployments exist — one for paper trading (dev, `main-dev` branch) and one for live trading (prod, `main` branch).

---

## Overview

| Resource | Purpose |
|---|---|
| App Platform (dev) | Hosts all 13 services; paper trading; deploys from `main-dev` |
| App Platform (prod) | Hosts all 13 services; live trading; deploys from `main` |
| Managed PostgreSQL 15 | Shared TimescaleDB database for all services with persistent data |
| GitHub Actions | CI/CD; auto-deploys on push to `main-dev` or `main` via `doctl` |

Architecture spec files:
- `.do/app.dev.yaml` — dev app definition (paper trading, `basic-xs` instances)
- `.do/app.yaml` — prod app definition (live trading, `professional-xs` / `professional-s` instances)

---

## Prerequisites

- GitHub repo `davcs86/xstockstrat-orchestration` is your source of truth
- You have already cloned the repo locally and have `.env.example` ready to copy
- `doctl` CLI installed (see Step 2)
- `gh` CLI installed and authenticated (`gh auth login`)
- All Alpaca credentials ready (see `docs/setup/alpaca.md`)
- All Grafana Cloud OTLP credentials ready (see `docs/setup/grafana-cloud.md`)

---

## Step 1 — Create a DigitalOcean Account

1. Go to **digitalocean.com** and click **Sign Up**.
2. Complete email verification.
3. Add a payment method (credit card or PayPal). DigitalOcean charges by usage — App Platform `basic-xs` instances are the cheapest; `professional-xs` and `professional-s` are used in prod.
4. Optionally, add a spending limit under **Billing → Spending Limit** to prevent surprise charges.

> **Tip:** Create a team if multiple people will manage the infra: **Settings → Teams → Create Team**.

---

## Step 2 — Install and Authenticate doctl CLI

`doctl` is the DigitalOcean CLI used by both local setup and GitHub Actions.

```bash
# macOS
brew install doctl

# Linux (snap)
sudo snap install doctl

# Linux (manual)
curl -sL https://github.com/digitalocean/doctl/releases/latest/download/doctl-<version>-linux-amd64.tar.gz | tar xz
sudo mv doctl /usr/local/bin
```

Authenticate with a Personal Access Token (PAT):

1. DigitalOcean console → **API → Tokens → Generate New Token**
2. Name: `xstockstrat-deploy`; Scopes: **Read + Write** (required for App Platform and database management)
3. Copy the token immediately — it is only shown once
4. Run:
   ```bash
   doctl auth init
   # Paste the token when prompted
   ```
5. Verify authentication:
   ```bash
   doctl account get
   ```

---

## Step 3 — Create the Managed PostgreSQL Database

All services that persist data share one managed PostgreSQL 15 database. TimescaleDB is the required extension.

### 3a. Create the database cluster

Via console: **Databases → Create Database**

```
Engine:  PostgreSQL 15
Region:  NYC1 (matches app.yaml region: nyc)
Plan:    Basic (for dev) or Production (for prod)
Name:    xstockstrat-db
```

Or via doctl:

```bash
doctl databases create xstockstrat-db \
  --engine pg \
  --version 15 \
  --region nyc1 \
  --size db-s-1vcpu-1gb \
  --num-nodes 1
```

Wait for the cluster to become **online** (3–5 minutes).

### 3b. Enable the TimescaleDB extension

Connect to the database using the connection string from the console (**Databases → xstockstrat-db → Connection Details**):

```bash
psql "<connection-string>"
```

Then run:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
-- Verify:
SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';
```

> **Important:** The TimescaleDB extension must be enabled **before** running `scripts/db-migrate.sh`. All hypertable creation in the migrations depends on this extension.

### 3c. Note the connection string

The connection string looks like:

```
postgresql://doadmin:<password>@<host>:25060/defaultdb?sslmode=require
```

It is referenced in the app specs as `${db.DATABASE_URL}`. DigitalOcean injects it automatically when you attach the database to the app (Step 5).

---

## Step 4 — Connect GitHub to DigitalOcean

App Platform pulls code from GitHub. Authorize once:

1. DigitalOcean console → **Apps → Create App**
2. Source: **GitHub** → **Authorize DigitalOcean** (grants read access to repos)
3. Select repo: `davcs86/xstockstrat-orchestration`

You do not need to complete the app creation wizard — cancel after authorization. The actual app creation is done via `doctl` in Step 5.

---

## Step 5 — Create the Dev App (Paper Trading)

The dev app deploys from `main-dev`, runs all services in `TRADING_MODE=paper`, and uses cheaper `basic-xs` instances.

```bash
doctl apps create --spec .do/app.dev.yaml
```

Note the **App ID** printed in the output — you will need it for GitHub Actions.

```bash
# Save it:
export DO_DEV_APP_ID=<app-id-from-output>

# Or retrieve it later:
doctl apps list
```

**What the dev spec configures:**

| Setting | Value |
|---|---|
| Branch | `main-dev` |
| `deploy_on_push` | `false` (GitHub Actions handles deploys) |
| `TRADING_MODE` | `paper` |
| `ALPACA_PAPER` | `true` |
| `ALPACA_BASE_URL` | `https://paper-api.alpaca.markets` |
| Instance size (most services) | `basic-xs` |
| xstockstrat-config instance size | `basic-s` (WatchConfig streaming needs more headroom) |
| Database | Managed PostgreSQL attached as `db` |

Inter-service routing uses DigitalOcean private networking: `${xstockstrat-config.PRIVATE_URL}`, `${xstockstrat-ledger.PRIVATE_URL}`, etc. These resolve automatically within the App Platform private network — no manual configuration needed.

---

## Step 6 — Create the Prod App (Live Trading)

The prod app deploys from `main`, runs all services in `TRADING_MODE=live`, and uses `professional-xs` instances (higher throughput, above 60s idle timeout).

```bash
doctl apps create --spec .do/app.yaml
```

```bash
export DO_PROD_APP_ID=<app-id-from-output>
```

**What the prod spec configures:**

| Setting | Value |
|---|---|
| Branch | `main` |
| `deploy_on_push` | `false` |
| `TRADING_MODE` | `live` |
| `ALPACA_PAPER` | `false` |
| `ALPACA_BASE_URL` | `https://api.alpaca.markets` |
| Instance size (most services) | `professional-xs` |
| xstockstrat-config instance size | `professional-s` (WatchConfig streaming above 60s idle timeout requirement) |
| Database | Managed PostgreSQL (production-tier cluster) |

> **Why `professional-s` for xstockstrat-config?** The `WatchConfig` gRPC streaming RPC holds long-lived connections. App Platform's HTTP proxy enforces a 60-second idle timeout on `basic-*` and `professional-xs` plans; `professional-s` raises this limit, preventing premature stream termination for subscribers.

---

## Step 7 — Set Secret Environment Variables

The app YAML files contain non-secret environment variables only. Secrets must be set separately so they are never committed to git.

Secrets to set on **both** dev and prod apps:

### Alpaca credentials
Set on: `xstockstrat-trading`, `xstockstrat-marketdata`, `xstockstrat-ingest`

```bash
doctl apps update $DO_DEV_APP_ID \
  --set-env ALPACA_API_KEY=<your-paper-key> \
  --set-env ALPACA_API_SECRET=<your-paper-secret>

doctl apps update $DO_PROD_APP_ID \
  --set-env ALPACA_API_KEY=<your-live-key> \
  --set-env ALPACA_API_SECRET=<your-live-secret>
```

Or via the console: **App → Settings → App-Level Environment Variables → Edit → Add Variable → check "Encrypt"**.

### JWT secret
Set on: `xstockstrat-identity`

```bash
# Must be at least 32 characters. Generate one:
openssl rand -base64 48
```

Set as `JWT_SECRET` on both apps (can use the same secret or separate ones per environment).

### n8n webhook secret
Set on all services that have webhook handlers (trading, marketdata, config, indicators, ingest, notify, ledger, identity, analysis, portfolio).

```bash
# Generate:
openssl rand -hex 32
```

Set as `N8N_WEBHOOK_SECRET`. Both dev and prod n8n workflows must use the matching value.

### OpenTelemetry (Grafana Cloud)
Set on all 13 services (or as app-level vars):

```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64-token>
```

See `docs/setup/grafana-cloud.md` for how to obtain these values.

---

## Step 8 — Attach the Database to the App

DigitalOcean must link the managed database to the app so that `${db.DATABASE_URL}` resolves correctly.

Via console:

1. **Apps → xstockstrat-prod (or dev) → Settings → Database**
2. Click **Attach Database**
3. Select **xstockstrat-db** (your managed cluster)
4. Component name must be `db` (matches the YAML spec: `databases: - name: db`)

Via doctl (alternative — the create spec should handle this automatically if the DB is in the same project):

```bash
doctl apps update $DO_PROD_APP_ID --spec .do/app.yaml
```

---

## Step 9 — Configure GitHub Actions Secrets

The CI/CD workflows need four repository secrets. Go to:
**GitHub → repository → Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Value | Used by |
|---|---|---|
| `DIGITALOCEAN_ACCESS_TOKEN` | The PAT created in Step 2 | deploy-dev, deploy-prod |
| `DO_DEV_APP_ID` | App ID of the dev app (from Step 5) | deploy-dev |
| `DO_PROD_APP_ID` | App ID of the prod app (from Step 6) | deploy-prod |
| `BUF_TOKEN` | Buf Schema Registry token (see below) | deploy-dev, deploy-prod |

`GITHUB_TOKEN` is automatically provided by GitHub Actions — no setup needed.

### Obtaining a BUF_TOKEN

1. Sign in at [buf.build](https://buf.build).
2. Go to **Settings → Tokens → Create token**.
3. Give it a name (e.g., `xstockstrat-ci`) and set expiry as appropriate.
4. Copy the token and add it as the `BUF_TOKEN` GitHub secret above.

The deploy workflows push proto definitions to the Buf Schema Registry on every deploy:
- `deploy-dev.yml` — publishes as a **draft** on push to `main-dev`
- `deploy-prod.yml` — publishes as **production** on push to `main`

**How the deployment secrets are used:**

- `.github/workflows/deploy-dev.yml` — triggers on push to `main-dev`:
  ```bash
  doctl apps update $DO_DEV_APP_ID --spec .do/app.dev.yaml
  # polls until ACTIVE or ERROR (15-minute timeout)
  ```
- `.github/workflows/deploy-prod.yml` — triggers on push to `main`:
  ```bash
  doctl apps update $DO_PROD_APP_ID --spec .do/app.yaml
  ```

---

## Step 10 — Database Migrations (Automated)

Migrations are now automated via the `db-migrator` App Platform Job defined in
`.do/app.yaml` / `.do/app.dev.yaml`. On every `doctl apps update` deploy, the
`PRE_DEPLOY` job runs `scripts/db-migrate.sh` (via `scripts/Dockerfile.migrate`)
before any service restarts. Only new migration files are applied — already-run
migrations are skipped because golang-migrate tracks state in a `schema_migrations`
table inside each service's schema.

**No manual action needed** for routine deployments.

### First-time setup on an existing database

If the managed database was already bootstrapped before migration tracking was
introduced (i.e., schemas exist but `schema_migrations` tables do not), seed the
version state once so the job doesn't re-apply old migrations:

```bash
# Use the connection string from DigitalOcean console → Databases → Connection Details
DATABASE_URL="postgresql://doadmin:<password>@<host>:25060/defaultdb?sslmode=require" \
  ./scripts/db-migrate.sh force
```

See `docs/runbooks/db-seed-migration-state.md` for the full one-time runbook.

### Monitoring migration job logs

```bash
doctl apps logs $DO_PROD_APP_ID --component db-migrator --follow
```

---

## Step 11 — Verify the Deployment

```bash
# List all apps
doctl apps list

# Get deployment status
doctl apps get $DO_DEV_APP_ID

# Tail logs for a specific service component
doctl apps logs $DO_DEV_APP_ID --component xstockstrat-config --follow

# Run the integration test suite against the deployed dev environment
# (update base URLs in integration-test.sh to point to DO public URLs first)
./scripts/integration-test.sh
```

**Expected startup sequence:**

1. `xstockstrat-config` starts first and connects to TimescaleDB
2. All other services start and call `WatchConfig` — they block until the handshake completes
3. `xstockstrat-marketdata` connects to Alpaca WebSocket and begins streaming
4. Frontend services (`xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui`) become available

Check public URLs for each service in: **DO console → App → service component → URL**.

---

## Troubleshooting

### WatchConfig subscribers disconnect immediately
The xstockstrat-config instance size is too small. Upgrade from `basic-s` to `professional-s` in the app spec and redeploy. See `.do/app.yaml` for the correct size.

### `${db.DATABASE_URL}` not resolving
The managed database is not attached to the app. See Step 8 — attach the DB cluster and redeploy.

### `${xstockstrat-config.PRIVATE_URL}` not resolving
Private networking only works between services **within the same App Platform app**. All 13 services must be in the same app (not separate apps). Confirm all services are listed under the same app ID.

### Deploy triggered by GitHub Actions fails with 403
The `DIGITALOCEAN_ACCESS_TOKEN` secret is missing or expired. Regenerate the PAT at DigitalOcean → API → Tokens and update the GitHub secret.

### Alpaca connection refused
Check that `ALPACA_API_KEY` and `ALPACA_API_SECRET` are set on the correct service components (trading, marketdata, ingest) and that the correct `ALPACA_BASE_URL` is configured for the environment (paper vs live).

### TimescaleDB extension not found
Run `CREATE EXTENSION IF NOT EXISTS timescaledb;` on the managed database before running migrations. See Step 3b.

---

## Branch → Deployment Reference

| Git Branch | App | Trading Mode | Alpaca Endpoint |
|---|---|---|---|
| `main-dev` | xstockstrat-dev | paper | paper-api.alpaca.markets |
| `main` | xstockstrat-prod | live | api.alpaca.markets |
| `feature/*` | none (CI tests only) | — | — |

Never push directly to `main-dev` or `main` — always use PRs. See `docs/runbooks/feature-workflow.md`.
