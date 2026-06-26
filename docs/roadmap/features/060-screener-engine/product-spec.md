# Product Spec: screener-engine

**Created**: 2026-06-26
**Priority Bucket**: P1 — The screener itself (3 of 6); depends on 058 (universe) + 059 (fundamentals)

---

## Problem Statement

There is no screener (no `ScreenSymbols` or screener-adjacent RPC in `analysis.proto` or indicators).
Analysts can backtest a strategy on known symbols but cannot ask "across this universe, which symbols
best satisfy these criteria right now?" The building blocks all exist — `RunBacktest` already fans out
to `GetBars` → `ComputeIndicator`/`ExecuteFormula` → `QuerySignals` and blends a source-weighted
signal score — but only along a per-symbol time axis, not as a cross-symbol ranked scan.

## User Story

As a **strategy analyst**, I want to run an on-demand scan of a chosen universe against formula +
signal + fundamental criteria and get a ranked result, so that I can surface candidates without
hand-running a backtest per symbol.

## Functional Requirements

FR-1. Add `ScreenSymbols(ScreenSymbolsRequest) returns (ScreenSymbolsResponse)` to `AnalysisService`.
**On-demand request/response** (no streaming fan-out), per the platform-lead modality decision.

FR-2. The request carries an **explicit symbol list** as the universe (the UI/agent resolves a
Feature-058 watchlist → symbols and passes them — keeping analysis free of a new portfolio
dependency). A convenience `watchlist_id` path is explicitly deferred (OQ-060-a).

FR-3. Criteria are **formula-driven**, reusing the indicators sandbox through the **existing
`evaluator.py` `ExecuteFormula` invocation** (`input_data={"close": closes}`, `input_params=params`)
— identical to backtest, so screener formulas behave exactly like backtest formulas. Each criterion
is a `ScreenCriterion` (see Proto) with a `kind`, a comparator, a threshold, and a ranking weight.

FR-4. The combined per-symbol score **integrates the existing source-weighted signal mechanism**:
`signal_sources`, `signal_weight`, `technical_weight`, `min_conviction`, and config
`analysis.signals.source_weights` are applied with the **same formula** `RunBacktest` uses, evaluated
at the scan as-of timestep (latest bar). The shared scoring math is **extracted into a pure module**
imported by both backtest and screener, guarded by a golden regression test that pins existing
backtest output unchanged.

FR-5. Optional **fundamental criteria** pull from `GetFundamentals`/`GetFundamentalsMulti`
(Feature 059); when FMP is disabled or quota-exhausted with no cache, fundamental criteria are
reported **skipped** rather than failing the whole scan.

FR-6. Fundamentals serve two roles per scan: **filter gates** (`hard_filter` criteria that
include/exclude a symbol) and **ranking contributors** (weighted, universe-normalized sub-scores).
Numeric fundamentals are min-max normalized **across the scan universe** for ranking.

FR-7. Results are **ranked descending by score**, capped at a configurable `rank_limit`, each with
per-criterion sub-scores and a `passed` flag. **Coverage-aware** like backtest: a symbol lacking
sufficient bars/fundamentals is returned with an `INSUFFICIENT_DATA` status and a gap descriptor
(reusing the `CoverageGap` pattern), not silently dropped or scored zero.

FR-8. **Hard isolation from backtest**: `RunBacktest`, `ScoreStrategy`, and the live-strategy loop
are behaviorally unchanged. New code is a sibling servicer method + new module; existing analysis
tests stay green.

FR-9. The `xstockstrat-ui` insights segment gains a **Screener** page
(`src/app/insights/screener/page.tsx`): pick a watchlist (Feature 058), compose criteria, run the
scan via a React-Query `useMutation` through the browser `analysisClient` (on-demand fits a mutation,
not polling), render a ranked table with fundamentals columns and loading/error states. Playwright E2E.

## Out of Scope

- Streaming/continuous screening or alerting on screen hits (on-demand only).
- Persisting "saved screens" (v1 is stateless — deferred, OQ-060-b).
- Modifying the SMA/backtest strategy logic or scoring weights.
- Injecting signals/fundamentals into the sandbox namespace (forbidden — kept in analysis).
- The MCP agent tool (Feature 061).
- IBKR scanner.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — owns `ScreenSymbols` + the screener engine.
- `xstockstrat-ui` — insights `screener` page.
- `xstockstrat-indicators` — consumed (unchanged): `ExecuteFormula`.
- `xstockstrat-marketdata` — consumed: `GetBars` + `GetFundamentals`.
- `xstockstrat-ingest` — consumed: `QuerySignals`.
- `xstockstrat-config` — new `analysis.screener.*` keys.

(Analysis already depends on marketdata/indicators/ingest — **no new cross-service edge**; portfolio
resolution stays at the UI/agent layer.)

## Proto Contract Changes

- **Changes required (all additive → non-breaking):**
  - `packages/proto/analysis/v1/analysis.proto`:
    - `ScreenSymbols` RPC.
    - `ScreenSymbolsRequest` (`repeated string symbols`, `repeated ScreenCriterion criteria`,
      signal-blend params, `int32 rank_limit`, optional `TimeRange evaluation_window`).
    - `ScreenCriterion` (`ref_name`; `kind` enum `FUNDAMENTAL | TECHNICAL_FORMULA |
      TECHNICAL_INDICATOR | SIGNAL`; `metric_name` for FUNDAMENTAL; `StrategyComponent component` for
      TECHNICAL; `Comparator op` `LT|LTE|GT|GTE|BETWEEN`; `double threshold`; `double weight`;
      `bool hard_filter`).
    - `ScreenResult` (`symbol`, `double score`, `map<string,double> criterion_scores`, `bool passed`,
      status enum, optional `CoverageGap`).
    - `ScreenSymbolsResponse` (`repeated ScreenResult results`, `repeated CoverageGap coverage_gaps`).

## Config Key Changes

| Key | Type | Default |
|---|---|---|
| `analysis.screener.max_universe_size` | int | `100` |
| `analysis.screener.max_duration_seconds` | int | `120` |
| `analysis.screener.default_rank_limit` | int | `50` |
| `analysis.screener.max_concurrent_formula_evals` | int | `4` |

(reuses existing `analysis.signals.source_weights` and `analysis.scoring.*`)

## Database Changes

- [x] **None for v1** (on-demand, stateless — consistent with backtest results being in-memory only).
  A `analysis.screens` table for saved screens is deferred (OQ-060-b).

## Feature Workflow Notes

Branch to create: `feature/screener-engine` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (additive proto change)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, all additive
- [x] config team (new `analysis.screener.*` keys)
- [ ] DBA review — N/A (no migration)

**Depends on** 058 (watchlist universe, UI-resolved) and 059 (fundamental criteria). Can ship with
graceful degradation if 059 slips (fundamental criteria reported skipped) or 058 slips (manual symbol
entry in the UI).

## Acceptance Criteria

1. `ScreenSymbols` over a 3-symbol universe with one formula criterion returns 3 ranked results,
   score-ordered, each with per-criterion sub-scores.
2. With `signal_weight>0` and `signal_sources` set, the per-symbol combined score equals what the
   **extracted shared scoring module** produces — and a **golden test proves `RunBacktest` output is
   byte-for-byte unchanged** after the extraction (FR-4/FR-8).
3. A symbol with insufficient bars is returned `INSUFFICIENT_DATA` with a gap descriptor, not dropped.
4. A fundamental hard-filter excludes a symbol; a fundamental ranking criterion reorders survivors
   (universe-normalized). With FMP disabled, that criterion is marked skipped and the scan completes.
5. The full existing `xstockstrat-analysis` test suite passes unchanged (FR-8).
6. UI Playwright E2E: select a watchlist, add a criterion, run, see a ranked table; loading and error
   states render.

## Resolved Decisions

- [x] **Universe resolved at UI/agent layer** (OQ-060-a): `ScreenSymbols` takes explicit symbols;
  a `watchlist_id` convenience param is a clean additive follow-up.
- [x] **Stateless v1** (OQ-060-b): saved screens (`analysis.screens` JSONB, mirroring
  `analysis.strategies`) deferred.
- [x] **Criteria = `StrategyComponent` + `kind` discriminator + comparator** (OQ-060-c): reuses the
  proven typed component shape; fundamentals add a `metric_name`.
- [x] **Universe cap 100 + 4 concurrent formula evals** (OQ-060-d): bounds sandbox pressure so a scan
  cannot starve the live-strategy loop.
- [x] **Latest-bar as-of** (OQ-060-e): historical as-of deferred (the `evaluation_window` field is reserved).

## Open Questions

- [ ] None — all resolved during design (see Resolved Decisions).
