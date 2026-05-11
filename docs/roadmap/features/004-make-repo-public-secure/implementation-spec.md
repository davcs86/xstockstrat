# Implementation Spec: make-repo-public-secure

**Status**: `pending`
**Created**: 2026-05-10
**Feature**: `docs/roadmap/features/004-make-repo-public-secure/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/make-repo-public-secure`

---

## Execution Summary

The implementation proceeds in three logical waves. Wave 1 (Steps 1–4) eliminates all
hardcoded credentials and dev-only secrets from committed source files: the docker-compose
file, the identity service fallback, the ingest service fallback, and the db-migrate
script. Wave 2 (Steps 5–6) adds the required public-repo hygiene files: SECURITY.md,
CONTRIBUTING.md, a completed .gitignore, and a secret-scan CI job. Wave 3 (Steps 7–9)
replaces internal account identifiers (the GitHub username `davcs86`) in docs and app
specs, and documents the git-history audit process.

Steps 1–4 are independent of each other and can be executed in any order. Steps 5 and 6
are independent of each other. Steps 7–9 depend only on completing Wave 1 (the repo must
be sanitised before docs are updated to reference it as a public URL).

---

## Step Dependencies

- Steps 1–4 are mutually independent (different files).
- Steps 5–6 are mutually independent (new files).
- Steps 7–8 should follow Step 1–4 so that internal references to cleaned paths are
  accurate in docs.
- Step 9 (CI secret-scan job) must be done last so that gitleaks/trufflehog run against
  the already-cleaned working tree.

---

### Step 1 — service: Harden `docker-compose.yml` hardcoded dev credentials

**Status**: `pending`
**Service**: `docker-compose.yml` (root)
**Files**:
- `docker-compose.yml` — modify

**Reviewers**: Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via grep: `docker-compose.yml:44: POSTGRES_PASSWORD: devpassword` (literal string, not env-var-interpolated)
- Confirmed via grep: `docker-compose.yml:65:  DATABASE_URL: postgres://xstockstrat:devpassword@timescaledb:5432/xstockstrat?sslmode=disable` (appears 8 more times on L84, L113, L145, L180, L215, L315, L353, L390, L484)
- Confirmed via grep: `docker-compose.yml:146: JWT_SECRET: dev-jwt-secret-change-in-production` (literal string in identity service block)
- Confirmed via grep: `docker-compose.yml:216: ALPACA_API_KEY: ${ALPACA_API_KEY:-your-api-key}` and `docker-compose.yml:217: ALPACA_API_SECRET: ${ALPACA_API_SECRET:-your-api-secret}` — already use env-var interpolation with visible fallback strings.
- `.env.example` already exists at repo root with `DATABASE_URL=postgres://xstockstrat:devpassword@localhost:5432/xstockstrat?sslmode=disable` (acceptable — it's an example file).

**Instructions**:

1. Change the `timescaledb` service's `POSTGRES_PASSWORD` from the literal `devpassword` to `${POSTGRES_PASSWORD:-devpassword}` so the password is overrideable via `.env` without changing the local-dev default behavior.

2. Change all `DATABASE_URL: postgres://xstockstrat:devpassword@timescaledb:5432/xstockstrat?sslmode=disable` lines (L65, L84, L113, L145, L180, L215, L315, L353, L390, L484) to `DATABASE_URL: ${DATABASE_URL:-postgres://xstockstrat:devpassword@timescaledb:5432/xstockstrat?sslmode=disable}` — follows the same pattern as `ALPACA_API_KEY` and `GRAFANA_OTLP_TOKEN` already use in this file.

3. Change the identity service's `JWT_SECRET: dev-jwt-secret-change-in-production` (L146) to `JWT_SECRET: ${JWT_SECRET:-dev-jwt-secret-change-in-production}` — keeps local dev functional without real secret but allows override.

4. The `ALPACA_API_KEY`/`ALPACA_API_SECRET` fallback strings (`your-api-key`, `your-api-secret`) are already behind `${:-}` interpolation — leave them as is.

5. Add a comment block above the `timescaledb` service:
   ```
   # Local dev only — devpassword is safe for localhost Docker only.
   # Set POSTGRES_PASSWORD, DATABASE_URL, and JWT_SECRET in .env for non-default values.
   ```

**Verification**:
```bash
grep -E "devpassword|dev-jwt-secret" docker-compose.yml
# Expected: all occurrences are wrapped in ${VAR:-...} interpolation, not bare literals
docker compose config | grep -E "POSTGRES_PASSWORD|JWT_SECRET" | head -5
# Expected: shows the resolved values (defaults when .env not present)
```

---

### Step 2 — service: Remove hardcoded JWT fallback from identity service

**Status**: `pending`
**Service**: `xstockstrat-identity` (Node.js)
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config)

**Codebase Evidence**:
- Confirmed via read: `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:17–19`:
  ```typescript
  private get jwtSecret(): string {
    // Secret keys are not stored in config service — sourced from env only
    return process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production';
  }
  ```
- The fallback string `'dev-jwt-secret-change-in-production'` is committed source code visible on public GitHub.

**Instructions**:

1. In `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts`, modify the `jwtSecret` getter at L17–19 to throw a startup error instead of falling back to a hardcoded string:

   ```typescript
   private get jwtSecret(): string {
     // Secret keys are not stored in config service — sourced from env only.
     // JWT_SECRET must be set in the environment; see .env.example.
     const secret = process.env.JWT_SECRET;
     if (!secret) {
       throw new Error('JWT_SECRET environment variable is required but not set. See .env.example.');
     }
     return secret;
   }
   ```

   This is a safe change: in local dev, `.env` will contain `JWT_SECRET` (see `.env.example` L17: `JWT_SECRET=change-me-in-production-use-32-char-minimum`). In production, JWT_SECRET is injected by the secret store. The service failing fast on missing JWT_SECRET is strictly safer than silently using a known-public key.

**Verification**:
```bash
grep -n "dev-jwt-secret" services/xstockstrat-identity/src/grpc/identityServiceImpl.ts
# Expected: no output (string removed)
grep -n "JWT_SECRET" services/xstockstrat-identity/src/grpc/identityServiceImpl.ts
# Expected: lines showing process.env.JWT_SECRET and the error throw
```

---

### Step 3 — service: Remove hardcoded database URL fallback from ingest service

**Status**: `pending`
**Service**: `xstockstrat-ingest` (Python)
**Files**:
- `services/xstockstrat-ingest/app/main.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Confirmed via read: `services/xstockstrat-ingest/app/main.py:37–39`:
  ```python
  DATABASE_URL = os.environ.get(
      "DATABASE_URL", "postgres://xstockstrat:devpassword@localhost:5432/xstockstrat"
  )
  ```
- The literal `devpassword` is embedded in source code visible on public GitHub.
- Pattern used by other env vars in same file (L32–36) uses `os.environ.get("VAR", "default")` without credentials.

**Instructions**:

1. In `services/xstockstrat-ingest/app/main.py`, change the `DATABASE_URL` assignment at L37–39 to:
   ```python
   DATABASE_URL = os.environ.get(
       "DATABASE_URL", "postgres://xstockstrat:devpassword@localhost:5432/xstockstrat"
   )
   ```
   Replace with:
   ```python
   DATABASE_URL = os.environ.get("DATABASE_URL")
   if not DATABASE_URL:
       raise RuntimeError(
           "DATABASE_URL environment variable is required but not set. See .env.example."
       )
   ```

   This matches how production deployments work (DATABASE_URL is always injected) and prevents confusing connection failures in local dev when `.env` is missing.

**Verification**:
```bash
grep -n "devpassword" services/xstockstrat-ingest/app/main.py
# Expected: no output
grep -n "DATABASE_URL" services/xstockstrat-ingest/app/main.py
# Expected: shows os.environ.get("DATABASE_URL") and RuntimeError raise
```

---

### Step 4 — service: Remove hardcoded database URL fallback from db-migrate.sh

**Status**: `pending`
**Service**: `scripts/` (bootstrap tooling)
**Files**:
- `scripts/db-migrate.sh` — modify

**Reviewers**: Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via read: `scripts/db-migrate.sh:19`:
  ```bash
  DB_URL="${DATABASE_URL:-postgres://xstockstrat:devpassword@localhost:5432/xstockstrat?sslmode=disable}"
  ```
- This script runs inside the `db-migrator` Docker container where `DATABASE_URL` is always injected (confirmed via `docker-compose.yml:65` and `scripts/Dockerfile.migrate`). The fallback is never needed in container context; it only exists for local-host invocation convenience.

**Instructions**:

1. In `scripts/db-migrate.sh`, change line 19 from:
   ```bash
   DB_URL="${DATABASE_URL:-postgres://xstockstrat:devpassword@localhost:5432/xstockstrat?sslmode=disable}"
   ```
   to:
   ```bash
   if [ -z "${DATABASE_URL:-}" ]; then
     echo "ERROR: DATABASE_URL is required. Set it in .env or export it before running this script."
     echo "  Example: export DATABASE_URL=postgres://xstockstrat:<password>@localhost:5432/xstockstrat?sslmode=disable"
     exit 1
   fi
   DB_URL="${DATABASE_URL}"
   ```

   Note: The example in the error message uses `<password>` as a placeholder — no real credential.

**Verification**:
```bash
grep -n "devpassword" scripts/db-migrate.sh
# Expected: no output
DATABASE_URL="" bash scripts/db-migrate.sh 2>&1 | grep "ERROR"
# Expected: prints the error message and exits non-zero
```

---

### Step 5 — docs: Add .gitignore entries for secret file patterns

**Status**: `pending`
**Service**: Root repo
**Files**:
- `.gitignore` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via read of `.gitignore`: file exists and covers `.env`, `.env.*`, `*.tsbuildinfo`, `node_modules/`, etc.
- Confirmed missing via grep: no entries for `*.pem`, `*.key`, `secrets.*`, `credentials.*` — these are required by FR-3 but absent.
- Existing `.env` block at L28–31 already covers `.env` and `.env.*` with `!.env.example` carve-out.

**Instructions**:

Add the following block to `.gitignore` immediately after the `# Environment secrets` block (after the `!**/.env.example` line):

```gitignore
# Secret file types — NEVER commit private keys or credential files
*.pem
*.key
*.p12
*.pfx
secrets.*
credentials.*
service-account*.json
*-service-account.json
```

**Verification**:
```bash
grep -E "\.pem|\.key|secrets\.|credentials\." .gitignore
# Expected: all four patterns present
echo "test" > test.pem && git check-ignore -v test.pem; rm test.pem
# Expected: .gitignore:N:*.pem    test.pem
```

---

### Step 6 — docs: Add SECURITY.md and CONTRIBUTING.md at repo root

**Status**: `pending`
**Service**: Root repo
**Files**:
- `SECURITY.md` — create (does not exist: confirmed via `ls /SECURITY.md` → no such file)
- `CONTRIBUTING.md` — create (does not exist: confirmed via `ls /CONTRIBUTING.md` → no such file)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed not found: `ls /home/user/xstockstrat-orchestration/SECURITY.md` → No such file or directory
- Confirmed not found: `ls /home/user/xstockstrat-orchestration/CONTRIBUTING.md` → No such file or directory
- Local setup flow confirmed via `docs/setup/getting-started.md:44–61`: steps are clone → `cp .env.example .env` → `./scripts/bootstrap.sh` → `docker compose up -d`. CONTRIBUTING.md should mirror this.
- Paper trading mode confirmed: `ALPACA_PAPER=true` in `.env.example`; docker-compose sets `TRADING_MODE: paper` for all services in dev mode.
- Branch naming conventions confirmed from `CLAUDE.md`: `feature/<slug>`, `hotfix/<slug>`, `claude/*`.

**Instructions**:

**Create `SECURITY.md`** at repo root with the following content:

```markdown
# Security Policy

## Reporting Vulnerabilities

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues by emailing **security@<your-domain>** (replace with the
maintainer contact before making the repo public). Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact

We aim to respond within 72 hours and to issue a patch within 14 days for confirmed
critical or high-severity issues.

## Scope

This policy covers the xstockstrat-orchestration repository and all services under
`services/`. Individual service repos (`services/*`) are mirrors; report issues here.

## Out of Scope

- Issues in third-party libraries (report upstream)
- Issues requiring physical access to infrastructure
- Social engineering attacks

## Disclosure Policy

We follow coordinated disclosure. Please give us reasonable time to patch before any
public disclosure.
```

**Create `CONTRIBUTING.md`** at repo root covering all items in FR-5:

```markdown
# Contributing to xstockstrat-orchestration

Thank you for your interest in contributing. This guide covers how to set up the local
development environment, how to submit changes, and what style requirements apply.

## Prerequisites

| Tool | Version | macOS (Homebrew) |
|---|---|---|
| Git | any | pre-installed |
| Docker with Compose v2 | any | `brew install --cask docker` |
| Go | 1.25 | `brew install go` |
| Python | 3.12 | `brew install python@3.12` |
| Node.js | 22 | `brew install node@22` |
| pnpm | 9.15.0 | `npm install -g pnpm@9.15.0` |

## Local Setup (paper trading — no real credentials required)

1. **Clone**:
   ```bash
   git clone https://github.com/<your-fork>/xstockstrat-orchestration.git
   cd xstockstrat-orchestration
   ```

2. **Environment file**:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and at minimum set:
   - `ALPACA_API_KEY` and `ALPACA_API_SECRET` — create a free Alpaca paper trading
     account at [alpaca.markets](https://alpaca.markets). Paper trading is free and
     requires no real money. See `docs/setup/alpaca.md`.
   - `JWT_SECRET` — run `openssl rand -hex 32` to generate a random value.
   - Leave `ALPACA_PAPER=true` and all other values at their defaults.

3. **Bootstrap and start**:
   ```bash
   ./scripts/bootstrap.sh
   docker compose up -d
   ```

4. **Verify**:
   ```bash
   docker compose ps        # all services should show Up or healthy
   curl http://localhost:8060/health   # config service health check
   ```

   Full verification steps are in `docs/setup/getting-started.md`.

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

```bash
# Go service
cd services/xstockstrat-trading && GOWORK=off go test ./...

# Python service
cd services/xstockstrat-indicators && pip install -e ".[dev]" && pytest

# Node.js service
cd services/xstockstrat-ledger && pnpm run test:coverage
```

## Proto Changes

All `.proto` changes require a PR to this repository first. See
`docs/runbooks/approval-flow.md` for the approval gate requirements and
`docs/runbooks/proto-versioning.md` for breaking-change procedures.

## License

By contributing, you agree that your contributions will be licensed under the same
license as this repository.
```

**Verification**:
```bash
ls -la SECURITY.md CONTRIBUTING.md
# Expected: both files exist
grep "Do not open a public GitHub issue" SECURITY.md
grep "openssl rand -hex 32" CONTRIBUTING.md
```

---

### Step 7 — docs: Replace `davcs86` GitHub username with generic references in docs and scripts

**Status**: `pending`
**Service**: `docs/`, `scripts/`, `.do/`
**Files**:
- `docs/setup/getting-started.md` — modify (L40: `git clone https://github.com/davcs86/xstockstrat-orchestration.git`)
- `docs/setup/digitalocean.md` — modify (L24: `davcs86/xstockstrat-orchestration`, L141: `Select repo: davcs86/xstockstrat-orchestration`)
- `scripts/setup-branch-protection.sh` — modify (L11: `GITHUB_USER="${GITHUB_USER:-davcs86}"`)
- `scripts/subtree-setup.sh` — modify (L12: `GITHUB_USER="${GITHUB_USER:-davcs86}"`)
- `.do/app.yaml` — modify (14 occurrences of `repo: davcs86/xstockstrat-orchestration`)
- `.do/app.dev.yaml` — modify (14 occurrences of `repo: davcs86/xstockstrat-orchestration`)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via grep: `docs/setup/getting-started.md:40: git clone https://github.com/davcs86/xstockstrat-orchestration.git`
- Confirmed via grep: `docs/setup/digitalocean.md:24: GitHub repo 'davcs86/xstockstrat-orchestration' is your source of truth`
- Confirmed via grep: `docs/setup/digitalocean.md:141: 3. Select repo: 'davcs86/xstockstrat-orchestration'`
- Confirmed via grep: `scripts/setup-branch-protection.sh:11: GITHUB_USER="${GITHUB_USER:-davcs86}"`
- Confirmed via grep: `scripts/subtree-setup.sh:12: GITHUB_USER="${GITHUB_USER:-davcs86}"`
- Confirmed via grep: `.do/app.yaml` has 14 occurrences of `repo: davcs86/xstockstrat-orchestration`
- Confirmed via grep: `.do/app.dev.yaml` has 14 occurrences of `repo: davcs86/xstockstrat-orchestration`

**Instructions**:

1. **`docs/setup/getting-started.md` L40**: Replace:
   ```
   git clone https://github.com/davcs86/xstockstrat-orchestration.git
   ```
   With:
   ```
   git clone https://github.com/<your-org>/xstockstrat-orchestration.git
   ```

2. **`docs/setup/digitalocean.md` L24**: Replace:
   ```
   GitHub repo `davcs86/xstockstrat-orchestration` is your source of truth
   ```
   With:
   ```
   GitHub repo `<your-org>/xstockstrat-orchestration` is your source of truth
   ```

3. **`docs/setup/digitalocean.md` L141**: Replace:
   ```
   3. Select repo: `davcs86/xstockstrat-orchestration`
   ```
   With:
   ```
   3. Select repo: `<your-org>/xstockstrat-orchestration`
   ```

4. **`scripts/setup-branch-protection.sh` L11**: Replace:
   ```bash
   GITHUB_USER="${GITHUB_USER:-davcs86}"
   ```
   With:
   ```bash
   GITHUB_USER="${GITHUB_USER:?GITHUB_USER env var is required (your GitHub username or org)}"
   ```
   This forces callers to set `GITHUB_USER` explicitly — no silent default to the maintainer's personal account.

5. **`scripts/subtree-setup.sh` L12**: Same replacement as above (same pattern):
   ```bash
   GITHUB_USER="${GITHUB_USER:?GITHUB_USER env var is required (your GitHub username or org)}"
   ```

6. **`.do/app.yaml` and `.do/app.dev.yaml`**: Replace all 14 occurrences in each file of:
   ```yaml
         repo: davcs86/xstockstrat-orchestration
   ```
   With:
   ```yaml
         repo: YOUR_GITHUB_ORG/xstockstrat-orchestration
   ```
   Use a placeholder that is clearly not a real value so maintainers know to substitute it.

**Verification**:
```bash
grep -rn "davcs86" docs/ scripts/ .do/
# Expected: no output (all occurrences replaced)
grep -rn "YOUR_GITHUB_ORG\|your-org" .do/ docs/setup/
# Expected: replacement strings present
```

---

### Step 8 — docs: Add secret-scan CI job to `.github/workflows/ci.yml`

**Status**: `pending`
**Service**: `.github/workflows/`
**Files**:
- `.github/workflows/ci.yml` — modify

**Reviewers**: Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via read of `.github/workflows/ci.yml`: no `trufflehog` or `gitleaks` job exists. Existing jobs (L10–378) include `proto-lint`, `proto-freshness`, `go-lint`, `python-lint`, `python-test`, `node-lint`, `frontend-e2e`, `node-test`.
- No `.gitleaks.toml` config file found at repo root: `ls .gitleaks*` → no such file.
- Product spec OQ-1 resolution: "Both `trufflehog` and `gitleaks` will be added to `.github/workflows/ci.yml` as a `secret-scan` CI job. `trufflehog` covers git history depth; `gitleaks` covers the working tree with its 150+ pattern ruleset. Both run on every PR."
- Existing workflow trigger is `pull_request` on `main-dev` or `main` (L3–8) — the new job inherits this trigger.

**Instructions**:

1. Add a `secret-scan` job to `.github/workflows/ci.yml` after the last existing job (`node-test`, which ends at L378). Append the following:

   ```yaml
   secret-scan:
     name: Secret scan (trufflehog + gitleaks)
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v6
         with:
           # Full history required for trufflehog git-history scan
           fetch-depth: 0

       - name: TruffleHog — scan full git history
         uses: trufflesecurity/trufflehog@main
         with:
           path: ./
           base: ${{ github.event.repository.default_branch }}
           head: HEAD
           extra_args: --only-verified

       - name: Gitleaks — scan working tree
         uses: gitleaks/gitleaks-action@v2
         env:
           GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
   ```

2. Create `.gitleaks.toml` at repo root to suppress false positives for known safe patterns (dev-only placeholder strings that are already behind env-var interpolation):

   ```toml
   title = "xstockstrat gitleaks config"

   [extend]
   # Extend the default gitleaks ruleset
   useDefault = true

   [[allowlists]]
   description = "Dev placeholder credentials behind env-var interpolation"
   regexes = [
     # docker-compose uses ${VAR:-placeholder} syntax; these are not real secrets
     '''devpassword''',
     '''dev-jwt-secret-change-in-production''',
     '''your-api-key''',
     '''your-api-secret''',
     '''change-me-in-production''',
     '''change-me-n8n-webhook-secret''',
   ]
   paths = [
     '''.env\.example''',
     '''docker-compose\.yml''',
     '''docs/.*''',
   ]
   ```

**Verification**:
```bash
grep -n "secret-scan\|trufflehog\|gitleaks" .github/workflows/ci.yml
# Expected: the new job name and both tool references appear
ls -la .gitleaks.toml
# Expected: file exists
```

---

### Step 9 — docs: Add git-history audit instructions to CONTRIBUTING.md and document admin seed migration

**Status**: `pending`
**Service**: Root repo
**Files**:
- `CONTRIBUTING.md` — modify (append security audit section)
- `services/xstockstrat-identity/migrations/002_seed_admin.up.sql` — modify (comment update only)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via read: `services/xstockstrat-identity/migrations/002_seed_admin.up.sql:4: -- Email: admin@localhost  Password: admin` — the comment documents that the migration seeds a dev-only admin with password `admin`. The bcrypt hash on L9 (`$2b$10$qLw/k7U...`) is not a secret (it is a one-way hash of the string "admin"). However, the comment exposes the plaintext and should clarify dev-only context.
- Product spec OQ-2 resolution: "Audit first using `git log -S <pattern> --all` (and `trufflehog` over full history). If secrets are found in historical commits, use `git filter-repo` to scrub before the repo goes public."

**Instructions**:

1. **Update the comment header in `services/xstockstrat-identity/migrations/002_seed_admin.up.sql`** to clarify dev-only scope:

   Change:
   ```sql
   -- Migration: 002_seed_admin.sql
   -- Service: xstockstrat-identity
   -- Seeds the default admin user for development and testing.
   -- Email: admin@localhost  Password: admin
   -- bcrypt hash generated with 10 rounds.
   ```
   To:
   ```sql
   -- Migration: 002_seed_admin.sql
   -- Service: xstockstrat-identity
   -- Seeds the default admin user for LOCAL DEVELOPMENT AND TESTING ONLY.
   -- Default credentials: Email: admin@localhost  Password: admin
   -- These credentials are ONLY safe for local Docker Compose dev environments.
   -- In production, rotate this user's password immediately after first deployment.
   -- The bcrypt hash below is a one-way hash of the string "admin" (10 rounds) — not a secret.
   ```

2. **Append a "Security Audit" section to `CONTRIBUTING.md`** (created in Step 6):

   ```markdown
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
   ```

**Verification**:
```bash
grep "LOCAL DEVELOPMENT AND TESTING ONLY" services/xstockstrat-identity/migrations/002_seed_admin.up.sql
# Expected: updated comment present
grep "Security Audit" CONTRIBUTING.md
# Expected: section heading present
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
