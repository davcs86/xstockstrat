# Context: ui-env-themed-bundles

**Feature**: `docs/roadmap/features/307-ui-env-themed-bundles/feature.md`
**Product Spec**: `docs/roadmap/features/307-ui-env-themed-bundles/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/307-ui-env-themed-bundles/implementation-spec.md`

---

## Session 2026-11-10 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator decisions (AskUserQuestion, 2026-11-10): (1) build-time Docker `ARG UI_THEME`, one image per deploy workflow, tags unchanged — rejected two-images-per-build and a runtime switch; (2) staging keeps Nocturne, production gets a NEW theme; (3) unset `UI_THEME` → staging (fail-safe: non-prod builds never look like prod).
