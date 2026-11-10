# Context: ui-env-themed-bundles

**Feature**: `docs/roadmap/features/307-ui-env-themed-bundles/feature.md`
**Product Spec**: `docs/roadmap/features/307-ui-env-themed-bundles/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/307-ui-env-themed-bundles/implementation-spec.md`

---

## Session 2026-11-10 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator decisions (AskUserQuestion, 2026-11-10): (1) build-time Docker `ARG UI_THEME`, one image per deploy workflow, tags unchanged — rejected two-images-per-build and a runtime switch; (2) staging keeps Nocturne, production gets a NEW theme; (3) unset `UI_THEME` → staging (fail-safe: non-prod builds never look like prod).

## Session 2026-11-10 — sdd-review product-spec

- First pass FAIL (C-11: 3 unchecked Open Questions). Fixed: palette deferred to /sdd-design (operator owns), oklch trap → FR-9, APPLICATION_ENV trap → FR-10; FR-4 process clause removed; AC-6 rewritten as image outcome; AC-9 (docker build-arg), AC-10, AC-11 (staging chart) added.
- Second pass: PASS WITH WARNINGS. Status: draft → spec-ready.
- Warnings: AC-1/AC-2/AC-8 use symbolic palette values — firm up after design approves palette; AC-10 is a behavioral proxy for FR-10 (consider a source-level guard); docker-build.yml needs per-service build-arg plumbing for the xstockstrat-ui matrix leg only.
- Overlap findings: none (297/298 share no files with 307).
- Recommended design depth: quick (single service + CI plumbing; no proto/config/DB gates).

## Session 2026-11-10 — sdd-design (quick → operator requested round 2)

- Phase 0 Recon: wrote recon.md. Found a third docker-build.yml caller (homelab-images.yml) and the SHA-tag collision risk.
- Round 1: the proposer proposed a webpack alias `@theme-tokens` → `src/styles/themes/{staging,production}.css` with a next.config.js allow-list, a Docker ARG plus `io.xstockstrat.ui-theme` label, and a homelab guard. The adversary returned NEEDS WORK with no Floor breach. HIGH items:
  - the guard fails open and its jq shape is unproven;
  - DO prod-up/staging-up are unguarded;
  - homelab-images can re-theme a prod tag;
  - the bundle check doesn't run on PRs;
  - the oklch `getComputedStyle` ledger trap applies;
  - AC-10 was optional;
  - @AC-19 is narrowed.
- Operator decisions (AskUserQuestion, 2026-11-10):
  - **@AC-19 CHANGE signed off.** "A manual run redeploys an already-built SHA *whose UI theme label matches the target*." A pre-307 unlabelled image passes silently on staging and with a warning on production.
  - **Contrast:** fix it in the production palette by lifting `--primary` lightness to about 0.62 with a dark `--primary-foreground`. Write the baseline into ui-ux-governance §5. Staging shortfalls become known deviations (staging values stay frozen).
  - **Scope widened: tokenize everything now.** The ~28 /insights literals become tokens and the manifest/themeColor become per theme. The operator accepts that staging /insights colors move to the Nocturne tokens. Added FR-11..FR-14 and AC-12..AC-16. This is a post-review scope change, so re-run `/sdd-review product-spec` is advisory before /sdd-spec.
  - Gate: the operator chose **Run another round**.

## Session 2026-11-10 — sdd-review product-spec (re-run after scope widening)

- Re-review: PASS WITH WARNINGS (W1–W8), no blockers, no Floor breach. Overlap: CLEAN; `ci.yml` is rebase-only shared with in-flight 297/298.
- Warnings addressed (operator asked to address all):
  - W1: FR-8 reconciled with FR-11. AC-7 now covers `/insights` (@FR-11).
  - W2: C-16 @AC-19 @feature-279 CHANGE sign-off and an advisory Platform Lead review recorded under Feature Workflow Notes.
  - W3: Affected Services enumerates every UI file area, the CI workflows (including prod-up/staging-up/homelab-images/Dockerfile.e2e/ci.yml) and the docs.
  - W4: palette Open Question kept `[x]` with an explicit exit condition. AC-1/AC-2/AC-3 now pin the concrete Nocturne literals. AC-1/AC-8/AC-13 carry "literal pinned from design.md" placeholders to fill at the design gate.
  - W5: the AC-12 literal-scan regex is tightened (non-comment lines, .ts and .tsx, tests excluded) and the sidebar.tsx:455 fix is asserted.
  - W6: AC-14 covers the full FR-13 pair set. New AC-17 covers the staging known deviations.
  - W7: FR-14 states the unlabelled-image policy. AC-16 is now a Scenario Outline over deploy-homelab, staging-up and prod-up, in both directions and for unlabelled images.
  - W8: FR-12 names `--background` hex as the single source; the mechanism is deferred to design.md.
- Earlier-review warnings now closed by design inputs: AC-10 is a proxy (round 1 made AC-10 mandatory); docker-build.yml per-leg plumbing (round 2 brief A).
- Status unchanged (`spec-ready`).
