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

**Status**: `pending`
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

**Status**: `pending`
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

**Status**: `pending`
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

**Status**: `pending`
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

**Status**: `pending`
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

See implementation-spec.md for full file contents of SECURITY.md and CONTRIBUTING.md.

**Verification**:
```bash
ls -la SECURITY.md CONTRIBUTING.md
# Expected: both files exist
grep "Do not open a public GitHub issue" SECURITY.md
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

Append `secret-scan` job to `.github/workflows/ci.yml` and create `.gitleaks.toml`.
See implementation-spec.md for full YAML and TOML content.

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
- `docs/setup/getting-started.md` — modify (L40)
- `docs/setup/digitalocean.md` — modify (L24, L141)
- `scripts/setup-branch-protection.sh` — modify (L11)
- `scripts/subtree-setup.sh` — modify (L12)
- `.do/app.yaml` — modify (14 occurrences)
- `.do/app.dev.yaml` — modify (14 occurrences)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via grep: all six files contain `davcs86` references as documented above.

**Instructions**:

Replace all `davcs86` occurrences with `<your-org>` (docs/scripts) or `YOUR_GITHUB_ORG` (.do/ files).
Use `${GITHUB_USER:?GITHUB_USER env var is required}` in scripts to force explicit configuration.

**Verification**:
```bash
grep -rn "davcs86" docs/ scripts/ .do/
# Expected: no output
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
- Confirmed via context.md: `002_seed_admin.up.sql:4: -- Email: admin@localhost  Password: admin` — dev-only comment needs scope clarification.
- Product spec OQ-2: use `git log -S <pattern> --all` + `git filter-repo` if hits found.
- Depends on Step 6 (CONTRIBUTING.md must exist).

**Instructions**:

Update migration comment to clarify dev-only scope. Append "Security Audit (Maintainers Only)" section to CONTRIBUTING.md with `git log -S` audit commands and `git filter-repo` scrub instructions.

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
- `.env.development` — create (confirmed absent)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed absent: `.env.development` does not exist at repo root.
- Current `.gitignore` blocks this file — Step 5 must add `!.env.development` carve-out first.
- `APP_URL=http://localhost` is safe for local dev; Next.js auto-loads `.env.development` in `next dev`.

**Instructions**:

Create `.env.development` with non-secret local-dev defaults: `APP_URL=http://localhost`, `NODE_ENV=development`, `TRADING_MODE=paper`, `ALPACA_PAPER=true`, `LOG_LEVEL=info`, `OTEL_ENABLED=false`.

**Verification**:
```bash
git check-ignore -v .env.development 2>/dev/null || echo "not ignored"
grep "APP_URL=http://localhost" .env.development
```

---

### Step 11 — docs: Create `.env.production` and wire `APP_URL` into DO app specs (FR-10)

**Status**: `pending`
**Service**: Root repo, `.do/`
**Files**:
- `.env.production` — create (confirmed absent)
- `.do/app.yaml` — modify (add `APP_URL` to trader L286, insights L302, config-ui L318)
- `.do/app.dev.yaml` — modify (add `APP_URL` to trader L310, insights L328, config-ui L346)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed absent: `.env.production` does not exist.
- `.do/app.yaml` frontend `envs:` blocks lack `APP_URL` entry — confirmed for all three frontend services.
- `.do/app.dev.yaml` same — all three frontend `envs:` blocks lack `APP_URL`.
- `${APP_URL}` is a standard DO App Platform built-in; no setup required.

**Instructions**:

Create `.env.production` with placeholder-only values documenting DO injection pattern. Wire `- key: APP_URL / value: ${APP_URL}` into all three frontend service `envs:` blocks in both `.do/app.yaml` and `.do/app.dev.yaml`.

**Verification**:
```bash
git check-ignore -v .env.production 2>/dev/null || echo "not ignored"
grep -c "APP_URL" .do/app.yaml    # Expected: at least 3
grep -c "APP_URL" .do/app.dev.yaml  # Expected: at least 3
```

---

## Deviation Log

### Deviation: Step 1 — Harden `docker-compose.yml` hardcoded dev credentials
**Spec said**: Wrap credentials in `${VAR:-default}` syntax to preserve local-dev defaults.
**Actual**: Used `${VAR:?error message}` syntax (no fallback) — `docker compose` fails fast if the var is unset, matching the same fail-fast pattern used in Steps 2 and 3 for service code.
**Reason**: User explicitly requested no fallbacks. Repo is not yet rolled out, so no backwards-compatibility concern. Fail-fast is strictly safer for a public repo.

**Spec said**: Only `docker-compose.yml` in the Files list.
**Actual**: Also modified `.env.example` to add the `POSTGRES_PASSWORD` variable (with the matching dev default). Required because docker-compose now errors on unset `POSTGRES_PASSWORD` and `.env.example` is the canonical "what to set in .env" reference for contributors.
