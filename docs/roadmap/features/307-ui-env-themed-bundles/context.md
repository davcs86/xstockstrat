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
