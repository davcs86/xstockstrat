# Product Spec: fix-historical-fundamentals-price-join

**Type**: bug
**Defect Report**: `docs/reports/2026-09-27-fundamentals-backfill-not-rederived-defect.md` (pruned 2026-10-05; `git show 2ce8de0a:docs/reports/2026-09-27-fundamentals-backfill-not-rederived-defect.md`)
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

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

The fix is a SQL-write / backfill-orchestration change: the price-derived columns (`price`,
`market_cap`, `pe_ratio`, `pb_ratio`, `dividend_yield`) already exist in the
`marketdata.fundamentals_history` INSERT (`marketdata_repo.go:604-608`), so no schema migration is
needed; `overwrite` is a `TriggerBackfill` **request parameter**, not a `<service>.<category>.<key>`
config key; and no `.proto` contract changes. The remaining *design* forks — write-time column-scoped
upsert vs. read-time projection, and whether/how `overwrite` is plumbed to the fundamentals path vs.
reordering backfill orchestration (bars-before-fundamentals) — are deferred to `/sdd-design`, not the
governance scope above.

### Design constraints (must be honored by `/sdd-design` and the fix)

- **C-16 — preserve feature-198 idempotency (`@AC-1`/`@AC-2`).** The `ON CONFLICT (symbol,
  fiscal_period, period_type) DO NOTHING` clause at `marketdata_repo.go:610` is **deliberate**
  (`:593-595`): it keeps the as-reported filing (earliest `filed_date`) so a same-range re-backfill
  never duplicates and a later 10-K comparative never overwrites — enforcing feature-198
  `docs/roadmap/features/198-historical-fundamentals-backtest/acceptance.feature:11,18`. Any fix must
  re-derive **only** the price-join metrics and must NOT clobber as-reported fields or the earliest
  `filed_date`. A column-scoped upsert or a read-time projection both satisfy this; a blanket
  `DO UPDATE SET ...` (whole-row) would regress feature 198.
- **Derivation-convention parity across the two price-join lanes.** Two lanes compute the price-join:
  the historical lane (`backfillOneSymbol`, the buggy one) and the live EDGAR-snapshot lane (which
  re-derives every call and does not have this bug). The fix must keep the derivation convention
  consistent across both; `/sdd-design` should confirm parity.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
