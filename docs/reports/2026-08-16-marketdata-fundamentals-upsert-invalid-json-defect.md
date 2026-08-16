# Defect: Fundamentals cache upsert fails for UPRO — invalid JSON

**Recorded**: 2026-08-16
**Severity**: SEV-3
**Impact type**: fundamentals-cache-write-failure
**Environment**: staging (xstockstrat-staging)
**Affected service(s)**: xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

`GetFundamentalsMulti: cache upsert failed symbol=UPRO error="upsert fundamentals UPRO: ERROR:
invalid input syntax for type json (SQLSTATE 22P02)"`. UPRO's fundamentals never persist to
cache, so it's re-fetched from the provider on every request.

## Expected

`UpsertFundamentals` succeeds for every symbol the fundamentals source returns.

## Reproduction

1. Request fundamentals for UPRO (a leveraged ETF) via `GetFundamentalsMulti`.
2. Observe the WARN in xstockstrat-marketdata RUN logs.

## Evidence

`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:300-332` —
`UpsertFundamentals` marshals `f.ExtraMetrics` to JSON and writes it; something in the value
Finnhub/FMP returns for UPRO produces a payload Postgres's `json` column type rejects.

## Root cause hypothesis

UPRO is a leveraged ETF — likely returns a metric value (NaN/Inf, or a non-scalar) for a
fundamental field that doesn't apply to ETFs, from the Finnhub source added by
`fundamentals-provider-alternative` (PR #930, 2026-08-12) or the pre-existing FMP path. Not yet
isolated to a specific field. Unrelated to 131/132/133/134/022/138 — none of those touch
`xstockstrat-marketdata`.

## Confidence

low
