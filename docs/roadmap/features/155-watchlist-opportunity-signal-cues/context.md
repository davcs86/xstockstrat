# Context: watchlist-opportunity-signal-cues

**Feature**: `docs/roadmap/features/155-watchlist-opportunity-signal-cues/feature.md`
**Product Spec**: `docs/roadmap/features/155-watchlist-opportunity-signal-cues/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/155-watchlist-opportunity-signal-cues/implementation-spec.md`

---

## Session 2026-08-25 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Scope: UI-only (`xstockstrat-ui`); no proto/config/DB changes. Five items bundled — one new
  capability (icon+color state coding, FR-1) plus a new firing-row action (FR-2) and three fixes
  (breadcrumb origin FR-3, mobile parity FR-4, filter responsiveness FR-5).
- **User decisions (this session):**
  - FR-3: the wrong navigation is the **position-detail breadcrumb** (`PageBreadcrumb` hard-coded to
    "Exposure" → `/trader/positions`); when arriving from Opportunities it should return to the
    Opportunities queue.
  - FR-2: the firing-row action goes **directly to the order/position detail**
    (`/trader/positions/<symbol>`), not to the Opportunities list.
- **Harness branch deviation:** per the session's branch directive, development happens on the
  assigned `claude/watchlists-firing-queue-labels-w33an5` branch (from/into `main-dev`), not a
  separate `feature/watchlist-opportunity-signal-cues` branch. The SDD grounding artifacts are being
  produced per the mandatory SDD entry point (root CLAUDE.md); the per-step-PR mechanics of
  `/sdd-execute` are adapted to the single assigned branch.
- **Known trap flagged (Ledger fails.md 2026-07-01):** FR-3 touches a `Breadcrumb`; wiring it has
  previously collided with `getByRole`/`getByLabel` e2e locators (`BreadcrumbPage` `role="link"`,
  lowercase `aria-label="breadcrumb"`). Design/spec must grep the e2e suite for locators on the
  position-detail page and run a broader `-g` scope before marking that step done.
- **C-10(a) note:** no new route is added, so no `PLATFORM_SUBNAV`/`NAV_GROUPS` registration is
  required; touched pages are already nav-reachable.
- Investigation carried into design: FR-5 root cause (real state bug vs. perception) and the FR-1
  glyph set are the two open questions.

## Session 2026-08-25 — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-ui). Key reuse: the `EnumRender`/`EnumBadge`
  render layer + `isFiring`/`rollupReadiness` state buckets; no existing UI acceptance suite → no
  C-16 regression risk.
- Phase 1 Grilling: 2 rounds (quick mode + 1 user-requested extra round). Chosen approach: one shared
  `readinessState(r)` bucketer (in `readinessRollup.ts`) feeding the rollup counts, the three
  `Progress` variants, `stateLabel`, and a new `READINESS_CUE`/`IN_QUEUE_CUE` render map (in
  `opportunityShared.tsx`, `EnumRender` gains an `icon` ref; `SemanticRole` gains `'info'`); applied
  to all four readiness surfaces (Watchlists panel, Opportunities desktop, mobile SectionRenderer,
  and SignalReadiness). FR-2 firing-row jump; FR-3 unconditional Opportunities breadcrumb; FR-4 new
  `signalGroup` mobile kind + shared `SignalRow`; FR-5 render-time effective-source intersection.
  Rejected: origin-aware `?from` crumb, FR-5 mutating `useEffect`, `page.reload()`-based FR-5 test,
  a parallel (5th-copy) bucketer, `head`+flat mobile grouping.
- **User decisions (this session):**
  - **4th surface IN SCOPE:** the "Why this fired" (`SignalReadiness.tsx`) panel gets the same firing
    cue (new scenario @AC-13). Prevents the C-10 "forgot a consumer" inconsistency.
  - **FR-3 CHANGE, signed off:** the position-detail breadcrumb's first crumb is **always**
    "Opportunities" → `/insights/opportunities` — "Exposure" is never the default, for *every* entry
    point (Exposure/Portfolio/Orders/firing-jump). This deliberately regresses "back to where I came
    from" for non-Opportunities origins; the user explicitly chose it. (Nav-taxonomy note: the user
    said "Discover > Opportunities"; Opportunities actually lives under the **Decide** nav group in
    `navGroups.tsx:44-48` — the crumb links to `/insights/opportunities` regardless.)
- **Round-2 adversary fixes folded in:** (A) `CueIcon` carries `data-testid`+`role="img"`/`aria-label`
  so icons are assertable (C-15); (B) `stateLabel` emits "quiet" so text distinguishes watching vs
  quiet (AC-4); (C) breadcrumb e2e scopes inside `getByLabel('Position path')` + broad `-g` run
  (ledger 2026-08-09); (D) FR-5 RED must use in-place refetch (window focus / manual refetch), never
  `page.reload()` (which remounts and resets state → vacuous green, ledger 074/080); one shared
  bucketer instead of a 5th duplicate (DRY); distinct aria-labels on the FR-2 jump link + CueIcons;
  dropped the redundant `signalGroup.count`.
- Acceptance updated (C-15): AC-7/AC-8 reworded for the unconditional crumb; @AC-12 rewritten to the
  real refetch-vanish RED; @AC-13 added for SignalReadiness.
- Constitution rules touched: C-10, C-11, C-12/13, C-14, C-15, P-03/P-06/C-08. Floor breaches: none.
- Status: draft → design-approved.
- **Harness branch:** continuing on `claude/watchlists-firing-queue-labels-w33an5` (from/into
  `main-dev`) per the session directive; per-step PR mechanics of `/sdd-execute` adapted to this
  single branch.

## Open Threads

- FR-3 back-navigation regression for non-Opportunities entry points — deliberate, user-signed-off;
  revisit at review if UX objects. (design.md Open Risks)
- Phosphor prop forwarding (role/aria-label/data-testid → svg) — verify at the FR-1 step; testid
  alone suffices if not forwarded.
- Fixture additions (CAPR pair, bucket overrides) — confirm at the test steps (C-12/C-13).
- Broad e2e `-g`/full scope for breadcrumb + mobile before those steps are marked done (ledger
  2026-08-09).
