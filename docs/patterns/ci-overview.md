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
| `python-lint` (×5, incl. `xstockstrat-smoke`) | `ruff check` + `ruff format --check` + `uv lock --check` (lock/pyproject sync, added 2026-07-27) | — |
| `python-test` (×5, incl. `xstockstrat-smoke`: wiring tests parse `.do/app*.yaml`, workflows and the cert scripts) | `pytest --cov` | 40% (indicators: 50%) |
| `node-lint` (×7) | `pnpm run lint` (all Node + Next.js services) | — |
| `node-test` (×4) | `pnpm run test:coverage` (Node.js services only) | 40% declared, not enforced (no `--check-coverage`; follow-up defect) |
| `ledger-db-test` | Applies all migrations to TimescaleDB, runs ledger `pnpm run test:db` (trigger-stub resolve, replay recovery, resolve bound) | — |
| `frontend-e2e-build` | Next.js production build for E2E (shared by shards) | — |
| `frontend-e2e` (×2 shards) | Playwright E2E, chromium only, sharded across 2 runners | — |
| `homelab-render` | `scripts/homelab-render.test.sh`: builds staging/production release `.env` files with the real scripts and checks the rendered `deploy/homelab/compose.yml` (staging: merged with `compose.smoke.yml`) with `render-assert.jq` (on `deploy/homelab/**`, `scripts/homelab-*`, `gen-dev-certs.sh`, `deploy-homelab.yml`) | — |
| `ledger-guard` | PRs only: `scripts/ledger-guard.py` fails when the PR's merge result deletes or alters another feature's entry in `docs/roadmap/ledger/{fails,insights}.md` (compared against the merge base, so a branch that is only behind passes; on `docs/roadmap/ledger/**`, `scripts/ledger-guard.py`) | — |

## Branch Protection — CI Gate

Every CI job except `secret-scan` is **path-filtered**: when the relevant files don't change, the
job is skipped and GitHub never reports a status for it. A branch-protection rule that requires a
skipped check blocks the PR forever.

The `CI Gate` job solves this. It `needs:` every other job, always runs (`if: always()`), and fails
only when an upstream job truly **failed** or was **cancelled**. Skipped jobs (no relevant paths
changed) are treated as passing.

**Branch protection must require only `CI Gate`** — never the individual job names. This is the
single required status check for PR merges on both `main-dev` and `main`.

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
| `main-dev` | push | Homelab **staging** VM (`deploy-homelab.yml`, GitHub environment `staging`) |
| `main` | push | Homelab **production** VM (`deploy-homelab.yml`, GitHub environment `production`, required reviewers, deployment branches `main` only) |

DO deployment waits up to 15 minutes for the App Platform phase to reach `ACTIVE`.

Smoke checks (feature 280) are staging-only: `docker-build.yml` builds `xstockstrat-smoke` with `SMOKE_GIT_SHA=${{ github.sha }}`
(the Dockerfile fails without it); `deploy.yml` mints the trigger leaf (`scripts/mint-smoke-trigger-leaf.sh`) only when the spec
carries its placeholders, and `deploy-dev.yml` alone passes `SMOKE_RESULTS_PAT` and `SMOKE_DB_PASSWORD` (`DEV_` secrets). The DO
`POST_DEPLOY` job `smoke-record` runs in record-only mode. Operation → `docs/runbooks/smoke-checks.md`.

The homelab jobs run beside the DO deploy from the same `docker-build.yml` images: staging while the repository variable
`HOMELAB_STAGING_ENABLED` is `true`, production while `HOMELAB_PRODUCTION_ENABLED` is `true` (each switch also builds
`xstockstrat-db-migrator`). The job checks out the images' own commit (a manual run of an older tag deploys that commit's
compose file and scripts) and refuses production from any ref but `main`. Each tag is resolved to a digest;
`scripts/homelab-release-env.sh` builds the `.env` (it owns the database names, `APPLICATION_ENV` and `TRADING_MODE`, the
digests and the per-deploy mTLS leaves) and `scripts/homelab-render-check.sh` verifies it without printing a value; the
release (`deploy/homelab/compose.yml` + `.env`) goes over the tailnet to homelab-edge's forced-command gate, and the VM
rolls back on its own if the release is not healthy. Setup and operation → homelab-edge `docs/runbooks/deploy-compose-app.md` § 4.1.

## Coverage notes

- Go: excludes `cmd/`, `handler/`, `repository/`, `telemetry/`, `service/` packages from threshold.
- Python ingest: pre-existing shortfall in infrastructure files (`http_server.py`, `main.py`, `telemetry.py`) offset by handler coverage.
- Node.js leaves (config, ledger, identity, notify): tests run compiled (`tsc && c8 … node --test dist/__tests__/*.test.js`), and the c8 table has a non-zero row per impl module. `--lines 40` is unenforced without `--check-coverage`; verify with `pnpm exec c8 check-coverage --lines 40` after `test:coverage` (follow-up defect `docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md`).
