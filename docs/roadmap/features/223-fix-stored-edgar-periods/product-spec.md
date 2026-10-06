# Product Spec: fix-stored-edgar-periods

**Type**: bug
**GitHub Issue**: n/a — defect report `docs/reports/2026-10-06-edgar-stored-de-predates-financial-debt-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-06

---

## Problem Statement

Observed: every AXP historical EDGAR period on staging (Q2-2025 … Q2-2026, including Q2-2026 filed
2026-07-24) has `debt_to_equity` ≈ 8.6–9.8; Q2-2026's 8.808 equals `liabilities / stockholders_equity`
(266,578M / 30,264M) — the pre-feature-211 total-liabilities ratio. Feature 211 `@AC-3` specifies AXP's
financial-debt D/E ≈ 1.73 (< `de_bad` 2.0). At 8.8 the fundamentals formula's D/E sub-score is 0.0.

Expected: stored periods and the EDGAR snapshot cache reflect the launched financial-debt D/E
(`total_debt / equity`), so AXP reads ≈ 1.73 per 211 `@AC-3`, and the condition cannot silently recur
the next time the period derivation changes.

## Reproduction Steps

1. Agent tool `query_fundamentals(symbol="AXP", mode="historical", range_start="2025-06-01")`.
2. Observe `debt_to_equity` ≈ 8.6–9.8 on every row; compare with `liabilities / stockholders_equity`
   from the snapshot's `extra_metrics`.

## Root Cause Hypothesis

Under investigation — see context.md. Leading hypothesis: historical rows were backfilled before
feature 211 deployed and the earliest-filing idempotency pin keeps first-written values, so the new
derivation (`edgar_client.go:408-411`) never reached existing periods; feature 211 recorded
"manual purge + re-backfill" only as a residual for amendments (`211/design.md:26-28`). Verify against
the DB and deploy timeline first.

## Affected Services

xstockstrat-marketdata

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed.) Likely an operational
re-derivation (purge + re-backfill) plus a guard that makes derivation-version drift detectable;
coordinate the re-backfill with `222-fix-edgar-quarterly-roe` so it runs once, after both fixes.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Changing the feature-211 financial-debt D/E definition itself
- Sector-specific `de_bad` thresholds (delivered via feature 217 `@AC-14`)
