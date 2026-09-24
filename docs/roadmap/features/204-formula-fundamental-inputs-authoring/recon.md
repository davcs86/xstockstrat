# Recon: formula-fundamental-inputs-authoring

**Created**: 2026-09-24
**From**: product-spec.md
**Affected services**: xstockstrat-agent, xstockstrat-ui, xstockstrat-indicators, xstockstrat-marketdata (consumed)

---

## Objective

Expose feature 201's fundamentals-formula plumbing (`fundamental_inputs` / `FundamentalMetric`) to
formula **authoring** on both surfaces: declare + view + discover-catalog + test-with-fundamentals,
via the agent formula tools and the `/insights` formula builder. The backend (indicators) already
persists and validates `fundamental_inputs`; this feature closes the authoring/exposure gap the two
consumer surfaces still have.

## Codebase Map

- **`xstockstrat-indicators`** (Python) — backend, mostly consumed
  - RPC handlers: `RegisterFormula`/`UpdateFormula`/`GetFormula`/`ListFormulas`/`ExecuteFormula` — `app/handlers/servicer.py` (register validate+persist `:244,:266,:281`; update mask-aware `:383-387,:401-402,:417`; `_row_to_formula` row↔proto `:477`; `fundamental_inputs` in `_FORMULA_MASKABLE_PATHS` `:32`)
  - Register-time validation: `validate_fundamental_inputs` — `app/services/parameters.py:103` (rejects `FUNDAMENTAL_METRIC_UNSPECIFIED`)
  - Persistence: JSONB column read/write — `app/services/formulas_repository.py:35-41,70,83,109,134,188,201`
  - System-formula mutation guard (`author="system"`) — `app/handlers/servicer.py:327-332` (update), `:432-437` (delete)
  - Sandbox binding: `input_data` → `data` global — `app/services/sandbox.py:159,165`; execute reads it via `MessageToDict` `servicer.py:142`
  - Seeded fundamentals formula — `app/formulas/fundamentals_value_quality.py`, `app/services/seed_formulas.py`
  - Last migration: `006_add_formula_fundamental_inputs.{up,down}.sql` → **next new = `007`** (`services/xstockstrat-indicators/migrations/`)
  - Config-read: `app/config/watcher.py:54-72,86-144` (`indicators.sandbox.*`)
- **`xstockstrat-agent`** (Python) — MCP, primary
  - Formula tools: `manage_formula` `app/tools.py:842-934` (builds request dict `:905-916`, mask `:920-932` — **both omit `fundamental_inputs`**); `get_formula` `:939-947`; `list_formulas` `:952-958`; `test_formula` `:1200-1225`
  - Client builders (hand-written dict→proto — F-3/F-10 drop point): `RegisterFormulaRequest` `app/client.py:1042-1054`; `UpdateFormulaRequest` + mask `:1059-1073`; `get_formula` (`MessageToDict`) `:1105-1119`; `execute_formula` (`input_data`→`Struct` via `ParseDict`) `:969-983`; `_build_formula_parameter` `:124-153`
  - Auth: `_caller_user_id`/`_require_claims` — `app/tools.py:904,156-171,117-132` (author-ownership, no admin scope)
  - Endpoint consts — `app/client.py:19-26` (**no marketdata endpoint**)
- **`xstockstrat-ui`** (Next.js) — /insights, primary
  - Authoring host: `src/components/insights/FormulaWorkspace.tsx:99` (onSave payload `:74-82,242-250`; run cell `handleRun()` `:139`, execute `:164-169`; `loadSampleData()` `:184`); `FormulaEditor.tsx:14` is a Monaco wrapper only
  - Pages: `src/app/insights/formulas/{new/page.tsx:10,22,[id]/page.tsx:64-71,page.tsx}`
  - Mutations to extend: `src/hooks/useFormulas.ts` — `useRegisterFormula:28-51`, `useUpdateFormula:57-80`, `useExecuteFormula:97`
  - List-editor pattern to mirror: `ParameterEditor.tsx:140` / `OutputEditor.tsx:47` (`RepeatableRowList` + `useListEditor`, shadcn `Select`)
  - BFF: `src/lib/insightsBff.ts:140-158` (formula RPCs; `registerFormula` injects `author` `:141-147`); browser client `src/lib/browserClients/indicatorsClient.ts:5-6`; browser→BFF Connect-JSON transport `src/lib/browserClients/transport.ts:57`; BFF→backend gRPC `src/lib/connectClients.ts:27`
  - Reusable metric vocab: `src/lib/strategyCatalog.ts:137` `FUNDAMENTAL_METRICS` (snake_case names + descriptions)
  - Fixtures: `e2e/fixtures/formulas.ts:30` `FORMULA_FUNDAMENTALS` (already declares `fundamentalInputs` NAME-strings), `e2e/fixtures/fundamentals.ts` `FUNDAMENTALS_AAPL`; `INVENTORY.md:17,23`; spec `e2e/insights/formulas.spec.ts`
- **`xstockstrat-marketdata`** (Go) — consumed only (symbol-prefill source)
  - `GetFundamentalsMulti` — `packages/proto/marketdata/v1/marketdata.proto:44` (req `repeated string symbols` `:239-241`; resp `repeated Fundamentals` `:243-245`); `Fundamentals` fields `market_cap=2…year_low=12`, `missing_metrics=18` `:208-228`
  - Handler: `internal/service/marketdata_service.go:1284` (cache-first, many-symbol, order-preserving), gate `:1143`

## Patterns to REUSE

- **Declare (agent)** → thread `fundamental_inputs` into `manage_formula` (`tools.py:905-932`) + the `RegisterFormulaRequest`/`UpdateFormulaRequest` builders (`client.py:1042-1073`) + update-mask; add a name→`FundamentalMetric` enum mapper mirroring `_build_formula_parameter`'s conversion style (`client.py:124-153`). **Backend needs no change** (validation/persistence already exist).
- **Declare/view (UI)** → mirror `ParameterEditor`/`OutputEditor` (`RepeatableRowList`+`useListEditor`+`Select`) for the metric picker; extend `useFormulas.ts` register/update mutation shapes + `FormulaWorkspace` onSave with `fundamentalInputs`. Reuse `strategyCatalog.ts:137 FUNDAMENTAL_METRICS` as the picker vocabulary.
- **View (agent)** → `get_formula`/`list_formulas` already return `MessageToDict(resp)` (`client.py:1105-1119`), so `fundamentalInputs` surfaces automatically once threaded on write — near-free.
- **Test with fundamentals** → reuse `execute_formula`'s `input_data`→`Struct` `ParseDict` path (`client.py:969-983`); the UI run cell's `handleRun()`/`loadSampleData()` seam (`FormulaWorkspace.tsx:139,184`) is where a fundamentals value grid parallels `SAMPLE_OHLCV`.
- **Symbol-prefill mapping** → reuse the canonical `_FUNDAMENTAL_METRIC_DATA_KEY` enum→`Fundamentals`-field map (`services/xstockstrat-analysis/app/services/evaluator.py:144-155`) and the `missing_metrics` null-not-zero lowering (`analysis servicer.py:1581-1600`). In the UI, the TS equivalent is the snake_case names already in `strategyCatalog.ts` `FUNDAMENTAL_METRICS`.
- **Fixtures** → reuse `FORMULA_FUNDAMENTALS` (`e2e/fixtures/formulas.ts:30`) and `FUNDAMENTALS_AAPL` (`e2e/fixtures/fundamentals.ts`); extend `INVENTORY.md`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-4 @FR-2 @FR-3 @feature-173` "An empty allowed_imports denies all sandbox imports instead of reverting to the permissive default" (`services/xstockstrat-indicators/acceptance/fix-python-config-zero-trap.feature`) — the authoring "Run"/`test_formula` path flows through `ExecuteFormula`; a fundamentals-input test run must not weaken or bypass the sandbox import allow-list.
- **PRESERVE** `@AC-5 @FR-5 @feature-176` "Concurrent formula executions are no longer serialized to one at a time" (`services/xstockstrat-indicators/acceptance/analysis-concurrency-offload.feature`) — `test_formula`/Run must keep `ExecuteFormula` off-loop concurrency (`indicators.sandbox.max_concurrent`) and the per-run `indicators.sandbox.timeout_ms` kill.
- **EXTEND (net-new)** — no durable `@AC-*` exists for the 200/201 `fundamental_inputs`/`FundamentalMetric` plumbing (documented only in `services/xstockstrat-indicators/CLAUDE.md` § Database), nor for the agent formula tools or the `/insights` formula builder. 204's scenarios (`@AC-1..7`) are net-new authoring guarantees, not regressions.
- **No CHANGE** to any existing guarantee. 204 is authoring-side only and does **not** modify the analysis strategy evaluator; FR-6/@AC-7 asserts parity with 201's already-built behavior without editing it (analysis was scanned for the parity claim; no analysis code change is in scope).

## Dependencies

- Proto/RPC: `fundamental_inputs` already exists — `FormulaDefinition=14` (`indicators.proto:169`), `RegisterFormulaRequest=10` (`:195`), `UpdateFormulaRequest=11` (`:232`); `FundamentalMetric` enum 0+11 (`:136-149`). `ExecuteFormulaRequest.input_data=3` Struct (`:67`) — no field needed for test. **Possible additive**: a `ListFundamentalMetrics` RPC appended after `DeleteFormula` (`indicators.proto:40`) for FR-3, OR no proto change (static surfacing). `GetFundamentalsMulti` (`marketdata.proto:44`) consumed for FR-5.
- Migration: none for this feature (`fundamental_inputs` persisted by indicators `006`; next-free would be `007` if ever needed — not expected).
- Config keys: none new. (Reuses `indicators.sandbox.*` for the test run — unchanged.)
- Inter-service edges: **new UI→marketdata edge on the /insights segment** for symbol-prefill — `insightsBff` must gain `getFundamentals`/`getFundamentalsMulti` (`insightsBff.ts:87-95` MarketDataService currently exposes only getBars/getLatestPrice/deleteBackfilledData) + an insights marketdata browser client (`marketDataClient.ts:5` is bound to `/trader/api`). The **agent has no marketdata client at all** (`client.py:19-26`).
- New env vars / ports: none — `MARKETDATA_ENDPOINT` already exists platform-wide; insightsBff just needs to construct the client.

## Risks / Not-found

- **F-3/F-10 (fails.md:308) — agent request-builder + docs drift:** `manage_formula`/`client.py` builders drop `fundamental_inputs` today; a new name→enum mapper is needed (none exists in `client.py`). Thread it through the builder AND the update-mask AND `docs/runbooks/mcp-tools.md:562-630,821-839` AND `plugins/strat-lab/skills/backtest/SKILL.md:106-120` (already documents the operand — must stay aligned) in the same PR, with a declare→`get_formula` round-trip test.
- **F-C-10 / Connect-JSON (fails.md:81-83,677-679):** UI must send `FundamentalMetric` as NAME-strings over Connect-JSON (transport confirmed JSON, `transport.ts:57`); any exhaustive TS map over the enum must be complete. `FORMULA_FUNDAMENTALS` fixture already uses NAME-strings — mirror it.
- **Symbol-prefill routing (design fork):** UI-side (add to insightsBff — one new inter-service edge on an already-marketdata-capable platform) vs agent-side (would require standing up a brand-new marketdata client in the agent — heavier). FR-5's "no symbol = author-supplied values" already makes the agent path values-only.
- **Catalog exposure (design fork):** new indicators `ListFundamentalMetrics` RPC (single source of truth, enum owner) vs static surfacing (UI reuses `strategyCatalog.ts FUNDAMENTAL_METRICS`; agent returns the generated enum) — DRY-vs-YAGNI (C-18). The UI already maintains a static `FUNDAMENTAL_METRICS` list that could drift from the proto.
- **Execute-time validation gap (not-found):** `ExecuteFormula` does not validate `input_data` keys against a formula's declared `fundamental_inputs` (`servicer.py` ExecuteFormula / `sandbox.py`). Decide whether `test_formula` needs any such check (likely YAGNI — test is exploratory).
- **No multi-select primitive (not-found):** `src/components/ui/` has single-select `Combobox`/`Select` only; the metric picker mirrors the `RepeatableRowList`+`Select` list pattern or a checkbox group.
- **C-14/parity (FR-6):** the "identical behavior as a strategy component" guarantee spans into 201's evaluator, which 204 does not modify — the parity is an assertion to test, not code to write here.

## Recommended Scope

Advisory step boundaries for `/sdd-spec` (not binding):
1. Agent `manage_formula` declare (thread `fundamental_inputs` + name→enum mapper in `client.py`) + `get_formula`/`list_formulas` view + docstrings.
2. Agent `test_formula` fundamentals `input_data` path (values-only) + mcp-tools.md + strat-lab SKILL.md alignment.
3. Catalog discovery (per the design decision: `ListFundamentalMetrics` RPC on indicators, or static surfacing on both consumers).
4. UI `FormulaWorkspace`/`useFormulas` declare+view (metric picker mirroring `ParameterEditor`, `fundamentalInputs` in register/update mutations).
5. UI test harness: fundamentals value grid + symbol-prefill via `insightsBff` `getFundamentals(Multi)` + insights marketdata client.
6. Tests: agent (pytest round-trip), UI (vitest + Playwright reusing `FORMULA_FUNDAMENTALS`/`FUNDAMENTALS_AAPL`), covering `@AC-1..7`.
