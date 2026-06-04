# Context: strategy-engine

**Feature**: `docs/roadmap/features/047-strategy-engine/feature.md`
**Product Spec**: `docs/roadmap/features/047-strategy-engine/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/047-strategy-engine/implementation-spec.md`

---

## Session 2026-06-01 — sdd-story (original)

- Created as `046-mcp-management-tools` from user story:
  "More MCP tools: Register/Manage Source, Register/Manage Strategy, Register/Manage Formula."
- Finding: source + formula management wrap existing RPCs; strategy management had no backing
  store/RPC (analysis kept strategies only in-memory per `RunBacktest`).

## Session 2026-06-01 — sdd-story (revamp)

- User clarification chain established that, today:
  - a "strategy" is effectively just an instance of a backtest (label + `strategy_params`,
    in-memory only);
  - `RunBacktest` is hardwired to SMA crossover — no way to select an indicator, and
    `RunBacktestRequest` has no indicator/formula field (verified `analysis.proto` + `servicer.py`);
  - it cannot compose multiple indicators; the indicators service has built-ins + custom formulas
    but `RunBacktest` never calls `ExecuteFormula`;
  - backtest ≠ alerts — alerts come from signal ingestion threshold / explicit `emit_alert`; there
    is **no live strategy→alert engine**.
- User directive: revamp to a **live "strategy→alert" engine**; a strategy can have multiple
  indicators / custom formulas and run continuously **and** in backtests.
- Decisions (via AskUserQuestion):
  - **Scope:** split. This feature (047) = composable strategy model + persistence + shared
    evaluator + backtest integration + admin MCP management tools. New feature
    `048-live-strategy-alert-engine` = the continuous live→alert runtime, depending on 047.
  - **Name:** renamed `mcp-management-tools` → `strategy-engine` (branch `feature/strategy-engine`).
- Renumbered 046 → **047** because a remote sync introduced `046-align-frontend-e2e-bff-mocks`
  during this session; live engine created as **048**.
- Key design principle carried into the spec: a **single shared evaluator** is the source of truth
  for strategy behavior so backtest (047) and live (048) cannot diverge. Rule representation and
  evaluator placement left as Open Questions for `/sdd-spec`.

## Session 2026-06-04 — sdd-review product-spec

- Product spec approved. Status: `draft` → `spec-ready`.
- All 7 open questions resolved:
  - **Rule representation**: structured JSON condition tree (machine-validatable, UI-renderable). See FR-3.
  - **Evaluator placement**: standalone Python module inside `xstockstrat-analysis`; feature 048 imports it directly.
  - **Backtest reference shape**: both `strategy_id` (resolve from DB) and `inline_definition` (one-off); inline takes precedence. See FR-7.
  - **ListStrategies reconciliation**: add `ListStrategyDefinitions` for stored definitions; existing `ListStrategies` (StrategyScore) unchanged. See FR-9.
  - **Signals as rule term**: deferred to feature 048 or a follow-up. Signals remain a separate weighting layer (FR-4) outside the rule grammar. Evaluator interface must be designed to accommodate a future signal term without breaking change.
  - **ListFormulas RPC**: feature 003 (`formula-management-ui`) delivers it; this feature consumes it. See FR-11.
  - **Agent reviewer-registry gap**: noted; separate docs PR to add `xstockstrat-agent` to `docs/runbooks/reviewer-registry.md`. Not a blocker.
- Advisory warnings (no action required):
  - FR-3 testability depends on resolved rule representation (now resolved).
  - `packages/proto` removed from Affected Services bullet list; moved to a note under the section.
  - AC-5 strengthened to a concrete, observable acceptance criterion.
  - Overlap WARNs: features 003 (xstockstrat-indicators), 007 (xstockstrat-analysis), 008 (xstockstrat-ingest dependency), 009 (xstockstrat-agent), 018 (xstockstrat-agent) — coordinate merge order; no FAIL-level conflicts.
