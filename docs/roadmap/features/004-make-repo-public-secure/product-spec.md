# Product Spec: make-repo-public-secure

**Created**: 2026-05-10

---

## Problem Statement

The xstockstrat-orchestration repository contains the full platform codebase including configuration, scripts, CI/CD pipelines, and documentation. Before making it public on GitHub, any hardcoded secrets, credentials, API keys, tokens, internal hostnames, or other sensitive values must be identified, removed, and replaced with safe references — and the documentation must be updated to guide external contributors without exposing internal infrastructure details.

## User Story

As a platform maintainer, I want to audit and sanitize the repository of all sensitive values and update the documentation for a public audience, so that the repository can be safely made public on GitHub without leaking credentials or exposing internal infrastructure details.

## Functional Requirements

FR-1. Scan the entire repository (all files: source code, scripts, CI/CD YAML, Docker files, documentation, config templates, `.env*` files) for patterns that match secrets: API keys, tokens, passwords, private keys, connection strings with credentials, bearer tokens, and internal hostnames/IPs used as credentials or account identifiers.

FR-2. Remove or replace every discovered secret with an appropriate safe substitute:
  - Environment variable references (`$SECRET_NAME`, `${SECRET_NAME}`)
  - Placeholder strings clearly marked as examples (e.g., `<YOUR_ALPACA_API_KEY>`)
  - References to the secret store pattern documented in CLAUDE.md (`secret.*` config prefix)

FR-3. Ensure `.gitignore` covers all files that should never be committed: `.env`, `.env.local`, `.env.*.local`, `*.pem`, `*.key`, `secrets.*`, `credentials.*`, and any service-specific secret file patterns.

FR-4. Add a `SECURITY.md` file at the repo root that explains the responsible disclosure policy and instructs reporters not to open public issues for vulnerabilities.

FR-5. Add a `CONTRIBUTING.md` file at the repo root covering: fork-and-PR workflow, branch naming conventions, how to run the stack locally (without real credentials), code style requirements, and how to run tests.

FR-6. Audit all documentation under `docs/` for references to internal infrastructure details (internal hostnames, account IDs, internal URLs, team-internal tool names) and replace them with generic descriptions or environment variable references.

FR-7. Verify CI/CD workflow files (`.github/workflows/`) do not contain hardcoded secrets — all sensitive values must be GitHub Actions secrets (`${{ secrets.* }}`). Add a `secret-scan` CI job running both `trufflehog` (full git history depth) and `gitleaks` (working-tree pattern ruleset) on every PR targeting `main-dev` or `main`.

FR-8. Add a `.env.example` file at the repo root listing all required environment variables with placeholder values and short descriptions, so contributors know what to configure without seeing real values.

## Out of Scope

- Rotating or invalidating any leaked credentials (handled by the security team out-of-band).
- Making individual service repos (`services/*`) public (separate decision; not in scope).
- Changing the authentication architecture of any service.
- Implementing any new features or capabilities.

## Affected Services

Exact service names from CLAUDE.md Service Registry — this is a cross-cutting audit:
- All services under `services/` — any service source file may contain hardcoded secrets
- `packages/proto/` — proto files and generated stubs (check for internal endpoints)
- `scripts/` — bootstrap, migration, codegen scripts (check for embedded credentials)
- `.github/workflows/` — CI/CD workflows (check for hardcoded secrets vs. `${{ secrets.* }}`)
- Root-level config files — `docker-compose.yml`, `Dockerfile.codegen`, `.do/app*.yaml`

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/make-repo-public-secure` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking — docs and config hygiene only)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

1. `git grep -rE "(AKIA|sk_live|sk_test|ghp_|glpat-|-----BEGIN|password\s*=\s*['\"][^$])" -- . ":!*.example" ":!CONTRIBUTING.md" ":!SECURITY.md"` returns no matches in committed files.
2. All CI/CD workflow files reference secrets exclusively via `${{ secrets.* }}` — no inline credential strings.
3. A `.env.example` file exists at the repo root with placeholder values for every required environment variable used by the stack.
4. `.gitignore` explicitly covers `.env`, `.env.local`, `*.pem`, `*.key`, and common secret file patterns.
5. `SECURITY.md` exists at the repo root with a responsible disclosure contact method.
6. `CONTRIBUTING.md` exists at the repo root with local setup instructions that do not require real credentials (paper trading / mock mode).
7. `docs/` contains no hardcoded internal hostnames, account IDs, or internal URLs — all replaced with generic or environment-variable-based references.
8. A maintainer can follow `CONTRIBUTING.md` and `.env.example` to run the full local dev stack in paper-trading mode with no access to internal systems.

## Open Questions

- [x] OQ-1 — RESOLVED: Both `trufflehog` and `gitleaks` will be added to `.github/workflows/ci.yml` as a `secret-scan` CI job. `trufflehog` covers git history depth; `gitleaks` covers the working tree with its 150+ pattern ruleset. Both run on every PR.
- [x] OQ-2 — RESOLVED: Audit first using `git log -S <pattern> --all` (and `trufflehog` over full history). If secrets are found in historical commits, use `git filter-repo` to scrub before the repo goes public. Scope expands to history purge only if the audit finds hits.
- [x] OQ-3 — RESOLVED: Merging this PR into `main-dev` is the approval gate. Any maintainer may flip the repo to public on GitHub immediately after merge — no separate sign-off required.
