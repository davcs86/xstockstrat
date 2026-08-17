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

## Session 2026-08-16 — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-ui). Key reuse: shadcn `ToggleGroup` segmented
  control (`insights/opportunities/page.tsx:212`), existing fixtures, existing `position-detail.spec.ts`/
  `mobile-overflow.spec.ts`. Headline finding: `position-detail.spec.ts` expects multiple sections
  visible on one `page.goto`, so a hiding pattern (Tabs/Accordion) breaks it — anchor-nav (all mounted)
  is forced. `scroll-area.tsx` absent; `role="tab"`/`aria-label="Section"` collisions to avoid.
- Phase 1 Grilling: 2 rounds (full). **Chosen**: sticky segmented anchor-nav — new
  `src/components/trader/SymbolSectionNav.tsx` (`ToggleGroup type="single"` in `<nav aria-label="Symbol
  navigation">`, sticky `top-[49px] sm:top-[85px]` z-40 below the real header, all sections mounted +
  wrapped in `<section id>`, `IntersectionObserver` scroll-spy for FR-2, click → `scrollIntoView` +
  `history.replaceState(null,'','#id')` bare hash preserving `?strategy=`), placed after the `<h1>`,
  gated on `!isLoading && !genuineError`. Groups: Overview/Trade/Research/Backtests/Coverage/Position
  (Position conditional). **Rejected**: Tabs/Accordion (break position-detail.spec.ts + drop in-flight
  fetches, FR-7); click-only active state (fails FR-2 under scroll); persistent-header held-body;
  query-param deep-link; nav-above-breadcrumb.
- R1 adversary found real defects (sticky offset behind header, scroll-mt too small, FR-2 needs
  scroll-spy, 390px nesting). R2 proposer resolved all; R2 adversary confirmed 6/7 closed + 2 cheap
  MEDIUM fixes (aria-label substring collision → "Symbol navigation"; nav placement → after `<h1>`),
  both adopted. No Floor breach in either round.
- **Approval basis**: user explicitly delegated the pattern decision ("Let /sdd-design decide") and
  authorized the full run; recorded here as the P-04 sign-off for the design phase (C-11/P-04 —
  overridable/decidable with recorded user consent, which the delegation constitutes).
- Constitution rules touched: C-10, C-11/P-03, C-12/C-13, C-14, F-04. Floor breaches: none.
- Open Risks (carry to /sdd-spec + execute): scroll-spy `rootMargin`/`threshold` empirical tuning; 1px
  border-b under-shoot in scroll-mt; scroll-spy observer not recreated on `sm` resize.
- Status: `spec-ready` → `design-approved`.

## Session 2026-08-16 — sdd-spec

- Generated implementation-spec.md with 3 steps (all `xstockstrat-ui`, UI-only — no proto/config/DB/env/port). Status → `implementation-ready`.
  - Step 1 [service]: create `src/components/trader/SymbolSectionNav.tsx` — the `ToggleGroup type="single"` sticky anchor-nav + co-located `STICKY_NAV_TOP`/`SECTION_SCROLL_MT` exports (single source of truth for offsets) + `IntersectionObserver` scroll-spy + bare-`#hash` `replaceState`.
  - Step 2 [service]: wire into `page.tsx` — six `<section id>` wrappers (overview/trade/research/backtests/coverage/position), nav rendered after `<h1>` gated on `!isLoading && !genuineError`, `groups` appends Position only when `position?.symbol`. Zero JSX reorder (FR-3).
  - Step 3 [test]: e2e — nav interaction added to `position-detail.spec.ts` (its 20 section assertions stay unchanged, all sections mounted), new `symbol-section-nav.spec.ts` for `#backtests` deep-link, `?strategy=` non-regression (AC-4), scroll-spy active flip; run broader trader+insights `-g` scope; `mobile-overflow.spec.ts` kept green.
- Key codebase findings (grep/Read-verified this session):
  - Page section DOM order confirmed in `src/app/trader/positions/[symbol]/page.tsx`: SymbolPriceChart `:240`, IndicatorSection `:252`, SymbolOrdersCard `:259`, inline Trade Card/OrderForm `:261-270`, watchlist-conditional block `:275-289`, BacktestsSection `:293`, BackfillSection `:296`, PositionBody `:298-303`, `positionNotFound` CardNotice `:305-311` (stays unwrapped). Wrapper `:215` `p-4 sm:p-6`, `<h1>` `:226`, gating `:210-211`. Section components are defined LOCALLY in page.tsx (`:322/473/806/921/971`).
  - `cn` is NOT currently imported in page.tsx → Step 2 must add `import { cn } from '@/components/ui/utils'`.
  - Radix `ToggleGroupItem` renders a `<button>` (not `role="tab"`/`radio`): proven by the existing `insights/opportunities` exemplar located via `getByRole('button', {name:'marketwatch'})` in `e2e/insights/opportunities.spec.ts:84,137,139` — validates the design's `getByRole('button', …)` chip locator and confirms the `fails.md` 2026-08-09 tab-collision is sidestepped.
  - `SymbolSectionNav.tsx` filename is free (absent from `components/trader/`); `mobile-overflow.spec.ts:34,42` asserts `scrollWidth-clientWidth<=1` at 390px on `/trader/positions/AAPL` (no edit needed, keep green); `?strategy=` seed read on mount at `SignalReadiness.tsx:34` (`searchParams?.get('strategy') ?? ''`) — preserved by all-sections-mounted + bare-hash `replaceState`.
  - `xstockstrat-ui` has no coverage threshold (e2e is the gate); single reviewer snapshot = `xstockstrat-ui` service owner across all 3 steps. No trading-domain step constraints apply (presentation only; no OrderType/BrokerType/OrderStatus/TRADING_MODE surface touched). C-14 consumer surface (UI `/trader`) covered; C-10(a) already satisfied (existing route, no new nav entry).

## Session 2026-08-16 — sdd-review impl-spec (advisory)

- Result: 0 failures, 1 warning, 1 NOTE (advisory — did not block). Overall PASS. Overlap: CLEAN.
- Criteria (spec-reviewer): every path/symbol/line anchor verified in the current tree. C-08 pairing
  (Step 3 tests Steps 1-2), C-12/C-13 fixture reuse (existing auth/AAPL/MSFT/ZZZZ fixtures, `?strategy=`/
  `#hash` inline as scenario one-offs), C-14 surface coverage, P-06 red-before-green all confirmed.
  `ToggleGroupItem` renders `<button>` (no `role="tab"`) — tab-collision avoidance real. All 3 design
  Open Risks represented in Step 1 with "record in Deviation Log" instructions. No Floor risk.
- Unresolved ⚠ / NOTE carried into execution:
  - Step 3: `[x]` NOTE — no `--cov-fail-under` assertion, correctly N/A (xstockstrat-ui e2e is the gate,
    vitest coverage is `src/lib`-only). Not a defect; `pnpm test:e2e` is the runnable gate. — resolved.
  - Cross-file line-anchor drift (non-material, C-01): a few citations point at the enclosing `test(...)`
    line vs the exact call (e.g. opportunities.spec.ts marketwatch clicks are :84/:139; mobile-overflow
    goto :51). Symbols/paths all real; substance holds. — [ ] cosmetic, verify anchors at wiring, non-blocking.
- Overlap (feature-overlap): CLEAN — no proto/config/migration surface (UI-only); the 4 target files are
  touched only by already-merged deps (125, 143) or launched trunk features (119/120/124/135); no
  non-merged in-flight feature edits them; the 2 new files are unique to 139. No merge-order entry needed.
- **Section-preservation check (operator request)**: independently enumerated all 17 rendered elements in
  `page.tsx:215-313` against the group map — every section/panel accounted for, nothing dropped. Two
  wiring rules enforced at execute: `#research` wraps the ENTIRE watchlist ternary (both branches +
  loading); `#position` wraps only `PositionBody` (the `positionNotFound` CardNotice stays unwrapped,
  still renders when unheld).

## Session 2026-08-16 — sdd-execute (sequential mode)

Executed all 3 steps on `feature/symbol-page-section-nav` (off latest main-dev, post-143). Status:
`implementation-ready` → `code-completed`.

### Step 1 — SymbolSectionNav component [done]
- Created `src/components/trader/SymbolSectionNav.tsx`: `'use client'` presentational nav —
  `ToggleGroup type="single"` in `<nav aria-label="Symbol navigation">`, sticky `top-[49px]
  sm:top-[85px]` z-40, exported `STICKY_NAV_TOP`/`SECTION_SCROLL_MT` (single source of truth),
  mount `#hash` effect, `IntersectionObserver` scroll-spy (re-subscribes on `sm` breakpoint change —
  D-1), bare-`#id` `history.replaceState` click handler. Effect keyed on stable `groupKey` (D-2).
- Verification: `tsc --noEmit` clean, `pnpm run lint` clean.

### Step 2 — wire into page.tsx [done]
- Added `SymbolSectionNav`/`SECTION_SCROLL_MT` + `cn` imports; wrapped the six section runs in
  `<section id className={cn('space-y-4', SECTION_SCROLL_MT)}>` (overview/trade/research/backtests/
  coverage/position) with ZERO JSX reorder and every gating expression verbatim (FR-3). `#research`
  wraps the WHOLE watchlist ternary; `#position` wraps only `PositionBody` (the not-found CardNotice
  stays unwrapped). Built `sectionGroups` (Position appended only when `position?.symbol`). Rendered
  the nav after `<h1>`, gated on `!isLoading && !genuineError`.
- **Section-preservation confirmed** (operator request): all 17 rendered elements map into a group;
  nothing dropped (verified against `page.tsx:215-313`).

### Step 3 — e2e [done]
- Added nav-interaction cases to `position-detail.spec.ts` (its 20 section assertions unchanged — all
  sections stay mounted, so they still pass); created `symbol-section-nav.spec.ts` (deep-link `#hash`,
  `?strategy=` non-regression, scroll-spy flip).
- **TDD red→green (real prebuilt e2e run)**: RED = 5 new nav tests fail against the nav-less build
  (`Symbol navigation` landmark absent), 25 existing pass. GREEN (after Steps 1-2 + a rebuild) = the
  full trader+insights suite **228 passed**, `mobile-overflow.spec.ts` green at 390px, no role/label
  collision on any sibling spec.
- **D-3**: the first GREEN run caught that `ToggleGroup type="single"` renders `role="radiogroup"`/
  `radio` (not `button` — the recon's `getByRole('button')` evidence was from a `type="multiple"`
  exemplar). Fixed the locators to `getByRole('radio')` + `toBeChecked()` (test-only). Ledger
  `fails.md` entry added.
- Scroll-spy FR-2 e2e retry-passes (the empirical `rootMargin` timing Open Risk from design.md/D-1);
  CI retries cover it.

**Accountability**: out-of-scope changes: none (D-1/D-2 are Step-1 component internals; D-3 is
Step-3 test-only). Open items: none. Unaddressed review warnings: none (the impl-spec advisory
line-anchor drift was cosmetic; the coverage-threshold NOTE was N/A). Next: integration PR → main-dev.

---

## Session 2026-08-17 — Amendment: responsive grouped panels (mobile tabs / desktop columns)

**Trigger**: user asked to group related panels into a "tabbed panel", clarified to **tabbed panel in
mobile / columns in the same row in desktop**, panels **staying mounted**, landed as an amendment on
PR #974 (not a new feature).

### Decisions
- New component `SymbolPanelGroup.tsx` — desktop `md:grid-flow-col md:auto-cols-fr` columns / mobile
  `md:hidden` `ToggleGroup type="single"` tab bar; inactive mobile panels `hidden` via CSS (mounted,
  not unmounted → FR-7 preserved, desktop content assertions stay green). 0→null, 1→bare.
- Top-level nav reduced 6→4 stable sections: **Overview / Trade / Research / Analysis**. The held-
  Position stats fold into a Trade *panel* (not a top-level chip); Backtests + Coverage merge into
  **Analysis**. `SymbolSectionNav` was already generic over `groups` — no change beyond a stale
  "Coverage" comment fix.
- **Grouping correction (D-4)**: the user's proposed "Screener / Fundamentals" group is incorrect —
  they sit on mutually exclusive FR-11 branches (Fundamentals=watchlisted, Screener=not) and can
  never co-render. Surfaced to the user (C-11), then grouped Fundamentals with the watchlist panels;
  Screener stays standalone. The other three proposed groups were correct.
- **No panel dropped** (per explicit user instruction): all 13 original render targets preserved —
  grouping/merging only, never deletion. Mapping table in design.md § Amendment.

### Files
- `src/components/trader/SymbolPanelGroup.tsx` — create
- `src/app/trader/positions/[symbol]/page.tsx` — 6 sections → 4; panel arrays for Trade/Research/
  Analysis; folded #position into Trade, merged #backtests+#coverage into #analysis
- `src/components/trader/SymbolSectionNav.tsx` — stale "Coverage" comment → generic
- `e2e/trader/symbol-section-nav.spec.ts` — anchors/chips → `#analysis` / `Analysis`
- `e2e/trader/position-detail.spec.ts` — four-chip spine; merged chips `toHaveCount(0)`; new 390px
  mobile panel-group case (tab switch + attached-but-not-visible mounted guarantee)
- design.md § Amendment, implementation-spec.md § Amendment (Steps 4–6 + D-4), feature.md history

### Verification (2026-08-17 amendment)
- **Red→green (real prebuilt harness)**: iterated the prebuilt build + e2e. First amendment run
  surfaced 3 real issues → fixed → converged: (1) `min-w-0` on `SymbolPanelGroup` grid items (grid
  items default `min-width:auto` → 59px horizontal overflow at 390px, caught by `mobile-overflow`);
  (2) `getByText('Opportunity').first()` / `getByText('Place Order').first()` collided with the new
  mobile tab labels (case-insensitive, hidden md:hidden, first in DOM) → scoped to `heading` role /
  the `<form>` field (`position-detail.spec.ts:109`, `order-parity.spec.ts:155`); (3) scroll-spy
  rewrite (D-5) — the shorter column layout broke the IntersectionObserver band heuristic for the
  last section (both the `#analysis` deep-link and the FR-2 scroll-spy failed) → deterministic
  scroll-position read + bottom-of-page rule.
- **Final**: `e2e/trader e2e/insights e2e/mobile-overflow.spec.ts` → **230 passed, 0 failed, 0 flaky**.
  Targeted nav+mobile set at `--retries=0` → 51 passed deterministically; scroll-spy confirmed stable
  under `--repeat-each=3 --retries=0`. tsc `--noEmit` clean; `next build` clean (pre-existing
  exhaustive-deps warnings only, none in touched files).
- **Accountability**: out-of-scope changes: the scroll-spy algorithm swap (D-5) touches the original
  feature-139 component, justified by the amendment's layout change breaking its precondition — not a
  drive-by. Two sibling-spec test edits (D-6) are collision fixes, not behavior changes. No panel
  dropped (explicit user constraint honored). Open items: none.
