# Contributing to xstockstrat-orchestration

## Local Setup

Follow **[docs/setup/getting-started.md](docs/setup/getting-started.md)** — it covers prerequisites, environment file, bootstrap, Docker Compose startup, health checks, and troubleshooting.

Short version:

```bash
git clone https://github.com/<your-fork>/xstockstrat-orchestration.git
cd xstockstrat-orchestration
cp .env.example .env
# Edit .env: set ALPACA_API_KEY, ALPACA_API_SECRET, JWT_SECRET (openssl rand -hex 32), POSTGRES_PASSWORD
./scripts/bootstrap.sh
docker compose up -d
docker compose ps   # all services should be Up or healthy
```

Paper trading is free — you do not need real money or a live brokerage account. See [`docs/setup/alpaca.md`](docs/setup/alpaca.md) to create a free paper trading account.

## Branch Naming

| Branch type | Convention | Example |
|---|---|---|
| Feature | `feature/<slug>` | `feature/add-new-indicator` |
| Bug fix | `hotfix/<slug>` | `hotfix/fix-fill-detection` |
| Harness | `claude/<description>` | `claude/add-claude-docs` |

Always branch from `main-dev`. **Never target `main` directly.**

## Fork and PR Workflow

1. Fork the repo on GitHub.
2. Create a branch from `main-dev` using the convention above.
3. Make your changes (code style requirements below).
4. Open a pull request targeting `main-dev`.
5. Wait for CI to pass (all jobs green).
6. Request review from a maintainer.

## Code Style

| Language | Tool | Command |
|---|---|---|
| Go | `golangci-lint v2.5.0` | `cd services/<name> && GOWORK=off golangci-lint run` |
| Python | `ruff` | `cd services/<name> && ruff check . && ruff format --check .` |
| Node.js / TypeScript | `eslint` | `cd services/<name> && pnpm run lint` |
| Proto | `buf lint` | `cd packages/proto && buf lint` |

## Running Tests

See [`docs/setup/getting-started.md` — Step 6](docs/setup/getting-started.md#step-6--run-tests-and-linters) for the full test commands by language. CI always uses `GOWORK=off` for Go — match this locally.

## Proto Changes

All `.proto` changes require a PR to this repo first. See [`docs/runbooks/approval-flow.md`](docs/runbooks/approval-flow.md) for approval requirements and [`docs/runbooks/proto-versioning.md`](docs/runbooks/proto-versioning.md) for breaking-change procedures. After any `.proto` change run `./scripts/buf-gen.sh` before committing.

## License

By contributing, you agree that your contributions will be licensed under the same license as this repository.

## Security Audit (Maintainers Only)

Before making this repository public, audit the full history of **all persistent
branches** (`main`, `main-dev`, and the current working branch). The `--all` flag
in the commands below covers every ref including `main` and `main-dev`.

```bash
# Fetch all remote branches so --all covers main and main-dev
git fetch --all

# Check for common secret patterns across entire history (all branches)
git log -S 'AKIA' --all --oneline         # AWS key prefixes
git log -S 'ghp_' --all --oneline         # GitHub PATs
git log -S 'glpat-' --all --oneline       # GitLab tokens
git log -S 'sk_live_' --all --oneline     # Stripe live keys
git log -S '-----BEGIN' --all --oneline   # PEM private keys
git log -S 'devpassword' --all --oneline  # internal dev DB password
```

If any commits are found (on **any** branch — including main or main-dev), use
`git filter-repo` to scrub the pattern from the entire history before going public.
This rewrites all commit SHAs, so all collaborators must re-clone after the purge:

```bash
pip install git-filter-repo
# Replace the matched literal string across all history
git filter-repo --replace-text <(printf 'AKIA==>REDACTED<==\nghp_==>REDACTED<==')
# Force-push all rewritten refs (main, main-dev, feature branches)
git push origin --force --all
git push origin --force --tags
```

The CI `secret-scan` job (trufflehog + gitleaks) runs on every PR automatically
going forward and scans the full commit history on each run.
