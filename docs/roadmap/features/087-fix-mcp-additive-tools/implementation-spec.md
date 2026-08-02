# Implementation Spec: fix-mcp-additive-tools

**Status**: `done`
**Created**: 2026-08-02
**Feature**: `docs/roadmap/features/087-fix-mcp-additive-tools/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/fix-mcp-additive-tools`

---

## Execution Summary

Agent-only, additive — no proto/migration/config. Client fns first (Step 1), then their paired tests
incl. the NaN-scrub RED test + descriptor-parity (Step 2), then the MCP tools (Step 3) + their tests
and the 19→22 catalog (Step 4), then the same-PR docs (Step 5).

## Step Dependencies

- Step 2 tests Step 1; Step 4 tests Step 3; Step 3 depends on Step 1's client fns.
- Step 5 (docs) last.

---

### Step 1 — service: agent client fns (execute_formula, cancel_backfill, projections)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability, return shape

**Codebase Evidence**:
- `list_signal_sources` `:52-73`, `emit_alert` `:114-141`, `list_strategy_definitions` `:375-385`,
  `trigger_backfill` `:709` (admin), `get_backfill_status` `:771` (recon); `_admin_metadata` `:30-32`
- Protos: `ExecuteFormulaRequest` 1-8 / `ExecuteFormulaResponse` 1-9; `CancelBackfillRequest.job_id`;
  `EmitAlertRequest.context`(7)/`tags`(8)/`correlation_id`(9); `SignalSource.active`(5)/`health`(8)/
  `last_seen_at`(9)/`last_error`(10)/`signals_fed`(11)

**TDD**: `red-green required`

**Instructions**:
1. Add `_scrub_nonfinite(struct_dict)` helper (recursively replace `float` NaN/±Inf with `None`).
2. Add `execute_formula(formula_source, input_data=None, input_params=None, parameters=None,
   timeout_ms_override=0)` → `ExecuteFormula` inline (no formula_id), `_metadata()`. Scrub non-finite
   in `resp.output` before `MessageToDict`; wrap the projection in `try/except ValueError` →
   `{"success": False, "error": str(e)}`. Return `MessageToDict(resp, preserving_proto_field_name=True,
   always_print_fields_with_no_presence=True)` with the scrubbed output.
3. Add `cancel_backfill(job_id)` → `CancelBackfill`, `_admin_metadata()`, returns
   `{"job": MessageToDict(resp, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)}`.
4. `list_strategy_definitions`: change `MessageToDict(d)` → `MessageToDict(d, preserving_proto_field_name=True)` (snake_case parity with get_strategy).
5. `list_signal_sources` projection: add `active` (bool), `health` (`SourceHealthStatus.Name(src.health)`),
   `last_seen_at` (`_ts_to_iso(src.last_seen_at)` only when `src.HasField("last_seen_at")` else `None`),
   `last_error` (str), `signals_fed` (int). Add a small `_ts_to_iso` helper if none exists.
6. `emit_alert`: add `context: dict|None=None` (→ `ParseDict`/`Struct`), `tags: list[str]|None=None`,
   `correlation_id: str=""`; set them on `EmitAlertRequest` when present.

**Verification**: covered by Step 2.

---

### Step 2 — test: agent client (incl. NaN scrub + descriptor-parity)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify
- `services/xstockstrat-agent/tests/test_signal_source_projection.py` — create (descriptor-parity)

**Reviewers**: `xstockstrat-agent` owner — coverage adequacy

**Codebase Evidence**: mock-stub pattern `tests/test_client.py` (`_channel_cm`, `patch("app.client.grpc")`); parity template `tests/test_backtest_view.py`

**TDD**: `red-green required`

**Instructions** (each asserts new behavior; RED first):
1. `execute_formula` returns success/output for a finite result; a `NaN` output does NOT raise —
   scrubbed to `None` (RED on the unguarded `MessageToDict`).
2. `cancel_backfill` sends admin metadata (`x-access-scope`,`7`) and returns the job.
3. `list_strategy_definitions` emits snake_case keys.
4. `list_signal_sources` includes `active`/`health`/`last_seen_at`/`last_error`/`signals_fed`;
   an unset `last_seen_at` → `None`.
5. `emit_alert` sends `context`/`tags`/`correlation_id`.
6. Descriptor-parity: projection keys ∪ `{extractor_module}` == `SignalSource` fields (opt-out justified).

**Verification**: `cd services/xstockstrat-agent && ruff check app tests && pytest --cov=app --cov-fail-under=40`.

---

### Step 3 — service: MCP tools (test_formula, cancel_backfill, list_strategies, emit_alert fields)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract, tool-count parity

**Codebase Evidence**: `register_tools`/`@server.tool()` `:87`; `emit_alert` tool, `trigger_backfill`/`get_backfill_status` tools (recon)

**TDD**: `red-green required`

**Instructions**:
1. `test_formula(source, input_data=None, input_params=None, parameters=None, timeout_ms=0)` →
   `client.execute_formula`; docstring: inline dry-run, registers nothing, non-finite outputs → null.
2. `cancel_backfill(job_id)` → `client.cancel_backfill`; admin-scoped; NOT_FOUND mapping.
3. `list_strategies(include_inactive=False)` → `client.list_strategy_definitions`; returns `{"strategies": [...]}`.
4. `emit_alert`: add `context`/`tags`/`correlation_id` params; document `signals_fed`-style number vs int64-string only where relevant.
5. Module docstring header: 17→19 already; bump to 22 and add the three tools.

**Verification**: covered by Step 4.

---

### Step 4 — test: MCP tools + catalog 19→22

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify (catalog 19→22)

**Reviewers**: `xstockstrat-agent` owner

**TDD**: `red-green required`

**Instructions**:
1. Tool tests: `test_formula` dispatches to client.execute_formula with the inline source;
   `cancel_backfill` dispatches; `list_strategies` wraps the list; `emit_alert` forwards the new fields.
2. Catalog test: 19→22; preserve the `"Ingest a trading signal"` substring assert.

**Verification**: `cd services/xstockstrat-agent && ruff check app tests && pytest`.

---

### Step 5 — docs: mcp-tools.md sections + tool count

**Status**: `done`
**Service**: `docs` + `xstockstrat-agent`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify (new tool sections; `list_signal_sources` health fields; `emit_alert` new params; count 19→22)
- `docs/runbooks/CLAUDE.md` — modify (count)
- `services/xstockstrat-agent/CLAUDE.md` — modify (count + tool table)

**Reviewers**: none (docs)

**TDD**: `N/A (docs)`

**Instructions**: add `test_formula`/`cancel_backfill`/`list_strategies` sections; document
`list_signal_sources` health fields (incl. `signals_fed` as a JSON number) and `emit_alert`
`context`/`tags`/`correlation_id`; bump every "nineteen"/19 tool-count statement to "twenty-two"/22.

**Verification**: `pytest tests/test_tools_endpoint.py` (catalog/substring) + manual read.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
