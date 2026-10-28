# Defect: The background fill does not label SCHD as an ETF on staging, and the cause is not observable

**Recorded**: 2026-10-15
**Severity**: SEV-3
**Impact type**: observability / degraded-label
**Environment**: dev (staging app `xstockstrat-staging`, deployment `63d315a4`, image `a8a3cfd`)
**Affected service(s)**: xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

Feature 215 Step 26(a) on staging: `run_backtest(fundamentals_macd_blend, ["SCHD"])` correctly refuses SCHD with
`BACKTEST_STATUS_INSUFFICIENT_DATA` / `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE`. However, `fundamentals_gap` stays
`FUNDAMENTALS_GAP_UNSPECIFIED`, including on runs `8c164af5-ecee-4cc9-9e31-97c34ed502b1` (16:07:07Z) and
`88b11ccc-8232-4309-9ee0-69c4faeaa99a` (16:08:01Z). Both ran on the same marketdata process, which went ACTIVE at
16:04:57Z, and both came after an earlier miss. That earlier miss should have enqueued the background fill.

## Expected

After the first miss, the best-effort fill populates SCHD's flag, and a later run reports `FUNDAMENTALS_GAP_ETF`. If
the fill cannot run, an operator can see why at the service's normal log level.

## Reproduction

1. On staging, call `run_backtest(fundamentals_macd_blend, ["SCHD"], start="2026-01-01", end="2026-09-30")`.
2. Wait ≥ 60 s, then repeat it.
3. Both calls return `fundamentals_gap: FUNDAMENTALS_GAP_UNSPECIFIED`.

## Evidence

All references are to code on `main-dev` `a8a3cfdc`.
- **The fill is cache-only and best-effort.** `services/xstockstrat-marketdata/internal/service/etf_flags.go`:
  `GetEtfFlags` enqueues a miss, and `fillEtfFlag` then:
  - returns silently when `etfFillAllowed()` is false;
  - logs a `FetchIsEtf` error only at `slog.DebugContext` ("etf flag fill failed");
  - caches a nil (empty-profile) flag as unset for the 30-day TTL.
- **The gate's input over-counts.** `etfFillAllowed` requires used < 80% of `marketdata.fmp.daily_request_cap`
  (staging: 250, so 200). `cmd/server/main.go` boot-seeds `used` from
  `MarketDataRepo.CountFundamentalsFetchedToday`, an unfiltered `count(*)` over `marketdata.fundamentals` rows fetched
  today. Rows also land in that table from non-FMP sources, all through `UpsertFundamentals`:
  - vendor snapshots tagged `source='finnhub'` (`internal/finnhub/finnhub_client.go`), written by `GetFundamentals` /
    `GetFundamentalsMulti`;
  - EDGAR-derived snapshots tagged `snapshotSourceEdgar` (`edgarSnapshotFromPeriod`).

  Staging runs `marketdata.fundamentals.snapshot_source=edgar` and `marketdata.fundamentals.provider=finnhub`, so
  non-FMP fetches consume the FMP budget seed. PIT history rows go to `marketdata.fundamentals_history` and are not
  counted.
- **Config and credentials look consistent.** `get_config("marketdata")` shows `marketdata.fmp.enabled=true` and
  `daily_request_cap=250`. The secret rows `fmp.api_key` etc. match `resolveSecret` key strings, so this is not a
  CONFIG-9 mismatch.
- **Not observable from this session.** The run logs were unavailable: the DO log URL carries a token and fetching it
  was denied, and DO Insights log search returned no App Platform lines.

## Root cause hypothesis

One of:
- (1) The 80% gate is closed because the boot seed counts EDGAR/Finnhub rows as FMP calls. This is the likeliest:
  the code over-count is proven, but the staging count today is unverified.
- (2) `FetchIsEtf` errors (credential, plan or vendor error), logged only at Debug.
- (3) FMP returns an empty profile for SCHD, which is then negative-cached for 30 days.

In all three cases nothing is emitted at Info level, so an operator cannot tell them apart.

## Suggested next steps

1. Read the marketdata run logs on deployment `63d315a4` (FMP budget/quota lines; "FMP budget boot-seed failed").
   Count today's `marketdata.fundamentals` rows by `source` to confirm or refute (1).
2. Count only FMP-sourced rows in the boot seed (`source IN ('fmp','edgar+fmp')`, or whichever rows actually cost an
   FMP call). Raise the gate-closed and fill-error paths to a rate-limited Info/Warn log.
3. Re-run Step 26(a) of feature 215 after the fix.
