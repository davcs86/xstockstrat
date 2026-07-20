# Implementation Spec: fundamentals-scoring-model

**Status**: `complete`
**Created**: 2026-06-27
**Feature**: `docs/roadmap/features/063-fundamentals-scoring-model/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/fundamentals-scoring-model`

---

## Execution Summary

063 ships a default public "value+quality composite" scoring formula and the analysis-side
helper that invokes it. The work splits cleanly: indicators owns **authoring + idempotent
registration** of the formula (its Python source, typed-parameter definitions for the tunable
sub-weights/band endpoints, and declared outputs `value`/`quality`/`composite`), and analysis
owns a thin **consumer helper** that calls the already-existing `ExecuteFormula` RPC with a
symbol's fundamentals in `input_data` and parses the three sub-scores from the response Struct.

No proto, migration, or config-key changes (confirmed by both discovery digests). Registration
is done via an **idempotent startup seeding hook** in indicators using a deterministic
well-known `formula_id` — because the existing `RegisterFormula` RPC mints a random UUID per
call (`servicer.py:202`) and there is **no seeding mechanism today** (digest finding 6), a
naive re-register would duplicate rows on every restart. A stable id also lets Feature 062
reference the formula by `scoring_formula_id` without runtime discovery.

Steps are ordered indicators-first (the formula must exist before analysis can call it), with
each `service` step immediately followed by its `test` step, then docs.

## Step Dependencies

- Step 2 [test] covers Step 1 [service] (indicators formula + seeding).
- Step 3 [service, analysis] requires Step 1: the analysis helper references the well-known
  `formula_id` and the `{value, quality, composite}` output contract defined in Step 1.
- Step 4 [test] covers Step 3 [service] (analysis consumer helper).
- Step 5 [test] is an end-to-end behavioral check spanning Steps 1+3 — the acceptance-criteria
  scoring cases (cheap/quality high, expensive/negative-EPS low, missing-dividend neutral).
- Step 6 [docs] requires Steps 1 and 3 (documents the final well-known id, bands, and params).

---

### Step 1 — service: Author the value+quality composite formula and seed it idempotently in indicators

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/formulas/__init__.py` — create
- `services/xstockstrat-indicators/app/formulas/fundamentals_value_quality.py` — create (the formula definition: source string, typed `parameters`, declared `outputs`, well-known `formula_id`)
- `services/xstockstrat-indicators/app/services/formulas_repository.py` — modify (add an idempotent `upsert` method)
- `services/xstockstrat-indicators/app/services/seed_formulas.py` — create (the startup seeding hook)
- `services/xstockstrat-indicators/app/main.py` — modify (call the seeding hook after the DB pool is established)

(No new env var or port — confirmed absent need; the indicators deployment blocks at `docker-compose.yml:267-298`, `.do/app.dev.yaml:140-167`, `.do/app.yaml:140` are unchanged.)

**Reviewers**: `xstockstrat-indicators` (service owner) — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Sandbox injects exactly two namespaces into the formula: `data` (from `input_data`) and `params` (from validated `input_params`); the formula must assign a dict to `result`. Confirmed `app/services/sandbox.py:156` (`data = json.loads(...)`), `:159` (`params = json.loads(...)`), `:162` (`_formula_globals = {... 'data': data, 'params': params}`), `:166-168` (output must be assigned to `result`; a bare scalar is wrapped as `{"value": ...}`).
- `RegisterFormula` mints a **random** `formula_id` (`servicer.py:202` `formula_id = str(uuid.uuid4())`) and persists via `self._repo.create(...)` (`servicer.py:244-255`). There is no name-uniqueness constraint — `001_formulas.up.sql:3-13` has only `formula_id UUID PRIMARY KEY`.
- `FormulasRepository.create` is a plain `INSERT ... RETURNING *` (`formulas_repository.py:57-74`) — it would raise on PK conflict if re-run with the same id, so an idempotent variant is required for restart-safe seeding.
- Typed-parameter definitions are validated at register time by `params_validation.validate_definitions(...)` and outputs by `validate_outputs(...)` (`servicer.py:222-223`; helpers in `app/services/parameters.py:56` and `:81`). `FormulaParameter{name,type,default_value,description,required,min,max}` — `packages/proto/indicators/v1/indicators.proto:106-114`; `ParameterType` enum INT/FLOAT/BOOL/STRING — `indicators.proto:98-104`. `MAX_PARAMETERS = 32`, `MAX_OUTPUTS = 16`, reserved output name `value` — `parameters.py:28-32`.
- Output enforcement: when a stored formula declares `outputs`, the sandbox result dict must contain every declared series or the run fails (`services/xstockstrat-indicators/CLAUDE.md` § Declared Formula Outputs). So declare `quality` and `composite` as outputs; `value` is the implicit primary series and must **not** be declared (`parameters.py:30-32`).
- Seeding hook precedent: **none exists** (digest finding 6 — no seed script/migration/startup hook; formulas are RPC-created only). `app/main.py:48-53` establishes the asyncpg pool then constructs the servicer — the seeding call goes here, after `db_pool` is created and before/right after `IndicatorsServicer(...)`.

**Instructions**:
1. Create `app/formulas/fundamentals_value_quality.py` defining a module-level constant block:
   - `FORMULA_ID` — a **deterministic** UUID so re-seeding is idempotent and Feature 062 can reference it by a fixed `scoring_formula_id`. Use a UUIDv5 from a fixed namespace+name, e.g. `FORMULA_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, "xstockstrat:formula:fundamentals-value-quality-v1"))`. Record the resolved string value in the module docstring and in Step 6's docs so it's discoverable.
   - `NAME = "Fundamentals Value+Quality Composite (v1)"`, `AUTHOR = "system"` (define the `"system"` sentinel here — digest notes no system-author convention exists yet), `IS_PUBLIC = True`, `DESCRIPTION` summarizing the model.
   - `SOURCE` — a Python source string written against the sandbox contract (`data` = the symbol's fundamentals dict; `params` = tunables; assign `result`). It must implement FR-3/FR-4/FR-5:
     - Read tunables from `params` with the band endpoints and weights from FR-4 as defaults: `value_weight`, `quality_weight`, `pe_good`/`pe_bad`, `pb_good`/`pb_bad`, `div_peak`/`div_zero_hi`, `roe_good`/`roe_bad`, `de_good`/`de_bad`.
     - A linear-band helper that maps a metric to [0,1] with clamping, honoring direction (lower-is-better inverts), plus the special cases in the FR-4 table: P/E ≤ 0 → 0.0; negative book (P/B) → 0.0; negative equity (D/E) → 0.0; ROE capped at the good endpoint; EPS sign binary (EPS > 0 → 1 else 0); dividend yield **triangular** (rise 0→peak, fall peak→`div_zero_hi`).
     - **Missing-data neutrality (FR-5)**: a metric absent from `data` (key missing or `None`) drops out of its sub-average rather than zeroing it; if a whole sub-score has no contributing metrics, return a neutral 0.5 for that sub-score (never error). The formula must always assign a valid `result`.
     - `result = {"value": value_subscore, "quality": quality_subscore, "composite": value_weight*value_subscore + quality_weight*quality_subscore}` — all clamped to [0,1]. (`value` is the implicit primary series; `quality` and `composite` are declared outputs.)
   - `PARAMETERS` — a list of `indicators_pb2.FormulaParameter` (or dicts converted to them) for every tunable above, each `PARAMETER_TYPE_FLOAT`, with `default_value` set to the FR-4 default and a `description`. Keep total ≤ 32 (`MAX_PARAMETERS`). Names must be valid unique Python identifiers (enforced by `validate_definitions`).
   - `OUTPUTS` — `[FormulaOutput(name="quality", ...), FormulaOutput(name="composite", ...)]` (do **not** include `value`; it is reserved per `parameters.py:30-32`).
2. In `app/services/formulas_repository.py`, add an idempotent `upsert(self, formula_id, name, description, source, author, is_public, input_schema, parameters=None, outputs=None)` method mirroring `create` (lines 45-75) but using `INSERT ... ON CONFLICT (formula_id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, source=EXCLUDED.source, author=EXCLUDED.author, is_public=EXCLUDED.is_public, input_schema=EXCLUDED.input_schema, parameters=EXCLUDED.parameters, outputs=EXCLUDED.outputs, updated_at=NOW() RETURNING *`. Reuse the same `json.dumps(...)` JSONB encoding as `create` (`formulas_repository.py:71-73`). This makes re-seeding on every restart safe and lets a band/param/source change take effect on deploy.
3. Create `app/services/seed_formulas.py` with `async def seed_default_formulas(db_pool) -> None`:
   - Build the `parameters`/`outputs` as the dict shapes the repo persists (mirror `MessageToDict(p)` usage at `servicer.py:228-229`), or accept the `FormulaParameter`/`FormulaOutput` messages and convert with `MessageToDict`.
   - Validate before upsert by calling `parameters.validate_definitions(PARAMETERS)` and `parameters.validate_outputs(OUTPUTS)` (same gate `RegisterFormula` applies at `servicer.py:222-223`) so a malformed seed fails fast at startup rather than at first execute.
   - Call `FormulasRepository(db_pool).upsert(formula_id=FORMULA_ID, name=NAME, description=DESCRIPTION, source=SOURCE, author=AUTHOR, is_public=IS_PUBLIC, input_schema={}, parameters=..., outputs=...)`.
   - Wrap in try/except logging a warning on failure — seeding must never prevent startup (mirror the non-fatal posture the service uses for OTel init).
4. In `app/main.py`, after `db_pool = await asyncpg.create_pool(...)` (`main.py:48-51`), `await seed_default_formulas(db_pool)` (import from `app.services.seed_formulas`). Place it before constructing the servicer at `main.py:53` so the formula is present the moment traffic is accepted.

**Verification**:
- Lint: `cd services/xstockstrat-indicators && ruff check . && ruff format --check .`
- Behavioral (covered fully in Step 2): `cd services/xstockstrat-indicators && uv run pytest tests/test_fundamentals_formula.py -q` — passes.
- Idempotency sanity: `grep -n "ON CONFLICT" services/xstockstrat-indicators/app/services/formulas_repository.py` — confirms the upsert exists.

---

### Step 2 — test: Sandbox + seeding tests for the fundamentals formula (indicators)

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_fundamentals_formula.py` — create

**Reviewers**: `xstockstrat-indicators` (service owner) — formula sandboxing, numeric precision, missing-metric robustness

**Codebase Evidence**:
- Sandbox unit-test pattern: `tests/test_sandbox.py:10-56` calls `execute_formula(source=..., input_data=..., allowed_imports=[...])` directly and asserts on `res.success`, `res.exit_reason`, `res.output` (`test_sandbox.py:18-25`). Import is `from app.services.sandbox import execute_formula` (`test_sandbox.py:7`).
- `execute_formula(source, input_data, allowed_imports, timeout_ms=5000, memory_bytes=..., params=None)` (`sandbox.py:172-179`) — pass the formula's `params` as the resolved tunables dict and `input_data` as the fundamentals dict.
- Repo/seed test pattern: `tests/test_formulas.py:20-70` mocks asyncpg and uses the servicer's in-memory fallback (`db_pool=None`); `tests/test_parameters.py` exercises `validate_definitions`/`validate_outputs`. `tests/conftest.py` holds shared fixtures.
- Coverage gate for indicators is **≥50%** (`pyproject` / CI; `services/.../CLAUDE.md` § Running Tests).

**Instructions**:
1. Import the formula module: `from app.formulas.fundamentals_value_quality import SOURCE, PARAMETERS, OUTPUTS, FORMULA_ID, AUTHOR, IS_PUBLIC` and `from app.services.sandbox import execute_formula`.
2. Add a helper that resolves default param values from `PARAMETERS` into a `params` dict (so tests exercise the same defaults the formula ships with) and runs `execute_formula(source=SOURCE, input_data=<fundamentals>, allowed_imports=["math"], params=<resolved>)`.
3. Behavioral cases (map to Acceptance Criteria 1–3):
   - **AC-1** (valid range): a normal symbol returns `res.success is True` and `output["value"]`, `output["quality"]`, `output["composite"]` each in `[0.0, 1.0]`.
   - **AC-2 high**: cheap/high-quality/low-debt dividend payer (e.g. `pe_ratio=9, pb_ratio=0.9, dividend_yield=0.04, roe=0.28, debt_to_equity=0.25, eps=3.5`) → high `composite` (assert `> 0.7`).
   - **AC-2 low**: expensive/high-debt/negative-EPS (e.g. `pe_ratio=60, pb_ratio=8, dividend_yield=0.0, roe=0.02, debt_to_equity=3.0, eps=-1.0`) → low `composite` (assert `< 0.3`).
   - **AC-3 missing-data**: omit `dividend_yield` entirely → `res.success is True`, all three outputs valid (no error, no whole-score zeroing).
   - **Special-case asserts** (FR-4): `pe_ratio=-5` → value sub-score reflects the 0.0 P/E mapping; `eps=0` → EPS binary contributes 0; `debt_to_equity` with negative equity → 0.0.
4. Validation test: `parameters.validate_definitions(PARAMETERS)` and `parameters.validate_outputs(OUTPUTS)` raise nothing (the seed gate passes), and `"value" not in [o.name for o in OUTPUTS]` (reserved-name rule).
5. Seeding upsert idempotency test: instantiate `FormulasRepository` with a fake asyncpg pool (mirror `tests/test_formulas.py` mock style) and assert the `upsert` SQL contains `ON CONFLICT` and is callable twice without raising. (DB-less; mock `fetchrow`.)

**Verification**:
- `cd services/xstockstrat-indicators && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=50` — all pass; coverage ≥ 50%.

---

### Step 3 — service: Add a fundamentals-scoring consumer helper in analysis

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/fundamentals_scoring.py` — create (helper that calls `ExecuteFormula` and parses `{value, quality, composite}`)

(No new env var/port — `INDICATORS_ENDPOINT` already wired: `docker-compose.yml:351`, `.do/app.dev.yaml:226-227`, `.do/app.yaml:226-227`. The helper reuses the existing indicators stub; no `main.py` change required.)

**Reviewers**: `xstockstrat-analysis` (service owner) — correct consumption of the composite + sub-scores, cross-sectional step correctness; no look-ahead bias

**Codebase Evidence**:
- Analysis already calls `ExecuteFormula` and already builds the stub — the closest template is `app/services/evaluator.py:155-182`: it builds an `input_struct = Struct(); input_struct.update({...})`, a separate `params_struct`, then `resp = await self._indicators.ExecuteFormula(indicators_pb2.ExecuteFormulaRequest(formula_id=..., input_data=input_struct, input_params=params_struct), metadata=self._meta)`, checks `resp.success`, and reads `dict(resp.output)`.
- The indicators stub is `indicators_pb2_grpc.IndicatorsServiceStub(indicators_channel)` (`app/handlers/servicer.py:64`); the channel comes from `INDICATORS_ENDPOINT` (`app/main.py:29,53`).
- Header propagation (Python per-method metadata): the servicer builds `propagation_meta = [(k, v) for k, v in context.invocation_metadata() if k in ("x-user-id","x-access-scope","x-trace-id")]` (`servicer.py:147-151`) and passes `metadata=propagation_meta` on every outbound call (`servicer.py:165,350,370`); the evaluator stores it as `self._meta`. The new helper must accept and forward this same metadata list — do **not** invent a new propagation path.
- `ExecuteFormulaResponse`: `success=1`, `output=2` (**google.protobuf.Struct**) — `packages/proto/indicators/v1/indicators.proto:79`. `value/quality/composite` are keys inside `output`, defined by the formula source (Step 1), not by proto fields.
- No existing fundamentals handling anywhere in analysis (digest finding 4 — `pe_ratio`/`roe`/`market_cap`/`beta`/`value-quality` all **not found**): this helper is entirely new.

**Instructions**:
1. Create `app/services/fundamentals_scoring.py` with `async def score_fundamentals(indicators_stub, formula_id: str, fundamentals: dict, metadata, params: dict | None = None, timeout_ms_override: int = 0) -> dict`:
   - Build `input_struct = Struct(); input_struct.update(fundamentals)` — mirror `evaluator.py:156-162` (`from google.protobuf.struct_pb2 import Struct`). Put only the raw fundamentals (`pe_ratio`, `pb_ratio`, `dividend_yield`, `roe`, `debt_to_equity`, `eps`, …) in `input_data`; **never** merge tunables here.
   - Build `params_struct` from `params` if supplied (tunable overrides) — same split as `evaluator.py:156-162` (params → `input_params`, not `input_data`).
   - Call `resp = await indicators_stub.ExecuteFormula(indicators_pb2.ExecuteFormulaRequest(formula_id=formula_id, input_data=input_struct, input_params=params_struct), metadata=metadata)` — forwarding the propagation metadata verbatim (reuses the existing propagating path; no new client).
   - On `resp.success is False`, raise a descriptive error including `resp.error` / `resp.exit_reason` (mirror how `evaluator.py` treats a failed run) so callers (Feature 062) can surface it.
   - On success, read `out = dict(resp.output)` and return `{"value": float(out.get("value", 0.0)), "quality": float(out.get("quality", 0.0)), "composite": float(out.get("composite", 0.0))}` (the three sub-scores from Step 1's output contract).
2. Keep this a **pure helper module** (no RPC handler, no new config read, no migration) — Feature 062 will call it from its producer path with the `analysis.fundsignal.scoring_formula_id` it owns; 063 provides only the call mechanics and the parse of `{value, quality, composite}`.

**Verification**:
- Lint: `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
- Header propagation present: `grep -n "metadata=metadata\|ExecuteFormula" services/xstockstrat-analysis/app/services/fundamentals_scoring.py` — confirms the outbound call forwards the passed-in propagation metadata.
- Behavioral coverage in Step 4.

---

### Step 4 — test: Consumer-helper test in analysis (mocked ExecuteFormula)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_fundamentals_scoring.py` — create

**Reviewers**: `xstockstrat-analysis` (service owner) — correct consumption of the composite + sub-scores

**Codebase Evidence**:
- ExecuteFormula mock pattern to copy: `tests/test_strategy_evaluator.py:309-343` — `stub.ExecuteFormula = AsyncMock(return_value=resp)` then inspects `stub.ExecuteFormula.await_args.args[0]` and asserts on `dict(req.input_data)`.
- Tests are asyncio (`@pytest.mark.asyncio`); shared fixtures in `tests/conftest.py`; servicer mock factory `make_servicer()` at `tests/test_analysis_servicer.py:22-34`.
- Coverage gate for analysis is **≥40%** (`pyproject` / CI; CLAUDE.md Connection-Pool/Coverage notes).

**Instructions**:
1. Build a fake `indicators_stub` with `ExecuteFormula = AsyncMock(return_value=resp)` where `resp` is an `indicators_pb2.ExecuteFormulaResponse(success=True, output=<Struct with value/quality/composite>)` (use `Struct().update({...})`).
2. Call `score_fundamentals(stub, formula_id="f-123", fundamentals={"pe_ratio": 9, ...}, metadata=[("x-trace-id","t1")])`:
   - Assert the returned dict equals the parsed `{value, quality, composite}` floats.
   - Assert `stub.ExecuteFormula.await_args.kwargs["metadata"]` is the passed-in metadata (propagation forwarded — mirror the `await_args` inspection at `test_strategy_evaluator.py:336-343`).
   - Assert the request's `input_data` carries the fundamentals and `input_params` carries any tunables (the data/params split): `req = stub.ExecuteFormula.await_args.args[0]; assert "pe_ratio" in dict(req.input_data)`.
3. Failure case: `resp = ExecuteFormulaResponse(success=False, error="boom")` → `score_fundamentals` raises (assert with `pytest.raises`).

**Verification**:
- `cd services/xstockstrat-analysis && ruff check . && ruff format --check . && uv run pytest tests/test_fundamentals_scoring.py --cov=app --cov-fail-under=40` — all pass; coverage ≥ 40%.

---

### Step 5 — test: End-to-end scoring-intuition check (formula + helper)

**Status**: `done`
**Service**: `xstockstrat-indicators` (formula execution is the indicators sandbox; the labeled-sample assertions live with the formula)
**Files**:
- `services/xstockstrat-indicators/tests/test_fundamentals_formula.py` — modify (add a small labeled-sample table test)

**Reviewers**: `xstockstrat-indicators` (service owner) — numeric precision, missing-metric robustness, model intuition

**Codebase Evidence**:
- Same direct-sandbox harness as Step 2 (`tests/test_sandbox.py:10-56`, `execute_formula` import at `:7`). Running the labeled sample through the real sandbox (rather than the analysis helper) keeps the check a pure function of the formula and avoids a live indicators dependency, matching the "pure per-symbol function" design (product-spec FR-4, context.md:19-20).

**Instructions**:
1. Add a parameterized test with a small labeled sample (≥4 rows) of `(fundamentals, expected_label)` where `expected_label ∈ {"buy","avoid"}`, covering: a clear value+quality buy, a clear avoid (expensive + negative EPS + high debt), a yield-trap name (very high `dividend_yield` ≥ 0.10 should not inflate the value sub-score — triangular band), and a borderline mid name.
2. Assert ordering/threshold consistency: `composite("buy" rows) > composite("avoid" rows)` and the trap name's `value` sub-score is below the ~4%-yield peak case. This concretizes AC-5 ("match intuition on a small labeled sample") as a deterministic threshold check rather than a qualitative claim (resolves the AC-5 advisory note in context.md:38).
3. Keep thresholds loose enough to be robust to small band retuning but tight enough to catch a sign/inversion bug.

**Verification**:
- `cd services/xstockstrat-indicators && uv run pytest tests/test_fundamentals_formula.py -q` — the labeled-sample test passes; combined with Step 2 the suite still meets `--cov-fail-under=50`.

---

### Step 6 — docs: Document the default formula, well-known id, bands, and tunable params

**Status**: `done`
**Service**: `docs/` + service CLAUDE.md
**Files**:
- `docs/runbooks/indicator-builder.md` — modify (add a "Default fundamentals value+quality formula" section: the well-known `FORMULA_ID`, the FR-4 band table, the tunable `params`, and how to retune without a deploy)
- `services/xstockstrat-indicators/CLAUDE.md` — modify (note the seeded public formula under a new "Seeded Formulas" line and that `app/services/seed_formulas.py` runs at startup)

**Reviewers**: none (docs)

**Codebase Evidence**:
- `docs/runbooks/indicator-builder.md` is the canonical runbook for building/registering formulas (root CLAUDE.md Context Guide → "Building a custom indicator formula").
- `services/xstockstrat-indicators/CLAUDE.md` documents the formula table, typed parameters, and declared outputs (§ Database, § Typed Formula Parameters, § Declared Formula Outputs) — the seeded-formula note belongs alongside these.

**Instructions**:
1. In `indicator-builder.md`, add a section documenting: the resolved `FORMULA_ID` string from Step 1, the value+quality composite definition (FR-3), the FR-4 default-bands table verbatim, the full list of tunable `params` with their defaults, and a note that retuning is a `params` change (or a re-seed via the source constants) — no service code change, consistent with FR-6 and OQ-063-c.
2. In `services/xstockstrat-indicators/CLAUDE.md`, add a short "Seeded Formulas" note pointing to `app/formulas/fundamentals_value_quality.py` and `app/services/seed_formulas.py` (called from `app/main.py` at startup), and state that the seed is idempotent (deterministic `formula_id`, repo `upsert`).
3. Do **not** add any `analysis.fundsignal.*` config key or claim 063 owns `scoring_formula_id` — that key is Feature 062-owned (product-spec lines 99-100, 133; context.md:32-33).

**Verification**:
- `grep -n "fundamentals-value-quality\|Value+Quality\|FORMULA_ID" docs/runbooks/indicator-builder.md services/xstockstrat-indicators/CLAUDE.md` — both files reference the seeded formula and its well-known id.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
