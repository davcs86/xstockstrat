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

## Session 2026-09-11T00:10:00Z — sdd-design quick

- Ran `/sdd-design opportunities-pagination-drain quick` (Phase 0 recon + Phase 1 grilling, 2 rounds).
- **User steer 1 (prior session):** "Server-side grouping and sorting, symbol alphabetical for ties.
  Increase page size to 50 symbols." — `_DEFAULT_OPP_PAGE_SIZE` stays at 50 (overrides FR-1's
  original proposal of 25). Server-side SQL symbol grouping added via window function.
- **User steer 2 (prior session):** "You missed annotating the server-side grouping by symbol (mimic
  the UI/Web grouping)" — server ORDER BY must replicate `page.tsx:197-205`'s `symbolGroups` Map
  pattern so page boundaries respect symbol clusters.
- **User steer 3:** "Little steer in the consumers, do not auto-drain, leave the user to trigger
  manually" — UI uses `useInfiniteQuery` + "Load More" button (manual trigger) instead of auto-drain
  loop; agent tool exposes `page_token`/`page_size` params for manual MCP caller pagination instead
  of auto-drain.
- Design approved by user at round 2. Written `design.md` with 5 parts:
  A. Server page_size stays at 50
  B. Server SQL ORDER BY with window function for symbol grouping
  C. UI `useInfiniteQuery` + "Load More" button
  D. CopilotRail conversion to `useOpportunities(0)` hook
  E. Agent pagination pass-through (`page_size`/`page_token` params)
- **User steer 4:** "Would this change make the headline obsolete … include removal in scope" —
  the headline stat grid (Actionable now / Expiring < 90m / Exit / Trim flags / Fresh entries /
  Deployable) becomes misleading with pagination (tiles 1-4 count only loaded pages). Added FR-8
  for removal; updated design.md part F, acceptance.feature @AC-8.
- Status advanced: `draft` → `design-approved`.

## Session 2026-09-11T00:20:00Z — sdd-spec

- Generated `implementation-spec.md` with 10 steps across 3 services (analysis, ui, agent).
- Design part A (page_size stays at 50) requires no code change — `_DEFAULT_OPP_PAGE_SIZE = 50` is already at target.
- Step ordering: server SQL ORDER BY (1-2) → UI useInfiniteQuery + Load More + CopilotRail + stat grid removal (3-4) → agent pass-through (5-6) → fixture extension (7) → cross-service E2E (8) → docs (9) → final verify (10).
- All 8 acceptance scenarios (`@AC-1` through `@AC-8`) mapped to covering test steps.
- Consumer surfaces (C-14): UI covered by Steps 3-4, Agent covered by Steps 5-6.
- Reviewer snapshot finalized: analysis, ui, agent service owners.
- `useInfiniteQuery` is the first use in the codebase — flagged in design.md open risks, no blocking concern.
- No proto changes, no migration, no new config keys, no new env vars.
- Status advanced: `design-approved` → `implementation-ready`.
