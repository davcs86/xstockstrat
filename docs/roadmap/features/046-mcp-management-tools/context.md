# Context: mcp-management-tools

**Feature**: `docs/roadmap/features/046-mcp-management-tools/feature.md`
**Product Spec**: `docs/roadmap/features/046-mcp-management-tools/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/046-mcp-management-tools/implementation-spec.md`

---

## Session 2026-06-01 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story:
  "More MCP tools: Register/Manage Source, Register/Manage Strategy, Register/Manage Formula."
- Key finding carried into the spec: of the three management areas, **source** and **formula**
  wrap existing backend RPCs (`IngestService.ManageSignalSource`,
  `IndicatorsService.RegisterFormula`/`GetFormula`), but **strategy** has no backing
  persistence/RPC today — `xstockstrat-analysis` keeps strategies only ephemerally (named
  `strategy_id` + `strategy_params` per `RunBacktest`, in-memory `StrategyScore` map). Captured as
  FR-6 + lead Open Question: RPC-backed registry (proto + migration) vs config-backed definitions.
- All mutating tools scoped as admin (reuse identity `ValidateApiKey`, the gate
  `ManageSignalSource` already enforces) + `x-mcp-secret` propagation.
- Noted reviewer-registry gap: `xstockstrat-agent` is not in the Service Owners table.
