# Recon: fundamentals-blend-universe

**Created**: 2026-08-31
**From**: product-spec.md
**Affected services**: xstockstrat-analysis (+ read deps xstockstrat-ingest, xstockstrat-marketdata, xstockstrat-config)

---

## Objective

In the `xstockstrat-analysis` live evaluation loop, force-run the configured blend strategy
(default `fundamentals_macd_blend`) over the **fundamentals universe** — symbols with an active
`source == "fundamentals"` signal AND actual fundamentals — for each user who has that strategy live,
in addition to their selected strategies, while restricting the blend strategy to that universe
(excluded everywhere else). Net-new per-strategy universe-override logic; no existing code does this.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Live loop: `services/xstockstrat-analysis/app/engine/live_loop.py` — DB select of `live_enabled`
    strategies `:275-278`; `_run_cycle` builds `(strategy, symbol)` records `:289-312`; `resolve_universe`
    `:83-105` (`union = allowlist or (watchlist | held | (signals if signal_eligible else set()))`). **The
    enforcement seam** for "force blend onto fundamentals universe, exclude elsewhere."
  - Config reads: `analysis.engine.*` — `eval_interval_seconds` `:252`, `max_strategies_per_cycle` `:273`,
    `alert_throttle_seconds` `:274`. New keys join this category.
  - Fundamentals-universe precedent: `app/engine/fundsignal_loop.py:373-378` (`GetFundamentalsMulti` →
    per-symbol row; "has fundamentals" = a returned row); `_resolve_universe` `:275`, `_paced_fetch` `:359`.
  - Shared evaluator: `app/services/evaluator.py` (both live loop + backtest run through it).
  - Strategies table: `migrations/001_strategies.up.sql` (`strategy_id` user-supplied PK); composite
    `(user_id, strategy_id)` PK from `013_strategies_user_id` (feature 133). `fundamentals_macd_blend` is
    **agent-registered per-user** (via `manage_strategy`), not seeded (`docs/reports/2026-07-20-custom-indicators-strategies.md:38`).
- **read deps**
  - `packages/proto/ingest/v1/ingest.proto:129` (`QuerySignalsRequest.source`) — "source == fundamentals".
  - `packages/proto/marketdata/v1/marketdata.proto:41` (`GetFundamentalsMulti`) — "has fundamentals".
  - `packages/proto/analysis/v1/analysis.proto:342` (`denied_symbols`), `:355` (`signal_eligible`), `:318`
    (`signal_params` Struct; `symbols` key `:351`) — universe knobs, no proto change.

## Patterns to REUSE

- Universe resolution → extend the existing `resolve_universe` (`live_loop.py:83`) with a per-strategy
  override branch, not a parallel selection path.
- Fundamentals-universe derivation → reuse `fundsignal_loop.py`'s `GetFundamentalsMulti` fetch + the
  "returned row = has fundamentals" test (`:373-378`); reuse the per-cycle fetched set rather than a new
  fan-out (respect FMP/Finnhub pacing, feature 059).
- "source == fundamentals" → reuse `QuerySignals(source=...)` with the existing `analysis.fundsignal.source_slug`
  default `fundamentals` (config-governance.md:429), not a hardcoded string.
- Config-driven strategy id + kill-switch → reuse the `analysis.engine.*` WatchConfig read pattern
  (`live_loop.py:252,273,274`), never hardcode (F-07).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @feature-156` "The producer runs its first cycle promptly on a fresh deploy" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — guarantees the `"fundamentals"` source stays registered; the read-side must not assume/rename the slug away from `analysis.fundsignal.source_slug`.
- **PRESERVE** `@AC-3 @feature-154` "Producer scores the enumerated union when universe_source is watchlists" (`services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature`) — defines the population of active `source=="fundamentals"` signals this feature intersects; feature must not change how the producer resolves/emits them (producer-side is Out of Scope).
- **C-16 blind spot (flagged):** the live loop's `resolve_universe`, the per-user `(user_id, strategy_id)`
  ownership model, and the "loop never places orders" invariant have **no promoted `@AC-*` guarantee** in
  any suite. This feature's own `@AC-1..@AC-3` (its `acceptance.feature`) are the regression guard, and
  AC-3 explicitly asserts other strategies' universes are unchanged.
- xstockstrat-ingest → no acceptance suite yet (read dep via `QuerySignals`).

## Dependencies

- Proto/RPC: **none** (all inputs already exist — see Codebase Map).
- Migration: **none** (universe derived at eval time; nothing persisted).
- Config keys: `analysis.engine.fundamentals_blend_strategy_id` (default `fundamentals_macd_blend`),
  `analysis.engine.fundamentals_blend_enabled` (default `true`).
- Inter-service edges: analysis → ingest `QuerySignals(source="fundamentals")`; analysis → marketdata
  `GetFundamentalsMulti`; both already exist and are called by the fundsignal loop.
- New env vars / ports: none.

## Risks / Not-found

- **Not found:** any "run strategy X on sub-universe Y, exclude elsewhere" logic — net-new; and any seed
  migration/config defining `fundamentals_macd_blend` (it is per-user agent-registered).
- **Central decision (resolved to per-user):** the blend strategy is per-user; the rule fires only for
  users who have it live. Promoting to global is Out of Scope.
- **Pacing/pool (feature 059, F-06):** `GetFundamentalsMulti` is a paced chokepoint — resolve the
  fundamentals universe once per cycle and reuse, never per-strategy fan-out.
- **Precedence (feature 132):** `denied_symbols` still subtracts from the forced universe; a blend
  `signal_params.symbols` allowlist is ignored (FR-2 replaces the universe). Encode + test.
- **Ledger fail (live-strategy-alert-engine):** adding a new field/behavior without updating the
  row→proto mapper in lockstep bit feature 048 — keep any StrategyDefinition-shaped change consistent.
- **Ledger note (conviction ordinal vs probability):** `source=="fundamentals"` signal filtering uses the
  signal's presence/source, not its conviction as a probability — don't misuse conviction.

## Recommended Scope

Advisory step boundaries: (1) config keys (WatchConfig read, fail-closed) + strategy-id resolution +
no-op when not live; (2) per-cycle fundamentals-universe resolver (QuerySignals ∩ GetFundamentalsMulti,
reuse fundsignal fetch); (3) `resolve_universe`/`_run_cycle` override — force blend onto the fundamentals
universe, exclude elsewhere, additive to other strategies, with feature-132 precedence.
