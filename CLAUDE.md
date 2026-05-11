# xstockstrat-orchestration — Root CLAUDE.md

## Project Overview

**xstockstrat-orchestration** is the spine repository for the xstockstrat platform — a hybrid multi-repo stock strategy system built on the **Spine pattern**. This repo owns:
- `packages/proto/` — single source of truth for all gRPC/Protobuf contracts
- `docs/` — runbooks, setup guides, and implementation roadmap
- `scripts/` — codegen, bootstrap, and CI helpers
- Root-level config governance documentation (this file)

All service repos are siblings under `services/`. They consume generated code from `packages/proto/` and coordinate via Connect-RPC (HTTP/1.1 + HTTP/2 with protobuf). Internal service-to-service calls use gRPC ports; browser/external clients use HTTP Connect-RPC ports.

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

## Spine Pattern

The **Spine** is this orchestration repo. It does not contain runtime service code. It owns:
1. **Proto contracts** (`packages/proto/`) — all `.proto` files; all generated stubs live here after `buf generate`
2. **Docs** (`docs/`) — runbooks, setup guides, and implementation roadmap (`docs/runbooks/`, `docs/setup/`, `docs/roadmap/`)
3. **Scripts** (`scripts/`) — `buf-gen.sh`, `bootstrap.sh`, `db-migrate.sh`
4. **Config schema** — canonical list of config keys consumed by each service

Services reference this repo as a git submodule or via the generated package registry (npm, PyPI, Go module proxy) depending on language.

---

## Proto Contract Governance

- All `.proto` changes require a PR to **this repo** first.
- Breaking changes (field removal, type change, service rename) require:
  1. Deprecation comment in `.proto` for one release cycle
  2. Migration note in `docs/runbooks/config-rollout.md`
  3. Approval from 2 service owners (see Approval Flow below)
- `buf lint` and `buf breaking` run on every PR via CI.
- Generated stubs are committed to `packages/proto/gen/` and versioned.
- CI enforces freshness: `proto-freshness` job regenerates stubs and fails if the committed stubs differ — run `./scripts/buf-gen.sh` before committing proto changes.
- Proto definitions are published to the **Buf Schema Registry (BSR)** on push to `main` (production) and as a draft on push to `main-dev` (requires `BUF_TOKEN` secret).
- For v1/v2 breaking-change workflow, see `docs/runbooks/proto-versioning.md`.

---

## Approval Flow

See `docs/runbooks/approval-flow.md` for full detail. Summary:

| Change Type | Required Approvers |
|---|---|
| New proto field (non-breaking) | 1 service owner |
| Breaking proto change | 2 service owners + platform lead |
| New config key | Service owner + config team |
| Config key removal | Config team + all consuming services |
| New service addition | Platform lead |
| Database schema migration | DBA review + service owner |

---

## Config Governance Rules

All runtime configuration is served by **xstockstrat-config** via `WatchConfig` streaming RPC (gRPC on port 50060 / Connect-RPC on port 8060). Rules:

1. **No hardcoded config values** in service source code. All env-specific values must be registered in the config service.
2. **Config key naming convention**: `<service-short-name>.<category>.<key>` — e.g., `indicators.sandbox.timeout_ms`
3. **All services subscribe to xstockstrat-config at startup** before accepting traffic. They must pass `environment` and `trading_mode` in the WatchConfig request.
4. **Config values are scoped** by `environment` (`dev`/`production`) and `trading_mode` (`paper`/`live`/`all`). Rows with `trading_mode='all'` apply to all modes.
5. **Config changes flow via n8n** → config webhook handler → config service → WatchConfig stream → all subscribers.
6. **Sensitive keys** (API keys, secrets) use the `secret.*` prefix and are resolved from the secret store at runtime; they are never stored in config service state.
7. **Default values** must be declared in each service's `CLAUDE.md` under "Config Keys".
8. **Config UI** available at `http://localhost:3002` — manage config values by environment and trading mode.

### Global Config Keys

| Key | Type | Default | Description |
|---|---|---|---|
| `platform.maintenance_mode` | bool | false | Halts all trading operations |
| `platform.log_level` | string | info | Global log level override |
| `platform.ledger_endpoint` | string | — | xstockstrat-ledger gRPC address |
| `platform.config_endpoint` | string | — | xstockstrat-config gRPC address |
| `platform.otel.enabled` | bool | false | Master OTel export switch |
| `platform.otel.endpoint` | string | — | OTLP endpoint (set via secret) |
| `platform.otel.sample_rate` | float | 1.0 | Trace sample rate (0.0–1.0) |

---

## Database

**Primary DB**: TimescaleDB (PostgreSQL extension)

| Service | Schema | Hypertable | Partition By |
|---|---|---|---|
| xstockstrat-marketdata | marketdata | ohlcv | time (1 day chunks) |
| xstockstrat-marketdata | marketdata | quotes | time (1 hour chunks) |
| xstockstrat-ledger | ledger | events | time (1 day chunks) |
| xstockstrat-trading | trading | orders | time (1 day chunks) |
| xstockstrat-portfolio | portfolio | snapshots | time (1 day chunks) |
| xstockstrat-ingest | ingest | newsletter_signals | ingested_at (7 day chunks) |

All services run migrations against their own schema, orchestrated centrally by `scripts/db-migrate.sh` using **golang-migrate**. State is tracked in a `schema_migrations` table inside each service's schema so re-runs only apply new files.

**Migration run order** (dependency-respecting): `config → ledger → identity → marketdata → trading → portfolio → notify → ingest`

**Migration file convention**: `NNN_description.up.sql` + `NNN_description.down.sql` in `services/<service>/migrations/`. NNN is a zero-padded sequence number continuing from the last file in that service's directory.

**To add a new migration:**
1. Create `services/<service>/migrations/NNN_description.up.sql` with the schema change
2. Create a matching `NNN_description.down.sql` (rollback SQL, or a stub comment if rollback is not supported)
3. Test locally: `./scripts/db-migrate.sh`
4. On DigitalOcean, the `db-migrator` PRE_DEPLOY job runs automatically on every deploy — no manual step needed

---

## n8n Cloud Integration

Each service exposes HTTP webhook handlers (under `/webhooks/n8n/`) on the HTTP port (80XX) alongside the Connect-RPC routes. n8n workflows trigger on external events (alerts, schedule, external APIs) and call these handlers.

Pattern:
```
n8n Cloud → POST /webhooks/n8n/<action> → service webhook handler → internal gRPC client → target service
```

Connect-RPC is also directly callable from n8n via HTTP POST to the service's Connect-RPC endpoint (port 80XX), using JSON or protobuf encoding.

n8n workflow files are stored in `packages/n8n/workflows/`. See `docs/setup/n8n.md` for import instructions.

---

## Observability

**Stack**: OpenTelemetry SDK (per-language) → OTLP push → Grafana Cloud (Loki + Mimir + Tempo)

- **Local dev**: Services push OTLP to `otel-collector:4317` (Docker Compose). Config: `packages/otel/otel-collector-config.yaml`.
- **Production**: Services push OTLP directly to Grafana Cloud OTLP gateway (no collector needed on DO App Platform).
- **Toggle**: Set `OTEL_ENABLED=true` env var on each service. Config key `platform.otel.enabled` provides a live switch without restart.
- **Non-fatal**: OTel init errors never prevent service startup.

Key env vars (read by OTel SDK automatically):

| Variable | Local Dev | Production |
|---|---|---|
| `OTEL_ENABLED` | `true` | `true` |
| `OTEL_SERVICE_NAME` | `xstockstrat-<name>` | `xstockstrat-<name>` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4317` | Grafana Cloud OTLP URL |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | `Authorization=Basic <token>` |
| `OTEL_RESOURCE_ATTRIBUTES` | `environment=dev,trading_mode=paper` | `environment=production,...` |

Each service has an `internal/telemetry/` (Go), `app/telemetry.py` (Python), or `src/telemetry.ts` (Node.js) module. See Phase 7 in `docs/roadmap/implementation-roadmap.md` for per-language implementation patterns.

---

## Generating Proto Stubs

```bash
cd packages/proto
buf generate          # generates TypeScript, Python, Go stubs
buf lint              # lint all protos
buf breaking --against '.git#branch=main-dev'  # check for breaking changes against dev trunk
```

Or use the wrapper script (also runs TS compilation):

```bash
./scripts/buf-gen.sh
```

Generated output:
- `packages/proto/gen/go/` — Go stubs (consumed by Go services as local module)
- `packages/proto/gen/python/` — Python stubs (installed via `pip -e`)
- `packages/proto/gen/ts/` — TypeScript stubs + compiled JS in `gen/ts/dist/`

**Node/Next.js services** consume TS stubs via the `@xstockstrat/proto` workspace package. Build it before running Node lint/test:

```bash
pnpm --filter @xstockstrat/proto run build
```

---

## Repository Bootstrap

```bash
./scripts/localenv-setup.sh  # (first time only) build proto-gen container + generate stubs
./scripts/bootstrap.sh       # install service deps, start TimescaleDB, run migrations
./scripts/buf-gen.sh         # re-run any time proto files change
./scripts/db-migrate.sh      # run pending DB migrations
```

`localenv-setup.sh` uses Docker to generate proto stubs (`packages/proto/gen/`) without
installing Go, Python, or Node on the host. Run it once after cloning, or any time the
generated stubs are missing (e.g. after a fresh clone or a clean). After it completes,
`docker compose build` will succeed.

---

## CI/CD Overview

CI runs on every PR targeting `main-dev` or `main` (`.github/workflows/ci.yml`).

### CI Jobs

| Job | What it checks | Coverage threshold |
|---|---|---|
| `proto-lint` | `buf lint` on `packages/proto/` | — |
| `proto-freshness` | Regenerates stubs, fails on diff with committed stubs | — |
| `buf-push` | Publishes to BSR on push to `main` (production) | — |
| `buf-push-dev` | Publishes to BSR as draft on push to `main-dev` | — |
| `go-lint` (×3) | `golangci-lint` per Go service | — |
| `go-test` (×3) | `go test -race` + coverage (excludes cmd/handler/repository/telemetry/service packages) | 40% |
| `python-lint` (×3) | `ruff check` + `ruff format --check` | — |
| `python-test` (×3) | `pytest --cov` | 40% (indicators: 50%) |
| `node-lint` (×7) | `pnpm run lint` (all Node + Next.js services) | — |
| `node-test` (×4) | `pnpm run test:coverage` (Node.js services only) | 40% |
| `frontend-e2e` (×3) | Playwright on trader, insights, config-ui | — |

### Deployment Pipelines

| Branch | Trigger | Target |
|---|---|---|
| `main-dev` | push | DigitalOcean App Platform **dev** (`DO_DEV_APP_ID` / `.do/app.dev.yaml`) |
| `main` | push | DigitalOcean App Platform **prod** (`DO_APP_ID` / `.do/app.yaml`) |

Deployment waits up to 15 minutes for the DO App Platform phase to reach `ACTIVE`.

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

## Git Subtree Workflow

Each `services/<name>/` directory is linked to its own remote GitHub repo via `git subtree`. The monorepo remains the canonical source; service repos are mirrors for independent CI and direct service work.

### Initial Setup (run once)

Requires `gh` CLI installed and authenticated (`gh auth login`):

```bash
./scripts/subtree-setup.sh
```

This creates each service's GitHub repo, splits the `services/<name>/` history, and pushes to `main` on each remote.

### Push changes (monorepo → service repo)

```bash
./scripts/subtree-sync.sh push xstockstrat-config   # single service
./scripts/subtree-sync.sh push all                  # all services
```

### Pull changes (service repo → monorepo)

```bash
./scripts/subtree-sync.sh pull xstockstrat-config   # single service
./scripts/subtree-sync.sh pull all                  # all services
```

### Rules

- **Never edit `services/<name>/` in both the monorepo and the service repo between syncs** without pulling first — this will cause merge conflicts.
- Always run `subtree-sync.sh pull <service>` before starting work if someone else may have pushed directly to a service repo.
- `git subtree pull` uses `--squash` to keep monorepo history clean.
- Service remotes are named after the service (e.g., `xstockstrat-config`). View all with `git remote -v`.

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
| Phase 6 | Integration & n8n wiring | **DONE** |
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
| `004-make-repo-public-secure` | `in-progress` | `feature/make-repo-public-secure` | `/sdd-execute make-repo-public-secure next` (Step 3 next) |

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
| n8n workflow files | `packages/n8n/workflows/` |
| DO prod app spec | `.do/app.yaml` |
| DO dev app spec | `.do/app.dev.yaml` |
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
