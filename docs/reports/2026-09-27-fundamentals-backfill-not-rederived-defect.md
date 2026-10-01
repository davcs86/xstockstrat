# Defect: historical fundamentals price-join is never re-derived, so bars that arrive after a fundamentals backfill leave price-derived metrics permanently missing

**Recorded**: 2026-09-27
**Severity**: SEV-3
**Impact type**: missing-fundamentals-metrics
**Environment**: dev (staging / main-dev)
**Affected service(s)**: xstockstrat-marketdata (root); xstockstrat-ingest (backfill orchestration ordering)
**Config-only fix possible**: no

## Observed

Backfilling a symbol's point-in-time fundamentals **before** its daily OHLCV bars exist leaves every
price-derived metric (`price`, `market_cap`, `pe_ratio`, `pb_ratio`, `dividend_yield`) `missing` on
all of that symbol's `fundamentals_history` periods — and re-running the fundamentals backfill
afterward, even with `overwrite=true`, does **not** fix them.

Concretely, in staging (feature 211 rollout audit):
1. `trigger_backfill(["JNJ"], data_kind=fundamentals)` was run while JNJ had no daily bars. Every JNJ
   period came back with `dividend_yield`/`price`/`market_cap`/`pe_ratio`/`pb_ratio` in
   `missing_metrics` (only the price-independent metrics — `eps`, `roe`, financial-debt
   `debt_to_equity` — populated).
2. `trigger_backfill(["JNJ"], data_kind=bars)` then stored 250 daily bars from Alpaca.
3. `trigger_backfill(["JNJ"], data_kind=fundamentals, overwrite=true)` completed (40 periods) — and
   the JNJ periods were **still unchanged**: price-derived metrics still `missing`.

The same fingerprint appears on older AAPL/MSFT/KO periods (pre-feature-211 rows carrying the old
liabilities-based `debt_to_equity` and no `dividend_yield`) that a fresh feature-211 backfill did not
replace.

Two coupled root behaviors:
- **(1) Insert-only fundamentals write.** `InsertHistoricalFundamentals` uses `ON CONFLICT (symbol,
  fiscal_period, period_type) DO NOTHING`, so an existing period is never updated by a re-backfill.
  `trigger_backfill`'s `overwrite=true` only governs the **bars** fetch; it does not reach the
  historical-fundamentals write, so there is no path to re-derive an existing period.
- **(2) One-shot price-join, ordering-sensitive.** The price-join (and the T12M dividend-yield
  compute) runs inline in `backfillOneSymbol` at insert time against whatever bars exist then. If
  bars are absent, the metrics are left nil (correct fail-closed), but combined with (1) there is no
  recovery once bars later arrive.

## Expected

Re-running a fundamentals backfill for a symbol (especially with `overwrite=true`) after its bars are
available should re-derive and persist the price-join metrics (`price`, `market_cap`, `pe_ratio`,
`pb_ratio`, `dividend_yield`) for the affected periods — i.e. the write should be an idempotent
upsert, or `overwrite=true` should extend to the fundamentals path. Equivalently, backfill
orchestration should fetch bars before (or alongside) fundamentals so the price-join lands on the
first pass. Fail-closed on genuinely-missing bars is fine; a permanent, unrecoverable gap after bars
exist is not.

## Reproduction

1. Pick a symbol with no stored daily bars (e.g. JNJ in staging).
2. `trigger_backfill([sym], data_kind=fundamentals)` → `query_fundamentals(sym, mode=historical)`:
   `price`/`market_cap`/`pe_ratio`/`pb_ratio`/`dividend_yield` are in `missing_metrics` on every period.
3. `trigger_backfill([sym], data_kind=bars, timeframe=1d)` → confirm bars stored.
4. `trigger_backfill([sym], data_kind=fundamentals, overwrite=true)` → wait for COMPLETED.
5. `query_fundamentals(sym, mode=historical)` again → the price-derived metrics are **still** missing.

## Evidence

`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:610`
> ON CONFLICT (symbol, fiscal_period, period_type) DO NOTHING

`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:593`
> // InsertHistoricalFundamentals persists one point-in-time period. ON CONFLICT DO NOTHING keeps the

`services/xstockstrat-marketdata/internal/service/marketdata_service.go:1794`
> s.priceJoin(ctx, p, &quarterlyEPS)

(price-join + the T12M dividend-yield compute run inline per period in `backfillOneSymbol`, `:1762`,
against bars present at insert time only.)

## Root cause hypothesis

`InsertHistoricalFundamentals`' `DO NOTHING` conflict clause makes the historical-fundamentals write
insert-only, and `trigger_backfill`'s `overwrite` flag is not plumbed through to it, so a period
computed once with no price bars can never be re-derived. The price-join being a one-shot at insert
time (rather than a read-time or re-runnable derivation) is what makes ingestion order load-bearing.

## Confidence

high
