# Implementation Spec: fix-mcp-formula-lifecycle

**Status**: `pending`
**Created**: 2026-08-02
**Feature**: `docs/roadmap/features/086-fix-mcp-formula-lifecycle/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/fix-mcp-formula-lifecycle`

---

## Execution Summary

Proto-first (additive fields on indicators + analysis), then codegen, then the indicators
soft-delete migration, then each service's behavior + paired tests (indicators → analysis → agent →
ui), then the same-PR docs sync. Order follows the data dependency: the `deleted`/`update_mask`/
`warnings` proto fields must exist and be generated before any service reads them; the migration must
precede the indicators repo change that writes `deleted_at`; analysis and the agent both depend on the
generated `deleted` flag; the UI depends on the generated `warnings`/`deleted` fields.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto).
- Step 3 (migration) is independent of proto but precedes Step 4 (indicators service writes `deleted_at`).
- Steps 4/6/8/10 (service) each require Step 2 (generated stubs).
- Step 6 (analysis) requires Step 1's `FormulaDefinition.deleted` + `BacktestResult.warnings`.
- Step 9 (agent test) covers the descriptor-parity + `run_backtest` projection parity forced by
  `BacktestResult.warnings` (Step 1).
- Each `test` step (5/7/9/11) immediately follows its `service` step (C-08).
- Step 13 (docs) is last — it describes the landed behavior.

---

### Step 1 — proto: additive fields for partial update, soft-delete, and run warnings

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/indicators/v1/indicators.proto` — modify
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness / no breaking change / buf lint+breaking; `xstockstrat-indicators` owner — formula contract; `xstockstrat-analysis` owner — backtest result contract

**Codebase Evidence**:
- `UpdateFormulaRequest` fields 1–9, no `update_mask`, no field_mask import — `indicators.proto:191-201`, imports end `:9` (recon)
- `FormulaDefinition` fields 1–12 (`warmup_period=12`) — `indicators.proto:131-144` (recon)
- `BacktestResult` last field `initial_capital=15`, additive-only note — `analysis.proto:70-93` (recon)

**TDD**: `N/A (proto)` — verified by `buf lint`/`buf breaking` in this step's Verification.

**Instructions**:
1. In `indicators.proto`: add `import "google/protobuf/field_mask.proto";` to the import block; add
   `google.protobuf.FieldMask update_mask = 10;` to `UpdateFormulaRequest` with an AIP-161 doc comment
   ("absent = full replace (back-compat); present = merge only the named paths"); add
   `bool deleted = 13;` to `FormulaDefinition` with a comment ("true = soft-deleted; still evaluable for
   existing references, hidden from ListFormulas, not updatable").
2. In `analysis.proto`: add `repeated string warnings = 16;` to `BacktestResult` and
   `repeated string warnings = 10;` to `StrategyDefinition` (live-status flag; user steer — do not
   defer live) with comments.
3. Re-verify next-free numbers against remote refs (ledger 081): `git ls-remote --heads origin` union +
   `grep` the two messages — confirm 10/13/16 unused on any branch.

**Verification**:
`cd packages/proto && buf lint && buf breaking --against '.git#branch=main-dev'` — both pass (all additive).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated)
- `packages/proto/gen/ts/dist/**` — modify (compiled)

**Reviewers**: _inherited from Step 1_

**Codebase Evidence**:
- Codegen entry: `./scripts/buf-gen.sh` (root CLAUDE.md § Generating Proto Stubs)

**TDD**: `N/A (proto-gen)`

**Instructions**:
1. Run `./scripts/buf-gen.sh` (Docker-based; regenerates Go/Python/TS + compiles TS).
2. Stage only the regenerated `packages/proto/gen/` output.

**Verification**:
`./scripts/buf-gen.sh && git status --short packages/proto/gen/` shows the new fields present;
re-running leaves an empty `git diff packages/proto/gen/` (proto-freshness parity).

---

### Step 3 — migration: indicators formula soft-delete column

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/migrations/005_add_formula_soft_delete.up.sql` — create
- `services/xstockstrat-indicators/migrations/005_add_formula_soft_delete.down.sql` — create

**Reviewers**: DBA — migration safety / index; `xstockstrat-indicators` owner — schema

**Codebase Evidence**:
- Highest migration `004_formula_warmup` → next is `005` (recon `migrations/`)
- Table `indicators.formulas` (`001_formulas.up.sql:3-13`)

**TDD**: `N/A (migration)` — behavior covered by Step 5.

**Instructions**:
1. `005_...up.sql`: `ALTER TABLE indicators.formulas ADD COLUMN deleted_at TIMESTAMPTZ NULL;` plus a
   partial index `CREATE INDEX ... ON indicators.formulas (author) WHERE deleted_at IS NULL;` (list
   query filters on `deleted_at IS NULL`).
2. `005_...down.sql`: drop the index then `ALTER TABLE indicators.formulas DROP COLUMN deleted_at;`.
3. Never edit an applied migration (F-01) — this is a new number.

**Verification**:
`./scripts/db-migrate.sh` applies 005 cleanly; `\d indicators.formulas` shows `deleted_at`.

---

### Step 4 — service: indicators partial-merge update + soft-delete

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/formulas_repository.py` — modify
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula lifecycle correctness, no side-effects; DBA — soft-delete query correctness

**Codebase Evidence**:
- Repo `update` full-replace — `formulas_repository.py:163-192`; `delete` hard DELETE — `:194-199`;
  `list` — `:137-161`; `get_by_id` — `:130-135` (recon)
- Servicer `UpdateFormula` — `:295`; `_row_to_formula` — `:363-390`; `DeleteFormula` — `:337` (recon)
- Mirror pattern: analysis `HasField("update_mask")` `:1567-1582`, `_guard_erasure` `:2371` (recon)

**TDD**: `red-green required`

**Instructions**:
1. `_row_to_formula`: set `deleted=(row["deleted_at"] is not None)` on the `FormulaDefinition`.
2. Repo `delete`: change to idempotent soft-delete
   `UPDATE indicators.formulas SET deleted_at = NOW() WHERE formula_id = $1::uuid AND deleted_at IS NULL`;
   return whether a row transitioned.
3. Repo `list`: add `AND deleted_at IS NULL` to the WHERE. Repo `get_by_id`: leave deleted-agnostic
   (existing references keep evaluating).
4. Servicer `UpdateFormula`: if `request.HasField("update_mask")`, fetch the current row via
   `get_by_id`, `FAILED_PRECONDITION` if it is soft-deleted, overlay only the masked paths (map proto
   path → column: name/description/source/is_public/parameters/outputs/warmup_period), then call
   `repo.update` with the merged values; maskless keeps today's full-replace. Add a `source`-only
   erasure guard mirroring analysis `_guard_erasure` (reject blanking `source` on a masked update).
5. Servicer `DeleteFormula`: unchanged auth checks; repo now soft-deletes; return success idempotently.

**Verification**: covered by Step 5 (`red-green`).

---

### Step 5 — test: indicators formula lifecycle

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_formulas.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — test adequacy

**Codebase Evidence**:
- Existing repo/servicer tests use AsyncMock pools — `tests/test_formulas.py` (update gates `:452-495`),
  `tests/conftest.py:14-34` (recon)

**TDD**: `red-green required`

**Instructions** (each asserts new behavior; RED before Step 4):
1. `UpdateFormula` with `update_mask=["description"]` preserves `source`/`parameters`/`is_public`/
   `outputs`/`warmup_period` (RED today: full-replace wipes them).
2. `UpdateFormula` maskless still full-replaces (back-compat).
3. `UpdateFormula` masked-blank `source` → `FAILED_PRECONDITION`/erasure-guard reject.
4. `UpdateFormula` on a soft-deleted row → `FAILED_PRECONDITION`.
5. `delete` sets `deleted_at` (soft), is idempotent; `list` excludes soft-deleted; `get_by_id` still
   returns it (eval-continuity); `_row_to_formula` maps `deleted`.

**Verification**:
`cd services/xstockstrat-indicators && ruff check app tests && pytest --cov=app --cov-fail-under=50` — passes.

---

### Step 6 — service: analysis binding-refusal + backtest deletion flag

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, no look-ahead; `xstockstrat-indicators` owner — formula contract consumer

**Codebase Evidence**:
- `_fetch_formula_outputs` GetFormula + swallow — `servicer.py:179-202` (call `:194`, abort path `:214-215`)
- Backtest warmup prefetch `_declared_formula_warmup` GetFormula — `servicer.py:1151` (recon)
- `BacktestResult.warnings=16` (from Step 1)

**TDD**: `red-green required`

**Instructions**:
1. In `_fetch_formula_outputs`, after `GetFormula` returns and before reading `.outputs`:
   `if formula.deleted:` `context.abort(INVALID_ARGUMENT, "strategy references deleted formula <id>")`.
   (Leaves the pre-existing truly-missing-formula swallow unchanged — out of scope.)
2. Add a shared helper `_deleted_formula_warnings(definition, propagation_meta) -> list[str]` that
   iterates `definition.components`, `GetFormula`s each custom-formula component, and returns a
   human-readable line per formula with `deleted=True` (swallow RpcError like the warmup path).
3. Backtest path: populate `BacktestResult.warnings` from the helper on the response.
4. Live status (user steer — do not defer): in `GetStrategy` (`servicer.py:1672-1682`), after building
   the definition via `_row_to_strategy_definition`, call the helper and set `definition.warnings`.
   The run/read still completes; deletion is flagged, not silently ignored.

**Verification**: covered by Step 7.

---

### Step 7 — test: analysis refusal + backtest warning

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — test adequacy

**Codebase Evidence**:
- Existing GetFormula mocks — `tests/test_analysis_servicer.py:1209,1251,3082,3137` (recon)

**TDD**: `red-green required`

**Instructions**:
1. ManageStrategy register/update referencing a formula whose `GetFormula` returns `deleted=True` →
   `INVALID_ARGUMENT` (RED today: swallowed, accepted).
2. Backtest of a strategy referencing a deleted formula → `BacktestResult.warnings` contains the
   formula id/name; the run still returns OK.
3. Backtest of a strategy with no deleted references → `warnings` empty (no false positives).
4. `GetStrategy` for a strategy referencing a deleted formula → `StrategyDefinition.warnings` contains
   the flag (live-status); clean strategy → empty.

**Verification**:
`cd services/xstockstrat-analysis && ruff check app tests && pytest --cov=app --cov-fail-under=40` — passes.

---

### Step 8 — service: agent full builders, read tools, safe partial update

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability, return shape, tool-count parity across inventory surfaces

**Codebase Evidence**:
- `manage_formula` builders omit outputs/warmup — `client.py:436-460`; `_build_parameter` — `:408-429`;
  unused `list_formulas` — `:472-487` (recon)
- `manage_formula` tool — `tools.py:507-576`; `manage_strategy` None-sentinel+derived-mask+`clear_fields`
  mechanism — `tools.py:469-488`; `@server.tool()` registration — `tools.py:87-89` (recon)
- `run_backtest` projection (must carry the new `warnings`) — `client.py:195-204`, `backtest_view.py`

**TDD**: `red-green required`

**Instructions**:
1. `client.py`: add `_build_output` (mirror `_build_parameter`); set `outputs`/`warmup_period` on both
   the Register and Update builders; accept an `update_mask: list[str] | None` on `manage_formula` and,
   when present, set `req.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=update_mask))`; add a
   `get_formula(formula_id)` client fn (mirror `list_formulas`).
2. `client.py` `run_backtest` projection: include the new `BacktestResult.warnings` in the returned
   summary (the descriptor-parity test in Step 9 forces this).
3. `tools.py` `manage_formula`: change scalar params to presence-detectable defaults
   (`name/description/source: str|None=None`, `is_public: bool|None=None`, `warmup_period: int|None=None`,
   `parameters/outputs: list|None=None`); on `operation="update"`, derive
   `update_mask=[field for field,val in supplied if val is not None]` + a `clear_fields: list|None`
   param; pass through to the client.
4. `tools.py`: register `get_formula` and `list_formulas` read tools via `@server.tool()`; their
   projections include the `deleted` flag.

**Verification**: covered by Step 9.

---

### Step 9 — test: agent client/tool + descriptor-parity

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify (catalog 17→19)
- `services/xstockstrat-agent/tests/test_formula_builders.py` — create (descriptor-parity)

**Reviewers**: `xstockstrat-agent` owner — contract + parity coverage

**Codebase Evidence**:
- Parity template `test_backtest_view.py::test_summary_key_set_covers_every_proto_field:157-174`;
  `_INTENTIONALLY_DROPPED` sentinel `backtest_view.py:33`; 17-tool catalog `test_tools_endpoint.py:23-41`;
  preserved substring `:50` (recon)

**TDD**: `red-green required`

**Instructions**:
1. Descriptor-parity test over both formula builders: builder field set ∪ `_INTENTIONALLY_UNSET`
   equals `RegisterFormulaRequest`/`UpdateFormulaRequest` `DESCRIPTOR.fields_by_name`.
   `_INTENTIONALLY_UNSET` = `{input_schema}` for Register (justified: legacy advisory, not agent-authored),
   `{update_mask}` for Update (meta field). Comment the justification per field.
2. Client tests: single-field update via `update_mask` preserves omitted fields; `outputs`/`warmup_period`
   mapped; `get_formula` returns `deleted`.
3. Tool tests: `manage_formula` update with only `description` derives `update_mask=["description"]`;
   `is_public=None` omitted vs `is_public=False` set are distinguished; `get_formula`/`list_formulas`
   tools registered and return the definition.
4. Catalog test: 17→19 tools; preserve the `"Ingest a trading signal"` substring assert.
5. `run_backtest` projection parity: `warnings` present in the summary key set.

**Verification**:
`cd services/xstockstrat-agent && ruff check app tests && pytest` — all pass (incl. the new parity test).

---

### Step 10 — service: ui deleted-edit gate + backtest warning render

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/FormulaWorkspace.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/formulas/[id]/page.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx` — modify (or the backtest results view)

**Reviewers**: `xstockstrat-ui` owner — display accuracy, Connect-RPC call safety, no secret values

**Codebase Evidence**:
- `SYSTEM_FORMULA_AUTHOR` read-only pattern — `FormulaWorkspace.tsx:46-52`; edit page/hooks
  `useFormulas.ts` (recon); `BacktestDiagnostics` render — `BacktestDiagnostics.tsx:51` (recon)

**TDD**: `red-green required` (Playwright)

**Instructions**:
1. `FormulaWorkspace`/edit page: when the loaded formula has `deleted=true`, render a "Deleted" badge
   and disable the edit form + save (mirror the system-author read-only path).
2. Backtest results: render `BacktestResult.warnings` as a warning banner above/near the diagnostics
   (Connect-JSON `warnings`).

**Verification**: covered by Step 11.

---

### Step 11 — test: ui Playwright + C-12 fixtures

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/formulas.ts` — modify (add a soft-deleted formula fixture)
- `services/xstockstrat-ui/e2e/fixtures/backtests.ts` — modify (add a warnings-bearing BacktestResult)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog rows)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (serve the fixtures)
- `services/xstockstrat-ui/e2e/insights/formulas.spec.ts` — modify (deleted-edit gate)
- `services/xstockstrat-ui/e2e/insights/backtest-coverage.spec.ts` — modify (warning banner) or a new spec

**Reviewers**: `xstockstrat-ui` owner — e2e adequacy; test-data inventory (C-12)

**Codebase Evidence**:
- Fixtures `e2e/fixtures/formulas.ts` (`FORMULA_RSI/MACD/FORMULAS`), `e2e/fixtures/backtests.ts`,
  `INVENTORY.md` rows 18-19 (recon)

**TDD**: `red-green required`

**Instructions**:
1. Add a `FORMULA_DELETED` fixture (`deleted:true`) + a `BACKTEST_WITH_WARNINGS` fixture to the
   canonical homes with `INVENTORY.md` rows (C-12).
2. Spec: opening the edit page for a deleted formula shows the badge and no editable save (RED today).
3. Spec: a backtest returning `warnings` renders the banner (RED today).

**Verification**:
`cd services/xstockstrat-ui && pnpm test:e2e -- insights/formulas.spec.ts insights/backtest-coverage.spec.ts` — passes.

---

### Step 12 — test: (reserved — merged into per-service test steps)

**Status**: `pending`
**Service**: n/a
_Intentionally empty: each service's tests are paired in Steps 5/7/9/11. Kept as a placeholder so
step numbers match the design's per-service pairing; no action._

**Reviewers**: none

**TDD**: `N/A (placeholder)`

**Instructions**: none.

**Verification**: n/a.

---

### Step 13 — docs: same-PR MCP surface sync

**Status**: `pending`
**Service**: `docs` + `xstockstrat-agent` + `plugins/strat-lab`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify (`manage_formula` docstring + new read-tool docstrings)
- `docs/runbooks/mcp-tools.md` — modify
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify (if it describes `manage_formula`)

**Reviewers**: none (docs)

**Codebase Evidence**:
- `manage_formula` docstring teaches full-replace + hard delete — `tools.py:531-548` (recon);
  same-PR rule — `docs/patterns/strat-lab-plugin.md`, ledger 2026-08-02

**TDD**: `N/A (docs)`

**Instructions**:
1. Rewrite the `manage_formula` docstring: partial update via `update_mask`/`clear_fields`; declarable
   `outputs`/`warmup_period`; new `get_formula`/`list_formulas` read tools; soft-delete semantics
   (non-destructive, referenced strategies keep evaluating AND backtests flag the deletion, hidden from
   list, `deleted` flag, not updatable). Preserve required test substrings.
2. Update `docs/runbooks/mcp-tools.md` rows for `manage_formula` + add `get_formula`/`list_formulas`.
3. Update the `strat-lab` backtest skill if it references `manage_formula` behavior.

**Verification**:
`cd services/xstockstrat-agent && pytest tests/test_tools_endpoint.py` (catalog/substring parity) +
manual doc read; run `/context-scrubber scan` scoped to the touched docs if the plugin is available.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
