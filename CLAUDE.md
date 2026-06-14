# xstockstrat — Root CLAUDE.md

## Project Overview

**xstockstrat** (Cross Stock Strategies) is a monorepo stock strategy platform built on the **Spine pattern**. The root owns:

- `packages/proto/` — single source of truth for all gRPC/Protobuf contracts
- `docs/` — runbooks, setup guides, and implementation roadmap
- `scripts/` — codegen, bootstrap, and CI helpers
- Root-level config governance documentation (this file)

All services live as siblings under `services/`. They consume generated code from `packages/proto/` and coordinate via gRPC (HTTP/2 with protobuf). Backend services expose **gRPC only**; the Next.js frontends and the MCP agent reach them over gRPC (via `@connectrpc/connect-node` gRPC transport / native gRPC stubs) and re-expose HTTP to browsers/external clients themselves.

---

## Context Guide

This file covers always-needed platform conventions. For larger reference sections, read only what is relevant to your current task — don't load the rest.

| Task | Read |
|---|---|
| Building or modifying a Next.js frontend | `docs/patterns/frontend-auth.md` |
| Other Next.js patterns (basePath, BFF connect-web call chain + handler-map basePath gotcha, browser typed-client data shape, BFF route verification, Suspense fallbacks, Radix hydration, middleware matcher, app icons) | `docs/patterns/nextjs-frontends.md` |
| Nginx routing pattern (deprecated — nginx removed) | `docs/patterns/nginx-routing.md` (historical reference) |
| Adding a new backend service (any language) | `docs/patterns/header-propagation.md` |
| Docker build patterns (Node.js, Next.js, Python, Go) | `docs/patterns/docker-build.md` |
| Service healthchecks, `WAIT_FOR` entrypoint, `depends_on` conditions | `docs/patterns/docker-build.md` |
| Config key naming, scoping, startup wiring | `docs/patterns/config-governance.md` |
| Config service startup readiness (90s timeout, healthcheck, per-language) | `docs/patterns/config-startup.md` |
| DB schema map, migration tooling, run order | `docs/patterns/database.md` |
| OTel setup, env vars, per-language modules | `docs/patterns/observability.md` |
| CI job matrix, coverage thresholds, deploys | `docs/patterns/ci-overview.md` |
| Proto / buf changes | `docs/runbooks/proto-versioning.md` |
| Adding a data source (Polygon, Tiingo, etc.) | `docs/runbooks/add-data-source.md` |
| Building a custom indicator formula | `docs/runbooks/indicator-builder.md` |
| Bug triage / hotfix | `docs/runbooks/bug-triage.md` |
| Config rollout | `docs/runbooks/config-rollout.md` |
| Backfilling historical data | `docs/runbooks/historical-backfill.md` |
| First-time DigitalOcean setup | `docs/setup/digitalocean.md` |
| OTel / Grafana Cloud wiring | `docs/setup/grafana-cloud.md` |
| Feature workflow (branch, PR, promote) | `docs/runbooks/feature-workflow.md` |
| Using or troubleshooting the agent MCP tools | `docs/runbooks/mcp-tools.md` |

---

## Service Registry

Backend services are **gRPC-only** (the HTTP/Connect-RPC ports were removed once all
callers — frontends and the MCP agent — moved to gRPC). The HTTP Port column applies only
to the frontends, nginx, and the agent.

| Service | Language | Role | gRPC Port | HTTP Port |
|---|---|---|---|---|
| xstockstrat-trading | Go | Order execution, trade lifecycle | 50051 | — |
| xstockstrat-portfolio | Go | Position tracking, P&L | 50052 | — |
| xstockstrat-marketdata | Go | Alpaca feed ingestion, OHLCV storage | 50053 | — |
| xstockstrat-indicators | Python | Formula engine, sandboxed execution | 50054 | — |
| xstockstrat-ingest | Python | Raw data normalization, event publishing | 50055 | — |
| xstockstrat-analysis | Python | Strategy scoring, backtesting | 50056 | — |
| xstockstrat-ledger | Node.js | Append-only event store | 50057 | — |
| xstockstrat-identity | Node.js | Auth, API keys, JWT | 50058 | — |
| xstockstrat-notify | Node.js | gRPC streaming alert delivery | 50059 | — |
| xstockstrat-config | Node.js | Live config WatchConfig stream | 50060 | — |
| xstockstrat-ui | Next.js | Consolidated UI: trader dashboard, insights analytics, config management | — | 3000 |
| xstockstrat-agent | Python | MCP server — AI agent tools for signal ingestion, alerting, backtesting | — | 9000 (SSE) |

---

## Language Map

```text
Go        → xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata
Python    → xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis, xstockstrat-agent
Node.js   → xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify, xstockstrat-config
Next.js   → xstockstrat-ui
```

---

## Language Versions & Tooling

| Language / Tool | Version | Notes |
|---|---|---|
| Go | 1.25 | `go.work` workspace file at repo root; use `GOWORK=off` for per-service builds |
| Python | 3.12 | Dependencies managed by `uv`; run `uv sync --extra dev` to install, `uv lock` after any `pyproject.toml` change |
| Node.js | 22 | All Node/Next services |
| pnpm | 9.15.0 | Workspace manager (`pnpm-workspace.yaml`); `npm install -g pnpm@9.15.0` |
| buf | latest | Proto toolchain; installed by `scripts/bootstrap.sh` |
| golang-migrate | latest | DB migrations; installed by `scripts/bootstrap.sh` |
| golangci-lint | v2.5.0 | Go lint; run via `golangci-lint-action@v6` |
| ruff | latest | Python lint + format |
| Playwright | — | E2E tests for all three Next.js frontends |

**Python uv lock rule**: After any change to a Python service's `pyproject.toml` (adding, removing, or updating a dependency), run `uv lock` inside that service directory and commit the updated `uv.lock` in the same PR. Never leave `uv.lock` out of sync with `pyproject.toml` — `uv lock --check` enforces this in CI.

**Important Go build note**: CI runs all Go jobs with `GOWORK=off`. When running Go commands locally for a single service (e.g., `go test`, `go mod download`), set `GOWORK=off` or `cd services/<service>` and rely on the local `go.mod`.

**macOS is the primary developer platform; Linux is optional.** All bash commands in `.md` files (docs, runbooks, setup guides) must be macOS/Homebrew-compatible:

- Use `brew install <tool>` as the primary install instruction; add Linux alternatives in an "Other" column or parenthetical — not the other way around
- Avoid GNU-only flags; prefer options that work on both BSD (macOS) and GNU tools (e.g. `grep -oE` works on both; `grep -P` does not)
- Never use bare `pip` — use `python3 -m pip` (bare `pip` resolves to pip2 on stock macOS)
- Scripts (`.sh` files) follow the same rule; use `#!/usr/bin/env bash` and bash 3.2-compatible syntax (macOS ships bash 3.2 by default)

### Version Bump Workflow

To change a language or tool version:

1. **Update this table first** (CLAUDE.md §Language Versions & Tooling) — this is the soft source of truth
2. **Update `Dockerfile.codegen`** — the proto-gen container
3. **Propagate** to all other pinned locations:

| Tool | Files to update |
|---|---|
| Go | `go.work`, `.github/workflows/ci.yml` (`go-version`), Go service Dockerfiles (`FROM golang:X`) |
| Python | `.github/workflows/ci.yml` (`python-version`), Python service Dockerfiles (`FROM python:X-slim`) |
| Node.js | `.github/workflows/ci.yml` (`node-version`), Node/Next service Dockerfiles (`FROM node:X-alpine`) |
| pnpm | `package.json` (`packageManager`), `.github/workflows/ci.yml` (`pnpm@X`), Node service Dockerfiles |

1. Open a PR — CI will catch any missed files.

---

## Proto Contract Governance

All `.proto` changes require a PR to this repo first. `buf lint` + `buf breaking` run on every CI PR. Run `./scripts/buf-gen.sh` before committing (CI `proto-freshness` job enforces this).

**Prefer enums over strings** for any field whose value set is closed and deployment-time-defined (e.g. status codes, operation verbs, fixed categories). Use `string` only when values are open/runtime-extensible (registered by operators at runtime) or when old clients silently dropping unknown enum values would be lossy. Every enum must have a zero-value `<NAME>_UNSPECIFIED = 0` sentinel.

For breaking-change workflow, BSR publishing, and approval requirements → `docs/runbooks/proto-versioning.md`.

---

## Approval Flow

See `docs/runbooks/approval-flow.md`. Breaking proto: 2 owners + platform lead. New config key: owner + config team. New service: platform lead. DB migration: DBA + service owner.

---

## Config Governance Rules

Config served by `xstockstrat-config` via `WatchConfig` RPC (gRPC 50060). Key rules: no hardcoded values in source; naming is `<service>.<category>.<key>`; all services subscribe at startup; sensitive keys use `secret.*` prefix; defaults declared in each service's `CLAUDE.md`.

**Full rules, global key table, and registration steps** → `docs/patterns/config-governance.md`.

Recently added keys (feature 049 Part B — MCP OAuth 2.1 edge auth, owned by `xstockstrat-agent`):

| Key | Type | Default | Description |
|---|---|---|---|
| `agent.oauth.registration_enabled` | bool | `true` | Allow RFC 7591 Dynamic Client Registration at `/oauth/register` |
| `agent.oauth.allowed_redirect_uris` | string | `""` | Comma-separated exact redirect URIs; empty = require `https://` at registration only (no allow-any) |

Recently added keys (feature 057 — backfill management UI, owned by `xstockstrat-marketdata`):

| Key | Type | Default | Description |
|---|---|---|---|
| `marketdata.backfill.max_delete_days` | int | `0` | Max date-range span (days) a single scoped `DeleteBackfilledData` may cover; `0` = no window cap (current behavior). Whole-symbol deletes (no range) are exempt and double-confirmed in the UI (FR-5). |

Recently added keys (Alpaca API compliance audit, owned by `xstockstrat-marketdata`):

| Key | Type | Default | Description |
|---|---|---|---|
| `marketdata.alpaca.adjustment` | string | `all` | Corporate-action adjustment for historical bars (`raw`/`split`/`dividend`/`all`); sent as `adjustment=` on every Alpaca bars request so splits/dividends do not distort backtest OHLCV. |

---

## Environment Variable Naming Convention

All inter-service connection env vars follow these patterns. **Never invent new suffixes** — use only the forms below.

| Pattern | Format | Used for | Example |
|---|---|---|---|
| `<SERVICE>_ENDPOINT` | `host:port` (no protocol) | gRPC connections | `IDENTITY_ENDPOINT=xstockstrat-identity:50058` |
| `XSTOCKSTRAT_<SERVICE>_PRIVATE_URL` | `PRIVATE_DOMAIN` on DO (e.g. `svc.internal`), bare container name in Compose | **nginx container only** — `envsubst` upstream resolution; entrypoint strips `http://` prefix just in case, but the nginx template already appends `:PORT` so `PRIVATE_URL` (which includes the port) must not be used here | `XSTOCKSTRAT_AGENT_PRIVATE_URL=xstockstrat-agent` |

**Rules:**

- All backend services are gRPC-only, so all inter-service connection vars use the `_ENDPOINT` (gRPC `host:port`) form. The legacy `<SERVICE>_HTTP_ENDPOINT` form was removed when the backend HTTP/Connect-RPC (80xx) servers were deleted — do not reintroduce it (test-only Playwright mocks may still set it, but no runtime code reads it).
- No `XSTOCKSTRAT_` prefix except for nginx `PRIVATE_URL` vars.
- No `_URL` suffix on inter-service connection vars — always `_ENDPOINT`.
- When a new service introduces connection env vars, check `docker-compose.yml` first — the var may already exist in another service's block and only needs to be added to the new service's block with the same value.
- `N8N_WEBHOOK_SECRET` was removed by feature 011 (`remove-n8n-references`). Do not reference it. The MCP agent uses `MCP_AGENT_SECRET` (sent as `x-mcp-secret` header on outbound calls to identify itself to platform services); the receiving services do not currently enforce it.

---

## Database

TimescaleDB (PostgreSQL). Each service owns its schema; migrations run via `scripts/db-migrate.sh` (golang-migrate). Convention: `NNN_description.up.sql` + `.down.sql` in `services/<service>/migrations/`. Never edit an applied migration — add a new numbered one instead.

**Schema map, migration run order, and step-by-step guide** → `docs/patterns/database.md`.

### Connection Pool Budget

The managed DigitalOcean PostgreSQL plan allows **20 connections shared across all services**. Each
service caps its pool small so the sum of all pool maxes stays at or below 20. Pool size is set per
service in code and overridable with the **`DB_POOL_MAX`** env var (Go `pgxpool.MaxConns`, Python
`asyncpg.create_pool(max_size=…)`, Node `pg.Pool({ max })`). **When adding a new DB-backed service or
raising any service's pool, re-check this table so the total never exceeds 20.**

| Service | Lang | Pool max | Notes |
|---|---|---|---|
| xstockstrat-trading | Go | 2 | Single shared `pgxpool` — `AccountRepo` reuses `TradingRepo.Pool()` (no second pool) |
| xstockstrat-portfolio | Go | 2 | |
| xstockstrat-marketdata | Go | 2 | |
| xstockstrat-indicators | Python | 2 | |
| xstockstrat-ingest | Python | 2 | |
| xstockstrat-analysis | Python | 2 | |
| xstockstrat-ledger | Node | 2 | |
| xstockstrat-identity | Node | 2 | |
| xstockstrat-config | Node | 2 | |
| xstockstrat-notify | Node | 1 | Light DB use (alert history only) |
| xstockstrat-ui | Next.js | 1 | config-ui audit route only |
| **Total** | | **20** | At the DigitalOcean shared limit |

---

## Service-to-Service Calls

Backend services are **gRPC-only**. The MCP agent and the frontends call them via native
gRPC stubs / `@connectrpc/connect-node` gRPC transport on the 50xx ports. There are no HTTP
`/webhooks/` handlers and no backend HTTP/Connect-RPC (80xx) ports — these were removed once
all callers migrated to gRPC. Signal ingestion, alert emission, and backtest triggering are
plain gRPC RPCs (`IngestSignal`, `EmitAlert`, `RunBacktest`, …) invoked directly by the agent.

```text
Agent / Frontend → gRPC RPC (50xx) → target backend service
```

---

## Observability

OTel SDK → OTLP → Grafana Cloud. Toggle: `OTEL_ENABLED=true`. OTel init errors must never prevent startup. Each service has `internal/telemetry/` (Go), `app/telemetry.py` (Python), or `src/telemetry.ts` (Node.js).

**Env var table, local vs. prod endpoints, and per-language patterns** → `docs/patterns/observability.md`.

---

## Frontend Ingress

`xstockstrat-ui` (port 3000) serves all three frontend segments under their respective path prefixes (`/trader`, `/insights`, `/config-ui`). In the DO App Platform, path-based route rules direct `/agent` to `xstockstrat-agent` and `/` (catch-all) to `xstockstrat-ui`. In local docker-compose, `xstockstrat-ui` is exposed directly on port 3000. The nginx reverse proxy was removed by feature 045 (`ui-consolidation-nextjs`).

---

## Frontend Authentication Pattern

The `xstockstrat-ui` service implements JWT auth via `src/lib/auth.ts` (Edge Runtime, `jose`), `src/middleware.ts` (route protection + trace ID injection), per-segment `/api/auth/{login,refresh,logout}` routes, and forwards `x-user-id` / `x-access-scope` / `x-trace-id` on all outbound calls. Required env vars: `JWT_SECRET`, `IDENTITY_ENDPOINT` (gRPC `host:port`).

**Full pattern, required files, and code snippets** → read `docs/patterns/frontend-auth.md`. Reference implementation: `services/xstockstrat-ui/src/`.

---

## Generating Proto Stubs

Run `./scripts/buf-gen.sh` — generates TypeScript, Python, and Go stubs and compiles the TS package. Run after any `.proto` change. For manual `buf` commands and BSR publishing → `docs/runbooks/proto-versioning.md`.

---

## Repository Bootstrap

First time: `./scripts/localenv-setup.sh` (builds proto-gen container, generates stubs via Docker — no Go/Python/Node required on host). Then: `./scripts/bootstrap.sh` (installs deps, starts TimescaleDB, runs migrations). Re-run `./scripts/buf-gen.sh` after proto changes; `./scripts/db-migrate.sh` for pending migrations.

---

## Dockerfile Update Workflow

When modifying a service's `Dockerfile`, update the complete chain:

1. **Update the Dockerfile** (`services/xstockstrat-<service>/Dockerfile`)
   - Follow the pattern for your language: `docs/patterns/docker-build.md`
   - Test locally: `docker compose build --no-cache xstockstrat-<service>`

2. **Update the service's CLAUDE.md** (`services/xstockstrat-<service>/CLAUDE.md`)
   - Verify or add the "Docker Build Pattern" section
   - Ensure it references `docs/patterns/docker-build.md` with language-specific guidance
   - Update any port numbers, env vars, or CMD/ENTRYPOINT if changed

3. **Update `docs/patterns/docker-build.md`** (only if pattern changed)
   - If you're introducing a new pattern or fixing an existing one, document it here
   - Update templates, size comparisons, key points
   - Add cross-references if the pattern affects other parts of the system

4. **Test before committing**
   - `docker compose build --no-cache` — rebuilds all services
   - `docker compose up -d` — verify the service starts and health checks pass
   - No changes to `.do/app.yaml` or `.do/app.dev.yaml` needed — they reference Dockerfiles by path, not content

5. **Commit as a single PR**
   - All three files (Dockerfile, service CLAUDE.md, docs pattern) in one commit
   - Commit message: "Update <service> Dockerfile and documentation" (or "Update Docker patterns" if pattern-wide)
   - CI validates: Docker builds, lint checks, and documentation links

**Common updates:**

- **Base image version bump** (Node 22 → 23, Python 3.12 → 3.13, etc.) → update the Dockerfile + version table in root CLAUDE.md + all affected service Dockerfiles
- **Lock file tooling change** (pnpm@9 → pnpm@10) → update root CLAUDE.md version table + all Node service Dockerfiles + all Node service lock files
- **Dependency strategy change** (e.g., switching from `--no-frozen-lockfile` to `--frozen-lockfile`) → update Dockerfile + service CLAUDE.md + `docs/patterns/docker-build.md`

---

## CI/CD Overview

CI runs on every PR to `main-dev` or `main`. Coverage thresholds: Go/Python/Node.js ≥40% (indicators ≥50%). Deploys: `main-dev` push → DO dev app; `main` push → DO prod app.

**Full job matrix, coverage notes, and deployment pipeline** → `docs/patterns/ci-overview.md`.

---

## Inter-Service Dependencies

```text
xstockstrat-ui (UI — trader/insights/config-ui segments)
  ├── xstockstrat-trading (gRPC)
  │     ├── xstockstrat-marketdata (gRPC)
  │     ├── xstockstrat-portfolio (gRPC)
  │     ├── xstockstrat-indicators (gRPC)
  │     └── xstockstrat-ledger (gRPC write)
  └── xstockstrat-analysis (gRPC)
        ├── xstockstrat-marketdata (gRPC)
        ├── xstockstrat-indicators (gRPC)
        └── xstockstrat-ledger (gRPC read)

All services → xstockstrat-config (WatchConfig stream at startup)
All services → xstockstrat-ledger (event writes)
All services → xstockstrat-notify (alert emissions)
xstockstrat-ingest → xstockstrat-marketdata (raw data push)
xstockstrat-indicators → xstockstrat-ingest (QuerySignals for signal-aware formulas)
xstockstrat-analysis → xstockstrat-ingest (QuerySignals for signal-weighted backtests)
```

---

## Header Propagation Convention

Every backend service **must** propagate `x-user-id`, `x-access-scope`, and `x-trace-id` from inbound requests to all outbound gRPC calls. Nginx strips them from external requests so they are trusted as platform-internal values.

**Language-specific patterns (Go interceptor, Python per-method, Node.js AsyncLocalStorage), code snippets, and reference implementations** → read `docs/patterns/header-propagation.md`.

---

## Branch Strategy

| Branch | Purpose |
|---|---|
| `main` | Production — triggers prod deploy on push |
| `main-dev` | Development trunk — triggers dev deploy on push; all feature branches merge here |
| `feature/<slug>` | Feature implementation branches (SDD workflow); also used for SDD-path bug fixes (Track C) |
| `feature-steps/<slug>-step-<N>` | Per-step branches for SDD execute loop; each step gets a PR into `feature/<slug>` |
| `hotfix/<slug>` | Urgent production bug fixes — branches from `main`, PR targets `main`; back-merged into `main-dev` after merge |
| `claude/*` | Harness-assigned branches (e.g., `claude/add-claude-documentation-9Whsq`) — always branched from and PR'd into `main-dev`; never use as base for features |

### Merge Strategy

| PR direction | Required merge type | Reason |
|---|---|---|
| `feature/*` or `claude/*` → `main-dev` | Squash and merge | Keeps `main-dev` history clean |
| `hotfix/*` → `main` | **Create a merge commit** — never squash | Preserves ancestry; back-merge into `main-dev` required immediately after |
| `main-dev` → `main` (promotion) | **Create a merge commit** — never squash | Squash breaks git ancestry: `main-dev` stays permanently "ahead" of `main` even after content is promoted, polluting future promotion diffs |

To enforce this, disable squash and rebase merging on the `main` branch:
**Settings → Branches → Edit `main` branch protection → Allow merge types → uncheck Squash and Rebase**.

---

## Implementation Roadmap Status

Active phases and their current status. See `docs/roadmap/implementation-roadmap.md` for full specs and verification checkpoints.

| Phase | Description | Status |
|---|---|---|
| Phase 0 | Foundation: proto gen, bootstrap, DB, Docker Compose | Pending |
| Phase 1 | Core infrastructure: config, ledger, identity, notify | **DONE** |
| Phase 2 | Data layer: marketdata, portfolio | Pending |
| Phase 3 | Processing: indicators, ingest, analysis | **DONE** |
| Phase 4 | Trading core | **DONE** |
| Phase 5 | UI layer: trader, insights, config-ui → consolidated as `xstockstrat-ui` (feature 045) | **DONE** |
| Phase 6 | Integration & webhook wiring | **DONE** |
| Phase 7 | Observability: OTel + Grafana Cloud | **DONE** |

Deviation notes for completed phases: `docs/roadmap/phase[3-7]-deviations.md`.

---

## Feature Roadmap

Active and completed feature implementations are tracked under `docs/roadmap/features/`. Feature directories are named `NNN-<slug>` (e.g. `001-add-ikbr-account-support`) where `NNN` is a zero-padded sequence number auto-assigned in creation order. Git branches use only the slug: `feature/<slug>`. Each feature directory contains:

- `feature.md` — lifecycle status (`idea`/`draft`/`spec-ready`/`implementation-ready`/`in-progress`/`code-completed`/`launched`/`rolled-back`/`demoted/canceled`), links to all artifacts
- `product-spec.md` — requirements, affected services, governance gates
- `implementation-spec.md` — numbered steps with concrete code references and statuses
- `context.md` — append-only session log of decisions, deviations, files modified

### Active Features

| Feature | Status | Branch | Next Action |
|---|---|---|---|
| `001-add-ikbr-account-support` | `launched` | `feature/add-ikbr-account-support` | — merged to main-dev via PR #97 |
| `004-make-repo-public-secure` | `launched` | `feature/make-repo-public-secure` | — promoted to production via PR #158 |

**When starting any session involving an in-progress feature:**

1. Run `/sdd-status` to see all features and their lifecycle status.
2. Read `docs/roadmap/features/<NNN-slug>/context.md` before touching any related files — it contains critical decisions from prior sessions.
3. Do NOT rely on conversation context from a previous session. Always re-read context.md.

SDD skills: `/sdd-story` → `/sdd-review product-spec` → `/sdd-spec` → `/sdd-review impl-spec` → `/sdd-execute` (loop) | `/sdd-status` (anytime) | `/sdd-sync` (sync spec files from feature branches to main-dev)

---

## Key File Paths Reference

| Area | Path |
|---|---|
| Proto contracts | `packages/proto/<service>/v1/<service>.proto` |
| Common proto types | `packages/proto/common/v1/common.proto` |
| Proto buf config | `packages/proto/buf.yaml`, `packages/proto/buf.gen.yaml` |
| Generated Go stubs | `packages/proto/gen/go/` |
| Generated Python stubs | `packages/proto/gen/python/` |
| Generated TS stubs | `packages/proto/gen/ts/` (compiled JS in `gen/ts/dist/`) |
| Go services | `services/xstockstrat-{trading,portfolio,marketdata}/` |
| Python services | `services/xstockstrat-{indicators,ingest,analysis}/` |
| Node.js services | `services/xstockstrat-{ledger,identity,notify,config}/` |
| Next.js UI | `services/xstockstrat-ui/` |
| Docker Compose | `docker-compose.yml` |
| OTel Collector config | `packages/otel/otel-collector-config.yaml` |
| Grafana dashboards (as code) | `packages/otel/dashboards/` (synced by `scripts/grafana-deploy-dashboards.sh` via `.github/workflows/grafana-dashboards.yml`) |
| DO prod app spec | `.do/app.yaml` |
| DO dev app spec | `.do/app.dev.yaml` |
| Frontend auth pattern | `docs/patterns/frontend-auth.md` — required for all Next.js services |
| Backend propagation pattern | `docs/patterns/header-propagation.md` — required for all backend services |
| Nginx routing pattern (deprecated) | `docs/patterns/nginx-routing.md` — historical reference; nginx removed by feature 045 |
| Local env setup script | `scripts/localenv-setup.sh` |
| Proto-gen container | `Dockerfile.codegen` |
| Bootstrap script | `scripts/bootstrap.sh` |
| DB migration script | `scripts/db-migrate.sh` |
| User management script | `scripts/manage-users.sh` — also at `/app/scripts/manage-users.sh` inside the identity container |
| Proto gen script | `scripts/buf-gen.sh` |
| Integration tests | `scripts/integration-test.sh` |
| CI workflow | `.github/workflows/ci.yml` |
| Dev deploy workflow | `.github/workflows/deploy-dev.yml` |
| Prod deploy workflow | `.github/workflows/deploy-prod.yml` |
| Config rollout runbook | `docs/runbooks/config-rollout.md` |
| Approval flow | `docs/runbooks/approval-flow.md` |
| Proto versioning | `docs/runbooks/proto-versioning.md` |
| Feature workflow | `docs/runbooks/feature-workflow.md` |
| Reviewer registry | `docs/runbooks/reviewer-registry.md` |
| Feature merge order | `docs/roadmap/features/merge-order.md` |
| Implementation roadmap | `docs/roadmap/implementation-roadmap.md` |
| Phase deviation notes | `docs/roadmap/phase[3-7]-deviations.md` |

---

## Harness Default Branch

**The harness must always check out `main-dev` at session start.** Never begin work on a harness-assigned branch (e.g. `claude/*`). SDD skills read authoritative artifacts from `origin/feature/<slug>` or `origin/main-dev` via `git show` — the working-tree checkout must be `main-dev` so that any fallback reads and branch operations start from the correct base.

**All `claude/*` branches must be based on `main-dev`, not `main`.** When the harness creates or checks out a `claude/*` branch, it must branch from `main-dev` and open PRs targeting `main-dev`. Branching from `main` will pollute the PR with unrelated production commits.
