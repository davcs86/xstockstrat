# Context: sops-secrets-migration

**Feature**: `docs/roadmap/features/286-sops-secrets-migration/feature.md`
**Product Spec**: `docs/roadmap/features/286-sops-secrets-migration/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/286-sops-secrets-migration/implementation-spec.md`

---

## Session 2026-11-03 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator decisions (gathered by interview before the story; binding on design):
  - Scope: DO runtime secrets (DEV_*/PROD_*) + homelab secrets (TS_AUTHKEY[_EXPIRES], DEPLOY_SSH_KEY,
    DEPLOY_KNOWN_HOSTS, APP_ENV, MTLS_CA). Platform creds stay native.
  - Keys: age, one keypair per env in the existing `staging`/`production` GitHub Environments as
    `SOPS_AGE_KEY`, plus operator recipient `vars.SOPS_OPERATOR_AGE_RECIPIENT`. The operator
    generates the keys locally, and the bootstrap derives the public keys via `age-keygen -y`.
  - Files: `secrets/{staging,production}.enc.yaml`, namespaced `digitalocean:`/`homelab:`
    (separate mTLS CAs — `docs/patterns/inter-service-mtls.md:105`).
  - DO deploy jobs bind to the existing staging/production environments, and the operator accepted
    their protection rules.
  - Cutover: dual-read with per-key fallback to legacy GitHub secrets and a source report, fail-closed
    only when a key is in neither. Legacy removal is a follow-up.
  - Homelab: SOPS **replaces** 1Password. The bootstrap reads the currently effective source.
  - APP_ENV: exploded per-key map `homelab.app_env`.
  - Bootstrap: PR to main-dev via GH_PAT, self-verifying.
  - SDD: operator chose to run the full SDD entry point (story → design quick) rather than treat this as process-only.
- Feature number 286 reserved via scripts/sdd-allocate-feature-number.sh (local max+1 would have given 285, which another session already holds on the cursor).
- Operator answers (2026-11-03, pre-review): work on `feature/sops-secrets-migration` + single squash PR
  into main-dev (overrides the harness "push only to main-dev" directive); bootstrap refuses to overwrite
  an existing file unless `force: true` (FR-5f, @AC-15); prod-up aligned to the full key set incl. VAPID +
  mTLS (FR-9, @AC-16 — a deliberate behavior change); `production` environment has no protection rules
  that would block binding the DO deploy jobs to it.

## Session 2026-11-03 — sdd-review product-spec

- First pass FAILED on criterion 9 (C-11): three unchecked Open Questions. Fixed by moving the Ledger
  traps (fails.md L1095, L443) into `## Notes for Design / Spec` and resolving the sops pin approach.
  Also applied the advisory fixes: AC-10/AC-12 Thens reworded as outcomes, @FR-9 added to AC-11, FR order corrected.
- Re-review: PASS WITH WARNINGS. Status: draft → spec-ready.
- Warnings carried to design/spec:
  - [ ] Pin the exact sops/age version + SHA-256 at spec time.
  - [ ] Enumerate required vs optional keys per namespace (fail-closed must be testable per key).
  - [ ] Tighten AC-12's "VM reports healthy" into a concrete signal (e.g. `gate status` exit 0).
- Overlap findings: none in flight. Trunk context: rebase onto launched 279's `deploy-homelab.yml`,
  the `HOMELAB_DEPLOY_ENABLED` gate in deploy-dev/prod, and the `homelab-release-env.sh` contract.
- Recommended design depth: full (rubric default; two deploy targets, five workflows, secret custody).

## Session 2026-11-03 — operator revision (post spec-ready)

- Operator: three namespaces — `common` (app needs it regardless of hosting), `digitalocean` (DO-only),
  `homelab` (homelab-only). Supersedes the two-namespace layout.
- Operator: on a common-key conflict between DO and homelab sources, **DigitalOcean wins** (only the
  key names are logged). Homelab is **not live yet**, so this is non-disruptive.
- Operator: **unify MTLS_CA** into `common` from DO's CA (FR-10). This reverses
  `docs/patterns/inter-service-mtls.md:105` ("a separate CA from DO's"), and that doc must be updated.
- Operator: `digitalocean` holds APP_ID (R) + PROJECT_ID (O), moved from `DO_{DEV,PROD}_{APP,PROJECT}_ID`.
  DIGITALOCEAN_ACCESS_TOKEN stays native (account-wide; environment-less `prod-down.yml` uses it).
- Derived: every homelab key is optional at bootstrap (not live) and required at homelab deploy.
  The required/optional matrix is in FR-3, which closes the review warning "enumerate required vs optional".
- New hazard recorded: a stale `digitalocean.APP_ID` after prod-up recreation fails safe. prod-up's
  warning now points at the SOPS file (@AC-17).
- New scenarios: @AC-17..@AC-20. AC-2 rewritten for the 3-namespace split (same ID, pre-design).
- Spec materially changed after the review gate, so re-review was run (see next entry).
- Re-review of the revised spec: PASS WITH WARNINGS, no blockers; status stays spec-ready. Applied:
  FR-6 now reads `common` + `digitalocean` explicitly, and AC-2 asserts `digitalocean.PROJECT_ID`.
  Carried: AC-14 is inspection-only (accepted); sops/age pin at spec time; AC-12 health signal to tighten.
- Operator (2026-11-03): DO app ID is **resolved by spec name** at deploy time (FR-11, @AC-17/@AC-21)
  instead of being stored. This removes the stale-ID-after-prod-up hazard outright. The rejected
  alternative, prod-up running `sops set` and opening a PR, leaves main stale until merge + promotion.
  `digitalocean` now holds only PROJECT_ID. @AC-17 was rewritten pre-design (same ID).
- Operator: design depth = **full**.
- Phase 0 recon written (recon.md). Corrected the spec's gate-var name to HOMELAB_STAGING_ENABLED/HOMELAB_PRODUCTION_ENABLED (recon finding).

## Session 2026-11-03 — sdd-design (full) Phase 1, round 1

- Proposal: Python resolver `scripts/sops_secrets.py` (resolve/build, one KEYS table), unified
  `scripts/do-render-app-spec.py` (replaces do-inject-prod-secrets.py), composite `.github/actions/setup-sops`,
  env-bound deploy.yml, app-ID by name, bootstrap matrix → ciphertext artifacts → single PR job.
- Adversary verdict: NEEDS WORK — 1 blocker, 6 major, no Floor breach.
  - O1 BLOCKER (C-16 @feature-210 @AC-2/@AC-4): in an `environment:`-bound reusable job, the env secret
    `MTLS_CA` (homelab CA) shadows the caller-passed `MTLS_CA` (DEV_/PROD_MTLS_CA), which silently swaps DO's CA
    at rollout step 1. Fix: read legacy values only under DEV_/PROD_ names via `secrets: inherit`.
  - O2: homelab detaches to the image commit (deploy-homelab.yml:64-81), so tooling and SOPS must resolve before detach / from GITHUB_SHA.
  - O3: force guard fails open (depth-1 checkout has no origin/main-dev). Rollout needs promotion to main
    before the bootstrap can be dispatched (default branch = main). deploy-homelab.yml:19 says production "needs the
    environment's reviewers", which contradicts the "no protection rules" answer, so re-confirm with the operator.
  - O4: APP_ENV render not byte-safe (compose-go `$`/` #` expansion), so single-quote the common keys. Parser must
    mirror the `owned` regex (export/KEY:) and render common LAST so DO wins.
  - O5: `build` must mask exploded/1P values. Render script masks yaml_pem leaf/CA strings. Errors name keys only.
  - O6: warn when the SOPS value differs from the legacy value (names only). A force reseed lists changed keys by hash in the PR body.
  - O7: avoid exporting secrets to GITHUB_ENV in DO (resolve+render in one process). SHA-pin actions where it is kept.
  - Minors: platform @AC-8 names the deleted script (EXTEND); derive placeholders from KEYS; refuse non-string
    leaves; 1Password-in-bootstrap is YAGNI for a non-live homelab (operator call); verify the sops ≥3.9 CLI at spec time.
