# Cross-Stock Score Derivation (feature 065)

> On-demand detail relocated from `CLAUDE.md` (context-forge just-in-time move). The **binding** invariants are ANALYSIS-2 / ANALYSIS-3 in `context-constitution.md`; this file is the design-level narrative.


The headline `StrategyScore` (served by `ListStrategies`/`GetStrategyReport`, materialized in
`strategy_scores`) is **derived from per-symbol evidence, not the last run**. The unit of evidence is
the **(symbol × window) cell** (`analysis.backtest_run_symbols`, migration `007`): every OK
`RunBacktest` buffers one cell per traded symbol (per-symbol Sharpe/drawdown/win-rate over that symbol's
own equity curve, plus `trading_days`, `total_trades`, the run's range, and a **definition
fingerprint**).

- **Fingerprint eligibility.** A cell is stamped with `_definition_fingerprint(definition_json)` — a
  sha256 over the DB `strategies` row's `definition_json` **excluding** `display_name`/`active`/
  `live_enabled` — only when the run executed the strategy's **own registered definition**
  (`strategy_id == strategy_id_ref`). Inline runs, the legacy-SMA fallback, id-mismatches, and
  unregistered ids leave the fingerprint `NULL` and never contribute to a headline. **Always hash a
  DB-returned `definition_json`, never a request proto dict** (column-authoritative fields are overlaid
  at read time — a request dict would not canonicalize identically). The fingerprint is sensitive to the
  exact `entry_rule`/`exit_rule` string encoding.
- **Traded-first dedup.** `fetch_eligible` returns one cell per symbol for a `(strategy, fingerprint)`
  via `DISTINCT ON (symbol) … ORDER BY (total_trades > 0) DESC, trading_days DESC, completed_at DESC` —
  traded evidence wins over a zero-trade cell, then most trading days, then newest. **Zero-trade cells
  ARE counted as evidence** (≈0.30 F-ish score); traded-first dedup ensures non-participation can never
  shadow real traded evidence, but a symbol with only zero-trade cells still contributes one. (Visible
  behavior shift vs. the old last-run headline.)
- **Aggregation.** `_aggregate_cells` weights each cell by `trading_days` and applies empirical-Bayes
  shrinkage toward a neutral 0.5 prior: `overall = (Σ wᵢ·sᵢ + 0.5·k) / (Σ wᵢ + k)`, `k =
  analysis.scoring.shrinkage_days`. Components are shrunk identically (weighted mean renormalized
  `wᵢ/Σw`, then the same shrinkage), non-finite components dropped. `Σw == 0` → no grade (never an
  equal-weighted fallback). **OQ-1 calibration anchors**: perfect evidence earns an A once total
  evidence `W ≥ 1.5·k` (`W = 375, k = 250 → 0.8`); a single 60-day perfect cell shrinks to
  `(60 + 125)/310 ≈ 0.597` (a provisional C). The grade is `provisional` below
  `min_evidence_symbols` (3) or `min_evidence_days` (500).
- **Recompute triggers (OQ-4 — in-request only; no background recompute).** The headline is recomputed,
  best-effort, after an OK `RunBacktest` (before the completion emit) and after a `ManageStrategy`
  UPDATE (which first **unconditionally clears** the in-memory grade — a definition change usually
  changes the fingerprint, so old evidence no longer applies; usually cleared until a fresh backtest).
  `ScoreStrategy` is the **manual refresh** (e.g. after a scoring-config change): it recomputes from
  cells and, on zero eligible evidence, clears the stale grade (in-memory pop + non-best-effort DB
  delete) then returns `NOT_FOUND "no eligible evidence — run a backtest"`; unregistered →
  `NOT_FOUND`; store/cells error → `UNAVAILABLE`. **`ScoreStrategyRequest.range` is ignored** (the
  evidence base is the whole eligible cell set, not a window).
- **Rename / revert semantics (FR-3).** Because the fingerprint excludes `display_name`/`active`/
  `live_enabled`, a **rename or live-toggle does not reset** evidence; reverting a definition to a prior
  content **resurrects** that content's evidence base (evidence describes definition content, not a
  timeline).
- **`analysis.strategy.scored` ledger event** stays **`ScoreStrategy`-only** (documented asymmetry — the
  RunBacktest/UPDATE recompute paths do not emit it).
- **Caveats.** `backtest_run_symbols` has **no retention/pruning** yet (evidence accumulates). The
  per-strategy `asyncio.Lock` serializing recompute is **single-process protection only** (no
  cross-instance guard). **OQ-6**: correlated symbols can inflate apparent breadth (accepted for v1;
  sector-capped weights via feature-059 fundamentals is the designated follow-up). **FR-9**: on first
  post-deploy recompute a legacy broad grade can **drop sharply** (cells-only evidence) — documented,
  not a regression.

As of Phase 3, RunBacktest executes a real SMA crossover engine (no more synthetic stubs) that:

1. Fetches OHLCV bars via `MarketDataService.GetBars`
2. Computes fast/slow SMAs via `IndicatorsService.ComputeIndicator`
3. Optionally calls `IngestService.QuerySignals` for newsletter signal weighting
4. Simulates trades bar-by-bar and computes Sharpe, drawdown, win rate, profit factor

