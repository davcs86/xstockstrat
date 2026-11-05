# Defect: Formula-path fundamentals producer scores absent metrics as 0.0, giving P/B and D/E a top score

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: fabricated-signal
**Environment**: dev (main-dev); reachable only when `analysis.fundsignal.scoring_formula_id` is set
**Affected service(s)**: xstockstrat-analysis, xstockstrat-indicators
**Config-only fix possible**: no
**Source**: feature 246-fix-fundsignal-neutral-score design (accepted residual, `docs/roadmap/features/246-fix-fundsignal-neutral-score/design.md`)

## Observed

On the formula path the producer builds the formula input from raw proto3 scalars and never reads
`missing_metrics`, so an absent metric reaches `ExecuteFormula` as 0.0. In the `value_quality` formula an
explicit 0.0 is "present": `pb_ratio` 0.0 and `debt_to_equity` 0.0 each score 1.0 (`_lin(0, good, bad)`
returns 1.0 when `x <= good`), and `pe_ratio` 0.0, `roe` 0.0, `eps` 0.0 each score 0.0. A partial row
(e.g. only `dividend_yield` present) therefore gets a composite fabricated from wire zeros, then is ranked
and emitted. Feature 246 FR-3 skips only rows with all six fed keys missing; partial rows keep this
behaviour, which durable `@AC-8 @feature-201` currently pins.

## Expected

Absent metrics are omitted from the producer's formula input, as the strategy path already does, so the
formula averages only present sub-parts.

## Reproduction

1. Set `analysis.fundsignal.scoring_formula_id` to the system `value_quality` formula.
2. Run a producer cycle over a symbol whose row lists `pe_ratio`, `pb_ratio`, `roe`, `debt_to_equity`, `eps`
   in `missing_metrics` and has `dividend_yield` 0.013.
3. `ExecuteFormula` receives all six keys, five of them 0.0; the value sub-score includes pb 1.0 and the
   quality sub-score includes de 1.0.

## Evidence

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:452-459`
> fundamentals = {"pe_ratio": f.pe_ratio, "pb_ratio": f.pb_ratio, "dividend_yield": f.dividend_yield, "roe": f.roe, "debt_to_equity": f.debt_to_equity, "eps": f.eps}

`services/xstockstrat-indicators/app/formulas/fundamentals_value_quality.py:146`
> value_parts.append(0.0 if pb < 0 else _lin(pb, _p("pb_good", 1.0), _p("pb_bad", 5.0)))

`services/xstockstrat-indicators/app/formulas/fundamentals_value_quality.py:174`
> quality_parts.append(0.0 if de < 0 else _lin(de, _p("de_good", 0.3), _p("de_bad", 2.0)))

`services/xstockstrat-indicators/app/formulas/fundamentals_value_quality.py:162,180` (neutral fallbacks)
> value_sub = sum(value_parts) / len(value_parts) if value_parts else 0.5
> quality_sub = sum(quality_parts) / len(quality_parts) if quality_parts else 0.5

`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature:47-53` (`@AC-8 @feature-201`:
the producer "passes pe_ratio as 0.0 and scores it a hard zero")

Blast radius: `services/xstockstrat-config/migrations/008_analysis_fundsignal_keys.up.sql:33-34` seeds
`scoring_formula_id` empty in dev and production, so the path is opt-in.

## Root cause hypothesis

proto3 doubles have no wire presence; the producer's formula input ignores `missing_metrics`. Fixing it
alters the guarantee of durable `@AC-8 @feature-201` and needs explicit operator sign-off (C-16;
ledger `docs/roadmap/ledger/fails.md:2724-2727`).

## Confidence

high
