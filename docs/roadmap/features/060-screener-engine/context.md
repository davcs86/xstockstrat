# Context: screener-engine

**Feature**: `docs/roadmap/features/060-screener-engine/feature.md`
**Product Spec**: `docs/roadmap/features/060-screener-engine/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/060-screener-engine/implementation-spec.md`

---

## Session 2026-06-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md. Feature 3 of 6.
- Core constraint (platform lead): the screener must NOT interfere with existing formulas or backtest.
  Honored by computing signal/fundamental contributions in analysis (never injected into the sandbox),
  reusing `evaluator.py`'s `ExecuteFormula` invocation verbatim, and extracting the shared scoring math
  into a pure module pinned by a golden regression test against current backtest output.
- Fundamentals used two ways per scan: filter gates (include/exclude) + universe-normalized ranking
  contributors, blended by weight with technical-formula and source-weighted-signal scores.
- Depends on 058 (universe via UI) + 059 (fundamental criteria via cached GetFundamentals).

## Session 2026-06-26 — sdd-review product-spec

- Product spec reviewed (spec-reviewer + feature-overlap subagents). Status: draft → spec-ready.
- Verdict: PASS WITH WARNINGS / overlap CLEAN. No blockers. Reused-symbol claims verified: `StrategyComponent`
  (analysis.proto), `CoverageGap` (analysis.proto), `TimeRange` (common.proto), `analysis.signals.source_weights`
  and `analysis.scoring.*` (servicer.py) all exist. No `ScreenSymbols` RPC exists yet (correct). No DB changes
  (stateless v1) — consistent.
- 2 warnings fixed in product-spec:
  1. `Comparator` enum was implied as reused but does not exist in any proto — reworded FR/proto section to
     mark it a NEW additive enum with the mandatory `COMPARATOR_UNSPECIFIED=0` sentinel.
  2. FR-3 cited a non-existent `evaluator.py`; corrected to the real `ExecuteFormula` RPC / `execute_formula`
     entrypoint in `xstockstrat-indicators` `app/services/sandbox.py`.
- Overlap findings: CLEAN. Shared-file WARN (not a collision) to re-check at /sdd-review impl-spec: 060 and 062
  both add additive RPCs to `analysis.proto` (concrete field numbers only assigned at impl-spec); 058 and 060
  add distinct pages under the shared `src/app/insights/` parent. Config namespaces disjoint.

## Session 2026-06-27 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- Key codebase findings:
  - Proto is additive only (no v2). `ScreenSymbols` slots into `service AnalysisService` after
    `SetStrategyLive` (`analysis.proto:19`). Reuses `StrategyComponent` (`:116-122`), `CoverageGap`
    (`:40-48`), `common.v1.TimeRange` (`common.proto:42-45`). New `Comparator` enum follows the
    `ComponentKind` style (`:110-114`) with `COMPARATOR_UNSPECIFIED=0`. New messages start at field 1.
  - FR-4 scoring extraction is **split**: `_compute_signal_score` is already pure
    (`servicer.py:884-916`), but the weight-combination + thresholds are **inline** in `_backtest_symbol`
    (`servicer.py:449-459`: `combined = technical_weight*(...) + signal_weight*signal_score`,
    `buy_threshold = max(0.5 + min_conviction*0.5, 0.55)`). Step 4 extracts these into a new pure
    `app/services/scoring.py`, with a re-export alias so existing `test_analysis_helpers.py:14` stays
    green; pinned by a golden regression test (FR-8 / Acceptance #2).
  - **Deviation from FR-3 surface**: analysis currently uses `ComputeIndicator`/`GetFormula`, NOT
    `ExecuteFormula`. FR-3 mandates `ExecuteFormula(input_data={"close":closes}, input_params=params)` —
    this is a NEW outbound RPC from analysis→indicators (channel already exists at `main.py:50-58`, but
    the call is net-new → triggers the header-propagation gate; analysis uses manual per-method metadata
    filtering at `servicer.py:147-151`).
  - **Feature 059 has NOT landed**: `GetFundamentals`/`GetFundamentalsMulti` are absent from
    `marketdata.proto`. Step 5 guards fundamental criteria behind a capability check and reports them
    **skipped** (FR-5 graceful degradation), lighting up automatically once 059 ships.
  - CoverageGap/insufficient-data pattern reused from `_InsufficientData` (`servicer.py:37-48`) →
    `CoverageGap` build (`:240-258`); new `ScreenResultStatus.INSUFFICIENT_DATA` mirrors
    `BACKTEST_STATUS_INSUFFICIENT_DATA`.
  - No DB change, no new env var. New `analysis.screener.*` keys arrive via WatchConfig
    (`main.py:39-40`), read inline via `self._cfg.get_int(...)` (`watcher.py:60-84`).
  - UI: BFF is NOT a transparent pass-through — `screenSymbols` must be explicitly registered in
    `insightsBff.ts` `router.service(AnalysisService,…)` (`:42-95`, header forwarding via
    `backendHeaders` `:32-38`). Clone `useBacktest.ts` (`:6-17`) → `useScreenSymbols`; page mirrors
    `strategies/[id]/page.tsx`; E2E mirrors `e2e/insights/backtest-coverage.spec.ts` with a new
    `screenSymbols` mock in `e2e/mock-backend.ts` (`:239`). No DB/pool.
