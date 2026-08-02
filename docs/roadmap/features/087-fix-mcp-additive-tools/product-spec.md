# Product Spec: fix-mcp-additive-tools

**Type**: bug
**Source Report**: `docs/reports/2026-08-01-mcp-tools-alignment-triage.md` (F-10)
**Severity**: SEV-2
**Created**: 2026-08-02

---

## Problem Statement

Several backend capabilities are fully built and reachable over gRPC but have **no MCP surface**, so
the agent cannot use them (report F-10). Each is additive with **zero backend change**:

- **`test_formula` via `ExecuteFormula`** — the RPC accepts inline `formula_source` +
  `timeout_ms_override`, i.e. a dry-run of unsaved formula source. Highest leverage: turns "formula
  source is stored with zero validation" into a safe dry-run-then-register workflow.
- **`cancel_backfill` via `CancelBackfill`** — the agent can *start* a paid backfill (`trigger_backfill`)
  but cannot *stop* one; `CancelBackfill` exists and is admin-gated server-side.
- **`list_strategies` via `ListStrategyDefinitions`** — `client.list_strategy_definitions` exists
  **unused**; no tool exposes it. (Also clears the dangling `list_strategy_definitions` reference in
  other docstrings.)
- **Source-health passthrough** — `SignalSource` carries `health`/`last_seen_at`/`last_error`/
  `signals_fed` (feature 083); `client.list_signal_sources` drops all four.
- **`emit_alert` extra fields** — `EmitAlertRequest.context`/`tags`/`correlation_id` are stored and
  fanned out by notify but the tool never sends them.

Expected: each capability is reachable via a thin, additive MCP tool/projection.

## Reproduction Steps

1. Ask the agent to dry-run a formula before saving → no tool exists.
2. Start a backfill, then ask to cancel it → no tool exists.
3. Ask to list registered strategies → no tool (only `get_strategy` by id).
4. Inspect a signal source's health via `list_signal_sources` → fields absent.

## Root Cause Hypothesis

RC-1 — the agent's tool/client layer was wired for a subset of the available RPCs/fields; later
backend additions (feature 083 health fields, `ExecuteFormula` inline mode) were never surfaced.

## Affected Services

`xstockstrat-agent` only (`app/client.py` new/again-used client fns, `app/tools.py` new tools,
`tests/`). No proto, no backend change.

## Fix Scope

- [x] No proto changes anticipated.
- [x] No database migrations anticipated.
- [x] No config key changes anticipated.
- Add a descriptor-parity test on the `list_signal_sources` projection (RC-1 antidote) so newly
  added `SignalSource` fields fail closed.

## Acceptance Criteria

- [ ] `test_formula` runs inline source in the sandbox and returns success/output/errors without
      registering anything.
- [ ] `cancel_backfill(job_id)` cancels a queued/running job (forwards admin scope like siblings).
- [ ] `list_strategies` returns registered strategy definitions.
- [ ] `list_signal_sources` includes `health`/`last_seen_at`/`last_error`/`signals_fed`.
- [ ] `emit_alert` accepts and forwards `context`/`tags`/`correlation_id`.
- [ ] New tools have RED-first tests; existing tests pass.

## Out of Scope

- `get_formula`/`list_formulas` formula reads — routed with 086 (formula-lifecycle), since they
  pair with the `manage_formula` update fix.
- Any backend/proto change (none is required here).
