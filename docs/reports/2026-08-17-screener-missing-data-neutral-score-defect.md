# Defect: Screener soft criterion scoring assigns a neutral 0.5 to candidates with no usable data

**Recorded**: 2026-08-17
**Severity**: SEV-2
**Impact type**: misleading-screener-score
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no

## Observed

On the dev screener (`xstockstrat-staging`, `tau95.ondigitalocean.app`, `/insights/screener`),
scanning `AAPL`/`GOOG`/`MSFT`/`QQQ` with a single **soft (weighted, not hard-filter)** criterion
`pe_ratio < 20`, weight `1`:

| Symbol | P/E shown | Score |
|---|---|---|
| GOOG | 17.3 | 1.000 |
| QQQ  | — (no data) | 0.500 |
| MSFT | 27.7 | 0.393 |
| AAPL | 34.4 | 0.000 |

QQQ is an ETF with no P/E ratio ever reported by the fundamentals provider — its `pe_ratio`
value is genuinely missing, not a real `0.0` or a real mid-range value. Despite that, it scored
`0.500`, ranking it **above** MSFT and AAPL (both of which have real, worse-than-QQQ-looking P/E
data), and indistinguishable in the UI from a symbol that was actually evaluated and landed in
the middle of the pack.

## Expected

A candidate with zero usable data for every soft criterion in a scan should not receive a score
that looks like a genuinely-computed mid-range result. At minimum it should be visibly
distinguishable from a real 0.5 score (e.g. excluded from ranking, sorted last, or the UI must
surface that the score is data-less) — not silently rendered as an ordinary, plausible 0.500.

This is the soft-criterion sibling of the hard-filter null-as-zero bug already fixed in PR #971
(`missing_metrics`-based fail-closed for hard filters, `screener.py:456-463` — code comment there
explicitly documents that fix). That fix only covers the `passed` boolean; the `score` computed
for ranking/display was not addressed.

## Reproduction

1. Open `/insights/screener` (dev), add symbols `AAPL, GOOG, MSFT, QQQ`.
2. Add one soft criterion: `pe_ratio < 20`, weight `1` (leave the hard-filter toggle off).
3. Run scan.
4. Observe QQQ (no P/E data, `—` shown) scores `0.500` and outranks MSFT/AAPL.

## Evidence

`services/xstockstrat-analysis/app/services/screener.py:456-474` (`ScreenerEngine._build_result`)
```python
for c in criteria:
    if c.ref_name not in row["raws"]:
        # Skipped (this symbol's value was unavailable) — never counts toward the score,
        # and a hard filter can't be confirmed passing on data that was never evaluated
        # (bug fix; see module docstring) — fail closed rather than silently passing.
        if c.hard_filter:
            passed = False
        continue
    sub = norm.get(c.ref_name, {}).get(row["symbol"], 0.5)
    criterion_scores[c.ref_name] = sub
    criterion_raw_values[c.ref_name] = row["raws"][c.ref_name]
    criterion_passed[c.ref_name] = row["passes"].get(c.ref_name, False)
    w = c.weight if c.weight > 0 else 1.0
    weighted_sum += w * sub
    weight_total += w
    if c.hard_filter and not row["passes"].get(c.ref_name, False):
        passed = False

technical_score = weighted_sum / weight_total if weight_total > 0 else 0.5
```
When every criterion for a candidate is skipped (`ref_name not in row["raws"]`, e.g. missing
fundamentals), `weight_total` stays `0.0` and `technical_score` falls through to the hardcoded
literal `0.5` — not a real min-max position, not a statistic over other candidates' data, just a
constant reused as if it were an ordinary outcome.

`services/xstockstrat-analysis/app/services/scoring.py:57-60` (`combine_score`, pure-technical
branch) passes that `0.5` straight through to the final `score` field unchanged when no signal
blend applies (`tech_signal = 2.0*0.5-1.0 = 0.0` → `0.0*0.5+0.5 = 0.5`), so the neutral fallback
reaches the UI exactly as `0.500` with no distinguishing marker.

`packages/proto/analysis/v1/analysis.proto:393-415` (`ScreenResult`) — `passed` is a single flat
bool (hard filters only, confirmed correct); `criterion_scores`/`criterion_passed` are
per-criterion maps where a skipped criterion is simply absent — there is no field that says "this
candidate's overall `score` is a data-less fallback, not a real result."

`services/xstockstrat-ui/src/app/insights/screener/page.tsx:238-241,474-476` — the UI's own
summary line ("N of M passed **the hard filters**") and the "Passed" column both correctly scope
to hard filters only; the `score`/`criterion_scores` columns render the raw numeric value with no
awareness of the fallback, so `0.500` is presented with the same visual weight as a computed
score.

## Root cause hypothesis

`_build_result`'s `weight_total > 0` guard was written to avoid a division by zero when no
criteria are configured or evaluated for a symbol, and picked `0.5` as an arbitrary safe
placeholder. It was never updated to distinguish "no criteria configured for this scan" (rare,
arguably fine to no-op) from "criteria were configured but this specific candidate had no usable
data for any of them" (the QQQ case) — the latter should propagate the same fail-closed intent
already applied to hard filters, not silently emit a plausible-looking neutral score.

## Confidence

high
