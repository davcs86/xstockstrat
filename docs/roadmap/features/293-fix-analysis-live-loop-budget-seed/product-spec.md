# Product Spec: fix-analysis-live-loop-budget-seed

**Type**: bug
**Defect report**: `docs/reports/2026-11-04-analysis-live-loop-chronic-budget-overflow-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-04

---

## Problem Statement

The live loop reads `analysis.engine.max_strategies_per_cycle` (`live_loop.py:359`, code default 50) but the key is not registered in any environment's config registry. Raising it required a runtime `SetConfig create_key=true` (done on staging 2026-11-04, value 200), which is invisible to migrations (`docs/patterns/config-governance.md:90`): production and fresh environments still run the unregistered default, and the key has no description or default in `list_config_keys`. Separately, a fleet that stays above the budget logs the same WARN on every cycle (~5.6k lines/7 days at budget 50) for a steady-state condition.

## Reproduction Steps

1. `list_config_keys(namespace="analysis")` on any environment: the key is absent.
2. `SetConfig` without `create_key` is refused NOT_FOUND (feature 091 existence gate).
3. With 670+ live pairs, observe one overflow WARN per live-loop cycle.

## Root Cause Hypothesis

The key was introduced consumed-with-default (no seed), the pattern feature 227 waived for tuning keys, but this one is operationally necessary once the fleet outgrows 50. Whether the repeated WARN should be throttled or lowered is a design question for `/sdd-design`.

## Affected Services

xstockstrat-analysis, xstockstrat-config (seed migration)

## Fix Scope

- [ ] No proto changes anticipated
- [ ] A config seed migration is anticipated (registers the key in every environment; must not clobber the runtime-created staging value 200)
- [ ] Config key registered: `analysis.engine.max_strategies_per_cycle` (int)

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Choosing a production budget value (operator decision)
- Raising the staging value further
