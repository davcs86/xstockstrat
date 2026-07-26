# Product Spec: strategy-partial-update

**Created**: 2026-07-26

---

## Problem Statement

`manage_strategy` with `operation="update"` currently replaces the whole stored definition rather
than merging. Sending only the field you mean to change — e.g. `cooldown_days` — silently drops the
strategy's `components` (custom-formula indicators) and entry/exit rules. The strategy stays
`active`, but every subsequent backtest returns 0 trades with `NO_TRADE_REASON_ENTRY_NEVER_TRUE`
because the entry rule can no longer resolve its `z`/`er` components. Because no read operation is
exposed, a caller who did not record the prior definition cannot recover it.

## User Story

As a strategy author (via the `manage_strategy` MCP tool or the StrategyWizard UI), I want to update
a single field of an existing strategy without re-sending its entire definition, so that tuning one
parameter cannot corrupt the strategy's components and rules.

## Functional Requirements

FR-1. `update` MUST apply a **partial merge**: fields omitted from the request are left unchanged;
only fields explicitly provided are updated. (Mechanism to be chosen at design: a proto
`google.protobuf.FieldMask update_mask`, or a distinct `patch` operation, with `update` retained as
an explicit full-replace only if clearly documented.)
FR-2. The server MUST **reject** (`INVALID_ARGUMENT`) any write that would leave an `entry_rule` /
`exit_rule` referencing a `ref_name` not present in `components`, instead of persisting a
non-firing strategy.
FR-3. Expose a strategy **read** operation (e.g. `GetStrategy` / `DescribeStrategy`) returning the
full stored definition, including each component's `formula_id` and `params`, reachable from the
`manage_strategy` MCP surface, so a definition can be fetched before editing and verified after.
FR-4. Partial-update semantics MUST be reflected in the `manage_strategy` MCP tool docstring and
`docs/runbooks/mcp-tools.md`, and in the StrategyWizard edit flow (send only changed fields, or send
the full definition it already holds — but never a partial that would trip FR-2).

## Out of Scope

- New strategy fields or indicator capabilities.
- Any change to backtest math or scoring.
- Versioning / history of strategy definitions (a possible follow-up, not required here).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — owns the strategy store and the `ManageStrategy` handler; implements the
  merge, the orphaned-component validation, and the read op.
- `xstockstrat-agent` — the `manage_strategy` / (new) read MCP tool signatures and docstrings.
- `xstockstrat-ui` — `StrategyWizard` edit path must not send definition-wiping partials.
- `packages/proto` — `ManageStrategy` request (add `update_mask` or a `patch` op) and a
  `GetStrategy` RPC/response.

## Proto Contract Changes

- [ ] No proto changes required
- Likely: add `google.protobuf.FieldMask update_mask` to the `ManageStrategy` request **or** a new
  `PatchStrategy` RPC; add a `GetStrategy` RPC + response message. All additive/backward-compatible;
  `buf breaking` must pass against the dev trunk.

## Config Key Changes

- [ ] No new config keys

## Database Changes

- [ ] No schema changes — behavioral change to the update handler; the existing strategy table/rows
  are sufficient. (Confirm at design that a merge does not require a new column.)

## Feature Workflow Notes

Branch to create: `feature/strategy-partial-update` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change) — only if a mask/RPC is deemed breaking
- [ ] DBA review + service owner (schema migration) — not expected

## Acceptance Criteria

1. Updating only `cooldown_days` (or any single field) preserves `components` and rules; a
   subsequent backtest reproduces the prior results except for the intended change.
2. A write leaving a rule referencing an absent component is rejected with a clear `INVALID_ARGUMENT`
   error, not silently accepted.
3. The read op returns the full stored definition including component `formula_id`s and `params`.
4. `manage_strategy` docstring, `docs/runbooks/mcp-tools.md`, and the StrategyWizard edit path all
   reflect partial-update semantics.

## Open Questions

- [ ] Mechanism: `update_mask` on the existing RPC vs. a separate `patch` operation vs. a
  merge-by-default `update` (and what, if anything, remains a full replace)?
- [ ] **Known trap (ledger C-10 / 067):** any proto change here hard-couples shared consumers —
  the `manage_strategy` MCP tool docstring, `docs/runbooks/mcp-tools.md`, and the StrategyWizard —
  which must be updated in the *same* feature with a test, per the "shipped the producer, forgot the
  shared consumer" fails-ledger entries (056/060/067).
- [ ] Should the read op be admin-scoped or match existing `manage_strategy` auth?
