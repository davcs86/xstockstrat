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
