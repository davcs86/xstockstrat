# xstockstrat-analysis — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24; citations re-grounded 2026-07-28 (`servicer.py` drift after features 069–072). Captures the **non-obvious** local
invariants of the analysis service (strategy scoring, backtesting, live evaluation, fundamentals-signal
producer, gRPC 50056). Does not restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-analysis**.

## Rules (`ANALYSIS-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **ANALYSIS-1** | **Tail-align (right-align) `ComputeIndicator` results to the input bars** — result point `i` goes at bar `i + (n − len(points))`, leading bars stay `None`. Never head-align (`result[0]→bar[0]`). | `ComputeIndicator` drops a contiguous warm-up head; head-aligning time-shifts every warm-up indicator series across rules/backtests/live/diagnostics — the PR #769 bug. | `align_indicator_points()` `app/services/evaluator.py:295`, used `:235`; also used in `app/handlers/servicer.py:797,802` (imported `:46`); PR #769 | `app/services/evaluator.py:295` |
| **ANALYSIS-2** | **The headline grade is evidence-weighted empirical-Bayes, not outcome-weighted**: `overall = (Σ wᵢ·sᵢ + 0.5·k)/(Σ wᵢ + k)` with `wᵢ = trading_days`, `k = analysis.scoring.shrinkage_days`; `Σw==0 → None` (never an equal-weighted fallback); `provisional` below `min_evidence_symbols`/`min_evidence_days`. | A last-run-wins or equal-weighted headline lets a throwaway single-symbol run overwrite a well-evidenced grade. | `_aggregate_cells` `servicer.py:2766`; provisional `:1366` | `app/handlers/servicer.py:2766` |
| **ANALYSIS-3** | **Evidence eligibility is keyed on a fingerprint of the DB-returned `definition_json`, excluding `display_name`/`active`/`live_enabled`** — hash the row, never the request proto dict; stamp only when `strategy_id == strategy_id_ref`. | Column-authoritative fields are overlaid at read time, so hashing the request won't canonicalize identically; including `display_name` would reset all evidence on a rename. `NULL` fingerprint cells never contribute (SQL `NULL = x` is never true). | `_definition_fingerprint` `servicer.py:2953`, stamped `:358-364`; filter `app/repositories/backtest_run_symbols.py:75` | `app/handlers/servicer.py:2953` |
| **ANALYSIS-4** | **The custom-formula evaluation path requires `len(raw) == n` and raises `FormulaExecutionError` on mismatch — it does NOT tail-align (unlike builtins, ANALYSIS-1).** | An arbitrary user formula has no contiguous-warm-up-head invariant, so tail-aligning a short list would silently misalign bars. | `app/services/evaluator.py:278-281` (`len(raw) != n → FormulaExecutionError`) | `app/services/evaluator.py:278-281` |
| **ANALYSIS-5** | **`_INDICATOR_SERIES` must stay in parity with the indicators engine's extra output keys** (`bb.upper`/`macd.signal`/`stoch.d`); dotted-ref strategy rules break otherwise. | The two are hand-maintained mirrors across service boundaries. | `app/services/evaluator.py:58-67`; owner xstockstrat-indicators | `app/services/evaluator.py:58-67` |
| **ANALYSIS-6** | **A strategy cannot be bound to a soft-deleted formula: write-time `_refuse_deleted_bindings` rejects the bind; read/run-time `_deleted_formula_warnings` surfaces `formula.deleted` as a warning** (feature 086 — cross-service mirror of indicators' soft-delete = filter-on-read). | Binding to a retired formula would run source the author soft-deleted; the guard depends on the `deleted` flag indicators sets, hand-mirrored across the service boundary (like ANALYSIS-5). | `_refuse_deleted_bindings` `app/handlers/servicer.py:255`, `_deleted_formula_warnings:229` (`_deleted_formula_warning:64`, `formula.deleted:251`); owner xstockstrat-indicators | `app/handlers/servicer.py:255` |
| **ANALYSIS-7** | **`_load_strategy_definition`'s live/watchlist read paths must gate on `active AND live_enabled`, mirroring `live_loop.py`'s own gate** — the two must never diverge. | `ListOpportunities`/watchlist-binding pickers had no such gate at all until `63a3655` — a binding to a disabled/deactivated strategy produced real-looking Decide-queue rows even though the live trading loop correctly excluded it. A future edit to either gate independently reintroduces the bug class. | fix `servicer.py` `_load_strategy_definition` (`active`/`live_enabled` check, feature 083 area); sibling gate `app/engine/live_loop.py`; `docs/reports/2026-08-07-disabled-strategies-usable.md` | `services/xstockstrat-analysis/app/handlers/servicer.py` (`_load_strategy_definition`) |

## Gotchas & scars

- **DB/ledger/notify writes are best-effort (`try/except → log.warning`), with ONE deliberate exception: `ScoreStrategy`'s stale-grade DB `delete` is *not* best-effort** (per CLAUDE.md). Evidence: `servicer.py` `ScoreStrategy:1231`, stale-grade deletes `:1269,1417`. (Instance of root PLAT-N1 + its documented exception.)
- **`analysis.strategy.scored` ledger event is emitted ONLY by `ScoreStrategy`, not by the RunBacktest/ManageStrategy-UPDATE recompute paths** (intentional, documented). Evidence: `servicer.py`, `CLAUDE.md:201`.
- **Python config zero-trap applies to *every* int/float/str key here except two explicit opt-outs** — a stored `0`/`""` reads as the default (root gotcha; also a defect in findings). This service added `get_int_present` (mirrors `get_bool`'s `HasField`) as a per-key escape hatch for exactly `analysis.strategy.default_exit_cooldown_days` and `analysis.opportunity.refresh_hour_utc` — every other int/float/str key here is still trapped. Evidence: `app/config/watcher.py:93,101,130` (trap) vs `:102-113` (`get_int_present`).
- **`resolve_environment`/`resolve_trading_mode` are hand-mirrored, byte-for-byte, across three Python services** (analysis, indicators, ingest) with no shared library. Extending or changing the env/mode resolution semantics in one and forgetting the other two silently reintroduces a scoping mismatch (see the SEV-1 scar below, which is exactly this class of bug). Evidence: `app/config/watcher.py:17-31`; identical diff shape confirmed in `services/xstockstrat-{indicators,ingest}/app/config/watcher.py` (commit `d7d185f`).
- **SEV-1 scar (root PLAT-8): `WatchConfig` silently subscribed at dev/unspecified scope for this service's entire lifetime until 2026-08-07.** Fixed by `d7d185f` (mirrors the earlier Go-side fix in trading/portfolio/marketdata).
- **`63a3655` — disabled strategies usable in the opportunities queue (see ANALYSIS-7).** `ListOpportunities`' `_load_strategy_definition` had no `active`/`live_enabled` gate at all — a watchlist bound to a disabled strategy still produced real-looking Decide-queue rows, even though `live_loop.py` correctly excluded it from actual order/alert execution. Full writeup: `docs/reports/2026-08-07-disabled-strategies-usable.md`.
- **`bef4258` — screener silently passed criteria it couldn't evaluate.** When FMP fundamentals were unavailable, fundamental criteria were dropped from `criterion_scores` but the result still defaulted to `status=OK, passed=true` — indistinguishable from a genuine pass. Fixed in `app/services/screener.py` to fail closed to `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA`. Full writeup: `docs/reports/2026-08-08-screener-fundamental-criteria-silently-inert.md`.

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Header propagation: filter inbound metadata to `x-user-id/x-access-scope/x-trace-id`, forward on all outbound | `servicer.py:270-273,296-299` (root PLAT-4) |
| asyncpg cap 2, single shared pool reused by all loops; PgBouncer `statement_cache_size=0` (root PLAT-7) | `app/main.py:47-55`; root pool budget |
| Per-strategy `asyncio.Lock` serializes recompute (single-process only) | `servicer.py` `_recompute_locks:183`; `CLAUDE.md` §Strategy Score Persistence |
| Feature 065 scoring config keys + zero-trap note | root `CLAUDE.md` §Config Governance Rules |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
