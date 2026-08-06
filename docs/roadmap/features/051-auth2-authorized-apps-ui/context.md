# Context: auth2-authorized-apps-ui  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped a per-user "My Authorized Apps" page (`/accounts/authorized-apps`) that lists, audits, and revokes OAuth clients (e.g. Claude.ai) granted access via feature 049's MCP OAuth backend, plus a copy-URL connect affordance — closing the list/revoke gap 049 deliberately left open (context.md:39, product-spec.md:10-14).
**Why (irrecoverable rationale)**: Started as a UI-only "connect button" story but the user reframed mid-flight: "these exclusions are exactly the reason why this 'My authorized apps' submodule exists at all" — listing/revoking wasn't scope creep, it was the actual point; the copy-URL flow is just the empty-state affordance (context.md:39-41). This forced a spec-ready→draft revert and expanded scope from UI-only to UI+identity+proto+migration in one feature (context.md:37-48).
**Rejected alternatives**:
- In-app Claude.ai deep-link/prefill button — lost because Claude.ai has no documented param to pre-fill a custom MCP URL; copy-URL + instructions was the only viable connect UX (product-spec.md:30, FR-5).
- Immediate/full RFC 7009 JWT denylist on revoke — lost to scope discipline; refresh-token revoke (access JWT expires naturally) was deemed sufficient for this pass, denylist deferred as a follow-up (context.md:44-45, product-spec.md:48).
- Admin/cross-user authorized-apps view — lost because no multi-user/role model existed yet; strictly per-"My" scope (product-spec.md:49).
**Scars & gotchas**:
- 049's `issueRefreshToken(userId)` silently omitted `client_id` on OAuth grants, making OAuth-issued tokens indistinguishable from first-party sessions — `ListAuthorizedApps` would have returned nothing. Missed by the first `/sdd-spec` pass; only caught on re-spec by reading `identityServiceImpl.ts` directly (context.md:109-115, implementation-spec.md:34-42). Rule: when extending prior-feature token/session tables, verify the mint path actually writes the new discriminator column, not just that the column exists.
- Post-merge production bug: `accounts/layout.tsx` is a server component with no dynamic APIs, so Next.js statically prerendered it at `next build` time when `AGENT_PUBLIC_URL` was unset (it's a runtime env, not a build arg) — baked in as `''`, leaving the MCP connector URL field blank in production despite the agent-health probe (a Route Handler, always dynamic) correctly showing "Reachable." Fixed with `export const dynamic = 'force-dynamic'`. CI e2e didn't catch it because Playwright's `webServer.env` sets the var at build time too, masking the bug (context.md:278-287). Rule: any Next.js server component reading a runtime-only env var must force dynamic rendering, and e2e envs that set vars at build time can hide this class of bug.
**Permanent deviations**:
- design said "read `AGENT_PUBLIC_URL` in the layout/page server scope, pass it down, never `NEXT_PUBLIC_*`" (implementation-spec.md:455-456) -> shipped an extra `accounts/AgentUrlContext.tsx` client context provider (`AgentUrlProvider`/`useAgentUrl`) -> because the page is a client component (disconnect/clipboard/health-poll interactivity) so the server value couldn't be read in the same file; user chose this "Option B" pattern at execute time (context.md:235-241, implementation-spec.md:610-619).
- Proto/DB toolchain (buf, PG16, migrate) had to be installed directly on the host mid-execute since Docker wasn't running — treated as a repeatable CI-equivalent fallback, not spec-time knowledge (context.md:159-161, implementation-spec.md:621-640).
**Cross-feature signal**: - Second feature in a row (after 049) to build atop identity's OAuth schema by extending shared mint/rotation code paths rather than adding isolated tables — each such extension needs an explicit regression-guard step (Step 5 re-ran 049's existing OAuth tests) because the edits are non-additive to shared logic (implementation-spec.md:288-293).
**Deferred follow-ons**:
- RFC 7009 immediate JWT denylist/instant-kill revocation (product-spec.md:48).
- Admin/cross-user authorized-apps visibility once a role model exists (product-spec.md:49).
- True per-request "last used" tracking (currently only "last refreshed" on token rotation) — would require a write on every access-token validation, explicitly deferred (implementation-spec.md:258-259).
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f871138.
