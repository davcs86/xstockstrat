# Docker Build Patterns

This guide documents the four optimized Dockerfile patterns used across the xstockstrat platform.

## Overview

| Pattern | Language | Services | Use Case |
|---|---|---|---|
| [Node.js Backend](#nodejs-backend-pattern) | Node.js | ledger, identity, notify, config | gRPC services with `pnpm deploy` |
| [Next.js Frontend](#nextjs-frontend-pattern) | Next.js | trader, insights, config-ui | Web apps with `.next/standalone` |
| [Python](#python-pattern) | Python | indicators, ingest, analysis | gRPC services with `uv` |
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
EXPOSE 50XXX 8XXX
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
WORKDIR /app
COPY --from=deps /workspace/node_modules ./node_modules
COPY services/xstockstrat-<service>/ .
RUN pnpm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=30XX
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 30XX
CMD ["node", "server.js"]
```

### Key Points

1. **Shared `base` stage**: Reduces redundant pnpm setup
2. **Proto stubs early**: Copied in `deps` stage before any pnpm install
3. **`--filter <service>`**: Only installs dependencies for the specific Next.js app (faster than full workspace install)
4. **Separate `builder` stage**: Rebuilds only when source changes, reuses cached `deps` when possible
5. **Standalone output**: Uses `.next/standalone` and `.next/static` — the minimal Next.js runtime
6. **Final `runner` stage**: Only production runtime, no source or build artifacts

### Size Comparison

```
With full node_modules: ~800MB
After .next/standalone: ~80MB (90% reduction)
```

---

## Python Pattern

**Services:** xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis

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
ENV UV_SYSTEM_PYTHON=1

WORKDIR /app
COPY services/xstockstrat-<service>/pyproject.toml services/xstockstrat-<service>/uv.lock ./
RUN uv sync --frozen --no-dev

COPY packages/proto/gen/python /proto/gen/python
RUN uv pip install --system -e /proto/gen/python

# Expose gen/ as a Python namespace package so "from gen.xxx.v1 import" works
RUN ln -s /proto/gen/python /app/gen

COPY services/xstockstrat-<service>/ .
EXPOSE 50XXX 8XXX
CMD ["python", "-m", "app.main"]
```

### Key Points

1. **`python:3.12-slim`**: Lean base image (no dev tools, no pip)
2. **Copy uv binary**: `COPY --from=ghcr.io/astral-sh/uv:latest` installs uv once at build time
3. **`UV_SYSTEM_PYTHON=1`**: Use the system Python 3.12 (no venv creation)
4. **`uv sync --frozen --no-dev`**: Install from lock file, strip dev deps for smaller image
5. **Proto as editable**: `uv pip install --system -e /proto/gen/python` allows "from gen.xxx.v1 import" in source
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
EXPOSE 50XXX 8XXX
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

### Node.js Backend (gRPC + Connect-RPC)
Use the **Node.js Backend Pattern**:
1. Create `services/xstockstrat-<service>/Dockerfile` from the template above
2. Replace `xstockstrat-<service>` placeholder
3. Update EXPOSE ports (gRPC 50XXX, HTTP 80XX)
4. Ensure `pnpm-lock.yaml` is committed (enforced by CI)
5. Reference `docs/patterns/docker-build.md` in service CLAUDE.md

### Next.js Frontend
Use the **Next.js Frontend Pattern**:
1. Create `services/xstockstrat-<service>/Dockerfile` from the template above
2. Replace `xstockstrat-<service>` placeholder
3. Set `PORT` env var and EXPOSE to correct port (30XX)
4. Ensure `pnpm-lock.yaml` is committed (enforced by CI)
5. Reference `docs/patterns/docker-build.md` in service CLAUDE.md

### Python Backend (gRPC + Connect-RPC)
Use the **Python Pattern**:
1. Create `services/xstockstrat-<service>/Dockerfile` from the template above
2. Replace `xstockstrat-<service>` placeholder
3. Update EXPOSE ports (gRPC 50XXX, HTTP 80XX)
4. Ensure `uv.lock` is committed (enforced by `uv lock --check` in CI)
5. Reference `docs/patterns/docker-build.md` in service CLAUDE.md

### Go Backend (gRPC + Connect-RPC)
Use the **Go Pattern**:
1. Create `services/xstockstrat-<service>/Dockerfile` from the template above
2. Replace `xstockstrat-<service>` placeholder
3. Update EXPOSE ports (gRPC 50XXX, HTTP 80XX)
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
