# CI/CD Overview

CI runs on every PR targeting `main-dev` or `main` (`.github/workflows/ci.yml`).

## CI Jobs

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

## Local guard rails (not CI jobs)

Some guard rails run **locally** (git hooks / Claude subagent), deliberately **not** as CI jobs:

| Guard rail | Where | What it does |
|---|---|---|
| DRY duplication rail | `.husky/pre-commit` + `scripts/check-duplication.sh` (jscpd) + UI ESLint rules + `dry-reviewer` subagent | Blocks new duplicated constants/literals/types/helpers in `xstockstrat-ui` on commit; report-only elsewhere. Full pattern → `docs/patterns/dry-guard-rail.md`. |

## Deployment Pipelines

| Branch | Trigger | Target |
|---|---|---|
| `main-dev` | push | DigitalOcean App Platform **dev** (`DO_DEV_APP_ID` / `.do/app.dev.yaml`) |
| `main` | push | DigitalOcean App Platform **prod** (`DO_APP_ID` / `.do/app.yaml`) |

Deployment waits up to 15 minutes for the DO App Platform phase to reach `ACTIVE`.

## Coverage notes

- Go: excludes `cmd/`, `handler/`, `repository/`, `telemetry/`, `service/` packages from threshold.
- Python ingest: pre-existing shortfall in infrastructure files (`http_server.py`, `main.py`, `telemetry.py`) offset by handler coverage.
- Node.js: `0%` shown in c8 table is a known TypeScript tooling artefact — tests do pass.
