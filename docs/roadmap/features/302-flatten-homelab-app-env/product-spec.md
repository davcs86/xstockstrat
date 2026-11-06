# Product Spec: flatten-homelab-app-env

**Created**: 2026-11-06

---

## Problem Statement

Feature 286 stores the homelab-only `.env` entries as a free-form map, `homelab.app_env`, while every other deploy secret is a named row of the `KEYS` table in `scripts/sops_secrets.py` (`common`, `digitalocean`, and the other `homelab` keys). The map bypasses the table: its entries are not individually required, not reported in the step summary, have no per-key legacy fallback, and are parsed by a separate code path (map rendering, a legacy blob parser and a "common keys may not appear here" check). The operator wants the same table-driven treatment for all of them.

## User Story

As the operator who edits `secrets/<env>.enc.yaml`, I want each homelab `.env` value to be its own named, required key under `homelab`, so that a missing value fails the deploy by name, every value shows its source in the step summary, and adding or changing one follows the same one-row procedure as `common` and `digitalocean` keys.

## Functional Requirements

FR-1. The `KEYS` table gains three required rows in namespace `homelab`, target homelab only: `DB_PASSWORD`, `APP_URL`, `SEED_USER_ID`. The `homelab.app_env` row and every code path that handles a map value are removed. There is no escape hatch for extra entries.

FR-2. Each of the three keys resolves SOPS first, then falls back to the same-named GitHub environment secret, exactly like `TS_AUTHKEY` and the other homelab-only keys. The step summary reports each as `sops`, `github`, `sops (differs from legacy)` or `MISSING`. A missing required key fails the deploy before anything is applied, naming the key and never a value.

FR-3. The exported interface does not change: the resolver still writes one `APP_ENV` dotenv blob to the job environment, now built from the three flat keys (in `KEYS` order, each as `KEY='value'`) followed by the common tail, so `scripts/homelab-release-env.sh` and the render tests are unchanged. The existing value rules stay: a value with a single quote or a line break is refused naming the key, and a value containing the reserved heredoc delimiter is refused.

FR-4. The legacy `APP_ENV` GitHub-secret blob fallback is removed from the resolver and from `.github/workflows/deploy-homelab.yml` (`LEGACY_APP_ENV`, `secrets.APP_ENV`). The workflow instead provides `LEGACY_DB_PASSWORD`, `LEGACY_APP_URL` and `LEGACY_SEED_USER_ID` from the same-named environment secrets, and the workflow-consistency check derives the expected `LEGACY_*` lines from the `KEYS` table so the two cannot drift.

FR-5. A file that still holds a nested `homelab.app_env` map fails the resolver, naming that key. A stale layout is never silently ignored.

FR-6. The documentation and the durable suite describe the new layout: `docs/runbooks/sops-secrets.md` (key table, homelab enablement, adding a key, legacy-secret removal list) and the `platform.feature` scenarios that name `homelab.app_env` or the `APP_ENV` secret.

## Out of Scope

- The pipeline-owned keys (`DB_HOST`, `DB_NAME`, `DB_USER`, `APPLICATION_ENV`, `TRADING_MODE`, image digests, mTLS leaves) and `scripts/homelab-release-env.sh`.
- The `common` tail and DigitalOcean behaviour.
- Any escape hatch or generic extra-entries map.
- Migration of existing data: nothing has been written to `homelab.app_env` in either file.
- The sibling repository's runbooks (homelab-edge `deploy-compose-app.md`, `home-side.md`), which still describe the 1Password and `APP_ENV` secret layout: a separate follow-up there.

## Affected Services

None of the twelve runtime services. This is platform deploy tooling: `scripts/sops_secrets.py`, `scripts/sops-secrets.test.sh`, `.github/workflows/deploy-homelab.yml`, `docs/runbooks/sops-secrets.md` and `docs/sdd/business-rules/platform.feature`.

## Consumer Surface(s)

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — operator-facing deploy secrets only. The capability is consumed by the operator editing `secrets/<env>.enc.yaml` and by `deploy-homelab.yml`; no end-user surface changes.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

The three keys are deploy-secret keys of the SOPS files, not `xstockstrat-config` keys; they follow no `<service>.<category>.<key>` naming and are declared in FR-1.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/flatten-homelab-app-env` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — not applicable (no service); one required PR review applies
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap (ledger, `sops-secrets-migration` assumption, 2026-11-04):** do not quote tool or error text from memory. Every message in `acceptance.feature` was read from the shipped `scripts/sops_secrets.py` on `main-dev`; AC-6's wording (`homelab.app_env must be a string`) comes from the generic leaf check in `decrypt()` and must be re-verified against the real behaviour once the special-case is removed (design smoke test).
- [ ] **Unverified, operator-asserted:** no `APP_ENV` GitHub environment secret exists, because homelab has never deployed. Preflight: `gh secret list --env staging` and `gh secret list --env production` must not list `APP_ENV`. Verified from the repo: neither encrypted file on `main-dev` has a `homelab` section yet.
- [ ] How the changed durable scenarios in `platform.feature` (`@feature-286`, AC-5 and AC-23 and the two that mention `homelab.app_env` or the `APP_ENV` secret) are updated, in this feature's PR or at its launch promotion (C-16). Decided by the design phase's scenario recon (PRESERVE / EXTEND / CHANGE).
