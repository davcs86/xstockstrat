# Context: screener-watchlist-fidelity

**Feature**: `docs/roadmap/features/098-screener-watchlist-fidelity/feature.md`
**Product Spec**: `docs/roadmap/features/098-screener-watchlist-fidelity/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/098-screener-watchlist-fidelity/implementation-spec.md`

---

## Session 2026-08-02 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from the user request to fix
  low-fidelity gaps in the Screener and Watchlists pages left by feature 083.
- **Scope decision (derivable-only):** verified against `packages/proto/analysis/v1/analysis.proto`
  and `packages/proto/portfolio/v1/portfolio.proto` that every proposed surface reads an
  already-existing field/RPC — `ScreenCriterion.weight`/`hard_filter`, `ScreenResult.score`,
  `EvaluateReadiness`/`SymbolReadiness`/`ConditionEval`, `ListOpportunities`, and the portfolio
  `Watchlist` CRUD RPCs. No proto/config/DB change is required.
- **C-14 override (livestream deferral) — recorded:** the design handoff's LAST price column, intraday
  CHG % column, and Quotes tab require a streaming/realtime quote feed the platform does not expose.
  These are split to a **named backlog follow-up feature, `099-watchlist-live-quotes`** (created in the
  same session at `idea` status), satisfying the C-14 "named follow-up" requirement rather than a vague
  "later". The predefined screener universe picker is likewise out of scope (no constituent table).
- **Open design fork logged** (product-spec Open Questions): readiness roll-ups are strategy-scoped to
  honor feature 083's "never a fabricated signal→strategy binding" rule; the sidebar per-list count and
  STRATEGY column reflect the explicitly chosen strategy. To be confirmed in /sdd-design.
- Reviewer: `xstockstrat-ui` (service owner) only — UI-only change deriving from existing RPCs.

## Session 2026-08-02 — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-ui). Key reuse patterns: `scoreColor`
  (`scoreDisplay.ts:14`, replaces inlined thresholds), `CONDITION_STATE`/`EnumBadge`
  (`opportunityShared.tsx`), extend `WatchlistReadiness` in place, `useInvalidatingMutation` hooks.
  Key not-found: **no `Slider` primitive** (→ native range + numeric input), **no `Tabs`** (only the
  deferred Quotes tab needed it), no weight-normalization helper (→ new `src/lib` helper).
- Phase 1 Grilling: 2 rounds (quick + 1 user-requested extra). Chosen approach: `src/lib`-first pure
  helpers (`screenWeights`, `readinessRollup` with a 4th `nodata` bucket, `formatLastRun`) + Screener
  weight/hard-rank/last-run/score-dot + Save/Add-to-watchlist actions + Watchlists master-detail (one
  new `WatchlistDetail.tsx`, `useOpportunities` lifted there for in-queue, strategy shown as a caption).
  Rejected: Radix Slider, per-row STRATEGY column, folding total==0 into quiet, parameterizing the shared
  `symbolReadiness` fixture, a live relative-time tick, a persisted per-list default strategy.
- **User decisions:** (1) FR-10 → single "Evaluated against: `<strategy>`" caption, not a per-row
  column (product-spec FR-10/AC-6 wording updated to match). (2) Requested one extra debate round.
- Constitution rules touched: C-10(a) (cross-links resolve; no new route), C-10(b) (one read path;
  requested-symbol-set parity denominator), C-12/C-13 (reuse centralized mock + `symbolReadiness`
  fixture kept single-arg), P-03/F-04 (all cited symbols grep-verified). Floor breaches: none.
- **Open Threads (from design Open Risks):** R1 producer-1:1 (mitigated by symbol-set denominator +
  AC-6 e2e); R2 in-queue case normalization (uppercase both sides); R3 last-run no-tick staleness
  (by design, documented); R4 master/detail e2e selectors + create auto-select must be preserved.
- Status: draft → design-approved.

## Session 2026-08-02 — sdd-spec

- Generated implementation-spec.md with **6 steps**. Status → implementation-ready. UI-only
  (`xstockstrat-ui` `/insights`); no proto/config/migration/new service. Reviewer snapshot is the
  single `xstockstrat-ui` (service owner) row (all steps are `service`/`test` on one service).
- Step shape: (1) `src/lib/{screenWeights,readinessRollup,formatLastRun}.ts` + delete `WatchlistReadiness`'s
  local `isFiring` in favor of the helper (DRY); (2) vitest units (red-first, `src/lib` 40% scope);
  (3) Screener display (weight range+number, hard/rank two-Button toggle, grammar, last-run, `scoreColor` dot);
  (4) Screener→watchlist Save/Add-top-N via existing `useCreateWatchlist`/`useAddWatchlistSymbols`;
  (5) Watchlists master-detail (new `WatchlistDetail.tsx`, `useOpportunities` lifted for in-queue,
  `rollupReadiness` caption + nodata bucket, single "Evaluated against" caption); (6) e2e extending
  `screener.spec.ts`/`watchlists.spec.ts`/`mock-backend.ts` (bucket overrides only) + `INVENTORY.md`.
- Key codebase findings (all grep-verified for C-01):
  - Screener `weight: 1` hardcode at `screener/page.tsx:40` (sent raw at `:76`); bare `hard` checkbox `:138-146`;
    partial `COMPARATOR_LABELS` `:26-31` (no exhaustive `Record<Comparator>` — `UNSPECIFIED`/`BETWEEN` would break tsc);
    inlined score ternary `:216-219` → replace with `scoreColor` (`src/lib/scoreDisplay.ts:14`).
  - `WatchlistReadiness.tsx` local `isFiring` `:17-18`, strategy picker `:59` (aria "Readiness strategy"),
    `readyCount` headline `:46`, returns null on empty `:48`; extend in place, one `useReadiness` read path (C-10(b)).
  - Watchlist hooks `useWatchlists.ts:10/21/53`; `useOpportunities.ts:14`; `insightsPortfolioClient` present.
  - No `Slider`/`Switch` primitive → native range + numeric input, two-Button toggle (recon Risks).
  - Nav: `/insights/{screener,watchlists}` already registered in Discover group `navGroups.tsx:45-46`
    (C-10(a), no new route); `BASE_PATH_INSIGHTS` `basepath.ts:2` → plain `/insights/screener` href.
  - Central mock: `evaluateReadiness` `mock-backend.ts:490-492`, `listOpportunities` `:485-488`; shared
    `symbolReadiness` fixture `opportunities.ts:58-84` (keep single-arg — `.map` passes index; spread overrides
    at call site); `STRATEGY_DEF_LIVE.displayName='Live Test Strategy'`; `INVENTORY.md:21` Opportunity-queue row
    omits `symbolReadiness` today → catalog it in step 6.
- Deferred surface (LAST/CHG/Quotes) → named follow-up `099-watchlist-live-quotes` (C-14), asserted absent in step 6.

## Session 2026-08-02 — implementation (manual execute on harness branch)

- Implemented all 6 steps directly on `claude/ui-revamp-low-fidelity-ii5p1h` (harness single-branch
  mandate — no per-step feature branches/PRs). Status → code-completed.
- **Files created:** `src/lib/{screenWeights,readinessRollup,formatLastRun}.ts` (+ `.test.ts` each),
  `src/components/insights/WatchlistDetail.tsx`, `e2e/helpers/watchlistMock.ts`.
- **Files modified:** `src/app/insights/screener/page.tsx` (weight range+number control, hard/rank
  segmented toggle, criterion grammar + normalized-share caption, last-run metadata, `scoreColor`
  dot, Save-as-watchlist + Add-top-N actions), `src/app/insights/watchlists/page.tsx` (master-detail
  + `pendingSelectRef` create-auto-select), `src/components/insights/WatchlistReadiness.tsx` (import
  `isFiring`; 4-bucket rollup; "Evaluated against" caption; no-data row; `inQueue` prop),
  `e2e/insights/{screener,watchlists}.spec.ts` (+14 tests), `e2e/mock-backend.ts`
  (`READINESS_BUCKET_OVERRIDE` + arrow `.map`), `e2e/fixtures/INVENTORY.md`.
- **Deviations (see implementation-spec Deviation Log):** single-branch execution; Steps 3+4 in one
  page rewrite; shared `watchlistMock` helper extracted; create-auto-select race fixed via
  `pendingSelectRef` (caught by the master-detail e2e).
- **Verification:** build ✓, lint ✓ (only pre-existing `strategies/[id]` warning), unit 55/55
  (`screenWeights`/`readinessRollup`/`formatLastRun` 100%), `e2e/insights` 79/79, DRY UI-src 0 clones.
- **Teardown / context-scrubber:** the context-forge `/context-scrubber` skill is **not available** in
  this session (not in the skill registry). No `CLAUDE.md`/constitution/findings file was changed;
  `INVENTORY.md` (a test-data catalog) was updated in the same change set. Flagged in the PR body.
