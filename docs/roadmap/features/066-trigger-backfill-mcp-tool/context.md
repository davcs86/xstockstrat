# Context: trigger-backfill-mcp-tool  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped as two thin MCP tools (`trigger_backfill` admin-write, `get_backfill_status` dual-mode secret-read) wrapping existing ingest RPCs — no proto/server changes. Built and merged directly on a harness session branch (`claude/custom-indicators-strategies-g38b18`, PR #769) rather than `feature/trigger-backfill-mcp-tool`, per explicit user in-session instruction (feature.md:20-23).
**Why (irrecoverable rationale)**: Two-tool split (not one `operation`-param tool) was chosen because admin-write vs secret-read auth scopes differ per operation and a single tool would blur that structurally (design.md:79-81). `TriggerBackfill` sends the admin scope bit defensively even though ingest enforces no `_has_admin_scope` gate on it server-side today (design.md:44-45, 97-98) — the 50-symbol client cap is the only real mitigation on a cost-incurring op.
**Rejected alternatives**:
- Single `operation`-param tool — lost: scopes differ per op (design.md:79-81).
- Strict timeframe-alias rejection — lost: would re-invite the feature-053 alias mismatch for LLM callers (design.md:82-83).
- Always-list return (no direct `GetBackfillStatus`) — lost: loses direct NOT_FOUND semantics FR-6 requires (design.md:84-85).
- Helper + new site only, leaving the 3 existing inline `list(_metadata()) + [("x-access-scope","7")]` copies unrefactored — lost: DRY guard rail flags the duplication and existing metadata-capture tests already cover the mechanical full refactor; explicitly kept in design.md as a fallback contingency "if step review balks" (design.md:86-88), but the full refactor shipped cleanly at Step 1 with no trouble (context.md:116-121), so this contingency plan left no trace outside design.md.
- Bare job dict — lost: dual top-level shapes force key-sniffing (design.md:89-90).
**Scars & gotchas**:
- Ingest `TriggerBackfill` queues unconditionally — no synchronous `INVALID_ARGUMENT`; bad input surfaces only as a terminal `FAILED` job (context.md:33-34, ingest servicer.py:142-167). Caught during `/sdd-review`; FR-6 was reworded because tests initially assumed sync errors.
- `MessageToDict` serializes int64 proto fields as strings — tests must assert `"0"` not `0` (context.md:127-128).
- `app/client.py` had no top-level `grpc` import; the NOT_FOUND test needed a local `import grpc` (context.md:128).
**Permanent deviations**: none of substance — execute matched design.md exactly (including the full-refactor path over the fallback); only a cosmetic docstring-wording shortening for E501 (context.md:137).
**Cross-feature signal**:
- A user's explicit "run the pipeline and build X" instruction was recorded as standing P-04 sign-off for quick-mode design, skipping a per-gate prompt when no contested tradeoff survived debate synthesis (context.md:61-65, design.md:119-120) — a reusable precedent for future in-session build requests.
- Docs debt compounds silently: `set_strategy_live` was missing a `###` section in `mcp-tools.md` since feature-048; this feature only appended its own two sections and bumped the count, leaving the older gap unfixed (context.md:86-88).
- SDD-process gap: Phase 0 Recon initially surfaced only four required docs-discovery surfaces; the mandated Phase 1 adversarial round (quick mode) caught and added a fifth (`docs/runbooks/historical-backfill.md`) that recon missed entirely (design.md:72, context.md:53). Recon dossiers can under-count discovery surfaces — the adversarial round, not recon alone, is what closes that gap, and this only shows up in the debate transcript, not in the five updated surfaces the shipped docs now show.
**Deferred follow-ons**:
- `xstockstrat-agent` has no Service Owners row in the reviewer registry — still flagged, unresolved (feature.md:51).
- Ingest-side admin-scope gate on `TriggerBackfill` — noted as future work, not built (design.md:97-98).
- Timeframe/status alias tables are manually mirrored from ingest's `_TF_ALIASES`; will drift silently if ingest's map changes (design.md:94-96).
**Ledger entries written**: insights.md (4), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - Candidate `INGEST-*`: `TriggerBackfill` has no server-side admin-scope enforcement (unlike `CancelBackfill`/`ManageSignalSource`); only client-side conventions (admin metadata + 50-symbol cap) currently guard this cost-incurring op — worth a `docs/context-constitution-findings.md` or ingest module entry (design.md:97-98).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
