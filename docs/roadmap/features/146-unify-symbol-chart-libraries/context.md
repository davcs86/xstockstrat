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
