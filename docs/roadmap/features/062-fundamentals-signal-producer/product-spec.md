# Product Spec: fundamentals-signal-producer

**Created**: 2026-06-26
**Priority Bucket**: P2 — Fundamentals as a derived signal (5 of 6); depends on 059 + 063 (+058 universe)

---

## Problem Statement

Fundamentals (Feature 059) are usable as interactive screener criteria, but nothing turns them into a
**persistent, reusable, model-driven view** that participates in backtests and live alerts. A
"fundamentals signal" — emitted into the existing `ingest` pipeline — would, but the naive version
(re-fetch FMP per run) would exhaust the 250-call/day free tier instantly. We need a producer that is
correct *and* parsimonious with FMP calls.

## User Story

As a **systematic investor**, I want my fundamental valuation/quality model to publish a daily
`buy`/`sell`/`hold` signal per symbol, so that it automatically drives backtests, screens, and alerts
— without me re-running anything or blowing the FMP quota.

## Functional Requirements

FR-1. A **scheduled producer** in `xstockstrat-analysis` (reusing the existing engine interval loop,
config-driven), aligned to run **once per day after market close** — matching the EOD cadence of
fundamentals so a symbol is refreshed at most once/day.

FR-2. **Cache-mediated FMP access (the core budget rule):** the producer reads fundamentals **only**
via marketdata `GetFundamentalsMulti` (24h cache). It **never** calls FMP directly. Repeated runs
within the cache TTL cost ~0 FMP calls.

FR-3. **Universe dedup:** the scan universe is the **distinct union** of all watchlist symbols
(Feature 058) plus an optional explicit config list. A symbol in three watchlists is fetched once.
Fundamentals signals are **global** (not user-scoped), consistent with the existing newsletter-signal
model.

FR-4. **Paced, resumable queue with a budget reservation:** per-symbol extended-metric fetches are
paced to respect FMP per-second + daily limits; run progress is **persisted** so a failed/partial run
**resumes without re-spending calls** (mirrors the resumable-backfill pattern, Feature 054). A soft
`daily_call_budget` (default 200) **reserves headroom** under the 250 ceiling for interactive screener
use. When the budget would be exceeded, remaining symbols are **deferred to the next window and
logged** — never overshoot, never silent truncation.

FR-5. **Idempotent emit:** at most one signal per `(symbol, source, as_of_date)`. Re-running the same
day emits nothing new and spends no extra calls (uniqueness-guarded).

FR-6. **Score → signal mapping:** the composite score (0–1, from Feature 063) maps to `direction` by
cross-sectional quantile within the run (`≥ buy_quantile` → `buy`, `≤ sell_quantile` → `sell`, else
`hold`); `conviction` = the (normalized) score; signals below `min_conviction_to_emit` are dropped.
`valid_from` = run date; `valid_until` = `+valid_days` (default 90) or next earnings when available.

FR-7. **Source registration:** on startup/first run the producer **idempotently registers** the
`fundamentals` source via `ManageSignalSource` (admin-scoped) and ensures it has a weight in
`analysis.signals.source_weights`, so `IngestSignal`'s registry validation passes.

FR-8. **Manual trigger:** an additive `RunFundamentalsScan` RPC (admin-scoped) for on-demand/test runs
and a future UI button; returns a run summary (symbols processed, signals emitted, calls spent,
deferred count).

FR-9. **Observability:** each run writes ledger events (`analysis.fundsignal.run_started` /
`.run_completed`) and a notify alert if the run was budget-deferred.

## Out of Scope

- The scoring math itself (Feature 063 — consumed here via a formula_id with a trivial built-in
  default as fallback).
- Historical/point-in-time fundamentals (we forward-accumulate; see Acceptance #6).
- Per-user signals.
- Intraday cadence.
- Earnings-calendar-driven validity unless the endpoint is on the active FMP tier.
- A UI (the `RunFundamentalsScan` button is a later add).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — owns the producer + run-state + `RunFundamentalsScan`.
- `xstockstrat-marketdata` — cached `GetFundamentalsMulti` consumer.
- `xstockstrat-ingest` — `IngestSignal` write + `ManageSignalSource` (**new analysis→ingest write
  edge, via RPC not DB**).
- `xstockstrat-portfolio` — read watchlist universe (or resolved by config).
- `xstockstrat-config` — new `analysis.fundsignal.*` keys.
- `xstockstrat-ledger` / `xstockstrat-notify` — run events / deferred-budget alerts.

## Proto Contract Changes

- **Changes required (additive → non-breaking):**
  - `packages/proto/analysis/v1/analysis.proto` — `RunFundamentalsScan(RunFundamentalsScanRequest)
    returns (FundamentalsScanSummary)` (admin-scoped manual trigger; returns symbols processed,
    emitted, calls spent, deferred count).

## Config Key Changes

| Key | Type | Default |
|---|---|---|
| `analysis.fundsignal.enabled` | bool | `false` |
| `analysis.fundsignal.run_interval_hours` | int | `24` |
| `analysis.fundsignal.universe_source` | string | `watchlists` (`watchlists`\|`explicit`\|`both`) |
| `analysis.fundsignal.explicit_symbols` | string (CSV) | `""` |
| `analysis.fundsignal.max_symbols_per_run` | int | `200` |
| `analysis.fundsignal.daily_call_budget` | int | `200` |
| `analysis.fundsignal.source_slug` | string | `fundamentals` |
| `analysis.fundsignal.scoring_formula_id` | string | `""` (empty → built-in default; 063 supplies the real one) |
| `analysis.fundsignal.buy_quantile` | float | `0.80` |
| `analysis.fundsignal.sell_quantile` | float | `0.20` |
| `analysis.fundsignal.min_conviction_to_emit` | float | `0.0` |
| `analysis.fundsignal.valid_days` | int | `90` |

## Database Changes

New migrations in `services/xstockstrat-analysis/migrations/` (next free numbers after the existing
`001_strategies` / `002_strategy_live_enabled`; each with an up+down pair — exact NNN confirmed at
/sdd-spec):
- `003_fundsignal_runs.up.sql` / `.down.sql` — `analysis.fundsignal_runs(run_id uuid PK, started_at,
  finished_at, status, symbols_total, symbols_done, calls_spent, deferred_count)` — resumability +
  budget accounting.
- `004_fundsignal_emitted.up.sql` / `.down.sql` — `analysis.fundsignal_emitted(symbol text, source text,
  as_of_date date, signal_id bigint, score numeric, direction text,
  PRIMARY KEY(symbol, source, as_of_date))` — **idempotency guard** (FR-5).
- The fundamentals *values* are **not** re-cached here — they live in `marketdata.fundamentals`
  (Feature 059). **No new DB pool** (reuses analysis's existing asyncpg pool; budget unchanged at 2).

## Feature Workflow Notes

Branch to create: `feature/fundamentals-signal-producer` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (additive proto change)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, all additive
- [x] DBA review + service owner (run-state migrations)
- [x] config team (new keys) + ingest owner (new signal source + analysis→ingest write edge)

**Depends on** 059 (cached fundamentals) and 063 (scoring model; trivial built-in default if 063
slips). 058 optional (for the watchlist-driven universe; otherwise an explicit config list).

## Acceptance Criteria

1. With `enabled=true` and a 3-symbol universe, a run reads fundamentals via marketdata, scores them,
   and emits one signal per symbol with sensible `direction`/`conviction`; **re-running the same day
   emits nothing new and issues zero additional FMP calls** (cache + idempotency).
2. **Producer never calls FMP directly** — proven by a test where marketdata is the only component
   with an FMP transport; the producer mocks `GetFundamentalsMulti`.
3. A symbol present in two watchlists is fetched once (dedup).
4. With `daily_call_budget` set low, the run processes up to budget, **defers and logs the
   remainder**, and a subsequent run resumes the deferred symbols — no overshoot of the FMP cap.
5. Emitted signals are returned by `QuerySignals(source="fundamentals")` and visibly change a
   backtest's combined score via `analysis.signals.source_weights`.
6. **Forward-test property:** running the producer on consecutive days accumulates point-in-time
   signals; a backtest over the accumulated window consumes them with no look-ahead (today's
   fundamentals never leak into past dates).

## Resolved Decisions

- [x] **Producer in `xstockstrat-analysis`** (OQ-062-a): it has the interval-loop scheduler and
  orchestrates marketdata + indicators + ingest; writes via the `IngestSignal` RPC (not ingest's DB).
- [x] **Universe = distinct union of all watchlist symbols (global) + optional explicit list**
  (OQ-062-b): signals are global, like newsletter signals.
- [x] **`valid_until` = fixed `valid_days` (90) for v1** (OQ-062-c): next-earnings is an enhancement
  gated on the FMP earnings endpoint being on the active tier.
- [x] **Cross-sectional quantile direction** (OQ-062-d): relative buy/sell within each run.
- [x] **Producer soft cap 200 / reserve 50 for the screener** (OQ-062-e): both config-tunable, total
  ≤ `marketdata.fmp.daily_request_cap` (250).

## Open Questions

- [ ] None — all resolved during design (see Resolved Decisions).
