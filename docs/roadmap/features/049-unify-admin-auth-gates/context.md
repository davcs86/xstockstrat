# Context: unify-admin-auth-gates  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped as two parts on one branch: Part A unified `ingest`/`indicators`/agent admin gates onto the `x-access-scope & 0x04` model established by 047/048, closing the ungated `RegisterFormula` path; Part B built a full OAuth 2.1 AS/RS facade in the agent with identity as a stateless, durable gRPC-backed token/client store (audience-bound JWT + rotating refresh), superseding the stale feature 018.
**Why (irrecoverable rationale)**: Part B's design pivoted twice mid-SDD: (1) 018 was folded in rather than run standalone because its impl spec predated feature 045 and assumed nginx + HTTP `80xx` ports that no longer exist (context.md, session "re-spec: merge 018", 2026-06-06); (2) the "100% connect" revision replaced a simpler API-key-as-token design with JWT+refresh+audience specifically because Claude.ai's remote-MCP connect flow requires RFC 8707 audience binding and refresh rotation to avoid forced re-consent — an API key alone would connect but violate MUSTs (context.md, "100% connect analysis" session).
**Rejected alternatives**:
- In-memory DCR/code store in the agent (OQ-B/OQ-C) — lost because it pins `instance_count:1`; durable identity-backed store chosen for multi-instance safety (context.md, "OQ-B resolved" session).
- API-key-as-token (OQ-D) — lost to JWT+refresh+audience for RFC 8707 compliance and seamless long sessions (context.md, "100% connect" session).
**Scars & gotchas**:
- `/sse` was registered with Starlette `Route`, which calls raw-ASGI handlers as `f(request)` and crashes (`TypeError`) — only surfaced when Step 21 tests hit it; fixed by switching to `Mount`, matching `/messages`'s pattern (implementation-spec.md:689-693, Deviation Log).
- Initial callback design trusted a pre-login signed `txn` blob plus a forgeable flag for user identity; caught at impl-spec review, then fixed by deriving `user_id` from the same-origin `access_token` cookie validated via identity `ValidateToken` — the earlier premise that UI/agent were cross-origin was simply wrong (context.md, "sdd-review impl-spec" then "resolve callback-handoff advisory" sessions).
- No `buf`/DB/Docker on the execution host — CI-pinned toolchain manually installed and a throwaway `postgres:16` container used to prove migration reversibility (Deviation Log, Steps 6-7, 8).
- Touching the agent tripped pre-existing `ruff` debt (`UP045`, `E501`, `F841`) unrelated to this feature because CI's `ruff` version had drifted; user approved fixing it inline to keep the lint gate green (Deviation Log, Step 12).
**Permanent deviations**: none — final shipped design matches the "100% connect" revision (no further drift at execute time beyond the two scars above).
**Cross-feature signal**: 047/048 set the `x-access-scope` admin-bit pattern; 049 shows the model gets adopted incrementally per service rather than all at once, with documented deliberate exceptions (indicators author-ownership + admin override) instead of forced uniformity.
**Deferred follow-ons**:
- Token revocation (RFC 7009) and OIDC/ID tokens remain out of scope (don't block Claude.ai connect).
- `?api_key=` kept as a deprecated Desktop-only fallback, not removed (OQ-G).
**Ledger entries written**: insights.md (3), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - Starlette `Route` vs `Mount` for raw-ASGI handlers (implementation-spec.md:689-693) — worth a note in agent CLAUDE.md/docs if not already captured there, since it's a generalizable trap for any future raw-ASGI route addition.
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f871138.
