# Product Spec: fix-historical-fundamentals-price-join

**Type**: bug
**Defect Report**: `docs/reports/2026-09-27-fundamentals-backfill-not-rederived-defect.md`
**Severity**: SEV-3
**Created**: 2026-09-27

---

## Problem Statement

**Observed:** Backfilling a symbol's point-in-time fundamentals **before** its daily OHLCV bars exist
leaves every price-derived metric (`price`, `market_cap`, `pe_ratio`, `pb_ratio`, `dividend_yield`)
`missing` on all of that symbol's `fundamentals_history` periods — and re-running the fundamentals
backfill afterward, even with `overwrite=true`, does **not** fix them. Only the price-independent
metrics (`eps`, `roe`, financial-debt `debt_to_equity`) populate. The same fingerprint appears on
older AAPL/MSFT/KO periods that a fresh feature-211 backfill did not replace.

**Expected:** Re-running a fundamentals backfill for a symbol (especially with `overwrite=true`) after
its bars are available should re-derive and persist the price-join metrics for the affected periods —
i.e. the write should be an idempotent upsert, or `overwrite=true` should extend to the fundamentals
path; equivalently, backfill orchestration should fetch bars before/alongside fundamentals so the
price-join lands on the first pass. Fail-closed on genuinely-missing bars is fine; a permanent,
unrecoverable gap after bars exist is not.

**Two coupled root behaviors:**
1. **Insert-only fundamentals write.** `InsertHistoricalFundamentals` uses `ON CONFLICT (symbol,
   fiscal_period, period_type) DO NOTHING`, so an existing period is never updated by a re-backfill.
   `trigger_backfill`'s `overwrite=true` only governs the **bars** fetch; it does not reach the
   historical-fundamentals write, so there is no path to re-derive an existing period.
2. **One-shot price-join, ordering-sensitive.** The price-join (and the T12M dividend-yield compute)
   runs inline in `backfillOneSymbol` at insert time against whatever bars exist then. If bars are
   absent, metrics are left nil (correct fail-closed), but combined with (1) there is no recovery once
   bars later arrive.

## Reproduction Steps

1. Pick a symbol with no stored daily bars (e.g. JNJ in staging).
2. `trigger_backfill([sym], data_kind=fundamentals)` → `query_fundamentals(sym, mode=historical)`:
   `price`/`market_cap`/`pe_ratio`/`pb_ratio`/`dividend_yield` are in `missing_metrics` on every period.
3. `trigger_backfill([sym], data_kind=bars, timeframe=1d)` → confirm bars stored.
4. `trigger_backfill([sym], data_kind=fundamentals, overwrite=true)` → wait for COMPLETED.
5. `query_fundamentals(sym, mode=historical)` again → the price-derived metrics are **still** missing.

## Root Cause Hypothesis

`InsertHistoricalFundamentals`' `DO NOTHING` conflict clause makes the historical-fundamentals write
insert-only, and `trigger_backfill`'s `overwrite` flag is not plumbed through to it, so a period
computed once with no price bars can never be re-derived. The price-join being a one-shot at insert
time (rather than a read-time or re-runnable derivation) is what makes ingestion order load-bearing.
Confidence: **high**.

Evidence:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:610` — `ON CONFLICT (symbol, fiscal_period, period_type) DO NOTHING`
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:593` — `InsertHistoricalFundamentals` doc comment
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go:1794` — `s.priceJoin(ctx, p, &quarterlyEPS)` (inline per-period)
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go:1762` — `backfillOneSymbol` (price-join + T12M dividend-yield compute against bars present at insert time only)

## Affected Services

- **xstockstrat-marketdata** (root) — insert-only historical-fundamentals write + one-shot inline price-join
- **xstockstrat-ingest** — backfill orchestration ordering (bars-before-fundamentals sequencing)

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed. The `overwrite` semantics for the
fundamentals path, and whether re-derivation is a write-time upsert or a read-time projection, are
open design questions for `/sdd-design`.)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
