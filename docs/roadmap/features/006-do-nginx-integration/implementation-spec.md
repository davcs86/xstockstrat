# Implementation Spec: do-nginx-integration

**Status**: `pending`
**Created**: 2026-05-12
**Feature**: `docs/roadmap/features/006-do-nginx-integration/feature.md`
**Total Steps**: 4
**Feature Branch**: `feature/do-nginx-integration`

---

## Execution Summary

Wire the nginx reverse proxy (created by feature 005-frontend-reverse-proxy on the feature branch) into the DigitalOcean App Platform by updating `.do/app.yaml` and `.do/app.dev.yaml`. The nginx service will be declared as the public HTTP ingress on port 80, while the three Next.js frontends (trader, insights, config-ui) transition from directly exposed services to internal-only services reachable only via nginx. The nginx container will use a startup script to template upstream directives with DO private service URLs (via `envsubst`) so that upstreams resolve correctly in the DO internal network, matching the local docker-compose behavior.

## Step Dependencies

- Step 1 (update .do/app.dev.yaml) is independent.
- Step 2 (update .do/app.yaml for prod) is independent of Step 1; both can be done in parallel.
- Step 3 (create nginx entrypoint script for DO) depends on Steps 1–2 being complete (requires nginx service to be declared in both app specs before the script is used).
- Step 4 (docs: add nginx.conf notes to CLAUDE.md) is independent.

---

### Step 1 — docs: Add nginx service to .do/app.dev.yaml

**Status**: `pending`
**Service**: `.do/app.dev.yaml` (infrastructure file)
**Files**:
- `.do/app.dev.yaml` — modify (add nginx service entry, change trader/insights/config-ui http_port + remove expose, change APP_URL)

**Reviewers**: Platform Lead — Port uniqueness, service registry consistency, inter-service dependency graph correctness

**Codebase Evidence**:

- **Current state**: Confirmed via `/home/user/xstockstrat-orchestration/.do/app.dev.yaml` (L282–346): Three frontend services currently exposed with `http_port: 3000`, `http_port: 3001`, `http_port: 3002` respectively.
  - xstockstrat-trader: L282–302 (http_port: 3000)
  - xstockstrat-insights: L304–330 (http_port: 3001)
  - xstockstrat-config-ui: L332–346 (http_port: 3002)
- **Port 80 availability**: Confirmed no existing service listens on port 80 in the current app spec.
- **Dockerfile location**: Feature 005's implementation-spec confirms `services/xstockstrat-nginx/Dockerfile` is created (Step 2 status: done). Confirmed via product-spec.md FR-1 and implementation-spec Step 2 instructions.
- **nginx.conf location**: Feature 005's implementation-spec Step 1 confirms `nginx.conf` created at repo root (confirmed: Step 1 status: done).
- **DO service reference pattern**: Other services reference `${xstockstrat-config.PRIVATE_URL}` (L33, 64, 89, 122, 144, 172, 201, 225, 253, 274). This is the DigitalOcean substitution syntax for internal service discovery.

**Instructions**:

1. Edit `.do/app.dev.yaml` and add the following service block **before** the xstockstrat-trader service definition (insert after `# ── Next.js frontends ──────────────────────────────────────────────────────` comment on L280, before the trader service on L282).

```yaml
  # ── Nginx Reverse Proxy (new HTTP ingress) ────────────────────────────────

  - name: xstockstrat-nginx
    github:
      repo: YOUR_GITHUB_ORG/xstockstrat-orchestration
      branch: main-dev
      deploy_on_push: false
    source_dir: services/xstockstrat-nginx
    dockerfile_path: services/xstockstrat-nginx/Dockerfile
    http_port: 80
    instance_count: 1
    instance_size_slug: basic-xs
    envs:
      - key: XSTOCKSTRAT_TRADER_PRIVATE_URL
        value: ${xstockstrat-trader.PRIVATE_URL}
      - key: XSTOCKSTRAT_INSIGHTS_PRIVATE_URL
        value: ${xstockstrat-insights.PRIVATE_URL}
      - key: XSTOCKSTRAT_CONFIG_UI_PRIVATE_URL
        value: ${xstockstrat-config-ui.PRIVATE_URL}
```

2. For each of the three frontend services (xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui), modify the service block to **remove public exposure** by:
   - **Remove** the `http_port` line entirely (was `http_port: 3000` for trader, `3001` for insights, `3002` for config-ui)
   - This makes the service internal-only on the DO internal network; it will not be exposed to the public internet

   **Example for xstockstrat-trader** (L282–302):
   ```yaml
   - name: xstockstrat-trader
     github:
       repo: YOUR_GITHUB_ORG/xstockstrat-orchestration
       branch: main-dev
       deploy_on_push: false
     source_dir: services/xstockstrat-trader
     dockerfile_path: services/xstockstrat-trader/Dockerfile
     # http_port: 3000  ← REMOVE THIS LINE
     instance_count: 1
     instance_size_slug: basic-xs
     envs:
       ... (rest of envs unchanged)
   ```

   Apply the same change to xstockstrat-insights (remove `http_port: 3001` from around L311) and xstockstrat-config-ui (remove `http_port: 3002` from around L339).

**Verification**:

```bash
# Syntax check: YAML must be valid and parse without errors
cd /home/user/xstockstrat-orchestration
yq eval . .do/app.dev.yaml > /dev/null && echo "✓ YAML valid"

# Spot check: nginx service has http_port: 80 and the three frontends do NOT have http_port
yq eval '.services[] | select(.name == "xstockstrat-nginx") | .http_port' .do/app.dev.yaml
# Expected: 80

yq eval '.services[] | select(.name == "xstockstrat-trader") | .http_port' .do/app.dev.yaml
# Expected: (empty output — no http_port defined)

yq eval '.services[] | select(.name == "xstockstrat-insights") | .http_port' .do/app.dev.yaml
# Expected: (empty output)

yq eval '.services[] | select(.name == "xstockstrat-config-ui") | .http_port' .do/app.dev.yaml
# Expected: (empty output)
```

---

### Step 2 — docs: Add nginx service to .do/app.yaml (production)

**Status**: `pending`
**Service**: `.do/app.yaml` (infrastructure file)
**Files**:
- `.do/app.yaml` — modify (add nginx service entry, change trader/insights/config-ui http_port + remove expose, change APP_URL)

**Reviewers**: Platform Lead — Port uniqueness, service registry consistency, inter-service dependency graph correctness

**Codebase Evidence**:

- **Current state**: Confirmed via `/home/user/xstockstrat-orchestration/.do/app.yaml` (L278–342): Three frontend services currently exposed with `http_port: 3000`, `http_port: 3001`, `http_port: 3002` respectively.
  - xstockstrat-trader: L278–298 (http_port: 3000)
  - xstockstrat-insights: L300–326 (http_port: 3001)
  - xstockstrat-config-ui: L328–342 (http_port: 3002)
- **Port 80 availability**: Confirmed no existing service listens on port 80 in the current app spec.
- **Instance size in prod**: Backend services use `professional-xs` (L26, 57, 114, 165, 216, 287, 309, 337); nginx should use `basic-xs` (matching dev for simplicity — no special compute required).

**Instructions**:

1. Edit `.do/app.yaml` and add the following service block **before** the xstockstrat-trader service definition (insert after `# ── Next.js frontends ──────────────────────────────────────────────────────` comment on L276, before the trader service on L278).

```yaml
  # ── Nginx Reverse Proxy (new HTTP ingress) ────────────────────────────────

  - name: xstockstrat-nginx
    github:
      repo: YOUR_GITHUB_ORG/xstockstrat-orchestration
      branch: main
      deploy_on_push: false
    source_dir: services/xstockstrat-nginx
    dockerfile_path: services/xstockstrat-nginx/Dockerfile
    http_port: 80
    instance_count: 1
    instance_size_slug: basic-xs
    envs:
      - key: XSTOCKSTRAT_TRADER_PRIVATE_URL
        value: ${xstockstrat-trader.PRIVATE_URL}
      - key: XSTOCKSTRAT_INSIGHTS_PRIVATE_URL
        value: ${xstockstrat-insights.PRIVATE_URL}
      - key: XSTOCKSTRAT_CONFIG_UI_PRIVATE_URL
        value: ${xstockstrat-config-ui.PRIVATE_URL}
```

   **Key difference from dev**: `branch: main` (not `main-dev`) to pull production code.

2. For each of the three frontend services (xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui), modify the service block to **remove public exposure** by:
   - **Remove** the `http_port` line entirely
   - This makes the service internal-only on the DO internal network

   **Example for xstockstrat-trader** (L278–298):
   ```yaml
   - name: xstockstrat-trader
     github:
       repo: YOUR_GITHUB_ORG/xstockstrat-orchestration
       branch: main
       deploy_on_push: false
     source_dir: services/xstockstrat-trader
     dockerfile_path: services/xstockstrat-trader/Dockerfile
     # http_port: 3000  ← REMOVE THIS LINE
     instance_count: 1
     instance_size_slug: professional-xs
     envs:
       ... (rest of envs unchanged)
   ```

   Apply the same change to xstockstrat-insights (remove `http_port: 3001`) and xstockstrat-config-ui (remove `http_port: 3002`).

**Verification**:

```bash
# Syntax check: YAML must be valid and parse without errors
cd /home/user/xstockstrat-orchestration
yq eval . .do/app.yaml > /dev/null && echo "✓ YAML valid"

# Spot check: nginx service has http_port: 80 and the three frontends do NOT have http_port
yq eval '.services[] | select(.name == "xstockstrat-nginx") | .http_port' .do/app.yaml
# Expected: 80

yq eval '.services[] | select(.name == "xstockstrat-trader") | .http_port' .do/app.yaml
# Expected: (empty output — no http_port defined)

yq eval '.services[] | select(.name == "xstockstrat-insights") | .http_port' .do/app.yaml
# Expected: (empty output)

yq eval '.services[] | select(.name == "xstockstrat-config-ui") | .http_port' .do/app.yaml
# Expected: (empty output)
```

---

### Step 3 — service: Create nginx entrypoint script for DO environment variable substitution

**Status**: `pending`
**Service**: `services/xstockstrat-nginx` (new infrastructure service)
**Files**:
- `services/xstockstrat-nginx/docker-entrypoint.sh` — create

**Reviewers**: Platform Lead — Port uniqueness, service registry consistency, inter-service dependency graph correctness

**Codebase Evidence**:

- **Feature 005 Dockerfile location**: Confirmed by `/home/user/xstockstrat-orchestration/docs/roadmap/features/005-frontend-reverse-proxy/implementation-spec.md` Step 2 (L148–180): `services/xstockstrat-nginx/Dockerfile` is created by feature 005.
- **Feature 005 Dockerfile entrypoint**: Step 2 of 005's impl-spec shows the Dockerfile specifies `ENTRYPOINT ["sh", "-c", "source /app/docker-entrypoint.sh && nginx -g 'daemon off;'"]` (confirmed in Step 2 instruction L159).
- **Docker-compose pattern**: Confirmed no entrypoint script in local docker-compose (frontends run on native ports 3000, 3001, 3002 — container names resolve via Docker DNS, no env var substitution needed).
- **DO requirement**: DigitalOcean App Platform service-to-service communication uses private URLs passed as environment variables (e.g., `${xstockstrat-trader.PRIVATE_URL}`) rather than container-name DNS. These must be injected into nginx.conf at startup via `envsubst`.
- **nginx.conf upstream pattern** (from feature 005, Step 1, L76–86): Currently hardcoded as:
  ```nginx
  upstream trader_backend {
      server xstockstrat-trader:3000;
  }
  ```
  This works in docker-compose but fails in DO where `xstockstrat-trader` is not a resolvable hostname. Must be templated as `${XSTOCKSTRAT_TRADER_PRIVATE_URL}:3000` and substituted at runtime.

**Instructions**:

1. Create the file `/home/user/xstockstrat-orchestration/services/xstockstrat-nginx/docker-entrypoint.sh` with the following content:

```bash
#!/bin/sh
# Entrypoint for xstockstrat-nginx container
# Substitutes DO private service URLs into nginx.conf using envsubst, then starts nginx

set -e

# Environment variables injected by DigitalOcean App Platform (or docker-compose for testing)
# Expected variables:
#   XSTOCKSTRAT_TRADER_PRIVATE_URL     (e.g., "http://xstockstrat-trader.internal" on DO, "xstockstrat-trader" in docker-compose)
#   XSTOCKSTRAT_INSIGHTS_PRIVATE_URL   (e.g., "http://xstockstrat-insights.internal" on DO)
#   XSTOCKSTRAT_CONFIG_UI_PRIVATE_URL  (e.g., "http://xstockstrat-config-ui.internal" on DO)

# In local docker-compose: these resolve to container names; envsubst simply replaces the variable with the name
# In DO: these are private URLs injected by the platform; envsubst replaces with the full DO private URL

# Extract just the hostname/IP (strip protocol prefix if present)
# DO supplies "http://service.internal" or similar; we need just "service.internal"
TRADER_UPSTREAM="${XSTOCKSTRAT_TRADER_PRIVATE_URL#http://}"
TRADER_UPSTREAM="${TRADER_UPSTREAM#https://}"
export TRADER_UPSTREAM

INSIGHTS_UPSTREAM="${XSTOCKSTRAT_INSIGHTS_PRIVATE_URL#http://}"
INSIGHTS_UPSTREAM="${INSIGHTS_UPSTREAM#https://}"
export INSIGHTS_UPSTREAM

CONFIG_UI_UPSTREAM="${XSTOCKSTRAT_CONFIG_UI_PRIVATE_URL#http://}"
CONFIG_UI_UPSTREAM="${CONFIG_UI_UPSTREAM#https://}"
export CONFIG_UI_UPSTREAM

# Apply envsubst to generate the final nginx.conf from the template
# This replaces ${TRADER_UPSTREAM}, ${INSIGHTS_UPSTREAM}, ${CONFIG_UI_UPSTREAM} placeholders
envsubst < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Verify nginx syntax before starting
nginx -t

# Start nginx in foreground (required for Docker containers to keep PID 1)
exec nginx -g 'daemon off;'
```

2. Make the script executable:

```bash
chmod +x /home/user/xstockstrat-orchestration/services/xstockstrat-nginx/docker-entrypoint.sh
```

**Verification**:

```bash
# Check that the script is created and executable
test -x /home/user/xstockstrat-orchestration/services/xstockstrat-nginx/docker-entrypoint.sh && echo "✓ Script exists and is executable"

# Check for syntax errors (sh syntax check, no execution)
sh -n /home/user/xstockstrat-orchestration/services/xstockstrat-nginx/docker-entrypoint.sh && echo "✓ Shell syntax valid"
```

---

### Step 4 — docs: Update CLAUDE.md with nginx configuration notes

**Status**: `pending`
**Service**: `docs/` (documentation)
**Files**:
- `CLAUDE.md` — modify (add nginx.conf template notes)

**Reviewers**: none

**Codebase Evidence**:

- **CLAUDE.md location**: `/home/user/xstockstrat-orchestration/CLAUDE.md` (root).
- **Existing section**: "Key File Paths Reference" section (L426–462) lists nginx-related paths that will exist after feature 005 merges: none yet, but `services/xstockstrat-nginx/Dockerfile` and `nginx.conf` will be listed.
- **Service Registry**: Confirmed `xstockstrat-nginx` entry exists in CLAUDE.md L32 Service Registry (added by feature 005 review): `xstockstrat-nginx | Nginx | HTTP reverse proxy, unified frontend ingress | — | 80`.

**Instructions**:

1. Locate the "Key File Paths Reference" section in `/home/user/xstockstrat-orchestration/CLAUDE.md` (currently L426–462).

2. Add a new row to the table under the section "DO prod app spec" and "DO dev app spec" lines (after L443–444):

```markdown
| Nginx config | `nginx.conf` (root), `services/xstockstrat-nginx/Dockerfile`, `services/xstockstrat-nginx/docker-entrypoint.sh` |
```

3. Locate the "Observability" section (L197–217). After that section, add a new subsection titled "Nginx Reverse Proxy" to document the environment variable templating behavior:

```markdown
---

## Nginx Reverse Proxy

The **xstockstrat-nginx** service (port 80) proxies all frontend requests to the three Next.js UIs.

- **Local dev** (`docker-compose.yml`): nginx resolves upstream services via Docker DNS container names (e.g., `xstockstrat-trader:3000`)
- **DigitalOcean**: nginx receives private service URLs via environment variables (`XSTOCKSTRAT_TRADER_PRIVATE_URL`, etc.) and templates them into `nginx.conf` at startup using `docker-entrypoint.sh` + `envsubst`. The script extracts the hostname from the DO private URL (strips protocol prefix) and injects it into the upstream directives.

### Files

- `nginx.conf` (repo root): Main nginx configuration with upstream blocks and location rules
  - Upstream template placeholders: `${TRADER_UPSTREAM}`, `${INSIGHTS_UPSTREAM}`, `${CONFIG_UI_UPSTREAM}`
  - Routes: `/trader/*` → trader backend (port 3000), `/insights/*` → insights backend (port 3001), `/config-ui/*` → config-ui backend (port 3002)
  - Health endpoint: `GET /health` → `{"status":"ok","service":"nginx-reverse-proxy"}`
- `services/xstockstrat-nginx/Dockerfile`: Multi-stage build; copies `nginx.conf` (as template) and `docker-entrypoint.sh` into the container
- `services/xstockstrat-nginx/docker-entrypoint.sh`: Startup script that runs `envsubst` to substitute DO private URLs into `nginx.conf`, then starts nginx

### Environment Variables (DO App Platform)

| Variable | Source | Purpose |
|---|---|---|
| `XSTOCKSTRAT_TRADER_PRIVATE_URL` | DO injected | Private URL for xstockstrat-trader service |
| `XSTOCKSTRAT_INSIGHTS_PRIVATE_URL` | DO injected | Private URL for xstockstrat-insights service |
| `XSTOCKSTRAT_CONFIG_UI_PRIVATE_URL` | DO injected | Private URL for xstockstrat-config-ui service |
```

**Verification**:

```bash
# Check that CLAUDE.md is valid Markdown (no syntax errors)
cd /home/user/xstockstrat-orchestration
# Simple check: file should be readable and not truncated
tail -20 CLAUDE.md | grep -q "Harness Default Branch" && echo "✓ CLAUDE.md structure intact"

# Verify the new section is present
grep -q "Nginx Reverse Proxy" CLAUDE.md && echo "✓ Nginx section added"
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
