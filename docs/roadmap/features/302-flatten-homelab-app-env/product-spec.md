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

FR-3. The exported interface does not change: the resolver still writes one `APP_ENV` dotenv blob to the job environment, now built from the three flat keys (in `KEYS` order, each as `KEY='value'`) followed by the common tail, so `scripts/homelab-release-env.sh` and the render tests are unchanged. The existing value rules stay: a value with a single quote or a line break is refused naming the key, and a value containing the reserved heredoc delimiter is refused, also naming the key (new behaviour: today the delimiter refusal names `APP_ENV`, not the key).

FR-4. The legacy `APP_ENV` GitHub-secret blob fallback is removed from the resolver and from `.github/workflows/deploy-homelab.yml` (`LEGACY_APP_ENV`, `secrets.APP_ENV`). The workflow instead provides `LEGACY_DB_PASSWORD`, `LEGACY_APP_URL` and `LEGACY_SEED_USER_ID` from the same-named environment secrets, and the workflow-consistency check derives the expected `LEGACY_*` lines from the `KEYS` table so the two cannot drift.

FR-5. A file that still holds a nested `homelab.app_env` map fails the resolver, naming that key, so a stale nested layout is not silently ignored. Unknown or misspelled keys elsewhere under `homelab` are not detected (out of scope).

FR-6. The documentation describes the new layout: `docs/runbooks/sops-secrets.md` (key table, homelab enablement, adding a key, legacy-secret removal list, and the namespace-precedence rule with its `sops (<namespace>)` label) is updated in this feature's PR. The durable suite `docs/sdd/business-rules/platform.feature` is **not** hand-edited (promoted scenarios are never rewritten, and a rule enters only by promotion): at promotion this feature's scenarios are written with `@feature-302` tags and a comment marks feature 286's `@AC-5`, `@AC-12`, `@AC-20` and `@AC-23` (the scenarios that name `homelab.app_env` or the `APP_ENV` secret) as superseded, following the precedent at `platform.feature:677-681`. Feature 279's `APP_ENV` scenarios stay valid, because FR-3 keeps `APP_ENV` as the opaque blob handed to `scripts/homelab-release-env.sh`.

FR-7. Namespace precedence: a target's own namespace (target `homelab` → namespace `homelab`, target `do` → namespace `digitalocean`) overrides a same-named `common` row. For the homelab target, `homelab.X` beats `common.X` when `KEYS` declares both rows; for any target the rule is generic (target namespace over `common`). The winning namespace is reported in the step summary as `sops (<namespace>)`, or `sops (<namespace>; differs from legacy)` when it also differs from the legacy secret; a name that only `common` supplies reports `sops` as today. Only names declared in `KEYS` under both namespaces can be overridden: an undeclared `homelab.<common name>` value in a file is not an override and is ignored (unknown keys stay undetected, see Out of Scope). The legacy GitHub-secret fallback still applies to the merged key. An overridden key is one merged entry: it appears once in the summary, once in `APP_ENV` (at its `common` tail position), and once in the expected `LEGACY_*` set. The overriding row's `required` flag governs, and an empty override value falls through to `common` like any empty stored value. No override row ships in this feature; it adds the rule, not a use of it. The old `homelab.app_env must not contain common key` guard has no equivalent: the namespaces are separate, so there are no collisions, only overrides.

## Out of Scope

- The pipeline-owned keys (`DB_HOST`, `DB_NAME`, `DB_USER`, `APPLICATION_ENV`, `TRADING_MODE`, image digests, mTLS leaves) and `scripts/homelab-release-env.sh`.
- The `common` tail and DigitalOcean behaviour.
- Any escape hatch or generic extra-entries map.
- Shipping an actual override row (for example a separate `homelab.JWT_SECRET`); FR-7 only defines the rule.
- Detecting unknown or misspelled keys under `homelab`.
- Hand-editing promoted scenarios in `platform.feature`.
- Migration of existing data: nothing has been written to `homelab.app_env` in either file.
- The sibling repository's runbooks (homelab-edge `deploy-compose-app.md`, `home-side.md`), which still describe the 1Password and `APP_ENV` secret layout: a separate follow-up there.

## Affected Services

None of the twelve runtime services. This is platform deploy tooling: `scripts/sops_secrets.py`, `scripts/sops-secrets.test.sh`, `.github/workflows/deploy-homelab.yml`, `docs/runbooks/sops-secrets.md`, and (comment only) `scripts/homelab-render.test.sh`. `docs/sdd/business-rules/platform.feature` changes only through promotion (FR-6).

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

- [x] **Scope amendment (operator, 2026-11-06):** the operator asked that same-named keys in the target namespace override `common` ("the SOPS file has namespaces; there are no name collisions, only overrides"). Answered in-session: homelab wins and is reported `sops (homelab)`; only keys declared in both namespaces; generic for every target; added to 302 (FR-7, AC-13..AC-16), so the product spec is re-reviewed.
- [x] **Known trap (ledger, `sops-secrets-migration` assumption, 2026-11-04):** do not quote tool or error text from memory. Resolved at product-spec review: every message in `acceptance.feature` was checked against the shipped `scripts/sops_secrets.py` (missing-key, quote/newline, source labels, and the generic leaf check that yields `homelab.app_env must be a string` once the special case at lines 126-131 is removed). The new heredoc-delimiter message (AC-11) is new text defined by this feature, so the design's smoke test pins it.
- [x] **Unverified, operator-asserted:** no `APP_ENV` GitHub environment secret exists, because homelab has never deployed. Handed to the design phase as a preflight: `gh secret list --env staging` and `gh secret list --env production` must not list `APP_ENV` before the first homelab deploy. Verified from the repo: neither encrypted file on `main-dev` has a `homelab` section yet.
- [x] **When `platform.feature` is updated:** decided by the repository's rules, not by preference. Promoted scenarios are never rewritten and a rule enters only by promotion (`docs/sdd/business-rules/CLAUDE.md`), so this PR does not touch the file; supersession is recorded at promotion (FR-6, AC-12). The design's scenario recon still classifies each existing rule PRESERVE / EXTEND / CHANGE.
