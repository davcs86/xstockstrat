# Defect: Stored EDGAR periods still carry total-liabilities D/E after feature 211's financial-debt D/E launched

**Recorded**: 2026-10-06
**Severity**: SEV-2
**Impact type**: wrong-signal-input
**Environment**: dev (staging)
**Affected service(s)**: xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

Every AXP historical EDGAR period on staging (Q2-2025 through Q2-2026, including Q2-2026 filed
2026-07-24) has `debt_to_equity` ≈ 8.6–9.8. The Q2-2026 value 8.808 is exactly
`liabilities / stockholders_equity` = 266,578M / 30,264M from the snapshot's `extra_metrics`, i.e.
the pre-211 total-liabilities ratio. Feature 211 `@AC-3` specifies AXP's financial-debt D/E ≈ 1.73
(below `de_bad` 2.0). With 8.8 the formula's D/E sub-score is 0.0; with ~1.73 it would be ~0.16.

## Expected

Stored periods and the EDGAR snapshot cache reflect the launched financial-debt D/E convention
(`total_debt / equity`), so AXP reads ≈ 1.73 per `@AC-3`.

## Reproduction

1. Agent tool `query_fundamentals(symbol="AXP", mode="historical", range_start="2025-06-01")`.
2. Observe `debt_to_equity` ≈ 8.6–9.8 on every row; compare with `liabilities / stockholders_equity`
   from `query_fundamentals(symbol="AXP")` `extra_metrics`.

## Evidence

`services/xstockstrat-marketdata/internal/edgar/edgar_client.go:408-411`
> // Financial-debt D/E (feature 211, FR-2): total_debt / equity, native currency, no double-count.

`docs/roadmap/features/211-edgar-fundamentals-enrichment/context.md:144`
> Verified: AAPL D/E≈1.34, AXP≈1.73 (<de_bad=2.0, @AC-3 ✓), BABA FY2026≈0.05.

`docs/roadmap/features/211-edgar-fundamentals-enrichment/design.md:26-28`
> a genuine later-amendment restatement is a documented accepted residual (manual purge + re-backfill).

Staging AXP Q2-2026: `debt_to_equity 8.808419243986254`, `liabilities 266578000000`,
`stockholders_equity 30264000000`.

## Root cause hypothesis

The stored `marketdata` historical-fundamentals rows were backfilled before feature 211 deployed and
were never purged and re-backfilled (the earliest-filing idempotency pin keeps first-written values),
so the new D/E derivation never reached existing periods; the EDGAR snapshot is projected from those
stale rows. Not verified against the DB or deploy timeline.

## Confidence

low
