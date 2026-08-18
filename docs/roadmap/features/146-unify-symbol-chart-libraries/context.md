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
