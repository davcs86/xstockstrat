# Context: strategy-creation-flow  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped a 5-step wizard (`/insights/strategies/new`, `.../[id]/edit`) plus list/detail admin actions (New/Edit/Deactivate, live-eval toggle), giving the UI parity with the `manage_strategy`/`manage_formula`/`set_strategy_live` MCP tools. All backend RPCs already existed (from features 003/047/048); this was purely a UI+BFF feature — no proto/DB/config changes (context.md:130-141).
**Why (irrecoverable rationale)**: The insights BFF's admin-gate for `manageStrategy`/`setStrategyLive` was ported verbatim from `traderBff.ts`'s existing `ADMIN_BIT = 0x04`/`PermissionDenied` pattern rather than invented fresh, specifically because that pattern already proxied `listStrategyDefinitions`+`setStrategyLive` (context.md:19-20, 134). Wizard UX (5 gated steps, no submit until step 5) was added mid-spec after the original single-form design was rejected in favor of matching the MCP tool's staged validation flow (context.md:159-168).
**Rejected alternatives**:
- Single-form strategy creation — replaced by 5-step wizard for parity with staged validation UX (context.md:159-168, product-spec.md:90-97 Decision row 1-3).
- Client-side component count cap — rejected, backend validation only (product-spec.md:96).
**Scars & gotchas**:
- `insightsBff.ts`'s `dispatchConnect` was silently swallowing downstream gRPC validation errors into a generic "HTTP 400" because a leaked `application/grpc+proto` content-type masked the real message; only surfaced while writing the AC-13 E2E test (context.md:114-128). Root cause was in shared BFF error-passthrough plumbing, not this feature's new code — worth checking other BFF proxies (trader/config-ui) for the same leak.
- `connectClients.ts`'s `ingestClient` export was assumed to need adding per spec, but was already exported (`connectClients.ts:36`) — spec's conditional-edit step correctly avoided a needless diff (context.md:22-24).
**Permanent deviations**: - design/spec said only add new proxy methods to `insightsBff.ts` → shipped that **plus** an unplanned fix to `dispatchConnect`'s content-type handling → because the real gRPC error message was required for AC-13 test-writing to expose the bug at all; user approved as "Option A" (context.md:123-126).
**Cross-feature signal**: - Confirmed merge-order dependency chain 003 (formula-mgmt) → 047 (strategy-engine) → 048 (live-alert-engine) → 050 held with zero rework needed at execute time (context.md:157) — validates that /sdd-review's merge-order gate accurately predicted integration risk here.
**Deferred follow-ons**: - None recorded.
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f871138.
