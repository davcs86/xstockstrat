# Context: strategy-eval-projection

**Feature**: `docs/roadmap/features/369-strategy-eval-projection/feature.md`
**Product Spec**: `docs/roadmap/features/369-strategy-eval-projection/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/369-strategy-eval-projection/implementation-spec.md`

---

## Session 2026-11-28T04:30Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Program context: `docs/roadmap/program-job-graph-analysis-pipeline.md`. This is feature 3 of 9.
  It depends on 368 `symbol-data-stage` (bar record, universe snapshot, coverage record) and on
  367 `pipeline-job-graph` (on `main-dev`, `bc497728`).
- Tree: ccr-d10c1761-fxpr1d ≡ origin/main-dev@bc497728 (0 ahead, 0 behind at story time).
- Operator decisions that bind this feature (program plan): D-2, D-3, D-4, D-5, D-7, D-10, D-12, D-13.
- **OPERATOR DECISION (read switch): "Legacy reads, switch at cutover"** — FR-8. The projection
  read path is built behind `analysis.projection.read_source`, default `legacy`. Rejected:
  switching reads in this feature; building no read path until cutover.
- **OPERATOR ANSWER (parity report surface), verbatim: "Could be in the logs? Otherwise, Agent MCP
  tool, user-scoped"** — FR-9. Author reading: logs and telemetry are the surface; the agent tool
  is the fallback only if `/sdd-design` shows logs cannot carry the report. C-14 box "None".
- **OPERATOR DECISION (outbox): "Outbox + dry-run dispatcher"** — FR-6, FR-7. Rejected: outbox rows
  with no dispatcher; delivering real ledger events in shadow.
- **OPERATOR DECISION (strategy set): "All active, parity on overlap"** — FR-2, FR-9. Rejected:
  live-enabled only; mirroring the legacy universe.
- **OPERATOR DECISION (sequencing): "Stories now, then design 2 before 3"** — this feature's design
  starts only after 368's design is approved.
- Author inferences, not operator statements:
  - `analysis.pipeline.evaluation_enabled` defaults to `true` (open question in product-spec.md).
  - The shadow path keeps its own position state and never touches `analysis.strategy_cooldowns` (FR-4).
  - `analysis.pipeline.outbox_delivery` is seeded now with the single value `suppress` so that
    cutover changes a value, not a schema. C-18 may challenge a one-value key at design.
  - A definition change is picked up at the next bar; targeted re-evaluation is program feature 5.
- Recon facts recorded for the design (unverified digests, re-ground in Phase 0):
  - Live-loop state is in memory (`_last_state`, throttle, cursor); `in_position` is rebuilt by replay.
  - `StrategyEvaluator` is shared and calls indicators per component, per strategy.
  - Analysis has no outbox; `notify.email_outbox` is the only outbox pattern in the repo.
  - 367 deferred to this feature: shadow-run measurements, hazards H1/H2, executor-thread handlers.
- Known traps from the ledger: C-10(b) parity across read paths; 2026-08-01 "a hand-maintained
  projection must be pinned by an executable parity test"; the feature-100 bool zero-value trap.
