# Defect: A signal with conviction 0.0 is read back as neutral 0.5 by the signal scorer

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: wrong-signal-weight
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-analysis, xstockstrat-ingest
**Config-only fix possible**: no
**Source**: feature 246-fix-fundsignal-neutral-score design (sibling sweep, `docs/roadmap/features/246-fix-fundsignal-neutral-score/design.md`)

## Observed

Ingest stores a conviction of 0.0 as NULL and reads it back as 0.0. The shared signal scorer then treats
any non-positive conviction as "unknown" and substitutes 0.5. A signal deliberately emitted at
conviction 0.0 is therefore weighted as a mid-conviction signal by the screener and the backtest.
Feature 246 makes this more reachable: under FR-2 a fundamentals row whose present metrics all score
zero now gets a real score of 0.0 and, with the default `analysis.fundsignal.min_conviction_to_emit` of
0.0, is emitted at conviction 0.0 (`fundsignal_loop.py:240` skips only `score < min_conv`).

## Expected

A stored conviction of 0.0 is scored as 0.0, distinct from "conviction not given".

## Reproduction

1. Ingest an `ExternalSignal` with `direction="buy"`, `conviction=0.0`.
2. Run a screener or backtest that weights that source.
3. `compute_signal_score` adds 0.5 × weight to `buy_conviction` for it, not 0.0.

## Evidence

`services/xstockstrat-ingest/app/handlers/servicer.py:1006`
> conviction = signal.conviction if signal.conviction > 0.0 else None

`services/xstockstrat-ingest/app/handlers/servicer.py:1252`
> conviction=float(row["conviction"]) if row["conviction"] is not None else 0.0,

`services/xstockstrat-analysis/app/services/scoring.py:31`
> conviction = sig.conviction if sig.conviction > 0 else 0.5

Consumers: `services/xstockstrat-analysis/app/services/screener.py:256`,
`services/xstockstrat-analysis/app/handlers/servicer.py:92` (`_compute_signal_score` alias).

## Root cause hypothesis

proto3 `double` has no wire presence, so 0.0 doubles as "not given" (INGEST-4 sentinel). The scorer's
`> 0 else 0.5` fallback cannot tell an explicit zero from an absent value.

## Confidence

high
