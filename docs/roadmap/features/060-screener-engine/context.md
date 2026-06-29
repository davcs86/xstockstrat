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

## Session 2026-06-27 — sdd-review impl-spec (advisory)

- Impl-spec reviewed. Verdict: PASS WITH WARNINGS, 0 blockers. All cited symbols verified, including the load-bearing
  reality that analysis currently calls ComputeIndicator/GetFormula (NOT ExecuteFormula) — so the screener's
  ExecuteFormula call is a NET-NEW outbound RPC needing per-method propagation_meta. FR-4 scoring math extracted to
  pure app/services/scoring.py behind a golden test; fundamental criteria report skipped until 059 lands.
- Advisories for execute: Step 6 golden-baseline freeze (capture pre-refactor expected values) is a MANUAL prerequisite,
  not a runnable command; Steps 8↔9 share a data-testid contract — keep names identical; Step 5 is large but cohesive.
- analysis.proto + servicer.py overlap with 062 is rebase-only (no field/name collision); whichever merges second rebases.

## Session 2026-06-29 — sdd-execute (all 9 steps)

Executed all 9 steps on `feature/screener-engine` (stacked on `feature/fundamentals-data-source`,
059). One integration PR per feature.

- **Step 1–2 (proto+gen)**: additive `ScreenSymbols` RPC + `ScreenCriterion`/`ScreenResult`/
  `ScreenSymbolsRequest`/`ScreenSymbolsResponse` + `Comparator`/`ScreenKind`/`ScreenResultStatus`
  enums. `buf lint`/`buf breaking` clean; regen touched only analysis stubs.
- **Step 3 (config)**: 4 `analysis.screener.*` keys in root + analysis CLAUDE.md.
- **Step 4 (extract scoring)**: `app/services/scoring.py` (`compute_signal_score`, `combine_score`,
  `buy_threshold`, `sell_threshold`) moved VERBATIM from the inline `_backtest_symbol` math; servicer
  delegates and keeps the `_compute_signal_score` re-export alias (FR-8). **Golden proof**: the full
  pre-existing analysis suite (105 tests) passes unchanged after the refactor, plus a frozen-value
  golden test (`TestScoringGolden` in test_analysis_helpers.py) pins the extracted functions
  byte-for-byte (see Deviation Log for the golden-baseline approach).
- **Step 5 (ScreenSymbols)**: `app/services/screener.py` `ScreenerEngine` + servicer method. Reuses
  `scoring.combine_score` (technical aggregate [0,1]→[-1,1] so the blend == backtest, FR-4), calls
  `ExecuteFormula` exactly as a backtest (FR-3) under a concurrency semaphore, forwards propagation
  metadata on every outbound call, INSUFFICIENT_DATA+CoverageGap for thin symbols (FR-7), universe
  min-max normalization (FR-6), rank-limit + universe cap, and a scan deadline.
- **Step 6 (tests)**: golden (helpers), `ScreenSymbols` RPC tests (servicer), engine units
  (test_screener.py). Full suite 120 passed, coverage 64% (≥40%), ruff clean.
- **Step 7–8 (UI)**: `screenSymbols` BFF handler, `useScreenSymbols` mutation hook, `/insights/screener`
  page (symbol entry + criteria builder + ranked results table with insufficient-data badge). tsc +
  next lint clean.
- **Step 9 (E2E)**: `e2e/insights/screener.spec.ts` + `screenSymbols` mock authored — runs a scan,
  asserts the ranked 3-row table and the insufficient-data state. **Could not be run to completion in
  this container**: Playwright's dev `webServer` repeatedly failed to bind within 60s (post-restart apt
  + Playwright-Firefox setup churn starved the Next.js compile; production `next build` also not viable
  here as it type-checks the temp config). Per user direction (retry-once-then-commit), committed with
  the spec/mock authored and verified-by-construction (`tsc --noEmit` + `next lint` clean, mirrors the
  passing 058/backtest-coverage specs). See Deviation Log. Re-run `pnpm test:e2e -- screener` in a
  stable env.

**Fundamentals note**: since 060 is stacked on 059, `GetFundamentals(Multi)` proto exists in the
ancestry — so instead of a compile-time `hasattr` skip, the engine calls `GetFundamentalsMulti` and
degrades fundamental criteria to **skipped** on any RpcError (FMP disabled by default →
FailedPrecondition, quota-exhausted, or unavailable), satisfying FR-5 both ways. See Deviation Log.

**Stopped at**: all complete → integration PR → `feature/fundamentals-data-source` (059).

## Session 2026-06-29 (CI: feature status automation)

- Promotion PR #729 merged to main
- Feature promoted and committed: e8742e4e4f4dd88cbbc6ed85151784c4434d4885
- Status updated: `code-completed` → `launched`
- Launched date: 2026-06-29
