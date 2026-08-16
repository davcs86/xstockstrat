# Context: symbol-page-section-nav

**Feature**: `docs/roadmap/features/139-symbol-page-section-nav/feature.md`
**Product Spec**: `docs/roadmap/features/139-symbol-page-section-nav/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/139-symbol-page-section-nav/implementation-spec.md`

---

## Session 2026-08-15 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from the user story: group the
  unified Symbol page's (feature 125) many stacked sections into a same-page navigation pattern.
- Consumer surface (C-14): **UI `/trader`** — reorganizes the existing `/trader/positions/[symbol]`
  page; no new route/nav entry (C-10 already satisfied by feature 096/125).
- No proto / config / DB changes — UI-only, single service (`xstockstrat-ui`).
- **Merge-order**: depends on feature 125 (`unified-symbol-page`, PR #958) landing first — it
  reorganizes the exact page 125 builds; must be sequenced after 125 in
  `docs/roadmap/features/merge-order.md`.
- **Pattern deliberately left open** (tabs vs. sticky anchor-nav vs. accordion) — to be debated at
  `/sdd-design`, since it drives the fetch-lifecycle (FR-7), deep-linking (FR-5), and mobile (FR-4)
  trade-offs.
- **Ledger trap surfaced** (`fails.md` 2026-08-09 `shadcn-migration-high-confidence`): shadcn
  primitives with built-in implicit roles/labels collide with `getByRole`/`getByLabel` e2e locators —
  directly relevant if `Tabs` (role="tab"/"tablist") is chosen. Recorded in product-spec Open Questions.

## Session 2026-08-16 — sdd-review product-spec

- Product spec approved. Status: `draft` → `spec-ready`. (PASS WITH WARNINGS, 0 blockers, no Floor breach.)
- Criteria (spec-reviewer): all PASS except Open Questions (WARNING — 4 unchecked items are legitimate
  `/sdd-design` deferrals: pattern choice, held-position-body placement, fetch-lifecycle-under-tabs,
  the `fails.md` shadcn-role accessibility trap; P-03 satisfied — surfaced, not guessed). Trading-domain
  checks all PASS (presentation-only; section behavior explicitly out of scope).
- **Post-143 accuracy verified**: feature 143 removed the chart's timeframe `Tabs` from `SymbolPriceChart`
  (`page.tsx:93` now `const timeframe: Timeframe = '1Day'`, no selector). The spec never assumed a chart
  timeframe selector — its `Tabs` references are the NEW section-nav control — so no assumption is
  invalidated. Bonus: 143 removed the page's only pre-existing `Tabs`, so a Tabs-based section-nav would
  be the sole `role="tab"` on the page, *reducing* the getByRole-collision risk Open Question #4 warns of.
- **Stale term note**: spec (and Constitution C-10) say `PLATFORM_SUBNAV in PlatformHeader.tsx`; the live
  shared-nav model is `NAV_GROUPS` in `src/components/shared/navGroups.tsx` (imported by PlatformHeader).
  Conclusion unaffected (no nav entry needed — existing route). Correct the term if reused downstream.
- Overlap (feature-overlap): COLLISIONS FOUND but all soft/dependency, **no FAIL-class** (no config-key/
  proto-field/migration collision). Same-file overlaps on `positions/[symbol]/page.tsx` with 125
  (unified-symbol-page, hard dep — delivers the sectioned page) and 143 (daily-bars-only, same-file).
  **Both 125 and 143 are already merged to main-dev**, so the effective order `125 → 143 → 139` is
  already satisfied — 139 builds on the post-143 page with no active blocker. New nav component must use
  a fresh filename (e.g. `SymbolSectionNav.tsx`); no name clash with the 19 existing `components/trader/*`.
  No merge-order row written (deps already landed; a blocking row would be born resolved).
- **Design-phase carry-forward**: resolve the 4 Open Questions in recon.md/design.md; user has directed
  that `/sdd-design` chooses the nav pattern (proposer-vs-adversary debate decides).
