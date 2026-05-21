# xstockstrat-orchestration — Root CLAUDE.md

## Project Overview

**xstockstrat-orchestration** is the spine repository for the xstockstrat platform — a hybrid multi-repo stock strategy system built on the **Spine pattern**. This repo owns:
- `packages/proto/` — single source of truth for all gRPC/Protobuf contracts
- `docs/` — runbooks, setup guides, and implementation roadmap
- `scripts/` — codegen, bootstrap, and CI helpers
- Root-level config governance documentation (this file)

All service repos are siblings under `services/`. They consume generated code from `packages/proto/` and coordinate via Connect-RPC (HTTP/1.1 + HTTP/2 with protobuf). Internal service-to-service calls use gRPC ports; browser/external clients use HTTP Connect-RPC ports.

---

## Context Guide

This file covers always-needed platform conventions. For larger reference sections, read only what is relevant to your current task — don't load the rest.

| Task | Read |
|---|---|
| Building or modifying a Next.js frontend | `docs/patterns/frontend-auth.md` |
| Adding nginx routing for a new frontend | `docs/patterns/nginx-routing.md` |
| Adding a new backend service (any language) | `docs/patterns/header-propagation.md` |
| Syncing git subtrees to/from service repos | `docs/patterns/git-subtree.md` |
| Config key naming, scoping, startup wiring | `docs/patterns/config-governance.md` |
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

---

## Service Registry

| Service | Language | Role | gRPC Port | HTTP (Connect-RPC) Port |
|---|---|---|---|---|
| xstockstrat-trading | Go | Order execution, trade lifecycle | 50051 | 8051 |
| xstockstrat-portfolio | Go | Position tracking, P&L | 50052 | 8052 |
| xstockstrat-marketdata | Go | Alpaca feed ingestion, OHLCV storage | 50053 | 8053 |
| xstockstrat-indicators | Python | Formula engine, sandboxed execution | 50054 | 8054 |
| xstockstrat-ingest | Python | Raw data normalization, event publishing | 50055 | 8055 |
| xstockstrat-analysis | Python | Strategy scoring, backtesting | 50056 | 8056 |
| xstockstrat-ledger | Node.js | Append-only event store | 50057 | 8057 |
| xstockstrat-identity | Node.js | Auth, API keys, JWT | 50058 | 8058 |
| xstockstrat-notify | Node.js | Connect-RPC streaming alert delivery | 50059 | 8059 |
| xstockstrat-config | Node.js | Live config WatchConfig stream | 50060 | 8060 |
| xstockstrat-trader | Next.js | Trading UI frontend | — | 3000 |
| xstockstrat-insights | Next.js | Analytics/insights dashboard | — | 3001 |
| xstockstrat-config-ui | Next.js | Config management UI | — | 3002 |
| xstockstrat-nginx | Nginx | HTTP reverse proxy, unified frontend ingress | — | 80 |

---

## Language Map

```
Go        → xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata
Python    → xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis
Node.js   → xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify, xstockstrat-config
Next.js   → xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui
```

---

## Language Versions & Tooling

| Language / Tool | Version | Notes |
|---|---|---|
| Go | 1.25 | `go.work` workspace file at repo root; use `GOWORK=off` for per-service builds |
| Python | 3.12 | Dependencies managed by `uv` / `pip install -e ".[dev]"` per service |
| Node.js | 22 | All Node/Next services |
| pnpm | 9.15.0 | Workspace manager (`pnpm-workspace.yaml`); `npm install -g pnpm@9.15.0` |
| buf | latest | Proto toolchain; installed by `scripts/bootstrap.sh` |
| golang-migrate | latest | DB migrations; installed by `scripts/bootstrap.sh` |
| golangci-lint | v2.5.0 | Go lint; run via `golangci-lint-action@v6` |
| ruff | latest | Python lint + format |
| Playwright | — | E2E tests for all three Next.js frontends |

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

4. Open a PR — CI will catch any missed files.

---

## Proto Contract Governance

All `.proto` changes require a PR to this repo first. `buf lint` + `buf breaking` run on every CI PR. Run `./scripts/buf-gen.sh` before committing (CI `proto-freshness` job enforces this).

For breaking-change workflow, BSR publishing, and approval requirements → `docs/runbooks/proto-versioning.md`.

---

## Approval Flow

See `docs/runbooks/approval-flow.md`. Breaking proto: 2 owners + platform lead. New config key: owner + config team. New service: platform lead. DB migration: DBA + service owner.

---

## Config Governance Rules

Config served by `xstockstrat-config` via `WatchConfig` RPC (gRPC 50060 / HTTP 8060). Key rules: no hardcoded values in source; naming is `<service>.<category>.<key>`; all services subscribe at startup; sensitive keys use `secret.*` prefix; defaults declared in each service's `CLAUDE.md`.

**Full rules, global key table, and registration steps** → `docs/patterns/config-governance.md`.

---

## Environment Variable Naming Convention

All inter-service connection env vars follow these patterns. **Never invent new suffixes** — use only the forms below.

| Pattern | Format | Used for | Example |
|---|---|---|---|
| `<SERVICE>_ENDPOINT` | `host:port` (no protocol) | gRPC connections | `IDENTITY_ENDPOINT=xstockstrat-identity:50058` |
| `<SERVICE>_HTTP_ENDPOINT` | `http://host:port` (full URL) | HTTP Connect-RPC + webhook calls | `INGEST_HTTP_ENDPOINT=http://xstockstrat-ingest:8055` |
| `XSTOCKSTRAT_<SERVICE>_PRIVATE_URL` | bare hostname on DO, container name in Compose | **nginx container only** — `envsubst` upstream resolution | `XSTOCKSTRAT_AGENT_PRIVATE_URL=xstockstrat-agent` |

**Rules:**
- No `XSTOCKSTRAT_` prefix except for nginx `PRIVATE_URL` vars.
- No `_URL` suffix on inter-service connection vars — always `_ENDPOINT` or `_HTTP_ENDPOINT`.
- `_ENDPOINT` and `_HTTP_ENDPOINT` for the same service coexist when a caller needs both gRPC and HTTP access.
- When a new service introduces connection env vars, check `docker-compose.yml` first — the var may already exist in another service's block and only needs to be added to the new service's block with the same value.
- `N8N_WEBHOOK_SECRET` was removed by feature 011 (`remove-n8n-references`). Do not reference it. The MCP agent uses `MCP_AGENT_SECRET` (sent as `x-mcp-secret` header on outbound calls to identify itself to platform services); the receiving services do not currently enforce it.

---

## Database

TimescaleDB (PostgreSQL). Each service owns its schema; migrations run via `scripts/db-migrate.sh` (golang-migrate). Convention: `NNN_description.up.sql` + `.down.sql` in `services/<service>/migrations/`. Never edit an applied migration — add a new numbered one instead.

**Schema map, migration run order, and step-by-step guide** → `docs/patterns/database.md`.

---

## Webhook Integration

Selected services expose HTTP webhook handlers (under `/webhooks/`) on the HTTP port (80XX) alongside the Connect-RPC routes. The agent MCP server (009) and other callers trigger these handlers for signal ingestion, alert emission, and backtest triggering.

Pattern:
```
Agent / Caller → POST /webhooks/<action> → service webhook handler → internal gRPC client → target service
```

Connect-RPC is directly callable from the agent or any HTTP client via POST to the service's Connect-RPC endpoint (port 80XX), using JSON or protobuf encoding.

---

## Observability

OTel SDK → OTLP → Grafana Cloud. Toggle: `OTEL_ENABLED=true`. OTel init errors must never prevent startup. Each service has `internal/telemetry/` (Go), `app/telemetry.py` (Python), or `src/telemetry.ts` (Node.js).

**Env var table, local vs. prod endpoints, and per-language patterns** → `docs/patterns/observability.md`.

---

## Nginx Reverse Proxy

`xstockstrat-nginx` (port 80) proxies all frontend requests to the three Next.js UIs via upstream blocks in `nginx.conf`. Routes: `/trader/*` → port 3000, `/insights/*` → 3001, `/config-ui/*` → 3002. Health: `GET /health`.

**Adding a new frontend or changing nginx routing** → read `docs/patterns/nginx-routing.md` for the full 8-step procedure (nginx.conf, docker-entrypoint.sh, DO specs, docker-compose, next.config.js, auth wiring).

---

## Frontend Authentication Pattern

Every new Next.js frontend **must** implement JWT auth via `lib/auth.ts` (Edge Runtime, `jose`), `middleware.ts` (route protection + trace ID injection), `/api/auth/{login,refresh,logout}` routes, and forward `x-user-id` / `x-access-scope` / `x-trace-id` on all outbound fetches. Required env vars: `JWT_SECRET`, `IDENTITY_HTTP_ENDPOINT`.

**Full pattern, required files, and code snippets** → read `docs/patterns/frontend-auth.md`. Reference implementation: `services/xstockstrat-trader/`.

---

## Generating Proto Stubs

Run `./scripts/buf-gen.sh` — generates TypeScript, Python, and Go stubs and compiles the TS package. Run after any `.proto` change. For manual `buf` commands and BSR publishing → `docs/runbooks/proto-versioning.md`.

---

## Repository Bootstrap

First time: `./scripts/localenv-setup.sh` (builds proto-gen container, generates stubs via Docker — no Go/Python/Node required on host). Then: `./scripts/bootstrap.sh` (installs deps, starts TimescaleDB, runs migrations). Re-run `./scripts/buf-gen.sh` after proto changes; `./scripts/db-migrate.sh` for pending migrations.

---

## CI/CD Overview

CI runs on every PR to `main-dev` or `main`. Coverage thresholds: Go/Python/Node.js ≥40% (indicators ≥50%). Deploys: `main-dev` push → DO dev app; `main` push → DO prod app.

**Full job matrix, coverage notes, and deployment pipeline** → `docs/patterns/ci-overview.md`.

---

## Inter-Service Dependencies

```
xstockstrat-trader (UI)
  └── xstockstrat-trading (gRPC)
        ├── xstockstrat-marketdata (gRPC)
        ├── xstockstrat-portfolio (gRPC)
        ├── xstockstrat-indicators (gRPC)
        └── xstockstrat-ledger (gRPC write)

xstockstrat-insights (UI)
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

Every backend service **must** propagate `x-user-id`, `x-access-scope`, and `x-trace-id` from inbound requests to all outbound gRPC/Connect-RPC calls. Nginx strips them from external requests so they are trusted as platform-internal values.

**Language-specific patterns (Go interceptor, Python per-method, Node.js AsyncLocalStorage), code snippets, and reference implementations** → read `docs/patterns/header-propagation.md`.

---

## Git Subtree Workflow

`services/<name>/` directories are linked to individual GitHub repos via `git subtree`. Push: `./scripts/subtree-sync.sh push <service>`. Pull: `./scripts/subtree-sync.sh pull <service>`. Always pull before editing if someone may have pushed directly to a service repo.

**Full workflow, initial setup, and rules** → read `docs/patterns/git-subtree.md`.

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
| Phase 5 | UI layer: trader, insights, config-ui | **DONE** |
| Phase 6 | Integration & webhook wiring | **DONE** |
| Phase 7 | Observability: OTel + Grafana Cloud | Pending |

Deviation notes for completed phases: `docs/roadmap/phase[3-6]-deviations.md`.

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
| Next.js UIs | `services/xstockstrat-{trader,insights,config-ui}/` |
| Docker Compose | `docker-compose.yml` |
| OTel Collector config | `packages/otel/otel-collector-config.yaml` |
| DO prod app spec | `.do/app.yaml` |
| DO dev app spec | `.do/app.dev.yaml` |
| Nginx config | `nginx.conf` (root), `services/xstockstrat-nginx/Dockerfile`, `services/xstockstrat-nginx/docker-entrypoint.sh` |
| Frontend auth pattern | `docs/patterns/frontend-auth.md` — required for all Next.js services |
| Backend propagation pattern | `docs/patterns/header-propagation.md` — required for all backend services |
| Nginx routing pattern | `docs/patterns/nginx-routing.md` — required when adding a new frontend |
| Git subtree workflow | `docs/patterns/git-subtree.md` |
| Local env setup script | `scripts/localenv-setup.sh` |
| Proto-gen container | `Dockerfile.codegen` |
| Bootstrap script | `scripts/bootstrap.sh` |
| DB migration script | `scripts/db-migrate.sh` |
| Proto gen script | `scripts/buf-gen.sh` |
| Subtree sync script | `scripts/subtree-sync.sh` |
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
| Phase deviation notes | `docs/roadmap/phase[3-6]-deviations.md` |

---

## Harness Default Branch

**The harness must always check out `main-dev` at session start.** Never begin work on a harness-assigned branch (e.g. `claude/*`). SDD skills read authoritative artifacts from `origin/feature/<slug>` or `origin/main-dev` via `git show` — the working-tree checkout must be `main-dev` so that any fallback reads and branch operations start from the correct base.

**All `claude/*` branches must be based on `main-dev`, not `main`.** When the harness creates or checks out a `claude/*` branch, it must branch from `main-dev` and open PRs targeting `main-dev`. Branching from `main` will pollute the PR with unrelated production commits.
