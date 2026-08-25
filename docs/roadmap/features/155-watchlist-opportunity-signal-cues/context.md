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

## Session 2026-08-25 — sdd-spec

- Generated implementation-spec.md with **12 steps** (6 `service` + 6 paired `test`). Status →
  `implementation-ready`. Consumed recon.md + design.md as authoritative; every step cites grounded
  `path:line` evidence (read the actual edit-site files, not just recon).
- Step map: (1/2) shared spine — `readinessState()` bucketer in `readinessRollup.ts` +
  `READINESS_CUE`/`IN_QUEUE_CUE` icon maps in `opportunityShared.tsx`, with vitest unit tests;
  (3/4) Watchlists cues + firing-row jump (FR-1/FR-2); (5/6) Opportunities desktop+mobile cues +
  `signalGroup` mobile kind + tags (FR-1/FR-4); (7/8) SignalReadiness "Why this fired" firing cue
  (FR-1/AC-13); (9/10) unconditional Opportunities breadcrumb (FR-3); (11/12) filter
  effective-source intersection (FR-5). All 13 `@AC-*` mapped to a covering step (C-15 table in
  the spec).
- Key codebase findings (grounded):
  - The 4-way readiness branch is **duplicated 4×** today (`readinessRollup.rollupReadiness:43-51`,
    `WatchlistReadiness.barVariant:41-46`, `opportunities/page.readinessVariant:38-43`,
    `SectionRenderer` inline `readyVariant:60-66`) — Step 1 collapses them onto one `readinessState`
    (design's "no 5th copy" DRY mandate), not adds a parallel bucketer.
  - `SemanticRole` (`opportunityShared.tsx:12`) currently `'buy'|'sell'|'paper'|'secondary'`; the
    four `Record<Enum,EnumRender>` maps gain **no** key when widened to add `'info'`, so `tsc` stays
    green (design round-1 adversary confirmed). `Badge` already has `info` (`badge.tsx:26`) + a
    direct-child svg icon slot (`badge.tsx:8`) — icon passed as a Badge child, never `<span>`-wrapped.
  - Vitest `include` is **`src/**/*.test.ts` (`.ts` only)** (`vitest.config.ts:20`) — the cue-map
    unit test must be `.test.ts` (data-only, `icon` is an unrendered component ref). `readinessRollup.test.ts`
    already exists to extend; `all:false` scope (feature 065) means the new files count toward the 40% floor.
  - Fixture reality: `READINESS_BUCKET_OVERRIDE` (`mock-backend.ts:72-80`, `READY1/WATCH1/QUIET1/NODATA1`)
    and `OPPORTUNITIES` (`e2e/fixtures/opportunities.ts`, incl. an `AMZN` two-strategy grouping
    precedent) are the extension points; a `CAPR` pair (strategies `quality-dip-buy`+`momentum`,
    source `watchlist`, expiry `14:30`) is added in Step 6 with an `INVENTORY.md` row (C-12).
  - `xstockstrat-ui` has **no CI coverage threshold** (spec-template Next.js row) — test steps use
    `pnpm test:e2e` (+ vitest unit for the pure spine) + the `pnpm run lint` code-quality gate.
- Reviewers snapshot finalized in feature.md: sole reviewer `xstockstrat-ui` service owner (all
  steps are `service`/`test` on that service).

## Open Threads

- FR-3 back-navigation regression for non-Opportunities entry points — deliberate, user-signed-off;
  revisit at review if UX objects. (design.md Open Risks)
- Phosphor prop forwarding (role/aria-label/data-testid → svg) — verify at the FR-1 step; testid
  alone suffices if not forwarded.
- Fixture additions (CAPR pair, bucket overrides) — confirm at the test steps (C-12/C-13).
- Broad e2e `-g`/full scope for breadcrumb + mobile before those steps are marked done (ledger
  2026-08-09).
