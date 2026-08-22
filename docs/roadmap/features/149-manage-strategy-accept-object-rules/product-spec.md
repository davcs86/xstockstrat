# Product Spec: manage-strategy-accept-object-rules

**Created**: 2026-08-22

---

## Problem Statement

The `manage_strategy` MCP tool types `entry_rule`/`exit_rule` strictly as `str` (a JSON-encoded
condition tree). MCP clients whose transport pre-parses JSON-object arguments (e.g. the Claude Code
tool harness) deliver a rule written as a JSON object to the tool as a Python `dict`, which the tool's
pydantic signature rejects (`Input should be a valid string`). Such clients cannot register or update
a strategy at all, even though the rule content is valid. The agent is a pure passthrough here — it
never parses the rule itself (rule validation lives in `xstockstrat-analysis`) — so the strictness is
gratuitous.

## User Story

As an operator driving the platform through an MCP client that pre-parses JSON arguments, I want
`manage_strategy` to accept a rule passed as a JSON object (not only a JSON string), so that I can
register and update strategies regardless of how my client encodes JSON arguments.

## Functional Requirements

FR-1. `manage_strategy` accepts `entry_rule` / `exit_rule` as **either** a JSON string (current
behavior, unchanged) **or** a JSON object (dict). When a dict is supplied, the tool serializes it to a
canonical JSON string (`json.dumps`) before forwarding to `xstockstrat-analysis`, producing the same
stored value a caller would have gotten by passing that object pre-serialized.

FR-2. When `entry_rule` / `exit_rule` is omitted (`None`), behavior is unchanged — the field is not
included in the outbound definition / update mask (the feature-070 partial-merge semantics are
preserved).

FR-3. A JSON-string rule continues to pass through byte-for-byte unchanged (no re-encoding, no
re-ordering), so existing string callers see identical stored values.

FR-4. The change is documented consistently across every surface that describes the tool in the same
PR: the `manage_strategy` docstring in `app/tools.py`, the tool reference in
`docs/runbooks/mcp-tools.md`, and the `strat-lab` plugin's `backtest` skill (root-CLAUDE.md
strat-lab guardrail; ledger F-12 / 2026-08-02 mcp-tools-alignment).

## Out of Scope

- Any change to `xstockstrat-analysis` rule validation or storage — it already receives a JSON string
  and owns semantic validation; this feature only changes how the agent tool accepts the input type.
- The `signal_params` param (already typed `dict`) and `components` (already `list[dict]`) — unchanged.
- Accepting a **double-encoded** JSON string (a string whose content is itself a JSON string). The fix
  targets the dict-delivery case; a client that sends a plain JSON string is already supported.
- Any other MCP tool. Only `manage_strategy` is affected.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — the MCP tool wrapper (`app/tools.py` `manage_strategy`) whose param types
  widen and which gains the dict→string normalization. No other service changes.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **Agent** — `xstockstrat-agent` MCP tool: `manage_strategy` (widened `entry_rule`/`exit_rule`
  input types + dict→JSON-string normalization; return shape unchanged).
- [ ] **UI** — none.
- [ ] **None** — not applicable; the consumer surface is the agent tool above.

## Proto Contract Changes

- [x] No proto changes required. The outbound `ManageStrategyRequest.entry_rule`/`exit_rule` fields
  stay `string`; the tool serializes a dict to that string before the gRPC call.

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No schema changes.

## Feature Workflow Notes

Branch to create: `feature/manage-strategy-accept-object-rules` (branch from `main-dev`). In this
harness session the work lands on the assigned `claude/register-trading-strategies-uoqhuk` branch,
PR'd into `main-dev` (harness branch policy).

Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-agent` — MCP tool contract change, non-breaking additive)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] None. (Known trap — ledger F-12 / 2026-08-02 mcp-tools-alignment: a same-PR tool change must
  update the docstring **and** `docs/runbooks/mcp-tools.md` **and** the `strat-lab` skill; captured as
  FR-4 and gated by an acceptance scenario.)
