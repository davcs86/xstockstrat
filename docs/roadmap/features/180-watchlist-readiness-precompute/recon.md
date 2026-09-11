# Recon: watchlist-readiness-precompute

**Created**: 2026-09-05
**From**: product-spec.md
**Affected services**: xstockstrat-analysis (primary), xstockstrat-portfolio (read-only binding source), xstockstrat-config (config keys), xstockstrat-ui (consumer surface — confirm-only)

---

## Objective

Move per-(symbol, strategy) readiness computation off the synchronous `EvaluateReadiness` UI render
path by materializing rows into `analysis.readiness_cache` in the background, so the `/insights`
watchlist overlay reads cache-only and loads fast for large watchlists. The design must size two
placement options — extend the existing live evaluation loop vs. a new dedicated readiness
materializer loop — on performance as symbols × strategies grows.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Live loop entry: `app/engine/live_loop.py:234` `run_forever` (cadence `analysis.engine.eval_interval_seconds` default 60, `:237`)
  - Live-loop universe: live-enabled strategies **only** — `SELECT ... WHERE live_enabled=TRUE AND active=TRUE` (`live_loop.py:266`; predicate `strategies.py:19`); per-strategy symbols via `resolve_universe(defn, watchlist|held|signals)` (`live_loop.py:84,304`); pair handler `_eval_pair` (`:547`) runs the **transition** evaluator, **not** `evaluate_conditions_traced`, and **does not write readiness_cache**.
  - Readiness handler: `app/handlers/servicer.py:2709` `EvaluateReadiness`; `_readiness_for` (`:2778`); FAST hit (`:2780`, `def_fingerprint` match + `now < valid_until`); SLOW path under `self._bars_fetch_sem` (`:2786`) → `evaluate_conditions_traced` (`:2802`); cache write-back `upsert_many` (`:2826`).
  - `_READINESS_LOOKBACK_DAYS = 400` (`servicer.py:249`); `stale_after` = `get_int_present("analysis.readiness.stale_after_seconds", 30)` (`:2757`); `_bars_fetch_sem` = `Semaphore(max(1, get_int("analysis.opportunity.max_concurrent_bars_fetches", 2)))` (`:395`).
  - Fingerprint: `_definition_fingerprint(definition_json)` (`servicer.py:4521`) = sha256 of canonicalized DB `definition_json` minus `_FINGERPRINT_EXCLUDED_KEYS` (excludes display_name/active/live_enabled) — **must hash the DB row, never a request proto** (`:4524`).
  - Cache repo: `app/repositories/readiness_cache.py:21`; `read_many(user_id, strategy_id, rule, symbols)` (`:25`); `upsert_many(rows)` `ON CONFLICT (user_id, strategy_id, rule, symbol)` (`:44,:56`).
  - Last migration: **023** (`023_opportunity_compute_state.up.sql`) → next free **024**. `022_readiness_cache.up.sql:8-19` PK `(user_id, strategy_id, rule, symbol)` + `def_fingerprint, bar_epoch BIGINT, readiness_json JSONB, computed_at, valid_until`.
  - Config: `app/config/watcher.py:35` `ConfigWatcher` (`get_int`/`get_int_present`/`get_bool`); snapshot awaited at `main.py:41-42`.
  - DB pool: single shared `asyncpg` pool, `max_size=DB_POOL_MAX` default 2, PgBouncer-aware (`main.py:53`) — all loops reuse it.
  - Background-loop start: `asyncio.create_task(...)` in `main.py` (live `:127`, fundsignal `:154`, pnl `:171`, opportunity-refresh `:175`); shutdown = `grpc_server.stop(grace=5)`, tasks die with process (no explicit cancel), each loop self-guards per-cycle `try/except`.
- **`xstockstrat-portfolio`** (Go)
  - Watchlist schema: `watchlists(user_id)` `migrations/007_watchlists.up.sql:6-14`; `watchlist_symbols(watchlist_id, symbol, strategy_id DEFAULT '')` `007:16-21` + `008_watchlist_symbol_strategy.up.sql:7-8`; watchlist-level `default_strategy_id` `015`.
  - RPCs (`packages/proto/portfolio/v1/portfolio.proto`): `WatchlistBinding{symbol,strategy_id,source}` (`:220-226`); `Watchlist{user_id, bindings[]}` (`:229-246`); owner-scoped `ListWatchlists` (`:23`, handler `portfolio_service.go:1443`) / `GetWatchlist` (`:22`, `:1430`); cross-user internal-gated `ListAllWatchlistSymbols` returns **bare symbols only** (`:330-334`, handler `:1417`, repo `watchlist_repo.go:421` `SELECT DISTINCT symbol`).
  - Internal-caller authz grant pattern: `internal/service/authz.go:20` `{callerID:"analysis-fundsignal", rpc:"ListAllWatchlistSymbols"}`.
- **`xstockstrat-ui`** (Next.js) — consumer surface, no code change
  - `WatchlistReadiness.tsx:196` `analysisClient.evaluateReadiness({strategyId, symbols})`, grouped by strategy (`:187-191`), only `bound = bindings.filter(b => b.strategyId)` (`:183`), `rule` unset ⇒ ENTRY; `staleTime: 30_000` (`:200`).
  - BFF: generic `forward()` under insights `AnalysisService` router (`insightsBff.ts:55`), `user_id` from `x-user-id` header; no dedicated readiness route.

## Patterns to REUSE

- **Dedicated background materializer loop** → reuse `run_opportunity_refresh_forever` (`servicer.py:3780`) + `DurableSchedule` (`app/engine/durable_schedule.py`, interval + wall-clock modes, backed by `analysis.job_schedule` migration 020) + startup jitter + per-cycle `try/except`. This is the direct template for option B.
- **Per-user staleness-gated compute state** → reuse the feature-177 `opportunity_compute_state` pattern: `OpportunityComputeStateRepository` (`app/repositories/opportunity_compute_state.py`, migration 023) + `_replace_and_stamp_compute_state` (`servicer.py:3229`) — a per-user `computed_at`/`valid_until` gate so a background pass skips already-fresh users (guards the fails.md:804 "nothing-changed is the common case" trap).
- **The readiness computation itself** → reuse `_readiness_for`/`evaluate_conditions_traced` and `upsert_many` unchanged, so a materialized row is **byte-identical** to an on-demand one (fingerprint + bar_epoch + readiness_json). Do NOT fork the eval.
- **Universe resolution** → `resolve_universe` (`live_loop.py:84`) is importable — the single source for a strategy's symbol set.
- **Config read** → `ConfigWatcher.get_int/get_bool` with a call-site default (no-seed `analysis.*` pattern); declare defaults in `services/xstockstrat-analysis/CLAUDE.md` + append the Per-Feature Registered Keys log in `docs/patterns/config-governance.md`.
- **Cross-user watchlist read (if needed)** → mirror the `ListAllWatchlistSymbols` internal-caller authz gate (`authz.go:20`) for any new privileged binding-read RPC.
- **DB pool** → reuse the single shared `asyncpg` pool (F-06); add no new pool.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1` "repeat readiness call within freshness window skips the fan-out" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature:12`) — pre-warm must keep the FAST path (no GetBars/indicator RPCs) intact.
- **PRESERVE** `@AC-2` "a new bar busts the readiness cache" (`…readiness-caching-poll-discipline.feature:20`) — the materializer must stamp the **current `bar_epoch`**; a pre-warmed row must not defeat bar-epoch invalidation. (CHANGE-adjacent — the closest guarantee to this feature; must be honored, not altered.)
- **PRESERVE** `@AC-4` "empty-universe user does not recompute every poll" (`…:28`) and `@AC-5` "warm reads skip live enrichment when fresh" (`…:35`) — freshness discipline unaffected.
- **PRESERVE** readiness/conviction ranking parity "verdicts identical with/without live enrichment" (`opportunity-live-market-enrichment.feature:12`) — a pre-warmed (FAST) verdict must equal a fresh (SLOW) verdict.
- **PRESERVE/EXTEND** `@AC-8`/`@AC-9` durable scheduler re-anchor + retry (`durable-loop-scheduler.feature:46`) — if the materializer rides a scheduled loop it follows the same seed/advance/retry discipline and must not disturb the opportunity-refresh schedule.
- **PRESERVE** (UI) `@AC-3` "remount within staleTime does not refetch" (`services/xstockstrat-ui/acceptance/readiness-caching-poll-discipline.feature:11`) and the `watchlist-opportunity-signal-cues.feature` rendering scenarios — server-side pre-warm requires no UI change and must return identical `SymbolReadiness` payloads.
- **PRESERVE** (portfolio) watchlist CRUD/binding/universe suites — the materializer reads bindings, never mutates them.

## Dependencies

- Proto/RPC: `EvaluateReadiness` unchanged (`analysis.proto:635-649`, `ReadinessRule` `:630`). **Possible new** privileged cross-user portfolio RPC (e.g. `ListAllWatchlistBindings` → `(user_id, symbol, strategy_id)`) IF the materializer must cover all users' bindings without per-user fan-out — additive, gated like `ListAllWatchlistSymbols`. Decided in the debate.
- Migration: next `NNN` = **024** for `services/xstockstrat-analysis/migrations/` (only if a readiness compute-state table/index is added; else none — reuse `readiness_cache`).
- Config keys (new, no-seed `analysis.*`): `analysis.readiness_materializer.enabled` (bool), `analysis.readiness_materializer.interval_seconds` (int); possibly `.max_pairs_per_cycle` (int). Reuse `analysis.readiness.stale_after_seconds` for the freshness window rather than a parallel knob.
- Inter-service edges: analysis → portfolio (watchlist bindings read; edge already exists via `live_loop`/`fundsignal_loop`); analysis → marketdata (bars, existing); analysis → indicators (existing).
- New env vars / ports: none.

## Risks / Not-found

- **Universe sourcing gap (portfolio).** The cross-user `(user_id, symbol, strategy_id)` tuple **cannot be sourced today** — `ListAllWatchlistSymbols` collapses to bare symbols; only owner-scoped `ListWatchlists`/`GetWatchlist` carry `strategy_id`, and analysis cannot enumerate all users. Covering every user's watchlist bindings requires either a new privileged cross-user RPC or an owner-enumeration source. **Decisive design input.**
- **Live-loop universe ≠ watchlist universe.** The live loop scans **live-enabled strategies only** and evaluates the transition path — it neither covers watchlist bindings to **non-live** strategies nor computes readiness. Option A must therefore *widen* the loop's scan set AND add a second (readiness) evaluation per pair — a semantic + cost change to the trading hot loop.
- **fails.md:804-847 (feature 118) — polling/recheck.** "Nothing changed" is the expected steady state; the cycle must skip already-fresh rows (compute-state gate) and must not collapse a recheck into a full rescan.
- **fails.md:1153 (feature 131) — owner-scoping/IDOR.** Materialized rows are per-user (PK carries user_id); a cross-user read must attribute each binding to its true owner.
- **insights.md:220-230 (C-08) — lazily-filled within-iteration cache.** Reuse the shared warmup-cache carefully so the first pair does not behave differently from the rest.
- **`ohlcv-lock-budget-tuning.md` / insights.md:180 — marketdata lock/pool budget.** A large materialization burst multiplies 400-day bars queries; must stay within `_bars_fetch_sem` and `max_locks_per_transaction`.
- **Not found:** no existing readiness materializer, `analysis.readiness_materializer.*` key, or background readiness write-through; no cross-user watchlist-binding RPC; no explicit background-task cancellation on shutdown (loops die with process).

## Recommended Scope (advisory — input to grilling / /sdd-spec)

1. Config keys (`analysis.readiness_materializer.{enabled,interval_seconds}`) + CLAUDE.md declaration + registered-keys log.
2. Universe source: decide per debate — new privileged cross-user portfolio RPC vs. reuse of the live loop's per-owner enumeration.
3. The materializer itself: a dedicated `DurableSchedule`-driven loop (option B) reusing `_readiness_for` + `upsert_many` + an `opportunity_compute_state`-style freshness gate; started via `create_task` in `main.py`.
4. Bound resource use to `_bars_fetch_sem` + a per-cycle pair cap; reuse the shared DB pool (F-06).
5. Tests: analysis unit/integration for the materializer (FAST==SLOW parity, bar-epoch stamping, owner-scoping, empty-universe skip); no UI change.
