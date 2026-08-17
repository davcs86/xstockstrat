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

- [ ] No proto changes anticipated — **likely needed**: `ScreenResult` has no "data-less fallback"
      marker today; whether to add one (vs. an alternative fix like sorting the candidate last or
      excluding it) is exactly what `/sdd-design` should resolve.
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

- [ ] A candidate whose every configured soft criterion has no usable data no longer receives a
      `score`/`technical_score` indistinguishable from a genuinely-computed result (e.g. QQQ's
      P/E-only scan no longer shows `0.500` looking like a real mid-range score).
- [ ] The hard-filter fail-closed behavior from PR #971 (unaffected by this bug) continues to pass
      unchanged — this fix must not regress `passed`/hard-filter semantics.
- [ ] Existing tests pass; new test(s) reproduce the exact QQQ-style scenario (a candidate with a
      configured soft criterion and zero usable data for it) and assert the fixed behavior.
- [ ] Affected service(s) smoke-tested on dev environment (`xstockstrat-staging`) with the exact
      reproduction from this spec.

## Out of Scope

- Refactoring the screener's normalization/scoring math beyond the missing-data fallback.
- Changing hard-filter behavior (already correct per PR #971).
- Performance improvements unrelated to the fix.

## Open Questions

- What should the corrected behavior actually be — exclude the candidate from `results` entirely,
  rank it last regardless of numeric score, or add an explicit `ScreenResult` field (e.g.
  `insufficient_data: bool`) the UI renders distinctly? Each has different proto/UI blast radius —
  left for `/sdd-design` to resolve rather than assumed here.
- Does this same "all criteria skipped → neutral fallback" pattern also affect any other
  weighted/ranking computation outside the screener (e.g. `analysis.opportunity` ranking, the
  fundamentals signal producer's cross-sectional quantile)? Worth a grep sweep during
  `/sdd-design`'s recon phase before assuming the fix is screener-local.
