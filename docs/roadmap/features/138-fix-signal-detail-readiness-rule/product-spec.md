# Product Spec: fix-signal-detail-readiness-rule

**Type**: bug
**Defect Report**: `docs/reports/2026-08-15-signal-detail-readiness-traces-entry-rule-on-reduce.md`
**Severity**: SEV-3
**Created**: 2026-08-15

---

## Problem Statement

**Observed:** On the Signal-detail page (`/insights/market/[symbol]`) for a **held** opportunity
tagged **`Reduce`**, the header shows `CONVICTION 100` while the "Why this fired" panel shows
`0 / 2 conditions` with both leaves failing. The Opportunities queue card for the same
`(symbol, strategy)` reads `100 · 1/1`. Reproduced on `UPRO` under `range_mean_reversion` and
`quality_dip_buyer`.

**Expected:** For a held opportunity whose row exists because its **exit** rule fired (`REDUCE`, and
the held `ADD` case), the readiness panel should explain the **exit** rule — the condition that
actually fired — so the panel reconciles with the header conviction (`1/1`, not `0/2`). Entry
candidates (`ENTER`) keep tracing the entry rule.

## Root Cause Hypothesis

Confirmed (not hypothesis). Two paths trace different rule trees for a held/REDUCE row:

1. Header conviction = queue `Opportunity.conviction`. For a held+attributed candidate,
   `_compute_opportunities` traces the **exit** rule (`servicer.py:2510`, `rule="exit"`) → `1/1` →
   `_conviction_ordinal(1,1)=1.0` → `100`; `exit_fires` → action `REDUCE`.
2. "Why this fired" = `EvaluateReadiness` (`servicer.py:2102`), which calls
   `evaluate_conditions_traced(definition, bars, symbol)` with no `rule=` argument → defaults to
   `rule="entry"` (`evaluator.py:179`) → the entry rule (2 conditions, both failing) → `0/2`.

The queue `Opportunity` message carries only scalar `conviction`/`passing_conditions`/
`total_conditions` (no per-leaf `ConditionEval`), so the exit-rule leaves are not available to the UI
today — only `EvaluateReadiness` → `SymbolReadiness.conditions` carries leaves, and only for entry.

## Affected Services

- `xstockstrat-analysis` — `EvaluateReadiness` RPC (rule-blind; always entry).
- `xstockstrat-ui` — Signal-detail page (`market/[symbol]/page.tsx`) + `SignalReadiness.tsx`.
- `packages/proto` — **potentially** (if the fix adds an explicit rule selector to
  `EvaluateReadinessRequest`).

Note: `EvaluateReadiness` also backs **Watchlist readiness** (`WatchlistReadiness.tsx`), where
entry-rule tracing is correct even for a held symbol — so any "held → exit" behavior must be an
**explicit caller opt-in**, never a blanket server-side flip.

## Fix Scope

- [x] Proto change — additive `ReadinessRule` enum + `EvaluateReadinessRequest.rule = 3`
      (non-breaking; `buf breaking` clean against `main-dev`). User chose the full exit-rule-trace
      approach over the UI-only relabel.
- [x] No database migrations.
- [x] No config key changes.

## Acceptance Criteria

- [ ] On a held `REDUCE` opportunity, the Signal-detail readiness panel and the header no longer
      contradict — the panel reflects the exit rule that actually fired.
- [ ] `ENTER` (entry-candidate) opportunities still trace the entry rule unchanged.
- [ ] Watchlist readiness (`WatchlistReadiness.tsx`) still traces the entry rule for held symbols
      (no regression from a blanket held→exit flip).
- [ ] Existing analysis + UI tests pass; new coverage for the held→exit readiness path.

## Out of Scope

- Refactoring the conviction/readiness formula (`_conviction_ordinal`) — it is correct.
- Any change to how the queue ranks or materializes opportunities.
- Performance work unrelated to the fix.
