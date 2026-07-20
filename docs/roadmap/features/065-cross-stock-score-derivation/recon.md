# Recon: cross-stock-score-derivation

**Created**: 2026-07-12
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-ui, packages/proto

---

## Objective

Replace the last-run-wins headline strategy score with a derivation over per-symbol backtest
evidence cells: persist (symbol × window) results from every `RunBacktest` into a new
`analysis.backtest_run_symbols` table, dedupe one cell per symbol (most trading days wins),
score cells with the existing component math, and aggregate with trading-day evidence weights
plus empirical-Bayes shrinkage toward 0.5 — materialized into `strategy_scores` with evidence
provenance, registered strategies only, reset on definition update.

## Codebase Map

- **`xstockstrat-analysis`** (Python 3.12, grpc.aio)
  - Entry point / boot wiring: `app/main.py:47-49` (asyncpg pool, `DB_POOL_MAX` default 2),
    servicer construction `app/main.py:52-61`, best-effort `hydrate_scores()` boot call
    `app/main.py:84-92`
  - Servicer (single 1406-line file): `app/handlers/servicer.py` — repos constructed inline in
    `__init__` (`:89` strategies, `:93` scores, `:97` backtest_runs; all `None` in the no-DB
    test path)
  - `RunBacktest` `:155`; per-symbol loop `:269-325` — each `_backtest_symbol*` call returns
    `(trades, equity, daily_eq, sym_diag)` per symbol, merged into aggregates at `:298-300`.
    **The per-symbol cell insertion point is between the call and those `extend`s** —
    `daily_eq`/`trades` are still per-symbol there
  - `_backtest_symbol` `:399` (returns `:644`; `daily_equity` seeded `:519`, one append per
    bar); `_backtest_symbol_evaluated` `:646` (returns `:791`; seed `:713`, append `:762`)
  - **Sequential equity compounding**: both symbol helpers receive the *running* cross-symbol
    `equity` as `initial_equity` (`:261-262`, reassigned `:272`/`:283`) — per-symbol metrics
    must use the symbol's own starting equity (`daily_eq[0]`)
  - `_compute_metrics(daily_equity, trades, initial_equity) -> dict` `:1361` — pure
    numpy function; `n_days = len(daily_equity) - 1` `:1378` is the trading-day count source;
    **directly reusable per symbol** (called exactly once today, on the merged curve `:328`)
  - `_score_from_result(strategy_id, result, w_s, w_d, w_w) -> StrategyScore` `:1234`;
    component clamps `:1246-1248`, blend `:1250`, grade thresholds 0.8/0.65/0.5/0.35
    `:1256-1265`; takes a `BacktestResult` proto (cell scoring needs a result-like object or a
    raw-metrics refactor)
  - `_persist_strategy_score` `:881` (in-memory write `:889`, `math.isfinite` filter `:893`,
    best-effort upsert `:894-898`); `_persist_backtest_run` `:900`; `hydrate_scores` `:930`
  - `ScoreStrategy` `:830` (reads in-memory `self._backtests` `:841`; NOT_FOUND `:843-847`)
  - `ManageStrategy` `:979`; **UPDATE branch `:1000-1014` — no score/recompute hook today**
  - `ListStrategies` `:943`, `GetStrategyReport` `:947`, `ListBacktests` `:961` (limit
    default 20 `:971`), `_row_to_score` `:1312`, `_row_to_backtest_summary` `:1279`
  - Repos: `StrategyScoresRepository.upsert` `app/repositories/strategy_scores.py:32`
    (ON CONFLICT strategy_id, `updated_at=NOW()` `:48`), `_to_dict` JSONB decode `:13-23`;
    `BacktestRunsRepository.insert` `app/repositories/backtest_runs.py:25` (ON CONFLICT DO
    NOTHING `:43`), `list_by_strategy` `:62`; **`StrategiesRepository.update`
    `app/repositories/strategies.py:54` sets `updated_at = NOW()` `:60` and `RETURNING *`** —
    the eligibility boundary source (`migrations/001_strategies.up.sql:7`)
  - Last migration: `006_backtest_runs.up.sql` (next = **007**); 005 schema
    `migrations/005_strategy_scores.up.sql:1-8`; 006 schema + index
    `migrations/006_backtest_runs.up.sql:5-25` (no range columns today)
  - Config-read pattern: `ConfigWatcher` `app/config/watcher.py:15`; `get_int:68`
    (**`v.int_val or default` — a stored 0 falls back to the default**), `get_float:84`;
    weight-read pattern to mirror: `servicer.py:367-369`, `:836-838`
  - Tests: `tests/test_analysis_servicer.py` — no-DB `make_servicer()` factory `:22-35`,
    `TestRunBacktestPersistence` `:289` (score persist `:301`, history row `:319`,
    insufficient-no-score `:338`, persist-failure-never-fails `:362`), hydrate tests `:1313`,
    `:1339`; repo mock-pool tests `tests/test_strategy_scores_repo.py:17-113`,
    `tests/test_backtest_runs_repo.py:28-99`. Coverage: CI `--cov-fail-under=40`
    (`services/xstockstrat-analysis/CLAUDE.md:190`)

- **`xstockstrat-ui`** (Next.js 15)
  - Strategies list: `src/app/insights/strategies/page.tsx` — `ratingVariant` `:15`,
    `scoreColor` `:22`, score merge `:40`, rating badge `:91-93`, score block `:96-117`,
    "Not scored yet" `:119-121`, muted-badge precedent (`secondary` "inactive") `:90`
  - Strategy detail: `src/app/insights/strategies/[id]/page.tsx` — score card `:121-147`
    (title "Strategy Score" `:124`), Past Runs table `:384` (`data-testid="past-runs"`,
    Score column header `:398`, rating cell `:426-432`), post-run invalidation of both query
    keys `:91-92`
  - **Third render site (not in product-spec)**: insights dashboard `src/app/insights/page.tsx`
    renders rating badge / scoreColor / "Not scored" `:122-131` with its **own duplicated
    `ratingVariant`** `:219`
  - Hooks: `src/hooks/useStrategies.ts` — `useStrategies` `:13-17`, `useStrategyReport`
    `:25-29`, `useBacktestHistory` `:38-42`
  - Client: `src/lib/browserClients/analysisClient.ts:3-6`; `StrategyScore` type import
    `strategies/page.tsx:13` from `@xstockstrat/proto/analysis/v1/analysis_pb`
    (workspace dep `package.json:36`; additive proto fields are zero-default-safe)
  - Badge variants: `src/components/ui/badge.tsx:9-20` (`default, secondary, destructive,
    outline, buy, sell, paper, live, warning, info`)
  - E2E: `e2e/insights/backtest-coverage.spec.ts:47-60` — **asserts
    `getByText('Strategy Score')` `:52`** (breaks on rename; natural home for the
    both-labels test); mock fixtures `e2e/mock-backend.ts:398-424` (listStrategies scores),
    `:497-512` (getStrategyReport), `:513-553` (listBacktests); dashboard mocks
    `e2e/insights/dashboard.spec.ts:44-62`, score assertions `:124-134`

- **`packages/proto`**
  - `analysis/v1/analysis.proto` — `StrategyScore` `:136-141` (fields 1–4; **next free 5**);
    `BacktestRunSummary` `:159-174` (fields 1–14; **next free 15**); `StrategyReport`
    `:143-148`; Timestamp import `:7`, usage precedent `:66`, `:173`;
    `xstockstrat.common.v1.TimeRange` precedent `:30`; **no reserved ranges**
  - Codegen: `buf.gen.yaml:1-45` (Go + TS plugins; Python via grpc_tools in
    `scripts/buf-gen.sh:35-66`); stubs land in `packages/proto/gen/{go,python,ts}`

## Patterns to REUSE

- **Per-symbol metrics** → reuse `_compute_metrics` per symbol
  (`servicer.py:1361`) called with the symbol's own `daily_eq` + `trades` + `daily_eq[0]` as
  initial equity, at the loop insertion point `servicer.py:298-299`. Do NOT write a second
  metrics function.
- **Cell scoring** → reuse `_score_from_result`'s component math (`servicer.py:1234`) —
  refactor to a raw-metrics core shared by proto-result and cell callers (additive sibling,
  per ledger insight 2026-07-08: keep the existing signature delegating).
- **New cells repo** → mirror `BacktestRunsRepository` style (`backtest_runs.py:19-73`):
  keyword-only insert, ON CONFLICT DO NOTHING, `_to_dict`, mock-pool test pattern
  (`tests/test_backtest_runs_repo.py:28`).
- **Provenance columns on `strategy_scores`** → extend `StrategyScoresRepository.upsert`
  (`strategy_scores.py:32`) rather than a new repo/table.
- **Durability shape** → write-through + hydrate-at-boot unchanged (ledger insight
  2026-07-03): `_persist_strategy_score` (`servicer.py:881`) stays the single write funnel;
  `hydrate_scores` (`servicer.py:930`) + `_row_to_score` (`servicer.py:1312`) gain the
  provenance fields.
- **Config reads** → mirror the `get_float`/`get_int` fallback pattern (`servicer.py:367-369`);
  **no config seed migration needed** — `analysis.scoring.*`, `analysis.screener.*`, and
  `analysis.backtest.max_range_days` are all code-fallback-only by established precedent.
- **Proto additive fields** → scalars on `StrategyScore` from field 5; if `BacktestRunSummary`
  range lands, reuse `google.protobuf.Timestamp` per `:173` precedent (fields 15/16).
- **Provisional badge** → reuse `Badge variant="secondary"` precedent
  (`strategies/page.tsx:90`); **de-duplicate `ratingVariant`/`scoreColor`** into a shared
  module instead of adding a third copy (DRY guard rail + C-10).
- **E2E fixtures** → extend existing mock-backend score fixtures (`mock-backend.ts:398-424`,
  `:497-512`) with the new fields; extend `backtest-coverage.spec.ts` for the both-labels
  assertion.

## Dependencies

- Proto/RPC: additive fields on `StrategyScore` (5, 6, 7: evidence_symbols int32,
  evidence_days int32, provisional bool — exact names at spec time) and optionally
  `BacktestRunSummary` 15/16 (`range_start`/`range_end` Timestamps). No new RPCs. `buf
  breaking` must pass; run `./scripts/buf-gen.sh`.
- Migration: next number **007** for `services/xstockstrat-analysis/migrations/` (new table
  `backtest_run_symbols`; ALTER `backtest_runs` + `strategy_scores`). No config-service seed
  migration (fallback-only precedent); if that decision is reversed, config next free is 009.
- Config keys: new `analysis.scoring.shrinkage_days` (int, 250),
  `analysis.scoring.min_evidence_symbols` (int, 3), `analysis.scoring.min_evidence_days`
  (int, 500); existing `analysis.scoring.{sharpe,drawdown,win_rate}_weight` reused.
- Inter-service edges: none new (analysis-internal + UI reads via existing BFF).
- New env vars / ports: none.

## Risks / Not-found

- **Per-symbol metrics computation does not exist anywhere** — net-new logic; per-symbol
  `trades`/`daily_eq` are currently discarded into aggregates at `servicer.py:298-299`.
- **No shrinkage/weighted-mean/statistics helper exists** in the service — the aggregator is
  net-new code (only unrelated `_quantile` in `fundsignal_loop.py:456`).
- **No recompute/aggregation SQL exists** — first query in the service to aggregate across a
  table (cells per strategy); index design in 007 must serve it.
- **`ManageStrategy` UPDATE has no score hook** (`servicer.py:1000-1014`) — recompute-on-update
  is net-new; decide in-request behavior on recompute failure (best-effort like persists).
- **`get_int` falsy-default trap** (`watcher.py:68`): a stored `0` falls back to the code
  default — `min_evidence_*=0` cannot be expressed via config as "disable the floor"; design
  the semantics accordingly (fails.md-adjacent; document, don't fight it in this feature).
- **`_score_from_result` takes a proto** — cell scoring needs a shared raw-metrics core;
  refactor must keep existing callers/tests green (ledger insight 2026-07-08 sibling pattern).
- **Sequential cross-symbol equity compounding** means run-level metrics ≠ aggregate of cell
  metrics — intentional (FR-8) but the divergence now exists in *data*, not just display;
  labeling (OQ-5) is the mitigation.
- **Third UI render site** (insights dashboard `src/app/insights/page.tsx:122-131`, duplicated
  `ratingVariant` `:219`) — product-spec's FR-7 lists only the two strategies surfaces;
  C-10 requires deciding the dashboard treatment (at minimum: shared helper de-dup; likely
  also the provisional badge).
- **E2E `getByText('Strategy Score')` assertion** (`backtest-coverage.spec.ts:52`) breaks on
  the "Strategy Grade" rename — must be updated in the same step as the rename.
- **FR-9 UX cliff** (accepted, documented): legacy broad grades drop to cells-only evidence on
  first post-deploy recompute.
- No number-formatting helper for "symbol-years" and no tooltip component in the UI kit — the
  evidence line is plain text + a small new formatter.
- fails.md traps carried: C-10(b) two-read-paths labeling (056); C-10(a) nav-reachability N/A
  (no new route); C-10(c) seeded-resource N/A.

## Recommended Scope

Advisory step boundaries for grilling + /sdd-spec:

1. **proto** — additive `StrategyScore` fields (+ `BacktestRunSummary` range decision) +
   `buf-gen` (proto-gen step pairs per C-09).
2. **migration** — analysis 007: `backtest_run_symbols` table + ALTERs on
   `backtest_runs`/`strategy_scores` (+ down).
3. **service: cells** — per-symbol metrics capture in `RunBacktest` loop + cells repo +
   range persistence on runs (+ tests).
4. **service: derivation** — raw-metrics scoring core + dedup/shrinkage aggregator +
   recompute triggers (RunBacktest, UPDATE, repurposed ScoreStrategy) + provenance
   persist/hydrate, registered-only gate (+ tests).
5. **ui** — shared rating helpers de-dup, provenance line + provisional badge (list, detail,
   dashboard), "Strategy Grade"/"Run score" labels (+ e2e fixture/spec updates).
6. **docs** — service CLAUDE.md (config keys table + scoring section), root CLAUDE.md config
   key registry.
