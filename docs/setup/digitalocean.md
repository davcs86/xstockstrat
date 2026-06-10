# DigitalOcean Account & App Platform Setup

## Quick start — interactive skill (recommended)

Run the following in a Claude Code session to be guided through every step interactively:

```
/digitalocean-setup
```

The skill detects what is already done via live `doctl` and `gh` queries, skips completed steps,
and uses `gh secret set` to wire GitHub Actions secrets automatically.
Resume from a specific step with `/digitalocean-setup <step-number>` (1–9).

The manual steps below are kept as a reference for edge cases and troubleshooting.

---

This runbook walks through creating and configuring the DigitalOcean infrastructure that hosts all 13 xstockstrat services. Two App Platform deployments exist — one for paper trading (dev, `main-dev` branch) and one for live trading (prod, `main` branch).

---

## Overview

| Resource | Purpose |
|---|---|
| App Platform (staging) | Hosts all 13 services; paper trading; deploys from `main-dev` |
| App Platform (production) | Hosts all 13 services; live trading; deploys from `main` |
| Managed PostgreSQL 15 (×1) | Single TimescaleDB cluster (`xstockstrat`) with two logical databases: `xstockstrat-staging` and `xstockstrat-production` |
| GitHub Actions | CI/CD; auto-deploys on push to `main-dev` or `main` via `doctl` |

Architecture spec files:
- `.do/app.dev.yaml` — staging app definition (paper trading, `basic-xxs`/`basic-xs` instances)
- `.do/app.yaml` — production app definition (live trading, `basic-xs` / `basic-s` instances)

> **Sizing:** Both apps run on the Basic tier. See
> `docs/runbooks/infra-cost-reduction.md` for the per-service slug map and
> sizing constraints.

---

## Key Identifiers

Two separate IDs are needed for each environment. They serve different purposes and come from different places.

| Identifier | What it is | How it's created | Where it's used |
|---|---|---|---|
| **App ID** (`DO_DEV_APP_ID`, `DO_PROD_APP_ID`) | Identifies a specific App Platform application — the deployed unit containing all services, workers, and jobs defined in the app spec | Returned by `doctl apps create` | `doctl apps update`, `doctl apps list-deployments`, `doctl apps logs` — everything that interacts with the running app |
| **Project ID** (`DO_DEV_PROJECT_ID`, `DO_PROD_PROJECT_ID`) | Identifies a DO Project — an organizational folder that groups resources across any DO product (apps, databases, droplets, etc.) for billing and console grouping | Returned by `doctl projects create` | `doctl projects resources assign` — to place the app into a project; has no effect on how the app runs |

The relationship looks like this:

```
DO Project (xstockstrat-staging)        ← identified by DO_DEV_PROJECT_ID
  └── App (xstockstrat-staging)         ← identified by DO_DEV_APP_ID
        ├── service: xstockstrat-trading
        ├── service: xstockstrat-config
        ├── ...
        └── database: db
```

**Important:** the DO app spec (`app.yaml`) has no `project_id` field — DO does not support setting project membership in the spec YAML. Project assignment is always a separate CLI call after the app exists:

```bash
doctl projects resources assign "$PROJECT_ID" --resource "do:app:$APP_ID"
```

The deploy workflow (`.github/workflows/deploy.yml`) runs this step automatically on every deploy using the `DO_DEV_PROJECT_ID` / `DO_PROD_PROJECT_ID` GitHub secrets.

---

## Prerequisites

- GitHub repo `<your-org>/xstockstrat` is your source of truth
- You have already cloned the repo locally and have `.env.example` ready to copy
- `doctl` CLI installed (see Step 2)
- `gh` CLI installed and authenticated (`gh auth login`)
- All Alpaca credentials ready (see `docs/setup/alpaca.md`)
- All Grafana Cloud OTLP credentials ready (see `docs/setup/grafana-cloud.md`)

---

## Step 1 — Create a DigitalOcean Account

1. Go to **digitalocean.com** and click **Sign Up**.
2. Complete email verification.
3. Add a payment method (credit card or PayPal). DigitalOcean charges by usage — both apps run Basic-tier instances (`basic-xxs`/`basic-xs`/`basic-s`); see `docs/runbooks/infra-cost-reduction.md` for sizing.
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

## Step 3 — Create the Managed PostgreSQL Database Cluster

A single PostgreSQL 15 cluster (`xstockstrat`) hosts two logical databases — `xstockstrat-staging` and `xstockstrat-production`. Both environments share CPU, RAM, and IOPS, but data is fully isolated at the database level.

| Environment | Cluster | Database | App spec reference |
|---|---|---|---|
| Staging (dev) | `xstockstrat` | `xstockstrat-staging` | `.do/app.dev.yaml` (`cluster_name: xstockstrat`, `db_name: xstockstrat-staging`) |
| Production | `xstockstrat` | `xstockstrat-production` | `.do/app.yaml` (`cluster_name: xstockstrat`, `db_name: xstockstrat-production`) |

### 3a. Create the cluster

Via console: **Databases → Create Database**

```
Engine:  PostgreSQL 15
Region:  NYC1 (matches app.yaml region: nyc)
Name:    xstockstrat
Plan:    Production (shared by both environments — size up accordingly)
```

Or via doctl:

```bash
doctl databases create xstockstrat \
  --engine pg \
  --version 15 \
  --region nyc1 \
  --size db-s-2vcpu-4gb \
  --num-nodes 2
```

Wait for the cluster to become **online** (3–5 minutes).

### 3b. Create the two databases inside the cluster

```bash
# Retrieve the cluster ID
CLUSTER_ID=$(doctl databases list --no-header --format ID,Name | awk '/xstockstrat/{print $1}')

doctl databases db create $CLUSTER_ID xstockstrat-staging
doctl databases db create $CLUSTER_ID xstockstrat-production
```

Or via console: **Databases → xstockstrat → Users & Databases → Databases tab → Add database** (repeat for each).

### 3c. Enable the TimescaleDB extension on both databases

Connect to each database using its connection string from **Databases → xstockstrat → Connection Details** (select the database from the dropdown):

```bash
psql "postgresql://doadmin:<password>@<host>:25060/xstockstrat-staging?sslmode=require"
```

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
-- Verify:
SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';
```

Repeat for `xstockstrat-production`.

> **Important:** The TimescaleDB extension must be enabled on **each database** before running `scripts/db-migrate.sh`. All hypertable creation in the migrations depends on this extension.

### 3d. Note the connection strings

DigitalOcean injects the correct per-database `DATABASE_URL` into each app once the cluster is attached with a `db_name` (Step 8). The URL will point to the specific database, not `defaultdb`.

---

## Step 4 — Connect GitHub to DigitalOcean

App Platform pulls code from GitHub. Authorize once:

1. DigitalOcean console → **Apps → Create App**
2. Source: **GitHub** → **Authorize DigitalOcean** (grants read access to repos)
3. Select repo: `<your-org>/xstockstrat`

You do not need to complete the app creation wizard — cancel after authorization. The actual app creation is done via `doctl` in Step 5.

---

## Step 4.5 — Make GHCR Packages Public

All Docker images are pushed to GitHub Container Registry (GHCR) at `ghcr.io/davcs86/xstockstrat/<service>` by the CI `docker-build` job on every push to `main-dev` or `main`. App Platform pulls them using `registry_type: GHCR` in the app spec — no separate registry credential is needed when packages are public.

After the first CI push runs (Step 9 triggers it), make all 15 packages public so DO App Platform can pull without credentials:

1. Go to **GitHub → davcs86 → Packages**
2. For each `xstockstrat-<service>` package → **Package settings → Change visibility → Public**

> **Tip:** Packages are created automatically on first push. Run the first CI job (push to `main-dev` after Step 9) before attempting to change visibility.

---

## Step 5 — Create the Dev App (Paper Trading)

The dev app deploys from `main-dev`, runs all services in `TRADING_MODE=paper`, and uses cheaper `basic-xs` instances.

> **Prerequisite:** Push to `main-dev` first and wait for the CI `docker-build` job to complete before running `doctl apps create`. The app spec references GHCR images by commit SHA; the first deploy will fail if no images have been pushed yet.

The app spec contains `YOUR_GITHUB_ORG` and `YOUR_IMAGE_TAG` as placeholders. In normal CI-driven deploys these are substituted automatically by the deploy workflow. For the initial manual creation, substitute only `YOUR_GITHUB_ORG` — the CI workflow handles the image tag on subsequent deploys:

```bash
sed "s|YOUR_GITHUB_ORG|<your-github-org>|g" .do/app.dev.yaml > /tmp/app.dev.yaml
doctl apps create --spec /tmp/app.dev.yaml
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
| Instance size (Go/Node services) | `basic-xxs` (512 MB — `trading`, `portfolio`, `marketdata`, `ledger`, `identity`, `notify`) |
| Instance size (Python/UI services) | `basic-xs` (1 GB — `indicators`, `ingest`, `analysis`, `agent`, `ui`) |
| xstockstrat-config instance size | `basic-s` (WatchConfig streaming needs more headroom) |
| Database | Managed PostgreSQL attached as `db` |

Inter-service routing uses DigitalOcean private networking: `${xstockstrat-config.PRIVATE_URL}`, `${xstockstrat-ledger.PRIVATE_URL}`, etc. These resolve automatically within the App Platform private network — no manual configuration needed.

---

## Step 6 — Create the Prod App (Live Trading)

The prod app deploys from `main`, runs all services in `TRADING_MODE=live`, and uses `basic-xs` instances (`basic-s` for `xstockstrat-config`, which needs the raised idle timeout for `WatchConfig` streaming).

> **Prerequisite:** Ensure CI has pushed images to GHCR from the `main` branch before creating the prod app. Check `https://github.com/davcs86?tab=packages` or the `docker-build` workflow run. The first CI push happens automatically when `main-dev` is promoted via the `/promote` workflow.

Substitute `YOUR_GITHUB_ORG` before creating:

```bash
sed "s|YOUR_GITHUB_ORG|<your-github-org>|g" .do/app.yaml > /tmp/app.yaml
doctl apps create --spec /tmp/app.yaml
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
| Instance size (most services) | `basic-xs` |
| xstockstrat-config instance size | `basic-s` (WatchConfig streaming above 60s idle timeout requirement) |
| Database | Managed PostgreSQL (production-tier cluster) |

> **Why `basic-s` for xstockstrat-config?** The `WatchConfig` gRPC streaming RPC holds long-lived connections. App Platform's HTTP proxy enforces a 60-second idle timeout on `*-xs` plans; the `*-s` sizes raise this limit, preventing premature stream termination for subscribers.

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

### MCP agent secret
Set on: `xstockstrat-agent`

```bash
# Generate:
openssl rand -hex 32
```

Set as `MCP_AGENT_SECRET` on both apps. The same value must be configured in
`xstockstrat-ingest`, `xstockstrat-notify`, and `xstockstrat-analysis` once Step 12
(x-mcp-secret enforcement) is deployed. Leave empty to skip header enforcement.

```bash
doctl apps update $DO_DEV_APP_ID \
  --set-env MCP_AGENT_SECRET=<your-secret>

doctl apps update $DO_PROD_APP_ID \
  --set-env MCP_AGENT_SECRET=<your-secret>
```

### Broker accounts encryption key
Set on: `xstockstrat-trading`

AES-256 key for encrypting broker credentials stored in the `broker_accounts` table. Must be a hex-encoded 32-byte value (64 hex characters).

This key is injected at deploy time via GitHub Actions secrets (not via `doctl apps update --set-env`) because `doctl apps update --spec` resets DO UI-set secrets to empty on each deploy. Store separate values for dev and prod.

```bash
# Generate — use different values for dev and prod:
openssl rand -hex 32   # → DEV_BROKER_ACCOUNTS_ENCRYPTION_KEY
openssl rand -hex 32   # → PROD_BROKER_ACCOUNTS_ENCRYPTION_KEY
```

Add both as GitHub Actions secrets (see Step 9). The deploy workflows substitute them into the app spec at deploy time via the `YOUR_DEV_BROKER_ACCOUNTS_ENCRYPTION_KEY` / `YOUR_PROD_BROKER_ACCOUNTS_ENCRYPTION_KEY` placeholders.

Required when the `broker_accounts` table is in use. Rotating this key requires re-encrypting all existing rows — do not change it after accounts have been stored.

### OpenTelemetry (Grafana Cloud)
Set on all 13 services (or as app-level vars):

```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64-token>
```

See `docs/setup/grafana-cloud.md` for how to obtain these values.

---

## Step 8 — Attach the Database Cluster to Both Apps

Both apps reference the same cluster (`xstockstrat`) but with different `db_name` values — `xstockstrat-staging` for the dev app and `xstockstrat-production` for the prod app. DigitalOcean injects a database-scoped `DATABASE_URL` into each app automatically.

| App | Cluster | Database |
|---|---|---|
| `xstockstrat-staging` | `xstockstrat` | `xstockstrat-staging` |
| `xstockstrat-production` | `xstockstrat` | `xstockstrat-production` |

The app specs already declare `cluster_name: xstockstrat` and `db_name` for each environment, so `doctl apps update` will wire them automatically once the cluster exists.

Via doctl:

```bash
doctl apps update $DO_DEV_APP_ID  --spec .do/app.dev.yaml
doctl apps update $DO_PROD_APP_ID --spec .do/app.yaml
```

Via console (if the spec-based attach fails):

1. **Apps → \<app\> → Settings → Database**
2. Click **Attach Database**
3. Select the cluster `xstockstrat`
4. Set **Database** to `xstockstrat-staging` (dev) or `xstockstrat-production` (prod)
5. Component name must be `db` (matches the YAML spec: `databases: - name: db`)

---

## Step 9 — Configure GitHub Actions Secrets

The CI/CD workflows need the following repository secrets. Go to:
**GitHub → repository → Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Value | Used by |
|---|---|---|
| `DIGITALOCEAN_ACCESS_TOKEN` | The PAT created in Step 2 | deploy-dev, deploy-prod (`doctl apps update`) |
| `DO_DEV_APP_ID` | App ID of the staging app (from Step 5) | deploy-dev |
| `DO_PROD_APP_ID` | App ID of the production app (from Step 6) | deploy-prod |
| `DO_DEV_PROJECT_ID` | Project ID of the staging DO project (from Step 5) | deploy-dev — assigns app to project on every deploy |
| `DO_PROD_PROJECT_ID` | Project ID of the production DO project (from Step 6) | deploy-prod — assigns app to project on every deploy |
| `BUF_TOKEN` | Buf Schema Registry token (see below) | deploy-dev, deploy-prod |
| `DEV_BROKER_ACCOUNTS_ENCRYPTION_KEY` | 64-char hex AES-256 key for staging (see Step 7) | deploy-dev — substituted into `.do/app.dev.yaml` at deploy time |
| `PROD_BROKER_ACCOUNTS_ENCRYPTION_KEY` | 64-char hex AES-256 key for production (see Step 7) | deploy-prod — substituted into `.do/app.yaml` at deploy time |

`GITHUB_TOKEN` is automatically provided by GitHub Actions for GHCR pushes — no setup needed.

See [Key Identifiers](#key-identifiers) above for the difference between App ID and Project ID.

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
4. `xstockstrat-ui` (consolidated frontend — trader, insights, config-ui segments) becomes available

Check public URLs for each service in: **DO console → App → service component → URL**.

---

## Troubleshooting

### WatchConfig subscribers disconnect immediately
The xstockstrat-config instance size is too small. It must be a `*-s` size (`basic-s`) so the App Platform proxy's idle timeout is raised above 60s; an `*-xs` size will sever long-lived `WatchConfig` streams. See `.do/app.yaml` for the correct size.

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

### Deploy fails with "image not found" or "repository does not exist"
The `docker-build` CI job has not yet pushed images for this commit SHA. Push to `main-dev` (or `main`) and wait for the CI `docker-build` job to complete before retrying the deploy. Confirm images exist by checking `https://github.com/davcs86?tab=packages`.

If the GHCR packages are private, App Platform cannot pull them. Make all 15 packages public — see Step 4.5.

### `docker compose pull` fails with "unauthorized"
The GHCR packages are private. Either make them public (see Step 4.5) or authenticate the local Docker daemon:
```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u davcs86 --password-stdin
```
Re-run `docker compose pull` after authenticating.

---

## Branch → Deployment Reference

| Git Branch | App | Trading Mode | Alpaca Endpoint |
|---|---|---|---|
| `main-dev` | xstockstrat-staging | paper | paper-api.alpaca.markets |
| `main` | xstockstrat-production | live | api.alpaca.markets |
| `feature/*` | none (CI tests only) | — | — |

Never push directly to `main-dev` or `main` — always use PRs. See `docs/runbooks/feature-workflow.md`.
