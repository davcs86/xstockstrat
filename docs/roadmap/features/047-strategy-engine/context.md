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
