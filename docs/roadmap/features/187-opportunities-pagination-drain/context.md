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

## Session 2026-09-26 — status drift reconciliation

- **Discovered drift:** status.md read `in-progress` with no `sdd-execute` session logged, despite the
  functional implementation having shipped on 2026-09-11 via `#1134` (ancestor of both
  `origin/main-dev` and `origin/main`). CI's post-promotion status auto-update never ran.
- **Ground-truth verification (origin/main-dev HEAD):**
  - Step 1 (server SQL symbol grouping) — present in `services/xstockstrat-analysis/app/repositories/opportunities.py`.
  - Step 3 (UI `useInfiniteQuery` + Load More + CopilotRail hook + stat-grid removal) — present:
    `opportunities/page.tsx:115` (`fetchNextPage/hasNextPage/isFetchingNextPage`), `:371` Load More
    button (`data-testid="load-more-opportunities"`), headline stat-grid tiles removed.
  - Step 5 (agent pass-through) — `services/xstockstrat-agent/app/tools.py:1501` passes
    `page_size`/`page_token` to `list_opportunities`.
  - Step 9 (docs) — mcp-tools.md updated.
- **Genuine test debt (left `pending`, NOT back-filled):** steps 4, 7, 8, 10. `opportunities.spec.ts`
  has zero `load-more-opportunities` / second-page / stat-grid-removal assertions; the only
  pagination Load More E2E on main-dev targets the **data-explorer** page (`de-bars-loadmore` /
  `de-hist-loadmore`), a different feature. Marking these done would fabricate coverage that does
  not exist.
- **Promotion trail:** merged to main-dev `0d1b186f` (#1134), promoted to main via `aab3fa8d` (#1137)
  on 2026-09-11.
- **Reconciliation applied:** status.md → `launched`; feature.md tracking fields + Status History +
  test-debt Next Action added; impl-spec header annotated with a post-launch note. No code touched.

## Session 2026-09-26 — sdd-qa: back-fill the launched feature's test debt

- **Scope:** the feature shipped functionally on 2026-09-11 (#1134 → #1137) with test steps 4/7/8/10
  never completed. Back-filled the E2E coverage as characterization/regression guards (the behavior
  is already live, so these lock it in rather than driving RED).
- **Grounded against the shipped tree**, not the impl-spec's pre-build assumptions. Two decisions:
  - **Did NOT touch the shared `e2e/mock-backend.ts` handler.** The hook hard-codes `page.pageSize:50`
    (`useOpportunities.ts:37`), so a page boundary can't come from the request; the multi-page mock is
    a per-test `page.route` override (`mockOpportunitiesPaged`). The shared handler stays single-page —
    it feeds copilot/mobile-overflow specs that would regress if forced to paginate.
  - **Step 7 fixture extension is a no-op** — 9 unique symbols already yield ≥2 pages at any small
    imposed page size.
- **Added to `e2e/insights/opportunities.spec.ts`:** helpers `convictionGroupedSymbols()` +
  `mockOpportunitiesPaged()`, and 4 tests — @AC-2 (Load More appends page 2, page 1 retained, button
  gone on last page), @AC-3 (15s poll via `page.clock.fastForward` keeps loaded pages), @AC-5
  (single-page → no Load More), @AC-8 (stat grid gone). **35/35 in the file pass** (31 existing +
  4 new; no regressions). tsc clean on the spec.
- **@AC-7 deferred — real defect, not test debt.** CopilotRail (`CopilotRail.tsx:37` `useOpportunities(0)`,
  sort=UNSPECIFIED) and the page (`page.tsx:116`, sort=CONVICTION) build different React-Query keys
  (`useOpportunities.ts:30` — feature-190 5-tuple), so two `ListOpportunities` RPCs fire. The strict
  single-RPC @AC-7 assertion can't pass without a one-line code fix. Filed
  `docs/reports/2026-09-26-copilotrail-duplicate-listopportunities-rpc-defect.md` (SEV-3) for
  `/sdd-triage`; guard deferred.
- **impl-spec:** steps 4/7/8/10 → `done` (with notes); header status → `done` with the @AC-7 carve-out.
