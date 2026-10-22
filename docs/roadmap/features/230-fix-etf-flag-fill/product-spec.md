# Product Spec: fix-etf-flag-fill

**Type**: bug
**GitHub Issue**: n/a (Issues disabled) — defect report `docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-15

---

## Problem Statement

**Observed.** On staging (deployment `63d315a4`, image `a8a3cfd`),
`run_backtest(fundamentals_macd_blend, ["SCHD"])` correctly refuses SCHD, but `fundamentals_gap` stays
`FUNDAMENTALS_GAP_UNSPECIFIED`. This held on repeat runs on one process (`8c164af5…` at 16:07:07Z and
`88b11ccc…` at 16:08:01Z), each after an earlier miss that should have enqueued the background fill. No
Info-level log line explains why the fill did not populate the cache.

**Expected.**
- After a first miss, the best-effort fill labels the symbol, and a later run reports
  `FUNDAMENTALS_GAP_ETF` for an ETF.
- The FMP day-budget seed counts only rows that cost an FMP call.
- When the fill is skipped (gate closed) or fails (vendor error), the reason is visible at the service's
  normal log level, rate-limited.

## Reproduction Steps

1. On staging, call `run_backtest(fundamentals_macd_blend, ["SCHD"], start="2026-01-01", end="2026-09-30")`.
2. Wait ≥ 60 s, then repeat.
3. Both calls return `fundamentals_gap: FUNDAMENTALS_GAP_UNSPECIFIED`.

## Root Cause Hypothesis

Not confirmed: the staging run logs were not readable from the triage session. All references are to
`services/xstockstrat-marketdata` on `main-dev` `a8a3cfdc`.

1. **Primary: the 80% gate is closed by an over-counted boot seed.**
   - `etfFillAllowed` (`internal/service/etf_flags.go`) requires FMP used < 80% of
     `marketdata.fmp.daily_request_cap` (staging: 250).
   - `cmd/server/main.go` seeds `used` from `MarketDataRepo.CountFundamentalsFetchedToday`, an
     unfiltered `count(*)` over today's `marketdata.fundamentals` rows.
   - That table also receives non-FMP snapshots: Finnhub (`source='finnhub'`) and EDGAR-derived
     (`edgarSnapshotFromPeriod`). Staging logs show a steady flood of
     `edgar snapshot not producible — falling back to vendor` (each a Finnhub fetch plus upsert), which
     makes ≥ 200 rows per day plausible.
2. **Alternative: `FetchIsEtf` errors**, logged only at `slog.DebugContext` ("etf flag fill failed").
3. **Alternative: an empty FMP profile**, negative-cached as unset for the 30-day TTL.

## Affected Services

- xstockstrat-marketdata (fix site).
- xstockstrat-analysis consumes `GetEtfFlags` unchanged.

## Consumer Surface(s)

- **Backtest result `fundamentals_gap`** (proto `analysis.v1`): the agent `run_backtest` summary and the
  UI backtest diagnostics. It moves from `UNSPECIFIED` to `ETF` for ETFs once the fill works.
- **`list_opportunities` `fundamentals_gap`** on skip rows: same effect.
- **Operator logs:** new rate-limited Info/Warn lines for a skipped or failed fill.

No proto, UI text or agent-tool contract changes.

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated (the seed query can filter on the existing `source` column)
- [x] No config key changes anticipated

(Update after investigation: confirm the cause from the marketdata logs first.)

## Acceptance Criteria

See `acceptance.feature`: regression scenarios that must fail on the buggy behavior and pass after the
fix (Constitution **C-15**). Also, existing tests pass, and on dev Step 26(a) of feature 215 reports
`FUNDAMENTALS_GAP_ETF` for SCHD after a first miss.

## Out of Scope

- Persisting the ETF cache across restarts (the in-memory design is feature 215's choice).
- Changing the 80% headroom threshold or the FMP daily cap.
- Refactoring unrelated to the bug.
