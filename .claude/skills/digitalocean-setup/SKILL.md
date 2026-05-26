---
name: digitalocean-setup
description: Interactive DigitalOcean App Platform first-time setup — doctl auth, managed DB, dev/prod apps, secrets, GitHub Actions wiring, and deployment verification.
argument-hint: [step-number 1–9]
allowed-tools: Read Edit Bash(doctl *) Bash(gh *) Bash(openssl *) Bash(git *) Bash(sed *) Bash(grep *) Bash(awk *) Bash(cat *) Bash(bash *) Bash(command -v *) Bash(python3 *) Bash(./scripts/do-setup-check.sh)
effort: medium
---

# /digitalocean-setup — DigitalOcean App Platform Setup

Walk the developer through every step of first-time DigitalOcean App Platform setup. Detect what is already done and skip completed phases. Never write secrets to any file — hold them in working context only and pass directly to `doctl` / `gh` via in-memory pipes.

**With a step argument** (e.g. `/digitalocean-setup 4`): jump directly to that phase, skip P0 detection.
**No argument**: run P0 detection, build the skip map, then execute all pending phases in order.

---

## Boot Sequence

Resolve repo root:

```bash
git rev-parse --show-toplevel
```

Store as `REPO_ROOT`. All subsequent file reads and command invocations use this absolute path.

---

## P0 — Detect Current State

Run the state inspector:

```bash
cd "$REPO_ROOT" && ./scripts/do-setup-check.sh
```

Parse its output to build a per-phase skip map:

| Phase | Skip condition |
|---|---|
| P1 (doctl auth) | `doctl auth list` shows `(current)` |
| P2 (create DB) | `doctl databases list` output contains `xstockstrat` |
| P3 (connect GitHub) | At least one DO app exists (implies GitHub OAuth was completed) |
| P4 (create dev app) | An app sourced from `main-dev` branch exists in `doctl apps list` |
| P5 (create prod app) | An app sourced from `main` branch exists in `doctl apps list` |
| P6 (set DO secrets) | Ask the user: "Have you already set Alpaca/JWT secrets on both DO apps? (y/n)" |
| P7 (attach DB) | `doctl apps get $DEV_APP_ID` output contains a `db` component |
| P8 (GitHub secrets) | `gh secret list` shows all six: `DIGITALOCEAN_ACCESS_TOKEN`, `DO_DEV_APP_ID`, `DO_PROD_APP_ID`, `DO_DEV_PROJECT_ID`, `DO_PROD_PROJECT_ID`, `BUF_TOKEN` |
| P9 (verify) | Never skipped — always run |

Print a checklist before starting any phase:

```
P1 ✓  doctl authenticated
P2 ✓  database xstockstrat-db found
P3 →  connect GitHub to DigitalOcean
P4 →  create dev app
...
```

Capture any App IDs found in `doctl apps list` output now and keep them in working context for later phases.

Also capture any existing Project IDs from `doctl projects list` that match `xstockstrat-staging` and `xstockstrat-production` — store as `DEV_PROJECT_ID` and `PROD_PROJECT_ID` if found. These will be used in P4/P5 (skipping project creation if already present) and stored as GitHub Secrets in P8.

---

## P1 — Install & Authenticate doctl

**Skip if**: `doctl auth list` shows `(current)`.

1. Check if `doctl` is installed:

```bash
command -v doctl
```

2. If missing, show install command:
   - macOS: `brew install doctl`
   - Linux: `sudo snap install doctl`

3. Authenticate:

```bash
doctl auth init
```

Prompt the user: "Paste your DigitalOcean Personal Access Token (Read + Write scopes). You can create one at https://cloud.digitalocean.com/account/api/tokens"

4. Verify:

```bash
doctl auth list
```

Confirm the output shows a context marked `(current)` before proceeding.

---

## P2 — Create Managed PostgreSQL Database

**Skip if**: `doctl databases list` output contains `xstockstrat`.

1. Show the exact creation command and ask the user to confirm before running:

```bash
doctl databases create xstockstrat-db \
  --engine pg \
  --version 15 \
  --region nyc1 \
  --size db-s-1vcpu-1gb \
  --num-nodes 1
```

2. After creation, verify:

```bash
doctl databases list
```

3. Enable TimescaleDB. Ask the user to paste their database connection string (from the DO console: Databases → xstockstrat-db → Connection Details → URI), then show:

```bash
psql "$CONNECTION_STRING" -c 'CREATE EXTENSION IF NOT EXISTS timescaledb;'
```

Note: the connection string will be needed again in P7 when attaching the database to the apps.

---

## P3 — Connect GitHub to DigitalOcean (Browser Step)

**Skip if**: at least one DO app already exists (OAuth was completed previously).

This is a browser-only OAuth step — no CLI command can perform it.

Walk the user through:

1. Go to: DigitalOcean Console → **Apps** → **New App** → **GitHub** → **Authorize DigitalOcean**
2. After authorization, select repository: `<your-org>/xstockstrat-orchestration`
3. Do NOT complete the app creation wizard here — just confirm the OAuth is done and close that tab

Ask the user to confirm they have completed the GitHub authorization before proceeding.

---

## P4 — Create Dev App (Paper Trading)

**Skip if**: `doctl apps list` shows an app whose source branch is `main-dev`.

1. Ask the user for their GitHub org name (e.g. `davcs86`). Store as `GH_ORG`.

2. Create (or locate) the dev DO project — reuse `DEV_PROJECT_ID` from P0 if already captured:

```bash
DEV_PROJECT_ID=$(doctl projects list --format ID,Name --no-header \
  | awk '/xstockstrat-staging/ {print $1}')

if [ -z "$DEV_PROJECT_ID" ]; then
  DEV_PROJECT_ID=$(doctl projects create \
    --name xstockstrat-staging \
    --purpose "xstockstrat development environment" \
    --format ID --no-header)
fi
echo "Dev Project ID: $DEV_PROJECT_ID"
```

Display the project ID prominently:

```
Dev Project ID: <id>   ← copy this — you will need it in Phase 8
```

Store as `DEV_PROJECT_ID` in working context.

3. Substitute the org placeholder and create the app — pipe directly, no temp file:

```bash
sed "s|YOUR_GITHUB_ORG|${GH_ORG}|g" "$REPO_ROOT/.do/app.dev.yaml" \
  | doctl apps create --spec /dev/stdin
```

4. Capture the App ID from the output. Display it prominently:

```
Dev App ID: <id>   ← copy this — you will need it in Phase 8
```

Store as `DEV_APP_ID` in working context.

5. Assign the app to the dev project:

```bash
doctl projects resources assign "$DEV_PROJECT_ID" \
  --resource "do:app:$DEV_APP_ID"
```

6. Verify:

```bash
doctl apps list | grep xstockstrat
```

---

## P5 — Create Prod App (Live Trading)

**Skip if**: `doctl apps list` shows an app whose source branch is `main`.

1. Use the same `GH_ORG` captured in P4 (or re-ask if jumping directly to this phase).

2. Create (or locate) the prod DO project — reuse `PROD_PROJECT_ID` from P0 if already captured:

```bash
PROD_PROJECT_ID=$(doctl projects list --format ID,Name --no-header \
  | awk '/xstockstrat-production/ {print $1}')

if [ -z "$PROD_PROJECT_ID" ]; then
  PROD_PROJECT_ID=$(doctl projects create \
    --name xstockstrat-production \
    --purpose "xstockstrat production environment" \
    --format ID --no-header)
fi
echo "Prod Project ID: $PROD_PROJECT_ID"
```

Display the project ID prominently:

```
Prod Project ID: <id>   ← copy this — you will need it in Phase 8
```

Store as `PROD_PROJECT_ID` in working context.

3. Create the prod app:

```bash
sed "s|YOUR_GITHUB_ORG|${GH_ORG}|g" "$REPO_ROOT/.do/app.yaml" \
  | doctl apps create --spec /dev/stdin
```

4. Capture and display the Prod App ID:

```
Prod App ID: <id>   ← copy this — you will need it in Phase 8
```

Store as `PROD_APP_ID` in working context.

5. Assign the app to the prod project:

```bash
doctl projects resources assign "$PROD_PROJECT_ID" \
  --resource "do:app:$PROD_APP_ID"
```

---

## P6 — Collect and Apply Secret Environment Variables

**Skip if**: user confirms secrets are already set on both apps.

**Secrets are never written to any file.** All values are collected into shell variables in working context and piped directly to `doctl` — nothing touches disk.

### Collect secrets

**Generate locally:**

```bash
JWT_SECRET=$(openssl rand -base64 48)
```

Display the generated value so the user can record it externally if needed.

**Ask the user for:**
- `DEV_ALPACA_KEY` — paper trading API key from alpaca.markets (see `docs/setup/alpaca.md`)
- `DEV_ALPACA_SECRET` — matching paper trading secret
- `PROD_ALPACA_KEY` — live trading API key
- `PROD_ALPACA_SECRET` — matching live trading secret
- `DO_TOKEN` — DigitalOcean Personal Access Token (same one used in P1, or a new one with Read + Write scopes)

**Optional — OTEL (Grafana Cloud):**

Ask: "Do you have Grafana Cloud OTLP credentials? (y/n — you can add them later via `docs/setup/grafana-cloud.md`)"

- If yes: collect both values together (they are tightly coupled — neither works without the other):
  - `OTEL_ENDPOINT` — the OTLP gateway URL, e.g. `https://otlp-gateway-<region>.grafana.net/otlp`
  - `OTEL_HEADERS` — the Authorization header value: `Basic <base64(instanceId:apiKey)>` (Grafana provides the pre-encoded string)
- If no: skip and note OTel can be wired later — see `docs/setup/grafana-cloud.md`

Both `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` are the same for dev and prod apps (same Grafana Cloud stack). When provided, apply them to both app specs.

### Apply to dev app — secrets stay in memory, never touch disk

```bash
python3 << PYEOF | doctl apps update "$DEV_APP_ID" --spec /dev/stdin
import re, os

content = open('$REPO_ROOT/.do/app.dev.yaml').read()
content = content.replace('YOUR_GITHUB_ORG', os.environ['GH_ORG'])

# Inject value: "" vars (ALPACA, JWT) — match existing empty-value pattern
for key, val in [
    ('ALPACA_API_KEY',    os.environ['DEV_ALPACA_KEY']),
    ('ALPACA_API_SECRET', os.environ['DEV_ALPACA_SECRET']),
    ('JWT_SECRET',        os.environ['JWT_SECRET']),
]:
    content = re.sub(
        r'(key: ' + key + r'\n(?:.*\n)*?.*?value: )""',
        r'\g<1>"' + val + '"',
        content
    )

# Inject OTEL vars — these have scope: RUN_TIME but no value: field; insert it
otel_endpoint = os.environ.get('OTEL_ENDPOINT', '')
otel_headers  = os.environ.get('OTEL_HEADERS', '')
if otel_endpoint:
    content = re.sub(
        r'(- key: OTEL_EXPORTER_OTLP_ENDPOINT\n    scope: RUN_TIME)',
        r'\1\n    value: "' + otel_endpoint + '"',
        content
    )
if otel_headers:
    content = re.sub(
        r'(- key: OTEL_EXPORTER_OTLP_HEADERS\n    scope: RUN_TIME\n    type: SECRET)',
        r'\1\n    value: "' + otel_headers + '"',
        content
    )

print(content)
PYEOF
```

Repeat for the prod app using `PROD_ALPACA_KEY` / `PROD_ALPACA_SECRET` and `$PROD_APP_ID` (same `OTEL_ENDPOINT` / `OTEL_HEADERS` — same Grafana Cloud stack).

Verify each `doctl apps update` exits 0 before proceeding.

---

## P7 — Attach Database to App(s) (Browser Step)

**Skip if**: `doctl apps get $DEV_APP_ID` output contains a `db` component.

This step requires the DO console — `doctl` cannot attach a managed database to an existing app.

Walk the user through (repeat for both dev and prod apps):

1. DO Console → **Apps** → select `xstockstrat-staging` (or `xstockstrat-production`)
2. **Settings** → **App-Level Environment Variables** — note the `${db.DATABASE_URL}` placeholder is already in the spec
3. **Components** → select any component → **Attach Database**
4. Choose `xstockstrat-db` → set component name to exactly **`db`** (required — `${db.DATABASE_URL}` injection depends on this name)
5. Save

Verify after the user confirms:

```bash
doctl apps get "$DEV_APP_ID" --output json | grep -i "database"
```

---

## P8 — Configure GitHub Actions Secrets

**Skip if**: `gh secret list` shows all six required secrets.

By this point you have in working context:
- `DEV_APP_ID` and `PROD_APP_ID` — from P4/P5
- `DEV_PROJECT_ID` and `PROD_PROJECT_ID` — from P4/P5
- `DO_TOKEN` — from P6

Ask the user for:
- `BUF_TOKEN` — from buf.build → Settings → Tokens (needed for Buf Schema Registry pushes)
- `GH_PAT_SCAN` (optional) — GitHub PAT with `repo` read scope for TruffleHog secret scanning

Apply all secrets:

```bash
gh secret set DIGITALOCEAN_ACCESS_TOKEN --body "$DO_TOKEN"
gh secret set DO_DEV_APP_ID             --body "$DEV_APP_ID"
gh secret set DO_PROD_APP_ID            --body "$PROD_APP_ID"
gh secret set DO_DEV_PROJECT_ID         --body "$DEV_PROJECT_ID"
gh secret set DO_PROD_PROJECT_ID        --body "$PROD_PROJECT_ID"
gh secret set BUF_TOKEN                 --body "$BUF_TOKEN"
```

If `GH_PAT_SCAN` was provided:

```bash
gh secret set GH_PAT_SCAN --body "$GH_PAT_SCAN"
```

Verify each command exits 0. Then confirm:

```bash
gh secret list
```

All six required secrets should appear.

---

## P9 — Verify Deployment

**Never skipped.**

1. Ask the user to push a commit to `main-dev` to trigger the dev deploy (or check if a recent deployment is already running).

2. Monitor the deployment:

```bash
doctl apps list-deployments "$DEV_APP_ID" --format Phase,Progress,CreatedAt
```

3. Show how to tail logs for the critical first service:

```bash
doctl apps logs "$DEV_APP_ID" --component xstockstrat-config --follow
```

4. Expected sequence: `xstockstrat-config` starts first → all other services connect to WatchConfig within ~2 minutes.

5. Print a final success checklist:

```
Setup complete!

  ✓ doctl authenticated
  ✓ Managed PostgreSQL created (xstockstrat-db) with TimescaleDB enabled
  ✓ GitHub connected to DigitalOcean
  ✓ Dev app created  (App ID: <DEV_APP_ID>, Project ID: <DEV_PROJECT_ID>)
  ✓ Prod app created (App ID: <PROD_APP_ID>, Project ID: <PROD_PROJECT_ID>)
  ✓ Secrets applied to both apps
  ✓ Database attached to both apps
  ✓ GitHub Actions secrets configured (6 required: DIGITALOCEAN_ACCESS_TOKEN, DO_DEV_APP_ID, DO_PROD_APP_ID, DO_DEV_PROJECT_ID, DO_PROD_PROJECT_ID, BUF_TOKEN)
  ✓ First deployment verified

Next steps:
  • Review docs/setup/grafana-cloud.md to wire up observability
  • Review docs/setup/alpaca.md to verify Alpaca connectivity
  • Push to main to trigger the prod deployment
```
