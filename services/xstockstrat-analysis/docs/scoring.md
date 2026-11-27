# Cross-Stock Score Derivation (feature 065)

> On-demand detail relocated from `CLAUDE.md` (context-forge just-in-time move). The **binding** invariants are ANALYSIS-2 / ANALYSIS-3 in `context-constitution.md`; this file is the design-level narrative.


The headline `StrategyScore` (served by `ListStrategies`/`GetStrategyReport`, materialized in
`strategy_scores`) is **derived from per-symbol evidence, not the last run**. The unit of evidence is
the **(symbol × window) cell** (`analysis.backtest_run_symbols`, migration `007`): every OK
`RunBacktest` buffers one cell per traded symbol (per-symbol Sharpe/drawdown/win-rate over that symbol's
own equity curve, plus `trading_days`, `total_trades`, the run's range, and a **definition
fingerprint**).

- **Fingerprint eligibility.** A cell is stamped with the **evidence fingerprint**
  `_evidence_fingerprint(definition_json, digests)`, and only when the run executed the strategy's
  **own registered definition** (`strategy_id == strategy_id_ref`). Its first part is the definition
  hash `_definition_fingerprint(definition_json)`: a sha256 over the DB `strategies` row's
  `definition_json`, **excluding** `display_name`/`active`/`live_enabled`/`origin`. A strategy with no
  CUSTOM_FORMULA component is stamped with the definition hash alone. A strategy with one is stamped
  with `<def_hash>.<sha256 of sorted fid=digest>` (feature 327). `_formula_digest` hashes only the
  referenced formula's behavioural fields (source, input schema, parameters without descriptions,
  output names, warmup, `fundamental_inputs`), never `updated_at`/`author`/descriptions. A formula
  edit therefore stops pre-edit evidence counting, while a display-only edit does not. The digests
  come from the run's single existing `GetFormula` read. If any referenced formula is in an outage or
  refused at backtest time, the run stamps `NULL`, and an outage also adds a run warning (see
  Recompute triggers). Inline runs, the legacy-SMA
  fallback, id-mismatches and unregistered ids also leave the fingerprint `NULL`, and those cells
  never contribute to a headline. **Always hash a DB-returned `definition_json`, never a request proto
  dict** (column-authoritative fields are overlaid at read time, so a request dict would not
  canonicalize identically). The fingerprint is sensitive to the exact `entry_rule`/`exit_rule`
  string encoding. Readiness verdicts keep keying on the definition hash alone.
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
  UPDATE. The UPDATE first clears the in-memory grade **only when the definition hash changes**. It
  compares the hash of the row `update_locked` locked, not the earlier pre-read, with the hash of the
  written row. A rename or live-toggle keeps the grade even when the recompute cannot run (for example
  during a `GetFormula` outage). A definition change changes the fingerprint, so old evidence no longer
  applies and the grade usually stays cleared until a fresh backtest.
  `ScoreStrategy` is the **manual refresh** (e.g. after a scoring-config change): it recomputes from
  cells and, on zero eligible evidence, clears the stale grade (in-memory pop + non-best-effort DB
  delete) then returns `NOT_FOUND "no eligible evidence — run a backtest"`; unregistered →
  `NOT_FOUND`; store/cells error → `UNAVAILABLE`. Two `ScoreStrategy` outcomes are specific to
  CUSTOM_FORMULA strategies (feature 327):
  - **`GetFormula` outage:** the call aborts before any cell read and the grade is unchanged. With
    `backtest.fundamentals.enabled` off the status is `UNAVAILABLE "formula version unavailable —
    grade unchanged"`. With the gate on it is the existing `UNAVAILABLE "fundamentals availability
    unknown — grade unchanged"`.
  - **Formula refused (NOT_FOUND/PERMISSION_DENIED):** the grade is derived from the newest
    formula-aware evidence recorded for the same definition hash
    (`latest_formula_fingerprint`), never from a pre-feature cell. If no such evidence exists, the
    stale grade is cleared and the call returns `NOT_FOUND "no eligible evidence — formula <ids> is not
    readable and no evidence was recorded for a readable version; restore access to the formula or
    rebind the component, then run a backtest"`.

  A registered own-definition `RunBacktest` whose formula read hit an outage records no evidence. It
  carries the run warning `"evidence not recorded: formula version unavailable — rerun"` in
  `warnings`. **`ScoreStrategyRequest.range` is ignored** (the
  evidence base is the whole eligible cell set, not a window). The refresh is also reachable through
  the agent's `manage_strategy operation='score'`, which reports the excluded symbols from the
  `x-score-excluded-symbols` trailer.
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

## Strategy Score Persistence (feature 064)

> **Feature 065 update**: the headline `StrategyScore` is now **derived** from per-symbol evidence
> cells rather than the latest run (see **Cross-Stock Score Derivation** below). The write-through +
> hydrate-at-boot mechanics described here are unchanged; `strategy_scores_v2` stays a materialized cache
> (now with `n_symbols`/`total_trading_days`/`provisional` provenance columns and a `delete` for
> clearing a stale grade). `ScoreStrategy` is repurposed as the manual recompute-from-cells refresh.

`ScoreStrategy` persists the latest `StrategyScore` per strategy to the `analysis.strategy_scores_v2`
table (upsert on `(user_id, strategy_id)`) in addition to the in-memory
`self._strategies` dict. The write is **best-effort** (FR-7): it mirrors the ledger-emit `try/except →
log.warning`, so a DB failure never fails scoring. Reads stay in-memory — `ListStrategies` /
`GetStrategyReport` still serve `self._strategies`; at boot `main.py` calls `servicer.hydrate_scores()`
(best-effort) to load persisted rows back into memory, so scores **survive a service restart**. Reuses
the existing asyncpg pool — no new pool (budget stays 2).

A `math.isfinite` guard drops non-finite component values before the JSONB write. The score
table (`strategy_scores_v2` since feature 224) has no retention or pagination yet (deactivated and ad-hoc-`strategy_id` scores persist and hydrate).

## Known limitations (feature 327)

- **Readiness** verdicts stay on the definition-only fingerprint. After a formula edit, a cached
  readiness row keeps serving its pre-edit verdict until its `valid_until`
  (`readiness_materializer.valid_window_hours`, 1 h floor) or the next daily bar
  (`app/services/readiness.py#is_readiness_row_fresh`).
- **The `ListStrategies` / `GetStrategyReport` headline** is not recomputed when a formula is edited.
  It stays stale until the next recompute: an OK `RunBacktest`, a `ManageStrategy` UPDATE, a
  `ScoreStrategy` or the boot pass.
- **A behavioural UPDATE during a `GetFormula` outage clears the grade.** The definition hash changed,
  so the grade is popped, and the recompute cannot run. The headline is absent until the next
  recompute. A rename keeps the grade.
- **A refusal grades on the last readable version.** While a referenced formula is refused, the grade
  comes from the newest composite recorded for the same definition hash. That composite reflects the
  formula as it was last readable, not its current content.
- **Mixed refused and readable formulas.** When one referenced formula is refused and another is
  readable, the newest composite is used as a whole. An edit to the readable formula is therefore not
  enforced while the other one stays refused.
- **Boot pass.** When indicators is not ready at boot, `recompute_unscored_pairs` cannot read the
  formula version and leaves CUSTOM_FORMULA pairs unscored (logged `boot recompute failed`) until the
  next recompute.
- **Rollout.** Every CUSTOM_FORMULA strategy gets a one-time evidence reset: its pre-feature cells
  carry the bare definition hash and stop matching. A strategy whose formula is refused at rollout
  and that holds only pre-feature cells answers `NOT_FOUND` (the "is not readable" message above)
  until the formula is readable again. Affected are instances of the analysis-migration-028 templates
  and the 029 `fundamentals_macd_blend`. A rerun cannot help while the formula is refused, because
  every symbol is a `FORMULA_ERROR`. The operator acknowledged this population in feature 327
  (2026-11-27).
