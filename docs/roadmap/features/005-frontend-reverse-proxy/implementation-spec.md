# Implementation Spec: frontend-reverse-proxy

**Status**: `pending`
**Created**: 2026-05-11
**Feature**: `docs/roadmap/features/005-frontend-reverse-proxy/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/frontend-reverse-proxy`

---

## Execution Summary

Build an nginx reverse proxy that unifies three independent Next.js frontends (trader, insights, config-ui) under a single entry point with path-based routing. Each frontend will be configured with a `basePath` in `next.config.js` to ensure all internal routing and asset resolution works correctly. The nginx proxy listens on port 80 locally and routes `/trader/*`, `/insights/*`, and `/config-ui/*` to their respective backend services on ports 3000, 3001, and 3002. Service-to-service gRPC/Connect-RPC calls remain unchanged and do not flow through nginx.

## Step Dependencies

- Step 1 (create nginx.conf) is independent.
- Step 2 (create Dockerfile.nginx) depends on Step 1 (references nginx.conf).
- Steps 3–5 (update next.config.js for each frontend) are independent of each other.
- Step 6 (update docker-compose.yml) depends on Steps 2–5 (all frontends must have basePath configured first).

---

### Step 1 — docs: Create nginx reverse proxy configuration

**Status**: `done`
**Service**: `packages/` (infrastructure)
**Files**:
- `nginx.conf` — create

**Reviewers**: none

**Codebase Evidence**:
- No existing `nginx.conf` in repo; confirmed via `find /home/user/xstockstrat-orchestration -name "nginx*" 2>/dev/null`
- Per product-spec.md FR-2: routing paths are `/trader/*` → `xstockstrat-trader:3000`, `/insights/*` → `xstockstrat-insights:3001`, `/config-ui/*` → `xstockstrat-config-ui:3002`
- Service ports confirmed in docker-compose.yml: trader L435 `"3000:3000"`, insights L465 `"3001:3001"`, config-ui L491 `"3002:3002"`

**Instructions**:

1. Create `/home/user/xstockstrat-orchestration/nginx.conf` with the following content:

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # ── Upstream backend services ──────────────────────────────────────────
    upstream trader_backend {
        server xstockstrat-trader:3000;
    }

    upstream insights_backend {
        server xstockstrat-insights:3001;
    }

    upstream config_ui_backend {
        server xstockstrat-config-ui:3002;
    }

    # ── Main HTTP server ───────────────────────────────────────────────────
    server {
        listen 80;
        server_name _;

        # Proxy settings
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "upgrade";
        proxy_set_header Upgrade $http_upgrade;
        proxy_buffering off;
        proxy_request_buffering off;

        # ── Route: /trader/* → xstockstrat-trader:3000 ────────────────────
        location /trader {
            proxy_pass http://trader_backend;
        }

        location /trader/ {
            proxy_pass http://trader_backend/;
        }

        # ── Route: /insights/* → xstockstrat-insights:3001 ───────────────
        location /insights {
            proxy_pass http://insights_backend;
        }

        location /insights/ {
            proxy_pass http://insights_backend/;
        }

        # ── Route: /config-ui/* → xstockstrat-config-ui:3002 ────────────
        location /config-ui {
            proxy_pass http://config_ui_backend;
        }

        location /config-ui/ {
            proxy_pass http://config_ui_backend/;
        }

        # Health check endpoint on nginx itself
        location /health {
            access_log off;
            return 200 '{"status":"ok","service":"nginx-reverse-proxy"}';
            add_header Content-Type application/json;
        }
    }
}
```

**Verification**:

```bash
# Syntax check (requires nginx installed locally)
nginx -t -c $(pwd)/nginx.conf
# OR
docker run --rm -v $(pwd)/nginx.conf:/etc/nginx/nginx.conf nginx:alpine nginx -t
```

Expected: `nginx: configuration file /home/user/xstockstrat-orchestration/nginx.conf test is successful` (or similar).

---

### Step 2 — docs: Create Dockerfile for nginx reverse proxy

**Status**: `pending`
**Service**: `packages/` (infrastructure)
**Files**:
- `Dockerfile.nginx` — create

**Reviewers**: none

**Codebase Evidence**:
- Pattern confirmed from existing service Dockerfiles:
  - `services/xstockstrat-trader/Dockerfile` L1: `FROM node:22-alpine AS base`
  - `services/xstockstrat-insights/Dockerfile` (same pattern)
  - Root-level `Dockerfile.codegen` shows pattern: uses official base image, copies files, runs build
- Per CLAUDE.md, Node.js version is 22
- nginx:alpine is industry standard for lightweight reverse proxy containers

**Instructions**:

1. Create `/home/user/xstockstrat-orchestration/Dockerfile.nginx` with the following content:

```dockerfile
FROM nginx:1.27-alpine

# Copy the nginx configuration from the repo root
COPY nginx.conf /etc/nginx/nginx.conf

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

**Verification**:

```bash
# Ensure the Dockerfile parses correctly
docker build -f Dockerfile.nginx -t xstockstrat-nginx:test .
# Expected: Successfully built <image-id>
docker inspect xstockstrat-nginx:test | grep -i image
# Expected: metadata shows FROM nginx:1.27-alpine
```

---

### Step 3 — service: Update xstockstrat-trader next.config.js with basePath

**Status**: `pending`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/next.config.js` — modify

**Reviewers**: `xstockstrat-trader` service owner — Trading UI routing correctness, Connect-RPC call safety after basePath changes

**Codebase Evidence**:
- Current file (L1–8): no `basePath` property
  ```javascript
  const nextConfig = {
    output: 'standalone',
    serverExternalPackages: ['@connectrpc/connect-node'],
  };
  ```
- Per product-spec.md FR-3, trader must have `basePath: '/trader'`
- Per phase5-deviations.md L36: `output: 'standalone'` is required and already present
- Next.js documentation confirms `basePath` is added to the NextConfig object

**Instructions**:

1. Update `services/xstockstrat-trader/next.config.js` to add `basePath: '/trader'`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/trader',
  output: 'standalone',
  serverExternalPackages: ['@connectrpc/connect-node'],
};

module.exports = nextConfig;
```

**Verification**:

```bash
cd services/xstockstrat-trader
pnpm install
pnpm run build
# Expected: Build succeeds with basePath prefixed to all asset paths in .next/static
# Check build output: "Page                                       Size     First Load JS"
# All routes should show prefixed with /trader
```

---

### Step 4 — service: Update xstockstrat-insights next.config.js with basePath

**Status**: `pending`
**Service**: `xstockstrat-insights`
**Files**:
- `services/xstockstrat-insights/next.config.js` — modify

**Reviewers**: `xstockstrat-insights` service owner — Analytics UI routing correctness, SSE polling through reverse proxy

**Codebase Evidence**:
- Current file (L1–10): no `basePath` property
  ```javascript
  const nextConfig = {
    output: 'standalone',
    experimental: {
      serverComponentsExternalPackages: ['@connectrpc/connect-node'],
    },
  };
  ```
- Per product-spec.md FR-3, insights must have `basePath: '/insights'`
- `output: 'standalone'` already present; matches pattern from phase5-deviations.md L60

**Instructions**:

1. Update `services/xstockstrat-insights/next.config.js` to add `basePath: '/insights'`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/insights',
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['@connectrpc/connect-node'],
  },
};

module.exports = nextConfig;
```

**Verification**:

```bash
cd services/xstockstrat-insights
pnpm install
pnpm run build
# Expected: Build succeeds with basePath prefixed to all asset paths in .next/static
# All routes should show prefixed with /insights
```

---

### Step 5 — service: Update xstockstrat-config-ui next.config.js with basePath

**Status**: `pending`
**Service**: `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-config-ui/next.config.js` — modify

**Reviewers**: `xstockstrat-config-ui` service owner — Config mutation safety through reverse proxy, environment scope correctness

**Codebase Evidence**:
- Current file (L1–10): no `basePath` property
  ```javascript
  const nextConfig = {
    output: 'standalone',
    experimental: {
      serverComponentsExternalPackages: ['@connectrpc/connect-node'],
    },
  };
  ```
- Per product-spec.md FR-3, config-ui must have `basePath: '/config-ui'`
- `output: 'standalone'` already present; matches pattern from phase5-deviations.md L18

**Instructions**:

1. Update `services/xstockstrat-config-ui/next.config.js` to add `basePath: '/config-ui'`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/config-ui',
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['@connectrpc/connect-node'],
  },
};

module.exports = nextConfig;
```

**Verification**:

```bash
cd services/xstockstrat-config-ui
pnpm install
pnpm run build
# Expected: Build succeeds with basePath prefixed to all asset paths in .next/static
# All routes should show prefixed with /config-ui
```

---

### Step 6 — service: Update docker-compose.yml to add nginx reverse proxy service

**Status**: `pending`
**Service**: `docker-compose.yml` (infrastructure)
**Files**:
- `docker-compose.yml` — modify

**Reviewers**: Platform Lead — Cross-service routing architecture, port assignments, single-entry-point design

**Codebase Evidence**:
- docker-compose.yml confirmed at `/home/user/xstockstrat-orchestration/docker-compose.yml`
- Services structure: line 76 starts xstockstrat-config, line 418 starts xstockstrat-trader (L435 exposes `:3000`), line 447 xstockstrat-insights (L465 exposes `:3001`), line 476 xstockstrat-config-ui (L491 exposes `:3002`)
- Per product-spec.md FR-1: nginx should listen on port 80
- Existing pattern: each service uses `build`, `container_name`, `ports`, `networks`, `depends_on`, `restart`

**Instructions**:

1. Add the following nginx service definition to `docker-compose.yml` at the end of the `services` section (after xstockstrat-config-ui), before the final closing line:

```yaml
  # ── Reverse Proxy ───────────────────────────────────────────────────────
  nginx:
    build:
      context: .
      dockerfile: Dockerfile.nginx
    container_name: xstockstrat-nginx
    ports:
      - "80:80"
    networks:
      - xstockstrat
    depends_on:
      - xstockstrat-trader
      - xstockstrat-insights
      - xstockstrat-config-ui
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost/health"]
      interval: 10s
      timeout: 3s
      start_period: 5s
      retries: 3
```

2. Remove the direct port exposures from the three frontend services — OR — keep them for direct access during development. Per product-spec.md FR-5, the reverse proxy must work in both local dev and production; keeping direct ports allows fallback access during debugging:
   - `xstockstrat-trader`: keep `"3000:3000"` (already at L435)
   - `xstockstrat-insights`: keep `"3001:3001"` (already at L465)
   - `xstockstrat-config-ui`: keep `"3002:3002"` (already at L491)

**Verification**:

```bash
# Validate docker-compose syntax
docker-compose config > /dev/null
# Expected: Valid docker-compose output (no errors)

# Build the entire stack
docker-compose build
# Expected: All services build successfully, including "Building xstockstrat-nginx ... done"

# Start the stack
docker-compose up -d
# Expected: All services start; check with:
docker-compose ps | grep xstockstrat-nginx
# Expected: xstockstrat-nginx running, port 0.0.0.0:80->80/tcp

# Test routing
curl http://localhost/trader
# Expected: HTTP 200, Next.js HTML page loads with basePath=/trader baked into asset URLs
curl http://localhost/insights
# Expected: HTTP 200, Next.js HTML page loads with basePath=/insights
curl http://localhost/config-ui
# Expected: HTTP 200, Next.js HTML page loads with basePath=/config-ui

# Test direct access still works (optional, for backwards compatibility)
curl http://localhost:3000/
# Expected: HTTP 200, Next.js page loads WITHOUT basePath prefix
curl http://localhost:3001/
# Expected: HTTP 200
curl http://localhost:3002/
# Expected: HTTP 200

# Test service-to-service calls unaffected (Connect-RPC through nginx should be transparent)
# Inside a running trader container:
docker exec -it xstockstrat-trader bash
curl http://xstockstrat-trading:8051/xstockstrat.trading.v1.TradingService/ListOrders \
  -H "Content-Type: application/protobuf" -d '' 2>/dev/null | xxd | head -5
# Expected: Binary gRPC response (not text HTML from nginx), confirming direct backend calls work
```

---

## Deviation Log

### Deviation: Step 1 — Create nginx reverse proxy configuration
**Spec said**: `docker run --rm -v $(pwd)/nginx.conf:/etc/nginx/nginx.conf nginx:alpine nginx -t` should report `nginx: configuration file ... test is successful`.
**Actual**: Verifier not runnable in this sandbox — no Docker daemon socket, no local `nginx` binary, and apt mirrors return 404 for `nginx-common`. File content was written byte-for-byte from the spec and passed a structural sanity check (14 open / 14 close braces, 3 `upstream` blocks, 7 `location` blocks).
**Reason**: Environment constraint, not a spec issue.
**Disposition**: tracked as follow-up — Step 6 verification (`docker-compose build && docker-compose up -d && curl http://localhost/trader`) builds the `Dockerfile.nginx` image with this config baked in; nginx will refuse to start if the config is invalid, providing the missing `nginx -t` gate.
