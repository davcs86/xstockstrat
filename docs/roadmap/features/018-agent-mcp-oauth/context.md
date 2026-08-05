# Context: agent-mcp-oauth  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: This feature designed OAuth 2.0 Authorization Code + PKCE endpoints for `xstockstrat-agent` so Claude.ai's "Connect apps" could authenticate without raw API keys in URLs, and got as far as a reviewed 7-step implementation spec — but was never executed. It was superseded before any code landed and its reusable design decisions were folded into feature 049 as full OAuth 2.1 (context.md session 2026-06-06).
**Why (irrecoverable rationale)**: Spawned mid-execution of 009-agent-mcp-server (Step 9) when an operator asked how MCP auth works; the `?api_key=` fallback was a quick patch pushed onto that PR, while OAuth was deliberately carved out as a separate feature rather than scope-creeping 009 (context.md:12-14, 2026-05-25 sdd-story session).
**Rejected alternatives**:
- Unified login page shared across all frontends — deferred to 019-unified-login-page to keep scope to the OAuth flow itself (context.md:23, OQ-1).
- Redis/DB-backed authorization-code store — rejected for an in-memory module-level singleton dict, safe only because `instance_count: 1`; flagged as needing revisit if the agent ever scales out (context.md:24, OQ-2).
**Scars & gotchas**:
None from execution — never ran. Two design-time gotchas: (1) by /sdd-spec time (2026-05-25) identity had no login UI at all, forcing the agent to serve its own login form and POST to identity's HTTP endpoint (context.md:30-32) — invalidated by feature 045 before implementation started. (2) The product-spec review (context.md:21, 2026-05-25 sdd-review session) warned FR-9 conflated two distinct tokens — the short-lived credential identity would hand back on a redirect to an agent callback vs. the separate OAuth code the agent issues to its client — and recommended clarifying via a `/oauth/callback` two-hop relay. What actually got spec'd diverged from that guidance: implementation-spec.md Step 2 (lines 185-197) has identity's `AuthenticateUser` return an `access_token` synchronously inside the agent's own `POST /oauth/authorize` handler (no redirect-relay hop at all), then immediately calls `CreateApiKey` in the same request. The review's suggested shape was never built — a case where reviewer guidance was flagged but the impl-spec author chose a simpler single-hop design instead, without a recorded reason why.

**Permanent deviations**: none — nothing shipped.
**Cross-feature signal**: A fully-reviewed, implementation-ready spec can go stale from unrelated platform migrations (045's nginx/HTTP-port removal) before execution. Reusable pieces (PKCE S256, access-token-is-the-API-key, in-memory ≤60s code store) survived into 049 Part B; transport-layer assumptions (nginx, `IDENTITY_HTTP_ENDPOINT`, 80xx) did not.
**Deferred follow-ons**: Full MCP OAuth 2.1 → 049-unify-admin-auth-gates Part B. Unified login page → 019-unified-login-page. Redis/DB code store → not yet scheduled.
**Failure post-mortem**: Not a design failure — overtaken by scope consolidation. Root cause: spec predated 045's nginx removal/gRPC-only migration; by 2026-06-06 its core assumptions no longer existed (context.md:50-52). Missed signal: ~6-week gap between spec-ready and execution let a major migration land unnoticed — no automated staleness check exists between "implementation-ready" and execution start.
**Ledger entries written**: insights.md (1), fails.md (2) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f5abed5.
