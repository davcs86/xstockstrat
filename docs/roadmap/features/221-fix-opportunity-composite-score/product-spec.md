# Product Spec: fix-opportunity-composite-score

**Type**: bug
**GitHub Issue**: n/a — defect report `docs/reports/2026-10-06-ui-composite-score-grade-colour-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-06

---

## Problem Statement

Observed: every AXP opportunity (three strategies, conviction 100, readiness 1/1) shows composite
`0.500` in red on the Decide queue and the trader position page. 0.500 is the composite's neutral
point (readiness 1.0, signal sub-score 0), yet it renders as `text-destructive` because the composite
reuses the strategy-grade `scoreColor` (red < 0.6, amber ≥ 0.6, green ≥ 0.8).

Expected: the composite's colour reflects its own scale — a k=1 empirical-Bayes shrinkage toward 0.5
whose reachable range is roughly 0.25–0.83 (one maxed axis caps at 0.750, two at 0.833). Operator
decision (2026-10-06): **centred diverging bands** — muted around the neutral point, colour only on
the tails, thresholds calibrated to the reachable range rather than to strategy grades.

## Reproduction Steps

1. Have any opportunity with full readiness and a decayed/absent-weight signal (composite 0.500).
2. Open `/insights/opportunities` or `/trader/positions/<symbol>`.
3. Composite renders red; no single-axis composite can ever render green.

## Root Cause Hypothesis

Feature 199 deliberately reused `scoreColor` (`scoreDisplay.ts:13-17`) for the composite
(`199-opportunity-composite-score/context.md:28`, asserted by its `@AC-8`). Render sites:
`app/trader/positions/[symbol]/page.tsx:982`, `app/insights/opportunities/page.tsx:560`,
`components/mobile/SectionRenderer.tsx:192`. Composite formula: `servicer.py:5586-5596`.

## Affected Services

xstockstrat-ui

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

**C-16 CHANGE:** this fix supersedes feature 199 `@AC-8`'s "colored via the existing scoreColor
scale" clause. `@AC-8`'s other clauses (3-decimal value, no A–F grade, no client re-sort) are
preserved.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Changing the composite formula, its shrinkage constant k, or its server-side ordering
- Strategy-grade colouring (`scoreColor` keeps its current thresholds for grades)
