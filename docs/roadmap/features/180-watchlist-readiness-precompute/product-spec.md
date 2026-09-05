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
  (`:2786-2819`) fetches ~400 days of bars (`_READINESS_LOOKBACK_DAYS = 400`, `:249`) gated by
  `self._bars_fetch_sem` (default 2, `analysis.opportunity.max_concurrent_bars_fetches`), evaluates
  conditions, and writes back to cache (`:2826-2830`).
- **Cache window is 30s** (`analysis.readiness.stale_after_seconds`, `servicer.py:2757`; feature 177).
- **Not a full backtest** — `RunBacktest`/`ScoreStrategy` are off this path. The "scoring" is the
  deterministic conviction ordinal (passing/total rule leaves), but producing it still requires the
  marketdata pull + indicator computation.

## Functional Requirements

FR-1. Readiness rows for watchlist-bound (symbol, strategy) pairs are materialized into
`analysis.readiness_cache` by a **background process**, so that once a pair has been materialized and
is still fresh, a subsequent `EvaluateReadiness` call for it is served from the FAST (cache-hit) path
with no synchronous marketdata pull, indicator computation, or rule scoring on the request path.
**Coverage is eventually-consistent, not instantaneous** (design R1): the materializer warms the
universe over a bounded rotation, so a pair opened before its first warm — or in the re-warm window
right after a daily bar close — still falls to the synchronous path per FR-5. The guarantee is
"fast for covered, fresh pairs," and the covered set converges within one rotation period; it is
**not** "every pair is always FAST."

FR-2. The materialized set is derived from the **actual watchlist bindings** (the (symbol, strategy)
pairs a user could open), so that opening a watchlist finds its rows already warm rather than warming
them on demand. The derivation must be **owner-scoped** — a materialized row is attributable to the
correct user's binding and never leaks another user's live strategy into this user's readiness view
(guards the fails.md:1153 IDOR class).

FR-3. Materialized readiness respects the same **definition fingerprint** (`def_fingerprint`) as the
on-demand path, so that a stale row — strategy/formula changed (fingerprint mismatch) **or** a new
daily bar landed (`bar_epoch` behind the latest bar) — is recomputed rather than served indefinitely.
Freshness is enforced by the `bar_epoch`-aware FAST gate (authoritative), with
`analysis.readiness_materializer.valid_window_hours` as a backstop TTL. The materializer's run cadence
itself is not a new config axis (it rides the loop's existing interval mechanism); the only
operator-tunable freshness knob this feature adds is `valid_window_hours` (see Config Key Changes).

FR-4. The background materialization is **bounded** in its resource use — marketdata pull volume,
indicator recompute cost, and DB connection budget must stay within the analysis service's existing
envelope (PgBouncer pool, `_bars_fetch_sem`) as symbols × strategies grows, and must not degrade the
latency of the live evaluation loop or on-demand `EvaluateReadiness` calls it runs alongside.

FR-5. The on-demand `EvaluateReadiness` path remains a correct fallback: a cache miss (a pair the
materializer has not yet covered, or a brand-new binding) still computes synchronously as today, so
the overlay is never blank — it is only slow in the uncovered case, fast in the covered case.

FR-6. **(Operator constraint, 2026-09-05.)** Watchlist symbol bindings reference **live strategies
only**. A binding to a non-live strategy is treated as a **bug**, not a supported case — the
materializer's warm-set is therefore the live-strategy universe (which the live evaluation loop
already enumerates per owner), and this feature is **not** obligated to pre-warm non-live bindings.
Whether the platform should actively *prevent* creating a non-live binding is a separate concern
(see Out of Scope / Open Questions), not solved here.

FR-7. **(Operator constraint, 2026-09-05 — freshness reframe.)** This is **not** a day-trading
platform; all strategy evaluation operates on **1-day (EOD) bars**. Readiness therefore only changes
at **daily bar close** or on a **strategy/formula definition change** — not intraday. The 30s poll
cadence (`analysis.readiness.stale_after_seconds`, client `staleTime: 30_000`) exists to keep the
**stock-list quote/price display** fresh, **not** the readiness verdict. Consequently a materialized
readiness row need not use the 30s window: its freshness is governed by the **`bar_epoch`-aware FAST
gate** (authoritative — a row is stale once a newer daily bar exists), backed by a generous
`valid_window_hours` TTL (default 24h) as a backstop, so pre-warming does not require refreshing every
pair every 30s. **RESOLVED at /sdd-design (C-16 boundary):** the intraday same-timestamp 1d-bar OHLC
sensitivity that feature 177's short window provided is **not** a readiness requirement on this
1-day-bar platform (operator ruling); feature 177's lazy path keeps its 30s window unchanged, and the
`bar_epoch` predicate preserves `@AC-2` ("a new daily bar busts the cache") for both row origins under
one freshness semantic. See design.md § @AC-2 reconciliation.

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
  `analysis.readiness_cache`; the dedicated materializer loop lives here (design Option B).
- `xstockstrat-portfolio` — **read-only dependency**: source of watchlist bindings, read via the
  **existing** owner-scoped `ListWatchlists` (per-owner `x-user-id`) — no new endpoint. No portfolio
  code change.
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

- [x] No proto changes required. RESOLVED at /sdd-design: the materializer writes the same
  `readiness_cache` rows the existing `EvaluateReadiness` FAST path reads (contract unchanged), and
  it sources watchlist bindings by **reusing the existing owner-scoped watchlist drain** (per-owner
  `ListWatchlists` with `x-user-id`) — **no new portfolio RPC** and therefore **no proto-reviewer /
  2-owner+platform-lead gate**. (The Round-1 `ListAllWatchlistBindings` RPC idea was rejected; see
  design.md § Rejected Alternatives.)

## Config Key Changes

Final set (decided at /sdd-design):
  - `analysis.readiness_materializer.enabled` (bool, default `false`) — master switch for the loop.
  - `analysis.readiness_materializer.valid_window_hours` (int, default 24) — backstop TTL for a
    materialized row's `valid_until` (the authoritative bust is the `bar_epoch`-aware FAST gate).
  - `analysis.readiness_materializer.max_concurrent_bars_fetches` (int, default 2) — the loop's **own**
    bars-fetch semaphore, separate from the interactive `analysis.opportunity.max_concurrent_bars_fetches`
    (preserves the feature-176 priority-inversion guard).

  Keys follow `<service>.<category>.<key>`; defaults declared in `services/xstockstrat-analysis/CLAUDE.md`
  and logged in the config-governance Per-Feature Registered Keys log. **Cadence does NOT reuse
  `analysis.readiness.stale_after_seconds`** (that 30s window stays owned by feature 177 for the lazy
  path); the materializer rides its own loop interval. No `interval_seconds`/`max_pairs_per_cycle` keys.

## Database Changes

- [x] No schema changes. RESOLVED at /sdd-design: the materializer reuses `analysis.readiness_cache`
  (migration `022_readiness_cache`) as-is — materialized and on-demand rows are byte-identical (same
  shared compute path), so **no origin-distinguishing column** is added, and the existing PK
  `(user_id, strategy_id, rule, symbol)` already serves the batch upsert. No new migration; **no DBA
  gate**.

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

_All product-spec Open Questions were resolved by `/sdd-design` (see `design.md`). Retained here as a
decision record. Residual items are tracked as design **Open Risks** (design.md § Open Risks) for
`/sdd-spec` / `/sdd-execute`._

- [x] **Loop placement (the core design question).** RESOLVED → **Option B, a dedicated
  readiness-materializer loop** (not inside the live loop). The live loop fetches each strategy's
  *resolved universe*, not the watchlist-bound pairs, so the "reuse the loop's bars" premise was
  false, and injecting readiness into its serial pair loop regressed alert latency (FR-4). Full
  A-vs-B performance sizing in `design.md` § Option A vs Option B.
- [x] **Universe coverage.** RESOLVED by **FR-6** — watchlists bind live strategies only, so the
  warm-set is the live-strategy universe. The materializer enumerates live-strategy owners locally
  (`analysis.strategies WHERE live_enabled`) and reuses the existing owner-scoped watchlist drain to
  get exact bound pairs. Enforcing the live-only invariant at binding-write time is a **separate
  follow-up** (design R5), not this feature.
- [x] **Acceptable staleness / refresh cadence.** RESOLVED by **FR-7** — 1-day bars; readiness
  changes at daily bar close / definition change. Materialized rows carry a bar-close-aligned
  `valid_until` with a `bar_epoch`-aware FAST gate; cadence rides the loop interval. No 30s coupling.
- [x] **Known trap — polling/recheck (fails.md:804-847, feature 118).** ADDRESSED — the loop applies
  a **skip-fresh gate** (`read_many` → skip pairs already fresh under the freshness predicate), so the
  steady "nothing changed" state costs a cheap read, not a recompute.
- [x] **Known trap — owner-scoping / IDOR (fails.md:1153, feature 131).** ADDRESSED — warm-set is
  sourced via the owner-scoped drain and every row is keyed under the binding owner's `user_id`;
  no cross-user RPC. Owner-scoping is structural. A binding whose user does not own the strategy is
  skipped, not fabricated (P-03).
- [x] **Known trap — lazily-filled cache within one iteration (insights.md:220-230, C-08).**
  ADDRESSED in design — the `latest_bar_epoch` lookup feeding the freshness predicate is memoized
  **before** the per-symbol loop, not filled lazily within it (tracked as design R2 for /sdd-spec).
- [x] **Marketdata lock/pool budget under batch load** (`ohlcv-lock-budget-tuning.md`, insights.md:180).
  ADDRESSED — the materializer bounds concurrent 400-day pulls with its **own** semaphore
  (`analysis.readiness_materializer.max_concurrent_bars_fetches`, default 2), separate from the
  interactive `_bars_fetch_sem`, keeping it within the existing lock/PgBouncer envelope and preserving
  the feature-176 priority-inversion guard.
