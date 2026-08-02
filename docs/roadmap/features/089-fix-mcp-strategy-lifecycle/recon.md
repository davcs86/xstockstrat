# Recon: fix-mcp-strategy-lifecycle

**Created**: 2026-08-02
**From**: product-spec.md
**Affected services**: xstockstrat-analysis (Python), xstockstrat-agent (Python)

---

## Objective

Make strategy lifecycle honest (F-5, F-7): duplicate `register` → `ALREADY_EXISTS`; a deactivated
strategy can be reactivated; `set_strategy_live(enable)` on an inert config (inactive, or no
`signal_params.symbols`) → `FAILED_PRECONDITION`, while disable is always allowed. Fix the input, not
the live-loop consumer.

## Codebase Map

- **`xstockstrat-analysis`** (Python) — CI ≥40
  - `StrategyOperation` enum — `packages/proto/analysis/v1/analysis.proto:258-263` (REGISTER=1, UPDATE=2, DEACTIVATE=3; **next free = 4**).
  - `ManageStrategy` — `app/handlers/servicer.py:1543`; REGISTER branch `:1555-1563` calls `self._strategies_repo.create(...)` `:1560` (no existence check → duplicate PK raises `asyncpg.UniqueViolationError` → generic INTERNAL).
  - `SetStrategyLive` — `servicer.py:1697`; calls `set_live_enabled(id, live_enabled)` directly (`:1713`), NOT_FOUND if None; **no active/symbols precondition check**.
  - Repo `app/repositories/strategies.py`: `create` (INSERT, PK) `:33-45`; `get_by_id` `:47`; `deactivate` (SET active=FALSE) `:122-133`; `set_live_enabled` (SET live_enabled) `:~108-120`. **No `reactivate`.**
  - Live-loop firing contract — `app/engine/live_loop.py:88-90` `WHERE live_enabled = TRUE AND active = TRUE`; `_symbols_for` (`:110-116`) → `[]` when `signal_params.symbols` unset. (Consumer — do NOT change.)
  - `_row_to_strategy_definition` builds the proto (used to read signal_params).
  - `asyncpg` is **not** imported in the servicer (use a `get_by_id` existence check, not a violation catch).
  - Tests: `tests/test_analysis_servicer.py` — `TestManageStrategy` (register/update/deactivate), `TestSetStrategyLive`; `make_servicer`, `_admin_ctx`, `_row_for` helpers.
- **`xstockstrat-agent`** (Python)
  - `manage_strategy` client op map — `app/client.py:293-295` (register/update/deactivate → enum; `:298` rejects unknown). Add `reactivate`.
  - `set_strategy_live` client — `client.py:655` (thin flag-flip; FAILED_PRECONDITION surfaces as the RPC error).
  - Tool docstrings — `app/tools.py` `manage_strategy` (add reactivate) + `set_strategy_live` (currently documents the inert-success footgun — must flip). `_grpc_error_message` maps NOT_FOUND; ensure ALREADY_EXISTS/FAILED_PRECONDITION surface clearly.

## Patterns to REUSE

- **Reactivate verb + ALREADY_EXISTS** → mirror feature 088 `ManageSignalSource` (this same PR family): existence check → ALREADY_EXISTS; a dedicated reactivate verb decoupled from update; NOT_FOUND on unknown.
- **Enum op** → `StrategyOperation` already an enum (C-04 clean); add `STRATEGY_OPERATION_REACTIVATE = 4` (additive).
- **`_symbols_for` logic** → replicate the live-loop's symbols check (`live_loop.py:110-116`) in `SetStrategyLive` so the precondition matches the firing contract exactly (fix the input to the same predicate the consumer uses).

## Dependencies

- Proto/RPC: add `STRATEGY_OPERATION_REACTIVATE = 4` to `StrategyOperation` (additive). No `SetStrategyLiveResponse` change — use `FAILED_PRECONDITION`.
- Migration: none (behavior only). Config: none. Inter-service edges: none new.

## Risks / Not-found

- `## Not found`: no `reactivate` repo method; no existence check on register; no precondition check on SetStrategyLive; `asyncpg` not imported in the servicer.
- Design fork: reactivate as its own verb (REACTIVATE=4) vs. register-upsert-on-inactive. The verb mirrors 088 and keeps register strict — resolve in grilling.
- Ledger 081 (next-free): confirm `STRATEGY_OPERATION_REACTIVATE=4` unused on remote refs at /sdd-spec.

## Recommended Scope

1. proto: `STRATEGY_OPERATION_REACTIVATE=4`; buf gen. 2. analysis repo: add `reactivate`. 3. analysis
servicer: register existence check → ALREADY_EXISTS; REACTIVATE op; SetStrategyLive enable-precondition
(active + symbols) → FAILED_PRECONDITION, disable always allowed. 4. analysis tests. 5. agent client+tool
(reactivate op + honest set_strategy_live docstring) + tests. 6. docs (mcp-tools.md).
