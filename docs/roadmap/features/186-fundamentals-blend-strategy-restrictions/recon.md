# Recon: fundamentals-blend-strategy-restrictions

**Created**: 2026-09-08
**From**: product-spec.md
**Affected services**: xstockstrat-analysis

---

## Objective

Harden the fundamentals blend strategy so it executes exclusively against the fundamentals signal
universe (skip entirely when disabled or universe empty — never fall through to `resolve_universe`)
and cannot be deactivated, toggled non-live, or soft-deleted via the `ManageStrategy`/`SetStrategyLive`
RPCs. All three protections use the runtime config value of `analysis.engine.fundamentals_blend_strategy_id`.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Live loop cycle: `app/engine/live_loop.py:248` — `async def _run_cycle(self)`
  - Blend ID config read: `app/engine/live_loop.py:262-264` — `self._cfg.get_str("analysis.engine.fundamentals_blend_strategy_id", "fundamentals_macd_blend")`
  - Blend enabled config read: `app/engine/live_loop.py:265` — `self._cfg.get_bool("analysis.engine.fundamentals_blend_enabled", True)`
  - `blend_active` computed: `app/engine/live_loop.py:271-273`
  - Blend strategy universe branch: `app/engine/live_loop.py:296-301` — `if blend_active and definition.strategy_id == blend_id`
  - **THE GAP (FR-1)**: `app/engine/live_loop.py:303-307` — non-blend fallback calls `resolve_universe`; blend strategy falls through here when `blend_active=false`
  - `resolve_universe` function: `app/engine/live_loop.py:84`
  - `fundamentals_universe` resolution: `app/engine/live_loop.py:278-279`
  - Servicer: `app/handlers/servicer.py`
  - ConfigWatcher init: `app/handlers/servicer.py:391` — `self._cfg = config_watcher`
  - `ManageStrategy`: `app/handlers/servicer.py:2370` — request fields: `request.operation`, `request.definition.strategy_id`
  - DEACTIVATE branch: `app/handlers/servicer.py:2524-2531`
  - `SetStrategyLive`: `app/handlers/servicer.py:2604` — request fields: `request.strategy_id`, `request.live_enabled`
  - Disable path (no guard): `app/handlers/servicer.py:2641-2642` — falls straight to `set_live_enabled`
  - ConfigWatcher `get_str`: `app/config/watcher.py:87`
  - ConfigWatcher `get_bool`: `app/config/watcher.py:116`

## Patterns to REUSE

- **gRPC `FAILED_PRECONDITION` rejection** → reuse the existing pattern at `app/handlers/servicer.py:2636`:
  `await context.abort(grpc.StatusCode.FAILED_PRECONDITION, "cannot enable live evaluation on an inactive strategy; reactivate it first")`.
  Both new guards (DEACTIVATE rejection, live-toggle rejection) should use `FAILED_PRECONDITION` with descriptive messages following this same pattern.
- **Config-driven ID lookup via `self._cfg.get_str`** → reuse the identical call already in
  `app/engine/live_loop.py:262-264` for reading `fundamentals_blend_strategy_id` in the servicer guards.
- **`TestLiveLoopBlendUniverse` test class** → `tests/test_live_loop.py:909`; reuse `_cfg()` helper (`:920-932`),
  `_wire()` (`:934-986`), `_seen_capture()` (`:989-996`), `_live_row()` (`:629-648`), `_make_loop()` (`:36-56`).
- **`TestManageStrategy` / `TestSetStrategyLive` test classes** → `tests/test_analysis_servicer.py:655` / `:873`;
  reuse `make_servicer()` (`:35-55`), `_owned_ctx()` (`:58-65`), `_valid_definition()` (`:621-635`), `_row_for()` (`:638-644`).
- **Ownership check pattern** in ManageStrategy/SetStrategyLive: `PERMISSION_DENIED` for not-found/not-owned.
  The new blend-strategy guards must run **before** the ownership check to avoid leaking that the strategy exists.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-5 @FR-4 @feature-149` "Every documentation surface reflects the widened manage_strategy input type" (`docs/sdd/business-rules/platform.feature`) — ManageStrategy documentation surfaces must stay accurate; the DEACTIVATE rejection is a verb-specific guard, not an input-type change. Docs may need a note about the new restriction.
- **PRESERVE** `@AC-7 @FR-6 @feature-152` "Live evaluation resolves the benchmark component on a benchmark-referencing strategy" (`services/xstockstrat-analysis/acceptance/market-regime-benchmark-operand.feature`) — when the blend strategy IS evaluated (blend_active=true, universe non-empty), benchmark date-join + gap=hold resolution must still work.
- No existing `@AC-*` covers ManageStrategy verb-specific rejection, SetStrategyLive toggling, or blend strategy execution gating. Features 048/132/133/168 have no promoted scenarios — C-16 regression risk is low for this feature.

## Dependencies

- Proto/RPC: none — existing `ManageStrategy` and `SetStrategyLive` RPCs suffice
- Migration: none
- Config keys: `analysis.engine.fundamentals_blend_strategy_id` (existing), `analysis.engine.fundamentals_blend_enabled` (existing) — no new keys
- Inter-service edges: none
- New env vars / ports: none

## Risks / Not-found

- **No existing "protected strategy" / "cannot modify" guard pattern** in ManageStrategy or SetStrategyLive — feature 186 is the first. The closest precedent is `FAILED_PRECONDITION` at `servicer.py:2636` (enable-on-inactive).
- **`fundamentals_blend_strategy_id` / `fundamentals_blend_enabled` are NOT read anywhere in `servicer.py`** — the servicer guard clauses must add their own config reads via `self._cfg.get_str`.
- **Known trap (063-fundamentals-scoring-model)**: protect seeded/shared resources using config-driven identity, not hardcoded IDs (C-10(c)). FR-4 addresses this.
- **Guard ordering concern**: the blend-strategy guards must execute before the ownership check to avoid leaking whether the strategy exists to non-owners (anti-IDOR pattern). However, this means a non-owner attempting to deactivate the blend strategy gets `FAILED_PRECONDITION` instead of `PERMISSION_DENIED` — acceptable since the blend ID is a config value, not a secret.

## Recommended Scope

1. **Step 1 (service)**: Add execution-restriction guard in `_run_cycle` — skip blend strategy when `not blend_active` (a `continue` before the `resolve_universe` fallback).
2. **Step 2 (test)**: Test step for the execution restriction — extend `TestLiveLoopBlendUniverse`.
3. **Step 3 (service)**: Add lifecycle guards in `ManageStrategy` (reject DEACTIVATE) and `SetStrategyLive` (reject `live_enabled=false`) for the blend strategy.
4. **Step 4 (test)**: Test step for lifecycle guards — extend `TestManageStrategy` and `TestSetStrategyLive`.
