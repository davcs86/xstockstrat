# Context Log: fix-strategy-detail-definition-render

## 2026-09-19 — triage + fix (single session)

**Triage.** `docs/reports/2026-09-18-strategy-detail-definition-not-rendered-defect.md`. SEV-3
UX/observability, Track C. Verified the page fetches `definition` via `useGetStrategy` and reads only
warnings/liveEnabled/signalEligible/active — never components/entryRule/exitRule. `summarizeRule`/
`parseRuleTree`/`ruleHasConditions` already exported from `RuleEditor.tsx`; `RuleSummary` was
module-local in `StrategyWizard.tsx`.

**Design decision — visibility (operator-approved: all readers).** The definition is read-only info
the owner already has via the RPC; the page already admin-gates only its write controls. All-readers
is the report's expected default and was confirmed.

**DRY factoring.** Rather than copy `RuleSummary` (a jscpd/dry-reviewer finding), and to keep the
read-only page from bundling the full editor's client-only UI (Combobox/Select/etc.):
- Extracted the pure parsers to `src/lib/ruleSummary.ts` (depends only on lightweight
  `strategyCatalog`). `RuleEditor.tsx` imports + re-exports them for back-compat (only external
  importer was StrategyWizard's `summarizeRule`).
- New `components/insights/RuleSummary.tsx` (presentational) used by both the wizard Review step and
  the detail page.

**Implementation.** Definition card added before the Run Backtest card (left column), tokens only
(C-17), `data-testid="strategy-definition"`. Renders components (refName — indicator/formula
(params) on sourceSymbol), entry/exit rules via `RuleSummary`, cooldowns, and deny list (when set).

**Tests.**
- vitest `src/lib/ruleSummary.test.ts` (11 cases — parse/summarize/hasConditions, coverage-scoped
  `src/lib/**`).
- e2e `strategy-analytics.spec.ts` — definition card renders (sma_fast / SMA / Entry rule / Exit
  rule). Ran CI-style (prod build): 3/3 passed. NOTE: `next dev` (local) flaked with ECONNRESET on
  cold compile (the pre-existing analytics test's hard-coded 5s timeout); the prod-build run CI uses
  is green — not a code fault.
- `next lint` clean for touched files (only pre-existing warnings elsewhere); `tsc --noEmit` clean
  for touched files (one pre-existing, unrelated `middleware.test.ts` mock-typing error not mine).

**Files:** `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx`,
`src/lib/ruleSummary.ts`, `src/lib/ruleSummary.test.ts`,
`src/components/insights/RuleSummary.tsx`, `src/components/insights/RuleEditor.tsx`,
`src/components/insights/StrategyWizard.tsx`, `e2e/insights/strategy-analytics.spec.ts`.

## Session 2026-09-24 (CI: feature status automation)

- Promotion PR #1169 merged to main
- Feature promoted and committed: dd622bdc2e5b922df8dcabc6f7475b8b395a8ed3
- Status updated: `code-completed` → `launched`
- Launched date: 2026-09-24
