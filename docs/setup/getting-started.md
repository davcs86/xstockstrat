# Getting Started

Two tracks depending on your background:

- **[Track A — Quick Start](#track-a--quick-start)**: you know gRPC, protobuf, and monorepos. Get to a running local env in ~10 minutes.
- **[Track B — Deep Dive](#track-b--deep-dive)**: new to the stack or the architecture. Read this before Track A.

Both tracks end in the same place: all 13 services running locally via Docker Compose.

---

## Prerequisites

**Required to run the stack:**

| Tool | macOS (Homebrew) | Other |
|---|---|---|
| Git | pre-installed | https://git-scm.com |
| Docker with Compose v2 | `brew install --cask docker` | https://docs.docker.com/get-docker/ |

**Required to run tests and linters locally** (skip if you only need services running):

| Tool | Version | macOS (Homebrew) | Other |
|---|---|---|---|
| Go | 1.25 | `brew install go` | https://go.dev/dl/ |
| golangci-lint | v2.5.0 | `brew install golangci-lint` | `go install github.com/golangci/golangci-lint/cmd/golangci-lint@v2.5.0` |
| Python | 3.12 | `brew install python@3.12` | https://www.python.org/downloads/ |
| Node.js | 22 | `brew install node@22` | https://nodejs.org/ |
| pnpm | 9.15.0 | `brew install pnpm` | `npm install -g pnpm@9.15.0` |

`buf`, `migrate`, and `psql` are never required on the host — they run inside Docker containers.

---

## Track A — Quick Start

### Step 1 — Clone

```bash
git clone https://github.com/<your-org>/xstockstrat-orchestration.git
cd xstockstrat-orchestration
```

### Step 2 — Environment file

```bash
cp .env.example .env
```

**Three-file convention** — local dev uses three env files with different scopes:

| File | Committed? | Scope | Purpose |
|---|---|---|---|
| `.env` | **No** (secrets) | compose interpolation | Secrets: `POSTGRES_PASSWORD`, `DATABASE_URL`, `ALPACA_*`, `JWT_SECRET`, `GRAFANA_OTLP_TOKEN` |
| `.env.local` | Yes | all 13 containers | Structural non-secrets: `APPLICATION_ENV`, `NODE_ENV`, `GRAFANA_OTLP_ENDPOINT` |
| `.env.fe.local` | Yes | 3 Next.js containers only | Frontend-only non-secrets: `APP_URL` |

You only need to edit `.env`. The other two files are pre-populated and committed.

Edit `.env` and fill in the required values:

| Variable | Required? | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | Leave default | Must match the password in `DATABASE_URL`; default `devpassword` works for local dev |
| `DATABASE_URL` | Leave default | Default in `.env.example` connects to the Docker Compose TimescaleDB container |
| `ALPACA_API_KEY` | **Yes** | Paper trading key from alpaca.markets; used only by `xstockstrat-marketdata` |
| `ALPACA_API_SECRET` | **Yes** | Matching secret |
| `JWT_SECRET` | **Yes** | Generate: `openssl rand -hex 32` |
| `GRAFANA_OTLP_TOKEN` | Optional | Only needed when enabling OpenTelemetry; see [`setup/grafana-cloud.md`](grafana-cloud.md) |
| `GRAFANA_OTLP_ENDPOINT` | Optional | Override default `http://localhost:4317` with your real Grafana Cloud OTLP URL |

For Alpaca key setup, see [`setup/alpaca.md`](alpaca.md).

### Step 3 — Bootstrap

```bash
./scripts/bootstrap.sh
```

This script:
1. Verifies Docker is installed and the daemon is running (exits on failure)
2. Generates proto stubs inside Docker via `localenv-setup.sh` — skipped if stubs already exist
3. **If pnpm is installed:** installs Node.js dependencies for all 7 Node/Next.js services
4. **If python3 is installed:** installs Python dependencies for all 3 Python services

Steps 3 and 4 are optional — services run fine via Docker without them. Install the language toolchains and re-run `bootstrap.sh` any time you want to enable local test and lint runs.

### Step 4 — Start all services

```bash
docker compose up -d
```

On first run this builds all 13 service images plus the `db-migrator` image, which takes a few minutes. Docker Compose starts TimescaleDB first, runs `db-migrator` to apply all pending migrations, then starts all 13 application services.

### Step 5 — Verify

Check that the core services are up:

```bash
docker compose ps
```

All services should show `Up` or `healthy`. To spot-check specific services:

```bash
# Config service (must start first; all others depend on it)
curl -s http://localhost:8060/health

# Identity service
curl -s http://localhost:8058/health

# Ledger service
curl -s http://localhost:8057/health
```

If a service is not healthy, check its logs:

```bash
docker compose logs xstockstrat-config --tail=50
```

### Step 6 — Run tests and linters

Requires the language toolchains from the Prerequisites table. If `bootstrap.sh` skipped the dep installs because the tools were absent at that time, install them and re-run `bootstrap.sh` before proceeding.

#### Go (trading, portfolio, marketdata)

CI always uses `GOWORK=off` — match this locally:

```bash
cd services/xstockstrat-trading    && GOWORK=off go test -race ./...
cd services/xstockstrat-portfolio  && GOWORK=off go test -race ./...
cd services/xstockstrat-marketdata && GOWORK=off go test -race ./...

cd services/xstockstrat-trading    && golangci-lint run
cd services/xstockstrat-portfolio  && golangci-lint run
cd services/xstockstrat-marketdata && golangci-lint run
```

#### Python (indicators, ingest, analysis)

```bash
cd services/xstockstrat-indicators && pytest --cov && ruff check . && ruff format --check .
cd services/xstockstrat-ingest     && pytest --cov && ruff check . && ruff format --check .
cd services/xstockstrat-analysis   && pytest --cov && ruff check . && ruff format --check .
```

#### Node.js (ledger, identity, notify, config)

```bash
cd services/xstockstrat-ledger   && pnpm run lint && pnpm run test:coverage
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage
cd services/xstockstrat-notify   && pnpm run lint && pnpm run test:coverage
cd services/xstockstrat-config   && pnpm run lint && pnpm run test:coverage
```

#### Next.js frontends — lint + E2E (trader, insights, config-ui)

E2E tests require all services running (`docker compose up -d` first):

```bash
cd services/xstockstrat-trader     && pnpm run lint && pnpm exec playwright test
cd services/xstockstrat-insights   && pnpm run lint && pnpm exec playwright test
cd services/xstockstrat-config-ui  && pnpm run lint && pnpm exec playwright test
```

### Step 7 — Next steps

- Read [CLAUDE.md](../../CLAUDE.md) for the full architecture reference (service registry, proto governance, CI/CD, branch strategy).
- To start feature work: run `/sdd-story <slug>` in Claude Code, or read [`docs/runbooks/feature-workflow.md`](../runbooks/feature-workflow.md) for the manual path.
- To fix a bug: run `/sdd-triage <issue-number>` or read [`docs/runbooks/bug-triage.md`](../runbooks/bug-triage.md).

---

## Track B — Deep Dive

### Architecture Overview

**xstockstrat** is a stock strategy platform with real-time data ingestion, indicator computation, backtesting, order execution, and a live trading UI. The backend is 10 gRPC services; the frontend is 3 Next.js apps.

**This repo is the Spine.** It does not contain runtime service code. It owns:

- `packages/proto/` — all `.proto` files and generated stubs (Go, Python, TypeScript)
- `docs/` — runbooks, setup guides, and this roadmap
- `scripts/` — bootstrap, codegen, and migration helpers

Each service lives in `services/xstockstrat-<name>/` as a git subtree linked to its own GitHub repo. The Spine is the authoritative source; service repos are mirrors.

### Why Proto-First?

All inter-service contracts are defined in `.proto` files before any service code is written. This means:

1. Services cannot diverge on message shapes — the generated stubs are the contract.
2. Breaking changes (field removal, type change, service rename) require a PR to *this repo* with deprecation notice and migration notes — not a silent service-level change.
3. `buf lint` and `buf breaking` run on every PR. The CI `proto-freshness` job regenerates stubs and fails if committed stubs differ from what `buf generate` produces.

If you change a `.proto` file locally, always run `./scripts/buf-gen.sh` before committing.

### Why gRPC + Connect-RPC?

Services expose **two ports each**: a gRPC port (50051–50060) and an HTTP Connect-RPC port (8051–8060).

- **gRPC** (50XXX): used for internal service-to-service calls over HTTP/2. High throughput, binary encoding.
- **Connect-RPC** (80XX): used by browser clients (Next.js frontends) and n8n webhooks. Works over plain HTTP/1.1 with JSON, so no special proxy is needed.

Both ports speak the same proto-defined contracts. The Connect-RPC handler is thin wrapper around the same gRPC implementation.

### The Config Service is a Hard Dependency

`xstockstrat-config` (gRPC 50060 / HTTP 8060) streams live configuration to all other services via the `WatchConfig` RPC. **Every service blocks on this stream at startup** — they won't accept traffic until they receive their initial config snapshot.

In Docker Compose, `depends_on` enforces startup order. If the config service crashes, all services that depend on it will stop processing requests. Always check config service logs first when services appear unresponsive.

### Service Dependency Graph

```
xstockstrat-trader (UI, port 3000)
  └── xstockstrat-trading (gRPC 50051)
        ├── xstockstrat-marketdata (gRPC 50053)
        ├── xstockstrat-portfolio (gRPC 50052)
        ├── xstockstrat-indicators (gRPC 50054)
        └── xstockstrat-ledger (gRPC 50057)

xstockstrat-insights (UI, port 3001)
  └── xstockstrat-analysis (gRPC 50056)
        ├── xstockstrat-marketdata (gRPC 50053)
        ├── xstockstrat-indicators (gRPC 50054)
        └── xstockstrat-ledger (gRPC 50057)

All services → xstockstrat-config (WatchConfig stream, must start first)
All services → xstockstrat-ledger (event writes)
All services → xstockstrat-notify (alert emissions, gRPC 50059)
xstockstrat-ingest → xstockstrat-marketdata (raw data push)
xstockstrat-indicators → xstockstrat-ingest (QuerySignals)
xstockstrat-analysis → xstockstrat-ingest (QuerySignals)
```

Start order in migrations: `config → ledger → identity → marketdata → trading → portfolio → notify → ingest`

### Language Map

| Language | Services | Why |
|---|---|---|
| Go 1.25 | trading, portfolio, marketdata | High-throughput order execution and data ingestion |
| Python 3.12 | indicators, ingest, analysis | Formula sandboxing, numeric libraries (pandas, numpy) |
| Node.js 22 | ledger, identity, notify, config | Event-driven I/O, streaming, JWT handling |
| Next.js 14 | trader, insights, config-ui | React frontends with SSR (Node.js 22 runtime) |

### SDD Development Workflow

All feature work follows the **Spec-Driven Development (SDD)** loop:

```
/sdd-story <slug>          # Phase 1: generate product spec from a user story
/sdd-review <slug> product-spec   # AI review gate
/sdd-spec <slug>           # Phase 2: generate implementation spec (searches codebase for real file paths)
/sdd-review <slug> impl-spec      # Advisory review
/sdd-execute <slug> next   # Phase 3: execute one step at a time with confirmation gates
/sdd-status                # Check progress any time
```

Each feature lives in `docs/roadmap/features/NNN-<slug>/` with `feature.md`, `product-spec.md`, `implementation-spec.md`, and `context.md`. The `context.md` is an append-only session log — always read it before touching a feature.

For the manual (non-Claude Code) path, read [`docs/runbooks/feature-workflow.md`](../runbooks/feature-workflow.md).

### Key Reference Documents

| Topic | File |
|---|---|
| Full architecture, service registry, CI/CD | [`CLAUDE.md`](../../CLAUDE.md) |
| Runbooks index | [`docs/runbooks/CLAUDE.md`](../runbooks/CLAUDE.md) |
| External service setup (Alpaca, DO, Grafana, n8n) | [`docs/setup/`](.) |
| Implementation roadmap (7 phases) | [`docs/roadmap/implementation-roadmap.md`](../roadmap/implementation-roadmap.md) |
| Proto versioning and breaking changes | [`docs/runbooks/proto-versioning.md`](../runbooks/proto-versioning.md) |
| Config governance | [`CLAUDE.md` §Config Governance](../../CLAUDE.md) |
| Approval flow matrix | [`docs/runbooks/approval-flow.md`](../runbooks/approval-flow.md) |
| Bug triage and severity levels | [`docs/runbooks/bug-triage.md`](../runbooks/bug-triage.md) |

Now run [Track A](#track-a--quick-start) to get your local environment running.

---

## Troubleshooting

### Docker won't start / `docker info` fails
Start Docker Desktop. On Linux: `sudo systemctl start docker`.

### Port already in use
```bash
docker compose ps           # see which containers are running
lsof -i :8060               # find what's using a specific port
docker compose down         # stop all containers cleanly
```

### Proto gen fails (`localenv-setup.sh` errors)
```bash
docker image ls | grep codegen      # check if image exists
./scripts/localenv-setup.sh --no-cache   # force full rebuild
```

If the container exits immediately, check `Dockerfile.codegen` — the buf version pin may need updating.

### `bootstrap.sh` exits with an error
The only hard requirement is Docker with its daemon running. Start Docker Desktop and re-run `bootstrap.sh`. If Docker is running and it still fails, the error is from `localenv-setup.sh` (proto gen) — check the output and see the Proto gen section above.

### Database migration fails
```bash
docker compose logs db-migrator --tail=50   # check migration output
docker compose logs timescaledb --tail=30   # check DB is healthy
docker exec xstockstrat-db pg_isready -U xstockstrat   # manual health check
```

To re-run migrations without restarting everything: `docker compose up db-migrator --wait`

### Service crashes on startup with "config stream unavailable"
The config service must be healthy before other services start. Check it first:
```bash
docker compose logs xstockstrat-config --tail=50
curl -s http://localhost:8060/health
```

### Changes to a `.proto` file are not reflected in services
Re-generate stubs and rebuild:
```bash
./scripts/buf-gen.sh        # regenerate stubs
docker compose build        # rebuild affected service images
docker compose up -d        # restart
```
