# Context: flatten-homelab-app-env

**Feature**: `docs/roadmap/features/302-flatten-homelab-app-env/feature.md`
**Product Spec**: `docs/roadmap/features/302-flatten-homelab-app-env/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/302-flatten-homelab-app-env/implementation-spec.md`

---

## Session 2026-11-06T21:36:06Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story. Number 302 reserved on origin via `scripts/sdd-allocate-feature-number.sh` (cursor ref `sdd/feature-cursor`).
- Operator decisions (asked and answered in-session): (1) the three values `DB_PASSWORD`, `APP_URL`, `SEED_USER_ID` become required flat `homelab` rows, no `app_env` escape hatch; (2) the legacy `APP_ENV` blob fallback is dropped and each key falls back to the same-named environment secret; (3) process: this SDD path (story, then `/sdd-design quick`), not a waiver; (4) nothing is written to `homelab.app_env` yet, so no migration.
- My default, not asked: keep exporting a single `APP_ENV` blob so `scripts/homelab-release-env.sh` and the render tests stay untouched (FR-3). Raise it at design if the operator prefers individual exports.
- Verified from the repo (origin/main-dev ab8a9ce): neither `secrets/staging.enc.yaml` nor `secrets/production.enc.yaml` has a `homelab` section (key names are plaintext); feature 286 is `launched`; the durable scenarios naming `homelab.app_env` are tagged `@feature-286` in `docs/sdd/business-rules/platform.feature` (AC-5 at line 901, AC-23 at line 1014, and two more that mention `app_env` or an `APP_ENV` secret).
- Unverified (operator-asserted): no `APP_ENV` GitHub environment secret exists.
- Ledger traps surfaced (fails.md, `sops-secrets-migration`): tool/error text quoted from memory; operator-asserted infra facts recorded as unverified. See the product spec's Open Questions.

## Session 2026-11-06T21:41:29Z — sdd-review product-spec

- Round 1: FAIL on criterion 9 only (three unchecked Open Questions); warnings on FR-3 heredoc coverage, FR-5 overclaim, AC-5 substring fragility, AC-10 case-sensitivity and its conflict with the promotion-only rule (C-16), and an incomplete fixture. All fixed in the spec; new scenarios AC-11 (heredoc delimiter by key name) and AC-12 (promotion-time supersession); a `Background` now makes the fixture reproducible.
- Round 2: PASS WITH WARNINGS. Product spec approved. Status: draft → spec-ready.
- Warnings carried: AC-12 is verified at promotion only and must be excluded from promotion (comment added); FR-3 wording on the delimiter message now says it is new behaviour; a string-valued `homelab.app_env` would still be ignored (stated scope, FR-5).
- Decisions from the repo's own rules, not asked: `platform.feature` is not hand-edited (promoted scenarios are never rewritten; rules enter only by promotion; precedent `platform.feature:677-681`); feature 279's `APP_ENV` scenarios stay valid because FR-3 keeps `APP_ENV` as the opaque blob.
- Overlap findings: no in-flight feature edits `scripts/sops_secrets.py`, `scripts/sops-secrets.test.sh`, `deploy-homelab.yml`, the runbook or `platform.feature` (297, 298, 295, 296 checked; 297 depends on KEYS staying the deploy-secret source of truth). Trunk-level collisions only: the promoted scenarios of launched 286 and 279. No FAIL-level overlap, so no merge-order row.
- Recommended design depth: full (overlap warnings against promoted scenarios). Advisory (P-04); operator chose quick.
- Tree: ccr-9bdbcd90-kgj5ev@e2a36ae ≡ origin/ccr-9bdbcd90-kgj5ev (contains origin/main-dev@ab8a9ce). Branch note: this feature has no `feature/<slug>` branch; the session's designated branch carries it, so tree freshness was verified against that branch instead of switching to main-dev (which would have removed the feature directory).

## Session 2026-11-07T00:42:31Z — sdd-design

- Phase 0 Recon: wrote recon.md (deploy tooling only; reuse `resolve`/`_quoted`/`write_github_env` and the test helpers). Post-recon escalation offered (3 feature-286 CHANGEs); operator chose Keep quick.
- Scope amendment mid-design (operator): namespace precedence (target namespace overrides `common`, FR-7, AC-13..16), legacy fallback of an override = its own plain secret, `required` = OR, single merged `keys_for`, namespaces independent and partially overlapping, VM `.env` = every resolved row except the CI-only `HOMELAB_EXPORTS` (exclusion model; silent-ship risk accepted). Spec re-reviewed: PASS WITH WARNINGS, warnings applied.
- Phase 1 Grilling: 5 rounds (quick, extended at operator request). Chosen: merged `keys_for` + flat rows + exclusion, two PR steps. Rejected: see design.md.
- C-16 CHANGE sign-off (operator, approving the design at the gate on 2026-11-07): 286 @AC-5 (Given), @AC-12 (last Then), @AC-23 (superseded; collision guard dropped), @AC-20 (wording). Supersession is written at promotion only (AC-12).
- Open risks mirrored from design.md: exclusion tripwire (step 1), future DO override vs bootstrap, unverified APP_ENV-secret preflight, wider masking, silent non-override documented in the runbook (step 2), sibling-repo runbooks.
- Branch note: no `feature/<slug>` branch; work stays on `ccr-9bdbcd90-kgj5ev`.
- Status: spec-ready → design-approved.

## Session 2026-11-07 — sdd-spec

- Generated implementation-spec.md with 5 steps. Status → implementation-ready.
- Tree: ccr-9bdbcd90-kgj5ev@42e1463 ≡ origin/ccr-9bdbcd90-kgj5ev (origin/main-dev@ab8a9ce is an ancestor; no tracked changes). No `feature/flatten-homelab-app-env` branch exists on origin; `feature.md` still names it as the Development Branch, so /sdd-execute must resolve the PR base before the first write.
- Key codebase findings (all re-read on this tree; recon.md line numbers were still exact):
  - `scripts/sops_secrets.py`: `app_env` row `:39`; `keys_for` `:66-67` has only two callers (`resolve` `:151`, `scripts/do-render-app-spec.py:101`) plus `legacy_names` `:76`; `cmd_build` reads `KEYS` directly (`:338`) and is unaffected.
  - `scripts/sops-secrets.test.sh`: `cli` `:99-106` runs the script file directly, so the `T_KEYS_EXTRA` patch needs `cli` to move to `python3 -c`; `expected_legacy` `:609-631` already yields plain `secrets.<K>` for homelab-owned names, so only the `:620` reverse-map and the merged-view shape change.
  - `.github/workflows/deploy-homelab.yml:106` is the single `LEGACY_APP_ENV` line; `APP_ENV` is still consumed unchanged at `:145-148`.
  - Local run needs `sops`, which was not on PATH in this sandbox; the CI `sops-secrets` job (`ci.yml:975-999`) and `shell-lint` (`ci.yml:654-668`, shellcheck + `shfmt -i 2` over `scripts/*.sh`) are the authority.
- Spec decisions (mine, not asked): (1) Steps 1-4 are one atomic unit (`Lands with`, cap 4); (2) the two table-check messages (`KEYS row <ns>.<name>: a non-common row must target only its own namespace's target`, `KEYS declares <ns>.<name> twice`) are new text defined by the spec because the design names the checks but not the wording; (3) `no_unprefixed` skipping `LEGACY_*:` lines and `expected_legacy`'s multi-namespace branches are carried from the design but unexercised until an override row ships.
- Flags for `/sdd-review impl-spec`: AC-12 has no step by design (promotion time, C-16); AC-10 is covered by the docs Step 5 rather than a test step; FR-7 corners (required OR, empty override, `differs from legacy` label, table check) have no dedicated `@AC-*`, so they trace to FR-7 only.

## Session 2026-11-07T00:52:11Z — sdd-review impl-spec (advisory)

- Result: 0 failures, 2 warnings, 3 notes (advisory — did not block). Tree: ccr-9bdbcd90-kgj5ev@d602aa0 ≡ origin (merged origin/main-dev@ab8a9ce).
- Unresolved ✗ / ⚠ carried into execution:
  - Step 1 instr. 5 (C-18): the `no_unprefixed` skip of `LEGACY_*` lines is likely unneeded — the three new `secrets.*` names are not in `COMMON_RE` (`sops-secrets.test.sh:640`). Drop it or justify it at execution — [ ] unaddressed
  - Step 1 Verification states no coverage threshold (literal rubric noise: scripts, CI `sops-secrets` job is the gate) — [ ] unaddressed (waivable)
  - Note: `compose.yml:32` cited for `SEED_USER_ID`; it appears only at :37 — [ ] correct the citation
  - Note: `expected_legacy` branch for a homelab override of a common name is unreachable until an override ships — [ ] accepted
  - Note: Step 4's final grep exits 1 when clean; do not chain under `set -e` — [ ] heed at execution
- Overlap findings: none (clean vs 291, 293–298; 295 edits `ci.yml`, 302 only reads it; re-check if 297 adds a KEYS row).

## Session 2026-11-07T01:14:00Z — sdd-execute (sequential)

- Mode-entry confirmed by the operator. Branch: commits go straight on `ccr-9bdbcd90-kgj5ev` (no `feature/flatten-homelab-app-env` on origin); the integration PR targets `main-dev`.
- Tooling setup (steps 1-5): sops 3.13.3 ✓ (pinned binary from an earlier session; sha pin in `setup-sops`) · age ✓ · jq ✓ · ruff ✓ · yq ✓ (mikefarah v4.44.3, built with `go install` after the binary download was refused by the sandbox) · shellcheck ⬇ and shfmt ⬇ (pip `shellcheck-py`, `shfmt-py`) · docker CLI ✓ (daemon not needed: `docker compose config` only).

### Steps 1-4 (atomic unit) — done
- TDD red → green. RED (tree with Step 1 only): `bash scripts/sops-secrets.test.sh resolve` → `ASSERT FAIL: 7: cli failed (app_env is in neither SOPS nor the GitHub secrets)`; `... homelab` → `KeyError: 'APP_ENV'` then `LEGACY_ lines in .github/workflows/deploy-homelab.yml differ from KEYS`. GREEN (Steps 1-4): `sops-secrets.test.sh: all assertions passed (action resolve build render deploy produp homelab bootstrap ac24 cleanup dbnet proddown)`; ruff check/format clean on both scripts; shellcheck + `shfmt -d -i 2` clean; `homelab-render.test.sh` passes unchanged.
- Anti-vacuity: flipping the namespace precedence in `keys_for` makes case 14 fail (`JWT_SECRET label is 'sops'`); restored.
- Scenarios: AC-1/2/3/4/5/6/7/11/14 (cases 7, 9, 10, 11), AC-8 (`group_homelab`), AC-9 (case 8), AC-13/15/16 (cases 14-16), FR-7 `required` OR (17) and the table check (18).
- Review warnings: Step 1 instruction 5 (`no_unprefixed` skipping `LEGACY_*` lines) was written and then DROPPED — the three new `secrets.*` names are not in `COMMON_RE`, so it was unneeded (C-18). [x] resolved. Coverage-threshold note: waived (scripts; the CI `sops-secrets` job is the gate). `compose.yml:32` citation: `SEED_USER_ID` is only at `:37` (the test asserts the value, not the line). Step 4's trailing `grep` exits 1 when clean (used with `||`/`if`, not under `set -e`).
- Files: `scripts/sops-secrets.test.sh`, `scripts/sops_secrets.py`, `scripts/do-render-app-spec.py`, `.github/workflows/deploy-homelab.yml`.
- Deviations: none. The local `docker` daemon is down; `docker compose config` does not need it.

### Step 5 — docs: runbook flat layout and namespace precedence [done]
- TDD: N/A (docs + a comment). Verification: no case-sensitive `app_env` in `docs/runbooks/sops-secrets.md`; homelab row lists `DB_PASSWORD`/`APP_URL`/`SEED_USER_ID`; `sops (homelab)` and the override rule present; `homelab-render.test.sh` passes unchanged, shellcheck + `shfmt -d -i 2` clean. Teardown: runbook re-read against `scripts/sops_secrets.py` (labels, `HOMELAB_EXPORTS`, required, undeclared-override-ignored).
- Config-key wiring gate (`check-config-wiring.mjs --final`): exit 0; one REPORTED line (`trading.fill_poller.interval_ms` read-unseeded) identical on the baseline tree, unrelated.
- Files modified: `docs/runbooks/sops-secrets.md`, `scripts/homelab-render.test.sh` (comment only).
- Deviations: none. Preflight (operator-asserted, unverified): no `APP_ENV` environment secret exists — in the runbook preflight list.
- AC-12 (promotion): to be done in the integration PR step (operator-confirmed plan), not an implementation step.
