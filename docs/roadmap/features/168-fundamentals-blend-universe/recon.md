# Recon: fundamentals-blend-universe

**Created**: 2026-08-31
**From**: product-spec.md
**Affected services**: xstockstrat-analysis (+ read deps xstockstrat-ingest, xstockstrat-marketdata, xstockstrat-config)

---

## Objective

In the `xstockstrat-analysis` live evaluation loop, force-run the configured blend strategy
(default `fundamentals_macd_blend`) over the **fundamentals universe** — symbols with an active
`source == "fundamentals"` signal AND actual fundamentals data — for each user who has that strategy
live, in addition to their selected strategies, while restricting the blend strategy to that universe
(excluded everywhere else). Net-new per-strategy universe-override logic; no existing code does this.
No proto change, no migration — two new `analysis.engine.*` config keys and engine logic only.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Live loop entry: `services/xstockstrat-analysis/app/engine/live_loop.py` — `run_forever` `:249-261`
    (reads `analysis.engine.eval_interval_seconds` `:252`; overlap lock `:254-257`).
  - **The enforcement seam:** `_run_cycle` `:263-356`. Reads `analysis.engine.max_strategies_per_cycle`
    `:273` + `alert_throttle_seconds` `:274`; selects `live_enabled` rows `:275-278`; drains
    platform-wide active signals once `:280`; per-owner watchlist/held memoized per cycle `:283-295`;
    calls `resolve_universe` per row `:296-298`; builds `(created_at, strategy_id, symbol, definition,
    deny_entry)` records `:300-309`; fair-share rotation + cursor `:312-345`; per-pair isolation
    `:337-344`.
  - `resolve_universe` `:83-105` (feature 132): `union = allowlist or (watchlist | held | (signals iff
    signal_eligible))`; `universe = (union − denied) | (held ∩ denied)` (held+denied keeps its EXIT
    trace, entry-only deny). Returns `ResolvedUniverse(universe, deny_entry, union, denied)` `:74-80`.
    `strategy_symbols` `:61-71` reads the `signal_params.symbols` allowlist.
  - `_drain_signals` `:358-385` — active-signal symbols via `QuerySignals(active_window=[now,now])`,
    best-effort (ingest error → empty set). **Does NOT pass `source`** — it keeps only `.symbol`, so it
    cannot be reused as-is for a source-filtered fundamentals query (a distinct call is needed).
  - Config reads: `app/config/watcher.py` — `get_str` `:87-93` (empty `string_val` → default),
    `get_bool` `:116-122` (**`HasField("bool_val")` → an explicit `false` is honored**, only an absent
    key falls to the default), `get_int` `:95-101` (zero-trap), `get_int_present` `:103-114`.
  - Fundamentals-universe precedent: `app/engine/fundsignal_loop.py` — `_paced_fetch` `:359-385`
    (`GetFundamentalsMulti` in budget-bounded chunks; "has fundamentals" = symbol present in
    `resp.fundamentals`, keyed `f.symbol.upper()`); `_score` reads `analysis.fundsignal.scoring_formula_id`
    via `get_str` `:387-389`. This is a **separate ~daily loop**, not the ~60s live loop — its fetched
    fundamentals are not in the live loop's process memory (no shared cache today).
  - Row→proto mapper: `_row_to_strategy_definition` (called `:291`) — unchanged by this feature
    (no new StrategyDefinition field), so the feature-048 "field + mapper in lockstep" trap does not bite.
  - Strategies table: `migrations/001_strategies.up.sql` (`strategy_id` user-supplied); composite
    `(user_id, strategy_id)` PK from `013_strategies_user_id` (feature 133). `fundamentals_macd_blend`
    is **agent-registered per-user** (via `manage_strategy`), not seeded
    (`docs/reports/2026-07-20-custom-indicators-strategies.md:38`).
- **read deps**
  - `packages/proto/ingest/v1/ingest.proto:128-134` — `QuerySignalsRequest{ source=1, symbol=2,
    direction=3, active_window=4, page=5 }`. `source` is the "== fundamentals" filter; `active_window`
    is the "active only" filter (a `TimeRange(now, now)`).
  - `packages/proto/marketdata/v1/marketdata.proto:41` (`GetFundamentalsMulti`) — "has fundamentals".
  - `packages/proto/analysis/v1/analysis.proto:342` (`denied_symbols`), `:355` (`signal_eligible`),
    `:318` (`signal_params` Struct; `symbols` key `:351`) — universe knobs, no proto change.

## Patterns to REUSE

- Universe resolution → **extend** `resolve_universe` usage at `_run_cycle:296-298` with a per-strategy
  override branch keyed on `definition.strategy_id == blend_id`, not a parallel selection path. Keep the
  blend row inside the same `records` list + rotation/cursor so it composes with the fair-share scheduler.
- "has fundamentals" test → reuse the `fundsignal_loop._paced_fetch` shape (`:373-378`): call
  `GetFundamentalsMulti(chunk)`, keep symbols present in `resp.fundamentals`. Resolve the set **once per
  cycle**, not once per strategy/user (F-06 pacing; product Resolved Decision).
- "source == fundamentals" → a **new** `QuerySignals(source=<slug>, active_window=[now,now])` call
  (cannot reuse `_drain_signals`, which drops source and returns only symbols). Slug from
  `analysis.fundsignal.source_slug` (default `fundamentals`) via `get_str` — never a hardcoded string
  (F-07). The `analysis` ConfigWatcher can read this `analysis.*` key directly (same namespace — no
  second cross-namespace subscription, unlike the marketdata boot-freeze case).
- Fail-closed-to-empty → reuse the `_drain_signals` best-effort shape (`:378-380`): wrap the whole
  fundamentals-universe resolution in `try/except → return set()` so a `QuerySignals`/`GetFundamentalsMulti`
  outage yields an empty universe for the cycle (FR-6), never a broad fallback.
- Config-driven id + kill-switch → `get_str("analysis.engine.fundamentals_blend_strategy_id",
  "fundamentals_macd_blend")` + `get_bool("analysis.engine.fundamentals_blend_enabled", True)`,
  mirroring the existing `analysis.engine.*` reads at `:252,273,274`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @feature-156` "The producer runs its first cycle promptly on a fresh deploy"
  (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — guarantees the
  `"fundamentals"` source stays registered; the read side must not assume/rename the slug away from
  `analysis.fundsignal.source_slug`.
- **PRESERVE** `@AC-3 @feature-154` "Producer scores the enumerated union when universe_source is
  watchlists" (`services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature`) —
  defines the population of active `source=="fundamentals"` signals this feature intersects; the feature
  must not change how the producer resolves/emits them (producer-side is Out of Scope).
- **C-16 blind spot (flagged):** the live loop's `resolve_universe`, the per-user `(user_id,
  strategy_id)` ownership model, and the "loop never places orders" invariant have **no promoted
  `@AC-*` guarantee** in any durable suite. This feature's own `@AC-1..@AC-6` (its `acceptance.feature`)
  are the regression guard — **AC-3 explicitly asserts other strategies' universes are unchanged**, which
  is the single most important preservation this design must honor.
- xstockstrat-ingest / xstockstrat-marketdata → no acceptance suite yet (read deps only).

## Dependencies

- Proto/RPC: **none new** — all inputs exist (`QuerySignals.source`/`active_window`,
  `GetFundamentalsMulti`, `denied_symbols`/`signal_eligible`/`signal_params`).
- Migration: **none** (universe derived at eval time; nothing persisted).
- Config keys (both `analysis` service, `engine` category — C-05):
  - `analysis.engine.fundamentals_blend_strategy_id` — string, default `fundamentals_macd_blend` (FR-5).
  - `analysis.engine.fundamentals_blend_enabled` — bool, default `true` (kill-switch, Resolved Decision).
  Register both in the Per-Feature Registered Keys log (`docs/patterns/config-governance.md`) at execute.
- Inter-service edges (all already exist, called by the fundsignal loop): analysis → ingest
  `QuerySignals`; analysis → marketdata `GetFundamentalsMulti`.
- New env vars / ports: **none**.

## Risks / Not-found

- **Not found:** any "run strategy X on sub-universe Y, exclude elsewhere" logic — net-new; and any seed
  migration/config defining `fundamentals_macd_blend` (it is per-user agent-registered).
- **Cross-cycle cost (design fork):** the fundamentals universe changes only ~daily (signals + the 24h
  fundamentals cache), but the live loop cycles ~every 60s. Resolving it every cycle (only when a blend
  strategy is live) is a bounded gRPC cost over a small symbol set hitting marketdata's cache — a
  cross-cycle TTL cache is a *possible* optimization to flag, not build (behavior #2).
- **Pacing/pool (feature 059, F-06):** `GetFundamentalsMulti` is the single FMP/Finnhub chokepoint (hits
  marketdata's 24h cache, not FMP directly). Resolve once per cycle and **skip entirely** when no live
  strategy matches the blend id — never a per-strategy fan-out.
- **Held-but-left-universe exit edge (FR-2 vs feature-132 exit invariant) — operator decision:** feature
  132 keeps a held+denied symbol's EXIT trace alive; FR-2 strictly excludes the blend strategy from every
  symbol outside the fundamentals universe. If a blend position's fundamentals signal expires
  (`valid_days`, ~90d) while still held, strict FR-2 means its exit rule fires **no alert**. The loop
  places no orders, so the blast radius is a missed exit *alert*, not a stranded live position. Surface
  for sign-off; recommend strict FR-2 for v1 (matches AC-2, alert-only loop) with the edge documented.
- **`get_bool` is safe (resolved):** `watcher.py:116-122` uses `HasField("bool_val")`, so the kill-switch
  default `true` does **not** swallow an explicit `false` (the config native-type/zero-trap ledger family
  does not apply here). `get_str` empty→default means setting the id to `""` reverts to the default id.
- **Precedence (feature 132):** `denied_symbols` still subtracts from the forced universe; a blend
  `signal_params.symbols` allowlist is ignored (FR-2 replaces the universe). Encode + test (AC covers
  neither directly — add RED assertions).
- **Ledger trap (live-strategy-alert-engine, 048):** no StrategyDefinition field/mapper change here, so
  the "field + row→proto mapper in lockstep" trap is avoided by construction — confirm no mapper edit.
- **Ledger trap (conviction ordinal-vs-probability, 023/mpt):** the fundamentals filter uses a signal's
  **presence + source + active window**, never its conviction as a probability — don't misuse conviction.

## Recommended Scope

Advisory step boundaries: (1) config keys — `get_str`/`get_bool` reads at cycle start + no-op/skip when
disabled or no live blend strategy present (FR-5); (2) once-per-cycle `_resolve_fundamentals_universe`
(new `QuerySignals(source=slug, active_window)` ∩ `GetFundamentalsMulti` "has row"; fail-closed to empty,
FR-6); (3) `_run_cycle` override branch — when `strategy_id == blend_id`, replace the resolved universe
with `(fundamentals_universe − denied) | (held ∩ denied)`, additive to other strategies (AC-3), with
feature-132 precedence; RED assertions for AC-1..AC-6 + precedence + the empty-universe failure path.
