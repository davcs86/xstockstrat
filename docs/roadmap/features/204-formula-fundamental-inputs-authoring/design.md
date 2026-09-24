# Design: formula-fundamental-inputs-authoring

**Created**: 2026-09-24
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-09-24T00:00:00Z
**Grounded in**: recon.md

---

## Chosen Approach

Ship 204 as an **additive-proto** feature: one new read-only `ListFundamentalMetrics` RPC on
`xstockstrat-indicators` (the `FundamentalMetric` enum owner), plus **code-only** threading of
feature 200/201's already-persisted `fundamental_inputs` plumbing through the two consumer surfaces
(agent MCP tools + `/insights` formula builder). The indicators backend persistence and
register-time validation are **untouched** (`app/handlers/servicer.py:244,266,281,383-387`,
`app/services/parameters.py:103`, `app/services/formulas_repository.py`).

**Two-vocabulary contract (load-bearing).** Two seams use two representations and must never be
crossed:
- **DECLARE / VIEW** carries `FundamentalMetric` **enum NAME-strings** (`FUNDAMENTAL_METRIC_PE_RATIO`)
  — the wire form on `RegisterFormula`/`UpdateFormula`/`GetFormula` and over Connect-JSON.
- **TEST `input_data`** carries **snake_case data-keys** (`pe_ratio`) the sandbox reads off the `data`
  global — mechanically `name.removeprefix('FUNDAMENTAL_METRIC_').lower()`, which reproduces analysis's
  hand-authored `_FUNDAMENTAL_METRIC_DATA_KEY` (`services/xstockstrat-analysis/app/services/evaluator.py:144-155`)
  for all 11 metrics and equals a real `marketdata.Fundamentals` field. This equality is what makes the
  AC-7 test↔strategy-component parity hold.

**Catalog RPC (FR-3/AC-4)** — operator decision, round 1. Append after `DeleteFormula`
(`packages/proto/indicators/v1/indicators.proto:40`):
```
message ListFundamentalMetricsRequest {}
message FundamentalMetricInfo {
  FundamentalMetric metric = 1;   // enum → NAME-string over Connect-JSON / MessageToDict (C-04)
  string data_key = 2;            // snake_case sandbox data-key
  string meaning = 3;             // human-readable
}
message ListFundamentalMetricsResponse { repeated FundamentalMetricInfo metrics = 1; }
```
The handler (indicators `servicer.py`, which already imports `indicators_pb2`) **iterates the enum
descriptor** (skipping `FUNDAMENTAL_METRIC_UNSPECIFIED`) so a future metric can't be silently omitted;
the **only** hand-authored content is an 11-entry `{FundamentalMetric: meaning}` dict; `data_key` is
derived mechanically. Single source of truth in the enum owner — both consumers hold **zero**
hand-maintained catalog maps.

**Consumer surfaces (C-14).**
- **Agent (`xstockstrat-agent`)** — DECLARE: thread `fundamental_inputs` (NAME-strings) through
  `manage_formula` (`tools.py:905-932`) and the `RegisterFormulaRequest`/`UpdateFormulaRequest` +
  update-mask builders (`client.py:1042-1073`), converting via `FundamentalMetric.Value(name)` inside
  a try/except → clean gRPC `INVALID_ARGUMENT` on a bad name (closes the F-3/F-10 drop point). VIEW:
  `get_formula`/`list_formulas` already `MessageToDict` (`client.py:1105-1119`) → `fundamentalInputs`
  (camelCase) surfaces free. DISCOVER: new read-only `list_fundamental_metrics` tool returning the RPC
  response. TEST: `test_formula` gains a snake_case `input_data` path (values-only — no `formula_id`,
  nothing to validate against; `execute_formula`'s `input_data`→`Struct` `ParseDict` path is reused,
  `client.py:969-983`).
- **UI (`xstockstrat-ui`, `/insights`)** — the metric picker mirrors `ParameterEditor`/`OutputEditor`
  (`RepeatableRowList`+`useListEditor`+`Select`, `ParameterEditor.tsx:140`), fed by a new
  `insightsBff.listFundamentalMetrics` + the existing indicators browser client; `fundamentalInputs`
  is threaded into `useFormulas` register/update (`useFormulas.ts:28-51,57-80`) and `FormulaWorkspace`
  onSave (`FormulaWorkspace.tsx:74-82,242-250`), sent as Connect-JSON NAME-strings. The test harness
  extends `handleRun()`/`loadSampleData()` (`FormulaWorkspace.tsx:139,184`) with a fundamentals value
  grid keyed by the declared metrics; symbol-prefill routes **UI-side** via a new `getFundamentalsMulti`
  on the existing insights MarketDataService BFF registration + `insightsMarketDataClient`, mapping
  `Fundamentals` (Connect-JSON camelCase `peRatio`) → snake_case data-keys, honoring `missing_metrics`
  as **null, never NaN** (`MessageToDict` rejects NaN in a Struct — fails.md:86).

`strategyCatalog.ts:137 FUNDAMENTAL_METRICS` is **left untouched** — it is feature 198's screener
`metric_name` vocabulary (a different proto field), not the `FundamentalMetric` enum; folding it into
the RPC is out-of-scope strategy-authoring churn (named as a runner-up follow-up).

**Guards folded into the step plan** (see Open Risks / step boundaries):
G1 cross-service contract test (indicators, test-only import of `marketdata_pb2`); G2 fail-loud
handler completeness; G3 verify existing insights marketdata client (add method, not a new client);
G4 header propagation on the new calls; G5 same-PR docs alignment + dict→proto descriptor-parity
test; G6 analysis-suite third-leg parity test (test-only touch to `xstockstrat-analysis` — a
deliberate in-scope addition beyond recon's original affected set).

## Rejected Alternatives

- **Static catalog surfacing** (agent returns generated enum; UI reuses a static list) — rejected: ships two
  independent hand-maintained meaning maps that per-language completeness guards prove complete but never
  prove *agree* — the F-3/F-10 / RC-1 drift family (fails.md:308). The RPC makes AC-4's "same 11" structural.
- **Hand-maintained NAME↔snake_case map in the UI** — rejected: the key is mechanically derivable
  (`removeprefix().lower()`), so a hand map is a needless drift surface (C-18 DRY).
- **Symbol-prefill via the agent `test_formula`** — rejected: the agent has no marketdata client
  (`client.py:19-26`); standing one up is a heavier new edge than adding one method to the already
  marketdata-capable insights BFF. FR-5's "no symbol = author-supplied" keeps the agent path values-only.
- **Execute-time validation of `input_data` vs declared `fundamental_inputs`** — rejected: `test_formula`
  passes raw source (no `formula_id`), so there is nothing to validate against; adding a sandbox check
  would risk the @AC-4/@AC-5 execution guarantees (C-16). The drift is caught at build/contract time (G1/G6).
- **Fold `strategyCatalog.ts FUNDAMENTAL_METRICS` into the RPC** — rejected (this feature): different
  vocabulary (screener `metric_name`), drags strategy-authoring into scope (C-18 YAGNI). Named follow-up.
- **Checkbox-group metric picker** — rejected: a net-new pattern; `RepeatableRowList`+`Select` already exists.

## Open Risks

- [ ] **Two-vocabulary leak in the UI test harness** — picker=NAME-strings, grid=snake_case, prefill=camelCase→snake_case; with no execute-time validation a leaked key silently reads `None` (green run, wrong numbers). Addressed at **step 6** (AC-7 numeric round-trip parity) + **step 5** (FUNDAMENTALS_AAPL prefill parity).
- [ ] **`data_key` three-way contract drift on a *future* enum addition** — pinned by **G1** (step 1: derived key ↔ `marketdata.Fundamentals`) and **G6** (step 6: analysis map ↔ mechanical derivation). 204 adds no metric, so this is a future-proofing guard.
- [ ] **Scope addition to `xstockstrat-analysis`** — G6 is a test-only touch to a service recon listed out of scope; recorded here and in the recon addendum as deliberate. Addressed at **step 6**.
- [ ] **Zero-sentinel handling** — G1/G2 and the RPC response exclude `FUNDAMENTAL_METRIC_UNSPECIFIED`; the handler skips it. `/sdd-spec` precision note for **step 1**.

## Constitution Rules Touched

- `C-04` — honored: `FundamentalMetricInfo.metric` uses the enum (not a string); the enum already has `_UNSPECIFIED=0`.
- `C-09` — honored: the additive RPC + 3 messages run `buf lint`/`buf breaking` + `./scripts/buf-gen.sh` in step 1 (non-breaking).
- `C-10` — honored: every duplicated surface updated in the same PR — agent tools + docs (`mcp-tools.md`, strat-lab backtest SKILL.md, agent `CLAUDE.md` tool table + count) and the UI picker/test-harness (G5).
- `C-14` — honored: both named consumer surfaces (agent tools, `/insights` builder) get their own steps; not backend-only.
- `C-15` — honored: `acceptance.feature` corrected so `@AC-*` trace to tests (AC-3 camelCase, AC-5/6 snake_case, AC-7 numeric parity).
- `C-17` — honored: UI picker reuses `ui/*` primitives + design tokens (no hardcoded color, mirrors ParameterEditor).
- `C-18` — honored: minimal footprint (one RPC is the only addition), DRY via mechanical derivation + single-source RPC; the analysis-touch and no-execute-validation trade-offs are recorded here (recorded trade-off = compliance).
- `C-03` — honored: G4 propagates `x-user-id`/`x-access-scope`/`x-trace-id` on the new agent + UI calls.
- `C-01`/`F-04` — honored: G3 verifies existing-vs-new insights marketdata client before `/sdd-spec` writes "new".
- `F-07` — honored: the meaning dict/data_key are a closed-enum contract catalog in code (deployment-time-defined, C-04), not a runtime config value.
- `F-01` — honored: no migration (`fundamental_inputs` already persisted by indicators `006`).

## Business Rules Touched (C-16)

- PRESERVE `@AC-4 @feature-173` "An empty allowed_imports denies all sandbox imports instead of reverting to the permissive default" (`services/xstockstrat-indicators/acceptance/fix-python-config-zero-trap.feature`) — not regressed: `test_formula`/Run flow through the unchanged `ExecuteFormula`/`sandbox.py`; no import-list or sandbox change.
- PRESERVE `@AC-5 @feature-176` "Concurrent formula executions are no longer serialized to one at a time" (`services/xstockstrat-indicators/acceptance/analysis-concurrency-offload.feature`) — not regressed: no new execution route; off-loop concurrency + `indicators.sandbox.timeout_ms` kill untouched.
- EXTEND (net-new) — `@AC-1..7` are new authoring guarantees for the agent formula tools and the `/insights` builder; no durable `@AC-*` existed for the 200/201 `fundamental_inputs` plumbing or these surfaces. No CHANGE to any existing rule.

## Ordered /sdd-spec step boundaries (advisory)

1. **Indicators foundation** — add `ListFundamentalMetrics` proto + 3 messages (after `DeleteFormula`) + `./scripts/buf-gen.sh`; handler walks the enum descriptor (skips UNSPECIFIED), 11-entry meaning dict, mechanical `data_key`. **G2** unit test (every non-UNSPECIFIED enum → non-empty meaning AND data_key; handler raises, never `""`). **G1** cross-service contract test in `services/xstockstrat-indicators/tests/` (imports `gen.marketdata.v1.marketdata_pb2`; every derived data_key is a real `marketdata.Fundamentals` field). *Lands first — buf-gen unblocks steps 3-4.*
2. **Agent declare/view** — thread `fundamental_inputs` + `FundamentalMetric.Value(name)` try/except mapper through `manage_formula` + `client.py` Register/Update builders + mask; `get_formula`/`list_formulas` free. **G5** descriptor-parity test (mirror `tests/test_backtest_view.py`).
3. **Agent test + catalog + docs** — `test_formula` snake_case `input_data` (values-only); new `list_fundamental_metrics` tool. **G4** header propagation. **G5** docs same-PR (`mcp-tools.md`, strat-lab backtest SKILL.md, agent `CLAUDE.md` tool table + count).
4. **UI declare/view** — metric picker (mirror `ParameterEditor`) fed by new `insightsBff.listFundamentalMetrics` + indicators browser client; `fundamentalInputs` into `useFormulas` register/update + `FormulaWorkspace` onSave (NAME-strings).
5. **UI test harness** — fundamentals value grid + symbol-prefill. **G3** ADD `getFundamentalsMulti` to the existing insights MarketDataService BFF + `insightsMarketDataClient` (verify existing-vs-new); camelCase→snake_case; `missing_metrics`→null never NaN. **G4** header propagation.
6. **Tests + acceptance** — agent pytest round-trip; UI vitest + Playwright reusing `FORMULA_FUNDAMENTALS`/`FUNDAMENTALS_AAPL` + `INVENTORY.md` row; `acceptance.feature` corrections (AC-3 camelCase, AC-5/6 snake_case, AC-7 numeric round-trip parity); **G6** analysis-suite third-leg parity test (test-only touch to `xstockstrat-analysis`); `@AC-1..7` traced.
