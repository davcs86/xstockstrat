# Context: opportunities-server-side-filters

**Feature**: `docs/roadmap/features/190-opportunities-server-side-filters/feature.md`
**Product Spec**: `docs/roadmap/features/190-opportunities-server-side-filters/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/190-opportunities-server-side-filters/implementation-spec.md`

---

## Session 2026-09-15 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Operator decisions captured up front (behavior #1, avoid rework):**
  1. Source facets → **server returns `available_sources`** computed over the full unfiltered valid
     queue (not client-derived, not a static enum).
  2. Expiry sort → **preserve feature-187 symbol grouping**; group positioned by its
     soonest-expiring member.
  3. Scope → **all four controls** (min-conviction, source, action, sort) move server-side; run the
     **full** SDD pipeline.
- Grounding read of the current stack (pre-story recon):
  - UI `insights/opportunities/page.tsx` filters/sorts **in memory** over a 50/page
    `useInfiniteQuery`, hard-coding `minConviction: 0` (`useOpportunities.ts`).
  - `analysis.ListOpportunities` already accepts `min_conviction` (proto field 2) and offset-pages;
    `OpportunitiesRepository.read` already applies the floor with `denied`/`unavailable` exemptions
    and feature-187 symbol grouping in the ORDER BY.
  - `Opportunity.source` is **derived** (`_primary_source(provenance)`), not a column — the source
    filter + facet must reproduce that derivation in SQL over the `provenance` JSONB.
- **Ledger traps folded into the spec's Known Traps:** `fails.md:1547` (muted vanish — filter at
  every layer), `fails.md:577` ("already supports" ≠ consumed — the UI passes 0 today),
  `fails.md:1648` (mount-persistent state vs in-place refetch), `fails.md:1780` (inspect the read
  path incl. pagination + facet).
- Consumer surface (C-14): **UI `/insights`** (opportunities page). No agent change.
