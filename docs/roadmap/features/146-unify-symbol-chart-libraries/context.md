# Context: unify-symbol-chart-libraries

**Feature**: `docs/roadmap/features/146-unify-symbol-chart-libraries/feature.md`
**Product Spec**: `docs/roadmap/features/146-unify-symbol-chart-libraries/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/146-unify-symbol-chart-libraries/implementation-spec.md`

---

## Session 2026-08-18 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: follow-up to PR #980 (`fix(ui): unify symbol-page panels and make backtests/backfills
  operable`), which harmonized the indicator panels' card framing but deliberately did NOT touch the
  charting libraries — the OHLCV chart stays on `lightweight-charts` (sanctioned exception in
  `services/xstockstrat-ui/CLAUDE.md`), the indicator panels use `recharts` (shadcn `ui/chart`).
- Ledger traps surfaced into product-spec Open Questions:
  - `feature-123` (2026-08-08) — the charting-library choice is a genuine architecture fork that was
    previously self-decided and overridden at the human gate; flag it for a real `/sdd-design` round.
  - `chart-panel.spec.ts` depends on `lightweight-charts`' `.tv-lightweight-charts` DOM class as a
    readiness signal — preserve or rewrite in lock-step.
  - `014-trader-chart-panel` (2026-08-05) — mirror new test-support wiring across `mock-backend.ts`
    and `playwright.config.ts` `webServer.env`.
  - `new-page E2E` — cold-compile 10s/test timeout; verify statically + defer full green to CI.
- Scope decision: trader symbol page only; `/insights/market/[symbol]` and other
  `useCandlestickChart` consumers are an explicit named follow-up if a shared primitive emerges.

## Session 2026-08-18 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict (spec-reviewer): PASS WITH WARNINGS — zero blockers. Every named file, the
  library-mismatch premise (`useCandlestickChart.ts` = lightweight-charts, `IndicatorPanels.tsx` =
  recharts), and the CLAUDE.md sanctioned `lightweight-charts` exception verified against the codebase.
  Non-trading feature (trading-domain checks n/a). No proto/config/DB surface.
- Warnings — addressed in product-spec.md this session:
  1. AC-2 was purely qualitative → added an objective token-source backstop (both surfaces read
     `--chart-*`/theme tokens, no hardcoded hex; assert via shared-token check or light+dark snapshot).
  2. Overlap surfaced a decision dependency on feature 123 → added Open Question: /sdd-design must
     read 123's design.md FR-5 (lightweight-charts keep/replace verdict) and build on the recharts
     v2→v3 baseline 123 lands, not re-litigate it.
  3. Open Questions left open by design (architecture fork under FR-6 human gate + test-readiness
     decisions) — correctly dispositioned to /sdd-design, not dangling.
- Overlap findings (feature-overlap): COLLISIONS FOUND but all soft/rebase textual (same-file), none
  FAIL-class. `page.tsx` overlaps 125/145/139; `IndicatorPanels.tsx` overlaps 125 (creates it)/145
  (Cards it); no overlap on `useCandlestickChart.ts`; no proto/config/migration collisions. No hard
  merge-order row required — recorded a rebase note in product-spec Feature Workflow Notes: /sdd-spec
  must re-verify page.tsx/IndicatorPanels.tsx citations against post-125/145/139 state before executing.
- Demoted-duplicate check: no re-attempt (all demoted features unrelated — OAuth/ML/crypto/options/etc).
- Next: /sdd-design unify-symbol-chart-libraries (resolve charting-library fork at the human gate).

## Session 2026-08-18 — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-ui). Key facts: the single bars fetch already
  feeds both charts (parity `times` carried via useIndicatorSeries), so the mismatch is presentational
  — IndicatorPanels renders a hidden integer index axis (`<XAxis dataKey="i" hide />`) while the
  aligned times go unused, and the candlestick hook uses hard-coded hex vs the panels' `--chart-*`
  tokens. Hook blast radius smaller than documented (only ChartPanel + symbol page;
  insights/market/[symbol] renders NO chart → CLAUDE.md doc-drift). No proto/config/DB surface.
- Phase 1 Grilling: 2 rounds (full).
  - R1 debated fork (b) keep-both-engines. Adversary showed cross-engine AC-1 alignment can only ever
    be tolerance-based (two layout engines) + the getComputedStyle-in-hook token read silently recolors
    the out-of-scope ChartPanel dashboard.
  - USER STEER at live gate: "I don't want to keep both libraries. I want shared tooltips at some
    point." → fork (a): consolidate indicators onto lightweight-charts, drop recharts from the symbol
    page, supersede the CLAUDE.md sanctioned exception. (Clears fails.md L63-66 self-decided-chart-fork
    trap — decided by the real user, not a subagent.)
  - R2 debated fork (a). Adversary: on v4.2.0 (no pane API) fork (a) becomes N synced chart instances
    with pinned-width + re-entrancy/teardown guards, and AC-1 is "pinned-not-guaranteed"; v5 native
    panes make AC-1 a construction guarantee + give the shared crosshair natively.
  - USER GATE decisions (AskUserQuestion): (1) **upgrade to lightweight-charts v5** (native panes);
    (2) **shared lockstep crosshair/tooltip IN SCOPE** for this feature.
- Chosen approach: single v5 chart instance, candlestick in pane 0 + one pane per chartable indicator
  component, all sharing one time scale + one native crosshair. Gaps → whitespace `{time}` points;
  failed components → DOM error strip, no pane. Tokens via a pure vitest-covered oklch→rgb resolver
  (AC-2 backstop). recharts stays for its 3 other consumers; only the symbol page drops it.
- Rejected: fork (b) (user); fork (a) on v4 synced-instances (residual width drift + sync bug class);
  deferring the crosshair (user chose to include it).
- Constitution rules touched: P-01/P-02/P-04 (live human gate for both forks), P-03/F-04 (no silent
  under-delivery / nothing invented — v5 APIs + oklch + monotonic-time as verify-at-spec risks), C-10
  (CLAUDE.md exception + doc-drift fixed in-PR; ChartPanel migrated lock-step), C-12/C-13 (fixture
  reuse), C-14 (symbol-page surface + card→panes layout change flagged for owner review). Floor
  breaches: none.
- Status: spec-ready → design-approved.

### Open Threads (carried into /sdd-spec)
- [ ] Multi-pane layout supersedes the card-per-panel framing (feature 145) — reconcile vs post-125/145/139 state; get xstockstrat-ui owner review. (→ /sdd-spec + owner review)
- [ ] Verify resolved lightweight-charts v5 API (panes, addSeries, line WhitespaceData) against installed typings; PIN the v5 version; update root CLAUDE.md version note. (→ /sdd-spec step 0)
- [ ] Prove oklch→rgb canvas resolution on CI chromium; pick a visible gridline token (not 10%-alpha --border). (→ token-resolver step)
- [ ] AC-3 "all sub-series drawn": data-series-count is a readiness helper only — back with a setData-invoked-N-times seam or snapshot. (→ e2e-rewrite step)
- [ ] Disposal-safe pane teardown on strategy switch (IndicatorSection re-resolve). (→ pane-coordinator step)
- [ ] Soft rebase: re-verify page.tsx / IndicatorPanels.tsx citations vs post-125/145/139 state. (→ /sdd-spec)

## Session 2026-08-18 — sdd-spec

- Generated implementation-spec.md with 8 steps. Status → implementation-ready.
- Consumed recon.md + design.md (fork (a), lightweight-charts v5 native panes). No proto/config/DB
  steps — UI-only, single service (xstockstrat-ui).
- Step shape: (1) pin+verify lightweight-charts v5 API before any code (feature-014 trap,
  insights.md:659-663); (2) pure src/lib unset→whitespace point mapper + monotonic-time normalize
  (vitest); (3) pure src/lib oklch→rgb token resolver + new `--chart-grid` token (vitest for the pure
  branches; probe round-trip proven on chromium); (4) migrate `useCandlestickChart` to v5 panes +
  hex→tokens; (5) build indicator panes on the shared chart, drop recharts from the symbol page, move
  avg/stop overlay hex→tokens, shared crosshair; (6) migrate `ChartPanel.tsx` lock-step; (7) rewrite
  `position-detail.spec.ts` recharts assertions → v5 panes + `data-series-count` + setData seam;
  (8) rewrite CLAUDE.md sanctioned exception + fix stale `insights/market` doc-drift.
- Key codebase findings (all citations re-verified against post-125/145/139 tree):
  - Rebase clean: `page.tsx` is 1277 lines; chart wiring at `page.tsx:116` (`useCandlestickChart(260)`),
    overview render `page.tsx:381-401`, bars fetch + avg/stop overlays `page.tsx:189-246` (hex `#94a3b8`
    :219 / `#e0787a` :231, `DASHED=2` :72), `IndicatorSection` `page.tsx:1105-1163`. `IndicatorPanels.tsx`
    is the recharts renderer (testids `indicator-panels`/`indicator-panel`/`indicator-panel-error`;
    gap `?? null` + `connectNulls={false}` :63-67,88; hidden index axis :59,76).
  - `useCandlestickChart.ts:32-40` still v4 `addCandlestickSeries` + hard-coded hex; only 2 real
    consumers (`ChartPanel.tsx` + symbol page) — `insights/market/[symbol]` renders NO chart (CLAUDE.md
    doc-drift confirmed, grep=0).
  - `node_modules` absent at spec time → v5 API names are design assumptions to CONFIRM in Step 1
    against installed typings (recorded as F-09 Deviation Log if they differ), not invented (F-04).
  - Root CLAUDE.md version table does NOT track lightweight-charts (grep=0) → no root edit; the only
    doc surface is `services/xstockstrat-ui/CLAUDE.md` § Styling (Step 8).
  - vitest env is `node` (not jsdom) → the oklch `getComputedStyle` probe is NOT node-unit-testable;
    surfaced in Step 3 (P-03) — vitest covers the pure branches, chromium diagnosed run proves the probe.
  - Reuse (C-12/C-13): `INDICATOR_SERIES_AAPL` (`e2e/fixtures/indicatorSeries.ts`, INVENTORY.md:32),
    served by `mock-backend.ts:944-946` + AAPL bars :429-464, auth `e2e/helpers/auth.ts`. No new fixture,
    no new mock/env wiring (confirm-don't-add, feature-014 sibling-wiring trap).
  - Gap-not-0 wire proof already exists, unchanged: `test_analysis_servicer.py:5530`
    (`test_none_maps_to_unset_indicator_value_not_zero`).

### Open Threads (carried into /sdd-execute)
- [ ] Step 1: confirm exact v5 symbol names (`addSeries(CandlestickSeries|LineSeries)`, pane API,
      `WhitespaceData`) against installed typings; pin exact patch; record any divergence in Deviation Log.
- [ ] Step 3: pick a visible `--chart-grid` token (not 10%-alpha `--border`); prove the oklch→rgb probe
      on the chromium diagnosed run (vitest is node-env, can't).
- [ ] Step 5: card-per-panel framing (feature 145) → stacked v5 panes is a real layout change — owner review.
- [ ] Step 7: `data-series-count` is a readiness helper only — back "all series drawn" with a
      setData-N-times/snapshot seam; preserve `.tv-lightweight-charts` readiness; defer full green to CI.

## Session 2026-08-18 — sdd-review impl-spec (advisory)

- Result: 0 failures, 2 warnings, 3 notes (advisory — did not block). No Floor breach. Every code
  citation spot-checked resolved exactly against the working tree.
- Overlap: CLEAN — no collisions. Every feature sharing 146's UI files (125/145/139/143/123) is
  already merged to trunk (the baseline 146 was specced against); the only strictly in-flight features
  (142, 084) touch none of 146's files. No merge-order row required.
- Findings — addressed this session (spec edits):
  - [x] Step 8 (C-10 doc-completeness): the stale "insights/market/[symbol] has a chart" claim appears
        TWICE in services/xstockstrat-ui/CLAUDE.md (§ Styling sanctioned-exception AND § Opportunities-first
        "Decide screens"). Step 8 now targets BOTH and greps `insights/market` to confirm none survive.
  - [x] Step 6 (C-01, cosmetic): off-by-one citations fixed (setData `:57`→`:56`; div `:129-134`→`:127-133`).
- Findings — addressed by splitting Step 5 (spec now 9 steps):
  - [x] Step 5 (B2 step breadth): bundled 6 concerns → split. Shared crosshair + unified tooltip is
        now its own **Step 6** (with its own red-green: hover shows one combined readout; a gap bar
        shows the indicator blank, never 0). Old Steps 6/7/8 (ChartPanel / e2e / docs) renumbered to
        7/8/9; all cross-references updated; e2e Step 8 now also asserts the shared readout.
  - [note] Steps 2/3 use vitest-config-driven coverage thresholds (not a CLI flag) — matches this
        service's testing convention; no action.
- Re-review after the split: /sdd-review impl-spec re-run 2026-08-18 (see next session block).
- Next: /sdd-execute unify-symbol-chart-libraries.

## Session 2026-08-18 — sdd-review impl-spec (advisory, re-review after Step-5 split)

- Result: 0 blockers, 1 warning, 2 notes (advisory). No Floor breach. The 8→9 split verified clean:
  (a) all "Step N" cross-references consistent after renumber; (b) new Step 6 (crosshair/tooltip)
  well-formed with real files + red-green gate deferred to Step 8; (c) no old-Step-5 concern dropped
  or duplicated (panes/fault-isolation/readiness-seam/overlay-tokens/recharts-removal stay in Step 5).
  Overlap unchanged (split touches only files already covered) → still CLEAN, no merge-order row.
- Findings — addressed this session:
  - [x] Step 8 (C-08 coverage-threshold warning): added a verification note that this is a Playwright
        e2e step with no `--cov-fail-under` gate; the src/lib ≥40% node-coverage threshold is carried
        by Steps 2-3. (False-positive of the B2 literal FAIL trigger; clarified rather than forced.)
  - [x] Step 8 (C-01 note): two off-by-one evidence citations fixed (`:432`→`:433`, `:440`→`:439`);
        the load-bearing `.recharts-line` `:444` citation was already exact.
- Spec is stable at 9 steps, implementation-ready. Next: /sdd-execute unify-symbol-chart-libraries.

## Session 2026-08-18 — sdd-review impl-spec (advisory, third round)

- Result: **PASS — 0 blockers, 0 warnings, 2 notes** (both explicitly "not a warning"). No Floor risk.
- Confirmed the three prior fixes landed correctly against source: (1) crosshair split into Step 6
  (Total Steps 9, deps backward-only); (2) Step 8 e2e coverage note present and sound; (3) Step 8
  citations `:433` (indicator-panels visibility assertion) and `:439` (sandbox-timeout text) verified
  line-by-line in position-detail.spec.ts. Every code citation across all 9 steps re-checked exact.
- Notes (no action): (i) Step 6 lists 3 files with "if owned by hook / if owned at page level" —
  acceptable execution latitude, F-08-safe (over-list not under-list). (ii) Step 8 has no
  `--cov-fail-under` by design for a Playwright e2e step — documented, not omitted.
- Spec is clean and stable at 9 steps. No further spec edits. Next: /sdd-execute unify-symbol-chart-libraries.

## Session 2026-08-18 — sdd-execute (sequential)
**Steps this session**: starting 1..9 on feature/unify-symbol-chart-libraries

### Step 1 — Pin lightweight-charts v5 and verify its API [done]
- Pinned `lightweight-charts@5.2.1` (exact, no caret); `pnpm install` updated root pnpm-lock.yaml;
  node_modules present (registry reachable via proxy).
- Verified all v5 API assumptions against installed typings + a `tsc --noEmit` import probe — full
  detail in Deviation Log. Key: `chart.addSeries(CandlestickSeries|LineSeries, opts, paneIndex?)`,
  `chart.addPane()`/`chart.panes()`, `WhitespaceData {time}` gap points, `series.createPriceLine()`
  preserved. No deviation from the spec's assumptions.
- Lint clean (only pre-existing unrelated react-hooks warnings). TDD: N/A (dependency pin).
- Files modified: `services/xstockstrat-ui/package.json`, `pnpm-lock.yaml`.

### Step 2 — Pure indicator-point mapper (unset→whitespace, ascending-unique time) [done]
- Created `src/lib/indicatorChart.ts`: `toLineData(values, times)` maps a NamedSeries' values over the
  shared parity times → lightweight-charts v5 points — UNSET `value===undefined` → whitespace `{time}`
  (gap, never a fabricated 0), genuine 0 → `{time,value:0}`; iterates over `times` so a short values
  array yields trailing gaps, not invented data. `normalizeAscendingUnique` (exported) guards the v5
  `setData` strictly-ascending-unique precondition: stable ascending sort + duplicate-timestamp
  "last wins" (documented rule).
- TDD: RED `pnpm run test:unit indicatorChart.test.ts` → "Failed to load ./indicatorChart" (module
  missing). GREEN → 7/7 pass. Full suite 104/104; coverage 85% (≥40% floor), indicatorChart.ts 100%.
  tsc --noEmit clean. Reused canonical fixture `INDICATOR_SERIES_AAPL` (C-13), no new fixture.
- Files modified: `src/lib/indicatorChart.ts`, `src/lib/indicatorChart.test.ts`.

### Step 3 — Chart color-token resolver (oklch→rgb) + --chart-grid token [done]
- Created `src/lib/chartColors.ts`: `resolveChartColor(varName, fallback)` reads a CSS custom property
  and returns a canvas-usable color — hsl/rgb/hex pass through (`isCanvasSafeColor`), oklch/oklab/lab
  resolve to rgb() via a hidden probe element the browser computes; off-DOM (SSR/node) or on failure
  returns the fallback (never throws). Exposed `CHART_COLOR_TOKENS` + `CHART_GRID_TOKEN` ('--chart-grid').
- Added `--chart-grid: oklch(0.42 0.01 56.043 / 0.55)` to globals.css `:root` — a visible gridline
  token (NOT the 10%-alpha `--border`); opacity tuned in the Step 8 diagnosed run.
- TDD: RED (module missing) → GREEN 5/5. Full suite 109/109; aggregate coverage 82.47% (≥40% floor).
  chartColors.ts shows 55.88% because the live probe + DOM branch aren't node-reachable — proven in the
  Step 8 chromium run (P-03: surfaced, not silently worked around). tsc clean.
- Files modified: `src/lib/chartColors.ts`, `src/lib/chartColors.test.ts`, `src/app/globals.css`.

### Step 4 — Migrate useCandlestickChart to lightweight-charts v5 panes + tokens [done]
- v4 `addCandlestickSeries` → v5 `chart.addSeries(CandlestickSeries, …)` (dynamic-imported alongside
  `createChart`). Hard-coded hex removed — colors resolved from tokens via `resolveChartColor`
  (`--muted-foreground` text, `--chart-grid` grid, `--border` borders, `--color-buy`/`--color-sell`
  candles); fallbacks are CSS named colors (no brand hex), unreachable in practice (client-only create,
  static dark tokens). Added `rightPriceScale.minimumWidth: 64` so stacked indicator panes (Step 5)
  keep aligned plot-area left edges. Exposed `chartRef` (typed `IChartApi`) for Step 5's panes; kept
  `containerRef`/`seriesRef` (`any`) contract so page.tsx + ChartPanel are untouched. Teardown nulls
  both refs (disposal-safe).
- Verified v5 still emits `.tv-lightweight-charts` (e2e readiness preserved) and `CrosshairMode.Magnet=1`.
- TDD: behavior covered by the red-first Step 8 e2e (deferred to CI per the chart-heavy cold-compile
  trap). Local gates: no hex (grep), `addSeries(CandlestickSeries)` present, tsc --noEmit clean, eslint
  clean on changed files.
- Files modified: `src/hooks/useCandlestickChart.ts`.

### Step 5 — Indicator panes on the shared v5 chart; drop recharts from the symbol page [done]
- Rewrote `IndicatorPanels.tsx`: recharts removed. Now draws one native v5 pane per chartable
  component on the SHARED chart (from `chartRef`), each named sub-series a `LineSeries` at paneIndex
  1..N with `toLineData(values, times)` (gaps-not-0) and `--chart-N` colors (resolveChartColor).
  Grows the shared canvas + container height (min-height on the div so React won't fight it) and sets
  price-pane stretch > indicator panes. Per-component fault isolation preserved (error → DOM strip, no
  pane). Kept testids `indicator-panels`/`indicator-panel`/`indicator-panel-error` + added
  `data-series-count`/`data-series` readiness seam. Disposal-safe cleanup (captures the async chart in
  effect scope; removes its series + panes, restores 260px; guarded against a disposed chart).
- `page.tsx`: grabbed `chartRef`; passed `chartRef`+`containerRef` through IndicatorSection →
  IndicatorPanels; div `height:260` → `minHeight:260`; avg/stop `createPriceLine` hex → tokens
  (`--muted-foreground`/`--color-sell`). recharts kept in package.json + ui/chart.tsx (3 other consumers).
- TDD: covered by the red-first Step 8 e2e (CI). Local gates green: tsc --noEmit, eslint (0 warnings on
  changed files), no recharts import, no overlay hex, unit suite 109/109. Full pane render validated by
  Step 8 in CI (chart-heavy cold-compile trap — the current recharts e2e is intentionally red until Step 8).
- Files modified: `src/components/trader/IndicatorPanels.tsx`, `src/app/trader/positions/[symbol]/page.tsx`.

### Step 6 — Shared crosshair + unified tooltip across price and all panes [done]
- The single v5 instance already draws ONE native crosshair across every pane (no cross-instance
  sync — grep confirms none). Added a unified readout in IndicatorPanels: builds a series→label map
  (pane-0 candlestick → 'price'; each line → `<refName>.<seriesName>`), subscribes
  `chart.subscribeCrosshairMove`, and renders one combined value row (`chart-crosshair-readout`) at the
  hovered bar. A whitespace/gap point (time only) shows an em dash '—', never a fabricated 0
  (`readoutValue`). Unsubscribes on teardown.
- Scoped to this feature only (no multi-symbol/compare infra). Touched only IndicatorPanels.tsx (the
  hook's crosshair.mode:1 already correct, not per-pane).
- TDD: hover assertion in the red-first Step 8 e2e (CI). Local gates: tsc clean, eslint clean,
  unit suite 109/109.
- Files modified: `src/components/trader/IndicatorPanels.tsx`.

### Step 7 — Migrate ChartPanel.tsx to the v5 hook in lock-step [done]
- No code change needed: ChartPanel uses only the hook's returned containerRef/seriesRef and never
  called v4 addCandlestickSeries directly. Step 4's additive hook change carries the v5 migration +
  token colors through automatically. Recorded as a Deviation Log entry (anticipated "modify" → no-op).
- Verified: grep addCandlestickSeries → none; whole-app tsc --noEmit clean against v5. Its
  `.tv-lightweight-charts` readiness (chart-panel.spec.ts) is preserved (v5 still emits it, confirmed
  Step 4). Full green run in CI (Step 8).
- Files modified: none (ChartPanel.tsx unchanged); Deviation Log + context only.
