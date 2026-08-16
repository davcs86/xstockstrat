# Context: fix-mcp-target-user-authz  (archived 2026-08-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-16 — /sdd-archiver

**What**: SEV-2 broken-access-control bug fix. `emit_alert` and `manage_formula` accepted caller-supplied user-identity params (`target_user_id`, `formula_author_user_id`, `author`) forwarded verbatim to backend with no validation against the OAuth-authenticated caller. Three params removed; identity now derived from verified OAuth claims via new shared `_require_claims`/`_caller_user_id` helpers. `emit_alert` gained a required `broadcast: bool` (no default) to preserve broadcast capability without restoring the caller-addressable-other-user vulnerability. All 7 steps executed on harness-pinned branch `claude/remove-target-user-mcp-g4tfqm`.

**Why (irrecoverable rationale)**: `broadcast` made required with no default — not defaulting to broadcast-on (re-ships the defect shape) and not hard-flipping to `False` (silently narrows delivery for undiscovered legitimate broadcast callers). Required param fails loudly at schema level. `author` from `manage_formula` folded in because `servicer.py:215-216` accepted `request.author` verbatim, enabling `author="system"` impersonation of `SYSTEM_AUTHOR` — same `_caller_user_id` call, zero extra cost. Two thin single-purpose wrappers chosen over a merged `_caller_identity(ctx) -> tuple` because no caller needs both values in one call. `ingest_signal`'s internal auto-alert (`app/tools.py:284-291`) calls `client.emit_alert(...)` directly, bypasses the MCP tool, hardcodes `target_user_id=""` — intentional system broadcast, must not be treated as a gap.

**Rejected alternatives**: Keep `target_user_id` with server-side validation (same bad shape). Gate `broadcast=True` behind ADMIN scope (out of scope per feature 092 ruling — worth a follow-up `/sdd-story` if a reviewer wants least-privilege on the broadcast path specifically; the shipped code intentionally leaves `broadcast=True` ungated — a future agent must not treat this as an overlooked security gap). Hard-flip `broadcast: bool = False` (silent narrowing). Defer `author` to follow-up (live hole, trivial fix). Merge helpers into a tuple return (no caller needs both).

**Scars & gotchas**: `notify`'s `EmitAlertRequest.target_user_id=""` is the broadcast sentinel — empty string = broadcast to all users. `_caller_user_id` raises (not returns `""`) when claims `user_id` is falsy to avoid accidental broadcast. Proto doc comment on `RegisterFormulaRequest.author` stated "set by BFF from JWT claims; stored immutably" but MCP tool accepted it as free text — proto comments are not enforced by compiler or CI. `context-scrubber` unavailable at execute time; Teardown scan over `docs/runbooks/mcp-tools.md` not run — should be run in a follow-up session. `broadcast: bool` with no default is a mandatory schema change that breaks any existing MCP client currently calling `emit_alert` without a `broadcast` argument; the rationale (avoiding both re-ship of defect and silent narrowing) lives only in this synthesis.

**Open risks (accepted, irrecoverable from code)**: Absence-of-evidence risk for non-Streamable-HTTP callers of `emit_alert` or `manage_formula` — recon was exhaustive within the known codebase; blast radius on unknown external callers is not enumerable. Admin-gating `broadcast=True` explicitly rejected per feature 092 ruling — the shipped code carries an ungated required parameter with no comment explaining why; a future agent encountering this must not treat it as a security gap.

**Permanent deviations**: `broadcast` placed before `source_service: str = "xstockstrat-agent"` due to Python syntax constraint (non-default before default) — ordering differs from design.md but semantically identical.

**Cross-feature signal**: Feature 092 deliberately left non-MCP callers of EmitAlert ungated at the RPC level — this boundary is load-bearing and must be preserved if anyone revisits EmitAlert gating. Any future incremental auth fix should audit all identity-shaped parameters in the same service simultaneously in the same PR.

**Deferred follow-ons**: `/context-scrubber scan` over `docs/runbooks/mcp-tools.md` (Teardown rule — run in next available session). Possible follow-up `/sdd-story` to admin-gate `broadcast=True` for least-privilege.

**Ledger entries written**: insights.md (3), fails.md (3) — see the 2026-08-16 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: AGENT-1 (`EmitAlertRequest.target_user_id=""` is broadcast sentinel — empty string = broadcast to all users; non-obvious trap for any code populating this field from a fallible lookup); AGENT-2 (`ingest_signal`'s auto-alert path at `app/tools.py:284-291` calls `client.emit_alert(...)` directly, bypassing MCP tool, hardcodes `target_user_id=""`; broadcast-control audits must not miss this call site).

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at e91d40029e7d114e5d52c8c6d2ebdf9ea357a9fc.
