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
