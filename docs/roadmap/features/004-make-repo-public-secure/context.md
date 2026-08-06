# Context: make-repo-public-secure  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Repo-wide secret/credential hardening for going public, but the FR-9/FR-10 local-env work shipped as a materially different design than planned: a single `.env.local` file loaded by all 13 docker-compose services plus an `APPLICATION_ENV` discriminator, not the originally spec'd `.env.development`/`.env.production` pair (context.md 2026-05-11T01:11:00Z session; implementation-spec.md Deviation Log, Step 10).
**Why (irrecoverable rationale)**: Next.js does not auto-load `.env.development` inside a Docker container built with `NODE_ENV=production`, so the FR-9 file as spec'd would silently be ignored in the one place (containers) local dev actually runs — only discoverable by testing the actual load behavior, not by reading the spec (implementation-spec.md Deviation Log, Step 10, reason #1).
**Rejected alternatives**:
- `.env.development` + `.env.production` two-file split (FR-9/FR-10 as spec'd) — lost because it isn't loaded by Next.js under Docker's production `NODE_ENV`, and DO app specs already fully own prod config, making a committed `.env.production` redundant (Step 10 Deviation Log, point 9: Step 11 "skipped").
- `${VAR:-default}` fallback syntax for docker-compose secrets (Step 1 as spec'd) — lost because user explicitly wanted fail-fast with no fallback given repo not yet public/rolled out (Deviation Log, Step 1).
- Full templated `SECURITY.md`/verbose `CONTRIBUTING.md` — lost because user judged the generic template not worth landing; CONTRIBUTING.md was slimmed to point at `docs/setup/getting-started.md` instead of duplicating it (Deviation Log, Step 6).
**Scars & gotchas**:
- `.gitignore` wildcard ordering trap: a later `**/.env.*` pattern silently overrides an earlier `!.env.development` negation — needed a *second*, symmetric `!**/.env.*` carve-out to actually un-ignore the file; verified only via `git check-ignore` exit code (Deviation Log, Step 5).
- Harness git-proxy hit an HTTP 403 pushing to the feature branch; had to push via the GitHub MCP API instead (context.md 2026-05-11T02:15:00Z session).
**Permanent deviations**:
- design said create `.env.development` + `.env.production` (FR-9/FR-10) -> shipped a single `.env.local` wired into every service's `env_file` + `APPLICATION_ENV` env-discriminator, Step 11 fully absorbed/skipped -> because the two-file split didn't survive contact with how Next.js and Docker actually load env files (Deviation Log, Step 10).
- design said wrap prod docker-compose secrets in `${VAR:-default}` -> shipped `${VAR:?error}` fail-fast -> because the repo wasn't live yet and user wanted no silent fallback (Deviation Log, Step 1).
- product-spec AC-5 required `SECURITY.md` at repo root -> it was never created -> user judged the template not worth landing (Deviation Log, Step 6); feature still reached `launched` with this AC unmet.
- `.up.sql` migration files on `main-dev` are documented elsewhere as immutable, but a comment-only edit to `002_seed_admin.up.sql` shipped anyway with explicit user sign-off (Deviation Log, Step 9).
- implementation-spec.md Step 7 (L475) spec'd the secret-scan job's trufflehog/gitleaks steps with `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` -> shipped `GITHUB_TOKEN: ${{ secrets.GH_PAT_SCAN }}` in both steps (`.github/workflows/ci.yml:671,676`) -> because a later session judged a PAT gives "authenticated API calls for improved detection capabilities" over the default token (context.md 2026-05-11T02:15:00Z session, L65-79). This requires `GH_PAT_SCAN` to be manually provisioned in repo secrets (Settings → Secrets → Actions) — nothing else creates or documents it, and `ci.yml` carries no comment explaining the swap, so a future maintainer seeing `GH_PAT_SCAN` fail/expire has no in-repo pointer to why it exists or what to do.
**Cross-feature signal**: Mid-flight `adjust:` rounds during execute can silently absorb/cancel a later spec'd step (Step 11), or swap a spec'd secret/token (Step 7's GH_PAT_SCAN), without a re-run of `/sdd-spec` — the impl-spec file still shows Step 11 duplicated/contradictory content and Step 7 pointing at the wrong token, a sign the spec doc and shipped reality diverged and were never reconciled.
**Deferred follow-ons**:
- `SECURITY.md` still does not exist despite AC-5; add with real contact details when someone owns it.
- No CI-visible pointer that `GH_PAT_SCAN` (not the default `GITHUB_TOKEN`) must exist as a repo secret for the secret-scan job to run; if it's ever revoked/missing, this history explains why.
**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f5abed5.
