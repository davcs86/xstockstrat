# Defect: Fundamentals producer labels a lone scored symbol "buy" whatever its score

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: wrong-signal-direction
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no
**Source**: feature 246-fix-fundsignal-neutral-score design (`docs/roadmap/features/246-fix-fundsignal-neutral-score/design.md`, Open Risks)

## Observed

`_map_directions` assigns direction by a cross-sectional nearest-rank quantile over the run's scores.
With one scored symbol, `buy_cut` and `sell_cut` both equal that symbol's score, and the `s >= buy_cut`
branch is tested first, so the symbol is always `buy` — a score of 0.05 is emitted as `buy`. With very
small sets (2-4 symbols) the cuts collapse similarly. Feature 246 makes small scored sets more common:
data-less symbols no longer enter the quantile, so an ETF-heavy universe can leave one or two scored
stocks.

## Expected

A direction reflects the score, not only its rank in a degenerate cross-section; a lone low score is not
labelled `buy`.

## Reproduction

1. Set `analysis.fundsignal.universe_source=explicit` with one symbol whose fundamentals score low
   (e.g. pe_ratio 40, roe 0.0, eps -1).
2. Run a non-dry-run producer cycle.
3. The emitted `analysis.fundsignal_emitted` row and `ExternalSignal` carry `direction="buy"`.

## Evidence

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:475-480`
> buy_cut = _quantile(ordered, buy_quantile)
> sell_cut = _quantile(ordered, sell_quantile)
> ...
> if s >= buy_cut:
> directions[sym] = "buy"

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:639-640`
> idx = int(round(q * (len(sorted_values) - 1)))
> return sorted_values[idx]

With `len == 1`, `idx == 0` for every `q`.

## Root cause hypothesis

The quantile mapping has no minimum cross-section size and no absolute score floor for `buy`.

## Confidence

high
