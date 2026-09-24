# Implementation Spec: formula-fundamental-inputs-authoring

**Status**: `pending`
**Created**: 2026-09-24
**Feature**: `docs/roadmap/features/205-formula-fundamental-inputs-authoring/feature.md`
**Total Steps**: 14
**Feature Branch**: `feature/formula-fundamental-inputs-authoring`

---

## Execution Summary

The implementation follows the design's six advisory step boundaries, decomposed into 14 concrete
steps (service + paired test). Steps 1-2 add the proto `ListFundamentalMetrics` RPC + messages and
regenerate stubs (unblocks all downstream). Steps 3-4 add the indicators handler + its tests
(G1/G2). Steps 5-6 thread `fundamental_inputs` through the agent `manage_formula` declare/view path
+ the G5 descriptor-parity test. Steps 7-8 add the agent catalog tool + `test_formula` docstring +
docs (G4/G5). Steps 9-10 wire the UI declare/view path (metric picker, BFF registration,
useFormulas, FormulaWorkspace). Steps 11-12 add the UI test harness (fundamentals value grid,
symbol-prefill, G3). Steps 13-14 land the cross-cutting tests: analysis G6 third-leg parity test,
UI Playwright + vitest using existing fixtures, and INVENTORY.md + acceptance.feature traceability.

Consumer-surface coverage (C-14): both named surfaces are covered -- Agent (Steps 5-8) and
`/insights` UI (Steps 9-12, 14).

## Scenario Coverage

- AC-1 --> Step 6 (agent declare round-trip test)
- AC-2 --> Step 14 (UI Playwright formula save test)
- AC-3 --> Steps 6, 14 (agent get_formula returns camelCase fundamentalInputs; UI reads them back)
- AC-4 --> Steps 4, 8, 14 (handler returns all 11 metrics; agent catalog test; UI picker 11 options)
- AC-5 --> Steps 8, 14 (agent test_formula snake_case input_data docstring; UI fundamentals run)
- AC-6 --> Step 14 (UI test harness symbol-prefill + null-not-NaN)
- AC-7 --> Step 13 (analysis G6 parity: mechanical data_key = evaluator map for all 11 metrics)

## Step Dependencies

- Steps 3-14 require Step 2: proto stubs must be generated before any consumer code compiles.
- Step 3 requires Step 1: handler implements the new RPC defined in the proto.
- Steps 3-4 are sequential: test (Step 4) covers service (Step 3).
- Steps 5-6 are sequential: test (Step 6) covers service (Step 5).
- Steps 7-8 are sequential: test/docs (Step 8) covers service (Step 7).
- Steps 9-10 are sequential: test (Step 10) covers service (Step 9).
- Steps 11-12 are sequential: test (Step 12) covers service (Step 11).
- Steps 13-14 require Steps 3-12: integration/acceptance tests span all prior service changes.

---

### Step 1 -- proto: Add ListFundamentalMetrics RPC and messages

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/indicators/v1/indicators.proto` -- modify

**Reviewers**: Proto Reviewer -- additive RPC, enum correctness; xstockstrat-indicators owner -- enum owner service

**Codebase Evidence**:
- Confirmed via: `indicators.proto:14-41` -- IndicatorsService block ends with `DeleteFormula` at line 40
- Confirmed via: `indicators.proto:136-149` -- FundamentalMetric enum (12 values incl. UNSPECIFIED)
- Confirmed via: `indicators.proto:244-246` -- DeleteFormulaResponse is the last message before EOF

**TDD**: `N/A (proto -- non-code-bearing)`

**Covers**: --

**Instructions**:
1. In `packages/proto/indicators/v1/indicators.proto`, after line 40 (`rpc DeleteFormula ...`), add:
   ```
   rpc ListFundamentalMetrics(ListFundamentalMetricsRequest) returns (ListFundamentalMetricsResponse);
   ```
2. After the last message (`DeleteFormulaResponse`, line 246), append:
   ```
   message ListFundamentalMetricsRequest {}

   message FundamentalMetricInfo {
     FundamentalMetric metric = 1;
     string data_key = 2;
     string meaning = 3;
   }

   message ListFundamentalMetricsResponse {
     repeated FundamentalMetricInfo metrics = 1;
   }
   ```
3. Run `buf lint` and `buf breaking` from `packages/proto/`.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against '../../.git#branch=main-dev'
```

---

### Step 2 -- proto-gen: Regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/indicators/v1/*.go` -- auto-generated
- `packages/proto/gen/python/indicators/v1/*_pb2*.py` -- auto-generated
- `packages/proto/gen/ts/src/indicators/v1/*.ts` -- auto-generated
- `packages/proto/gen/ts/dist/**` -- auto-generated

**Reviewers**: Proto Reviewer -- additive RPC, enum correctness (inherited from Step 1)

**TDD**: `N/A (proto-gen -- non-code-bearing)`

**Covers**: --

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root.
2. Verify the generated stubs include `ListFundamentalMetrics`, `FundamentalMetricInfo`,
   `ListFundamentalMetricsRequest`, `ListFundamentalMetricsResponse`.

**Verification**:
```bash
./scripts/buf-gen.sh && grep -l 'ListFundamentalMetrics' packages/proto/gen/python/indicators/v1/indicators_pb2_grpc.py packages/proto/gen/ts/src/indicators/v1/indicators_pb.ts
```

---

### Step 3 -- service: Indicators ListFundamentalMetrics handler

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/handlers/servicer.py` -- modify

**Reviewers**: xstockstrat-indicators owner -- formula engine, sandbox timeout, numeric precision

**Codebase Evidence**:
- Confirmed via: `servicer.py:37` -- `class IndicatorsServicer(indicators_pb2_grpc.IndicatorsServiceServicer)`
- Confirmed via: `indicators_pb2` already imported in the servicer (used for `FormulaDefinition`, `FundamentalMetric` etc.)
- Pattern to REUSE: design specifies iterating the enum descriptor, skipping `FUNDAMENTAL_METRIC_UNSPECIFIED`, with a hand-authored 11-entry `{enum_value: meaning}` dict and mechanical `data_key = name.removeprefix("FUNDAMENTAL_METRIC_").lower()`
- Header propagation (C-03): this handler makes no outbound gRPC calls -- it reads the local enum descriptor only, so no header forwarding is needed.

**TDD**: `red-green required`

**Covers**: --

**Instructions**:
1. Add an 11-entry `_FUNDAMENTAL_METRIC_MEANING` dict mapping each `FundamentalMetric` enum value
   (int) to its human-readable meaning string. Use the enum constants from `indicators_pb2` (e.g.,
   `indicators_pb2.FUNDAMENTAL_METRIC_PE_RATIO: "P/E ratio"`). The 11 meanings: Market cap, P/E
   ratio, P/B ratio, Dividend yield, EPS, Beta, ROE, Debt/equity, Price, 52-week high, 52-week low.
2. Add `async def ListFundamentalMetrics(self, request, context)` to `IndicatorsServicer`. The
   handler:
   - Iterates `indicators_pb2.FundamentalMetric.DESCRIPTOR.values` (the enum descriptor).
   - Skips `FUNDAMENTAL_METRIC_UNSPECIFIED` (number == 0).
   - For each value, derives `data_key = value.name.removeprefix("FUNDAMENTAL_METRIC_").lower()`.
   - Looks up the meaning from `_FUNDAMENTAL_METRIC_MEANING[value.number]` -- if missing, raises
     `grpc.StatusCode.INTERNAL` (G2 fail-loud, never silently returns empty meaning).
   - Builds a `FundamentalMetricInfo(metric=value.number, data_key=data_key, meaning=meaning)`.
   - Returns `ListFundamentalMetricsResponse(metrics=[...])`.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run pytest tests/ -k "list_fundamental_metrics" -v
```

---

### Step 4 -- test: Indicators handler tests (G1, G2)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_fundamental_metrics.py` -- create

**Reviewers**: xstockstrat-indicators owner -- formula engine, numeric precision

**Codebase Evidence**:
- G2 pattern: design says "every non-UNSPECIFIED enum -> non-empty meaning AND data_key; handler raises, never empty"
- G1 pattern: design says "imports `gen.marketdata.v1.marketdata_pb2`; every derived data_key is a real `marketdata.Fundamentals` field"
- Confirmed via: `evaluator.py:144-155` -- analysis `_FUNDAMENTAL_METRIC_DATA_KEY` maps all 11 metrics to snake_case keys matching `marketdata.Fundamentals` fields
- C-13 (non-frontend test data): no mocked domain data -- tests use the actual proto enum descriptor and the live meaning dict. No second consumer.

**TDD**: `red-green required`

**Covers**: AC-4 (partial -- handler returns all 11 metrics)

**Instructions**:
1. Create `tests/test_fundamental_metrics.py` with:
   - **G2 test**: call the handler method (or construct the response inline from the dict), assert
     the response has exactly 11 `FundamentalMetricInfo` entries (all non-UNSPECIFIED enum values),
     each with a non-empty `data_key` and non-empty `meaning`.
   - **G1 cross-service contract test**: import `gen.marketdata.v1.marketdata_pb2` (the Fundamentals
     message descriptor). For each `FundamentalMetricInfo` in the response, assert `info.data_key`
     is a real field name on `marketdata_pb2.Fundamentals.DESCRIPTOR.fields_by_name`. This pins the
     two-vocabulary contract.
   - **Completeness guard**: assert the set of enum numbers in the response equals
     `{v.number for v in indicators_pb2.FundamentalMetric.DESCRIPTOR.values if v.number != 0}`.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run ruff check app/ tests/ && uv run ruff format --check app/ tests/ && uv run pytest --cov=app --cov-fail-under=50
```

---

### Step 5 -- service: Agent manage_formula declare/view (fundamental_inputs)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` -- modify
- `services/xstockstrat-agent/app/client.py` -- modify

**Reviewers**: xstockstrat-agent owner -- MCP tool contract stability, docs parity, tool count sync

**Codebase Evidence**:
- Confirmed via: `tools.py:842-853` -- `manage_formula` params missing `fundamental_inputs`
- Confirmed via: `tools.py:905-916` -- formula dict build missing `fundamental_inputs`
- Confirmed via: `tools.py:920-932` -- update mask derivation missing `fundamental_inputs`
- Confirmed via: `client.py:1042-1054` -- register builder missing `fundamental_inputs`
- Confirmed via: `client.py:1059-1077` -- update builder missing `fundamental_inputs`
- Pattern to REUSE: `_build_formula_parameter` at `client.py:124-153` (dict->proto conversion pattern)
- Pattern to REUSE: `FundamentalMetric.Value(name)` try/except -- the design's NAME-string->enum mapper
- Header propagation (C-03): no new outbound gRPC call -- `manage_formula` already calls the
  indicators service via existing `register_formula`/`update_formula` client functions which already
  propagate metadata via `_metadata()`. The new field is threaded into the existing request, not a
  new call.

**TDD**: `red-green required`

**Covers**: --

**Instructions**:
1. In `tools.py`, add `fundamental_inputs: list[str] | None = None` parameter to `manage_formula`
   (after `warmup_period`).
2. Update the docstring to document `fundamental_inputs`: a list of `FundamentalMetric` enum
   NAME-strings (e.g., `["FUNDAMENTAL_METRIC_PE_RATIO", "FUNDAMENTAL_METRIC_PB_RATIO"]`). Non-empty
   = a fundamentals-only formula. Reference `list_fundamental_metrics` for the valid catalog.
3. Thread `fundamental_inputs` into the `formula` dict at line ~915:
   `"fundamental_inputs": fundamental_inputs or []`.
4. Add `"fundamental_inputs": fundamental_inputs` to the `supplied` dict for update mask derivation
   (~line 921-928).
5. In `client.py`, add a `_build_fundamental_inputs` helper (or inline) that converts a list of
   NAME-strings to `FundamentalMetric` enum values: for each name, call
   `indicators_pb2.FundamentalMetric.Value(name)` inside a try/except `ValueError` -> raise
   `grpc.StatusCode.INVALID_ARGUMENT` with a message naming the bad metric and listing valid names.
6. In the register builder (~line 1042-1054), add
   `fundamental_inputs=_build_fundamental_inputs(formula.get("fundamental_inputs", []))` to the
   `RegisterFormulaRequest`.
7. In the update builder (~line 1059-1073), add the same
   `fundamental_inputs=_build_fundamental_inputs(formula.get("fundamental_inputs", []))` to the
   `UpdateFormulaRequest`.
8. `get_formula`/`list_formulas` already use `MessageToDict` -- `fundamentalInputs` (camelCase)
   surfaces automatically as NAME-strings (Connect-JSON enum encoding). No change needed.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_formula_builders.py -v
```

---

### Step 6 -- test: Agent descriptor-parity test update (G5)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_formula_builders.py` -- modify

**Reviewers**: xstockstrat-agent owner -- MCP tool contract stability

**Codebase Evidence**:
- Confirmed via: `test_formula_builders.py:26` -- `_REGISTER_INTENTIONALLY_UNSET = {"input_schema", "fundamental_inputs"}`
- Confirmed via: `test_formula_builders.py:31` -- `_UPDATE_INTENTIONALLY_UNSET: set[str] = {"user_id", "fundamental_inputs"}`
- These sets must be updated to REMOVE `fundamental_inputs` since the builder now sets it.
- C-13 (non-frontend test data): the formula dict literal
  `{"fundamental_inputs": ["FUNDAMENTAL_METRIC_PE_RATIO"]}` in the capture helpers is a single
  consumer (only in `test_formula_builders.py`). Inline is compliant.

**TDD**: `red-green required`

**Covers**: AC-1, AC-3

**Instructions**:
1. Remove `"fundamental_inputs"` from `_REGISTER_INTENTIONALLY_UNSET` (line 26). The set becomes
   `{"input_schema"}`.
2. Remove `"fundamental_inputs"` from `_UPDATE_INTENTIONALLY_UNSET` (line 31). The set becomes
   `{"user_id"}`.
3. Update the `_capture_register_request` helper (~line 51-63) to include
   `"fundamental_inputs": ["FUNDAMENTAL_METRIC_PE_RATIO"]` in the formula dict so the builder
   exercises the new field.
4. Update the `_capture_update_request` helper (~line 79-93) similarly.
5. Add a behavioral test: `test_register_sends_fundamental_inputs` -- assert
   `list(req.fundamental_inputs) == [indicators_pb2.FUNDAMENTAL_METRIC_PE_RATIO]`.
6. Add a round-trip test: `test_get_formula_returns_fundamental_inputs` -- mock `GetFormula`
   returning a `FormulaDefinition` with
   `fundamental_inputs=[FUNDAMENTAL_METRIC_PE_RATIO, FUNDAMENTAL_METRIC_PB_RATIO]`, call
   `client.get_formula`, assert the result contains `fundamentalInputs` key with
   `["FUNDAMENTAL_METRIC_PE_RATIO", "FUNDAMENTAL_METRIC_PB_RATIO"]` (MessageToDict NAME-strings,
   camelCase key).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run ruff check app/ tests/ && uv run ruff format --check app/ tests/ && uv run pytest --cov=app --cov-fail-under=40
```

---

### Step 7 -- service: Agent list_fundamental_metrics tool + test_formula docstring

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` -- modify
- `services/xstockstrat-agent/app/client.py` -- modify
- `services/xstockstrat-agent/CLAUDE.md` -- modify

**Reviewers**: xstockstrat-agent owner -- MCP tool contract stability, docs parity, tool count sync

**Codebase Evidence**:
- Confirmed via: agent CLAUDE.md -- 49 tools currently; adding `list_fundamental_metrics` makes 50
- Confirmed via: `client.py:19-26` -- endpoint consts include `INDICATORS_ENDPOINT`
- Confirmed via: `tools.py:1200-1227` -- `test_formula` params; `input_data` already supports arbitrary dict; docstring needs fundamentals use-case guidance
- Pattern to REUSE: `execute_formula` at `client.py:960-991` handles `input_data` via `ParseDict(input_data, Struct())`
- Header propagation (C-03): new `list_fundamental_metrics` client function opens a channel to
  `INDICATORS_ENDPOINT` and calls the stub. Must propagate metadata via `_metadata()` -- the
  existing per-call mechanism confirmed at `client.py:1046,1066` (register/update builders use
  `metadata=_metadata()`).

**TDD**: `red-green required`

**Covers**: --

**Instructions**:
1. In `client.py`, add a `list_fundamental_metrics` function that opens a channel to
   `INDICATORS_ENDPOINT`, calls `stub.ListFundamentalMetrics(ListFundamentalMetricsRequest())`, and
   returns `[MessageToDict(m) for m in resp.metrics]`. Propagate metadata via `_metadata()` (G4 --
   header propagation, matching `register_formula`/`update_formula` pattern).
2. In `tools.py`, add a new `@server.tool()` function `list_fundamental_metrics` that calls
   `client.list_fundamental_metrics()` and returns the result. Docstring: "List the available
   fundamental metrics for formula declarations. Returns each metric's enum name, snake_case
   data_key (for test_formula input_data), and human-readable meaning."
3. Update `test_formula`'s docstring to note that fundamentals-scoring formulas accept `input_data`
   with snake_case data-keys matching `FundamentalMetric` names (e.g.,
   `{"pe_ratio": 12.5, "pb_ratio": 1.8}`) -- use `list_fundamental_metrics` for the valid key
   catalog.
4. Update agent `CLAUDE.md` tool table: add `list_fundamental_metrics` row (`List available
   fundamental metrics for formula declarations`), update tool count from 49 to 50. Update
   `manage_formula` row to mention `fundamental_inputs`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/ -k "list_fundamental_metrics" -v
```

---

### Step 8 -- test: Agent catalog test + docs alignment (G4, G5)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_fundamental_metrics_tool.py` -- create
- `docs/runbooks/mcp-tools.md` -- modify
- `plugins/strat-lab/skills/backtest/SKILL.md` -- modify

**Reviewers**: xstockstrat-agent owner -- MCP tool contract stability, docs parity; none (docs)

**Codebase Evidence**:
- Confirmed via: `mcp-tools.md:562-611` -- `manage_formula` section, parameter table missing `fundamental_inputs`
- Confirmed via: `mcp-tools.md:614-639` -- `get_formula` section, return missing `fundamentalInputs`
- Confirmed via: `mcp-tools.md:821-839` -- `test_formula` section, needs fundamentals input_data guidance
- Confirmed via: `strat-lab SKILL.md:106-120` -- fundamentals-input formula operand docs, needs `list_fundamental_metrics` cross-ref
- C-13 (non-frontend test data): the mocked `ListFundamentalMetrics` response with 11 entries is a
  single consumer (only in `test_fundamental_metrics_tool.py`). Inline is compliant.

**TDD**: `red-green required`

**Covers**: AC-4, AC-5

**Instructions**:
1. Create `tests/test_fundamental_metrics_tool.py`:
   - Mock `ListFundamentalMetrics` returning 11 `FundamentalMetricInfo` entries.
   - Assert the tool returns a list of 11 dicts, each with `metric` (NAME-string), `dataKey`
     (snake_case), `meaning` (non-empty).
   - Assert the tool propagates metadata (G4): verify `_metadata()` is called in the client
     function.
2. Update `docs/runbooks/mcp-tools.md`:
   - `manage_formula` parameter table: add `fundamental_inputs` row (`list[str]`, No,
     `FundamentalMetric enum NAME-strings (e.g. ["FUNDAMENTAL_METRIC_PE_RATIO"]); non-empty =
     fundamentals-only formula. Use list_fundamental_metrics for the valid catalog.`).
   - `get_formula` return: add `fundamentalInputs` to the return field list.
   - `list_formulas` return: note `fundamentalInputs` is present per formula.
   - `test_formula` description: add a note that fundamentals formulas accept snake_case data-keys
     in `input_data`.
   - Add a new `### list_fundamental_metrics` section (after `list_formulas`): document the
     read-only tool, no parameters, return shape `[{metric, dataKey, meaning}]`.
3. Update `plugins/strat-lab/skills/backtest/SKILL.md`: in the fundamentals-input formula operand
   section (~line 106), add a cross-ref to `list_fundamental_metrics` for discovering valid metric
   names.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run ruff check app/ tests/ && uv run ruff format --check app/ tests/ && uv run pytest --cov=app --cov-fail-under=40
```

---

### Step 9 -- service: UI declare/view -- FundamentalInputEditor + BFF + useFormulas + FormulaWorkspace

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/FundamentalInputEditor.tsx` -- create
- `services/xstockstrat-ui/src/lib/insightsBff.ts` -- modify
- `services/xstockstrat-ui/src/hooks/useFormulas.ts` -- modify
- `services/xstockstrat-ui/src/components/insights/FormulaWorkspace.tsx` -- modify

**Reviewers**: xstockstrat-ui owner -- analytics display accuracy, Connect-RPC call safety, no-hardcoded-color (C-17)

**Codebase Evidence**:
- Confirmed via: `insightsBff.ts:140-158` -- IndicatorsService registrations end with `computeIndicator` and `listIndicators`; `listFundamentalMetrics` must be added
- Confirmed via: `indicatorsClient.ts:1-6` -- browser typed client already exists (`baseUrl: '/insights/api'`)
- Confirmed via: `useFormulas.ts:28-55` -- `useRegisterFormula` missing `fundamentalInputs`
- Confirmed via: `useFormulas.ts:57-87` -- `useUpdateFormula` missing `fundamentalInputs`
- Confirmed via: `FormulaWorkspace.tsx:62-88` -- props missing `initialFundamentalInputs`
- Confirmed via: `FormulaWorkspace.tsx:74-82` -- `onSave` callback missing `fundamentalInputs`
- Confirmed via: `FormulaWorkspace.tsx:241-250` -- save onClick missing `fundamentalInputs`
- Pattern to REUSE: `OutputEditor.tsx` -- `RepeatableRowList` + `useListEditor` + `Select` for a typed list editor
- Pattern to REUSE: `ParameterEditor.tsx:140` -- same component composition
- Header propagation (C-03): the new `listFundamentalMetrics` BFF registration uses `forward()`
  from `bffShared.ts`, which injects `backendHeaders` (x-user-id, x-access-scope, x-trace-id)
  automatically -- confirmed at `bffShared.ts` `forward` implementation. No manual header wiring.

**TDD**: `red-green required`

**Covers**: --

**Instructions**:
1. **BFF**: In `insightsBff.ts`, add `listFundamentalMetrics: forward(...)` to the
   `IndicatorsService` registration block (after `listIndicators`, ~line 157). This is a simple
   read-only forward (no admin, no session override needed -- same pattern as `listIndicators`).
2. **FundamentalInputEditor.tsx** (new file): create a client component mirroring
   `OutputEditor.tsx`:
   - Uses `RepeatableRowList` + `useListEditor` for add/remove/reorder.
   - Each row is a `Select` dropdown of the 11 `FundamentalMetric` NAME-strings fetched via the
     indicators browser client (`indicatorsClient.listFundamentalMetrics({})`). Cache the catalog
     in a `useQuery`.
   - The value type is `string` (the NAME-string, e.g. `"FUNDAMENTAL_METRIC_PE_RATIO"`).
   - Exports `FundamentalInputEditor` component (`value: string[]`,
     `onChange: (next: string[]) => void`).
   - Empty-state text: "No fundamental inputs. Add metrics the formula reads via
     `data[\"pe_ratio\"]`."
   - Uses design tokens and `@/components/ui/*` primitives only (C-17).
3. **useFormulas.ts**: Add `fundamentalInputs?: string[]` to both `useRegisterFormula` and
   `useUpdateFormula` mutation input types. Thread the value into the RPC call as
   `fundamentalInputs: vars.fundamentalInputs ?? []`. The Connect-JSON transport sends enum
   repeated fields as NAME-strings automatically (protobuf-es).
4. **FormulaWorkspace.tsx**:
   - Add `initialFundamentalInputs?: string[]` to `FormulaWorkspaceProps`.
   - Add `const [fundamentalInputs, setFundamentalInputs] = useState<string[]>(initialFundamentalInputs ?? [])`.
   - Render `<FundamentalInputEditor value={fundamentalInputs} onChange={setFundamentalInputs} />`
     in the form (after the outputs section, before warmup period).
   - Thread `fundamentalInputs` into the `onSave` callback shape and the save button's onClick
     payload.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
```

---

### Step 10 -- test: UI declare/view vitest

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useFormulas.test.ts` -- modify (if exists) or create

**Reviewers**: xstockstrat-ui owner -- analytics display accuracy

**Codebase Evidence**:
- Confirmed via: UI CLAUDE.md -- vitest unit tests live in `src/**/*.test.ts`, coverage scoped to
  `src/lib/**`
- The `useFormulas` hook lives in `src/hooks/`, outside the current `src/lib/**` coverage scope, so
  this is a behavioral correctness test (no threshold impact)

**TDD**: `red-green required`

**Covers**: --

**Instructions**:
1. If `src/hooks/useFormulas.test.ts` does not exist, create it. Test that `useRegisterFormula` and
   `useUpdateFormula` include `fundamentalInputs` in their RPC call payload when the input provides
   it. This can be a type-level assertion or a mock-based call verification.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run test:unit
```

---

### Step 11 -- service: UI test harness -- fundamentals value grid + symbol-prefill (G3)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/insightsBff.ts` -- modify
- `services/xstockstrat-ui/src/lib/fundamentalMetrics.ts` -- create
- `services/xstockstrat-ui/src/components/insights/FormulaWorkspace.tsx` -- modify

**Reviewers**: xstockstrat-ui owner -- analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Confirmed via: `insightsBff.ts:87-95` -- MarketDataService already registered with `getBars`,
  `getLatestPrice`, `deleteBackfilledData`
- G3: `getFundamentalsMulti` must be added to the existing MarketDataService BFF registration --
  NOT a new client
- Confirmed via: `FormulaWorkspace.tsx:139-170` -- `handleRun()` parses JSON input, builds
  inputParams
- Confirmed via: `FormulaWorkspace.tsx:184-187` -- `loadSampleData()` loads SAMPLE_OHLCV
- Confirmed via: `fundamentals.ts:13-30` -- `FUNDAMENTALS_AAPL` fixture shape (camelCase fields:
  `peRatio`, `pbRatio`, etc.)
- The two-vocabulary mapping: `GetFundamentalsMulti` returns camelCase (`peRatio`) -> must convert
  to snake_case data-keys (`pe_ratio`) for the sandbox `data` global
- Header propagation (C-03): the new `getFundamentalsMulti` BFF registration uses `forward()` from
  `bffShared.ts`, which injects `backendHeaders` automatically. No manual header wiring.

**TDD**: `red-green required`

**Covers**: --

**Instructions**:
1. **BFF (G3)**: In `insightsBff.ts`, add `getFundamentalsMulti: forward(...)` to the
   `MarketDataService` registration block (~line 87-95). This adds a method to the existing
   client -- NOT a new client or a new service registration. The `forward` helper handles session +
   header propagation (G4).
2. **fundamentalMetrics.ts** (new file in `src/lib/`): extract the camelCase->snake_case mapping
   logic into testable pure functions:
   - `metricNameToDataKey(name: string): string` -- derives the snake_case data-key from a
     `FundamentalMetric` NAME-string: `name.replace("FUNDAMENTAL_METRIC_", "").toLowerCase()`.
   - `fundamentalsToInputData(fundamentals: Record<string, number | undefined>, catalog: {dataKey: string}[]): Record<string, number | null>` -- maps a `GetFundamentalsMulti` response
     row to the sandbox `input_data` shape (null for missing, never NaN --
     fails.md:86).
3. **FormulaWorkspace.tsx** -- fundamentals value grid:
   - When `fundamentalInputs` is non-empty, render a "Fundamentals test data" section (a Card)
     below the standard JSON input area. Each declared metric renders as a labeled `Input`
     (type=number) keyed by its snake_case data-key (via `metricNameToDataKey`). The label is the
     metric meaning (fetch from the `listFundamentalMetrics` catalog cached in Step 9).
   - Store the grid values in a `Record<string, number | null>` state.
   - On `handleRun()`: when fundamentalInputs is non-empty, build `input_data` from the grid
     values (snake_case keys, numeric values; null entries omitted). Pass this as the `inputData`
     to `useExecuteFormula`. The standard JSON input area stays available for non-fundamentals
     formulas.
4. **FormulaWorkspace.tsx** -- symbol-prefill:
   - Add a symbol `Input` + "Load" `Button` beside the fundamentals grid header.
   - On "Load": call `insightsMarketDataClient.getFundamentalsMulti({ symbols: [symbol] })` (the
     existing browser client at `src/lib/browserClients/insightsMarketDataClient.ts` -- G3
     verified). Map the response `Fundamentals` fields via `fundamentalsToInputData`. For missing
     metrics (the field is absent or undefined in the response), set the grid value to `null` --
     never `NaN` (fails.md:86, MessageToDict rejects NaN in a Struct).
   - The author can then edit any prefilled value before running.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
```

---

### Step 12 -- test: UI test harness vitest

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/fundamentalMetrics.test.ts` -- create

**Reviewers**: xstockstrat-ui owner -- analytics display accuracy

**Codebase Evidence**:
- The `fundamentalMetrics.ts` helper module (created in Step 11) lives in `src/lib/` inside the
  vitest coverage scope (`coverage.all: false`, scoped to `src/lib/**`)

**TDD**: `red-green required`

**Covers**: --

**Instructions**:
1. Write unit tests in `src/lib/fundamentalMetrics.test.ts`:
   - Test all 11 NAME-string -> data-key conversions are correct (e.g.
     `FUNDAMENTAL_METRIC_PE_RATIO` -> `pe_ratio`).
   - Test `fundamentalsToInputData`: a full response maps to 11 numeric entries; a partial response
     maps missing fields to `null`; no `NaN` ever appears in the output.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run test:unit && pnpm run test:coverage
```

---

### Step 13 -- test: Analysis G6 third-leg parity test

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_fundamental_metric_parity.py` -- create

**Reviewers**: xstockstrat-analysis owner (test-only touch -- no runtime change)

**Codebase Evidence**:
- Confirmed via: `evaluator.py:144-155` -- `_FUNDAMENTAL_METRIC_DATA_KEY` maps all 11
  `FundamentalMetric` enum values to snake_case keys
- G6 design: "analysis-suite third-leg parity test" -- assert that the mechanical derivation
  (`name.removeprefix("FUNDAMENTAL_METRIC_").lower()`) produces the same data-key as the
  hand-authored `_FUNDAMENTAL_METRIC_DATA_KEY` for every enum value
- C-13 (non-frontend test data): imports the existing `_FUNDAMENTAL_METRIC_DATA_KEY` dict from
  production code and the proto enum descriptor -- no mocked domain data, no new test literals.

**TDD**: `red-green required`

**Covers**: AC-7

**Instructions**:
1. Create `tests/test_fundamental_metric_parity.py`:
   - Import `_FUNDAMENTAL_METRIC_DATA_KEY` from `app.services.evaluator`.
   - Import `indicators_pb2` (or `FundamentalMetric`) from `gen.indicators.v1`.
   - For every `(enum_int, data_key)` pair in `_FUNDAMENTAL_METRIC_DATA_KEY`, look up the enum's
     `name` via `indicators_pb2.FundamentalMetric.Name(enum_int)`, apply
     `name.removeprefix("FUNDAMENTAL_METRIC_").lower()`, and assert it equals `data_key`.
   - Assert the map has exactly 11 entries (all non-UNSPECIFIED values).
   - This pins the three-way contract: (1) the hand-authored analysis map, (2) the mechanical
     derivation, and (3) the proto enum descriptor all agree.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run ruff check app/ tests/ && uv run ruff format --check app/ tests/ && uv run pytest --cov=app --cov-fail-under=40
```

---

### Step 14 -- test: E2E Playwright + acceptance traceability + INVENTORY.md

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` -- modify
- `services/xstockstrat-ui/e2e/insights/formulas.spec.ts` -- modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` -- modify

**Reviewers**: xstockstrat-ui owner -- analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Confirmed via: `formulas.ts:30-36` -- `FORMULA_FUNDAMENTALS` fixture with
  `fundamentalInputs: ['FUNDAMENTAL_METRIC_PE_RATIO', 'FUNDAMENTAL_METRIC_ROE']`
- Confirmed via: `fundamentals.ts:13-30` -- `FUNDAMENTALS_AAPL` fixture
- Confirmed via: `INVENTORY.md` -- `FORMULA_FUNDAMENTALS` already registered (feature 200),
  `FUNDAMENTALS_AAPL` already registered (feature 125)
- C-12 (test-data inventory): reuses existing `FORMULA_FUNDAMENTALS` (feature 200) and
  `FUNDAMENTALS_AAPL` (feature 125) from `e2e/fixtures/`. No new fixture files needed. INVENTORY.md
  consumer list updated in this step.

**TDD**: `red-green required`

**Covers**: AC-2, AC-3, AC-4, AC-5, AC-6

**Instructions**:
1. **mock-backend.ts**: Add a `listFundamentalMetrics` handler to the IndicatorsService mock.
   Return 11 `FundamentalMetricInfo` entries (hard-coded or derived from the fixture) with `metric`
   (NAME-string), `dataKey`, `meaning`.
2. **mock-backend.ts**: Add a `getFundamentalsMulti` handler to the MarketDataService mock (if not
   already present for `/insights`). Return `FUNDAMENTALS_AAPL` for symbol `"AAPL"`.
3. **formulas.spec.ts**:
   - **AC-2**: Test that the FormulaEditor saves a formula with fundamental inputs selected in the
     picker; assert the mock receives `fundamentalInputs` NAME-strings.
   - **AC-3**: Test that opening a formula with `fundamentalInputs` (use `FORMULA_FUNDAMENTALS`
     fixture) renders the metrics as selected in the picker.
   - **AC-4**: Test that the fundamental-input picker dropdown lists 11 options.
   - **AC-5**: Test running a fundamentals formula with snake_case data-key values in the grid;
     assert `input_data` sent to the mock contains the correct keys.
   - **AC-6**: Test symbol-prefill: enter "AAPL" in the symbol field, click Load, assert the grid
     shows `FUNDAMENTALS_AAPL.peRatio` (31.4) in the `pe_ratio` field; assert no `NaN` values.
4. **INVENTORY.md**: No new fixture files needed (existing `FORMULA_FUNDAMENTALS` and
   `FUNDAMENTALS_AAPL` are already registered). Update the `Custom formulas` row to note that
   `FORMULA_FUNDAMENTALS` is also consumed by `e2e/insights/formulas.spec.ts` for the fundamentals
   picker/prefill tests.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- --grep "fundamental"
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
