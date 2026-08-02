# Implementation Spec: fix-mcp-strategy-lifecycle

**Status**: `done`
**Created**: 2026-08-02
**Feature**: `docs/roadmap/features/089-fix-mcp-strategy-lifecycle/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/fix-mcp-strategy-lifecycle`

---

## Execution Summary

Additive proto (`STRATEGY_OPERATION_REACTIVATE`), codegen, then analysis (shared firing helper + repo
reactivate + servicer register/reactivate/live preconditions) + tests, agent (reactivate op + honest
docstrings) + tests, docs. No migration, no pool, no config.

## Step Dependencies

- Step 2 (codegen) requires Step 1. Steps 3/5 require Step 2. Each `test` step follows its `service` step.

---

### Step 1 — proto: STRATEGY_OPERATION_REACTIVATE

**Status**: `done`
**Service**: `packages/proto`
**Files**: `packages/proto/analysis/v1/analysis.proto` — modify
**Reviewers**: Proto Reviewer; `xstockstrat-analysis` owner
**Codebase Evidence**: `StrategyOperation` REGISTER=1/UPDATE=2/DEACTIVATE=3 — `analysis.proto:258-263` (recon)
**TDD**: `N/A (proto)`
**Instructions**: add `STRATEGY_OPERATION_REACTIVATE = 4;` to `StrategyOperation`. Re-verify next-free vs remote refs.
**Verification**: `buf lint` + `buf breaking` against main-dev — pass (additive).

### Step 2 — proto-gen

**Status**: `done`
**Service**: `packages/proto`
**Files**: `packages/proto/gen/**` — modify
**Reviewers**: _inherited_
**TDD**: `N/A (proto-gen)`
**Instructions**: `./scripts/buf-gen.sh`.
**Verification**: enum value present; re-run empty diff.

### Step 3 — service: analysis lifecycle honesty

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify (extract `strategy_symbols`)
- `services/xstockstrat-analysis/app/repositories/strategies.py` — modify (`reactivate`)
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (register/reactivate/live)

**Reviewers**: `xstockstrat-analysis` owner — lifecycle correctness, live-loop parity
**Codebase Evidence**: `ManageStrategy` `:1543-1563`, `SetStrategyLive` `:1697-1720`, repo `deactivate`/`create`/`get_by_id`, `_symbols_for` `live_loop.py:109-114` (recon)
**TDD**: `red-green required`
**Instructions**:
1. `live_loop.py`: module-level `strategy_symbols(definition) -> list[str]` (the `_symbols_for` body); `_symbols_for` delegates.
2. `strategies.py`: add `reactivate(strategy_id)` (UPDATE SET active=TRUE ... RETURNING; None if missing).
3. `servicer.py` register: `get_by_id` exists → `ALREADY_EXISTS`; wrap `create` in `try/except asyncpg.UniqueViolationError → ALREADY_EXISTS` (`import asyncpg`).
4. `servicer.py` REACTIVATE op: `get_by_id` None → NOT_FOUND; `_validate_definition_proto(_row_to_strategy_definition(row), context)`; `repo.reactivate(id)`.
5. `servicer.py` SetStrategyLive: on enable, `get_by_id` None → NOT_FOUND; inactive → FAILED_PRECONDITION; empty `strategy_symbols` → FAILED_PRECONDITION; disable always allowed.

**Verification**: covered by Step 4.

### Step 4 — test: analysis lifecycle

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**: `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
**Reviewers**: `xstockstrat-analysis` owner
**TDD**: `red-green required`
**Instructions**: dup register → ALREADY_EXISTS; reactivate sets active (+ NOT_FOUND; + re-validates); enable on inactive → FAILED_PRECONDITION; enable with no symbols → FAILED_PRECONDITION; enable on active+symbols → OK; disable on inert → OK. **Update `test_register_returns_definition` (add `get_by_id=None`), `test_permits_admin_scope` (get_by_id active+symbols), `test_returns_not_found_for_missing_strategy` (get_by_id=None).**
**Verification**: `cd services/xstockstrat-analysis && ruff check app tests && pytest --cov=app --cov-fail-under=40`.

### Step 5 — service: agent reactivate op + honest docstrings

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**: `services/xstockstrat-agent/app/client.py`, `app/tools.py` — modify
**Reviewers**: `xstockstrat-agent` owner
**Codebase Evidence**: op map `client.py:293-295`; `set_strategy_live` `client.py:655`; tool docstrings `tools.py` (recon)
**TDD**: `red-green required`
**Instructions**: client op map gains `"reactivate"`; unknown-op message lists it. `manage_strategy` tool docstring adds reactivate (+ note register drops the payload on ALREADY_EXISTS). `set_strategy_live` tool docstring: replace inert-success text with the FAILED_PRECONDITION contract (enable rejects inactive/no-symbols; disable always allowed).
**Verification**: covered by Step 6.

### Step 6 — test: agent

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**: `services/xstockstrat-agent/tests/test_client.py` (+ `test_tools.py` if needed) — modify
**Reviewers**: `xstockstrat-agent` owner
**TDD**: `red-green required`
**Instructions**: `manage_strategy(operation="reactivate")` maps to `STRATEGY_OPERATION_REACTIVATE`; unknown op still raises.
**Verification**: `cd services/xstockstrat-agent && ruff check app tests && pytest`.

### Step 7 — docs

**Status**: `done`
**Service**: `docs` + `plugins/strat-lab`
**Files**: `docs/runbooks/mcp-tools.md`; `plugins/strat-lab/skills/backtest/SKILL.md` (if it covers these verbs)
**Reviewers**: none (docs)
**TDD**: `N/A (docs)`
**Instructions**: mcp-tools.md `manage_strategy` (reactivate verb) + `set_strategy_live` (precondition contract). Check + update strat-lab skill if it documents these lifecycle semantics.
**Verification**: doc read.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
