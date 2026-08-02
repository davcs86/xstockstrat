# Product Spec: fix-mcp-strategy-lifecycle

**Type**: bug
**Source Report**: `docs/reports/2026-08-01-mcp-tools-alignment-triage.md` (F-5, F-7)
**Severity**: SEV-2
**Created**: 2026-08-02

---

## Problem Statement

Strategy lifecycle operations behave dishonestly:

- **Deactivation is irreversible (F-5).** No code path sets `active=TRUE`; the field is
  column-authoritative and explicitly rejected in an `update_mask`. Re-registering the id hits the
  PK as an uncaught `UniqueViolationError` → generic `INTERNAL`, not `ALREADY_EXISTS`. So a
  deactivate is permanent-by-accident and a duplicate register crashes ugly.
- **set_strategy_live accepts inert configs (F-7).** Enabling live on an inactive strategy succeeds
  and stores an inert flag (the live loop selects `live_enabled = TRUE AND active = TRUE`), and a
  strategy with no `signal_params.symbols` is silently skipped every cycle. The RPC already has the
  row (with `active` and `definition_json`) to detect both, but does not.

Expected: duplicate register → `ALREADY_EXISTS`; a reactivate path exists; enabling live on an inert
config returns `FAILED_PRECONDITION` (or a `warnings[]`), while disabling is always allowed.

## Reproduction Steps

1. `manage_strategy(operation="deactivate", ...)` then try to bring it back → no path.
2. `manage_strategy(operation="register", strategy_id=<existing>)` → generic INTERNAL.
3. `set_strategy_live(strategy_id=<inactive or no-symbols>, live_enabled=true)` → succeeds, never fires.

## Root Cause Hypothesis

RC-6 (one-way lifecycle verbs; `active` write-once). `SetStrategyLive` is a thin flag-flip that
never cross-checks the live loop's firing contract. See report F-5/F-7.

## Affected Services

`xstockstrat-analysis` (`app/handlers/servicer.py`, `app/repositories/strategies.py`,
`app/engine/live_loop.py`; possibly proto `STRATEGY_OPERATION_REACTIVATE` and/or
`SetStrategyLiveResponse.warnings`), `xstockstrat-agent` (`_grpc_error_message` mapping).

## Fix Scope

- [x] Proto changes possible — a `STRATEGY_OPERATION_REACTIVATE` enum value (unless
      register-upsert-on-inactive avoids it) and/or `SetStrategyLiveResponse.warnings` (unless
      `FAILED_PRECONDITION` is used, which needs no proto change).
- [ ] No database migrations anticipated.
- [ ] No config key changes anticipated.

## Acceptance Criteria

- [ ] Duplicate `register` → `ALREADY_EXISTS` (not INTERNAL).
- [ ] A deactivated strategy can be reactivated by a defined operation.
- [ ] `set_strategy_live(enable)` on an inactive strategy, or one with no `signal_params.symbols`,
      is rejected with `FAILED_PRECONDITION`; **disable is always allowed** (even on inert configs).
- [ ] Live loop invariant `live_enabled AND active` is unchanged (fix the input, not the consumer).
- [ ] RED-first tests; existing `TestSetStrategyLive` fixtures updated as needed.

## Out of Scope

- Cascade semantics beyond reactivation (e.g. deactivate auto-clearing `live_enabled`) unless design
  finds it the cleaner way to make the inert-A case unreachable.
