---
name: digitalocean-setup
description: Interactive DigitalOcean App Platform first-time setup — doctl auth, managed DB, dev/prod apps, secrets, GitHub Actions wiring, and deployment verification.
argument-hint: [step-number 1–9 or 4.5 for DOCR registry]
allowed-tools: Read Edit Bash(doctl *) Bash(gh *) Bash(openssl *) Bash(git *) Bash(sed *) Bash(grep *) Bash(awk *) Bash(cat *) Bash(bash *) Bash(command -v *) Bash(python3 *) Bash(./scripts/do-setup-check.sh) Bash(uname *) Bash(brew *) Bash(snap *) Bash(apt-get *) Bash(apt *) Bash(curl *) Bash(tar *) Bash(chmod *) Bash(sudo apt*) Bash(sudo snap*) Bash(sudo chmod*) Bash(sudo dd*) Bash(sudo tee*) Bash(sudo apt-get*) Bash(which *)
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

## P0 — Prerequisites & Detect Current State

P0 has two sub-steps that always run: **P0a** installs and authenticates the required CLI tools; **P0b** runs the state inspector and builds the phase skip map.

### P0a — Install & Authenticate CLI Tools

#### Detect platform

```bash
OS=$(uname -s)   # Darwin = macOS, Linux = Linux
```

#### doctl

1. Check if installed:

```bash
command -v doctl
```

2. **If missing**, install based on platform:

- **macOS:**

  ```bash
  brew install doctl
  ```

- **Linux — try snap first:**

  ```bash
  sudo snap install doctl
  ```

  If `snap` is not available (`command -v snap` fails), fall back to direct binary download. Find the latest release tag, then:

  ```bash
  DOCTL_VERSION=$(curl -fsSL https://api.github.com/repos/digitalocean/doctl/releases/latest \
    | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')
  curl -fsSL "https://github.com/digitalocean/doctl/releases/download/v${DOCTL_VERSION}/doctl-${DOCTL_VERSION}-linux-amd64.tar.gz" \
    | tar -xz
  sudo mv doctl /usr/local/bin/
  ```

  If the download produces a zero-byte file or the network request fails, stop and display:

  ```
  ✗ Could not install doctl automatically — network access to GitHub releases appears blocked.
    Please install doctl manually on your local machine:
      macOS: brew install doctl
      Linux: https://docs.digitalocean.com/reference/doctl/how-to/install/
    Then re-run /digitalocean-setup.
  ```

  Do not proceed until `command -v doctl` succeeds.

3. Verify installation:

```bash
doctl version
```

4. **Check authentication:**

```bash
doctl auth list 2>/dev/null | grep -q "(current)"
```

5. **If not authenticated**, prompt:

> "Paste your DigitalOcean Personal Access Token (Read + Write scopes). You can create one at https://cloud.digitalocean.com/account/api/tokens"

Then authenticate non-interactively using the token the user provides:

```bash
doctl auth init --access-token "$DO_TOKEN"
```

Store the token as `DO_TOKEN` in working context — it will be reused in P6 and P8.

6. Verify authentication:

```bash
doctl auth list
```

Confirm a context is marked `(current)` before continuing. If authentication fails, display the error and halt.

---

#### gh (GitHub CLI)

1. Check if installed:

```bash
command -v gh
```

2. **If missing**, install based on platform:

- **macOS:**

  ```bash
  brew install gh
  ```

- **Linux — try apt first (official GitHub CLI apt repo):**

  ```bash
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
  sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
  sudo apt-get update && sudo apt-get install gh -y
  ```

  If apt fails or is unavailable, fall back to direct binary download:

  ```bash
  GH_VERSION=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest \
    | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')
  curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
    | tar -xz
  sudo mv "gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/
  ```

  If the download fails or produces a zero-byte file, stop and display:

  ```
  ✗ Could not install gh automatically — network access to GitHub releases appears blocked.
    Please install the GitHub CLI manually on your local machine:
      macOS: brew install gh
      Linux: https://github.com/cli/cli/blob/trunk/docs/install_linux.md
    Then re-run /digitalocean-setup.
  ```

  Do not proceed until `command -v gh` succeeds.

3. Verify installation:

```bash
gh --version
```

4. **Check authentication:**

```bash
gh auth status 2>/dev/null
```

5. **If not authenticated**, run the interactive login flow:

```bash
gh auth login
```

Select **GitHub.com** → **HTTPS** → **Login with a web browser** (or token if browser is unavailable). Wait for the user to complete the flow.

6. Verify authentication:

```bash
gh auth status
```

Confirm output includes `Logged in to github.com`. If it fails, display the error and halt.

---

#### P0a summary

Print a tool readiness checklist before moving to P0b:

```
Tool prerequisites:
  ✓ doctl X.Y.Z — authenticated (context: <name>)
  ✓ gh X.Y.Z    — authenticated (github.com as <username>)
```

If either tool is missing or unauthenticated after the install/auth attempts, halt with a clear message and do not proceed to P0b.

---

### P0b — Detect Current State

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
| P4.5 (create DOCR registry) | `doctl registry get` succeeds (registry already exists) |
| P5 (create prod app) | An app sourced from `main` branch exists in `doctl apps list` |
| P6 (set DO secrets) | Ask the user: "Have you already set Alpaca/JWT secrets on both DO apps? (y/n)" |
| P7 (attach DB) | `doctl apps get $DEV_APP_ID` output contains a `db` component |
| P8 (GitHub secrets) | `gh secret list` shows all seven: `DIGITALOCEAN_ACCESS_TOKEN`, `DO_REGISTRY_NAME`, `DO_DEV_APP_ID`, `DO_PROD_APP_ID`, `DO_DEV_PROJECT_ID`, `DO_PROD_PROJECT_ID`, `BUF_TOKEN` |
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

## P1 — Verify doctl Authentication

**Skip if**: `doctl auth list` shows `(current)` (P0a already handled this).

> P0a installs and authenticates `doctl` automatically. P1 only runs if a step argument was passed directly (skipping P0) and `doctl` is not yet authenticated.

1. Confirm `doctl` is installed:

```bash
command -v doctl || { echo "doctl not found — run /digitalocean-setup with no argument to install it."; exit 1; }
```

2. If not authenticated, prompt for the DigitalOcean Personal Access Token (Read + Write scopes) and authenticate:

```bash
doctl auth init --access-token "$DO_TOKEN"
```

Store the token as `DO_TOKEN` in working context.

3. Verify:

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

3. Substitute all placeholders and create the app — pipe directly, no temp file. Use `latest-dev` as the initial image tag; the CI deploy workflow will replace it with the real commit SHA on the first push:

```bash
sed \
  -e "s|YOUR_GITHUB_ORG|${GH_ORG}|g" \
  -e "s|YOUR_REGISTRY_NAME|${REGISTRY_NAME}|g" \
  -e "s|YOUR_IMAGE_TAG|latest-dev|g" \
  "$REPO_ROOT/.do/app.dev.yaml" \
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

## P4.5 — Create DOCR Container Registry

**Skip if**: `doctl registry get` exits 0 (a registry is already configured). If it exists, capture the slug:

```bash
REGISTRY_NAME=$(doctl registry get --format Name --no-header)
```

Store as `REGISTRY_NAME` in working context and skip the rest of P4.5.

1. Ask the user for the desired registry slug (default: `xstockstrat`). Store as `REGISTRY_NAME`.

2. Create the registry:

```bash
doctl registry create "$REGISTRY_NAME" --region nyc1 --subscription-tier basic
```

3. Verify:

```bash
doctl registry get
```

Display the registry slug prominently:

```
Registry slug: <slug>   ← this becomes the DO_REGISTRY_NAME GitHub secret in P8
```

> **Note:** The DOCR basic plan allows up to 5 repositories. The current app specs have 5 services configured to pull from DOCR (trader, insights, config-ui, identity, notify). If you upgrade to a higher-tier plan, additional services in the CI matrix will push automatically.

> **Note:** The CI `docker-build` job pushes images on every push to `main-dev` or `main`. App Platform pulls images using the same DO API token — no additional credential configuration is needed. The first deploy of the image-based services will fail if the CI job has not yet run; push to `main-dev` after P8 to seed the registry before creating or deploying the apps.

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

3. Create the prod app — substitute all placeholders. Use `latest` as the initial image tag; CI replaces it with the real SHA on every push to `main`:

```bash
sed \
  -e "s|YOUR_GITHUB_ORG|${GH_ORG}|g" \
  -e "s|YOUR_REGISTRY_NAME|${REGISTRY_NAME}|g" \
  -e "s|YOUR_IMAGE_TAG|latest|g" \
  "$REPO_ROOT/.do/app.yaml" \
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
DEV_BROKER_ACCOUNTS_ENCRYPTION_KEY=$(openssl rand -hex 32)
PROD_BROKER_ACCOUNTS_ENCRYPTION_KEY=$(openssl rand -hex 32)
```

Display all three generated values so the user can record them externally. Dev and prod use **different** `BROKER_ACCOUNTS_ENCRYPTION_KEY` values — rotating the key after broker accounts have been stored requires re-encrypting all existing rows.

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
content = content.replace('YOUR_GITHUB_ORG',    os.environ['GH_ORG'])
content = content.replace('YOUR_REGISTRY_NAME', os.environ['REGISTRY_NAME'])
content = content.replace('YOUR_IMAGE_TAG',     'latest-dev')
content = content.replace('YOUR_DEV_BROKER_ACCOUNTS_ENCRYPTION_KEY', os.environ['DEV_BROKER_ACCOUNTS_ENCRYPTION_KEY'])

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

Repeat for the prod app using `PROD_ALPACA_KEY` / `PROD_ALPACA_SECRET` and `$PROD_APP_ID` (same `OTEL_ENDPOINT` / `OTEL_HEADERS` — same Grafana Cloud stack). In the prod Python block, replace `'latest-dev'` with `'latest'`, `app.dev.yaml` with `app.yaml`, and replace the placeholder substitution line with:

```python
content = content.replace('YOUR_PROD_BROKER_ACCOUNTS_ENCRYPTION_KEY', os.environ['PROD_BROKER_ACCOUNTS_ENCRYPTION_KEY'])
```

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

**Skip if**: `gh secret list` shows all nine required secrets.

By this point you have in working context:
- `DEV_APP_ID` and `PROD_APP_ID` — from P4/P5
- `DEV_PROJECT_ID` and `PROD_PROJECT_ID` — from P4/P5
- `DO_TOKEN` — from P6
- `REGISTRY_NAME` — from P4.5 (the DOCR registry slug, e.g. `xstockstrat`)

If `REGISTRY_NAME` is not in working context (e.g., step was skipped), retrieve it:

```bash
REGISTRY_NAME=$(doctl registry get --format Name --no-header)
```

Ask the user for:
- `BUF_TOKEN` — from buf.build → Settings → Tokens (needed for Buf Schema Registry pushes)
- `GH_PAT_SCAN` (optional) — GitHub PAT with `repo` read scope for TruffleHog secret scanning

Apply all secrets:

```bash
gh secret set DIGITALOCEAN_ACCESS_TOKEN          --body "$DO_TOKEN"
gh secret set DO_REGISTRY_NAME                   --body "$REGISTRY_NAME"
gh secret set DO_DEV_APP_ID                      --body "$DEV_APP_ID"
gh secret set DO_PROD_APP_ID                     --body "$PROD_APP_ID"
gh secret set DO_DEV_PROJECT_ID                  --body "$DEV_PROJECT_ID"
gh secret set DO_PROD_PROJECT_ID                 --body "$PROD_PROJECT_ID"
gh secret set BUF_TOKEN                          --body "$BUF_TOKEN"
gh secret set DEV_BROKER_ACCOUNTS_ENCRYPTION_KEY  --body "$DEV_BROKER_ACCOUNTS_ENCRYPTION_KEY"
gh secret set PROD_BROKER_ACCOUNTS_ENCRYPTION_KEY --body "$PROD_BROKER_ACCOUNTS_ENCRYPTION_KEY"
```

If `GH_PAT_SCAN` was provided:

```bash
gh secret set GH_PAT_SCAN --body "$GH_PAT_SCAN"
```

Verify each command exits 0. Then confirm:

```bash
gh secret list
```

All seven required secrets should appear.

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
  ✓ DOCR registry created (<REGISTRY_NAME>) — basic plan, 5 repos
  ✓ Dev app created  (App ID: <DEV_APP_ID>, Project ID: <DEV_PROJECT_ID>)
  ✓ Prod app created (App ID: <PROD_APP_ID>, Project ID: <PROD_PROJECT_ID>)
  ✓ Secrets applied to both apps
  ✓ Database attached to both apps
  ✓ GitHub Actions secrets configured (9 required: DIGITALOCEAN_ACCESS_TOKEN, DO_REGISTRY_NAME, DO_DEV_APP_ID, DO_PROD_APP_ID, DO_DEV_PROJECT_ID, DO_PROD_PROJECT_ID, BUF_TOKEN, DEV_BROKER_ACCOUNTS_ENCRYPTION_KEY, PROD_BROKER_ACCOUNTS_ENCRYPTION_KEY)
  ✓ First deployment verified

Next steps:
  • Review docs/setup/grafana-cloud.md to wire up observability
  • Review docs/setup/alpaca.md to verify Alpaca connectivity
  • Push to main to trigger the prod deployment
```
