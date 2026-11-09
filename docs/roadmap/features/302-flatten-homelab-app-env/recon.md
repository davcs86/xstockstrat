# Recon: flatten-homelab-app-env

**Created**: 2026-11-06
**From**: product-spec.md
**Tree**: ccr-9bdbcd90-kgj5ev@44236de ≡ origin/ccr-9bdbcd90-kgj5ev (main-dev@ab8a9ce is an ancestor; feature has no `feature/<slug>` branch, so the designated branch is TARGET)
**Affected services**: none (deploy tooling only: `scripts/`, `.github/workflows/`, `docs/`)

---

## Objective

Replace the nested `homelab.app_env` map in the SOPS deploy secrets with three flat required rows of the `KEYS` table (`DB_PASSWORD`, `APP_URL`, `SEED_USER_ID`, namespace `homelab`), each resolved SOPS-first with a same-named GitHub environment-secret fallback, mirroring `common`/`digitalocean`. The resolver keeps exporting one `APP_ENV` dotenv blob so `scripts/homelab-release-env.sh` is unchanged.

## Codebase Map

- **Deploy tooling** (Python/bash/YAML; no runtime service)
  - KEYS table: `scripts/sops_secrets.py:22-40`; the row to replace is `:39` `("homelab", "app_env", True, (HOMELAB,))`
  - `HOMELAB_TAIL` `:44-46`, `HOMELAB_EXPORTS` `:47-53`, `LEGACY_COMMON_LINE` `:57-59`, `VAR_NAME` `:56`
  - `legacy_name` `:70-71` (app_env special case), `legacy_names` `:74-76`
  - `decrypt()` `:107-134` (app_env dict branch `:126-131`; generic "must be a string" `:132-133`)
  - `resolve()` `:144-187`; `_quoted` `:190-195`; `homelab_app_env` `:198-216`; `write_github_env` `:219-226`; `cmd_resolve` `:229-240`
  - `_strings`/`_sha` dict branches `:98-104`, `resolve` dict handling `:156,163-167`
  - Tests: `scripts/sops-secrets.test.sh` — `group_resolve` cases 7-11 `:194-265`, `expected_legacy` `:608-631` (line 620 reverse-map), `check_legacy` `:633-639`, `group_homelab` `:954-972`; build env `:323` (cosmetic)
  - Workflow: `.github/workflows/deploy-homelab.yml:90-107` (`LEGACY_APP_ENV` at `:106`); `APP_ENV` consumed `:145-148`
  - CI job: `.github/workflows/ci.yml:975-999` (`sops-secrets`; ruff on the two scripts `:995-996`)
  - Unchanged consumers: `scripts/homelab-release-env.sh:13,34-38`, `deploy/homelab/compose.yml:12,15,37,273-274,311-312`, `scripts/do-render-app-spec.py` (DO target only)
  - Docs: `docs/runbooks/sops-secrets.md:11,17,122,128-130,145`; `scripts/homelab-render.test.sh:45` (comment only)

## Patterns to REUSE

- Flat required homelab keys → existing homelab rows (`TS_AUTHKEY`, `DEPLOY_SSH_KEY`, …) at `scripts/sops_secrets.py:35-38`; generic `decrypt()` string validation `:132-133`; `resolve()` SOPS→`LEGACY_<NAME>` fallback `:144-187`
- Dotenv quoting/refusals → `_quoted` `scripts/sops_secrets.py:190-195`
- Heredoc-delimiter refusal → `write_github_env` `:219-226` (generalise per key instead of the app_env-only loop at `:231-237`)
- Test legacy-set derivation → `expected_legacy` `scripts/sops-secrets.test.sh:608-631` (once `legacy_name` loses its special case the `:620` reverse-map goes)
- Tail ordering → `homelab_app_env` `:215-216` (body first, common tail last) retained

## Existing Business Rules (preserve / extend)

Folded from `scenario-recon` (`docs/sdd/business-rules/platform.feature`; no per-service suites apply).
- **CHANGE** `@AC-5 @feature-286` "The homelab APP_ENV is rendered so compose reads every value literally" (`:901`) — Given (`homelab.app_env` map) false; Thens survive over flat keys (requires sign-off in `context.md`; carry into design.md)
- **CHANGE** `@AC-12 @feature-286` "Homelab deploy no longer touches 1Password" (`:952`) — last Then "APP_URL from homelab.app_env" (`:959`) false; line `:958` depends on whether the step summary lists one APP_ENV entry or the flat keys (design decision)
- **CHANGE** `@AC-23 @feature-286` "Homelab app_env may not carry a common key" (`:1014`) — superseded; "no value in the log" clause kept
- **PRESERVE** `@AC-13 @feature-286` (`:961`) per-key GitHub fallback for TS_AUTHKEY/DEPLOY_SSH_KEY/DEPLOY_KNOWN_HOSTS
- **PRESERVE** `@AC-2`, `@AC-20 @feature-286` (`:887`, `:895`) bootstrap seeds only common/digitalocean (`@AC-20` Given wording mentions APP_ENV; wording-stale only)
- **PRESERVE** `@AC-18` (`:981`), `@AC-14` (`:987`, runbook updated in same PR), `@AC-24` (`:1021`, no `MCP_AGENT_SECRET` in `sops_secrets.py`), DO `@AC-8/9/10` (`:923,930,939`)
- **EXTEND** `@AC-2 @feature-279` (`:1072`) missing required value — adds an earlier resolver failure alongside the compose failure
- **PRESERVE** `@AC-4,16,8,22,9,28,31,32 @feature-279` (`:1085,1147,1116,1185,1122,1229,1249,1255`) — `APP_ENV` stays the opaque dotenv blob
- Supersession convention: banner + `#` comment block (precedent `:676-681`, feature 274): "CHANGED by <n> @AC-m (operator-signed C-16 CHANGE, … gate, <date>) … Read the old scenario as superseded." Old scenarios are never edited. Recorded at promotion time (product-spec AC-12).

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none (these are deploy secrets, not `WatchConfig` keys)
- Inter-service edges: none
- New env vars: `LEGACY_DB_PASSWORD`, `LEGACY_APP_URL`, `LEGACY_SEED_USER_ID` in `deploy-homelab.yml` (replace `LEGACY_APP_ENV`); GitHub environment secrets `DB_PASSWORD`, `APP_URL`, `SEED_USER_ID` become the fallback names

## Risks / Not-found

- **Test-harness tension**: `expected_legacy` (`sops-secrets.test.sh:623-624`) expects `LEGACY_<K>: ${{ secrets.<K> }}` for every homelab key — that matches decision (2) naturally, so no special case is needed.
- **Heredoc/quoting for flat keys**: today the delimiter check is app_env-specific (`:231-237`); must apply per key (AC-11 new text).
- **Step-summary entry** (`@AC-12` `:958`): per-key reporting is a stated requirement (FR-1), so the summary will list the three flat keys; `:958` text must be re-expressed in the supersession note.
- **Collision guard** (`@AC-23`): flat names are not common keys, so the guard is moot; dropping it is part of the CHANGE sign-off.
- Not captured by discovery: `docs/patterns/ci-overview.md:29`, `deploy-homelab.yml` past line 170, which compose services own lines `:37,273,311`, `docs/launch-pdfs/*.md` contents. None expected to carry `app_env`.
- No `fails.md` trap identified for this scope beyond the dev-sandbox note (`::add-mask::` lines on stdout during local runs).

## Recommended Scope

1. Tests first: update `scripts/sops-secrets.test.sh` (cases 7-11, `expected_legacy`) — RED.
2. `scripts/sops_secrets.py`: KEYS rows, drop app_env paths, per-key heredoc check, `legacy_name` simplification; GREEN.
3. `.github/workflows/deploy-homelab.yml`: three LEGACY_* lines replace `LEGACY_APP_ENV`.
4. `docs/runbooks/sops-secrets.md` and `scripts/homelab-render.test.sh:45` comment.
5. At promotion: supersession comment block in `platform.feature` (not part of this implementation PR).
