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
     `updated_at`. Only **registered** strategies (rows in `analysis.strategies`) are
     headline-scored; unregistered/ad-hoc `strategy_id`s record cells and run history but
     earn no headline and write no `strategy_scores` row (OQ-3 resolution — also stops the
     pre-existing `strategy_scores` pollution by ad-hoc ids).
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
NOT_FOUND when the strategy is unregistered (OQ-3) or has no eligible cells.

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

FR-10. **Test-infrastructure seeding** *(scope addition 2026-07-13, user-directed — recorded
in context.md)*. (a) Seed a vitest unit-test layer in `xstockstrat-ui` (node-environment
logic tests; coverage scoped to `src/lib/**` at the 40% platform floor; component/jsdom
testing out of scope) so UI logic introduced by this feature (`scoreDisplay.ts`, the NotFound
retry predicate) carries a true red-green unit gate instead of e2e-only coverage. (b) Wire
the existing `xstockstrat-agent` test suite into CI (`changes` filter + `python-lint`/
`python-test` matrix entries, threshold 40) — today the agent has tests but no CI job — and
add `xstockstrat-ui` to the `node-test` job so the new unit suite runs on every PR.

## Out of Scope

- Correlation/sector-aware effective-weight adjustments (correlated symbols still count as
  independent breadth in v1 — documented caveat).
- Dispersion/consistency penalty (mean − λ·std across cells) — possible follow-up once the
  shrinkage-only ranking is observed.
- Pinned per-strategy benchmark configurations ("official evaluation run").
- Changing the per-run aggregate metrics or the sequential cross-symbol equity compounding in
  the backtest engine.
- Retention/pagination for `strategy_scores` (pre-existing gap, noted in service CLAUDE.md;
  new pollution is stopped by the OQ-3 resolution, but existing ad-hoc rows are not cleaned
  up here).
- Adding total return as a fourth score component (decided OQ-2: not in v1; opt-in
  `return_weight` key is the documented retrofit path).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — evidence-cell persistence, headline derivation, recompute
  triggers, migration, config keys (owns the feature)
- `xstockstrat-ui` — score card / strategies list provenance display, provisional treatment,
  run-score vs strategy-grade labeling
- `packages/proto` — additive fields on `StrategyScore` (evidence provenance, provisional);
  no breaking changes
- `xstockstrat-agent` — *(added at design phase, user-signed)* one-line caller-parity fix:
  the agent backtest client sends `strategy_id_ref=strategy_id` so agent-triggered runs
  execute the registered definition and contribute evidence (see design.md § Callers)

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

Each question is expanded with candidate resolutions, their trade-offs, and a recommended
resolution. **All six recommendations were confirmed by the user on 2026-07-12** (recorded in
`context.md`); the OQ-3 FR deltas are folded into FR-2a and FR-6. The analyses are retained
below as the decision record.

### OQ-1. Default calibration (`shrinkage_days`, provisional floor)

- [x] **Resolved 2026-07-12**: option (a) confirmed — `shrinkage_days=250`, floor 3 symbols / 500 days.

The shrinkage formula gives closed-form calibration anchors: for a strategy whose cells all
score `s`, the headline is `(W·s + 0.5k)/(W + k)` where `W` = total symbol trading days. So
with *perfect* cells (`s=1.0`), grade B (≥0.65) requires `W ≥ 0.43k` and grade A (≥0.8)
requires `W ≥ 1.5k`. Calibrate `k` by choosing how much perfect evidence an A should cost.

| Option | Pros | Trade-offs |
|---|---|---|
| **(a) `k=250` (proposed)** — A needs ≥375 perfect symbol-days (~1.5 symbol-years); B needs ~107 | Interpretable ("one symbol-year of agnosticism"); an A is genuinely hard to fluke; at the 500-day floor an A is *just* reachable, so floor and prior are coherent | New strategies live near C for their first symbol-year; may feel sluggish to users exploring |
| (b) `k=60` (fast grades) | Grades respond quickly to early evidence | A single lucky 90-day run mints a B+/A — reintroduces exactly the failure this feature exists to fix |
| (c) `k=500` (very skeptical) | Nearly fluke-proof | A requires 3 perfect symbol-years; most real strategies plateau at C/B; discourages use of the grade |

**Recommendation: (a)**, and document the calibration rule (`A ⇔ W ≥ 1.5k` at perfect
metrics) in the service CLAUDE.md so future tuning is principled, not vibes. All three values
are config keys — wrong guesses are correctable per environment without a code change.

### OQ-2. Total return as a fourth score component

- [x] **Resolved 2026-07-12**: option (a) confirmed — keep the three-component blend.

Today `total_return` affects nothing in the score (Sharpe/drawdown/win-rate only), so a
high-Sharpe, tiny-absolute-return strategy can grade A.

| Option | Pros | Trade-offs |
|---|---|---|
| **(a) Keep three components (proposed)** | One statistical change at a time — grade drift after this feature is attributable to the derivation change alone; return magnitude already leaks into Sharpe's numerator | The "profitable but only barely" A remains possible |
| (b) Add `analysis.scoring.return_weight` defaulting to `0.0` | Closes the question permanently with a knob; zero behavior change until opted in | Needs a normalization constant (e.g. clip annualized return at 30% → [0,1]) — a new magic number; speculative config surface (scope-creep ledger category) for a knob nobody has asked to turn |
| (c) Add it weighted now (e.g. 0.2, renormalize others) | Grade reflects economic outcome, not just risk-adjusted shape | Changes every existing grade at deploy simultaneously with the derivation change — two confounded changes; weight redistribution needs a config migration |

**Recommendation: (a)** — defer, keep in Out of Scope. Revisit only if post-launch rankings
surface the barely-profitable-A problem in practice; (b) is the cheap retrofit if so.

### OQ-3. Ad-hoc (unregistered) `strategy_id`s

- [x] **Resolved 2026-07-12**: option (b) confirmed — registered definitions only (FR-2a/FR-6 updated).

`RunBacktest` accepts any `strategy_id` string; unregistered ids have no
`analysis.strategies` row, hence no `updated_at` for the eligibility filter — and today they
pollute `strategy_scores` with rows the UI never shows (pre-existing gap noted in the service
CLAUDE.md).

| Option | Pros | Trade-offs |
|---|---|---|
| (a) All cells eligible (no reset semantics) | Preserves current behavior for MCP-agent ad-hoc backtests; `GetStrategyReport` keeps returning a score | Grade has no definition to describe — "evidence for what, exactly?"; pollution/retention gap grows a second table (cells) |
| **(b) Registered definitions only (proposed)** — ad-hoc runs still record history + per-run scores, but no headline; `ScoreStrategy` on an ad-hoc id → NOT_FOUND | The grade means one thing: "how the current registered definition performs"; fixes the pollution gap instead of extending it; UI unaffected (the list is definitions-driven already) | Small behavior change for agent flows that call `ScoreStrategy`/`GetStrategyReport` on ad-hoc ids (they keep `RunBacktest`'s full result, so nothing of substance is lost) |
| (c) Synthesize `updated_at` from first-seen cell | Keeps ad-hoc scoring with pseudo-reset semantics | Complexity for a value nobody displays; first-seen is not a meaningful reset boundary |

**Recommendation: (b)**. FR delta if confirmed: FR-2a drops its ad-hoc clause ("ad-hoc ids
use all their cells" → "unregistered ids are not headline-scored"), and FR-6's NOT_FOUND
covers unregistered ids explicitly.

### OQ-4. Recompute placement

- [x] **Resolved 2026-07-12**: option (a) confirmed — in-request recompute only.

| Option | Pros | Trade-offs |
|---|---|---|
| **(a) In-request only (proposed)** — recompute after each `RunBacktest`, on `ManageStrategy UPDATE`, and on `ScoreStrategy`; boot keeps hydrating the materialized rows | Simplest; one indexed query per trigger; preserves the write-through+hydrate pattern verbatim (ledger insight 2026-07-03); no boot-time cost | A scoring-config change (weights, `shrinkage_days`) doesn't re-grade a strategy until its next trigger — grades are "policy at last recompute", not "current policy" |
| (b) Recompute-all at boot instead of hydrate | Policy changes propagate on every restart | O(strategies × cells) boot work; replaces the proven hydrate read path (contradicts the ledger insight); config changes still stale between restarts |
| (c) (a) + admin bulk-recompute RPC/loop | Full freshness control | New RPC + admin surface for a rare operation — scope creep; `ScoreStrategy` already *is* the per-strategy manual refresh |

**Recommendation: (a)**, with the staleness semantics documented in the service CLAUDE.md:
`ScoreStrategy` is the manual refresh after a scoring-config change. If bulk refresh is ever
needed, it's a follow-up, not this feature.

### OQ-5. C-10(b) labeling — run score vs strategy grade (known trap)

- [x] **Resolved 2026-07-12**: confirmed — labeling copy + both-labels-render test.

Ledger fail 2026-07-01 (056-open-positions-ui): two read paths surfacing one value diverge
silently. Here the divergence is *by design* — the Past Runs table shows what each run earned
alone; the headline is derived from cells. The closure is legibility, not parity:

- Score card title becomes **"Strategy Grade"** with the evidence line (FR-7) as its caption
  ("Derived from N symbols · X symbol-years — individual runs are graded separately").
- Past Runs `Score` column header becomes **"Run score"**.
- A Playwright assertion checks both labels render on the strategy detail page (the
  reachability-test analogue that C-10 entries keep flagging as the missing enforcement).

**Recommendation: adopt as stated** — this resolves into concrete FR-7/FR-8 copy at design
time; the alternative (forcing the headline to equal the last run's score) is the status quo
this feature removes.

### OQ-6. Correlated-symbol breadth inflation (known caveat)

- [x] **Resolved 2026-07-12**: option (a) confirmed — accept for v1; sector-capped weights (via feature-059 sector data) is the named follow-up.

Twelve mega-cap tech cells over the same bull window are not twelve independent observations;
symbol-day weighting can't see that.

| Option | Pros | Trade-offs |
|---|---|---|
| **(a) Accept + document (proposed)** | Zero added complexity; honest via the provenance line (users see *which* breadth backs a grade via their own run inputs) | An all-one-sector A overstates robustness |
| (b) Sector-capped effective weight (sector via the FMP fundamentals cache, feature 059) | Principled discount; data source already exists in-platform | Couples scoring to fundamentals coverage (marketdata `GetFundamentalsMulti`, cache TTLs, symbols missing sector data); meaningful design surface — wrong size for v1 |
| (c) Time-window overlap discount | Attacks the same-regime problem directly | Requires pairwise window-overlap math per recompute; hard to explain in the UI |

**Recommendation: (a)** for v1, with the revisit trigger written down: if launched grades are
observed to reward single-sector/single-window breadth misleadingly, open a follow-up feature
for (b) — (b) is the natural successor because the sector data already flows through
marketdata. Record the caveat in the service CLAUDE.md scoring section.
