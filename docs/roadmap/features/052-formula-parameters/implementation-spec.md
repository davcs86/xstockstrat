# Implementation Spec: formula-parameters

**Status**: `in-progress`
**Created**: 2026-06-08
**Regenerated**: 2026-06-08 (re-run; all codebase evidence re-verified against current tree)
**Feature**: `docs/roadmap/features/052-formula-parameters/feature.md`
**Total Steps**: 14
**Feature Branch**: `feature/formula-parameters`

---

## Execution Summary

The contract changes land first (Step 1 proto + Step 2 proto-gen) so every downstream service
compiles against the new `FormulaParameter`, `ParameterType`, `input_params`, and
`parameter_errors` symbols. The indicators service is the heart of the feature: the migration
(Step 3) adds the `parameters` JSONB column, then the repository (Step 4), validation engine
(Step 5), sandbox `params` variable (Step 6), and servicer wiring (Step 7) implement
persistence, defaulting, and pre-sandbox validation, each with paired tests. The analysis
evaluator (Step 9) forwards numeric `StrategyComponent.params` as `input_params`. The agent
(Step 11) carries parameter definitions/values through `manage_formula` / `manage_strategy`.
The UI (Step 13) renders parameter-definition and parameter-value forms. A docs step (Step 14)
records config-key and CLAUDE.md updates. Backward compatibility is preserved throughout:
`input_data`/`data` semantics are untouched and all new fields are additive.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs are generated from the edited `.proto`.
- Steps 3–13 (all service code) require Step 2: they import the regenerated stubs
  (`FormulaParameter`, `ParameterType`, `input_params`, `parameter_errors`).
- Step 4 (repository) requires Step 3 (migration): the repo reads/writes the new `parameters` column.
- Step 5 (validation engine) is standalone logic; Step 6 (sandbox `params`) and Step 7 (servicer)
  both depend on Step 5.
- Step 7 (servicer) requires Steps 4, 5, 6.
- Step 8 [test] covers Steps 4–7 [indicators service].
- Step 9 (analysis evaluator) requires Step 2.
- Step 10 [test] covers Step 9 [analysis service].
- Step 11 (agent client+tools) requires Step 2.
- Step 12 [test] covers Step 11 [agent service].
- Step 13 (UI) requires Step 2 (regenerated TS stubs).
- Step 14 (docs) should land last (records the engine soft-cap behavior; no new config key).

---

### Step 1 — proto: Add FormulaParameter, ParameterType, input_params, and parameter_errors

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/indicators/v1/indicators.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes without deprecation comment, `buf lint`/`buf breaking` pass; `xstockstrat-indicators` (service owner) — formula sandboxing, no side-effects from formula execution; `xstockstrat-analysis` (service owner) — backtest reproducibility; `xstockstrat-ui` (service owner) — Connect-RPC call safety

**Codebase Evidence**:
- Confirmed current contract via Read `packages/proto/indicators/v1/indicators.proto`:
  - `ExecuteFormulaRequest` (L63–70) ends at `int64 memory_bytes_override = 6;`
  - `ExecuteFormulaResponse` (L72–81) ends at `SandboxExitReason exit_reason = 8;`
  - `FormulaDefinition` (L92–102) ends at `map<string, string> input_schema = 9;`
  - `RegisterFormulaRequest` (L117–124) ends at `string author = 6;`
  - `UpdateFormulaRequest` (L146–153) ends at `bool is_public = 6;`
  - Imports already present: `google/protobuf/struct.proto` (L8) — provides `Struct` and `Value`.
- Resolved decisions (product-spec "Resolved Decisions"): `default_value` = `google.protobuf.Value`;
  `min`/`max` = optional `double`; dedicated structured error field (NOT extending `SandboxExitReason`);
  `analysis.proto` = no change.

**Instructions**:
1. Add a new enum after `SandboxExitReason` (after L90):
   ```proto
   enum ParameterType {
     PARAMETER_TYPE_UNSPECIFIED = 0;
     PARAMETER_TYPE_INT = 1;
     PARAMETER_TYPE_FLOAT = 2;
     PARAMETER_TYPE_BOOL = 3;
     PARAMETER_TYPE_STRING = 4;
   }
   ```
   (Closed value set → enum per root CLAUDE.md "Prefer enums over strings"; includes the
   required `_UNSPECIFIED = 0` sentinel.)
2. Add a new message `FormulaParameter`:
   ```proto
   message FormulaParameter {
     string name = 1;                       // Python identifier; key in `params`
     ParameterType type = 2;
     google.protobuf.Value default_value = 3;
     string description = 4;
     bool required = 5;
     optional double min = 6;               // numeric params only
     optional double max = 7;               // numeric params only
   }
   ```
3. Add a new message `ParameterValidationError`:
   ```proto
   message ParameterValidationError {
     string name = 1;
     string reason = 2;
   }
   ```
4. In `ExecuteFormulaRequest`, append: `google.protobuf.Struct input_params = 7; // parameter VALUES, separate from input_data`
5. In `ExecuteFormulaResponse`, append: `repeated ParameterValidationError parameter_errors = 9;`
6. In `FormulaDefinition`, append: `repeated FormulaParameter parameters = 10;`
7. In `RegisterFormulaRequest`, append: `repeated FormulaParameter parameters = 7;`
8. In `UpdateFormulaRequest`, append: `repeated FormulaParameter parameters = 7;`
   Do NOT remove or renumber any existing field; `input_schema` (FormulaDefinition L101,
   RegisterFormulaRequest L122) is retained for backward compatibility (FR-8).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/formula-parameters"
```
Also confirm non-breaking against the production baseline the product spec requires:
`cd packages/proto && buf breaking --against ".git#branch=main,subdir=packages/proto"` — must pass
(all changes additive; AC #7).

---

### Step 2 — proto-gen: Regenerate Go/Python/TS stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/indicators/v1/` — modify (generated)
- `packages/proto/gen/python/indicators/v1/` — modify (generated)
- `packages/proto/gen/ts/indicators/v1/` — modify (generated, incl. compiled `dist/`)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes without deprecation comment, `buf lint`/`buf breaking` pass; `xstockstrat-indicators` (service owner); `xstockstrat-analysis` (service owner); `xstockstrat-ui` (service owner) _(inherited from Step 1)_

**Codebase Evidence**:
- Confirmed gen layout via `ls packages/proto/gen/ts/indicators/v1/` → `indicators.ts`,
  `indicators_connect.ts`, `indicators_pb.ts`. Python stubs at `packages/proto/gen/python/`
  (per phase3-deviations.md "Proto stub regeneration"); Go at `packages/proto/gen/go/`.
- `scripts/buf-gen.sh` generates all three languages (buf for Go/TS, grpcio-tools for Python)
  and compiles TS to `dist/` via `pnpm --filter @xstockstrat/proto run build`.

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root. Commit the regenerated stubs **in the same commit**
   as the proto change (per `docs/runbooks/proto-versioning.md` "Commit proto source + generated
   stubs together"). New generated symbols to verify present: `FormulaParameter`, `ParameterType`,
   `ParameterValidationError`, `ExecuteFormulaRequest.input_params`,
   `ExecuteFormulaResponse.parameter_errors` (TS: `parameterErrors`), `FormulaDefinition.parameters`.
2. Do not hand-edit generated files.

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```
Expect a non-empty diff before commit; after `buf-gen.sh` re-run on a clean tree the diff must be
empty (the `proto-freshness` CI job enforces this — `docs/runbooks/proto-versioning.md`).

---

### Step 3 — migration: Add parameters JSONB column to indicators.formulas

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/migrations/002_formula_parameters.up.sql` — create
- `services/xstockstrat-indicators/migrations/002_formula_parameters.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts), up+down pair present, run-order compliance; `xstockstrat-indicators` (service owner) — formula model

**Codebase Evidence**:
- Confirmed last migration via `ls services/xstockstrat-indicators/migrations/` → `001_formulas.up.sql`,
  `001_formulas.down.sql`. Next number is `002`.
- `001_formulas.up.sql` shows the existing table: `indicators.formulas` with
  `input_schema JSONB NOT NULL DEFAULT '{}'` — the new column mirrors this style as a JSONB array.

**Instructions**:
1. Create `002_formula_parameters.up.sql`:
   ```sql
   ALTER TABLE indicators.formulas
       ADD COLUMN parameters JSONB NOT NULL DEFAULT '[]';
   ```
   (Array default `'[]'` because parameters are an *ordered list* of definitions, vs. the
   `input_schema` object default `'{}'`.)
2. Create `002_formula_parameters.down.sql`:
   ```sql
   ALTER TABLE indicators.formulas DROP COLUMN parameters;
   ```
3. Do not edit `001_formulas.up.sql` (root CLAUDE.md: never edit an applied migration).

**Verification**:
```bash
./scripts/db-migrate.sh   # applies 002 up; confirm no error and schema_migrations advances to 2
```
Then confirm the column exists (psql): `\d indicators.formulas` shows `parameters | jsonb`.

---

### Step 4 — service: Persist parameters in FormulasRepository

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/formulas_repository.py` — modify

**Reviewers**: `xstockstrat-indicators` (service owner) — formula model, persistence correctness

**Codebase Evidence**:
- Confirmed via Read `app/services/formulas_repository.py`:
  - `_to_dict` (L16–26) decodes JSONB `input_schema` from a JSON string to a dict.
  - `create` (L35–60) `INSERT ... (formula_id, name, description, source, author, is_public, input_schema)
    VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb)` with `json.dumps(...)` for the JSONB arg.
  - `update` (L95–116) `UPDATE ... SET name=$2, description=$3, source=$4, is_public=$5, updated_at=NOW()`.
  - `get_by_id` (L62–67) / `list` (L69–93) `SELECT *` so they already return the new column once added.

**Instructions**:
1. Extend `_to_dict` to decode the new `parameters` JSONB the same way as `input_schema`: if the raw
   value is a `str`, `json.loads` it (default `[]`); if `None`, default to `[]`. Keep `input_schema`
   handling unchanged.
2. Add a `parameters` argument to `create(...)` (default `None`); add `parameters` to the INSERT
   column list and add a positional `$8::jsonb` value bound to `json.dumps(list(parameters) if
   parameters else [])`.
3. Add a `parameters` argument to `update(...)` (default `None`); add `parameters = $6::jsonb` to the
   SET clause with `json.dumps(...)` bound positionally. Keep existing SET columns and the `updated_at
   = NOW()` clause.

**Verification**: covered by Step 8 (`test_formulas.py` repository round-trip asserts
`result["parameters"]` decodes back to the list). Lint in Step 8.

---

### Step 5 — service: Add parameter validation/defaulting engine

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/parameters.py` — create

**Reviewers**: `xstockstrat-indicators` (service owner) — validation correctness, no side-effects

**Codebase Evidence**:
- **Not found** — there is no existing parameter-validation module; confirmed via
  `find services/xstockstrat-indicators -type f` (only `indicators_engine.py`, `sandbox.py`,
  `formulas_repository.py` under `app/services/`). This module is created from scratch.
- Resolved decisions (product-spec): parameter names validated as Python identifiers
  `[A-Za-z_][A-Za-z0-9_]*`; soft cap of 32 parameters enforced in-engine (no config key);
  `default_value` is a `google.protobuf.Value`; `min`/`max` are numeric-only `double`.
- Generated proto enum from Step 2: `indicators_pb2.PARAMETER_TYPE_{INT,FLOAT,BOOL,STRING,UNSPECIFIED}`.

**Instructions**:
1. Define `MAX_PARAMETERS = 32` and `_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")`.
2. `validate_definitions(parameters) -> None`: raise `ValueError` if `len(parameters) > MAX_PARAMETERS`,
   if any `name` is not a valid Python identifier, if names are not unique, if `type` is
   `PARAMETER_TYPE_UNSPECIFIED`, or if `min`/`max` are set on a non-numeric (bool/string) param or
   `min > max`. Used at register/update time (called from Step 7).
3. `resolve_and_validate(parameters, input_params_struct) -> tuple[dict, list[tuple[str, str]]]`:
   convert the `google.protobuf.Struct` to a dict; for each declared parameter apply the default
   (read from `default_value`, a `google.protobuf.Value`, via `google.protobuf.json_format` /
   `MessageToDict` or `WhichOneof`) when omitted; coerce and type-check supplied values against
   `ParameterType` (int/float/bool/string), enforce `min`/`max` for numeric params; collect
   `(name, reason)` for unknown keys, missing-required, type mismatch, and out-of-range. Return the
   resolved `params` dict and the error list. **Do not** raise on value errors — return them so the
   servicer maps them to `parameter_errors` (FR-2).

**Verification**: covered by Step 8 (`tests/test_parameters.py`: defaulting, type coercion, range
rejection, unknown/missing-required, identifier/uniqueness/cap rejection). Lint in Step 8.

---

### Step 6 — service: Expose validated params as a separate `params` variable in the sandbox

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/sandbox.py` — modify

**Reviewers**: `xstockstrat-indicators` (service owner) — sandbox security model unchanged (no new imports/builtins; timeout/memory limits unchanged)

**Codebase Evidence**:
- Confirmed via Read `app/services/sandbox.py`:
  - `execute_formula(source, input_data, allowed_imports, timeout_ms, memory_bytes)` (L146–152).
  - `_SANDBOX_WRAPPER` (L95–143) loads `data = json.loads({input_json!r})` (L133) and builds
    `_formula_globals = {{'__builtins__': _restricted_builtins, 'data': data}}` (L136), then
    `exec({source!r}, _formula_globals)` (L137).
  - `.format(...)` call at L159–165 substitutes `input_json=json.dumps(input_data)`.
- Out of Scope (product-spec): no change to sandbox security model, allowed imports, timeout, memory.

**Instructions**:
1. Add a `params: dict | None = None` argument to `execute_formula(...)` (after `input_data`).
2. In `_SANDBOX_WRAPPER`, add a line mirroring the `data` load:
   `params = json.loads({params_json!r})` and include `params` in `_formula_globals`:
   `{{'__builtins__': _restricted_builtins, 'data': data, 'params': params}}`. **Do not** merge
   `params` into `data` (FR-3 — `data` continues to hold only `input_data`).
3. In the `.format(...)` call, add `params_json=json.dumps(params or {})`.
4. Make no other changes — builtins filter, import guard, memory/timeout handling stay identical.

**Verification**: covered by Step 8 (`test_sandbox.py`: a formula reading `params["period"]`
resolves the value; `data` does not contain the param key). Lint in Step 8.

---

### Step 7 — service: Wire validation + input_params + parameters into IndicatorsServicer

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-indicators` (service owner) — formula sandboxing, validation before execution, no side-effects

**Codebase Evidence**:
- Confirmed via Read `app/handlers/servicer.py`:
  - `ExecuteFormula` (L70–137): resolves `source`, computes `input_data = dict(request.input_data)`
    (L99), calls `sandbox.execute_formula(source=..., input_data=..., allowed_imports=...,
    timeout_ms=..., memory_bytes=...)` (L107–113), builds `ExecuteFormulaResponse` (L126–137).
  - `RegisterFormula` (L150–195): builds `FormulaDefinition(...)` (L173–183) and calls
    `self._repo.create(..., input_schema=dict(request.input_schema))` (L186–194).
  - `UpdateFormula` (L229–252): calls `self._repo.update(formula_id, name, description, source,
    is_public)` (L244–250).
  - `_row_to_formula` (L274–296): maps a DB row to `FormulaDefinition`, including
    `input_schema=dict(row["input_schema"]) ...` (L295).

**Instructions**:
1. Import the Step 5 module: `from app.services import parameters as params_validation`.
2. In `ExecuteFormula`, after resolving `source` and before calling the sandbox: when the formula was
   loaded by `formula_id`, read its `parameters` (from the cached `FormulaDefinition` /
   `_row_to_formula`); for inline `formula_source` runs there is no stored definition, so treat
   declared parameters as empty (values still pass through as-is via `input_params`). Call
   `resolved_params, param_errors = params_validation.resolve_and_validate(parameters,
   request.input_params)`. If `param_errors` is non-empty, return early:
   `ExecuteFormulaResponse(success=False, parameter_errors=[indicators_pb2.ParameterValidationError(
   name=n, reason=r) for n, r in param_errors])` — **before** invoking the sandbox (FR-2).
3. Pass `params=resolved_params` to `sandbox.execute_formula(...)` (new arg from Step 6). Leave
   `input_data=dict(request.input_data)` unchanged.
4. In `RegisterFormula`: call `params_validation.validate_definitions(request.parameters)` (abort
   `INVALID_ARGUMENT` on `ValueError`); set `parameters=list(request.parameters)` on the
   `FormulaDefinition(...)`; pass `parameters=list(request.parameters)` to `self._repo.create(...)`.
5. In `UpdateFormula`: call `params_validation.validate_definitions(request.parameters)` and pass
   `parameters=list(request.parameters)` to `self._repo.update(...)`.
6. In `_row_to_formula`: add `parameters=...` built from `row.get("parameters")` (the repo decodes it
   to a list of dicts in Step 4 — convert each dict to a `FormulaParameter`, e.g. via
   `json_format.ParseDict`).

**Verification**: covered by Step 8. Lint in Step 8. No new outbound gRPC call is added (the servicer
only calls the local sandbox + repo), so §5c header-propagation does not apply.

---

### Step 8 — test: Indicators parameter validation, sandbox params, repository, servicer

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_parameters.py` — create
- `services/xstockstrat-indicators/tests/test_sandbox.py` — modify
- `services/xstockstrat-indicators/tests/test_formulas.py` — modify

**Reviewers**: `xstockstrat-indicators` (service owner) — coverage of validation/defaulting paths

**Codebase Evidence**:
- Confirmed test patterns via Read `tests/test_formulas.py` (asyncpg pool mocked with
  `AsyncMock`/`MagicMock`; servicer in-memory path with `db_pool=None`; `RegisterFormulaRequest`
  built from `indicators_pb2`) and `tests/test_sandbox.py` (`execute_formula(source=..., input_data={},
  ...)` direct calls, asserting `res.success` / `res.output`).
- Coverage threshold: indicators ≥ 50% (root CLAUDE.md CI/CD; service CLAUDE.md `--cov-fail-under=50`).

**Instructions**:
1. `test_parameters.py`: cover `validate_definitions` (reject non-identifier name, duplicate names,
   `UNSPECIFIED` type, min/max on bool/string, min>max, >32 params) and `resolve_and_validate`
   (apply default for omitted, coerce int/float/bool/string, reject out-of-range, reject unknown key,
   reject missing-required).
2. `test_sandbox.py`: add a case where `source="result = params['period'] * 2"`,
   `params={"period": 7}` yields `output == {"value": 14}`; assert a formula reading `data` does not
   see the param (separate namespace).
3. `test_formulas.py`: extend the repository `create`/`list` round-trip to assert the `parameters`
   column decodes back to a list; add a servicer `ExecuteFormula` test asserting `success=False` with
   populated `parameter_errors` on an out-of-range value (mock the repo to return a formula with one
   numeric parameter).

**Verification**:
```bash
cd services/xstockstrat-indicators && ruff check . && ruff format --check .
cd services/xstockstrat-indicators && pytest --cov=app --cov-fail-under=50
```

---

### Step 9 — service: Forward StrategyComponent.params as input_params in the evaluator

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, backtest/live parity, no look-ahead

**Codebase Evidence**:
- Confirmed via Read `app/services/evaluator.py`:
  - `_compute_component` CUSTOM_FORMULA branch (L117–133): builds `input_struct = Struct()` /
    `input_struct.update({"close": closes})` (L118–119), calls
    `self._indicators.ExecuteFormula(indicators_pb2.ExecuteFormulaRequest(formula_id=comp.formula_id,
    input_data=input_struct), metadata=self._meta)` (L120–126).
  - `comp.params` is `map<string, double>` (used for builtin indicators at L110
    `params=dict(comp.params)`); confirmed numeric-only per product-spec FR-7 / Resolved Decisions.
  - The call already forwards `metadata=self._meta` (propagation tuples set in `__init__` L50–55),
    so header propagation is reused — no new client/interceptor (§5c satisfied via existing path).

**Instructions**:
1. In the CUSTOM_FORMULA branch, build a second Struct from the component's numeric params:
   `params_struct = Struct(); params_struct.update(dict(comp.params))`.
2. Add `input_params=params_struct` to the `ExecuteFormulaRequest(...)` init (alongside the existing
   `formula_id` and `input_data`). Leave `input_data=input_struct` (the `{"close": closes}` series)
   unchanged — series stays in `input_data`, values go in `input_params` (FR-7). The engine applies
   declared defaults for anything omitted, so passing only the configured numeric values is correct.
3. Make no change to `analysis.proto` (Resolved Decisions: `StrategyComponent.params` reused as-is).

**Verification**: covered by Step 10. Lint in Step 10.

---

### Step 10 — test: Evaluator forwards input_params for CUSTOM_FORMULA components

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_strategy_evaluator.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner)

**Codebase Evidence**:
- Confirmed via grep `tests/test_strategy_evaluator.py`: existing CUSTOM_FORMULA component fixtures
  (L32–34 build `StrategyComponent(kind=COMPONENT_KIND_CUSTOM_FORMULA, ...)`); `class TestEvaluate`
  (L134) with async `test_evaluate_produces_per_bar_decisions` (L136) drives `evaluate(...)`.
- Coverage threshold: analysis ≥ 40% (`--cov-fail-under=40`, service CLAUDE.md).

**Instructions**:
1. Add a test that constructs a `StrategyEvaluator` with a mocked `indicators_stub`
   (`ExecuteFormula = AsyncMock(...)` returning a successful response whose output has a `value`
   list), a CUSTOM_FORMULA component with `params={"period": 14.0}`, and asserts the
   `ExecuteFormulaRequest` passed to `ExecuteFormula` carries `input_params` containing
   `period == 14.0` while `input_data` still carries `close`.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40
```

---

### Step 11 — service: Carry parameter definitions/values through agent client + MCP tools

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` — _(no service-owner row in reviewer-registry; per `service` category, use the service being modified)_ `xstockstrat-agent` (service owner)

**Codebase Evidence**:
- Confirmed via Read `app/client.py`:
  - `manage_formula` (L263–308) builds `RegisterFormulaRequest(name, description, source, is_public,
    author)` (L278–284) and `UpdateFormulaRequest(formula_id, user_id, name, description, source,
    is_public)` (L290–297) — no `parameters` field today.
  - `manage_strategy` (L175–234) builds `StrategyComponent(ref_name, kind, indicator, formula_id,
    params={k: float(v) ...})` (L201–209) — numeric `params` already carried; reused as-is (FR-6/FR-7).
  - Calls forward `metadata=_admin_metadata(api_key)` / `_metadata()` — existing propagation reused;
    no new client/channel introduced (§5c satisfied).
- Confirmed via Read `app/tools.py`: `manage_formula` tool (L284–317) builds the `formula` dict
  (L303–311); `manage_strategy` tool (L246–281) builds `components` (L261) and passes them through.

**Instructions**:
1. In `tools.py` `manage_formula`: add a `parameters: list[dict] | None = None` argument (documented
   in the docstring as a list of `{name, type, default, description, required, min, max}`); add
   `"parameters": parameters or []` to the `formula` dict.
2. In `client.py` `manage_formula`: convert each parameter dict to an
   `indicators_pb2.FormulaParameter` (map `type` string → `ParameterType` enum; wrap `default` in a
   `google.protobuf.Value`; set `min`/`max` only when present). Pass `parameters=[...]` to both
   `RegisterFormulaRequest(...)` and `UpdateFormulaRequest(...)`.
3. `manage_strategy` already carries numeric `StrategyComponent.params` (per-component values) — no
   change needed for the strategy path beyond confirming components flow through (FR-6).

**Verification**: covered by Step 12. Lint in Step 12.

---

### Step 12 — test: Agent manage_formula carries parameter definitions

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner)

**Codebase Evidence**:
- Confirmed via grep `tests/test_tools.py`: existing `manage_formula` tool tests patch
  `client.manage_formula` with `AsyncMock(return_value={"formula_id": "f-1"})` (L327) and invoke
  `_tool_fn(server, "manage_formula")(...)` (L329, L332).
- Coverage threshold: agent ≥ 40% (`--cov-fail-under=40`, service CLAUDE.md).

**Instructions**:
1. Extend the `manage_formula` tool test to pass `parameters=[{"name": "period", "type": "int",
   "default": 14, "required": True, "min": 1, "max": 200}]` and assert the patched
   `client.manage_formula` received a `formula` dict whose `parameters` list contains that entry.
2. (Optional, if covering `client.py` mapping) add a focused test that
   `client.manage_formula(operation="register", formula={... "parameters": [...]})` builds a
   `RegisterFormulaRequest` whose `parameters[0].name == "period"` — patch the gRPC stub
   `RegisterFormula` with `AsyncMock` (mirror the existing channel/stub patch pattern in this file).

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40
```

---

### Step 13 — service: Parameter-definition and parameter-value forms in the UI

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/FormulaWorkspace.tsx` — modify
- `services/xstockstrat-ui/src/hooks/useFormulas.ts` — modify
- `services/xstockstrat-ui/src/components/insights/ComponentEditor.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/ParameterEditor.tsx` — create
- `services/xstockstrat-ui/src/app/insights/formulas/new/page.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/formulas/[id]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — Trading/analytics UI correctness, Connect-RPC call safety, no secret values rendered

**Codebase Evidence**:
- Confirmed via Read:
  - `FormulaWorkspace.tsx`: notebook-style cells; `onSave` currently emits
    `{ name, description, source, isPublic }` (L28, L117); Run cell calls
    `executeMut.mutate({ formulaSource: source, inputData: parsed })` (L76) via
    `useExecuteFormula` (L11, L65).
  - `useFormulas.ts`: `useRegisterFormula` passes `inputSchema` to `registerFormula` (L39) but
    omits `parameters`; `useUpdateFormula` (L46) omits both; `useExecuteFormula` sends
    `{ formulaId, formulaSource, inputData }` (L83–87) — no `inputParams`.
  - `ComponentEditor.tsx`: `StrategyComponentDraft.params: Record<string, number>` (L18–24); the
    CUSTOM_FORMULA branch (L95–124) renders a formula picker; `useFormulas` already loads formula
    list (L43) so `selectedFormula` (L67) exposes the chosen formula's `parameters`. Params are a
    free-form key/value row list (L134–177) to be replaced for formula components.
  - New/edit pages pass `onSave` to `FormulaWorkspace` (new page L22–26; edit page L63).
- Browser client `src/lib/browserClients/indicatorsClient.ts` already targets the BFF
  `/insights/api` Connect transport; the catch-all handler at
  `src/app/insights/api/[...connect]/route.ts` proxies `ExecuteFormula`/`RegisterFormula` — no route
  change needed (new proto fields ride the existing RPCs).

**Instructions**:
1. Create `ParameterEditor.tsx`: an add/edit/reorder/remove editor for a list of parameter
   definitions `{ name, type, default, description, required, min, max }`, modeled on the existing
   param-row pattern in `ComponentEditor.tsx` (L134–177). `type` is a `Select` over int/float/bool/string.
2. `FormulaWorkspace.tsx`: add a parameter-definitions cell (using `ParameterEditor`) and thread the
   definitions into `onSave` (extend the `onSave` value shape to include `parameters`). In the Run
   cell, render a generated typed `params` form from the current definitions (pre-filled with
   defaults) and submit it as `inputParams` alongside the existing `inputData` JSON editor (which is
   unchanged — FR-4). Surface `result.parameterErrors` per-parameter in `FormulaRunResult`/the run
   cell.
3. `useFormulas.ts`: pass `parameters` through `useRegisterFormula`/`useUpdateFormula`
   (`registerFormula({... parameters})`), and add `inputParams` to `useExecuteFormula`'s mutation
   input + the `executeFormula({... inputParams})` call.
4. `ComponentEditor.tsx` (CUSTOM_FORMULA branch): when a formula is selected, read
   `selectedFormula.parameters`; render a typed form for the **numeric** (int/float) parameters
   pre-filled with defaults and bound to `value.params` (kept `Record<string, number>`); show
   bool/string parameters read-only with their default and a note "not settable per strategy
   component" (FR-5 / Out of Scope). Keep the free-form key/value editor only for builtin components.
5. Update the new/edit pages only if the `onSave` value shape change requires it (pass `parameters`
   through to `useRegisterFormula`/`useUpdateFormula`).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm test:e2e -- insights
```
No CI coverage threshold for the UI (root CLAUDE.md); existing Playwright e2e under
`services/xstockstrat-ui/e2e/` applies. A `test` pairing is not required for the Next.js frontend
(reviewer-registry / spec test-pairing rule: frontends use e2e, no coverage gate).

---

### Step 14 — docs: Record parameter soft-cap and update service CLAUDE.md notes

**Status**: `pending`
**Service**: `docs/runbooks/` + service CLAUDE.md
**Files**:
- `services/xstockstrat-indicators/CLAUDE.md` — modify
- `docs/runbooks/indicator-builder.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed `services/xstockstrat-indicators/CLAUDE.md` documents the formula model, `indicators.formulas`
  table, and sandbox model but not parameters. `docs/runbooks/indicator-builder.md` is the registered
  runbook for building custom formula indicators (docs/runbooks/CLAUDE.md).
- No new config key (product-spec "Config Key Changes"): the 32-parameter cap is hardcoded in the
  engine (Step 5), so root CLAUDE.md config tables need no change.

**Instructions**:
1. In `services/xstockstrat-indicators/CLAUDE.md`: document the new `parameters` column on
   `indicators.formulas`, the `params` sandbox variable (separate from `data`), the `input_params`
   execution field, the structured `parameter_errors` response, and the 32-parameter soft cap.
2. In `docs/runbooks/indicator-builder.md`: add a short section on declaring typed parameters and
   reading `params["<name>"]` in formula source (vs. series in `data`).
3. State explicitly that no new config key was added (cap is engine-enforced).

**Verification**: manual read-through; `docs` steps have no automated gate. Confirm the new
`parameters` column and `params` variable are described and match Steps 3/5/6.

---

## Deviation Log

### Deviation: Step 2 — proto-gen toolchain via host install (CI-equivalent fallback)
**Spec said**: Run `./scripts/buf-gen.sh` (via the Docker codegen container, `Dockerfile.codegen` / `localenv-setup.sh`).
**Actual**: The Docker codegen image build hit a Docker Hub `429 Too Many Requests` (unauthenticated pull rate limit) on `golang:1.25-trixie`. Per the sequential-mode "Proto codegen container blocked" fallback, the codegen toolchain was installed on the host pinned to the CI `proto-freshness` job versions (`.github/workflows/ci.yml` L136–138): `buf` (latest), `protoc-gen-go@v1.36.11`, `protoc-gen-go-grpc@v1.6.2`, `protoc-gen-connect-go@v1.19.2`, `grpcio-tools==1.80.0`, and the TS plugins `ts-proto@2.11.8` / `@bufbuild/protoc-gen-es@2.12.0` / `@connectrpc/protoc-gen-connect-es@1.7.0`. `./scripts/buf-gen.sh` was then run on the host; `git diff packages/proto/gen/` is scoped to the indicators service only and `buf-gen.sh` is idempotent (mirrors the CI stale-stub check).
**Reason**: Docker Hub rate limit blocked the container path; host toolchain matches CI versions exactly.
**Disposition**: CI-equivalent fallback. Note: `Dockerfile.codegen` pins `protoc-gen-go-grpc@v1.6.1` while CI (and the committed stubs) use `v1.6.2` — a pre-existing Dockerfile drift, not introduced here; v1.6.2 was used to match CI/committed output.

### Deviation: Step 3 — migration verified against throwaway postgres:16 (CI-equivalent fallback)
**Spec said**: `./scripts/db-migrate.sh` (golang-migrate against the running TimescaleDB).
**Actual**: `migrate` binary and a running DB are unavailable in the environment. Per the sequential-mode "migrate / DB unavailable" fallback, `001_formulas.up.sql` then `002_formula_parameters.up.sql` were applied against a throwaway `postgres:16` container (`psql -v ON_ERROR_STOP=1`); `\d indicators.formulas` confirmed `parameters | jsonb | not null | '[]'::jsonb`, then `002_formula_parameters.down.sql` dropped the column cleanly (reversibility proven).
**Reason**: no `migrate`/DB on host; container path proves both directions.
**Disposition**: CI-equivalent fallback.
