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

**Who is affected.** A trader or analyst reading `fundamentals_gap` (agent `run_backtest` summary, UI backtest
diagnostics, `list_opportunities`) cannot tell that an ETF was refused because it is an ETF. An operator
reading marketdata logs at the normal Info level cannot see why the fill never labels it.

**Expected.**
- After a first miss, the best-effort fill labels the symbol once the FMP budget allows, and a later run
  reports `FUNDAMENTALS_GAP_ETF` for an ETF.
- When the fill is skipped (gate closed) or fails (vendor error), the reason is visible at the service's
  normal log level, rate-limited, carrying the enqueuing request's `trace_id`.
- When the FMP profile has no `isEtf` value (the 30-day negative-cached case), that is visible too (FR-3).
- The over-counted FMP day-budget seed (the primary hypothesis below) is fixed by
  `255-fix-marketdata-fundamentals-cache` (D-51, its FR-2 / `@AC-3`), not by this feature. 230 lands after 255
  (operator decision 2026-10-22).

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
- **Operator logs:** new rate-limited Info lines `etf flag fill skipped`, `etf flag fill failed` and
  `etf flag fill unlabelled`.

No proto, UI text or agent-tool contract changes.

## Functional Requirements

- **FR-1 — An ETF missed once is labelled on a later call once budget allows.** With the FMP boot seed counting
  only FMP-sourced rows (delivered by 255), a symbol that missed the ETF-flag cache is enqueued, the background
  filler fetches its FMP profile while the gate is open, and a later `GetEtfFlags` call for that symbol returns
  `is_etf = true` for an ETF. Existing gate semantics (80% of `marketdata.fmp.daily_request_cap`) are unchanged.
- **FR-2 — A skipped or failed fill is visible at Info level, rate-limited, and never logs raw error text.** When
  the filler skips a symbol because the gate is closed, or the FMP profile fetch fails, marketdata emits a record at
  Info level or higher naming the symbol and the reason: `gate closed` with used/cap, or the error **class** only
  (e.g. timeout, HTTP status, decode). It never logs the raw error string, because `FetchIsEtf` errors can carry the
  `apikey=` URL until `254-fix-marketdata-secret-exposure` lands. Repeated records are rate-limited to at most one
  per one-minute window. The window is a fixed code constant, not a config key. Each record carries the
  originating request's `trace_id` when present (the trace of the `GetEtfFlags` call that enqueued the symbol;
  operator 2026-10-21 / round-2 gate). Rate-limit keys (design.md § Chosen Approach 3): config reasons
  (`not_wired`, `fmp_disabled`, `no_cap`) log on change only; `budget` logs on change or once per window; failures
  log once per window **per class**; `class` is never empty (fallback `other`, operator round-3 gate).
- **FR-3 — An empty FMP profile is visible at Info level, rate-limited** (operator round-2 gate steer, 2026-10-22).
  When `FetchIsEtf` returns `(nil, nil)`, marketdata emits an Info record `etf flag fill unlabelled` carrying the
  symbol and `trace_id` only, at most once per one-minute window in its own slot. Caching is unchanged: the entry
  is still negative-cached for the 30-day TTL (215 `@AC-14`).

| FR | Acceptance scenarios |
|---|---|
| FR-1 | `@AC-2` |
| FR-2 | `@AC-3`, `@AC-5`, `@AC-6`, `@AC-7` |
| FR-3 | `@AC-4`, `@AC-6` |

The seed-count regression (the former `@AC-1`) is owned and tested by 255 `@AC-3`; 230 no longer carries it.
215's `@AC-14` gate tests (`etf_flags_test.go`) must keep passing (C-16).

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated (the rate-limit window is a code constant)
- Changes are confined to the ETF-flag filler (`internal/service/etf_flags.go`) and its tests, one exported
  classifier name (`fmp.ErrorClass`, wrapping 255's `enrichmentClass`) in `internal/fmp/fmp_client.go`, and the
  marketdata `CLAUDE.md` `GetEtfFlags` paragraph. The FMP boot seed,
  `CountFundamentalsFetchedToday`, and FMP-provider quota semantics are not touched by 230 (255 owns them).

## Open Questions

- ~~Rate-limit key~~ — **resolved at /sdd-design** (design.md § Chosen Approach 3): a skip slot (config reasons
  on change; `budget` on change or once per window), a per-class fail slot, and an unlabelled slot. Pinned in
  `@AC-6`.
- **Hypothesis 3 (empty profile negative-cached for 30 days):** if confirmed from the staging logs, does the
  30-day negative TTL for an empty profile need to change? Out of 230's narrowed scope unless design finds it is
  the live cause; if so, raise it with the operator before widening scope.
- **Root cause confirmation:** confirm from the marketdata logs (now visible via FR-2) whether 255's seed fix alone
  restores labelling on staging.

## Acceptance Criteria

See `acceptance.feature` (Constitution **C-15**). `@AC-3`–`@AC-7` fail on the current code (fill skips are silent,
fetch errors are Debug-only and carry the raw error, empty profiles are silent, and no record carries `trace_id`).
`@AC-2` is a regression guard over the gate-closed → reopened path; it passes on trunk (P-06 waiver recorded at
execute) — the "fails before 255" seed half is owned by 255 `@AC-3`. Also, existing tests pass, and on dev Step 26(a) of feature 215 reports
`FUNDAMENTALS_GAP_ETF` for SCHD after a first miss.

## Out of Scope

- Persisting the ETF cache across restarts (the in-memory design is feature 215's choice).
- Changing the 80% headroom threshold or the FMP daily cap.
- Refactoring unrelated to the bug.
