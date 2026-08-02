# Recon: fix-mcp-formula-lifecycle

**Created**: 2026-08-02
**From**: product-spec.md
**Affected services**: xstockstrat-indicators (Python), xstockstrat-agent (Python), xstockstrat-analysis (Python), xstockstrat-ui (Next.js) — *analysis + ui added by user steer 2026-08-02: soft-delete accepted only if strategy runs detect and flag a referenced formula's deletion to the user.*

---

## Objective

Make `manage_formula` safe and full-capability against the indicators service: a single-field
update must preserve omitted fields (AIP-161 partial merge, as `ManageStrategy` already does via
feature 070); add `get_formula`/`list_formulas` read tools for safe read-modify-write; let a
formula declare secondary `outputs` series and a `warmup_period`; and make `DeleteFormula`
reference-checked instead of a blind hard delete. Findings F-2, F-3, F-10 (formula reads).

## Codebase Map

- **`xstockstrat-indicators`** (Python)
  - Servicer: `services/xstockstrat-indicators/app/handlers/servicer.py`
    - `UpdateFormula` — `:295`; passes `request.*` straight through (`:324-333`)
    - `RegisterFormula` — `:198`; already reads `request.outputs`/`request.warmup_period` (`:224-225,232,244-245,257-259`)
    - `GetFormula` — `:263`; `ListFormulas` — `:277`
    - `DeleteFormula` — `:337`; ownership/system/admin checks `:341-357`
    - `_row_to_formula` — `:363-390`
  - Repository (NOTE: `app/services/`, not `app/repositories/`): `services/xstockstrat-indicators/app/services/formulas_repository.py`
    - `update` — `:163-192` **unconditional full-replace** UPDATE of `name, description, source, is_public, parameters, outputs, warmup_period`
    - `create` — `:45-77` (INSERT cols `:60-63`)
    - `get_by_id` — `:130` (`SELECT *`); `list` — `:137` (returns `(rows, total_count)`)
    - `delete` — `:194-199` **hard DELETE**, no referential check
  - Last migration: `004_formula_warmup.up.sql` → next number **005** (`migrations/`: 001 formulas, 002 parameters, 003 outputs JSONB, 004 warmup INTEGER)
  - Tests: `services/xstockstrat-indicators/tests/test_formulas.py` (repo+servicer; update owner gates `:452-495`, warmup round-trip `:508-607`, outputs `:73-94,211-230`); `tests/conftest.py:14-34` (proto path only, no DB fixtures — repo tests use AsyncMock pools). Coverage ≥50% (`CLAUDE.md:148`).
- **`xstockstrat-agent`** (Python)
  - Client: `services/xstockstrat-agent/app/client.py`
    - `manage_formula` — `:388-469`; `_build_parameter` — `:408-429`
    - `RegisterFormulaRequest` builder `:436-446` — omits `outputs`(8)/`warmup_period`(9)/`input_schema`(5)
    - `UpdateFormulaRequest` builder `:449-460` — omits `outputs`(8)/`warmup_period`(9)
    - `list_formulas` — `:472-487` (exists, **unused**); no `get_formula` client fn
    - Formula RPCs use `_metadata()` (ownership auth), NOT `_admin_metadata()` (`:445,459,467`)
  - Tools: `services/xstockstrat-agent/app/tools.py`
    - `manage_formula` tool — `:507-576`; dispatch by `operation` string
    - `register_tools(server)` + `@server.tool()` decorator — `:87-89` (add new read tools here)
  - Tests: `tests/test_backtest_view.py:157-174` (descriptor-parity template `test_summary_key_set_covers_every_proto_field`; `_INTENTIONALLY_DROPPED` sentinel `app/backtest_view.py:33`); `tests/test_tools.py:616-666` (manage_formula tool); `tests/test_client.py:216-251` (param mapping); `tests/test_tools_endpoint.py:23-41,50` (17-tool catalog + "Ingest a trading signal" substring). Conftest `tests/conftest.py` patches endpoints but NOT `INDICATORS_ENDPOINT`.

## Patterns to REUSE

- **AIP-161 partial-merge on update** → mirror feature 070 `ManageStrategy` in analysis:
  proto `google.protobuf.FieldMask update_mask` (`packages/proto/analysis/v1/analysis.proto:281`, import `:9`, doc `:274-280`); servicer mask read/validate `services/xstockstrat-analysis/app/handlers/servicer.py:1567-1582`; `_MASKABLE_PATHS`/`_COLUMN_AUTHORITATIVE_PATHS` `:2332-2340`; `_merge_definition_json` `:2347`; `_guard_erasure` `:2371`.
- **`_build_output` helper** → mirror `_build_parameter` (`client.py:408-429`).
- **`get_formula` read tool** → the unused `list_formulas` client fn (`client.py:472-487`) is the template; add a `get_formula` client fn calling the existing `GetFormula` RPC (proto `indicators.proto:28`).
- **Descriptor-parity test** → mirror `test_backtest_view.py::test_summary_key_set_covers_every_proto_field` + `_INTENTIONALLY_DROPPED` for the `RegisterFormulaRequest`/`UpdateFormulaRequest` builders (ledger insight 2026-08-02).
- **Reference-checked delete** → the strategy-reference scan target is analysis `strategies.definition_json` component refs (report F-2); read path is analysis, not indicators — cross-service.

## Dependencies

- Proto/RPC: `packages/proto/indicators/v1/indicators.proto` — `UpdateFormulaRequest` (`:191`) has `outputs`(8)/`warmup_period`(9) but **no `update_mask`**; `RegisterFormulaRequest` (`:159`) has both; `GetFormula`/`ListFormulas` RPCs already exist. Adding `update_mask` to `UpdateFormulaRequest` = additive (new field, non-breaking).
- Migration: next number **005** for indicators (only if a soft-delete/reference column is chosen — see Risks).
- Config keys: none.
- Inter-service edges: reference-checked delete needs indicators → analysis (or a strategies read) to scan `definition_json` — **new edge, or push the check server-side in analysis**. Currently no edge from indicators to analysis.
- New env vars / ports: none anticipated (unless a new indicators→analysis edge needs `ANALYSIS_ENDPOINT` in indicators).

## Risks / Not-found

- **Delete reference-check location is undecided (design fork).** indicators has no knowledge of strategies; a referential check means either (a) a new indicators→analysis synchronous edge (risk: dependency-graph direction — analysis already dials indicators per root CLAUDE.md, so indicators→analysis could create a cycle; see ledger 2026-07-31 083 insight), or (b) soft-delete in indicators + let analysis fail-closed at eval, or (c) a best-effort scan. Must be resolved in grilling.
- **Cross-service unique-violation / not-found honesty**: `UpdateFormula` on unknown id and register-on-existing behavior not yet characterized for AIP-161 semantics — confirm servicer behavior.
- `## Not found`: no `update_mask`/`FieldMask` anywhere in indicators; no referential FK between `indicators.formulas` and strategies; no `get_formula` client fn / tool; no `_build_output` helper; `INDICATORS_ENDPOINT` not patched in agent conftest.
- Ledger trap (2026-08-02, fails): hand-written dict→proto builders silently drop proto fields — descriptor-parity test is the mandated antidote. Same-PR rule: a `manage_formula` behavior change must update the docstring + `docs/runbooks/mcp-tools.md` + `plugins/strat-lab` skill if they describe it.

## Expansion — analysis + ui (user steer 2026-08-02)

- **`xstockstrat-analysis`** (Python) — CI coverage ≥40 (`.github/workflows/ci.yml:340-342`)
  - Write-time formula validation `_fetch_formula_outputs` — `app/handlers/servicer.py:179-202`; the per-component `GetFormula` at `:194`; **errors are swallowed → `{"value"}` at `:199-201`** (a missing/deleted formula is silently accepted today). Called from ManageStrategy REGISTER `:1556`, UPDATE `:1603`. Abort path: `context.abort(INVALID_ARGUMENT)` (`:214-215`).
  - Run-path formula resolution uses **`ExecuteFormula`** (no `deleted` signal): evaluator `_compute_component` `app/services/evaluator.py:237`, screener `app/services/screener.py:283`, fundamentals `app/services/fundamentals_scoring.py:52`. `ExecuteFormulaResponse` (`indicators.proto:77-87`) carries only success/error.
  - **Backtest warmup prefetch `_declared_formula_warmup` — `servicer.py:1151`** calls `GetFormula` per referenced formula (swallows RpcError→0 `:1156-1157`). **This is the detection point** — it already holds each `FormulaDefinition`, so it can read the new `deleted` flag and collect deleted refs for the run.
  - Backtest result surface: `BacktestResult` proto `packages/proto/analysis/v1/analysis.proto:74-93`, wire-persisted verbatim / additive-only (`:70-73`); last field `initial_capital=15` → **next free 16**; existing `coverage_gaps=13`, `diagnostics=14`. **No warnings field** — add `repeated string warnings = 16`.
  - Live status: `GetStrategy` returns bare `StrategyDefinition` (`:1672-1682`); `StrategyDefinition` next free 10, `StrategyAnalytics` next free 8; no health/warnings field, no health RPC. (Live-continuous flagging = follow-up, not 086.)
  - update_mask template (070) confirmed: `servicer.py:1567-1582`, `_MASKABLE_PATHS`/`_COLUMN_AUTHORITATIVE_PATHS` `:2334-2340`, `_merge_definition_json` `:2347`, `_guard_erasure` `:2371`.
  - Tests: `tests/test_analysis_servicer.py` (GetFormula mocks `:1209,:1251,:3082,:3137`); conftest `tests/conftest.py:11-29`.
- **`xstockstrat-ui`** (Next.js)
  - `FormulaWorkspace.tsx` — existing **read-only pattern for `SYSTEM_FORMULA_AUTHOR`** (`:46-52`) to mirror for a `deleted` formula (badge + disable edit). Edit page `src/app/insights/formulas/[id]/page.tsx`; hooks `src/hooks/useFormulas.ts` (`useFormula`, `useUpdateFormula:57`, `useDeleteFormula`).
  - `BacktestDiagnostics.tsx:51` renders `diagnostics: SymbolDiagnostics[]` — mirror for a new `warnings` banner (fed from `BacktestResult.warnings`).
  - C-12 fixtures: `e2e/fixtures/formulas.ts` (`FORMULA_RSI`, `FORMULA_MACD`, `FORMULAS`), `e2e/fixtures/backtests.ts` (`BacktestResult`), `INVENTORY.md` rows 18-19. Mock backend `e2e/mock-backend.ts` (`runBacktest`, formula handlers).

## Recommended Scope

1. **Proto**: add `google.protobuf.FieldMask update_mask` to `UpdateFormulaRequest` (indicators.proto); `buf gen`.
2. **indicators service**: field-mask-aware `UpdateFormula` (read-merge-write honoring `update_mask`, mirroring analysis `_merge`/`_guard_erasure`); reference-checked or soft delete per grilling decision. Paired repo/servicer tests (RED: single-field update wipes today).
3. **agent client**: add `outputs`/`warmup_period` to both builders + `_build_output`; thread `update_mask` on update; add `get_formula` client fn; keep `list_formulas`.
4. **agent tools**: register `get_formula` + `list_formulas` read tools; add `outputs`/`warmup_period` params to `manage_formula`; update docstring.
5. **agent tests**: descriptor-parity test over both builders; tool tests for new read tools + catalog update (17→19).
6. **docs same-PR**: `docs/runbooks/mcp-tools.md` rows + `plugins/strat-lab` skill if they describe `manage_formula`.
