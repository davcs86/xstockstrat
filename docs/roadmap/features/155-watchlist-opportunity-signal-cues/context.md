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
