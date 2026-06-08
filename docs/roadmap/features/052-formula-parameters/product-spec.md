# Product Spec: formula-parameters

**Created**: 2026-06-08

---

## Problem Statement

Custom formulas in `xstockstrat-indicators` receive their inputs through an arbitrary
`google.protobuf.Struct` (`ExecuteFormulaRequest.input_data`) and carry only an **advisory,
unenforced** `input_schema` (`map<string, string>` of name → type-name). There is no way to
declare a parameter's default value, allowed range, or human-readable description, and nothing
validates the values a caller supplies. As a result, formula authors hardcode magic numbers in
Python source (forcing a source edit + re-save to change a period), strategy authors must hand-type
free-form `params` key/value pairs with no idea which keys a formula expects, and bad inputs surface
only as opaque `RUNTIME_ERROR` exit reasons. We want formulas to expose **first-class typed
parameters** so the same formula can be reused with different settings, configured through a
guided form rather than by editing code.

## User Story

As a quant/strategy author, I want to define typed parameters (with names, types, defaults, ranges,
and descriptions) on a formula and then set their values when I run the formula or wire it into a
strategy, so that I can reuse one formula across many configurations without editing its Python
source and without guessing which inputs it expects.

## Functional Requirements

FR-1. A formula MAY declare an ordered list of **parameter definitions**. Each definition has:
`name` (identifier used as the `data` dict key), `type` (one of: int, float, bool, string — closed
set, modeled as an enum), `default` value, optional `description`, optional `required` flag, and
optional numeric `min`/`max` bounds (applicable to int/float). Parameter names must be unique within
a formula.

FR-2. The indicators engine MUST validate caller-supplied parameter values against the formula's
parameter definitions at `ExecuteFormula` time: apply declared defaults for omitted parameters,
coerce/type-check supplied values, reject values outside `min`/`max`, and reject unknown or
missing-required parameters. Validation failures return a structured error with a clear reason
(not an opaque sandbox `RUNTIME_ERROR`).

FR-3. Validated, defaulted parameter values MUST be merged into the `data` dict handed to the
formula source (alongside the existing OHLCV/series inputs), preserving the existing
`data["param_name"]` access contract so previously authored formulas continue to read their inputs
the same way.

FR-4. **Formula management UI** (`/insights/formulas` workspace) MUST let an author add, edit,
reorder, and remove parameter definitions in a dedicated cell, and the Run cell MUST render a
generated form (typed inputs pre-filled with defaults) instead of requiring hand-edited JSON for
declared parameters. Non-parameter inputs (e.g. OHLCV series) keep the existing JSON/sample-data path.

FR-5. **Strategy management UI** (`StrategyWizard` / `ComponentEditor`) MUST, when a
`CUSTOM_FORMULA` component is selected, fetch the chosen formula's parameter definitions and render a
typed form (defaults pre-filled, bounds enforced) for setting that component's parameter values,
replacing the current free-form `params` key/value editor for formula components.

FR-6. The **agent** `manage_formula` MCP tool MUST accept parameter definitions on register/update,
and the `manage_strategy` MCP tool MUST accept per-formula-component parameter values, so an AI agent
can author parameterized formulas and parameterized strategies through the same contract as the UI.

FR-7. The **analysis** evaluator MUST pass a `CUSTOM_FORMULA` component's configured parameter values
(merged over the formula's declared defaults) into the `ExecuteFormula` call during both backtest
(`RunBacktest`) and live strategy→alert evaluation, preserving backtest/live parity.

FR-8. Backward compatibility: existing formulas with no parameter definitions, and existing strategy
components using the free-form `params` map, MUST continue to execute unchanged. The legacy
`input_schema` map remains readable; new structured parameters are additive.

## Out of Scope

- Changing the sandbox security model, allowed imports, timeout, or memory limits.
- Parameter types beyond the scalar set (int/float/bool/string) — no list/struct/enum-of-strings
  parameters, no per-symbol or time-varying parameters in this feature.
- Parameter values sourced from live market data or other services (parameters are static per run /
  per strategy component).
- Versioning or migration of parameter definitions across formula edits (an edit simply overwrites
  the definition set).
- Built-in indicator parameters (SMA/RSI/etc.) — those already use `params` and are unchanged.
- Cross-formula parameter sharing / global parameter presets.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-indicators` — owns the formula model, persistence, sandbox execution; adds parameter
  definitions to the schema and enforces validation/defaulting at `ExecuteFormula`.
- `xstockstrat-analysis` — strategy evaluator that calls `ExecuteFormula` for `CUSTOM_FORMULA`
  components; must forward configured parameter values.
- `xstockstrat-ui` — formula workspace (manage formulas) and strategy wizard (manage strategies)
  must render and submit parameter definitions/values.
- `xstockstrat-agent` — `manage_formula` and `manage_strategy` MCP tools must carry parameter
  definitions and values.
- `packages/proto` — single source of truth for the indicators (and possibly analysis) contracts.

## Proto Contract Changes

Anticipated (to be finalized in `/sdd-spec`):
- New message `FormulaParameter` in `packages/proto/indicators/v1/indicators.proto`:
  `name`, `type` (new enum `ParameterType` with `PARAMETER_TYPE_UNSPECIFIED = 0`), `default_value`
  (`google.protobuf.Value` or typed), `description`, `required` (bool), `min`/`max` (optional doubles).
- Add `repeated FormulaParameter parameters` to `FormulaDefinition`, `RegisterFormulaRequest`, and
  `UpdateFormulaRequest` (additive, new field numbers — non-breaking; legacy `input_schema` retained).
- Possibly surface a structured validation error on `ExecuteFormulaResponse` (e.g. a new
  `PARAMETER_INVALID` value on the existing `SandboxExitReason` enum, or a dedicated error field) —
  decide in impl-spec.
- `analysis.proto` `StrategyComponent` already has `map<string, double> params`; evaluate whether
  formula-component parameter values can reuse it or need a richer type for bool/string params.

All proto changes target the **additive / non-breaking** path. `buf breaking` must pass against
`main`.

## Config Key Changes

- [x] No new config keys anticipated. (Sandbox limits already exist under `indicators.sandbox.*`;
  parameter count limits, if any, can reuse existing validation rather than a new config key — revisit
  in impl-spec if a hard cap is desired.)

## Database Changes

- New migration in `services/xstockstrat-indicators/migrations/` (next number after the existing
  `001_formulas`): add a `parameters` JSONB column (default `'[]'`) to `indicators.formulas` storing
  the ordered parameter definitions. `input_schema` column is retained for backward compatibility.
  Up + down pair required.

## Feature Workflow Notes

Branch to create: `feature/formula-parameters` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto + config change path)
- [ ] 2 service owners + platform lead (breaking proto change) — only if the contract cannot stay additive
- [x] DBA review + service owner (schema migration — new `parameters` column on `indicators.formulas`)

## Acceptance Criteria

1. A formula can be registered/updated (via UI, agent, and gRPC) with an ordered set of typed
   parameter definitions, persisted in `indicators.formulas.parameters`.
2. `ExecuteFormula` applies declared defaults for omitted parameters, type-checks and range-validates
   supplied values, and returns a structured, non-opaque error for invalid parameters; valid runs see
   the merged values under `data["<param_name>"]`.
3. A formula with no parameters and an existing strategy component using the free-form `params` map
   both still execute unchanged (regression-safe).
4. In the formula workspace, an author can add/edit/reorder/remove parameters and run the formula via
   a generated, default-filled typed form instead of hand-editing parameter JSON.
5. In the strategy wizard, selecting a `CUSTOM_FORMULA` component renders that formula's parameter
   form (defaults pre-filled, bounds enforced); the configured values are persisted on the strategy
   and used by both backtest and live evaluation (backtest/live parity verified).
6. `manage_formula` accepts parameter definitions and `manage_strategy` accepts per-component
   parameter values through the MCP contract.
7. `buf lint` and `buf breaking` (against `main`) pass; CI coverage thresholds met
   (indicators ≥50%).

## Open Questions

- [ ] How should `default_value`, `min`, and `max` be typed in proto given the int/float/bool/string
      mix? Single `google.protobuf.Value`, or a typed oneof? (Resolve in impl-spec.)
- [ ] Should the structured parameter-validation failure reuse `SandboxExitReason` (new
      `PARAMETER_INVALID` enum value) or a dedicated response field? Note this is the one place the
      contract could be borderline-breaking if the enum is mishandled.
- [ ] For strategy `CUSTOM_FORMULA` components, do we keep `map<string, double> params` (limits
      bool/string params) or introduce a richer per-component param value type in `analysis.proto`?
- [ ] Should parameter `name`s be validated as Python identifiers (to guarantee safe `data` dict keys),
      and should they be disallowed from colliding with reserved OHLCV input keys (`open/high/low/close/
      volume`)?
- [ ] Is there a maximum parameter count per formula worth enforcing, and where (engine validation vs.
      a new `indicators.*` config key)?
