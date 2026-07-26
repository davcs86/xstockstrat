# Product Spec: strategy-partial-update

**Created**: 2026-07-26

---

## Problem Statement

`manage_strategy` with `operation="update"` currently replaces the whole stored definition rather
than merging. `ManageStrategy` UPDATE serializes the *incoming* proto wholesale
(`servicer.py:1373-1376`, `MessageToDict(definition)` → `strategies_repo.update`), so sending only
the field you mean to change — e.g. `cooldown_days` — silently drops the strategy's `components`
(custom-formula indicators) and entry/exit rules. The strategy stays `active`, but every subsequent
backtest returns 0 trades with `NO_TRADE_REASON_ENTRY_NEVER_TRUE` because the entry rule can no
longer resolve its `z`/`er` components.

Write-time validation does not catch this: `_validate_definition` short-circuits on an empty rule
(`evaluator.py:317-318`, `if not rule_json: continue`), and the destructive update wipes components
*and* rules together — an internally consistent empty definition that passes cleanly.

**Recovery is available but not from the agent.** A read op already ships at the proto, servicer, UI,
and agent-client layers (`analysis.proto:23`/`:260`, `servicer.py:1410`, `insightsBff.ts:55`,
`client.py:311`). The gap is only that **no MCP tool wraps it**, so an agent-driven caller who did not
record the prior definition cannot fetch it back.

## User Story

As a strategy author (via the `manage_strategy` MCP tool or the StrategyWizard UI), I want to update
a single field of an existing strategy without re-sending its entire definition, so that tuning one
parameter cannot corrupt the strategy's components and rules.

## Functional Requirements

FR-1. `update` MUST apply a **partial merge**: fields omitted from the request are left unchanged;
only fields explicitly provided are updated. (Mechanism to be chosen at design: a proto
`google.protobuf.FieldMask update_mask`, or a distinct `patch` operation, with `update` retained as
an explicit full-replace only if clearly documented. See Design Constraints below — proto3 field
presence forces this choice.)

FR-2. The server MUST validate the **merged result**, not the request, and MUST **reject**
(`INVALID_ARGUMENT`) a write that would leave an existing strategy without the components its rules
reference. Concretely, closing the hole the incident exposed requires both:
- (a) run the existing `_validate_definition` orphan-ref check (`evaluator.py:323`) against the
  post-merge definition; and
- (b) reject a write that would empty `components` (or blank a previously non-empty
  `entry_rule`/`exit_rule`) on an existing strategy unless that erasure is explicitly requested.
  Today an all-empty definition is internally consistent and passes (`evaluator.py:317-318`), which
  is exactly why the incident was not caught.

FR-3. Expose the **existing** `GetStrategy` RPC as an MCP tool (a thin `@server.tool()` wrapper over
the already-implemented `client.get_strategy`, `client.py:311`), returning the full stored definition
including each component's `formula_id` and `params`, so an agent can fetch a definition before
editing and verify it after. No new RPC, request, or response message is required.

FR-4. Partial-update semantics MUST be reflected in the `manage_strategy` MCP tool docstring and
`docs/runbooks/mcp-tools.md`. Adding the FR-3 read tool additionally requires updating every shared
surface that hardcodes the tool inventory:
- `docs/runbooks/mcp-tools.md:3` and `:29` — both state **"thirteen tools"**;
- `services/xstockstrat-agent/app/tools.py:4-18` — module-docstring tool inventory;
- `services/xstockstrat-agent/tests/test_tools_endpoint.py:17-22` — asserts the exact registered
  tool-name set served by `GET /api/tools`.

FR-5. The StrategyWizard edit path MUST remain correct under the chosen mechanism. It currently
hydrates the full definition and always sends `components`/`entryRule`/`exitRule`
(`StrategyWizard.tsx:138-156`), so it is already safe against definition-wiping partials — but a
`FieldMask` mechanism requires it to send an all-fields mask (or the server to treat an absent mask
as full-replace) or component **removal** will silently stop working.

## Out of Scope

- New strategy fields or indicator capabilities.
- Any change to backtest math or scoring.
- Versioning / history of strategy definitions (a possible follow-up, not required here).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — owns the strategy store and the `ManageStrategy` handler
  (`servicer.py:1350`); implements the merge (FR-1) and extends validation to the merged result
  (FR-2). The orphan-ref check (`evaluator.py:323`) and the `GetStrategy` handler
  (`servicer.py:1410`) already exist and are reused, not rebuilt.
- `xstockstrat-agent` — `manage_strategy` docstring (FR-4) and a **new** thin MCP tool wrapping the
  existing `client.get_strategy` (FR-3), plus the tool-inventory surfaces listed in FR-4.
- `xstockstrat-ui` — `StrategyWizard` edit path (FR-5); already sends full definitions, so this is a
  verification/regression-test obligation unless the chosen mechanism requires a mask.
- `packages/proto` — `ManageStrategyRequest` only, if the design picks a mask (next free field
  number is **3**; `operation = 1`, `definition = 2`).

## Proto Contract Changes

- [ ] No proto changes required
- Scope is **only** the merge mechanism: possibly `google.protobuf.FieldMask update_mask` on
  `ManageStrategyRequest` (next free field number **3**) **or** a new `PatchStrategy` RPC. Additive
  and backward-compatible; `buf breaking` must pass against the dev trunk.
- **Explicitly NOT in scope:** `GetStrategy` / `GetStrategyRequest`. Both already exist
  (`analysis.proto:23`, `:260-262`) and return the existing `StrategyDefinition` (`:233`);
  re-declaring either fails `buf lint` on a duplicate name.

## Design Constraints (discovered during review)

- **Proto3 field presence forces the mechanism choice.** `StrategyDefinition.components`
  (`analysis.proto:236`, `repeated`), `entry_rule` (`:237`), and `exit_rule` (`:238`) have **no**
  field presence — only `cooldown_days` is `optional` (`:245`). A merge-by-default `update`
  therefore cannot distinguish "omitted" from "deliberately cleared", which directly conflicts with
  the StrategyWizard's ability to *remove* a component (it sends the reduced list,
  `StrategyWizard.tsx:141`). This is the strongest argument for the `FieldMask` branch of OQ-1.
- **Feature 065 evidence-wipe side effect.** A successful UPDATE clears the in-memory headline grade
  and recomputes against the new definition fingerprint (`servicer.py:1385-1398`). Because
  `_definition_fingerprint` excludes only `display_name`/`active`/`live_enabled`, a
  `cooldown_days`-only tune **changes the fingerprint and discards the strategy's accumulated
  evidence base**. Fixing the wipe (FR-1) does not fix this; the design must state whether it is
  accepted or addressed, or "tune one parameter safely" stays only half-true.
- **Do not admin-scope `GetStrategy`.** It currently has no admin check (`servicer.py:1410-1413`),
  unlike `ManageStrategy` (`servicer.py:1352-1353`), and the non-admin strategy detail page calls it
  unconditionally (`strategies/[id]/page.tsx:42`). If the FR-3 read tool needs admin scope, scope the
  **tool**, not the RPC.

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

Each criterion below **fails on unmodified `main-dev`** and passes only with this feature's changes.

1. Updating only `cooldown_days` (or any single field) preserves `components` and rules; a
   subsequent backtest reproduces the prior results except for the intended change. *(Today this
   wipes the definition — `servicer.py:1373-1376`.)*
2. A partial update whose **merged result** would leave a rule referencing an absent component is
   rejected with a clear `INVALID_ARGUMENT`. *(Today validation runs against the request, so a
   wholesale-empty definition passes — `evaluator.py:317-318`.)*
3. A write that would empty `components`, or blank a previously non-empty `entry_rule`/`exit_rule`,
   on an existing strategy is rejected unless the erasure is explicitly requested. *(Today it is
   silently accepted — this is the exact incident path.)*
4. An MCP tool returns the full stored definition including component `formula_id`s and `params`.
   *(Today the RPC exists but no MCP tool reaches it — `tools.py` registers no strategy read.)*
5. `manage_strategy` docstring, `docs/runbooks/mcp-tools.md` (including both "thirteen tools" counts
   at `:3` and `:29`), the `tools.py:4-18` inventory docstring, and
   `test_tools_endpoint.py:17-22`'s name-set assertion all reflect the new tool and partial-update
   semantics.
6. Component **removal** via the StrategyWizard still works after the mechanism change
   (`StrategyWizard.tsx:141` sends a reduced component list).

## Open Questions

- [ ] **OQ-1 — Mechanism (design phase):** `update_mask` on the existing RPC vs. a separate `patch`
  operation vs. a merge-by-default `update` (and what, if anything, remains a full replace)? See
  Design Constraints — the proto3 no-presence issue on `components`/`entry_rule`/`exit_rule` is the
  deciding factor.
- [ ] **OQ-2 — Feature 065 evidence wipe (design phase):** accept that a partial tune still resets
  the fingerprint and discards the evidence base, or address it (e.g. exclude `cooldown_days` from
  the fingerprint)? See Design Constraints.

**Resolved during review** (previously open):
- ~~Should the read op be admin-scoped?~~ **No** — `GetStrategy` is intentionally un-scoped and the
  non-admin detail page depends on that (`strategies/[id]/page.tsx:42`). Scope the tool if needed,
  never the RPC. See Design Constraints.

## Risks / Known Traps

- **Ledger C-10 (fails 056/060/067) — "shipped the producer, forgot the shared consumer."** Changes
  here hard-couple the `manage_strategy` MCP tool docstring, `docs/runbooks/mcp-tools.md`, and the
  StrategyWizard, and the new read tool additionally couples the four tool-inventory surfaces
  enumerated in FR-4. All must be updated in the *same* feature, each with a test.
- **Rebase-only overlap with feature 071** (`backtest-time-window`, developed in parallel): shared
  files `analysis.proto`, `servicer.py`, `tools.py`, `client.py`, `insightsBff.ts`, `mcp-tools.md` —
  disjoint regions, no field-number/config/migration collision. Whichever merges second rebases. The
  one genuine same-line spot is the `tools.py:4-18` tool-count docstring.
