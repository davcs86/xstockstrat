# Nginx Reverse Proxy — Routing Reference

The **xstockstrat-nginx** service (port 80) proxies all frontend requests to the three Next.js UIs.

- **Local dev** (`docker-compose.yml`): nginx resolves upstream services via Docker DNS container names (e.g., `xstockstrat-trader:3000`)
- **DigitalOcean**: nginx receives private service URLs via environment variables (`XSTOCKSTRAT_TRADER_PRIVATE_URL`, etc.) and templates them into `nginx.conf` at startup using `docker-entrypoint.sh` + `envsubst`. The script extracts the hostname from the DO private URL (strips protocol prefix) and injects it into the upstream directives.

## Files

- `nginx.conf` (repo root): Main nginx configuration with upstream blocks and location rules
  - Upstream template placeholders: `${TRADER_UPSTREAM}`, `${INSIGHTS_UPSTREAM}`, `${CONFIG_UI_UPSTREAM}`
  - Routes: `/trader/*` → trader backend (port 3000), `/insights/*` → insights backend (port 3001), `/config-ui/*` → config-ui backend (port 3002)
  - Health endpoint: `GET /health` → `{"status":"ok","service":"nginx-reverse-proxy"}`
- `services/xstockstrat-nginx/Dockerfile`: Copies `nginx.conf` (as template) and `docker-entrypoint.sh` into the container; installs `gettext` for `envsubst`
- `services/xstockstrat-nginx/docker-entrypoint.sh`: Startup script that strips the protocol prefix from DO private URLs, runs `envsubst` (scoped to the three upstream vars) to render `nginx.conf`, verifies syntax, then starts nginx

## Environment Variables (DO App Platform)

| Variable | Source | Purpose |
|---|---|---|
| `XSTOCKSTRAT_TRADER_PRIVATE_URL` | DO injected | Private URL for xstockstrat-trader service |
| `XSTOCKSTRAT_INSIGHTS_PRIVATE_URL` | DO injected | Private URL for xstockstrat-insights service |
| `XSTOCKSTRAT_CONFIG_UI_PRIVATE_URL` | DO injected | Private URL for xstockstrat-config-ui service |

## Adding a new frontend service

When a new Next.js frontend (e.g. `xstockstrat-newui` on port `3003`) needs to be routed through nginx, touch these files in order:

1. **`nginx.conf`** — add an upstream block and a location block:
   ```nginx
   upstream newui_backend {
       server ${NEWUI_UPSTREAM}:3003;
   }
   ```
   ```nginx
   # Prefix match covers /newui, /newui/, and all sub-paths.
   # No trailing slash on proxy_pass: Next.js receives the full URI (required for basePath=/newui).
   location /newui {
       proxy_pass http://newui_backend;
   }
   ```

2. **`services/xstockstrat-nginx/docker-entrypoint.sh`** — strip the protocol prefix and export the new upstream var:
   ```sh
   NEWUI_UPSTREAM="${XSTOCKSTRAT_NEWUI_PRIVATE_URL#http://}"
   NEWUI_UPSTREAM="${NEWUI_UPSTREAM#https://}"
   export NEWUI_UPSTREAM
   ```
   Also add `$NEWUI_UPSTREAM` to the `envsubst` variable list at the bottom of the script.

3. **`.do/app.dev.yaml`** — add the new env var to the `xstockstrat-nginx` service's `envs` block:
   ```yaml
   - key: XSTOCKSTRAT_NEWUI_PRIVATE_URL
     value: ${xstockstrat-newui.PRIVATE_URL}
   ```
   Ensure `xstockstrat-newui` itself has **no** `http_port` entry (internal-only).

4. **`.do/app.yaml`** — same change as step 3, for the production spec.

5. **`docker-compose.yml`** — add the env var to the `nginx` service's `environment` block:
   ```yaml
   - XSTOCKSTRAT_NEWUI_PRIVATE_URL=xstockstrat-newui
   ```

6. **`services/xstockstrat-newui/next.config.js`** — set `basePath` to the nginx route prefix:
   ```js
   const nextConfig = {
     basePath: '/newui',
     // ... rest of config unchanged
   };
   ```
   Without this, the app's page links, `_next/static` asset paths, and API routes will 404 when served through the `/newui/` nginx location.

7. **`CLAUDE.md`** (root) — add a row to the Service Registry table and the nginx Environment Variables table.

8. **Auth pattern** — follow `docs/patterns/frontend-auth.md`: add `jose`, create `lib/auth.ts`, login page, `/api/auth/*` routes, `middleware.ts`, and ensure all outbound API route fetches forward the three propagation headers. Add `JWT_SECRET` and `IDENTITY_HTTP_ENDPOINT` env vars to compose and DO specs.
