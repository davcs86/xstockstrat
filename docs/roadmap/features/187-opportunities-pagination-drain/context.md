# Context: opportunities-pagination-drain

**Feature**: `docs/roadmap/features/187-opportunities-pagination-drain/feature.md`
**Product Spec**: `docs/roadmap/features/187-opportunities-pagination-drain/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/187-opportunities-pagination-drain/implementation-spec.md`

---

## Session 2026-09-11T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Root cause traced: `_DEFAULT_OPP_PAGE_SIZE = 50` at servicer.py:279, Python slices `rows[0:50]`.
  Neither UI `useOpportunities` hook nor agent `client.py:list_opportunities` consumes
  `next_page_token`. ~190 materialized rows exist but only top-50 surfaced.
- Verified via staging: exactly 50 opportunities returned, 27 unique symbols.
- DB query has no LIMIT — pagination is purely transport-layer Python slicing.
- Known trap (fails.md:662, 805) reviewed — not applicable since no subset-relative diagnostics
  are computed post-pagination.
