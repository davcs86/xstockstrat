# Design: fix-edgar-quarterly-roe

**Mode**: quick — the two forks triage flagged were decided by the operator (AskUserQuestion,
2026-10-06): (1) fewer-than-four-quarters fallback = **annualize the available quarters (Σ × 4/n)**;
(2) re-derivation of already-stored rows = **a `derivation_version` column + conditional upsert**,
delivered by `223-fix-stored-edgar-periods` (one mechanism heals both defects with one re-backfill).

## Approach

`edgar_client.go` collects every `NetIncomeLoss` flow fact keyed by **its own period**
(start/end), not by the filing's `fy`/`fp` (a 10-Q's prior-year comparative column shares the
filing's fy/fp — keying on it can pick the comparative). For a quarterly period:
TTM = Σ the latest ≤4 quarter facts whose end ∈ (periodEnd − 350d, periodEnd], each at its
earliest filing, restricted to facts filed on/before the period's own filing (PIT). A quarter with
no standalone fact (Q4, reported only inside the 10-K) is derived as FY − Q1..Q3 when all three are
present. `roe = TTM × 4/n / period-end equity`. Annual rows unchanged.

## Rejected

- ×4 of the single quarter only — ignores available earlier quarters; seasonal bias.
- Nil when < 4 quarters — early-history rows lose ROE, fscore treats them as missing.
- Average equity denominator — not what the acceptance criteria / vendor `returnOnEquityTTM` use.
