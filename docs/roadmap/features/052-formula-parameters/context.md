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

## Session 2026-06-08 — sdd-review product-spec

- Product spec reviewed. Result: PASS after resolving open questions. Status: draft → spec-ready.
- Spec criteria: 8/9 ✓ on first pass; criterion 9 (open questions) initially ✗ — 5 unresolved
  `- [ ]` items. Resolved via user decisions below, then re-evaluated to ✓.
- Trading-domain checks: skipped (non-trading feature).
- Overlap findings (all advisory ⚠ — no FAIL-level conflicts):
  - `020-order-snapshots-pnl-patterns` (draft) also edits `analysis.proto` — only a risk if 052
    touched StrategyComponent; it does not (see decision below). No collision.
  - `022-signal-time-decay`, `032-walk-forward-backtesting` (draft) also modify `xstockstrat-analysis`
    (evaluator) — coordinate merge order; no shared symbols.
  - `010-agent-scheduler` (draft) also modifies `xstockstrat-agent` — different tools; no collision.
- Decisions locked (user, during review) — binding for /sdd-spec:
  1. Strategy CUSTOM_FORMULA param values: **numeric only** — keep `StrategyComponent.params`
     (`map<string,double>`); **no `analysis.proto` change**. bool/string params usable only in
     standalone formula runs (out of scope for strategy components).
  2. Proto typing: `FormulaParameter.default_value` = `google.protobuf.Value`; `min`/`max` = optional
     `double`.
  3. Validation-error surface: **dedicated structured error field** on `ExecuteFormulaResponse`
     (`repeated { name, reason }`); `SandboxExitReason` NOT extended; validation runs before sandbox.
  4. Parameter names: validated as **Python identifiers** at registration.
  5. Parameter count: **soft cap in engine (target 32), no new config key**.
- Updated product-spec.md accordingly: added "Resolved Decisions" section, emptied "Open Questions",
  revised FR-2, FR-5, proto-changes (dedicated error field; analysis.proto = no change), and Out of
  Scope (bool/string not settable per strategy component).

## Session 2026-06-08 — sdd-spec

- Generated implementation-spec.md with 14 steps. Status → implementation-ready.
- Assigned proto field numbers (verified against current `indicators.proto`):
  - `ExecuteFormulaRequest.input_params = 7` (after `memory_bytes_override = 6`)
  - `ExecuteFormulaResponse.parameter_errors = 9` (after `exit_reason = 8`)
  - `FormulaDefinition.parameters = 10` (after `input_schema = 9`)
  - `RegisterFormulaRequest.parameters = 7` (after `author = 6`)
  - `UpdateFormulaRequest.parameters = 7` (after `is_public = 6`)
  - New enum `ParameterType` + messages `FormulaParameter`, `ParameterValidationError`.
- Key codebase findings:
  - Last indicators migration is `001_formulas` → new migration is `002_formula_parameters`
    (adds `parameters JSONB NOT NULL DEFAULT '[]'`; existing `input_schema` uses `'{}'`).
  - Sandbox `execute_formula` (sandbox.py L146) and `_SANDBOX_WRAPPER` (L95–143) load `data`
    via `json.loads({input_json!r})` into `_formula_globals` (L136); `params` is injected the
    same way as a SEPARATE global (not merged into `data`) — Step 6.
  - Servicer `ExecuteFormula` (servicer.py L70–137) calls the sandbox at L107; validation must run
    before that and short-circuit to `parameter_errors` on failure (FR-2). `RegisterFormula`
    (L150) / `UpdateFormula` (L229) / `_row_to_formula` (L274) all need the `parameters` field.
  - New `app/services/parameters.py` is created from scratch (no existing validation module);
    32-param soft cap + Python-identifier name check live there (no new config key).
  - Analysis evaluator CUSTOM_FORMULA branch (evaluator.py L117–133) already forwards
    `metadata=self._meta`; only adds `input_params` from numeric `comp.params` — no new gRPC
    client, so header propagation is reused (§5c satisfied). No `analysis.proto` change.
  - Agent: `manage_strategy` already carries numeric `StrategyComponent.params` (client.py L207);
    only `manage_formula` (client.py L263 / tools.py L284) needs `parameters` added.
  - UI: `FormulaWorkspace.tsx`, `useFormulas.ts`, `ComponentEditor.tsx` need parameter forms;
    new `ParameterEditor.tsx`; BFF route `insights/api/[...connect]` is unchanged (new fields ride
    existing RPCs). No UI coverage gate — Playwright e2e under `e2e/` applies.
- Note: `scripts/buf-gen.sh` runs `buf breaking` against `main-dev`; product spec / AC #7 require
  passing against `main` — Step 1 verification includes an explicit `--against main` check.

## Session 2026-06-08 — sdd-spec (re-run)

- Re-ran /sdd-spec; feature was already `implementation-ready` with a 14-step spec. Re-verified
  every load-bearing codebase reference against the current working tree — no drift detected, so
  the spec content is unchanged (Created date preserved; added a Regenerated marker + a
  status-history "re-run" row).
- Evidence re-confirmed (all still accurate):
  - `packages/proto/indicators/v1/indicators.proto`: `ExecuteFormulaRequest` ends at
    `memory_bytes_override = 6` (L69); `ExecuteFormulaResponse` ends at `exit_reason = 8` (L80);
    `FormulaDefinition.input_schema = 9` (L101); `RegisterFormulaRequest.author = 6` (L123);
    `UpdateFormulaRequest.is_public = 6` (L153). Assigned field numbers (input_params=7,
    parameter_errors=9, parameters=10/7/7) remain free and additive.
  - Indicators migrations: last is `001_formulas` → new is `002_formula_parameters` (confirmed via
    `ls migrations/`).
  - `formulas_repository.py`: `_to_dict` L16-26, `create` INSERT (7 positional args today; add
    `parameters` as `$8::jsonb`) L35-60, `update` SET clause L95-116 — match Step 4.
  - `sandbox.py`: `data = json.loads({input_json!r})` L133, `_formula_globals` L136, `.format(...)`
    L159-165 — match Step 6 (`params` injected as a separate global).
  - `servicer.py`: `ExecuteFormula` L70-137 (sandbox call L107), `RegisterFormula` L150-195,
    `UpdateFormula` L229-252, `_row_to_formula` L274-296 — match Step 7.
  - `evaluator.py`: CUSTOM_FORMULA branch L117-133 forwards `metadata=self._meta`; numeric
    `comp.params` reused; no new gRPC client — match Step 9 (header propagation reused, §5c).
  - Agent `client.py` `manage_formula` L263-308 / `tools.py` `manage_formula` L284-317; strategy
    path already carries numeric `StrategyComponent.params` (client.py L207) — match Step 11.
  - UI: `FormulaWorkspace.tsx`, `useFormulas.ts` (register passes `inputSchema` not `parameters`
    L39; execute has no `inputParams` L83-87), `ComponentEditor.tsx`, new/edit pages, and the BFF
    `insights/api/[...connect]` route all exist; `ParameterEditor.tsx` correctly absent (create) —
    match Step 13.
  - Files correctly marked "create" (verified absent): `app/services/parameters.py`,
    `tests/test_parameters.py`, `ParameterEditor.tsx`. All other referenced files exist.

## Session 2026-06-08 — sdd-execute (sequential)

- Mode: SEQUENTIAL, single feature (052). User directive: run all 14 steps but **open only the
  final integration PR** (no per-step PRs). Per the harness, all work lands on the pre-assigned
  branch `claude/sdd-execute-formula-params-gy0lgo` (fast-forwarded to `origin/main-dev` at start —
  it had been based on `main`/the promote commit and lacked the feature dir). Final PR target: `main-dev`.
- Tooling: `buf`/`migrate` absent on host; Docker present but Docker Hub pulls are rate-limited (429).
  Verification uses sequential-mode CI-equivalent fallbacks (see Deviation Log).

### Step 1 — proto: FormulaParameter, ParameterType, input_params, parameter_errors [done]
- Added `ParameterType` enum, `FormulaParameter` + `ParameterValidationError` messages; appended
  `ExecuteFormulaRequest.input_params=7`, `ExecuteFormulaResponse.parameter_errors=9`,
  `FormulaDefinition.parameters=10`, `RegisterFormulaRequest.parameters=7`,
  `UpdateFormulaRequest.parameters=7`. No existing field removed/renumbered; `input_schema` retained.
- Verification: `buf lint` PASS; `buf breaking` against `origin/main-dev` PASS and against
  `origin/main` (production baseline, AC #7) PASS — all additive.
- Files modified: `packages/proto/indicators/v1/indicators.proto`
- Deviations: none for Step 1 (buf installed on host since the Docker codegen container was blocked).

### Step 2 — proto-gen: Regenerate Go/Python/TS stubs [done]
- Regenerated Go/Python/TS stubs via `./scripts/buf-gen.sh` on the host (codegen container blocked by
  Docker Hub 429). New symbols verified present in all three languages (`FormulaParameter`,
  `ParameterType`, `parameterErrors`/`parameter_errors`, `input_params`, `FormulaDefinition.parameters`).
  Diff scoped to the indicators service only; `buf-gen.sh` is idempotent (CI freshness check parity).
- Files modified (generated): `packages/proto/gen/{go,python,ts}/indicators/v1/`, `gen/ts/dist/`.
- Deviations: Step 2 toolchain host-install fallback — full detail in Deviation Log.

### Step 3 — migration: Add parameters JSONB column to indicators.formulas [done]
- Created `002_formula_parameters.{up,down}.sql` (add/drop `parameters JSONB NOT NULL DEFAULT '[]'`).
- Verification: applied 001 + 002 up against a throwaway `postgres:16` container; `\d` confirmed
  `parameters | jsonb | not null | '[]'::jsonb`; 002 down dropped it cleanly (reversibility proven).
- Files created: `services/xstockstrat-indicators/migrations/002_formula_parameters.up.sql`, `.down.sql`
- Deviations: migrate/DB unavailable → postgres:16 container fallback (Deviation Log).

### Steps 4–8 — indicators service (repository, validation engine, sandbox, servicer, tests) [done]
- Step 4: `formulas_repository.py` — `_to_dict` decodes the new `parameters` JSONB to a list;
  `create`/`update` take a `parameters` arg and bind it as `$8::jsonb` / `parameters = $6::jsonb`.
- Step 5: new `app/services/parameters.py` — `validate_definitions` (identifier/uniqueness/type/
  min-max/32-cap checks, raises `ValueError`) and `resolve_and_validate` (defaulting, type coercion,
  range + unknown/missing-required checks; returns `(resolved, errors)` without raising).
- Step 6: `sandbox.py` — `execute_formula` gains a `params` arg; the wrapper loads `params` as a
  SEPARATE global (`json.loads(...)`), never merged into `data`.
- Step 7: `servicer.py` — validates `input_params` before the sandbox and short-circuits to
  `parameter_errors` on failure; validates definitions on Register/Update; persists parameters;
  `_row_to_formula` reconstructs `FormulaParameter` protos via `ParseDict`. Write side converts
  protos→dicts via `MessageToDict` (Deviation Log) so the repo's `json.dumps` works.
- Step 8: added `tests/test_parameters.py`; extended `test_sandbox.py` (params separate from data)
  and `test_formulas.py` (parameters round-trip + ExecuteFormula parameter_errors).
- Verification: `ruff check` + `ruff format --check` clean; `pytest --cov=app --cov-fail-under=50`
  → 57 passed, 83% coverage.
- Files: `app/services/formulas_repository.py`, `app/services/parameters.py` (new),
  `app/services/sandbox.py`, `app/handlers/servicer.py`, `tests/test_parameters.py` (new),
  `tests/test_sandbox.py`, `tests/test_formulas.py`.
- Deviations: Step 7 proto→dict serialization (Deviation Log).

### Steps 9–10 — analysis evaluator forwards input_params [done]
- Step 9: `evaluator.py` CUSTOM_FORMULA branch builds a `params_struct` from numeric `comp.params`
  and passes it as `input_params` on `ExecuteFormulaRequest`; series stays in `input_data`. No
  `analysis.proto` change; existing `metadata=self._meta` propagation reused.
- Step 10: added `test_formula_component_forwards_input_params` asserting the request carries
  `input_params["period"] == 14.0` and `input_data` still carries `close`.
- Verification: `ruff check`/`ruff format --check` clean; `pytest --cov=app --cov-fail-under=40`
  → 92 passed, 58.6% coverage.
- Files: `services/xstockstrat-analysis/app/services/evaluator.py`,
  `services/xstockstrat-analysis/tests/test_strategy_evaluator.py`.
- Deviations: none.

### Steps 11–12 — agent carries parameter definitions through manage_formula [done]
- Step 11: `tools.py` `manage_formula` gains a `parameters: list[dict] | None` arg (documented) and
  threads `parameters or []` into the `formula` dict. `client.py` `manage_formula` maps each
  parameter dict to a `FormulaParameter` proto (type-string→enum, default→`Value`, min/max when
  present) and passes `parameters=[...]` to both `RegisterFormulaRequest` and `UpdateFormulaRequest`.
  `manage_strategy` already carries numeric `StrategyComponent.params` — no change (FR-6).
- Step 12: `test_tools.py` asserts the tool forwards the `parameters` list into the `formula` dict;
  `test_client.py` asserts the mapped `RegisterFormulaRequest.parameters[0]` (name/type/required/
  default/min/max).
- Verification: `ruff check`/`ruff format --check` clean; `pytest --cov=app --cov-fail-under=40`
  → 57 passed, 64.4% coverage.
- Files: `services/xstockstrat-agent/app/client.py`, `services/xstockstrat-agent/app/tools.py`,
  `services/xstockstrat-agent/tests/test_tools.py`, `services/xstockstrat-agent/tests/test_client.py`.
- Deviations: none.

### Step 13 — UI parameter-definition and parameter-value forms [done]
- New `ParameterEditor.tsx`: add/edit/reorder/remove typed parameter definitions (Select over
  int/float/bool/string; min/max only for numeric); exports `ParameterDraft`/`FormulaParameterInit`
  plus `toParameterInit`/`draftFromProto`/`paramDefaultNumber`/`paramDefaultRaw`/`isNumericType`.
- `FormulaWorkspace.tsx`: parameter-definitions cell threaded into `onSave` (value shape gains
  `parameters`); Run cell renders a generated typed `params` form (pre-filled with defaults) sent as
  `inputParams` alongside the unchanged `inputData` JSON; surfaces `result.parameterErrors`.
- `useFormulas.ts`: register/update pass `parameters`; `useExecuteFormula` adds `inputParams`.
- `ComponentEditor.tsx`: CUSTOM_FORMULA branch reads `selectedFormula.parameters`, renders numeric
  params bound to `value.params` (pre-filled with defaults on selection), and shows bool/string
  read-only with "not settable per strategy component" (FR-5). Builtin path unchanged.
- `[id]/page.tsx`: passes `initialParameters={formula.parameters}`. `new/page.tsx` needed no change
  (the `onSave` values flow through the spread).
- Verification: `pnpm exec tsc --noEmit` (exit 0) + `pnpm run lint` (clean) + `prettier --check`
  (clean). Playwright e2e fallback applied — browsers unavailable (Deviation Log).
- Files: `ParameterEditor.tsx` (new), `FormulaWorkspace.tsx`, `useFormulas.ts`, `ComponentEditor.tsx`,
  `src/app/insights/formulas/[id]/page.tsx`.
- Deviations: e2e → tsc+lint fallback (Deviation Log).

### Step 14 — docs: parameter soft-cap + service CLAUDE.md notes [done]
- `services/xstockstrat-indicators/CLAUDE.md`: documented the `parameters` JSONB column, the `params`
  sandbox variable (separate from `data`), `input_params`, structured `parameter_errors`, definition
  validation, and the engine-enforced 32-parameter soft cap (no new config key).
- `docs/runbooks/indicator-builder.md`: added a "Typed Parameters" section (declare params, read
  `params["<name>"]` vs. series in `data`, validation/`parameter_errors`, the 32 cap, and the numeric-
  only strategy-component note).
- Verification: manual read-through; consistent with Steps 3/5/6. No automated gate.
- Files: `services/xstockstrat-indicators/CLAUDE.md`, `docs/runbooks/indicator-builder.md`.
- Deviations: none.

## Session 2026-06-08 — sdd-execute (sequential) — COMPLETE
**Steps this session**: 1–14 (all)
**Progress**: 14 done / 14 total → feature `code-completed`
**Stopped at**: all complete
**Next**: integration PR `claude/sdd-execute-formula-params-gy0lgo` → `main-dev`
**Verification recap**: buf lint/breaking (vs main-dev & main) PASS; migration up/down on postgres:16;
indicators `pytest` 57 passed / 83% cov; analysis 92 passed / 58.6%; agent 57 passed / 64.4%; UI
`tsc --noEmit` + `next lint` + `prettier --check` clean. CI-equivalent fallbacks (host codegen
toolchain, postgres:16 migration check, tsc+lint for UI e2e) logged in the Deviation Log.
- Reviewers snapshot in feature.md is unchanged (reviewer-registry.md unchanged).
