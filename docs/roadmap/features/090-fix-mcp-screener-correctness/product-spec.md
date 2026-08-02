# Product Spec: fix-mcp-screener-correctness

**Type**: bug
**Source Report**: `docs/reports/2026-08-01-mcp-tools-alignment-triage.md` (F-4)
**Severity**: SEV-3
**Created**: 2026-08-02

---

## Problem Statement

`screen_symbols` ships dead knobs and cannot do technical screening (report F-4):

1. **Technical kinds silently skipped.** The docstring advertises `SCREEN_KIND_TECHNICAL_FORMULA`/
   `_INDICATOR`, but the agent wrapper never maps `ScreenCriterion.component`, which those kinds
   require — so technical criteria are dropped. The server-side capability is fully built.
2. **`min_conviction` ignored.** Plumbed to the proto but never read by the screener.
3. **Unknown fundamental `metric_name` silently skipped** rather than erroring — a typo yields a
   silently degraded scan indistinguishable from "data unavailable".
4. **`coverage_gaps` computed after rank truncation**, so an INSUFFICIENT_DATA symbol below the cut
   is dropped from both results and gap reporting.
5. **Agent projection drops gap detail** (`timeframe`/`bars_have`/`bars_need`).

Expected: technical criteria work (component mapped, agent-only — no server change); `min_conviction`
is honored (or removed); an unknown metric name errors; gaps are computed before truncation and carry
full detail.

## Reproduction Steps

1. `screen_symbols(criteria=[{kind:"SCREEN_KIND_TECHNICAL_INDICATOR", component:{...}}])` → criterion
   silently skipped. 2. Pass `min_conviction=0.8` → no effect on results. 3. Misspell a fundamental
   `metric_name` → silently skipped, scan returns OK.

## Root Cause Hypothesis

RC-1 (thin wrapper never ported the `manage_strategy` component mapping into `screen_symbols`),
RC-4 (`min_conviction` is a contract-first field with no reader). See report F-4.

## Affected Services

`xstockstrat-agent` (`app/client.py` `screen_symbols` — map `component`, project gap detail),
`xstockstrat-analysis` (`app/services/screener.py` — `min_conviction` filter, unknown-metric error,
gaps-before-truncation; `app/handlers/servicer.py` for `INVALID_ARGUMENT`).

## Fix Scope

- [ ] No proto changes anticipated (all fields already exist).
- [ ] No database migrations anticipated.
- [ ] No config key changes anticipated.
- Reuse the `manage_strategy` kind→component mapping (`app/client.py`) for `ScreenCriterion.component`.

## Acceptance Criteria

- [ ] A technical criterion with a `component` is sent and scored (RED: currently empty component).
- [ ] `min_conviction` filters results (RED: two symbols 0.9/0.3, `min_conviction=0.5` → only 0.9),
      or the field is removed from the tool if design chooses removal.
- [ ] An unknown fundamental metric name → `INVALID_ARGUMENT` (RED: currently silently skipped).
- [ ] `coverage_gaps` includes an INSUFFICIENT_DATA symbol ranked below `rank_limit`.
- [ ] Projected `coverage_gaps` carry `timeframe`/`bars_have`/`bars_need`.

## Out of Scope

- Screener scoring-model changes beyond the conviction floor.
- Docstring/runbook wording (already corrected in the docs-only pass; re-verify after code lands).
