# Design: fix-mcp-formula-lifecycle

**Created**: 2026-08-02
**Rounds**: 2 (full; termination: approved with user steer — analysis + ui pulled into scope)
**Approved by**: user @ 2026-08-02 (design gate: "Steer / adjust" → add analysis binding-refusal + UI deleted-handling; "soft delete is acceptable as long as strategy runs detect and flag the deletion to the user")
**Grounded in**: recon.md

---

## Chosen Approach

Ship AIP-161 partial-update + honest, run-flagged soft-delete for `manage_formula`, mirroring
feature 070's `ManageStrategy` end-to-end, across four services.

### 1. Proto (additive, non-breaking) — `packages/proto/indicators/v1/indicators.proto` + `analysis.proto`
- `+import "google/protobuf/field_mask.proto"` and `google.protobuf.FieldMask update_mask = 10` on
  `UpdateFormulaRequest` (fields 1–9 used; 10 next free — recon `indicators.proto:191-201`).
- `bool deleted = 13` on `FormulaDefinition` (fields 1–12 used; 13 next free — recon `indicators.proto:131-144`).
- `repeated string warnings = 16` on `analysis.v1.BacktestResult` (last field `initial_capital=15`;
  16 next free; message is wire-persisted-verbatim / additive-only — recon `analysis.proto:70-93`).
- `repeated string warnings = 10` on `analysis.v1.StrategyDefinition` (last field `cooldown_days=9`;
  10 next free) — populated by `GetStrategy` for the live-status flag (user steer: do not defer live).
- Run `./scripts/buf-gen.sh`; `buf lint` + `buf breaking` on the feature branch (all additive).

### 2. indicators — partial update + soft-delete (`app/handlers/servicer.py`, `app/services/formulas_repository.py`)
- `UpdateFormula`: `if request.HasField("update_mask")` → overlay only the masked columns onto the
  existing `get_by_id` row, then call `repo.update` with the merged values; **maskless → today's
  full-replace** (back-compat — the only other caller is the UI, which sends a full payload every
  call, recon `useFormulas.ts`). Mirror analysis `_guard_erasure` scoped to **`source` only**
  (recon `servicer.py:2371`) — do NOT extend to parameters/outputs/warmup/is_public (the UI clears
  those legitimately). `FAILED_PRECONDITION` if the target row is already soft-deleted.
- Migration **005** `add_formula_soft_delete`: `deleted_at TIMESTAMPTZ NULL`. `repo.delete` becomes an
  idempotent `UPDATE indicators.formulas SET deleted_at = NOW() WHERE formula_id=$1 AND deleted_at IS NULL`
  (recon `formulas_repository.py:194-199`). `repo.list` gains `AND deleted_at IS NULL` (recon `:137-161`);
  `get_by_id` stays **deleted-agnostic** (recon `:130-135`) so existing referenced strategies keep
  evaluating (verified: `ExecuteFormula` cache→`get_by_id`, `servicer.py:77-79`). `_row_to_formula`
  sets `deleted=(row["deleted_at"] is not None)` (recon `servicer.py:363-390`).

### 3. agent — full builders, read tools, safe update (`app/client.py`, `app/tools.py`)
- Add `_build_output` (mirror `_build_parameter`, recon `client.py:408-429`); thread
  `outputs`/`warmup_period` on **both** the `RegisterFormulaRequest` and `UpdateFormulaRequest`
  builders (recon `client.py:436-460`).
- `manage_formula` **tool** mirrors the *actual* `manage_strategy` mechanism (recon `tools.py:469-488`):
  scalar params become presence-detectable — `name/description/source: str|None=None`,
  **`is_public: bool|None=None`**, `warmup_period: int|None=None`, `outputs/parameters: list|None=None`;
  derive `update_mask = [field for field,val in supplied if val is not None]` plus a `clear_fields`
  param for deliberate erasure; the client builds `field_mask_pb2.FieldMask(paths=update_mask)`. This
  removes the omitted-vs-default ambiguity *and* the set-but-unmasked silent-drop.
- Add a `get_formula` client fn (template: the unused `list_formulas`, recon `client.py:472-487`);
  register `get_formula` + `list_formulas` **read tools** (catalog 17→19). The read-tool projections
  carry `deleted` (via `MessageToDict`).
- Descriptor-parity test over both builders (mirror `test_backtest_view.py`): `RegisterFormulaRequest`
  `_INTENTIONALLY_UNSET = {input_schema}` (legacy advisory, read at `servicer.py:242,256` but not
  agent-authored — cited); `UpdateFormulaRequest` excludes `update_mask` (meta field). Each opt-out
  justified individually so the test isn't a rubber stamp.

### 4. analysis — refuse deleted bindings + flag deletion in backtest runs (`app/handlers/servicer.py`)
- **Write-time binding refusal** (satisfies "add analysis binding-refusal"): in `_fetch_formula_outputs`
  (recon `servicer.py:194-201`), after the `GetFormula` returns, `if formula.deleted:` abort
  `INVALID_ARGUMENT` "strategy references deleted formula <id>" via the existing
  `context.abort` path (`:214-215`). A NEW strategy can no longer bind to a soft-deleted formula.
  (The pre-existing swallow of a truly-*missing* formula is unchanged — out of scope.)
- **Run-time flag — backtest** (satisfies the soft-delete acceptance constraint): a shared helper
  `_deleted_formula_warnings(definition, meta)` iterates the strategy's custom-formula components
  (mirror `_fetch_formula_outputs` `servicer.py:187-201`), `GetFormula`s each, and returns a
  human-readable line per `deleted=True` formula ("Formula '<name>' (<id>) referenced by this
  strategy has been deleted; the run used its last-saved definition."). The backtest path populates
  `BacktestResult.warnings` from it. The run still completes (get_by_id deleted-agnostic) — deletion
  is *flagged*, not silently ignored.
- **Run-time flag — live status** (user steer: do not defer live): the **same** helper populates
  `StrategyDefinition.warnings` in the `GetStrategy` handler (recon `servicer.py:1672-1682`), so a
  user (or the agent `get_strategy` tool / the UI strategy page) reading a live strategy that
  references a deleted formula sees the flag. One helper, two surfaces — no duplication.

### 5. ui — gate edit + render the run warning (`services/xstockstrat-ui/src`)
- `FormulaWorkspace` / edit page: when `formula.deleted`, render a "Deleted" badge and disable edit,
  mirroring the existing `SYSTEM_FORMULA_AUTHOR` read-only pattern (recon `FormulaWorkspace.tsx:46-52`)
  — a stale `/insights/formulas/[id]` URL no longer offers an edit that fails at save.
- `BacktestDiagnostics` (or the backtest results view): render `BacktestResult.warnings` as a warning
  banner, mirroring the coverage-gap pattern (recon `BacktestDiagnostics.tsx:51`).
- Strategy view/page: render `StrategyDefinition.warnings` (from `GetStrategy`) as a status warning so
  a live strategy referencing a deleted formula is flagged in the UI too.
- C-12 test data: a soft-deleted formula fixture in `e2e/fixtures/formulas.ts` and a
  warnings-bearing `BacktestResult` in `e2e/fixtures/backtests.ts` + `INVENTORY.md` rows; Playwright
  specs assert the read-only edit gate and the warning banner.

### 6. same-PR docs (root CLAUDE.md rule + ledger 2026-08-02)
- Rewrite the `manage_formula` docstring (recon `tools.py:531-548`, currently teaches full-replace +
  hard delete) to describe partial update, the read tools, outputs/warmup, and soft-delete semantics
  (non-destructive; referenced strategies keep evaluating **and now flag the deletion in backtests**;
  hidden from list; marked `deleted`; cannot be updated). Update `docs/runbooks/mcp-tools.md` rows and
  the `plugins/strat-lab` skill (per `docs/patterns/strat-lab-plugin.md` same-PR rule for these tools).

## Rejected Alternatives

- **Derive the update_mask from the tool's dict keys** — rejected: the tool builds a dict with every
  key present and scalar defaults collapse omitted→default, so this re-creates the F-2 wipe.
- **Explicit `update_mask: list[str]` param on the tool** — rejected in favor of None-sentinel +
  derived mask: an explicit param lets a caller set `source=` but forget to name it → silent lost edit
  (the same class 070 fixed).
- **Hard reference-checked delete via a new indicators→analysis edge** — rejected: analysis already
  dials indicators (root CLAUDE.md dep graph), so the reverse edge risks a boot/WAIT_FOR cycle (ledger
  2026-07-31 083). Soft-delete + write-time refusal + run-flag achieves reference-safety without the edge.
- **Plain soft-delete with no surfaced state** — rejected: dishonest against AC-4 (a "deleted" formula
  reads fully alive from `GetFormula`); the `deleted` flag + backtest warning make it observable.
- **Add `deleted` to `ExecuteFormulaResponse` and check it in every RUN path** (evaluator/screener/
  fundamentals) — rejected: broader blast radius across three call sites; the backtest warmup prefetch
  already fetches `GetFormula` per formula, a single detection point.
- **Extend the erasure guard to parameters/outputs/warmup/is_public** — rejected: the UI legitimately
  clears those in full-payload updates; guarding them would break it.

## Open Risks

- [x] ~~Live-strategy flagging deferred~~ — **resolved by user steer (do not defer live):** live
  status is flagged via `StrategyDefinition.warnings=10` populated by `GetStrategy` using the same
  `_deleted_formula_warnings` helper as the backtest path. Both the discrete backtest run and the live
  strategy read now surface a referenced formula's deletion. Continuous *push* alerting (notify) on the
  transition is still out of scope — the flag is surfaced on read (GetStrategy / UI / agent get_strategy).
- [ ] **maskless-path residual** — a maskless (non-UI, buggy) `UpdateFormula` can still blank
  parameters/outputs/warmup/is_public (erasure guard covers `source` only). Intentional (UI parity);
  documented in the docstring. Target: docstring step.
- [ ] **Field/migration numbers** (`update_mask=10`, `deleted=13`, `warnings=16`, migration `005`)
  verified next-free against the local tree + remote refs (no sibling 086–094 feature or remote branch
  touches indicators/analysis formula protos or an indicators `005_*` migration — checked 2026-08-02).
  Re-verify at `/sdd-spec` per ledger 081. Target: proto step.

## Constitution Rules Touched

- `C-01` / `F-04` — every design claim cites recon `path:line`; `/sdd-spec` re-greps before locking.
- `C-04` — no new enum; `deleted` is a bool presence flag (open-world not applicable), warnings a
  free-text string list (open/human-readable) — string is correct here.
- `C-07` / `F-01` — new migration `005_add_formula_soft_delete` (indicators); never edits an applied one.
- `C-08` / `P-06` — every service step gets a paired RED-before-GREEN test (repo/servicer for indicators
  & analysis; client/tool/parity for agent; Playwright + C-12 fixtures for ui) meeting each service's
  CI threshold (indicators ≥50, analysis ≥40, agent, ui).
- `C-09` — proto steps run `buf lint` + `buf breaking` (all additive) and `./scripts/buf-gen.sh`.
- `C-10` — the descriptor-parity test (agent builders) + the run_backtest projection carrying the new
  `warnings` field (parity test forces it) + surfacing `deleted` in every formula read path + the
  same-PR docstring/runbook/strat-lab update = integration completeness across shared surfaces.
- `C-13` — analysis/indicators tests use `conftest.py` AsyncMock pattern; ui tests use `e2e/fixtures/`.
- `F-06` — no new DB pool; no new inter-service edge (soft-delete avoids the indicators→analysis edge).
- `F-07` — no config values touched.
