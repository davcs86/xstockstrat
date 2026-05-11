# Implementation Spec: make-repo-public-secure

**Status**: `in-progress`
**Created**: 2026-05-10
**Regenerated**: 2026-05-11
**Feature**: `docs/roadmap/features/004-make-repo-public-secure/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/make-repo-public-secure`

---

## Execution Summary

The implementation proceeds in four logical waves. Wave 1 (Steps 1–4) eliminates all
hardcoded credentials and dev-only secrets from committed source files: the docker-compose
file (done), the identity service fallback, the ingest service fallback, and the db-migrate
script. Wave 2 (Steps 5–7) adds the required public-repo hygiene files: .gitignore
additions (now including carve-outs for .env.development and .env.production), SECURITY.md
and CONTRIBUTING.md, and a secret-scan CI job. Wave 3 (Steps 8–9) replaces internal
account identifiers (the GitHub username `davcs86`) in docs and app specs, and documents
the git-history audit process. Wave 4 (Steps 10–11) implements FR-9/FR-10: the committable
`.env.development` local-dev defaults file, the `.env.production` placeholder/docs file,
and the `APP_URL` wiring into all three frontend services in both DO app specs.

Steps 1–4 are independent of each other and can be executed in any order. Steps 5 and 6
are independent of each other. Steps 7–9 depend only on completing Wave 1 (the repo must
be sanitised before docs are updated). Steps 10–11 are independent of each other and of
prior steps (new files and append-only changes to .do/ specs).

---

## Step Dependencies

- Steps 1–4 are mutually independent (different files). Step 1 is already done.
- Steps 5–6 are mutually independent (new and modified files).
- Steps 7–9 should follow Steps 1–4 so that internal references to cleaned paths are
  accurate in docs and CI runs against the already-cleaned working tree.
- Step 9 (CONTRIBUTING.md security audit section + admin seed comment) depends on Step 6
  (CONTRIBUTING.md must exist before it can be modified).
- Steps 10–11 are independent of all other steps (FR-9/FR-10 additions; append-only to
  existing DO app specs and creation of new root-level files).

---

### Step 1 — service: Harden `docker-compose.yml` hardcoded dev credentials

**Status**: `done`
**Service**: `docker-compose.yml` (root)
**Files**:
- `docker-compose.yml` — modify
- `.env.example` — modify (deviation: POSTGRES_PASSWORD added, see Deviation Log)

**Reviewers**: Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via grep: `docker-compose.yml:44: POSTGRES_PASSWORD: devpassword` (literal string, not env-var-interpolated)
- Confirmed via grep: `docker-compose.yml:65: DATABASE_URL: postgres://xstockstrat:devpassword@timescaledb:5432/xstockstrat?sslmode=disable` (appears 8 more times on L84, L113, L145, L180, L215, L315, L353, L390, L484)
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

**Status**: `done`
**Service**: `xstockstrat-identity` (Node.js)
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config)

**Codebase Evidence**:
- Confirmed via grep: `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:19: return process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production';`
- The getter reads: `private get jwtSecret(): string { // Secret keys are not stored in config service — sourced from env only` then returns env var with literal fallback.
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

   This is a safe change: in local dev, `.env` will contain `JWT_SECRET` (see `.env.example` L29: `JWT_SECRET=change-me-in-production-use-32-char-minimum`). In production, JWT_SECRET is injected by the secret store. The service failing fast on missing JWT_SECRET is strictly safer than silently using a known-public key.

**Verification**:
```bash
grep -n "dev-jwt-secret" services/xstockstrat-identity/src/grpc/identityServiceImpl.ts
# Expected: no output (string removed)
grep -n "JWT_SECRET" services/xstockstrat-identity/src/grpc/identityServiceImpl.ts
# Expected: lines showing process.env.JWT_SECRET and the error throw
```

---

### Step 3 — service: Remove hardcoded database URL fallback from ingest service

**Status**: `done`
**Service**: `xstockstrat-ingest` (Python)
**Files**:
- `services/xstockstrat-ingest/app/main.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Confirmed via grep: `services/xstockstrat-ingest/app/main.py:38: "DATABASE_URL", "postgres://xstockstrat:devpassword@localhost:5432/xstockstrat"` — bare literal `devpassword` in fallback argument.
- The assignment uses `os.environ.get("DATABASE_URL", "postgres://xstockstrat:devpassword@localhost:5432/xstockstrat")` pattern.

**Instructions**:

1. In `services/xstockstrat-ingest/app/main.py`, change the `DATABASE_URL` assignment at L37–39 from:
   ```python
   DATABASE_URL = os.environ.get(
       "DATABASE_URL", "postgres://xstockstrat:devpassword@localhost:5432/xstockstrat"
   )
   ```
   To:
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

**Status**: `done`
**Service**: `scripts/` (bootstrap tooling)
**Files**:
- `scripts/db-migrate.sh` — modify

**Reviewers**: Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via grep: `scripts/db-migrate.sh:19: DB_URL="${DATABASE_URL:-postgres://xstockstrat:devpassword@localhost:5432/xstockstrat?sslmode=disable}"` — bare literal `devpassword` in default fallback.
- This script runs inside the `db-migrator` Docker container where `DATABASE_URL` is always injected (confirmed via `docker-compose.yml` and `scripts/Dockerfile.migrate`). The fallback is never needed in container context.

**Instructions**:

1. In `scripts/db-migrate.sh`, change line 19 from:
   ```bash
   DB_URL="${DATABASE_URL:-postgres://xstockstrat:devpassword@localhost:5432/xstockstrat?sslmode=disable}"
   ```
   To:
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

### Step 5 — docs: Add .gitignore entries for secret file patterns and .env file carve-outs

**Status**: `done`
**Service**: Root repo
**Files**:
- `.gitignore` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via read of `.gitignore` (L35–41): existing block covers `.env`, `.env.*`, with `!.env.example` and `!**/.env.example` carve-outs.
- Confirmed missing via read: no entries for `*.pem`, `*.key`, `secrets.*`, `credentials.*` — required by FR-3 but absent.
- Confirmed current gitignore would block `.env.development` and `.env.production` (both match `.env.*` pattern at L37) — FR-9 and FR-10 require these files to be committable, so explicit carve-outs are required in the same block.

**Instructions**:

1. In `.gitignore`, add carve-outs for `.env.development` and `.env.production` immediately after the existing `!.env.example` line (L38) and `!**/.env.example` line (L41):

   Replace the existing `# Environment secrets — NEVER commit these` block (L35–41):
   ```gitignore
   # Environment secrets — NEVER commit these
   .env
   .env.*
   !.env.example
   **/.env
   **/.env.*
   !**/.env.example
   ```
   With:
   ```gitignore
   # Environment secrets — NEVER commit these
   .env
   .env.*
   !.env.example
   !.env.development
   !.env.production
   **/.env
   **/.env.*
   !**/.env.example
   ```

2. Append the following block to `.gitignore` after the `# Docker` block (after line 43):

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

grep -E "!\.env\.development|!\.env\.production" .gitignore
# Expected: both carve-out lines present

echo "test" > test.pem && git check-ignore -v test.pem; rm test.pem
# Expected: .gitignore:N:*.pem    test.pem

git check-ignore -v .env.development 2>/dev/null || echo "not ignored"
# Expected: "not ignored" (carve-out is in effect)
```

---

### Step 6 — docs: Add SECURITY.md and CONTRIBUTING.md at repo root

**Status**: `done`
**Service**: Root repo
**Files**:
- `SECURITY.md` — create (confirmed absent: not present in root-level `ls` output)
- `CONTRIBUTING.md` — create (confirmed absent: not present in root-level `ls` output)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed not found: `ls /home/user/xstockstrat-orchestration/` does not include `SECURITY.md` or `CONTRIBUTING.md`.
- Local setup flow confirmed via `docs/setup/getting-started.md:44–61`: steps are clone → `cp .env.example .env` → `./scripts/bootstrap.sh` → `docker compose up -d`. CONTRIBUTING.md should mirror this.
- Paper trading mode confirmed: `ALPACA_PAPER=true` in `.env.example` L18; docker-compose sets `TRADING_MODE: paper` for all services in dev mode.
- Branch naming conventions confirmed from `CLAUDE.md`: `feature/<slug>`, `hotfix/<slug>`, `claude/*`.
- Tool versions confirmed from `CLAUDE.md` Language Versions & Tooling table: Go 1.25, Python 3.12, Node.js 22, pnpm 9.15.0.

**Instructions**:

See Deviation Log — SECURITY.md was omitted per user instruction. CONTRIBUTING.md was created as a slim reference document.

**Verification**:
```bash
ls -la CONTRIBUTING.md
# Expected: file exists
grep "openssl rand -hex 32" CONTRIBUTING.md
```

---

### Step 7 — service: Add secret-scan CI job to `.github/workflows/ci.yml`

**Status**: `pending`
**Service**: `.github/workflows/`
**Files**:
- `.github/workflows/ci.yml` — modify
- `.gitleaks.toml` — create (confirmed absent: no `.gitleaks*` file at repo root)

**Reviewers**: Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via grep: no `trufflehog` or `gitleaks` reference anywhere in `.github/workflows/ci.yml`.
- Confirmed via read: `.github/workflows/ci.yml` is 377 lines; last job (`node-test`) ends at L377.
- Existing workflow trigger covers `pull_request` on `main-dev` or `main` — the new job inherits this trigger.
- Product spec OQ-1 resolution: "Both `trufflehog` and `gitleaks` will be added to `.github/workflows/ci.yml` as a `secret-scan` CI job."

**Instructions**:

1. Append the following `secret-scan` job to `.github/workflows/ci.yml` after the last line (L377):

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

2. Create `.gitleaks.toml` at repo root to suppress false positives for known safe dev-placeholder patterns:

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

### Step 8 — docs: Replace `davcs86` GitHub username with generic references in docs and scripts

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
- Confirmed via grep count: `.do/app.yaml` has 14 occurrences of `repo: davcs86/xstockstrat-orchestration`
- Confirmed via grep count: `.do/app.dev.yaml` has 14 occurrences of `repo: davcs86/xstockstrat-orchestration`

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

### Step 9 — docs: Add git-history audit section to CONTRIBUTING.md and update admin seed migration comment

**Status**: `pending`
**Service**: Root repo
**Files**:
- `CONTRIBUTING.md` — modify (append security audit section; must exist from Step 6)
- `services/xstockstrat-identity/migrations/002_seed_admin.up.sql` — modify (comment update only)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via context.md: `services/xstockstrat-identity/migrations/002_seed_admin.up.sql:4: -- Email: admin@localhost  Password: admin` — comment documents a dev-only admin with password "admin". The bcrypt hash is not a secret (one-way hash of "admin") but the comment should clarify dev-only scope.
- Product spec OQ-2 resolution: "Audit first using `git log -S <pattern> --all` (and `trufflehog` over full history). If secrets are found in historical commits, use `git filter-repo` to scrub before the repo goes public."
- Step depends on Step 6: CONTRIBUTING.md must exist before this step modifies it.

**Instructions**:

1. **Update the comment header in `services/xstockstrat-identity/migrations/002_seed_admin.up.sql`**:

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
grep "Security Audit" CONTRIBUTING.md
```

---

### Step 10 — docs: Create `.env.development` with local-dev defaults (FR-9)

**Status**: `pending`
**Service**: Root repo
**Files**:
- `.env.development` — create (confirmed absent: not present in root `ls` or `.env*` glob output)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed absent: `.env.development` does not exist at repo root (`ls /home/user/xstockstrat-orchestration/.env*` only shows `.env.example`).
- Confirmed `.gitignore` would currently block this file (`.env.*` pattern at L37) — Step 5 must add `!.env.development` carve-out first. Step 10 depends on Step 5.
- `APP_URL=http://localhost` is safe for local dev (no credentials); Next.js `next dev` auto-loads `.env.development` per Next.js conventions.
- Existing `.env.example` confirms all required variable names and local-dev defaults (e.g., `NODE_ENV=development` for frontends).
- `docker-compose.yml` confirms `TRADING_MODE: paper` is the dev default for all services.

**Instructions**:

Create `.env.development` at repo root with the following content. This file contains **only non-secret, local-development-safe defaults** — no credentials, no API keys:

```dotenv
# .env.development — Local development defaults. Safe to commit.
# This file is auto-loaded by Next.js in `next dev` mode.
# It is NOT loaded in production; use .env.production for production documentation.
# Add real secrets (ALPACA_API_KEY, JWT_SECRET, POSTGRES_PASSWORD) to .env (not committed).

# Application URL — local dev base URL
APP_URL=http://localhost

# Node environment
NODE_ENV=development

# Trading mode — always paper for local dev
TRADING_MODE=paper

# Alpaca environment — always paper for local dev
ALPACA_PAPER=true

# Logging
LOG_LEVEL=info

# OpenTelemetry — disabled by default for local dev
OTEL_ENABLED=false
```

**Verification**:
```bash
ls -la .env.development
# Expected: file exists

git check-ignore -v .env.development 2>/dev/null || echo "not ignored"
# Expected: "not ignored" — file is committable (carve-out from Step 5 in effect)

grep "APP_URL=http://localhost" .env.development
# Expected: line present

grep "NODE_ENV=development" .env.development
# Expected: line present
```

---

### Step 11 — docs: Create `.env.production` and wire `APP_URL` into DO app specs (FR-10)

**Status**: `pending`
**Service**: Root repo, `.do/`
**Files**:
- `.env.production` — create (confirmed absent: not present in root `ls` or `.env*` glob output)
- `.do/app.yaml` — modify (add `APP_URL` env var to three frontend services: `xstockstrat-trader` at L286 envs block, `xstockstrat-insights` at L302 envs block, `xstockstrat-config-ui` at L318 envs block)
- `.do/app.dev.yaml` — modify (add `APP_URL` env var to three frontend services: `xstockstrat-trader` at L310 envs block, `xstockstrat-insights` at L328 envs block, `xstockstrat-config-ui` at L346 envs block)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed absent: `.env.production` does not exist at repo root.
- Confirmed via read of `.do/app.yaml` L276–322: `xstockstrat-trader` envs block at L286 contains `TRADING_MODE` and `TRADING_ENDPOINT` — no `APP_URL` entry. Same pattern for `xstockstrat-insights` (L302) and `xstockstrat-config-ui` (L318).
- Confirmed via read of `.do/app.dev.yaml` L300–352: same pattern — `xstockstrat-trader` envs at L310, `xstockstrat-insights` at L328, `xstockstrat-config-ui` at L346 — no `APP_URL` entry in any.
- DO App Platform built-in `${APP_URL}` resolves to the app's ingress domain at deploy time — this is a standard DO feature, no setup required.
- Confirmed `!.env.production` carve-out must be in `.gitignore` (added in Step 5) for this file to be committable.

**Instructions**:

1. **Create `.env.production`** at repo root (placeholder values only — no real secrets):

   ```dotenv
   # .env.production — Production variable structure documentation. Safe to commit.
   # Contains ONLY placeholder values — never real credentials.
   # Real values are injected by DigitalOcean App Platform at deploy time.
   # See .do/app.yaml and .do/app.dev.yaml for the authoritative production config.

   # Application URL — injected by DigitalOcean App Platform as a built-in variable.
   # ${APP_URL} in .do/app.yaml resolves to the app's ingress domain at deploy time.
   # Contributors: do NOT set this manually — it is provided by DO automatically.
   APP_URL=${APP_URL}

   # Node environment
   NODE_ENV=production

   # Trading mode
   TRADING_MODE=live

   # Alpaca environment — live trading in production
   ALPACA_PAPER=false

   # Database — injected by DigitalOcean managed database component
   # DATABASE_URL=${db.DATABASE_URL}  (set via .do/app.yaml, not here)

   # API credentials — injected from secret store, NOT stored here
   # ALPACA_API_KEY=<set via DO App Platform environment config>
   # ALPACA_API_SECRET=<set via DO App Platform environment config>
   # JWT_SECRET=<set via DO App Platform environment config>
   ```

2. **Wire `APP_URL` into `.do/app.yaml`** for all three frontend services. Add the following entry to each service's `envs:` block:

   - `xstockstrat-trader` (envs block starting at L286): append after the last existing env entry:
     ```yaml
           - key: APP_URL
               value: ${APP_URL}
     ```
   - `xstockstrat-insights` (envs block starting at L302): append after the last existing env entry:
     ```yaml
           - key: APP_URL
               value: ${APP_URL}
     ```
   - `xstockstrat-config-ui` (envs block starting at L318): append after the last existing env entry:
     ```yaml
           - key: APP_URL
               value: ${APP_URL}
     ```

3. **Wire `APP_URL` into `.do/app.dev.yaml`** for all three frontend services. Add the following entry to each service's `envs:` block:

   - `xstockstrat-trader` (envs block starting at L310): append after the last existing env entry:
     ```yaml
           - key: APP_URL
               value: ${APP_URL}
     ```
   - `xstockstrat-insights` (envs block starting at L328): append after the last existing env entry:
     ```yaml
           - key: APP_URL
               value: ${APP_URL}
     ```
   - `xstockstrat-config-ui` (envs block starting at L346): append after the last existing env entry:
     ```yaml
           - key: APP_URL
               value: ${APP_URL}
     ```

**Verification**:
```bash
ls -la .env.production
# Expected: file exists

git check-ignore -v .env.production 2>/dev/null || echo "not ignored"
# Expected: "not ignored" — file is committable (carve-out from Step 5 in effect)

grep "APP_URL=\${APP_URL}" .env.production
# Expected: line present (placeholder value)

grep -c "APP_URL" .do/app.yaml
# Expected: at least 3 (one per frontend service)

grep -c "APP_URL" .do/app.dev.yaml
# Expected: at least 3 (one per frontend service)
```

---

## Deviation Log

### Deviation: Step 6 — Add SECURITY.md and CONTRIBUTING.md at repo root
**Spec said**: Create both `SECURITY.md` and `CONTRIBUTING.md` using the inline templates; CONTRIBUTING.md should fully reproduce setup steps.
**Actual**: (1) `SECURITY.md` was not created — user found the spec template too generic; (2) `CONTRIBUTING.md` was written as a slim reference document that points to `docs/setup/getting-started.md` for setup steps rather than duplicating them. Only unique content (branch naming, PR workflow, code style, proto changes) is included directly.
**Reason**: User instruction. SECURITY.md can be added later with project-specific contact details. A slim CONTRIBUTING.md that leverages the existing getting-started.md is more maintainable and avoids content drift.

### Deviation: Step 5 — Add .gitignore entries for secret file patterns and .env file carve-outs
**Spec said**: Add `!.env.development` and `!.env.production` carve-outs immediately after `!.env.example` in the root-level env block.
**Actual**: Also added `!**/.env.development` and `!**/.env.production` after the `**/.env.*` wildcard line. Without these, the `**/.env.*` pattern (line 43) overrides the root-level carve-outs, causing git to still ignore `.env.development`.
**Reason**: gitignore rules are applied in order; a later matching pattern overrides earlier ones. The `**/.env.*` wildcard matches `.env.development` and supersedes the `!.env.development` carve-out. Adding symmetric wildcard carve-outs (mirroring the existing `!**/.env.example`) ensures the negation sticks. Verified with `git check-ignore` exit code 1 (not ignored).

### Deviation: Step 1 — Harden `docker-compose.yml` hardcoded dev credentials
**Spec said**: Wrap credentials in `${VAR:-default}` syntax to preserve local-dev defaults.
**Actual**: Used `${VAR:?error message}` syntax (no fallback) — `docker compose` fails fast if the var is unset, matching the same fail-fast pattern used in Steps 2 and 3 for service code.
**Reason**: User explicitly requested no fallbacks. Repo is not yet rolled out, so no backwards-compatibility concern. Fail-fast is strictly safer for a public repo.

**Spec said**: Only `docker-compose.yml` in the Files list.
**Actual**: Also modified `.env.example` to add the `POSTGRES_PASSWORD` variable (with the matching dev default). Required because docker-compose now errors on unset `POSTGRES_PASSWORD` and `.env.example` is the canonical "what to set in .env" reference for contributors.
