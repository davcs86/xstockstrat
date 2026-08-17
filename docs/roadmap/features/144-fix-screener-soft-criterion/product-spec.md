# Product Spec: fix-screener-soft-criterion

**Type**: bug
**Defect Report**: `docs/reports/2026-08-17-screener-missing-data-neutral-score-defect.md`
**Severity**: SEV-2
**Created**: 2026-08-17

---

## Problem Statement

`ScreenerEngine._build_result` (`services/xstockstrat-analysis/app/services/screener.py:456-474`)
computes a candidate's `technical_score` as `weighted_sum / weight_total`, falling back to a
hardcoded `0.5` when `weight_total` is `0` — which happens whenever every soft (weighted, not
hard-filter) criterion configured for a scan was skipped for that candidate because its
underlying data was missing (`ref_name not in row["raws"]`).

Observed on the dev screener: scanning `AAPL`/`GOOG`/`MSFT`/`QQQ` with one soft criterion
`pe_ratio < 20` (weight 1), QQQ — an ETF with no P/E ratio ever reported by the fundamentals
provider — scores exactly `0.500`, ranking it above MSFT (real P/E 27.7, score 0.393) and AAPL
(real P/E 34.4, score 0.000), and rendered in the UI with the same visual weight as a genuinely
computed result. There is no field or UI marker that distinguishes "data-less neutral fallback"
from "an ordinary computed 0.5".

Expected: a candidate with zero usable data for every soft criterion in a scan should not receive
a score indistinguishable from a real mid-range result — at minimum it must be visibly
distinguishable (e.g. excluded from ranking, sorted last, or explicitly flagged in the response/UI).

This is the soft-criterion sibling of the hard-filter null-as-zero bug already fixed in PR #971:
that fix made a hard filter fail closed on missing data (`passed = False`, same
`ref_name not in row["raws"]` branch, lines 456-463) but never touched the ranking `score`
computed a few lines later for the soft-criterion path.

## Reproduction Steps

1. Open `/insights/screener` (dev — `xstockstrat-staging`), add symbols `AAPL, GOOG, MSFT, QQQ`.
2. Add one soft criterion: `pe_ratio < 20`, weight `1` (hard-filter toggle **off**).
3. Run scan.
4. Observe QQQ (no P/E data, shown as `—`) scores `0.500` and outranks MSFT/AAPL despite having no
   actual data.

## Root Cause Hypothesis

`_build_result`'s `weight_total > 0` guard exists to avoid a division by zero when no criteria are
evaluated for a symbol, and picked `0.5` as an arbitrary placeholder. It never distinguishes "no
criteria configured for this scan at all" from "criteria were configured but this specific
candidate had no usable data for any of them" — the latter should propagate the same fail-closed
intent already applied to hard filters (`passed = False`), not silently emit a plausible-looking
neutral score that competes on equal footing with real results.

## Affected Services

- `xstockstrat-analysis` — `ScreenerEngine._build_result` / `technical_score` computation
  (`app/services/screener.py`), and `scoring.combine_score`'s pure-technical passthrough
  (`app/services/scoring.py:57-60`) that carries the `0.5` unchanged into the final `score`.
- `packages/proto/analysis/v1/analysis.proto` — `ScreenResult` currently has no field marking a
  result's `score` as a data-less fallback vs. a real computation; the fix will likely need one
  (design decision — see `/sdd-design`).
- `xstockstrat-ui` — `services/xstockstrat-ui/src/app/insights/screener/page.tsx` — the
  `score`/`criterion_scores` columns render the raw value with no awareness of the fallback; will
  need a visual treatment once the backend exposes the distinguishing signal.

## Fix Scope

- [x] Proto change made — additive-only: `ScreenResult.score_unavailable` (field 14, `bool`),
      non-breaking (`buf breaking` verified clean). Chosen over reusing
      `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA` — see design decision in `context.md`.
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

- [x] A candidate whose every configured soft criterion has no usable data no longer receives a
      `score`/`technical_score` indistinguishable from a genuinely-computed result (e.g. QQQ's
      P/E-only scan no longer shows `0.500` looking like a real mid-range score). Flagged via
      `score_unavailable=true`, rendered as "No criteria data" + a dashed score in the UI, and
      server-side sorted after every genuinely-scored candidate regardless of its own numeric
      score (`screener.py`'s `results.sort`).
- [x] The hard-filter fail-closed behavior from PR #971 (unaffected by this bug) continues to pass
      unchanged — this fix must not regress `passed`/hard-filter semantics. Verified: the two
      existing hard-filter tests (`test_fundamental_hard_filter_missing_for_one_symbol_fails_closed`,
      `test_fundamental_hard_filter_missing_field_fails_closed_not_lte_zero`) pass unmodified in
      their `status`/`passed` assertions; only new `score_unavailable` assertions were added.
- [x] Existing tests pass (524/524 `xstockstrat-analysis` suite; 97/97 UI vitest suite); new
      test `test_soft_criterion_missing_data_flags_score_unavailable_and_ranks_last` reproduces the
      exact QQQ-style scenario (GOOG/MSFT real data, QQQ missing) and asserts the fixed ranking
      order. New e2e test in `screener.spec.ts` covers the UI badge/dash rendering.
- [ ] Affected service(s) smoke-tested on dev environment (`xstockstrat-staging`) with the exact
      reproduction from this spec — pending deploy; not yet run against the live dev environment
      from this session.

## Out of Scope

- Refactoring the screener's normalization/scoring math beyond the missing-data fallback.
- Changing hard-filter behavior (already correct per PR #971).
- Performance improvements unrelated to the fix.

## Open Questions — Resolved

- **What should the corrected behavior be?** An additive `score_unavailable: bool` marker
  (**not** reusing `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA`, and **not** excluding the candidate
  outright) + a server-side rank-last sort. Full rationale in `context.md`.
- **Does the same pattern exist elsewhere?** Yes — grep swept during this session:
  `app/engine/fundsignal_loop.py:294` (`_builtin_score`) has the identical shape (`sum(parts) /
  len(parts) if parts else 0.5`), feeding the fundamentals signal producer's cross-sectional
  buy/sell/hold quantile. **Left unfixed here** — different subsystem (background producer, not a
  user-facing ranked list), different blast radius (buy/sell/hold classification drift, not a
  visibly-ranked score), and outside this spec's reproduction/acceptance criteria. Flagged as a
  candidate follow-up bug, not filed as a formal defect report in this session (surfaced here per
  the "don't silently fix or silently ignore" project convention — a human should decide whether
  it warrants its own SEV rating and track).
