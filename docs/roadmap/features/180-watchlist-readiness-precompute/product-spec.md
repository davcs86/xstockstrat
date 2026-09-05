# Product Spec: watchlist-readiness-precompute

**Created**: 2026-09-05

---

## Problem Statement

Opening the watchlist/stock-list page (`/insights/watchlists`) is slow because the per-symbol
strategy readiness overlay recomputes end-to-end on the synchronous UI render path whenever the
30s `readiness_cache` window has lapsed. For a returning user (any open >30s after the last
evaluation) this means, per bound symbol: a ~400-day OHLCV pull from marketdata, indicator-component
computation, and entry-rule conviction scoring — with bars-fetch concurrency capped at 2. Latency
therefore scales with symbol count and the user waits through it every time.

## User Story

As a trader opening the watchlist/stock-list page, I want the per-symbol strategy readiness overlay
to load fast even for large watchlists, so that I don't wait through an end-to-end recompute every
time I open the page.

## Diagnosis (traced this session)

- **Watchlist fetch is cheap.** `PortfolioService.ListWatchlists`
  (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1443-1462`) and
  `GetWatchlist` (`:1430-1440`) are DB-only reads with no fan-out.
- **The overlay is the cost.** `WatchlistDetail.tsx:355` renders `<WatchlistReadiness>`, which
  (`services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx:186-202`) issues **one
  `AnalysisService.EvaluateReadiness({ strategyId, symbols })` per distinct bound strategy** via
  `useQueries` (client `staleTime: 30_000` at `:200`).
- **`EvaluateReadiness` recomputes on cache miss.** Handler at
  `services/xstockstrat-analysis/app/handlers/servicer.py:2709`; per-symbol `_readiness_for()`
  (`:2778-2819`) runs via `asyncio.gather` (`:2821`). FAST path returns the `readiness_cache` row
  when `def_fingerprint` matches and `now < valid_until` (`:2780-2785`); SLOW path
  (`:2786-2819`) fetches ~400 days of bars (`_READINESS_LOOKBACK`, `:247-248`) gated by
  `self._bars_fetch_sem` (default 2, `analysis.opportunity.max_concurrent_bars_fetches`), evaluates
  conditions, and writes back to cache (`:2826-2830`).
- **Cache window is 30s** (`analysis.readiness.stale_after_seconds`, `servicer.py:2757`; feature 177).
- **Not a full backtest** — `RunBacktest`/`ScoreStrategy` are off this path. The "scoring" is the
  deterministic conviction ordinal (passing/total rule leaves), but producing it still requires the
  marketdata pull + indicator computation.

## Functional Requirements

FR-1. Readiness rows for watchlist-bound (symbol, strategy) pairs are materialized into
`analysis.readiness_cache` by a **background process**, so that a subsequent `EvaluateReadiness`
call for those pairs is served entirely from the FAST (cache-hit) path with no synchronous
marketdata pull, indicator computation, or rule scoring on the request path.

FR-2. The materialized set is derived from the **actual watchlist bindings** (the (symbol, strategy)
pairs a user could open), so that opening a watchlist finds its rows already warm rather than warming
them on demand. The derivation must be **owner-scoped** — a materialized row is attributable to the
correct user's binding and never leaks another user's live strategy into this user's readiness view
(guards the fails.md:1153 IDOR class).

FR-3. Materialized readiness respects the same **definition fingerprint** (`def_fingerprint`) and
freshness semantics the on-demand path already uses, so that a stale row (strategy/formula changed,
or bar data advanced past the refresh cadence) is recomputed rather than served indefinitely. The
refresh cadence is operator-tunable via config (see Config Key Changes).

FR-4. The background materialization is **bounded** in its resource use — marketdata pull volume,
indicator recompute cost, and DB connection budget must stay within the analysis service's existing
envelope (PgBouncer pool, `_bars_fetch_sem`) as symbols × strategies grows, and must not degrade the
latency of the live evaluation loop or on-demand `EvaluateReadiness` calls it runs alongside.

FR-5. The on-demand `EvaluateReadiness` path remains a correct fallback: a cache miss (a pair the
materializer has not yet covered, or a brand-new binding) still computes synchronously as today, so
the overlay is never blank — it is only slow in the uncovered case, fast in the covered case.

## Out of Scope

- Changing the `EvaluateReadiness` RPC contract or the UI overlay component (`WatchlistReadiness.tsx`)
  — the UI already reads through `EvaluateReadiness`; a warm cache makes the *same* call fast. UI
  changes, if any prove necessary, are a named follow-up, not this feature.
- Full backtest (`RunBacktest`/`ScoreStrategy`) performance — off this path.
- Marketdata-side query optimization (e.g. bars pagination / lock-budget tuning) beyond staying
  within the existing envelope — see `docs/runbooks/ohlcv-lock-budget-tuning.md`.
- The trader segment's single-symbol readiness on `positions/[symbol]` (one pair, already cheap).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — owns the readiness computation, the live evaluation loop, and
  `analysis.readiness_cache`; the materializer lives here regardless of which loop option is chosen.
- `xstockstrat-portfolio` — **read-only dependency**: source of watchlist bindings (the (symbol,
  strategy) universe to materialize). Whether analysis reads bindings via a portfolio RPC or another
  path is a design question.
- `xstockstrat-config` — new operator-tunable cadence/enable keys (see Config Key Changes).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/insights` (`/insights/watchlists`): the readiness overlay
  rendered by `WatchlistReadiness.tsx`. **No new UI code is required** — the existing
  `EvaluateReadiness` read benefits from the pre-warmed cache. The observable user-facing outcome
  (fast load) is on this surface, which is why it is named here per C-14.
- [ ] **Agent** — no MCP tool change.
- [ ] **None** — not applicable; the capability's benefit is user-observable on `/insights`.

## Proto Contract Changes

- [x] No proto changes required (the materializer writes the same `readiness_cache` rows the existing
  `EvaluateReadiness` FAST path reads; the RPC contract is unchanged). _To be confirmed at /sdd-design:
  reading watchlist bindings into analysis may need a portfolio-side RPC if none suitable exists._

## Config Key Changes

- [ ] No new config keys
- OR (expected — final set decided at /sdd-design):
  - `analysis.readiness_materializer.enabled` (bool) — master switch for the background materializer.
  - `analysis.readiness_materializer.interval_seconds` (int) — refresh cadence for the materialized set.
  - _(possibly)_ `analysis.readiness_materializer.max_pairs_per_cycle` (int) — batch bound so a large
    universe is materialized incrementally rather than in one burst.

  Keys follow `<service>.<category>.<key>`; defaults declared in `services/xstockstrat-analysis/CLAUDE.md`.
  The design must decide whether cadence reuses/extends `analysis.readiness.stale_after_seconds`
  (feature 177) rather than adding a parallel knob.

## Database Changes

- [x] No schema changes expected — the materializer reuses `analysis.readiness_cache`
  (migration `022_readiness_cache`). _To be confirmed at /sdd-design: if the materializer needs to
  distinguish materialized vs. on-demand rows, or index by (user, symbol, strategy) for efficient
  batch upsert, a new column/index migration may be required (DBA review then applies)._

## Feature Workflow Notes

Branch to create: `feature/watchlist-readiness-precompute` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (config change) — analysis + config owners
- [ ] 2 service owners + platform lead (breaking proto change) — not expected
- [ ] DBA review + service owner (schema migration) — only if a `readiness_cache` migration proves needed

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Loop placement (the core design question).** Should background write-through live **inside
  the existing live evaluation loop** (`services/xstockstrat-analysis/app/engine/live_loop.py`) or in
  a **new dedicated readiness-materializer loop**? Size both on performance for large symbols ×
  strategies: fan-out cost, marketdata pull volume, indicator recompute reuse, DB connection budget,
  staleness/freshness, and scaling behavior. **This is what `/sdd-design` (deep) must resolve.**
- [ ] **Universe coverage.** Is every watchlist-bound strategy guaranteed to be in the live loop's
  scan set, or can a watchlist bind a strategy the live loop does not evaluate (e.g. a non-live
  strategy)? If the live loop only scans live-enabled strategies, the "reuse the live loop" option
  cannot cover watchlist-only bindings without widening the loop's scan set — a decisive input to the
  sizing. (Relates to insights.md:525 — "readiness scoped by a single upstream choice".)
- [ ] **Acceptable staleness / refresh cadence.** Per-bar-close cadence vs. near-real-time? This sets
  the materializer's period and directly drives its marketdata pull volume.
- [ ] **Known trap — polling/recheck design (fails.md:804-847, feature 118).** "Nothing changed" is
  the *expected, repeated* case for a background refresh loop, not a rare one; and a naive recheck
  window can collapse to a full rescan. The materializer's cycle must be efficient in the steady
  state where most rows are already fresh.
- [ ] **Known trap — owner-scoping / IDOR (fails.md:1153, feature 131).** Reading watchlist bindings
  and materializing per-user readiness must be owner-scoped; do not attribute one user's live/bound
  strategy to another user's readiness view.
- [ ] **Known trap — lazily-filled cache within one iteration (insights.md:220-230, C-08).** The
  on-demand path already has a within-iteration warmup-cache subtlety; the materializer must not make
  the first pair behave differently from the rest.
- [ ] **Marketdata lock/pool budget under batch load** (`docs/runbooks/ohlcv-lock-budget-tuning.md`,
  insights.md:180) — a large materialization burst multiplies 400-day bars queries; confirm it stays
  within `max_locks_per_transaction` and the PgBouncer budget.
