# Context: make-repo-public-secure

**Feature**: `docs/roadmap/features/004-make-repo-public-secure/feature.md`
**Product Spec**: `docs/roadmap/features/004-make-repo-public-secure/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/004-make-repo-public-secure/implementation-spec.md`

---

## Session 2026-05-10T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.

## Session 2026-05-10T00:01:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: Affected Services uses collective reference ("All services under services/") rather than exact named list — advisory only; /sdd-spec will enumerate exact service names.
- Overlap findings: broker-accounts-ui (code-completed) and formula-management-ui (implementation-ready) share service dirs — low conflict risk (no shared config keys, proto fields, or DB migrations). No merge-order entry required.
- Administrative: NNN collision with 003-formula-management-ui — recommend renaming this directory to 004-make-repo-public-secure.
- OQ resolutions recorded: trufflehog + gitleaks for CI; audit-first history purge; PR merge is the visibility gate.

## Session 2026-05-11T00:00:00Z — manual edits (pre-execute)

- Cleaned up `.env.example`: added local-dev-only comment on DATABASE_URL; added "GitHub Repository Secrets" comment block listing all 4 required secrets (DIGITALOCEAN_ACCESS_TOKEN, DO_DEV_APP_ID, DO_PROD_APP_ID, BUF_TOKEN) with pointer to digitalocean.md Step 9.
- Fixed `docs/setup/digitalocean.md` Step 9: added missing BUF_TOKEN to the secrets table; added "Obtaining a BUF_TOKEN" subsection.
- Updated implementation-spec.md Step 9 instructions: git history audit now explicitly covers `main` and `main-dev` via `git fetch --all` before `git log --all`; added `devpassword` to the pattern list; force-push step after filter-repo covers all branches.

## Session 2026-05-10T00:02:00Z — sdd-spec

- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- Key codebase findings:
  - **Hardcoded dev credentials in docker-compose.yml**: 12 occurrences of `devpassword` (bare literal, not behind `${:-}` interpolation) and 1 occurrence of `JWT_SECRET: dev-jwt-secret-change-in-production` — both need wrapping in `${VAR:-default}` syntax (same pattern as `ALPACA_API_KEY` already uses).
  - **Identity service JWT fallback**: `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:19` has `return process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production'` — fallback string is literal source code; replaced with a throw to force explicit configuration.
  - **Ingest service DATABASE_URL fallback**: `services/xstockstrat-ingest/app/main.py:37–39` has `"postgres://xstockstrat:devpassword@localhost:5432/xstockstrat"` as hardcoded fallback — replaced with `RuntimeError` on missing env var.
  - **db-migrate.sh fallback**: `scripts/db-migrate.sh:19` has bare `devpassword` in default DATABASE_URL — replaced with explicit error.
  - **davcs86 GitHub username**: hardcoded in `.do/app.yaml` (14 occurrences), `.do/app.dev.yaml` (14 occurrences), `docs/setup/getting-started.md:40`, `docs/setup/digitalocean.md:24,141`, `scripts/setup-branch-protection.sh:11`, `scripts/subtree-setup.sh:12` — replaced with generic placeholders.
  - **.gitignore missing patterns**: `*.pem`, `*.key`, `secrets.*`, `credentials.*` not present — added in Step 5.
  - **SECURITY.md and CONTRIBUTING.md**: neither exists at repo root — created from scratch in Step 6.
  - **No existing secret-scan CI job**: no `trufflehog` or `gitleaks` reference anywhere in `.github/workflows/` — added as `secret-scan` job in Step 8.
  - **CI/CD workflows clean**: all secrets in `.github/workflows/` already use `${{ secrets.* }}` — no hardcoded tokens found.
  - **DO app specs clean**: `.do/app.yaml` and `.do/app.dev.yaml` use `${<service>.PRIVATE_URL}` and `${db.DATABASE_URL}` injection — no inline credentials other than the GitHub repo path (`davcs86/...`).
  - **Admin seed migration**: `services/xstockstrat-identity/migrations/002_seed_admin.up.sql` exposes default password "admin" in comment — comment updated to clarify dev-only scope; bcrypt hash is not a secret.
  - **No AKIA/ghp_/sk_live_ tokens found**: grep over full repo found zero real secret token patterns.

### Step 1 — Harden `docker-compose.yml` hardcoded dev credentials [done]
- Used `${VAR:?error}` (no fallback) instead of spec's `${VAR:-default}` — user explicitly requested no fallbacks; fail-fast is safer for a public repo.
- Files modified: `docker-compose.yml`, `.env.example`
- Deviations: (1) `${VAR:?}` instead of `${VAR:-default}`; (2) `.env.example` added to file list to document the now-required `POSTGRES_PASSWORD` variable.

## GitHub Secrets Reference (set in GitHub → Settings → Secrets and variables → Actions)

| Secret | Workflow | How to obtain |
|---|---|---|
| `DIGITALOCEAN_ACCESS_TOKEN` | deploy-dev, deploy-prod | DigitalOcean → API → Personal Access Tokens |
| `DO_DEV_APP_ID` | deploy-dev | `doctl apps list` after creating dev app |
| `DO_PROD_APP_ID` | deploy-prod | `doctl apps list` after creating prod app |
| `BUF_TOKEN` | deploy-dev, deploy-prod | buf.build → Settings → API Tokens |
| `GITHUB_TOKEN` | secret-scan (gitleaks) | Auto-provided by GitHub Actions — no setup needed |

**Note**: `POSTGRES_PASSWORD`, `DATABASE_URL`, and `JWT_SECRET` are local dev vars set in `.env` (not GitHub secrets). In production they are injected by DigitalOcean App Platform from the managed database component and app environment config — never stored in GitHub secrets.

## Session 2026-05-11T00:01:00Z — sdd-story (product-spec update)

- Added FR-9: create `.env.development` with local-dev defaults (including `APP_URL=http://localhost`), safe to commit.
- Added FR-10: create `.env.production` documenting production variable structure; wire `APP_URL` from DO App Platform built-in (`${APP_URL}`) into frontend services in `.do/app.yaml` and `.do/app.dev.yaml`.
- Updated Affected Services to explicitly list `.do/app.yaml`, `.do/app.dev.yaml`, and the three frontend services.
- Updated Acceptance Criteria (items 9 and 10).
- Implementation spec is now **stale** — run `/sdd-spec make-repo-public-secure` to regenerate with the new steps added for FR-9/FR-10.

## Session 2026-05-11T00:02:00Z — sdd-review product-spec (re-review after FR-9/FR-10 update)

- Product spec re-review: PASS. Status remains `in-progress` (Step 1 already complete).
- Warnings (advisory): (1) Affected Services uses collective "All services under services/" — acceptable for cross-cutting audit; (2) AC8 is qualitative; (3) broker-accounts-ui and formula-management-ui share frontend service names — low conflict risk, no shared source files.
- Overlap findings: no config key, proto, or migration collisions. No merge-order entry required.
- Next: `/sdd-spec make-repo-public-secure` to regenerate implementation spec preserving Step 1 `done` status and adding steps for FR-9/FR-10.
