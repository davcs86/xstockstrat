# Context: fix-mcp-writepath-authz  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped exactly as designed — `TriggerBackfill` gated admin-only, `EmitAlert` left as an explicit internal-caller contract, and the four hardcoded-admin MCP tools flipped to caller-derived scope with `_admin_metadata()` deleted. The one execute-time addition beyond design was a shared `_caller_access_scope(ctx, tool)` helper that also absorbed `set_config`'s own inline logic (context.md:133-136).
**Why (irrecoverable rationale)**: Design rationale for the EmitAlert/orphaned-function calls is already captured — [DUP: docs/roadmap/ledger/insights.md:487].
**Rejected alternatives**: Already captured — [DUP: docs/roadmap/ledger/insights.md:488-499] (EmitAlert admin gate, `x-mcp-secret` enforcement, leaving `_admin_metadata()` dead).
**Scars & gotchas**:
- Notify's compile-first test-harness switch (the 074-trap fix) wasn't just theoretical hygiene — it immediately caught a real, previously-invisible type error that the old strip-types test mode had silently let through (context.md:131-132).
- Deleting `_admin_metadata()` required a `grep -rn` absence-check first — two set_config comments, a docstring, and two test files still referenced it and would have broken collection if deleted blind (design.md:29-35, context.md:136).
- The Step 6 docs update touched `docs/context-constitution.md`/CLAUDE.md files (AGENT-3/AGENT-4 re-forge, 3 service CLAUDE.md, mcp-tools.md), which per root CLAUDE.md's Teardown rule mandates a `/context-scrubber scan` before push — but the context-forge plugin was unavailable in the execute session, so the scan was never run and was only noted in the PR instead of silently skipped (context.md:148-149). This launch's doc updates have no recorded scrubber pass.
**Permanent deviations**: - design said "mirror `set_config`'s inline claims-derivation for each of the 4 flipped tools" (design.md:21-27) -> shipped added a shared `_caller_access_scope(ctx, tool)` helper and *also refactored `set_config` itself* onto it (context.md:133-136) -> because inlining the claims block 5× would have violated the repo's DRY guard rail once the pattern reached 5 call sites.
**Cross-feature signal**: - Confirms a reusable diagnostic: when a hardcoded elevated credential is found on a "sensitive" RPC, the fix scope should include auditing whether other tools mirroring the same template can be unified once the copy count crosses a DRY threshold — don't stop at literal design-doc parity if it leaves near-duplicate blocks.
**Deferred follow-ons**: - Run `/context-scrubber scan` against 092's doc touches (AGENT-3/AGENT-4 re-forge, ingest/notify/agent CLAUDE.md, mcp-tools.md) once the context-forge plugin is available — it was never executed for this launch (context.md:148-149).
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none (AGENT-3/AGENT-4 re-forge and F-11 closure already in `docs/context-constitution.md`/findings per context.md:143-149).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
