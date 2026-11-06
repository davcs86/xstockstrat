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
