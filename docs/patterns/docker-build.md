# Docker Build Patterns

This guide documents the four optimized Dockerfile patterns used across the xstockstrat platform.

## Overview

| Pattern | Language | Services | Use Case |
|---|---|---|---|
| [Node.js Backend](#nodejs-backend-pattern) | Node.js | ledger, identity, notify, config | gRPC services with `pnpm deploy` |
| [Next.js Frontend](#nextjs-frontend-pattern) | Next.js | trader, insights, config-ui | Web apps with `.next/standalone` |
| [Python](#python-pattern) | Python | indicators, ingest, analysis, agent | gRPC services with `uv` |
| [Go](#go-pattern) | Go | trading, portfolio, marketdata | gRPC services with distroless |

---

## Node.js Backend Pattern

**Services:** xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify, xstockstrat-config

**Characteristics:**
- Multi-stage: `base` → `builder` → `runner`
- Uses `pnpm deploy --prod` to strip dev dependencies
- `--frozen-lockfile` for reproducibility in Docker
- Compact production bundle (only runtime code)

### Template

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS builder
WORKDIR /workspace

# Copy workspace root manifests and proto stubs BEFORE pnpm install
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/proto/gen/ts/ ./packages/proto/gen/ts/
COPY services/xstockstrat-<service>/package.json ./services/xstockstrat-<service>/
# Install all workspace deps
RUN pnpm install --frozen-lockfile

# Compile proto stubs
RUN pnpm --filter @xstockstrat/proto run build

# Build service
COPY services/xstockstrat-<service>/ ./services/xstockstrat-<service>/
RUN pnpm --filter xstockstrat-<service> run build

# Create self-contained deployment bundle (resolves workspace symlinks)
RUN pnpm deploy --filter xstockstrat-<service> --prod /deploy

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /deploy ./
EXPOSE 50XXX
CMD ["node", "dist/index.js"]
```

### Key Points

1. **Shared `base` stage**: Pnpm setup is identical across all backends — DRY principle
2. **Proto stubs before install**: `packages/proto/gen/ts/` must be copied before `pnpm install` so that `tsconfig.json` exists when the `@xstockstrat/proto` prepare script runs (critical — see Gotchas)
3. **`pnpm deploy --prod`**: Creates a minimal production bundle by:
   - Resolving all workspace symlinks
   - Stripping dev dependencies
   - Including only runtime code needed in `/deploy`
4. **`--frozen-lockfile`**: Ensures reproducible builds; `pnpm-lock.yaml` must be committed
5. **Final `runner` stage**: Copies only the `/deploy` output — no build tools or source code in production image

### Size Comparison

```
With dev deps (pnpm install): ~500MB
After pnpm deploy --prod:     ~100MB (80% reduction)
```

---

## Next.js Frontend Pattern

**Services:** xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui

**Characteristics:**
- Multi-stage: `base` → `deps` → `builder` → `runner`
- Separates dependency installation from build (layer caching optimization)
- Uses `--filter <service>` for faster workspace installs
- Preserves Next.js `.next` output optimally

### Template

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/proto/gen/ts/ ./packages/proto/gen/ts/
COPY services/xstockstrat-<service>/package.json ./services/xstockstrat-<service>/
RUN pnpm install --frozen-lockfile --filter xstockstrat-<service>

FROM base AS builder
WORKDIR /workspace
COPY --from=deps /workspace ./
COPY services/xstockstrat-<service>/ ./services/xstockstrat-<service>/
RUN pnpm --filter xstockstrat-<service> run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=30XX
COPY --from=builder /workspace/services/xstockstrat-<service>/.next/standalone ./
COPY --from=builder /workspace/services/xstockstrat-<service>/.next/static ./services/xstockstrat-<service>/.next/static
EXPOSE 30XX
CMD ["node", "services/xstockstrat-<service>/server.js"]
```

### Key Points

1. **Shared `base` stage**: Reduces redundant pnpm setup
2. **Proto stubs early**: Copied in `deps` stage before any pnpm install
3. **`--filter <service>`**: Only installs dependencies for the specific Next.js app (faster than full workspace install)
4. **Workspace structure preserved in builder**: `COPY --from=deps /workspace ./` copies the full workspace including the root `node_modules/.pnpm/` virtual store AND service-specific `node_modules/`. pnpm places service binaries (e.g. `next`) in the service's own `node_modules/.bin/`, not the root — keeping the workspace context intact is required for `next build` to resolve correctly.
5. **`pnpm --filter <service> run build`**: Runs `next build` from the workspace root with the correct service `node_modules/.bin` in PATH
6. **Standalone output path**: Build output lands at `/workspace/services/<service>/.next/` — runner copies from there
7. **`server.js` subdirectory**: pnpm workspace causes Next.js to mirror the full repo path inside `standalone/` — `server.js` lands at `standalone/services/xstockstrat-<service>/server.js`, **not** at the standalone root. The CMD and static COPY must use this subdirectory path (see Gotcha below).
8. **Final `runner` stage**: Only production runtime, no source or build artifacts

### Size Comparison

```
With full node_modules: ~800MB
After .next/standalone: ~80MB (90% reduction)
```

---

## Python Pattern

**Services:** xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis, xstockstrat-agent

**Characteristics:**
- Single-stage Dockerfile (no builder needed — Python doesn't require separate build phase)
- Uses `uv` (Astral's fast Python package manager) for dependency resolution
- `--frozen` lock flag ensures reproducible builds
- `--no-dev` strips dev dependencies in production
- Proto stubs installed as editable packages with namespace package symlink

### Template

```dockerfile
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
COPY services/xstockstrat-<service>/pyproject.toml services/xstockstrat-<service>/uv.lock ./
RUN uv sync --frozen --no-dev

COPY packages/proto/gen/python /proto/gen/python
RUN uv pip install -e /proto/gen/python

# Expose gen/ as a Python namespace package so "from gen.xxx.v1 import" works
RUN ln -s /proto/gen/python /app/gen

COPY services/xstockstrat-<service>/ .
EXPOSE 50XXX
ENV PATH="/app/.venv/bin:$PATH"
CMD ["python", "-m", "app.main"]
```

### Key Points

1. **`python:3.12-slim`**: Lean base image (no dev tools, no pip)
2. **Copy uv binary**: `COPY --from=ghcr.io/astral-sh/uv:latest` installs uv once at build time
3. **`uv sync --frozen --no-dev`**: Creates `.venv` at `/app/.venv` and installs all `pyproject.toml` deps (including grpcio) from lock file, stripping dev deps
4. **`uv pip install -e /proto/gen/python`**: Installs proto stubs as an editable package into the same `.venv` — no `--system` flag
5. **`ENV PATH="/app/.venv/bin:$PATH"`**: Makes the venv `python` the default so `CMD ["python", ...]` uses the venv that has all deps (see Gotcha below)
6. **Namespace symlink**: `ln -s /proto/gen/python /app/gen` exposes proto stubs to the app
7. **Single stage**: No separate build phase needed — Python is interpreted

### Size Comparison

```
Base python:3.12-slim:       100 MB
After uv sync + proto:       250-300 MB (small deps)
Production image:            ~300 MB
```

---

## Go Pattern

**Services:** xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata

**Characteristics:**
- Multi-stage: `builder` (golang:1.25-alpine) → `final` (gcr.io/distroless/static-debian12)
- Static binary compilation (`CGO_ENABLED=0`) for portability
- Distroless final image (no shell, no package manager, no libc)
- Minimal attack surface and image size
- Optimized linker flags (`-s -w` strip debug symbols and DWARF)

### Template

```dockerfile
FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY packages/proto/ ../../packages/proto/
COPY services/xstockstrat-<service>/go.mod services/xstockstrat-<service>/go.sum ./
RUN go mod download
COPY services/xstockstrat-<service>/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o service ./cmd/server

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=builder /app/service .
EXPOSE 50XXX
ENTRYPOINT ["/app/service"]
```

### Key Points

1. **`golang:1.25-alpine`**: Lean build base (no unnecessary tools)
2. **Copy proto/ before go.mod**: Proto stubs must be available for `go mod download` (they're referenced in `go.mod` via `require`)
3. **`go mod download`**: Pre-download dependencies (layer caching) before copying source
4. **`CGO_ENABLED=0 GOOS=linux`**: Static binary, no C dependencies, Linux target
5. **`-ldflags="-s -w"`**: Strip debug/DWARF info to reduce binary size (~40% reduction)
6. **Distroless final stage**: `gcr.io/distroless/static-debian12` has only libc and CA certs, no shell or package manager
7. **No source in final image**: Binary only — no source code, build tools, or dependency trees

### Size Comparison

```
golang:1.25-alpine builder:  300 MB
Compiled binary:             15-30 MB (depending on codebase)
distroless base:             ~5 MB
Final image:                 ~30-40 MB (95% reduction from builder)
```

---

## Critical Gotcha: Proto Stubs Timing

**Problem:** If `packages/proto/gen/ts/` is not copied before `pnpm install`, the `@xstockstrat/proto` prepare script fails because `tsconfig.json` doesn't exist yet.

**Error:**
```
packages/proto/gen/ts prepare$ tsc
tsc: Failed (exit code 1)
```

**Solution:** Always copy the full `packages/proto/gen/ts/` directory (not just `package.json`) **before** running `pnpm install`:

```dockerfile
# ✅ CORRECT
COPY packages/proto/gen/ts/ ./packages/proto/gen/ts/
RUN pnpm install --frozen-lockfile

# ❌ WRONG (tsconfig.json doesn't exist yet)
COPY packages/proto/gen/ts/package.json ./packages/proto/gen/ts/
RUN pnpm install --frozen-lockfile
COPY packages/proto/gen/ts/ ./packages/proto/gen/ts/  # Too late!
```

---

## Critical Gotcha: Python uv Venv vs System Python

**Problem:** `uv sync` always creates a `.venv` virtual environment at the working directory. `UV_SYSTEM_PYTHON=1` only affects `uv pip` commands — it has no effect on `uv sync`. Without activating the venv, `CMD ["python", ...]` resolves to the bare system Python, which has none of the installed packages.

**Error:**
```
ModuleNotFoundError: No module named 'grpc'
```
(or any other package from `pyproject.toml`)

**Solution:** Do **not** set `UV_SYSTEM_PYTHON=1`. Install the proto stub into the venv (no `--system`), and add `ENV PATH` to activate the venv before CMD:

```dockerfile
# ✅ CORRECT — proto lands in .venv, CMD uses venv python
RUN uv sync --frozen --no-dev
RUN uv pip install -e /proto/gen/python
ENV PATH="/app/.venv/bin:$PATH"
CMD ["python", "-m", "app.main"]

# ❌ WRONG — uv sync ignores UV_SYSTEM_PYTHON; CMD uses system python (no packages)
ENV UV_SYSTEM_PYTHON=1
RUN uv sync --frozen --no-dev
RUN uv pip install --system -e /proto/gen/python
CMD ["python", "-m", "app.main"]
```

---

## Critical Gotcha: Next.js Standalone server.js Path in pnpm Workspace

**Problem:** In a pnpm workspace, Next.js mirrors the full repository path inside the standalone output directory. `server.js` is placed at `standalone/services/xstockstrat-<service>/server.js`, **not** at the standalone root. `CMD ["node", "server.js"]` from `WORKDIR /app` fails because `/app/server.js` doesn't exist.

**Error:**
```
Error: Cannot find module '/app/server.js'
    code: 'MODULE_NOT_FOUND',
    requireStack: []
```

**Solution:** Use the full subdirectory path in both CMD and the static COPY:

```dockerfile
# ✅ CORRECT — server.js and .next/ found at their actual location
COPY --from=builder /workspace/services/xstockstrat-<service>/.next/standalone ./
COPY --from=builder /workspace/services/xstockstrat-<service>/.next/static ./services/xstockstrat-<service>/.next/static
CMD ["node", "services/xstockstrat-<service>/server.js"]

# ❌ WRONG — server.js doesn't exist at /app/server.js; static files at wrong path
COPY --from=builder /workspace/services/xstockstrat-<service>/.next/standalone ./
COPY --from=builder /workspace/services/xstockstrat-<service>/.next/static ./.next/static
CMD ["node", "server.js"]
```

This behavior is consistent across Next.js 14 and 15 when building in a pnpm workspace.

---

## Dependency Installation Flags & Strategies

| Tool | Flag/Strategy | Pattern | Reason |
|---|---|---|---|
| **pnpm** | `--frozen-lockfile` | Node.js Backend, Frontend | Ensures reproducible builds; `pnpm-lock.yaml` must be valid and committed |
| **pnpm** | `--filter <service>` | Next.js Frontend only | Installs only the specific service deps (faster); node services need full workspace |
| **pnpm** | `--no-frozen-lockfile` | ❌ (deprecated) | Allows mutations; unsafe in Docker |
| **uv** | `--frozen` | Python | Ensures reproducible builds; `uv.lock` must be valid and committed |
| **uv** | `--no-dev` | Python | Strips dev dependencies (smaller production image) |
| **go mod** | `download` | Go | Pre-downloads deps (layer caching); run before copying source |

**Lock File Discipline:**
- **pnpm**: After any `package.json` change, run `pnpm install && pnpm lock` and commit `pnpm-lock.yaml`
- **uv**: After any `pyproject.toml` change, run `uv lock` in the service directory and commit `uv.lock`
- **go**: After any `go.mod` change, run `go mod tidy && go mod vendor` and commit `go.sum`
- CI enforces: `pnpm lock --check`, `uv lock --check`, `go mod tidy --check`

---

## npm Network Resilience (Node.js Only)

When Docker builds encounter npm registry timeouts or network instability, configure the npm client in the base stage to retry failed requests with longer timeouts:

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# Configure npm to retry failed requests and use longer timeouts
RUN npm config set fetch-timeout 120000 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5
```

**Configuration breakdown:**
- `fetch-timeout`: 120 seconds (default) — time to wait for a single request
- `fetch-retry-mintimeout`: 20 seconds — minimum delay between retries
- `fetch-retry-maxtimeout`: 120 seconds — maximum delay between retries (exponential backoff capped here)
- `fetch-retries`: 5 — number of retry attempts before giving up

This is especially important in Docker environments where:
- Container networking may have latency to external registries
- npm registry may be temporarily slow or rate-limiting
- Network proxies may introduce additional delays

All Node.js backend and frontend services in the platform already include this configuration in their base stages.

---

## When Adding a New Service

### Node.js Backend (gRPC)
Use the **Node.js Backend Pattern**:
1. Create `services/xstockstrat-<service>/Dockerfile` from the template above
2. Replace `xstockstrat-<service>` placeholder
3. Update EXPOSE port (gRPC 50XXX)
4. Ensure `pnpm-lock.yaml` is committed (enforced by CI)
5. Reference `docs/patterns/docker-build.md` in service CLAUDE.md

### Next.js Frontend
Use the **Next.js Frontend Pattern**:
1. Create `services/xstockstrat-<service>/Dockerfile` from the template above
2. Replace `xstockstrat-<service>` placeholder **in all three places**: the builder COPY, the static COPY dest, and the CMD
3. Set `PORT` env var and EXPOSE to correct port (30XX)
4. Ensure `pnpm-lock.yaml` is committed (enforced by CI)
5. Reference `docs/patterns/docker-build.md` in service CLAUDE.md

### Python Backend (gRPC)
Use the **Python Pattern**:
1. Create `services/xstockstrat-<service>/Dockerfile` from the template above
2. Replace `xstockstrat-<service>` placeholder
3. Update EXPOSE port (gRPC 50XXX)
4. Ensure `uv.lock` is committed (enforced by `uv lock --check` in CI)
5. Reference `docs/patterns/docker-build.md` in service CLAUDE.md

### Go Backend (gRPC)
Use the **Go Pattern**:
1. Create `services/xstockstrat-<service>/Dockerfile` from the template above
2. Replace `xstockstrat-<service>` placeholder
3. Update EXPOSE port (gRPC 50XXX)
4. Verify `go.mod` and `go.sum` are committed
5. Ensure `./cmd/server` is the binary entry point (or adjust the build path)
6. Reference `docs/patterns/docker-build.md` in service CLAUDE.md

---

## Digital Ocean Compatibility

Both patterns work in Digital Ocean App Platform:
- DO reads the Dockerfile path from `.do/app.yaml` and `.do/app.dev.yaml`
- DO builds images using the exact Dockerfiles in the repository
- No local-only patterns (all COPY paths are repo-relative)

Verify your DO app specs include correct Dockerfile paths:
```yaml
services:
  - name: xstockstrat-ledger
    dockerfile_path: services/xstockstrat-ledger/Dockerfile
    github:
      repo: your-github-url
      branch: main
```

---

## Service CLAUDE.md References

Each service's CLAUDE.md should include a "Docker Build Pattern" section referencing this doc:

```
## Docker Build Pattern
[Node.js Backend|Next.js Frontend|Python|Go] pattern — see `docs/patterns/docker-build.md` for [relevant context].
```

Examples:
- **ledger** (Node.js): "Backend pattern — see `docs/patterns/docker-build.md` for the base stage, proto stub timing, and `pnpm deploy` approach."
- **trader** (Next.js): "Frontend pattern — see `docs/patterns/docker-build.md` for the base + deps + builder + runner stages, `--filter` usage, and `.next/standalone` optimization."
- **indicators** (Python): "Python pattern — see `docs/patterns/docker-build.md` for single-stage `uv` builds and proto namespace package setup."
- **trading** (Go): "Go pattern — see `docs/patterns/docker-build.md` for multi-stage builder, static binary compilation, and distroless final images."

---

## References & Prerequisites

### Root Governance
- **Language versions**: `CLAUDE.md` § Language Versions & Tooling — pinned versions and when to bump them

### Proto Stubs
- **Generation**: Always run `./scripts/buf-gen.sh` after `.proto` changes to ensure all `packages/proto/gen/{ts,python,go}/` are up-to-date before building Docker images
- **Timing**: Proto stubs must be copied **before** any package manager install (`pnpm install`, `uv sync`, `go mod download`) — see Critical Gotcha

### Lock Files
- **pnpm-lock.yaml**: Must be committed after any `package.json` change; CI enforces via `pnpm lock --check`
- **uv.lock**: Must be committed after any `pyproject.toml` change (per-service); CI enforces via `uv lock --check`
- **go.sum**: Auto-generated by `go mod download`; commit whenever `go.mod` changes

### Docker Image Registries
- **Node.js base**: `node:22-alpine` (pinned in root CLAUDE.md)
- **Python base**: `python:3.12-slim` (pinned in root CLAUDE.md)
- **Go base**: `golang:1.25-alpine` (pinned in root CLAUDE.md)
- **Go final**: `gcr.io/distroless/static-debian12` (fixed — no version needed, uses latest immutable digest)

### CI & CD
- **Docker builds**: All services build during `docker compose build` and in `git push` to GitHub Actions
- **Digital Ocean**: DO App Platform reads `.do/app.yaml` and `.do/app.dev.yaml`, builds images using the Dockerfiles in the repo
- **Layer caching**: Docker layer cache is effective only when lock files match the build context exactly

---

## Service Readiness and Healthchecks

### The Problem

`condition: service_started` (the docker-compose default) only waits for the container process to start — it does not wait for the service to bind its TCP port. Services that call `WatchConfig()` or `LedgerWrite()` at startup can hit connection-refused errors during the race window between container start and port binding.

The fix is two-layered:
- **Local dev** (`docker-compose.yml`): proper `healthcheck` blocks + `condition: service_healthy`
- **DO App Platform** (`.do/app.yaml`, `.do/app.dev.yaml`): `WAIT_FOR` env var read by `scripts/docker-entrypoint.sh` at container startup (DO has no `depends_on`)

### `scripts/wait-for-deps.sh`

Standalone TCP probe script. Bash 3.2-compatible (macOS + Linux).

```bash
# Usage
./scripts/wait-for-deps.sh HOST:PORT [HOST:PORT ...] [-- COMMAND [ARGS...]]

# Examples
./scripts/wait-for-deps.sh xstockstrat-config:50060
./scripts/wait-for-deps.sh localhost:50060 localhost:50057 -- echo "both ready"

# Env vars
WAIT_TIMEOUT=60    # seconds before giving up per endpoint (default 60)
WAIT_INTERVAL=2    # seconds between retries (default 2)
WAIT_FOR="localhost:50060 localhost:50057"  # alternative to positional args
```

Probe strategy by environment:
| Image | Tool | Notes |
|---|---|---|
| Alpine (Node.js) | `nc -z` | Busybox nc — supports `-z` |
| Debian slim (Python) | bash `/dev/tcp` | No `nc` in base image |
| macOS host | `nc -z` | BSD nc — supports `-z` |
| Distroless (Go) | Not supported | No shell or nc; rely on upstream healthchecks |

### `scripts/docker-entrypoint.sh`

Generic container entrypoint used by all Node.js and Python services. Reads `WAIT_FOR` (space-separated `HOST:PORT` list), probes all endpoints, then `exec`s the CMD.

```sh
# Set WAIT_FOR in docker-compose.yml or the DO app spec per service:
WAIT_FOR: "xstockstrat-config:50060 xstockstrat-ledger:50057"
```

When `WAIT_FOR` is unset or empty, it skips probing and starts immediately. This makes it safe to use as a universal entrypoint — services that have no deps to probe behave identically to before.

### Docker Compose Healthcheck Patterns

**Node.js / Alpine** — busybox `nc -z`:
```yaml
    healthcheck:
      <<: *hc-defaults
      test: ["CMD", "nc", "-z", "localhost", "50057"]
```

**Python / Debian slim** — bash `/dev/tcp` (no `nc` in base image):
```yaml
    healthcheck:
      <<: *hc-defaults
      test: ["CMD", "bash", "-c", "echo > /dev/tcp/localhost/50054"]
```

**Go / distroless** — no healthcheck possible. These services depend on upstream Node.js/Python services that do have healthchecks, so `condition: service_healthy` on their upstream deps enforces readiness transitively.

The shared timing anchor in `docker-compose.yml`:
```yaml
x-hc-defaults: &hc-defaults
  interval: 5s
  timeout: 3s
  retries: 12      # up to 60s total before marking unhealthy
  start_period: 5s
```

### `depends_on` Condition Summary

| Service | Has healthcheck | Upstream deps use `service_healthy` |
|---|---|---|
| `xstockstrat-config` | ✅ (Node.js, port 50060) | timescaledb |
| `xstockstrat-ledger` | ✅ (Node.js, port 50057) | config |
| `xstockstrat-identity` | ✅ (Node.js, port 50058) | config, ledger |
| `xstockstrat-notify` | ✅ (Node.js, port 50059) | config, ledger |
| `xstockstrat-indicators` | ✅ (Python, port 50054) | config, ledger |
| `xstockstrat-ingest` | ✅ (Python, port 50055) | config, ledger, identity |
| `xstockstrat-analysis` | ✅ (Python, port 50056) | config, ledger, indicators |
| `xstockstrat-agent` | ✅ (Python, port 9000) | config, identity, ingest, notify, analysis |
| `xstockstrat-marketdata` | ❌ (Go distroless) | config, ledger, notify via `service_healthy` |
| `xstockstrat-portfolio` | ❌ (Go distroless) | config, ledger via `service_healthy` |
| `xstockstrat-trading` | ❌ (Go distroless) | config, ledger, notify, indicators via `service_healthy` |

### Which Deps Belong in `WAIT_FOR`

**Rule: only probe services the container calls synchronously during `main()` init — not services it calls reactively during normal operation.**

| Startup-time dep (probe it) | Why |
|---|---|
| `xstockstrat-config:50060` | Every service opens a `WatchConfig` gRPC stream before its own server starts. Connection-refused here aborts startup. |
| `xstockstrat-ledger:50057` | Most services write a startup lifecycle event (`service.started`) early in `main()`. |
| `xstockstrat-identity:50058` | Services that validate inbound tokens at init (e.g. ingest webhook auth wiring). |
| `xstockstrat-indicators:50054` | analysis calls `ComputeIndicator` immediately when a backtest is triggered, making indicators a hard dependency of analysis's serving path — but since analysis doesn't call it in `main()` init, this is borderline. It's included to avoid cascading restarts during fresh-stack startup. |

| Operational dep (do NOT probe) | Why |
|---|---|
| `xstockstrat-notify:50059` | Alerts are emitted reactively (sandbox breach, backfill failure, etc.), never in `main()` init. A transient notify failure should produce a logged error, not block startup. |
| `xstockstrat-marketdata:50053` | Queried on-demand; never called at init. |
| `xstockstrat-ingest:50055` | Same — signal queries happen per-request. |

**Decision rationale (2026-05-28):** Probing operational deps at startup would make boot order stricter than the application actually requires, increase cold-start time, and create cascading failures (if notify is slow, everything that lists it in WAIT_FOR stalls). The correct failure mode for a missing operational dep is a per-call error with application-level retry, not a startup timeout.

If a new service's `main()` calls an endpoint before returning (e.g. a one-time seed fetch, a schema sync, a token pre-warm), add that endpoint to `WAIT_FOR`. If the call only happens after the service is serving RPCs, leave it out.


### Adding a New Service

1. **Node.js / Python**: Add the entrypoint lines to the Dockerfile's final stage (after copying service files):
   ```dockerfile
   COPY scripts/wait-for-deps.sh /usr/local/bin/wait-for-deps.sh
   COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
   RUN chmod +x /usr/local/bin/wait-for-deps.sh /docker-entrypoint.sh
   ENTRYPOINT ["/docker-entrypoint.sh"]
   CMD ["<your start command>"]
   ```
2. **docker-compose.yml**: Add `healthcheck` block (using the appropriate probe method for the language), add `WAIT_FOR` env var with only startup-time deps (see table above), and upgrade `depends_on` conditions to `service_healthy`.
3. **`.do/app.dev.yaml` / `.do/app.yaml`**: Add a `WAIT_FOR` entry to the service's `envs:` list using `${svc.PRIVATE_DOMAIN}:PORT` syntax.
