# Defect: GAPS_ONLY backfill is blind to interior holes and reports COMPLETED

**Recorded**: 2026-11-25
**Severity**: SEV-2
**Impact type**: silent-data-loss-in-indicator-inputs
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-marketdata, xstockstrat-ingest
**Config-only fix possible**: no

## Observed

On homelab staging, SCHW and IDXX (and ~17 other symbols) had no daily bars from 2026-04-01 to
2026-09-25 (~124 sessions) while bars before and after existed. GAPS_ONLY backfills over a 365-day
range ending 2026-11-21 completed with 2–3 bars processed per symbol and status COMPLETED; the hole
stayed. Downstream, SMA200 was uncomputable (`px > sma200` traced as threshold 0.0,
CONDITION_STATE_UNSPECIFIED) for 27 opportunity-queue symbols. A FULL + overwrite backfill closed it
(2026-11-25, 8 jobs, ~96k bars), after which the UNSPECIFIED count fell from 27 to 8.

## Expected

A GAPS_ONLY backfill over a range fetches every missing trading session inside it, including
interior holes, or at minimum does not report COMPLETED while sessions in the requested range are
missing.

## Reproduction

1. For a symbol with daily bars, delete the bars for an interior window (e.g. 2026-04-01..2026-09-25)
   while keeping bars before and after it.
2. `trigger_backfill(symbols=[SYM], fill_mode="gaps_only", start=<before hole>, end=<after hole>)`.
3. Job ends COMPLETED; `query_bars` still shows the hole.

## Evidence

`services/xstockstrat-marketdata/internal/timeframe/timeframe.go:82-99`
> // span. No bars → whole window; else only leading/trailing segments (interior holes out of scope).

`services/xstockstrat-ingest/app/handlers/servicer.py:797-811`
> for gap in cov.gaps:

Feature 343 sends GAPS_ONLY from the UI "Backfill missing data" button for non-admins, and feature
054 defaults agent-scheduled backfills to GAPS_ONLY, so neither self-serve path can repair a hole.

## Root cause hypothesis

`GetCoverage` returns only (earliest, latest, count); `ComputeGaps` derives head/tail gaps from that
span, so an interior hole is structurally invisible to GetDataCoverage and to GAPS_ONLY planning.

## Confidence

high
