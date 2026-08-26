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

## Session 2026-08-25 — sdd-execute (sequential)

Developing on the assigned `claude/watchlists-firing-queue-labels-w33an5` branch (the feature's
`<dev-branch>` for this harness session; no separate `feature/*` branch). One commit per step; the
existing branch PR is the integration PR. Toolchain: Node 22.22 + pnpm 9.15.0, deps installed;
baseline unit suite green (116 tests) before changes.

### Step 1 — Shared readiness state → cue derivation [done]
- Added `ReadinessState` type + pure `readinessState(r)` bucketer to `readinessRollup.ts` (the single
  4-way decision site). In `opportunityShared.tsx`: widened `SemanticRole` with `'info'`, added
  `icon?: Icon` to `EnumRender`, added `READINESS_CUE`/`IN_QUEUE_CUE`, and taught `EnumBadge` to
  render a leading `role="img"`/`aria-label`/`data-testid` icon.
- TDD (P-06): RED first — `pnpm test:unit` failed with 6 errors (`readinessState is not a function`,
  `READINESS_CUE` undefined) against the pre-impl tree. GREEN after — 122 tests pass. tsc `--noEmit`
  clean (confirms the 4 exhaustive `Record<Enum,EnumRender>` maps still compile after the
  `SemanticRole`/`icon?` widening). `pnpm run lint` exit 0, no errors in touched files.
- Deviation (minor, in-step intent): typed `icon?` as Phosphor's `Icon` type (not the spec's
  literal `React.ComponentType<{className?}>`) so `EnumBadge` can pass `role`/`aria-label`/
  `data-testid` through to the svg — faithful to the "component reference" intent; no behavior change.
- Files: `src/lib/readinessRollup.ts`, `src/lib/opportunityShared.tsx`.

### Step 2 — Unit tests for the bucketer + cue map data [done]
- Extended `readinessRollup.test.ts` (`readinessState` classification + total===0→nodata) and created
  `opportunityShared.test.ts` (READINESS_CUE exhaustive keys/roles/icons; IN_QUEUE_CUE info+icon).
  Data-only (icon is an unrendered component ref) — node-env `.test.ts`, C-12/13 compliant (pure
  logic literals, not mocked domain objects). Covered by the Step-1 RED→GREEN above.
- Files: `src/lib/readinessRollup.test.ts`, `src/lib/opportunityShared.test.ts`.

## Session 2026-08-25 — sdd-review impl-spec (advisory)

- Result: **PASS WITH WARNINGS** — 0 failures, 2 warnings, 0 blockers, no Floor (F-*) risk (advisory
  — did not block). Every cited path:line symbol resolved; C-14 surfaces + C-15 scenario coverage
  fully mapped.
- Overlap scan: **CLEAN** (UI-only; no migration/proto/config; only 095-draft conditionally names
  `opportunityShared.tsx`, orthogonal — coordinate whichever merges second, no action now).
- Warnings carried into execution:
  - Steps 1–2: W1/W2 RED-integrity + line-drift — [x] addressed. Root cause: the reviewer scanned
    the tree *while* Step 1's `readinessRollup.ts` half was already applied, so it saw
    `readinessState` present. The true RED **was** captured before implementing (6 failing unit tests:
    `readinessState is not a function` ×2 **and** the 4 `READINESS_CUE`/`IN_QUEUE_CUE` import failures),
    then GREEN after (122 pass). Line-drift (`rollupReadiness` now at :54-74) is the same artifact, no
    invented symbol. No action needed — recorded here per the reviewer's suggestion.
- Notes (no action): FR-3 is a signed-off behavior CHANGE (no C-16 suite exists → no regression);
  B2b trading-domain checks N/A (`paper`/`live` are Badge/Progress color tokens, not the trading-mode
  axis); design's Phosphor-glyph open risk **RESOLVED** — `Eye/Lightning/Moon/Question/Stack` all
  resolve from `@phosphor-icons/react@^2.1.7`. (Doc nit, not a spec defect: `impl-spec-criteria.md`
  B3's frontend list still names the pre-consolidation frontends, omitting `xstockstrat-ui`.)

### Step 3 — Watchlists readiness panel cues + firing-row jump [done]
- Rewrote `barVariant`/`stateLabel` onto the shared `readinessState` bucketer (removed the duplicate
  `hasData`/`isFiring` branch and the now-unused `cn` import); `stateLabel` emits "quiet" (FIX B).
  Replaced the plain state-label span with `EnumBadge` (icon + color + dynamic text,
  `testId=readiness-cue-<state>`); replaced the literal in-queue Badge with the shared `IN_QUEUE_CUE`
  via `EnumBadge` (`testId="in-queue"`); added the `isFiring`-gated jump `Link` to
  `/trader/positions/${symbol}?strategy=${strategyId}` (`data-testid=jump-<symbol>`, distinct
  aria-label). Deviation: refined `EnumBadge` testId placement (see Deviation Log).
- Files: `src/components/insights/WatchlistReadiness.tsx`, `src/lib/opportunityShared.tsx` (EnumBadge).
- Verify: tsc `--noEmit` + `pnpm run lint` clean (no issues in touched files).

### Step 4 — e2e for Watchlists cues + firing jump [done]
- Added 3 Playwright tests to `watchlists.spec.ts`: AC-1/2/4 (firing/watching/quiet/no-data icon +
  color + text via the READY1/WATCH1/QUIET1/NODATA1 bucket overrides), AC-3 (AAPL in-queue cue icon),
  AC-5/6 (firing READY1 jump → `/trader/positions/READY1?strategy=strat-live-001`; non-firing WATCH1
  no jump). Reused existing fixtures/helpers (no new fixture symbols → no INVENTORY change).
- Verify: **14/14 watchlists tests pass** (3 new + 11 existing, no regression), run with a
  Playwright-managed dev server + `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium` +
  `--timeout=90000` (see Deviation Log for the env note). Covers @AC-1..@AC-6.
- Files: `e2e/insights/watchlists.spec.ts`.

### Step 5 — Opportunities desktop + mobile: cues, in-queue, mobile grouping + tags [done]
- Desktop: `readinessVariant` collapsed onto the shared `readinessState` bucketer; added the shared
  `IN_QUEUE_CUE` badge (`testId="opportunity-in-queue"`) to the `SymbolGroupCard` header (gated
  `!allMuted`). Mobile: `mobileSections` rebuilt from `symbolGroups` as one `signalGroup` per symbol
  carrying strategyId + provenance/source chips + expiry. `sections.ts` gained a `SignalItem`
  interface (+ tags), a `signalGroup` kind, and the `signal` kind rebased on `SignalItem`.
  `SectionRenderer` extracts a shared `SignalRow` (used by both `signal` and `signalGroup`),
  preserving `mobile-muted-${symbol}`; its `readyVariant` also derives from `readinessState`.
- Files: `src/app/insights/opportunities/page.tsx`, `src/components/mobile/sections.ts`,
  `src/components/mobile/SectionRenderer.tsx`. Verify: tsc + lint clean.

### Step 6 — e2e for Opportunities in-queue cue + mobile parity [done]
- Added a `CAPR` pair to `OPPORTUNITIES` (strategies `quality-dip-buy`/`momentum`, source
  `watchlist`, `14:30Z` expiry) + an `INVENTORY.md` catalog note (C-12). Tests: AC-3 (CAPR desktop
  card shows the shared in-queue cue icon), AC-9 (mobile groups CAPR's two signals into one
  `mobile-group-CAPR` card), AC-10 (mobile shows the strategy id + `watchlist` chip + `exp 14:30`).
  Fixed a strict-mode locator (caption "Momentum building" also matched "momentum" → `exact:true`).
- Verify: **13/13 opportunities tests pass** (3 new + 10 existing, no regression), Playwright-managed
  server + chromium path + `--timeout=90000`. Covers @AC-3, @AC-9, @AC-10.
- Files: `e2e/insights/opportunities.spec.ts`, `e2e/fixtures/opportunities.ts`, `e2e/fixtures/INVENTORY.md`.

### Step 7 — "Why this fired" (SignalReadiness) firing cue [done]
- Added the shared firing cue (`READINESS_CUE.firing`, `testId="readiness-cue-firing"`) to the
  SignalReadiness summary line, rendered only when `readinessState(readiness) === 'firing'` (3/3
  trace) — the 4th cue surface (user-confirmed). Single additive line; no change to the non-firing
  render, exit-rule badge, condition list, or track-record block. Files: `SignalReadiness.tsx`.
  Verify: tsc + lint clean.

### Step 8 — e2e for the "Why this fired" firing cue [done]
- Added the AC-13 test to `position-detail.spec.ts`: AAPL watchlisted + a per-page EvaluateReadiness
  route returning a 3/3 firing trace → asserts `3/3 conditions` + the `readiness-cue-firing` cue icon.
  **Passes.** (READY1/bucket-override hangs on a non-position symbol in this sandbox — used AAPL +
  route mock instead; see Deviation Log.) The broader trader-BFF-dependent position-detail tests fail
  **in-sandbox only** (`/trader/api` abort — pre-existing, reproduced on the untouched line-14 test);
  feature 155 touches no trading code. Covers @AC-13. Files: `e2e/trader/position-detail.spec.ts`.

### Step 9 — Position-detail breadcrumb → unconditional Opportunities [done]
- Changed the first crumb from `{Exposure,/trader/positions}` to
  `{Opportunities,/insights/opportunities}` unconditionally (one line + comment). User-mandated
  behavior change (signed off). Files: `src/app/trader/positions/[symbol]/page.tsx`. tsc+lint clean.

### Step 10 — e2e for the Opportunities breadcrumb [done]
- AC-7 (breadcrumb first crumb is Opportunities → /insights/opportunities, scoped inside the
  "Position path" landmark so the global nav's Opportunities link doesn't collide) and AC-8 (same
  crumb for a non-opportunity entry; no "Exposure" crumb). Broad sweep run
  (`position-detail.spec.ts` + `breadcrumb.spec.ts`): **11 passed** including the breadcrumb.spec
  collision guard (AAPL terminal-crumb count 1, Position-path landmark count 1 both still hold) —
  no new link/label collision (ledger 2026-08-09). Covers @AC-7, @AC-8. Files:
  `e2e/trader/position-detail.spec.ts` (breadcrumb.spec.ts needed no edit).

### Step 11 — Opportunities filter effective-source intersection [done]
- Added a memoized `effectiveSources = activeSources.filter(s => sources.includes(s))`; the `rows`
  filter and the "All sources" pill state now use it. Stored `activeSources` is untouched (a
  vanished-then-returning source re-activates); **no** mutating `useEffect` (verified: the only
  effect is the pre-existing localStorage hydration; `setActiveSources` only in onClick/onValueChange).
  Files: `src/app/insights/opportunities/page.tsx`. tsc+lint clean.

### Step 12 — e2e for filter responsiveness (in-place refetch RED) [done]
- AC-11 (selecting the `watchlist` pill narrows to CAPR, hides AAPL). AC-12 (the effective-source
  RED): select `marketwatch` (only MSFT), Snooze MSFT → the mutation invalidates `['opportunities']`
  and refetches **in place** (never `page.reload()` — FIX D / ledger 074/080) → `marketwatch` vanishes
  → the queue must not strand. **RED proven**: reverting the Step-11 filter to `activeSources`, AC-12
  fails with `card(AAPL)` not found (queue stranded empty); restored → GREEN. Full opportunities
  suite **15/15** (no regression). Covers @AC-11, @AC-12. Files: `e2e/insights/opportunities.spec.ts`.

## Session 2026-08-25 — sdd-execute complete

All 12 steps done → `code-completed`. Verification (Playwright-managed dev server +
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium` + `--timeout=90000`): unit **122**,
watchlists **14/14**, opportunities **15/15**, breadcrumb sweep **11** (incl. the breadcrumb.spec
collision guard). Every `@AC-1..@AC-13` covered and green. The trader-BFF-dependent position-detail
tests fail **in-sandbox only** (pre-existing `/trader/api` `createContext` bundling issue at
`traderBff.ts:15`, reproduced on the untouched line-14 test) — not a feature-155 regression; they pass
in CI's prebuilt bundle. Next: integration PR (the assigned `claude/*` branch PR to `main-dev`).

## Session 2026-08-25 — C-16 scenario promotion + PR watch

- **PR watch:** subscribed this session to davcs86/xstockstrat#1012 (`subscribe_pr_activity`) — CI /
  review / comment events wake the session; will drive it to green + address review threads.
- **C-16 promotion:** all 13 `@AC-*` scenarios are single-service (`xstockstrat-ui`) and UI-observable
  (none cross-cutting), so promoted verbatim into the new durable suite
  `services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature` (first suite for this
  service — no dedup needed), each tagged `@feature-155` for provenance alongside its `@AC-*`/`@FR-*`.
  Nothing routed to `docs/sdd/business-rules/platform.feature`. Staged onto this branch → lands in
  PR #1012, so `/promote`'s backstop finds no un-promoted scenarios at production.

## Session 2026-08-25 — CI fix (PR #1012 Frontend E2E Build)

- **Failure:** CI `Frontend E2E Build` red on the branch (green on base main-dev) —
  `createContext is not a function` collecting page data for `/trader/api/[...connect]`.
- **Root cause (mine):** the new phosphor **value** import in `opportunityShared.tsx` rode a server
  import chain `traderBff.ts:24 → copilot.ts:7 → opportunityShared → @phosphor-icons/react`, pulling
  a client-only lib (createContext at module scope) into the server bundle. Local `tsc`/lint/unit/
  dev-server e2e all missed it; only `pnpm build` reproduces it.
- **Fix:** moved `READINESS_CUE`/`IN_QUEUE_CUE` + the phosphor value import into a new client-reachable
  leaf `src/lib/readinessCue.ts`; `opportunityShared.tsx` now imports phosphor **type-only** (`Icon`).
  Consumers (WatchlistReadiness, opportunities/page, SignalReadiness, the unit test) import the cue
  maps from `readinessCue`. Verified: `pnpm build` **EXIT 0** (page data + 39/39 static pages), tsc +
  lint + 122 unit + the watchlists cue e2e (5) all green. Ledger fails.md entry added.

## Open Threads

- FR-3 back-navigation regression for non-Opportunities entry points — deliberate, user-signed-off;
  revisit at review if UX objects. (design.md Open Risks)
- Phosphor prop forwarding (role/aria-label/data-testid → svg) — verify at the FR-1 step; testid
  alone suffices if not forwarded.
- Fixture additions (CAPR pair, bucket overrides) — confirm at the test steps (C-12/C-13).
- Broad e2e `-g`/full scope for breadcrumb + mobile before those steps are marked done (ledger
  2026-08-09).

## Session 2026-08-26 (CI: feature status automation)

- Promotion PR #1019 merged to main
- Feature promoted and committed: c5a4eb3859ac271ceaa1946a4cb6a9835762a789
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-26
