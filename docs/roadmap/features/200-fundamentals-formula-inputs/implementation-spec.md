# Implementation Spec: fundamentals-formula-inputs

**Status**: `code-completed`
**Created**: 2026-09-21
**Feature**: `docs/roadmap/features/200-fundamentals-formula-inputs/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/fundamentals-formula-inputs`

---

## Execution Summary

This feature makes a `COMPONENT_KIND_CUSTOM_FORMULA` strategy component fundamentals-capable
following the design's **two-disjoint-kinds** model (`design.md` § Chosen Approach): a formula that
declares a non-empty `fundamental_inputs` is a *fundamentals-only* formula fed only its declared
fundamentals as `ExecuteFormula.input_data` scalars, broadcast across the bar span; a formula that
declares none is byte-identical to today. The change begins in the contract (proto enum + additive
field), is persisted (indicators migration `006` + Register/Update writes + `GetFormula` mapping),
then lands in the analysis evaluator (a new scalar-broadcast branch in `_assemble_component_series`)
and the analysis servicer (an eval-time routing map + a new snapshot loader + the reused gate at a
second site), and finally a read-only UI badge (C-14). Order is contract → persistence → producer
(indicators) → consumer (analysis) → surface (UI) → docs, so each layer's evidence exists before the
next consumes it.

Consumer surfaces (C-14, from `product-spec.md` § Consumer Surface(s)): **UI** `/insights`
`ComponentEditor` — a read-only badge (Step 10–11); **Agent** `manage_strategy` — no code change
(it already builds formula components), documented in the strat-lab backtest skill (Step 12). No
surface is deferred.

### Scenario Coverage (Constitution C-15)

| `@AC-*` | Covered by step(s) |
|---|---|
| AC-1 (broadcast composite, rule fires) | Step 7 |
| AC-2 (backtest PIT epoch, no look-ahead) | Step 7 |
| AC-3 (live/screener snapshot, no PIT lookup) | Step 9 |
| AC-4 (full-row producer↔strategy parity) | Step 9 |
| AC-5 (missing/error → None hold, no fabrication) | Step 7 |
| AC-6 (registration rejects UNSPECIFIED) | Step 5 |
| AC-7 (technical formula byte-for-byte unaffected) | Step 7 |
| AC-8 (partial-row omit-absent divergence) | Step 7 |

---

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the new `.proto`.
- Step 4 (indicators service) requires Steps 2 + 3: it reads the generated `FundamentalMetric`/
  `fundamental_inputs` symbols and the new DB column.
- Step 6 (analysis evaluator) requires Step 2: the branch reads `FundamentalMetric` enum values to
  lower to `data`-keys; it does not depend on the indicators service impl (it calls `ExecuteFormula`
  over the wire, unchanged).
- Step 8 (analysis servicer) requires Step 4 (so `GetFormula` actually returns `fundamental_inputs`
  at eval time — without it the routing map is always empty and every fundamentals formula
  dead-routes to `FormulaExecutionError`, `design.md` R4/R5) and Step 6 (the evaluator branch +
  threaded `formula_fund_map`).
- Step 10 (UI badge) requires Step 2 (the generated TS `FormulaDefinition.fundamentalInputs`).
- Each `service` step is paired with the immediately-following `test` step (C-08): Step 4↔5,
  Step 6↔7, Step 8↔9, Step 10↔11.
- **Design residual carried to execute (not a blocker):** the fundamentals-formula channel is fed by
  the PIT `_load_fundamentals` on backtest and by the new `_load_fundamentals_snapshot` on the 5
  non-backtest surfaces (`design.md` § Backtest / § Snapshot). A strategy that combines a
  single-metric `COMPONENT_KIND_FUNDAMENTAL` operand (feature 198, always PIT) **and** a
  fundamentals-formula on a non-backtest surface is an unspecified co-occurrence — the design's
  write-time XOR guard (Step 8) covers only `source_symbol`+`fundamental_inputs` on one component,
  not this cross-component pairing. Step 8 keeps the two loaders on **separate channels** so 198's
  PIT-on-live behavior is preserved byte-identically (C-16 PRESERVE `@AC-3` `@feature-198`); the
  co-occurrence is recorded to `context.md` Open Threads at execute time.

---

### Step 1 — proto: add `FundamentalMetric` enum + `fundamental_inputs` to indicators contract

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/indicators/v1/indicators.proto` — modify

**Reviewers**: Proto Reviewer — field-number uniqueness, no breaking change, `buf lint`/`buf breaking`; xstockstrat-indicators — formula-definition contract; xstockstrat-analysis — the field it consumes at eval time

**Codebase Evidence**:
- `FormulaDefinition` occupies fields 1–13, last is `bool deleted = 13` — `packages/proto/indicators/v1/indicators.proto:132-148`. Next free field number = **14**.
- `RegisterFormulaRequest` last field is `int32 warmup_period = 9` (`:172`); `UpdateFormulaRequest`
  last field is `google.protobuf.FieldMask update_mask = 10` (`:208`). Next free = **10** and **11**.
- Enum-over-string + `_UNSPECIFIED=0` sentinel is Constitution **C-04** / root `CLAUDE.md` § Proto
  Contract Governance; the 11-metric vocabulary is confirmed identical in three existing places:
  analysis `_FUNDAMENTAL_METRICS` (`services/xstockstrat-analysis/app/services/evaluator.py:122-134`),
  marketdata `Fundamentals` fields (`packages/proto/marketdata/v1/marketdata.proto:208-228`), and UI
  `FUNDAMENTAL_METRICS` (`services/xstockstrat-ui/src/lib/strategyCatalog.ts:137-149`).

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. Add a new closed enum near the other message/enum declarations, with the exact 11 canonical
   metric names from `design.md` § Declaration and a zero sentinel (C-04):
   ```proto
   enum FundamentalMetric {
     FUNDAMENTAL_METRIC_UNSPECIFIED = 0;
     FUNDAMENTAL_METRIC_MARKET_CAP = 1;
     FUNDAMENTAL_METRIC_PE_RATIO = 2;
     FUNDAMENTAL_METRIC_PB_RATIO = 3;
     FUNDAMENTAL_METRIC_DIVIDEND_YIELD = 4;
     FUNDAMENTAL_METRIC_EPS = 5;
     FUNDAMENTAL_METRIC_BETA = 6;
     FUNDAMENTAL_METRIC_ROE = 7;
     FUNDAMENTAL_METRIC_DEBT_TO_EQUITY = 8;
     FUNDAMENTAL_METRIC_PRICE = 9;
     FUNDAMENTAL_METRIC_YEAR_HIGH = 10;
     FUNDAMENTAL_METRIC_YEAR_LOW = 11;
   }
   ```
2. Add `repeated FundamentalMetric fundamental_inputs = 14;` to `FormulaDefinition` (a non-empty
   value **is** the fundamentals-only category marker — `design.md` § Routing predicate; add a
   one-line comment saying so, within the 2-line cap).
3. Add `repeated FundamentalMetric fundamental_inputs = 10;` to `RegisterFormulaRequest` and
   `repeated FundamentalMetric fundamental_inputs = 11;` to `UpdateFormulaRequest`.
4. All additions are new field numbers / a new enum → additive, non-breaking (C-09).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/fundamentals-formula-inputs"
```
Both pass (no lint error, no breaking-change finding).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/` — modify (generated; never hand-edited)

**Reviewers**: Proto Reviewer — field-number uniqueness, no breaking change, `buf lint`/`buf breaking`; xstockstrat-indicators — formula-definition contract; xstockstrat-analysis — the field it consumes at eval time (inherited from Step 1)

**Codebase Evidence**:
- Codegen entrypoint is `./scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs); it
  generates TS/Python/Go and compiles the TS package.

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh`.
2. Confirm the only changes under `packages/proto/gen/` are the new `FundamentalMetric` enum + the
   three `fundamental_inputs` fields across TS/Python/Go stubs. Do not hand-edit generated output.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --short packages/proto/gen/
```
The diff contains only the additive enum/field additions (no unrelated churn).

---

### Step 3 — migration: persist `fundamental_inputs` on `indicators.formulas`

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/migrations/006_add_formula_fundamental_inputs.up.sql` — create
- `services/xstockstrat-indicators/migrations/006_add_formula_fundamental_inputs.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, run-order compliance; xstockstrat-indicators — schema ownership

**Codebase Evidence**:
- Last migration on disk is `005_add_formula_soft_delete.*` (`ls
  services/xstockstrat-indicators/migrations/`), so next free `NNN` = **006** (C-07).
- JSONB-column precedent `003_formula_outputs.up.sql` is exactly `ALTER TABLE indicators.formulas ADD
  COLUMN outputs JSONB NOT NULL DEFAULT '[]';` with `.down` `ALTER TABLE indicators.formulas DROP
  COLUMN outputs;` (read both files).

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. `006_add_formula_fundamental_inputs.up.sql`:
   ```sql
   ALTER TABLE indicators.formulas
       ADD COLUMN fundamental_inputs JSONB NOT NULL DEFAULT '[]';
   ```
   (Stores a JSON array of `FundamentalMetric` enum ints, mirroring `003_formula_outputs` —
   `design.md` R4/R5.)
2. `006_add_formula_fundamental_inputs.down.sql`:
   ```sql
   ALTER TABLE indicators.formulas DROP COLUMN fundamental_inputs;
   ```

**Verification** (offline, no DB — per `reference/spec-template.md` § Migration step verification):
```bash
ls services/xstockstrat-indicators/migrations/006_add_formula_fundamental_inputs.up.sql \
   services/xstockstrat-indicators/migrations/006_add_formula_fundamental_inputs.down.sql
```
Then read both: the `.up` `ADD COLUMN fundamental_inputs` has its inverse `DROP COLUMN
fundamental_inputs` in `.down`. Live apply/rollback is proven in CI/deploy, not here.

---

### Step 4 — service: persist, validate, and seed `fundamental_inputs` in indicators

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/formulas_repository.py` — modify
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify
- `services/xstockstrat-indicators/app/services/parameters.py` — modify
- `services/xstockstrat-indicators/app/formulas/fundamentals_value_quality.py` — modify
- `services/xstockstrat-indicators/app/services/seed_formulas.py` — modify
- `services/xstockstrat-indicators/CLAUDE.md` — modify (new column + validation + seeded metrics)

**Reviewers**: xstockstrat-indicators — formula sandboxing, numeric precision, no side-effects from formula execution

**Codebase Evidence**:
- Repo `create` (`formulas_repository.py:44-76`) and `upsert` (`:78-124`) build an
  `INSERT INTO indicators.formulas (…, parameters, outputs, warmup_period) VALUES (…, $8::jsonb,
  $9::jsonb, $10)`; `update` (`:159-188`) sets `parameters=$6::jsonb, outputs=$7::jsonb`. The
  row-normalizer `_to_dict` parses `outputs` from JSON string (`:30-34`).
- `RegisterFormula` builds the proto with `outputs=list(request.outputs)` and calls
  `self._repo.create(…, outputs=output_dicts, …)` — `servicer.py:242,254,258-270`.
- `UpdateFormula` computes `eff_outputs` (`servicer.py:361-365`) and calls `self._repo.update(…,
  outputs=eff_outputs, …)` (`:389-398`); `_FORMULA_MASKABLE_PATHS = {"name","description","source",
  "is_public","parameters","outputs","warmup_period"}` (`servicer.py:24`).
- `_row_to_formula` maps DB row → proto: `outputs=[ParseDict(o, FormulaOutput()) for o in
  (row.get("outputs") or [])]` — `servicer.py:454`.
- Register/Update validate via `params_validation.validate_outputs(request.outputs)`
  (`servicer.py:234,383`); `validate_outputs` lives at `parameters.py:81` and raises `ValueError`
  (aborted `INVALID_ARGUMENT` by the caller at `servicer.py:238,387`).
- Seeded formula reads `pe_ratio/pb_ratio/dividend_yield/roe/debt_to_equity/eps` via `_get`
  (`fundamentals_value_quality.py:81-84,128-168`) and declares `OUTPUTS = [quality, composite]`
  (`:68-72`); `AUTHOR = SYSTEM_AUTHOR`, `IS_PUBLIC=True` (`:27-28`). Seeded through
  `seed_formulas.py`'s `FormulasRepository(db_pool).upsert(…)` (`:39-48`) — the idempotent seed edit,
  never a raw DB backfill (C-10(c), design.md).
- System-author mutation guard already exists at `servicer.py:315-320,412-417` (fails.md:76 closed).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Repository** (`formulas_repository.py`): add a `fundamental_inputs` JSONB column to `create`,
   `upsert`, and `update` — add the parameter (default `None`), the column to each `INSERT (…)` /
   `UPDATE SET`, and a `$…::jsonb` bind of `json.dumps(list(fundamental_inputs) if fundamental_inputs
   else [])`, mirroring the `outputs` handling exactly. In `_to_dict`, parse `fundamental_inputs` from
   JSON string → list (mirror the `outputs_raw` block at `:30-34`).
2. **Validation** (`parameters.py`): add `validate_fundamental_inputs(fundamental_inputs)` mirroring
   `validate_outputs` — raise `ValueError` naming the offending value when any element is
   `indicators_pb2.FUNDAMENTAL_METRIC_UNSPECIFIED` (the only invalid value for a closed enum —
   `design.md` R3). (No max cap is required beyond the 11-member enum; duplicates are harmless.)
3. **RegisterFormula** (`servicer.py`): after `validate_outputs`, call
   `params_validation.validate_fundamental_inputs(request.fundamental_inputs)` inside the existing
   `try/except ValueError → abort INVALID_ARGUMENT` (`:232-239`); add
   `fundamental_inputs=list(request.fundamental_inputs)` to the `FormulaDefinition(...)` builder
   (`:243-256`) and `fundamental_inputs=[int(m) for m in request.fundamental_inputs]` to the
   `self._repo.create(…)` call (`:258-270`).
4. **UpdateFormula** (`servicer.py`): add `"fundamental_inputs"` to `_FORMULA_MASKABLE_PATHS`
   (`:24`); compute `eff_fundamental_inputs` mirroring `eff_outputs` (`:361-365`, reading
   `row.get("fundamental_inputs") or []` on the unmasked branch); validate it when masked/present
   (mirror `:382-383`); pass `fundamental_inputs=eff_fundamental_inputs` to `self._repo.update(…)`
   (`:389-398`).
5. **GetFormula mapping** (`servicer.py` `_row_to_formula`, `:441-457`): add
   `fundamental_inputs=[int(m) for m in (row.get("fundamental_inputs") or [])]` so `GetFormula`
   returns the field (without this the analysis eval-time routing map is always empty — `design.md`
   R4/R5).
6. **Seeded formula** (`fundamentals_value_quality.py`): declare its 6 inputs as a module constant
   `FUNDAMENTAL_INPUTS = [PE_RATIO, PB_RATIO, DIVIDEND_YIELD, ROE, DEBT_TO_EQUITY, EPS]` (using the
   generated `indicators_pb2.FUNDAMENTAL_METRIC_*` values), matching the metrics `_get` reads.
7. **Seed wiring** (`seed_formulas.py`): pass `fundamental_inputs=fvq.FUNDAMENTAL_INPUTS` to the
   `.upsert(…)` call (`:39-48`) so the seeded `author="system"` formula's inputs are set via the
   idempotent seed, never a raw backfill (C-10(c)).
8. Update `services/xstockstrat-indicators/CLAUDE.md` § Database and § Seeded Formulas: note the
   `fundamental_inputs JSONB` column (migration `006`), that a non-empty value marks a
   fundamentals-only formula, and that `FUNDAMENTAL_METRIC_UNSPECIFIED` is rejected at Register/Update.

**Verification**: see Step 5 (paired test — coverage + lint).

---

### Step 5 — test: indicators persistence + validation round-trip

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/` — modify/create (place beside the existing servicer/repo
  tests; a `MagicMock`/fake-repo servicer test needs no live DB)

**Reviewers**: xstockstrat-indicators — formula sandboxing, numeric precision, no side-effects

**Codebase Evidence**:
- Existing validation tests abort `INVALID_ARGUMENT` via `validate_outputs`/`validate_definitions`
  (`parameters.py:56-99`, invoked at `servicer.py:234,238`).
- Coverage gate + lint: `reference/spec-template.md` coverage table (indicators ≥50%) and
  `reference/step-constraints.md` §B lint table (ruff).

**TDD**: `red-green required`

**Covers**: AC-6

**Instructions**:
1. **RED (AC-6):** a `RegisterFormula` (and an `UpdateFormula`) whose `fundamental_inputs` contains
   `FUNDAMENTAL_METRIC_UNSPECIFIED` is rejected `INVALID_ARGUMENT`, the abort message naming the
   unspecified metric — asserted against the pre-implementation tree (fails: today the field/validator
   do not exist).
2. A `RegisterFormula` declaring only valid `FundamentalMetric` values (e.g. `PE_RATIO`, `ROE`) is
   accepted; a subsequent `GetFormula` returns those `fundamental_inputs` (round-trip through the
   repo `_to_dict` + `_row_to_formula`).
3. `validate_fundamental_inputs` unit test: rejects the zero sentinel, accepts a valid list, accepts
   an empty list.
4. Seed test: the seeded formula's `fundamental_inputs` equals its 6 declared metrics.

**Verification**:
```bash
cd services/xstockstrat-indicators && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=50
```
Coverage ≥ 50%; all new assertions pass; the AC-6 assertion is proven RED before Step 4 and green after.

---

### Step 6 — service: analysis evaluator — fundamentals-only scalar-broadcast branch

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify

**Reviewers**: xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_needs_eval_dates(definition)` returns True only for `source_symbol` or
  `COMPONENT_KIND_FUNDAMENTAL` (`evaluator.py:60-66`) — a fundamentals-*formula* component matches
  neither, so eval_dates would be `None` and the broadcast would emit nothing (`design.md` R4/R5).
- `_fundamental_as_of_series(metric, eval_dates, fundamentals)` (`evaluator.py:69-90`) is the strict
  `filed_date < d` (T+1) carry-forward that both the PIT and the 1-epoch snapshot channels reuse.
- `_compute_component`'s `CUSTOM_FORMULA` branch builds `input_data={"close": closes}`, calls
  `ExecuteFormula`, decodes `MessageToDict(resp.output)` (raising `FormulaExecutionError` on
  `ValueError`/NaN/Inf), enforces `len(raw)==n` per list series, requires a `"value"` series, and
  drops non-list (scalar) outputs at `:380-382` — `evaluator.py:355-397`. `_finite_or_none`
  (`:105-115`) is the element normalizer.
- The fundamentals branch belongs in `_assemble_component_series` (`evaluator.py:426-464`), right
  after the `COMPONENT_KIND_FUNDAMENTAL` block (`:459-464`) — `_compute_component(comp, closes)`
  (`:334`) has neither `eval_dates` nor the filing list, so it cannot do PIT epochs (`design.md` R5).
- `fundamentals: list | None` already threads through `evaluate` (`:192,206`), `evaluate_with_series`
  (`:216,243`), `evaluate_conditions_traced` (`:273,304,316`) → `_assemble_component_series`
  (`:432`); the new `formula_fundamentals` map threads the same way (mirrors feature-152
  `benchmark_bars`).
- `_FUNDAMENTAL_METRICS` snake_case names (`evaluator.py:122-134`) are the `data`-key vocabulary the
  enum lowers to.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add module-level `_FUNDAMENTAL_METRIC_DATA_KEY: dict[int, str]` mapping each generated
   `indicators_pb2.FUNDAMENTAL_METRIC_*` enum int → its snake_case `data`-key (the single
   enum→key lowering site — `design.md` R3; reuse the `_FUNDAMENTAL_METRICS` names, do not re-type
   them).
2. Extend the signature to `_needs_eval_dates(definition, formula_fund_map=None)` and return True
   also when any `COMPONENT_KIND_CUSTOM_FORMULA` component's `formula_id` is a key in a non-empty
   `formula_fund_map`. Update its two call sites inside the evaluator (`:238,297`) to pass the map
   (threaded in step 5 below).
3. Factor a shared helper `_decode_formula_output(formula_id, resp, expected_n=None)` out of the
   `_compute_component` list path (`:369-396`): it raises `FormulaExecutionError` on `not
   resp.success` and on the `MessageToDict` `ValueError` (NaN/Inf), and returns the decoded dict.
   The indicator-only list path keeps its `len(raw)==n` + `"value"`-required policy; the new scalar
   path reuses the same decode + `_finite_or_none` normalization and raises on a non-finite scalar
   (`design.md` R4/R5; fails.md:87 — `MessageToDict` rejects NaN/Inf, so a non-finite scalar surfaces
   as `FormulaExecutionError`, never a fabricated value).
4. Add the fundamentals-only branch in `_assemble_component_series` immediately after the
   `COMPONENT_KIND_FUNDAMENTAL` block (`:459-464`), gated on `comp.kind ==
   COMPONENT_KIND_CUSTOM_FORMULA and comp.formula_id in (formula_fundamentals or {})`:
   - Build the per-metric as-of scalar series with `_fundamental_as_of_series(data_key, eval_dates,
     fundamentals)` for each declared metric-data-key of this formula.
   - Detect **filing-boundary epochs**: a contiguous span where the tuple of per-metric as-of values
     is constant (derived from the as-of series, not raw filing rows — `design.md` R3 pin 1).
   - Per epoch: if the epoch's metric tuple is all-`None` (pre-first-filing / whole-row missing),
     **skip `ExecuteFormula` and emit `None`** across the span (never call the formula with an
     all-`None` dict — `design.md` R3 pin 2 / FR-6 / AC-5). Otherwise build `input_data` that
     **omits** the `None` (absent/`missing_metrics`) keys and includes only present ones
     (omit-absent, `design.md` R4/R5 option b — AC-8), call `ExecuteFormula` **once**, decode via
     `_decode_formula_output`, and broadcast each finite scalar output across the epoch span.
   - Return a series dict keyed by every scalar output name (so `fscore` = primary `value`,
     `fscore.quality`, `fscore.composite` are all addressable via the value-primary convention at
     `:245,306,323`). A `None`-valued/absent metric span or a genuine formula crash degrades to
     `None`/raises exactly as FR-6 requires.
5. Thread a new `formula_fundamentals: dict | None = None` parameter through `evaluate`,
   `evaluate_with_series`, `evaluate_conditions_traced`, and `_assemble_component_series` (default
   `None` so every existing caller is unchanged), passing it into `_needs_eval_dates` and the
   per-component assembly calls, exactly mirroring how `fundamentals`/`benchmark_bars` thread today.
6. Indicator-only formulas stay byte-identical through `_compute_component` (AC-7) — the new branch
   only fires when the formula id is in `formula_fundamentals`.

**Verification**: see Step 7 (paired test — coverage + lint).

---

### Step 7 — test: analysis evaluator — broadcast, PIT epochs, degradation, byte-identity

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (or a sibling evaluator
  test module beside it)

**Reviewers**: xstockstrat-analysis — backtest reproducibility, no look-ahead bias

**Codebase Evidence**:
- Real `Bar` fixtures: `_bar(sec, close, …)` sets `b.time.seconds = sec` (`test_analysis_servicer.py:1385-1394`) — use these, never `MagicMock`/`bar.timestamp` (fails.md:727).
- Coverage/lint gates: `reference/spec-template.md` (analysis ≥40%) + `reference/step-constraints.md` §B (ruff).

**TDD**: `red-green required`

**Covers**: AC-1, AC-2, AC-5, AC-7, AC-8

**Instructions**:
1. **RED AC-1:** given a formula id in the `formula_fundamentals` map whose `ExecuteFormula` returns
   scalar `{value, quality, composite}` with `composite=0.72`, assert `evaluate_with_series` yields a
   `fscore.composite` series carrying `0.72` broadcast across the bars and that an entry rule
   `{"fn":">","lhs":"fscore.composite","rhs":0.6}` fires. Assert bare `fscore` resolves to the
   `value` sub-score (value-primary convention).
2. **RED AC-2 (no look-ahead, mid-window transition):** two `FundamentalPeriod`s (`eps 1.0` filed
   2019-10-30, `eps 3.0` filed 2020-01-29) over bars 2020-01-27…31; assert the formula is fed
   `eps 1.0` on bars ≤ 2020-01-29 and `eps 3.0` only on bars ≥ 2020-01-30, and that `ExecuteFormula`
   is called **once per epoch** (O(filings), not O(bars)). Assert the **mid-window** boundary
   transition, not merely ragged edges (fails.md:1853).
3. **RED AC-5:** over `{AAPL, INTC}`, INTC has no fundamentals for the span and its formula raises —
   assert INTC's `fscore` series is `None` (hold) with no `0.0` fabricated, AAPL scores normally, and
   the evaluation does not abort.
4. **AC-7:** an ordinary technical `CUSTOM_FORMULA` component (formula id NOT in
   `formula_fundamentals`) receives only `{"close": closes}` and its series is byte-identical to the
   pre-change path (no `input_data` fundamentals added).
5. **RED AC-8:** a symbol whose row is missing `pe_ratio` (in `missing_metrics`) but has the other
   declared metrics — assert the built `input_data` **omits** `pe_ratio` entirely (not `0.0`) and the
   formula averages only present sub-parts.
6. Stub `cfg.get_bool` in the servicer factory where a gate read is exercised (see Step 9) — the
   pure-evaluator tests here do not read config, but any test constructing a servicer must add the
   `get_bool` stub (fails.md:1395; `make_servicer` today stubs only
   `get_float/get_str/get_int/get_int_present/get_float_present`, `test_analysis_servicer.py:39-49`).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
```
Coverage ≥ 40%; AC-1/AC-2/AC-5/AC-8 assertions RED before Step 6, green after; AC-7 stays green throughout.

---

### Step 8 — service: analysis servicer — routing map, snapshot loader, gate, write-time guard

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify (fundamentals-formula operand + snapshot loader + two-site gate)

**Reviewers**: xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_load_fundamentals(symbol, definition, propagation_meta, *, sem=None, cache=None)` is the PIT
  loader: short-circuits `None` if `not _definition_has_fundamental(definition)` (`servicer.py:1470`),
  reads the gate `self._cfg.get_bool("analysis.backtest.fundamentals.enabled", False)` (`:1472`),
  fetches `GetHistoricalFundamentals` (`:1476-1487`), maps via
  `_fundamental_periods_from_response` (`servicer.py:5054-5072`). `_definition_has_fundamental`
  matches only `COMPONENT_KIND_FUNDAMENTAL` (`:5048-5051`).
- The 6 evaluate surfaces + their `_load_fundamentals` calls: backtest `_backtest_symbol_evaluated`
  `:1595` → `evaluate_with_series(definition, bars, None, benchmark_bars, fundamentals)` `:1598-1600`;
  EvaluateReadiness `:2922`; readiness materializer `:3174` and `:4376`/`:4654`; GetIndicatorSeries
  `:3400` (its OWN handler loop, not the shared `evaluate_conditions_traced` — see the `:3351-3354`
  comment); ListOpportunities `:3833` and `:3909`.
- The warmup prefetch (`GetFormula` per formula component) exists only at backtest
  (`_declared_formula_warmup`, `servicer.py:1950`) and live (`evaluator.declared_formula_warmups`,
  `evaluator.py:399-424`); the other 4 surfaces build no warmup cache (`design.md` R4/R5). The warmup
  cache value must stay `int` — `warmup.py:143` does `int(cache.get(comp.formula_id, 0) or 0)`.
- Write-time validation seam: `_validate_definition_proto` (`servicer.py:601`) calls
  `_refuse_deleted_bindings` (`:609`) and `_fetch_formula_outputs` (`:611`); `_fetch_formula_outputs`
  (`:537-560`) already loops formula components issuing one `GetFormula` each.
- Live loop `_load_fundamentals(definition, symbol)` (`live_loop.py:585-606`) reads the same gate
  (`:597`) and calls `GetHistoricalFundamentals` (`:600`); it imports `_definition_has_fundamental`
  (`:39`) and calls `self._evaluator.evaluate(…, fundamentals)` (`:628-629`). It already has a
  `GetFundamentalsMulti` chunk fetch helper (`:171-172`, `_MULTI_CHUNK` at `:53`).
- Snapshot source: marketdata `GetFundamentalsMulti` (`packages/proto/marketdata/v1/marketdata.proto:44`,
  handler `internal/service/marketdata_service.go:1284`); `Fundamentals` fields + `missing_metrics`
  (`marketdata.proto:208-228`; null-not-zero at `:200-208`).
- Header propagation: every `_load_fundamentals`/`evaluate*` call already forwards `propagation_meta`
  (the `x-user-id`/`x-access-scope`/`x-trace-id` trio filtered at `servicer.py:603-606`); the new
  `GetFundamentalsMulti` call reuses the same `metadata=propagation_meta` pattern (C-03; Python
  per-method metadata per `docs/patterns/header-propagation.md`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Routing predicate:** add module-level `_definition_wants_fundamentals_formula(definition,
   formula_fund_map)` → True when any `COMPONENT_KIND_CUSTOM_FORMULA` component's `formula_id` maps to
   a non-empty declared-input list in `formula_fund_map` (`design.md` Routing predicate).
2. **Eval-time routing map builder:** add a shared `_formula_fundamentals(definition, propagation_meta,
   *, cache=None)` that issues one memoized `GetFormula` per distinct formula id (dedup via `cache`
   across a pass, mirroring `_load_fundamentals`'s `cache` arg) and returns `{formula_id:
   [FundamentalMetric ints]}` for components whose formula declares a non-empty `fundamental_inputs`.
   At **backtest + live**, fold the `fundamental_inputs` read into the existing warmup prefetch
   `GetFormula` (`_declared_formula_warmup` `:1950` / `declared_formula_warmups`
   `evaluator.py:399-424`) — populate a **separate parallel** `fund_map`, and when a formula's
   `fundamental_inputs` is non-empty **cache its warmup as `0`** (a fundamentals-only formula consumes
   no `close`; keep the warmup cache value an `int` — `design.md` § Warmup, `warmup.py:143`). At the
   other **4** surfaces (readiness/opportunities/GetIndicatorSeries/materializer), call
   `_formula_fundamentals` directly (recorded honestly as a new bounded per-pass `GetFormula` fan-out
   — `design.md` Open Risks).
3. **Snapshot loader:** add `_load_fundamentals_snapshot(definition, symbol, propagation_meta,
   formula_fund_map, *, sem=None, cache=None)` mirroring `_load_fundamentals`'s shape: short-circuit
   `None` if `not _definition_wants_fundamentals_formula(...)`; read the **same** gate
   `self._cfg.get_bool("analysis.backtest.fundamentals.enabled", False)`; call
   `GetFundamentalsMulti([symbol])` (`metadata=propagation_meta`); lower the returned row (honoring
   `missing_metrics` = `None`) into a **one-element** `list[FundamentalPeriod]` with `filed_date =
   date.min` (strictly before every bar) so the same `_fundamental_as_of_series` broadcasts it as one
   degenerate epoch (`design.md` § Snapshot — one code shape). Carry `sem`+`cache` so the per-symbol
   fan-out stays bounded and dedups within a pass (`@AC-5` feature-176 PRESERVE).
4. **Wire all 6 surfaces (C-10):** at each site, build the `formula_fund_map` (per step 2) and pass
   it as `formula_fundamentals=` to the evaluator call; feed the fundamentals-formula channel with
   `_load_fundamentals` on **backtest** (`:1595`, existing PIT list) and with
   `_load_fundamentals_snapshot` on the **5 non-backtest** surfaces (EvaluateReadiness `:2922`,
   materializer `:3174`/`:4376`/`:4654`, ListOpportunities `:3833`/`:3909`, and — in its own handler
   loop — GetIndicatorSeries `:3400`+`:3351-…`), keeping the existing `fundamentals`/`_load_fundamentals`
   (feature-198 single-metric operand) call **separate and unchanged** (see § Step Dependencies
   residual; C-16 PRESERVE `@AC-3`/`@AC-4` `@feature-198`). Live loop (`live_loop.py:628`): build the
   map from its warmup prefetch, feed the snapshot channel via a `GetFundamentalsMulti([symbol])`
   loader (reusing the existing chunk-fetch pattern `:171`), and pass `formula_fundamentals` into
   `evaluate(...)`. Guard: a site that computes `eval_dates` (via the extended `_needs_eval_dates`)
   without the map returns `False` → silent hold, so the map must be built **before** the loader/eval
   at every site.
5. **Write-time guard:** in `_validate_definition_proto` (or the `_fetch_formula_outputs` seam it
   already calls at `:611`), reject `INVALID_ARGUMENT` a `CUSTOM_FORMULA` component that has a
   non-empty `source_symbol` **and** whose formula declares `fundamental_inputs` (a component is a
   benchmark operand XOR a fundamentals-formula operand — `design.md` § Write-time validation).
6. Update `services/xstockstrat-analysis/CLAUDE.md`: document the fundamentals-formula operand
   (PIT-as-of on backtest, snapshot on live/screener/readiness/opportunities/GetIndicatorSeries), the
   new `_load_fundamentals_snapshot`, and that `analysis.backtest.fundamentals.enabled` is now read at
   **two** sites (PIT loader + snapshot loader) — one key, two enforcement sites (`design.md` § Gate).

**Trading-domain note (`reference/step-constraints.md` §A):** this step touches no `TRADING_MODE`,
`BrokerType`, `OrderType`, `OrderStatus`, or order-placement path — trading-domain constraints do not
apply.

**Header-propagation note (§B):** the one new outbound call (`GetFundamentalsMulti` in the snapshot
loader) reuses the existing `metadata=propagation_meta` trio already forwarded by every sibling
marketdata call in this servicer (C-03).

**Verification**: see Step 9 (paired test — coverage + lint).

---

### Step 9 — test: analysis servicer — snapshot path, producer parity, gate

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: xstockstrat-analysis — backtest reproducibility, no look-ahead bias

**Codebase Evidence**:
- `make_servicer()` stubs `get_float/get_str/get_int/get_int_present/get_float_present` but **not**
  `get_bool` (`test_analysis_servicer.py:39-49`) — a gate-reading test must add `cfg.get_bool =
  MagicMock(side_effect=lambda key, default=False: <value>)` (fails.md:1395).
- Producer full-row `input_data` builder: `_score_via_formula` passes `{pe_ratio, pb_ratio,
  dividend_yield, roe, debt_to_equity, eps}` from proto (proto-zero for absent) into
  `score_fundamentals` (`app/engine/fundsignal_loop.py:399-411`); `score_fundamentals` reads
  `output.composite` (`app/services/fundamentals_scoring.py:60-72`). AC-4 asserts the strategy path
  passes the **same keys** and reads the **same composite** on a fully-populated row.

**TDD**: `red-green required`

**Covers**: AC-3, AC-4

**Instructions**:
1. **RED AC-3 (snapshot, no PIT on live):** with the gate ON (stub `get_bool` → True), a live/snapshot
   evaluation of a fundamentals-formula component feeds the formula AAPL's current-snapshot
   fundamentals from `GetFundamentalsMulti` and performs **no** `GetHistoricalFundamentals` call on
   that path (assert the marketdata mock's `GetHistoricalFundamentals` was not called).
2. **RED AC-4 (full-row parity):** for a symbol with ALL declared metrics present (no
   `missing_metrics`), assert the strategy-component path builds the same `input_data` keys and reads
   the same `composite` output field that `score_fundamentals`/the producer uses for the same as-of
   fundamentals row.
3. Assert the gate default (OFF) makes `_load_fundamentals_snapshot` return `None` (operand holds) —
   the second enforcement site.
4. Every test that constructs the servicer and exercises a gate read adds the `get_bool` stub.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
```
Coverage ≥ 40%; AC-3/AC-4 assertions RED before Step 8, green after.

---

### Step 10 — service: UI read-only fundamentals badge in ComponentEditor

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/ComponentEditor.tsx` — modify

**Reviewers**: xstockstrat-ui — analytics display accuracy, Connect-RPC call safety, no secret values rendered

**Codebase Evidence**:
- The custom-formula branch (`value.kind === ComponentKind.CUSTOM_FORMULA`) renders the formula
  `Combobox` and per-component params; `selectedFormula = formulas.find((f) => f.formulaId ===
  value.formulaId)` — `ComponentEditor.tsx:66,150-176`. `useFormulas({ includePublic: true })` returns
  the typed `FormulaDefinition[]` (`:62-63`), which now carries `fundamentalInputs` after Step 2.
- The existing FUNDAMENTAL-kind branch already shows a static hint paragraph (`text-[10px]
  text-muted-foreground`) — mirror that markup for the badge (`ComponentEditor.tsx:120-146`).
- C-17 tokens/primitives: use `text-muted-foreground` (a design-role token), reuse the existing hint
  markup pattern — no hardcoded color, no new primitive.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In the `CUSTOM_FORMULA` branch, when `selectedFormula?.fundamentalInputs?.length` is non-empty,
   render a read-only hint below the picker: "Fundamentals input — requires the fundamentals gate ON;
   use `.composite` for the headline" (`design.md` C-14). Read-only, no new route/write, matching the
   existing FUNDAMENTAL-kind hint's markup + tokens (`:143-146`).
2. Give the hint element a stable text so the Playwright assertion can target it; no interactive
   control is added (no new accessible-name obligation beyond existing controls).

**Verification**: see Step 11 (paired test — lint + e2e).

---

### Step 11 — test: UI badge + fundamentals formula fixture (C-12)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/formulas.ts` — modify (add a fundamentals-declaring fixture)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog row)
- `services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts` — modify

**Reviewers**: xstockstrat-ui — analytics display accuracy

**Codebase Evidence**:
- Canonical formula fixtures live in `e2e/fixtures/formulas.ts` (`FORMULA_RSI`, `FORMULA_MACD`,
  `FORMULA_DELETED`), shape sourced from `xstockstrat.indicators.v1.FormulaDefinition`, catalogued in
  `e2e/fixtures/INVENTORY.md:23-24`, consumed by `e2e/insights/strategy-authoring.spec.ts` (C-12).
- Connect-JSON camelCase in TS → the new fixture field is `fundamentalInputs` (proto
  `fundamental_inputs`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a `FORMULA_FUNDAMENTALS` fixture (full-row subset with `fundamentalInputs: [...]` set) to
   `formulas.ts` and add it to `FORMULAS`; add a matching `INVENTORY.md` row (C-12 — a new domain
   object gets a fixture + catalog row in the same step, never an inline literal).
2. In `strategy-authoring.spec.ts`, select the fundamentals formula in `ComponentEditor` and assert
   the read-only badge text is visible; assert an ordinary (RSI/MACD) formula shows no badge.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -- strategy-authoring
```
The badge assertion is RED before Step 10 and green after; the no-badge case stays green. Confirm the
spec imports the fixture (`from '../fixtures'`/`from './fixtures'`) and `INVENTORY.md` is updated.

---

### Step 12 — docs: strat-lab backtest skill, config-governance, teardown

**Status**: `done`
**Service**: `docs/` + `plugins/strat-lab/`
**Files**:
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify
- `docs/patterns/config-governance.md` — modify (Per-Feature Registered Keys log — note the 2nd read site, no new key)

**Reviewers**: none

**Codebase Evidence**:
- The strat-lab backtest skill documents the feature-198 single-metric `kind:"fundamental"` operand
  and the `analysis.backtest.fundamentals.enabled` prerequisite (`plugins/strat-lab/skills/backtest/SKILL.md:91-101`).
  Root `CLAUDE.md` mandates that a change to `manage_strategy`/`run_backtest` behavior updates this
  skill in the **same** PR — feature 200 makes a `CUSTOM_FORMULA` component fundamentals-capable, a
  new `manage_strategy`/`run_backtest` capability.
- No new config key: the PIT + snapshot paths reuse `analysis.backtest.fundamentals.enabled`
  (`design.md` § Gate); the change is a second read site, not a new key.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Add a section to the strat-lab backtest `SKILL.md` (beside the feature-198 fundamental-operand
   note): a `CUSTOM_FORMULA` component whose formula declares `fundamental_inputs` is a
   fundamentals-scoring operand — fed PIT-as-of fundamentals in a backtest and the current snapshot on
   live; requires `analysis.backtest.fundamentals.enabled` ON; gate a rule on the dotted
   `<ref>.composite` (bare `<ref>` = the `value` sub-score); a whole-row-missing symbol holds.
2. In `docs/patterns/config-governance.md` Per-Feature Registered Keys log, add a feature-200 row
   noting **no new key** — `analysis.backtest.fundamentals.enabled` gains a second read site (the
   analysis snapshot loader).
3. **Teardown (root `CLAUDE.md` § Teardown):** because this feature changes behavior described in
   context files and touches `CLAUDE.md`s (indicators, analysis) + the strat-lab skill, run
   `/context-forge:context-constitution refresh` scoped to `xstockstrat-indicators`,
   `xstockstrat-analysis`, and the strat-lab plugin as the last step before pushing, and fix any
   grounded drift it reports. If the plugin is unavailable, perform the manual equivalent and record
   both facts in the PR body.

**Verification**:
```bash
grep -n "fundamental_inputs\|fundamentals-scoring\|\.composite" plugins/strat-lab/skills/backtest/SKILL.md
```
Confirm the strat-lab skill documents the new fundamentals-formula operand; confirm the
config-governance log has the feature-200 no-new-key row.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
