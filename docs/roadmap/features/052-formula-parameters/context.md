# Context: formula-parameters

**Feature**: `docs/roadmap/features/052-formula-parameters/feature.md`
**Product Spec**: `docs/roadmap/features/052-formula-parameters/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/052-formula-parameters/implementation-spec.md`

---

## Session 2026-06-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story:
  "allow parameters into formulas — UI (manage formulas, manage strategies), agent
  (manage formulas, manage strategies), and the indicators engine."
- Codebase discovery (Explore agent) established the current state:
  - Formula model: `indicators.formulas` table (`services/xstockstrat-indicators/migrations/001_formulas.up.sql`)
    with advisory-only `input_schema JSONB` (`map<string,string>` name → type-name); no defaults,
    no validation, no enforcement.
  - Proto: `packages/proto/indicators/v1/indicators.proto` — `FormulaDefinition.input_schema`
    (`map<string,string>`); `ExecuteFormulaRequest.input_data` is a `google.protobuf.Struct`.
  - Sandbox: `services/xstockstrat-indicators/app/services/sandbox.py` — formula reads `data` dict,
    assigns `result`; no parameter validation.
  - UI: formula workspace at `services/xstockstrat-ui/src/components/insights/FormulaWorkspace.tsx`
    + hooks `src/hooks/useFormulas.ts`; strategy authoring in `StrategyWizard.tsx` /
    `ComponentEditor.tsx` (free-form `params` key/value editor for `CUSTOM_FORMULA` components).
  - Agent: `manage_formula` / `manage_strategy` MCP tools in `services/xstockstrat-agent/app/tools.py`.
  - Strategy linkage: `packages/proto/analysis/v1/analysis.proto` `StrategyComponent`
    (`formula_id` + `map<string,double> params`); evaluator at
    `services/xstockstrat-analysis/app/services/evaluator.py` (shared by RunBacktest + live alerts).
- Scoping decisions captured in product-spec: structured typed parameters (int/float/bool/string),
  additive/non-breaking proto path (new `FormulaParameter` message + `repeated parameters`, keep
  legacy `input_schema`), new `parameters` JSONB column via a new indicators migration, engine-side
  validation/defaulting at `ExecuteFormula`, dynamic parameter forms in formula + strategy editors.
- Open questions recorded for impl-spec: proto typing of default/min/max, validation-error surface
  (SandboxExitReason vs dedicated field), strategy-component param value type, parameter-name
  validation, and an optional parameter-count cap.

### Decision (2026-06-08, user) — separate parameters from series data

- User: "I don't want to mix them. OHLCV data can stay in input_data, and use a different object for
  parameters (eg. input_params)."
- Confirmed current state: today OHLCV series and scalar knobs are conflated in the single
  `ExecuteFormulaRequest.input_data` Struct → `data` dict; `input_schema` flatly lists both and is
  never read at execution (`sandbox.py` ignores it).
- Locked design:
  - OHLCV/series stay in `input_data` → `data` (unchanged).
  - Parameter *values* travel in a NEW `ExecuteFormulaRequest.input_params` Struct (field `= 7`,
    additive/non-breaking) and are exposed to the formula as a SEPARATE `params` variable — NOT
    merged into `data`. New formulas read `params["period"]`.
  - Legacy formulas that stuff scalars into `input_data` keep reading `data[...]` unchanged.
  - Param/OHLCV name collisions are now impossible (separate namespaces); that open question is
    downgraded to "validate param names as Python identifiers" only.
- Updated product-spec.md: added "Relationship to Existing Inputs" section; revised FR-2, FR-3, FR-4,
  FR-7, FR-8, the proto-changes list (added `input_params` field), AC #2, and the name-collision open
  question.
