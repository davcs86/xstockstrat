# Design: fix-stored-edgar-periods

**Mode**: quick — the re-derivation strategy fork was decided by the operator (AskUserQuestion,
2026-10-06): **`derivation_version` column + conditional upgrade** (over an operational purge +
re-backfill, or an unconditional overwrite that breaks the feature-198 earliest-filing pin).

## Root cause (confirmed from code)

`InsertHistoricalFundamentals` is `ON CONFLICT DO NOTHING` (earliest-filing pin) and the feature-216
existing-row path rewrites **only** the five price-join columns. No path ever rewrites a stored row's
statement-derived columns, so every row backfilled before feature 211 kept the total-liabilities D/E
(AXP Q2-2026 8.808 = 266,578 / 30,264), and every quarterly row keeps the pre-222 single-quarter ROE.
(Staging DB / deploy timeline not queried from this session; the code path admits no other outcome.)

## Approach

- Migration `008`: `fundamentals_history.derivation_version SMALLINT NOT NULL DEFAULT 0`.
- `edgar.DerivationVersion` (= 1: 211 D/E + 222 TTM ROE) stamped on every built period and written on
  insert.
- Backfill existing-row path: when `stored.derivation_version < period.DerivationVersion`, upgrade the
  statement-derived columns in place (`eps`, `roe`, `debt_to_equity`, `extra_metrics ||`), guarded in
  SQL by `derivation_version < $new` (idempotent, race-safe). `filed_date`, `currency`, price-join
  columns untouched. Then delete the symbol's cached `source='edgar'` snapshot row (@AC-2).
- Drift guard: a golden hash of the builder's output over a fixed fixture is pinned per version —
  changing derivation without bumping the version fails CI.

## Rejected

- Purge + re-backfill runbook only — drift silently recurs on the next derivation change.
- Unconditional `DO UPDATE` — overwrites the as-reported earliest filing (feature 198 @AC-1).
- Rewriting `currency` — would desync the stored price-join columns computed in the old currency.
