# Contributing to xstockstrat-orchestration

Thank you for your interest in contributing. This guide covers how to set up the local
development environment, how to submit changes, and what style requirements apply.

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

## Local Setup (paper trading — no real credentials required)

### Step 1 — Fork and clone

Fork the repo on GitHub, then clone your fork:

```bash
git clone https://github.com/<your-fork>/xstockstrat-orchestration.git
cd xstockstrat-orchestration
```

### Step 2 — Environment file

```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:

| Variable | Required? | Notes |
|---|---|---|
| `ALPACA_API_KEY` | **Yes** | Paper trading key from alpaca.markets — free, no real money needed |
| `ALPACA_API_SECRET` | **Yes** | Matching secret from alpaca.markets |
| `ALPACA_PAPER` | **Yes** | Keep `true` for local dev |
| `JWT_SECRET` | **Yes** | Generate: `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | **Yes** | Choose any password for the local TimescaleDB container |
| `DATABASE_URL` | Leave default | Pre-filled in `.env.example`; matches the local TimescaleDB container |
| `N8N_WEBHOOK_SECRET` | Optional | Only needed if testing n8n integrations locally |
| `OTEL_ENABLED` | Optional | Set `true` only if you have a Grafana Cloud account |

For Alpaca key setup, see [`docs/setup/alpaca.md`](docs/setup/alpaca.md).

### Step 3 — Bootstrap

```bash
./scripts/bootstrap.sh
```

This script verifies Docker is running, generates proto stubs inside Docker, and installs
Node.js and Python dependencies if those language toolchains are present on the host.

### Step 4 — Start all services

```bash
docker compose up -d
```

On first run this builds all service images, runs `db-migrator` to apply migrations, then
starts all 13 application services. Takes a few minutes on first run.

### Step 5 — Verify

```bash
docker compose ps
```

All services should show `Up` or `healthy`. Spot-check core services:

```bash
curl -s http://localhost:8060/health   # config service (all others depend on it)
curl -s http://localhost:8058/health   # identity service
curl -s http://localhost:8057/health   # ledger service
```

If a service is not healthy, check its logs: `docker compose logs xstockstrat-config --tail=50`

Full setup details and troubleshooting are in [`docs/setup/getting-started.md`](docs/setup/getting-started.md).

## Branch Naming

| Branch type | Convention | Example |
|---|---|---|
| Feature | `feature/<slug>` | `feature/add-new-indicator` |
| Bug fix | `hotfix/<slug>` | `hotfix/fix-fill-detection` |
| Harness | `claude/<description>` | `claude/add-claude-docs` |

Always branch from and open PRs into `main-dev`. **Never target `main` directly.**

## Fork and PR Workflow

1. Fork the repo on GitHub.
2. Create a branch from `main-dev` using the naming convention above.
3. Make your changes, following the code style requirements below.
4. Open a pull request targeting `main-dev`.
5. Wait for CI to pass (all jobs must be green).
6. Request review from a maintainer.

## Code Style Requirements

| Language | Tool | How to run |
|---|---|---|
| Go | `golangci-lint v2.5.0` | `cd services/<name> && GOWORK=off golangci-lint run` |
| Python | `ruff` | `cd services/<name> && ruff check . && ruff format --check .` |
| Node.js / TypeScript | `eslint` | `cd services/<name> && pnpm run lint` |
| Proto | `buf lint` | `cd packages/proto && buf lint` |

## Running Tests

CI always uses `GOWORK=off` for Go — match this locally.

#### Go (trading, portfolio, marketdata)

```bash
cd services/xstockstrat-trading    && GOWORK=off go test -race ./...
cd services/xstockstrat-portfolio  && GOWORK=off go test -race ./...
cd services/xstockstrat-marketdata && GOWORK=off go test -race ./...
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

#### Next.js frontends (trader, insights, config-ui)

E2E tests require all services running (`docker compose up -d` first):

```bash
cd services/xstockstrat-trader    && pnpm run lint && pnpm exec playwright test
cd services/xstockstrat-insights  && pnpm run lint && pnpm exec playwright test
cd services/xstockstrat-config-ui && pnpm run lint && pnpm exec playwright test
```

## Proto Changes

All `.proto` changes require a PR to this repository first. See
[`docs/runbooks/approval-flow.md`](docs/runbooks/approval-flow.md) for the approval gate
requirements and [`docs/runbooks/proto-versioning.md`](docs/runbooks/proto-versioning.md)
for breaking-change procedures.

After any `.proto` change, regenerate stubs before committing:

```bash
./scripts/buf-gen.sh
```

## License

By contributing, you agree that your contributions will be licensed under the same
license as this repository.
