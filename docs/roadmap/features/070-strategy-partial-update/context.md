# Context: strategy-partial-update  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped `FieldMask update_mask=3` on `ManageStrategyRequest` giving `UPDATE` an AIP-161 partial merge, plus a `get_strategy` MCP tool. The real fix was three-layered — proto mask, server merge+erasure-guard, and rewriting the MCP tool's client (which had been unconditionally fabricating full-definition payloads) — because a server-only fix would not have stopped the incident (context.md:35-41, design.md §4).
**Why (irrecoverable rationale)**: `STRATEGY_OPERATION_PATCH=4` was rejected not on elegance but because `insightsBff.ts:46-49` is an exhaustive `StrategyOperation` allow-list gating `requireAdminScope`; a new enum value falls through as non-mutating and silently drops defense-in-depth to the backend's own scope check alone (design.md §Rejected Alternatives, lines 144-151) [DUP:insights.md:219].
**Rejected alternatives**:
- Two-rule merge (scalars off proto, messages off dict) — `MessageToDict` omits default no-presence fields, silently no-oping component clear and churning `signal_params` (design.md §1, lines 156-157) [DUP:insights.md:232]
- Repository-layer `jsonb ||` merge — can't delete keys (breaks clear semantics) and would ship untested, no repo test file exists (design.md §Rejected Alternatives, lines 152-155)
- Mask-only erasure guard (skip maskless callers) — forfeits fail-closed property against unpatched clients; deliberately not chosen (design.md §3, lines 158-160)
- Merge-by-default `update` + in-band clear sentinel (e.g. `entry_rule: "__CLEAR__"`) — zero proto change, but rejected because an unauditable sentinel embedded in a JSON-rule string field could collide with legitimate rule content (design.md §Rejected Alternatives, lines 161-163)
**Scars & gotchas**:
- Existing `TestManageStrategy` UPDATE tests drove `AsyncMock` repos whose `HasField("update_mask")` on a `MagicMock` returns truthy — every pre-existing test would have silently taken the new partial-merge path without exercising it; had to become a real proto (context.md:170-171)
- A stubbed `_validate_definition_proto` had masked an invalid `entry_rule="y"` (not JSON) in old tests; the new path validates the real merged definition, forcing the fake to become realistic (context.md:172-174)
- Formula-output prefetch must span the **union** of stored+request components since the merged set isn't known until inside the row lock, where I/O is forbidden (context.md:151-155)
**Permanent deviations**: - design said maskless UPDATE stays byte-identical -> shipped that, **plus** a new narrowing: maskless full-replace can no longer silently drop a rule (erasure guard now fires even without a mask) -> because the guard can't distinguish the incident pattern from intentional replace; pinned by `test_maskless_replace_cannot_silently_drop_a_rule` (context.md:161-166, design.md §3)
**Cross-feature signal**: A client that unconditionally fabricates full-payload defaults (Python `components or []`, blank rules) is a **co-cause**, not just a victim, of a server-side data-loss bug — a merge fix alone is insufficient when the caller can't express "omitted." (context.md, feature.md:19,35-41)
**Deferred follow-ons**:
- `e2e/mock-backend.ts` `manageStrategy` still echoes `req.definition` with no merge modeling — no UI-side partial-update assertion possible until changed; its `getStrategy` inline literal remains uncentralized (`e2e/fixtures/INVENTORY.md:49`, C-12) (context.md:223-225)
- `scripts/integration-test.sh` is stale (posts to removed Connect-HTTP 80xx paths) and wired into no CI workflow; AC-1 end-to-end coverage today is layered tool+client+servicer tests only (context.md:207-213)
**Ledger entries written**: insights.md (2), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none — atomicity (`SELECT…FOR UPDATE` in one transaction, F-06 pool budget) and "persist what you validated" (`MessageToDict(merged)` not raw dict) are design-doc-recoverable, not standalone runtime invariants.
**Pruned artifacts**: product-spec.md, recon.md, design.md — last present at f871138.
