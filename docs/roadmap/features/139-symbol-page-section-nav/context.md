# Context: symbol-page-section-nav  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: What shipped is **not** what was designed. The approved design was a 6-chip sticky anchor-nav (Overview/Trade/Research/Backtests/Coverage/Position) over the existing stacked sections. A same-day post-design user amendment (PR #974) collapsed it to a **stable 4-section spine** (Overview/Trade/Research/Analysis) and introduced a second component, `SymbolPanelGroup`, that renders each section's related panels as **desktop columns / mobile tabbed panel, all panels mounted**. The held-Position stats and Backtests+Coverage were *folded/merged* into panels, not dropped. UI-only on `xstockstrat-ui`; no proto/config/DB.

**Why (irrecoverable rationale)**: Every "hide inactive content" pattern (Tabs, Accordion) was rejected for one durable reason: `position-detail.spec.ts` asserts ~20 sections visible on a single `page.goto`, and unmounting inactive panels also tears down in-flight polling/backtest queries (FR-7). "All panels stay mounted, presented one-at-a-time via CSS `hidden`" is therefore a hard constraint, not a style choice — it is why both the top-level nav and the mobile panel-tabs use mounted-not-unmounted, and why deep-linking uses a **bare relative `#hash` via `replaceState`** (a `pathname#id` form or a query param would disturb `?strategy=`). The spine became stable because folding the conditional "Position" content into a Trade *panel* (rather than a nav chip that appears/disappears with holdings) keeps the nav spine invariant across data state.

**Rejected alternatives**:
- shadcn `Tabs` / Radix `Accordion` — lost: unmount inactive content → break `position-detail.spec.ts` + drop in-flight fetches (FR-7); `TabsTrigger` also re-opens the `role="tab"` e2e collision.
- Click-only active state (no scroll-spy) — lost: the active indicator goes stale on free-scroll, fails FR-2.
- URL query-param for active group — lost to `#hash`: a hash mutation leaves `?strategy=` untouched by construction.
- Held-position body as a persistent sticky header — lost: bloats the sticky region; a conditional group/panel costs only one tap since nothing is hidden.
- The user's proposed "Screener / Fundamentals" panel group — lost: the two sit on **mutually exclusive** FR-11 watchlist branches and can never co-render, so they cannot form a tab group; surfaced to the user (C-11) instead of silently reconciling.

**Scars & gotchas**:
- `ToggleGroup type="single"` renders `role="radiogroup"`/`radio` (checked), **not** `role="button"` like `type="multiple"` — the recon's `getByRole('button')` locator plan was copied from a `type="multiple"` exemplar and matched nothing on the first GREEN run (D-3).
- CSS grid items (`md:grid-flow-col md:auto-cols-fr`) default to `min-width:auto`; a wide panel forced **59px** of horizontal overflow at 390px until each item got `min-w-0`. Only the 390px `mobile-overflow.spec.ts` guard caught it.
- `position:sticky` only survives if the horizontal scroll container (`overflow-x-auto`) lives on a **descendant** of the sticky element, and the `-mx-4 sm:-mx-6` bleed must exactly cancel the parent `p-4 sm:p-6` or the page overflows at 390px.
- Broad `-g` e2e scope (trader+insights) was mandatory: the new mobile tab labels ("Opportunity"/"Place order") case-insensitively substring-collided with existing bare `getByText().first()` gates in *sibling* specs (`position-detail.spec.ts`, `order-parity.spec.ts`), which the changed component's own narrow run would never surface (D-6).

**Permanent deviations**:
- design said a 6-chip sticky anchor-nav → shipped a 4-section spine + `SymbolPanelGroup` responsive columns/tabs → because a post-design user amendment asked to cluster related panels, and no render target was dropped (grouping/merging only).
- design said scroll-spy via `IntersectionObserver` → shipped a deterministic, rAF-throttled **scroll-position read** ("last section whose top passed the header+nav offset line" + an explicit bottom-of-page rule) → because the shorter column layout stopped the last section from ever scrolling under the offset line, so the observer could never highlight `#analysis` and stole `active` back from a deep-link to it. This resolved all three original scroll-spy Open Risks by deleting the observer (D-5).

**Cross-feature signal**: Feature 143 had already removed the page's only pre-existing `Tabs` (the chart timeframe selector), so a section-nav here became the sole `role="tab"`-class control on the page — it *reduced* the getByRole-collision risk rather than adding to it. The recurring theme (shadcn primitive roles colliding with e2e locators) is the fails.md 2026-08-09 pattern this feature hit twice more.

**Deferred follow-ons**: none — all three design Open Risks (scroll-spy tuning, 1px scroll-mt undershoot, resize re-subscribe) were resolved in-feature (D-1) or made moot by the D-5 rewrite.

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-26 entries. (The 2-round-debate insight and the D-3 toggle-group / D-5/D-6 scroll-spy scars were already recorded at insights.md:1755 / fails.md:1445 / fails.md:1451.)
**Runtime-invariant recommendations (→ /context-constitution)**: UI-MODULE (borderline) — there is no shared header-height token; `PlatformHeader` height (Row1 `h-[49px]` always + Row2 `h-9`/36px `hidden sm:flex`, collapsing to 49px below `sm`) exists only as inline literals, so any future sticky-below-header element must hard-code `top-[49px] sm:top-[85px]` + matching `scroll-mt-[93px] sm:scroll-mt-[129px]`, kept in sync by hand.
**Scenario promotion (C-16)**: none — this feature has no `acceptance.feature` file.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
