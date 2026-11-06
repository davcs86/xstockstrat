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
