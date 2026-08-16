# Product Spec: fix-fundamentals-upsert-invalid-json

**Type**: bug
**GitHub Issue**: n/a — see `docs/reports/2026-08-16-marketdata-fundamentals-upsert-invalid-json-defect.md`
**Severity**: SEV-3
**Created**: 2026-08-16

---

## Problem Statement

`GetFundamentalsMulti: cache upsert failed symbol=UPRO error="upsert fundamentals UPRO: ERROR:
invalid input syntax for type json (SQLSTATE 22P02)"` — UPRO's fundamentals never persist to the
DB cache, so it's re-fetched from the provider on every request instead of being served from cache.

Expected: `UpsertFundamentals` succeeds for every symbol the fundamentals source returns,
including ETFs like UPRO where some fundamental fields don't apply.

## Reproduction Steps

1. Request fundamentals for UPRO (a leveraged ETF) via `GetFundamentalsMulti`.
2. Observe the WARN in `xstockstrat-marketdata` RUN logs.

## Root Cause Hypothesis

`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:300-332`
(`UpsertFundamentals`) marshals `f.ExtraMetrics` to JSON via `json.Marshal` and writes it to a
Postgres `json`-typed column. Something in the value the fundamentals source (Finnhub, added by
`fundamentals-provider-alternative`/PR #930, or the pre-existing FMP path) returns for UPRO
produces a payload Postgres rejects — plausibly a metric that's inapplicable to an ETF (e.g. a
NaN/Inf float, which `encoding/json` itself would normally reject before this point, or an
unexpected non-scalar shape). Not yet isolated to a specific field. Confidence: low.

## Affected Services

- `xstockstrat-marketdata` (Go) — `internal/repository/marketdata_repo.go`

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

- [ ] `UpsertFundamentals` succeeds for UPRO (and other ETF/non-standard symbols exercised in
      tests)
- [ ] A regression test reproduces the exact malformed payload and proves the fix rejects/sanitizes
      it before it reaches Postgres, rather than persisting bad data
- [ ] Existing `xstockstrat-marketdata` Go tests pass

## Out of Scope

- Any change to which fundamentals provider (FMP vs Finnhub) is used
- General fundamentals data-quality validation beyond what's needed to stop the upsert failure
