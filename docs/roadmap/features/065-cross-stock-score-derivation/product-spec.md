# Product Spec: cross-stock-score-derivation

**Created**: 2026-07-12

---

## Problem Statement

The headline strategy score (`analysis.strategy_scores`, shown as the A–F grade on the
strategies list and detail score card) is a plain upsert of whatever backtest ran last. It is
not keyed by the backtest's inputs, so a throwaway run over one symbol or a short window
silently overwrites a well-evidenced full-universe grade — the UI's default backtest form is a
single-symbol run, making this the *normal* interaction, not an edge case. The grade a user
sees is a property of one arbitrary run, not of the strategy.

## User Story

As a strategy author, I want the headline grade to be derived statistically from all
per-symbol backtest evidence accumulated for the current strategy definition, so that a high
grade is earnable only through breadth and duration across stocks, exploratory runs can never
degrade or fake a grade, and I can see exactly how much evidence backs the grade shown.

## Functional Requirements

FR-1. **Per-symbol evidence cells.** Every `RunBacktest` persists, per successfully simulated
symbol, a result cell in a new `analysis.backtest_run_symbols` table: symbol, per-symbol
metrics (sharpe ratio, max drawdown, win rate, total return, total trades), trading-day count,
and the run's date range, keyed to the parent `backtest_id`/`strategy_id`. The engine already
produces per-symbol trades and equity paths before aggregating; cells reuse that data.
Symbols that raise `_InsufficientData` or error out contribute no cell; runs whose overall
status is not OK contribute no cells.

FR-2. **Headline derivation.** The strategy's headline score is derived from eligible cells:

  a. *Eligible*: cells from OK runs whose `completed_at` postdates the strategy definition's
     `updated_at` (registered strategies; ad-hoc `strategy_id`s have no definition row and use
     all their cells).
  b. *Dedup*: exactly one cell per symbol — the cell with the most trading days wins;
     tie-break newest `completed_at`. Re-running the same window adds no weight; a shorter run
     can never displace a longer one for the same symbol.
  c. *Cell score*: each surviving cell is scored with the existing component math
     (`_score_from_result` formula: sharpe/drawdown/win-rate blend, `analysis.scoring.*`
     weights) applied to the cell's own metrics.
  d. *Aggregate*: `headline = (Σ wᵢ·scoreᵢ + k·0.5) / (Σ wᵢ + k)` where `wᵢ` = the cell's
     trading days and `k` = `analysis.scoring.shrinkage_days` (empirical-Bayes shrinkage
     toward a neutral 0.5 prior). The letter rating uses the existing grade thresholds on the
     shrunk score. Component scores in the persisted headline are the same weighted blend of
     the cells' components.

FR-3. **Reset on definition update.** `ManageStrategy UPDATE` triggers a headline recompute;
with no post-update cells this lands on "not scored yet" (the strategies list already renders
that state). Pre-update cells remain in history but are no longer eligible evidence.

FR-4. **`strategy_scores` becomes a materialized cache of the derivation.** `RunBacktest`
recomputes the headline from cells after persisting the run (instead of upserting its own
run's score). The write-through + hydrate-at-boot read path is preserved unchanged
(`ListStrategies`/`GetStrategyReport` serve `self._strategies`; `hydrate_scores` at boot) —
per ledger insight 2026-07-03 (persist-strategy-scores). All persistence stays best-effort
(`try/except → log.warning`); a DB failure never fails a run. No new DB pool (budget stays 2).

FR-5. **Evidence provenance on the score.** The persisted headline carries provenance:
number of distinct symbols and total symbol trading days behind the grade, and a
`provisional` flag set when evidence is below the configured floor
(`analysis.scoring.min_evidence_symbols` / `analysis.scoring.min_evidence_days`). Exposed as
additive fields on the `StrategyScore` proto message.

FR-6. **`ScoreStrategy` repurposed.** The RPC recomputes the headline from cells under the
current scoring config and persists it (its current behavior — re-scoring the latest
in-memory backtest — is redundant now that `RunBacktest` auto-scores). Callers unchanged;
NOT_FOUND when the strategy has no eligible cells.

FR-7. **UI provenance display.** The score card (strategy detail) and the strategies-list
card show the evidence line (e.g. "B · 74% · 12 symbols · 8.4 symbol-years") and a distinct
provisional treatment when `provisional` is set. The "Not scored yet" empty state is retained.

FR-8. **Run history stays run-level — divergence is labeled.** The Past Runs table keeps
showing per-run aggregate metrics and the per-run score the run *would* earn alone; the
headline is a different quantity derived from cells. Because two read paths now surface
"score" with different meanings, the UI must label them distinctly (e.g. "run score" vs
"strategy grade") — this is the C-10(b) two-read-paths trap from the ledger, designed out by
explicit labeling rather than forced parity (they are intentionally different values).

FR-9. **Backward compatibility for pre-existing runs.** Runs recorded before this feature
have no symbol cells and therefore contribute no evidence. An existing strategy keeps its
current materialized `strategy_scores` row until the first post-deploy event that triggers a
recompute (new run, definition update, or explicit `ScoreStrategy`); the first recompute
derives from cells only. No cell backfill from run-level aggregates (they are not per-symbol
and would poison the evidence base).

## Out of Scope

- Correlation/sector-aware effective-weight adjustments (correlated symbols still count as
  independent breadth in v1 — documented caveat).
- Dispersion/consistency penalty (mean − λ·std across cells) — possible follow-up once the
  shrinkage-only ranking is observed.
- Pinned per-strategy benchmark configurations ("official evaluation run").
- Changing the per-run aggregate metrics or the sequential cross-symbol equity compounding in
  the backtest engine.
- Retention/pagination for `strategy_scores` or ad-hoc-strategy_id cleanup (pre-existing gap,
  noted in service CLAUDE.md).
- Adding total return as a fourth score component (open question; default is the existing
  three-component blend).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — evidence-cell persistence, headline derivation, recompute
  triggers, migration, config keys (owns the feature)
- `xstockstrat-ui` — score card / strategies list provenance display, provisional treatment,
  run-score vs strategy-grade labeling
- `packages/proto` — additive fields on `StrategyScore` (evidence provenance, provisional);
  no breaking changes

## Proto Contract Changes

- [ ] ~~No proto changes required~~
- Additive, non-breaking fields on `analysis.v1.StrategyScore`: evidence symbol count,
  evidence trading-day total, `provisional` bool. (Optional, decide at spec time: additive
  `range_start`/`range_end` on `BacktestRunSummary` for Past Runs provenance.) Zero-value
  defaults keep old clients working; `buf breaking` must pass.

## Config Key Changes

- [ ] ~~No new config keys~~
- `analysis.scoring.shrinkage_days` — int, default `250` — empirical-Bayes pseudo-count in
  trading days pulling the headline toward the neutral 0.5 prior (≈ one symbol-year of
  agnosticism).
- `analysis.scoring.min_evidence_symbols` — int, default `3` — distinct symbols below which
  the headline is flagged provisional.
- `analysis.scoring.min_evidence_days` — int, default `500` — total symbol trading days below
  which the headline is flagged provisional.

Existing `analysis.scoring.{sharpe,drawdown,win_rate}_weight` keys are reused unchanged for
cell scoring.

## Database Changes

- [ ] ~~No schema changes~~
- `xstockstrat-analysis` migration `007` (up+down):
  - New table `analysis.backtest_run_symbols` — per-symbol evidence cells:
    `backtest_id`, `strategy_id`, `symbol`, per-symbol metrics (sharpe, max drawdown,
    win rate, total return, total trades), `trading_days`, `range_start`, `range_end`,
    `completed_at`; PK `(backtest_id, symbol)`; index on `(strategy_id, symbol,
    trading_days DESC)` to serve the dedup-by-most-evidence read.
  - `analysis.backtest_runs`: add nullable `range_start`/`range_end` columns (run-level
    provenance; nullable so pre-existing rows stay valid).
  - `analysis.strategy_scores`: add evidence-provenance columns (`n_symbols`,
    `total_trading_days`, `provisional`), defaulted so existing rows hydrate unchanged.

## Feature Workflow Notes

Branch to create: `feature/cross-stock-score-derivation` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change) — _not required; additive only_
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

1. Running a short single-symbol backtest against a strategy that already has broad
   evidence (many symbols, long windows) changes the headline only by adding/updating that
   one symbol's cell — it can never replace the grade wholesale, and re-running an identical
   window leaves the headline unchanged.
2. A shorter run on a symbol never displaces a longer run's cell for that symbol (max
   trading days wins; ties go to the newer run).
3. A strategy with a single lucky short run (e.g. one symbol, 60 trading days, perfect
   metrics) receives a shrunk headline near the neutral prior (grade ≈ C with default
   `shrinkage_days=250`), flagged provisional; the same metrics across ≥ the evidence floor
   of symbols/days yield a high grade without the provisional flag.
4. `ManageStrategy UPDATE` resets the headline: immediately after an update with no new
   runs, the strategies list shows "Not scored yet" for that strategy; pre-update cells no
   longer count after the next recompute.
5. INSUFFICIENT_DATA runs and errored symbols produce no evidence cells and do not move the
   headline; they still appear in the Past Runs history.
6. `ScoreStrategy` recomputes the headline from cells under current config weights and
   returns it; it no longer depends on the in-memory latest backtest.
7. Scores survive a service restart with provenance intact (hydrate path), and a DB outage
   during any persistence step logs a warning without failing the backtest RPC.
8. The strategy detail score card and strategies-list card display symbols count and
   symbol-days behind the grade; provisional grades are visually distinct; the Past Runs
   table labels its per-run score distinctly from the strategy grade.
9. `buf lint` and `buf breaking` pass; migration 007 applies and rolls back cleanly via
   `scripts/db-migrate.sh`; analysis coverage stays ≥ 40%.

## Open Questions

- [ ] Default calibration: is `shrinkage_days=250` the right skepticism level, and are
      `min_evidence_symbols=3` / `min_evidence_days=500` the right provisional floor?
      (Product decision; safe to tune later via config without code changes.)
- [ ] Should total return join the component blend as a fourth weighted component (it
      currently affects nothing in the score)? Deferred out of scope by default.
- [ ] Ad-hoc (unregistered) `strategy_id`s have no `updated_at` — confirm "all cells
      eligible" is acceptable for them, or exclude ad-hoc ids from scoring entirely.
- [ ] Where should the headline recompute run — in-request after each backtest (adds one
      indexed query per run) vs. also exposed as a bulk recompute at boot? In-request only is
      the default proposal.
- [ ] **Known trap (ledger, C-10(b) 056-open-positions-ui):** two read paths will surface a
      "score" with different meanings (per-run score in Past Runs vs derived strategy grade).
      Parity is *intentionally* not wanted here — the design phase must instead specify
      labeling/copy so the divergence is legible, and a test asserting both surfaces render
      their distinct labels.
- [ ] **Known caveat:** correlated symbols (e.g. 12 mega-cap tech names over the same bull
      window) inflate effective breadth; v1 accepts this and documents it. Revisit only if
      observed rankings mislead.
