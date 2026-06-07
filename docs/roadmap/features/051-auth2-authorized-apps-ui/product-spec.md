# Product Spec: auth2-authorized-apps-ui

**Created**: 2026-06-07
**Last re-scoped**: 2026-06-07 (UI-only → full per-user authorized-app management; see context.md)

---

## Problem Statement

Feature `049-unify-admin-auth-gates` (Part B — which supersedes `018-agent-mcp-oauth`) makes `xstockstrat-agent` a fully OAuth 2.1 remote MCP server (RFC 9728/8414 discovery, RFC 7591 dynamic client registration, PKCE, audience-bound JWTs + rotating refresh tokens, login delegated to the UI). But once an operator grants Claude.ai (or any DCR-registered client) access, that grant is **fire-and-forget**: there is **no way to see which apps have access, when they last used it, or to revoke them**. 049 deliberately shipped no list and no revocation (RFC 7009 deferred). An operator cannot answer "what currently has access to my trading agent, and how do I cut it off?" — a basic security-hygiene need for an outward-facing OAuth resource.

**This feature exists precisely to close that gap.** "My Authorized Apps" is a per-user management surface: list the apps *I* authorized, inspect them, and **disconnect** any of them — plus connect a new one. (The copy-the-URL "connect" flow is the secondary *add / empty-state* affordance, not the point of the page.)

**Relationship to 049:** this feature **extends 049's identity OAuth backend** — it adds the read/revoke RPCs and the user↔client association that 049 did not build. It therefore depends on 049 Part B merging first and touches the same identity OAuth schema.

## User Story

As an operator, I want a "My Authorized Apps" page that lists the external apps I've authorized to access the xstockstrat MCP agent — with the ability to audit and revoke each, and to connect a new one — so that I can review and control external access to my trading agent from my own web app.

## Functional Requirements

FR-1. `xstockstrat-ui` adds a **new "Accounts" segment** with a **"My Authorized Apps"** page (route `/accounts/authorized-apps`), reachable from the existing authenticated navigation, alongside the existing `/trader`, `/insights`, `/config-ui` segments.

FR-2. **List (per-user).** The page lists the OAuth apps the **currently authenticated user** has authorized against the agent. Each entry shows: app/client display name, a stable client identifier, when it was authorized, and (best-effort) when it was last used. The list is scoped to the caller's `x-user-id` and reflects only apps that user authorized.

FR-3. **Per-user isolation (server-enforced).** Listing and revocation are scoped to the caller in `xstockstrat-identity` itself (queries filtered by `user_id`), not merely filtered in the UI. A user can never see or revoke another user's authorized apps (no IDOR via a forged `client_id`).

FR-4. **Revoke / disconnect.** Each entry has a "Disconnect" action (with a confirmation step) that revokes that app's access by **invalidating its refresh token(s)** for that user in identity. The app's short-lived access JWT then expires naturally (no new access token can be minted because the refresh token is gone). After revoke, the app no longer appears in the user's list.

FR-5. **Connect a new app (add / empty state).** The page provides a "Connect a new app" affordance: the agent's MCP server URL as a read-only **copy-to-clipboard** field plus brief instructions to add it in Claude.ai under **Settings → Connectors → Add custom connector** (paste URL; Claude.ai drives the OAuth 2.1 consent). There is **no in-app deep-link/button** — Claude.ai has no documented param to pre-fill a custom MCP URL.

FR-6. **New additive identity gRPC RPCs.** `xstockstrat-identity` exposes (additively, in `packages/proto/identity/v1/identity.proto`):
  - `ListAuthorizedApps` — returns the authorized apps for a user.
  - `RevokeAuthorizedApp` — revokes a (user, client) grant by invalidating its refresh token(s).
  These are consumed by the `xstockstrat-ui` **BFF** (server-side), which forwards `x-user-id` / `x-access-scope` / `x-trace-id` per `docs/patterns/header-propagation.md`. No browser-direct gRPC.

FR-7. **No secrets rendered.** The page and the list/revoke responses render only non-sensitive metadata (app name, client_id, timestamps, redirect URIs). They MUST NOT expose API keys, JWTs, refresh tokens, client secrets, or `code_verifier`/`code_challenge` values (per `xstockstrat-ui` review focus + identity review focus).

FR-8. **Auth-gated.** The page is behind the existing `xstockstrat-ui` JWT auth/middleware; unauthenticated users are redirected to login. The new `/accounts` segment is added to the protected-route matcher.

FR-9. **Agent URL from config.** The connect URL (FR-5) is sourced from the env var **`AGENT_PUBLIC_URL`** established by feature 049 (FR-B2/FR-B12) — not hardcoded. (No `_ENDPOINT` suffix: this is a browser-facing HTTPS URL, not a gRPC `host:port`.)

FR-10. **Connection health indicator.** The connect section shows a reachable/unreachable status for the agent's OAuth discovery endpoint via a **UI BFF route** that probes `${AGENT_PUBLIC_URL}/.well-known/oauth-protected-resource` server-side (avoids browser CORS). The probe returns only reachability/status (no payload), and failures degrade gracefully (the URL is still shown and copyable).

## Out of Scope

- Building the OAuth 2.1 grant/consent flow itself (delivered by `049-unify-admin-auth-gates` Part B). This feature consumes and extends it.
- **Immediate, hard revocation of in-flight access JWTs (full RFC 7009 + denylist).** Revoke here invalidates refresh tokens; an already-issued access JWT remains valid until it expires (short TTL, per 049). A `jti` denylist / instant-kill is a possible follow-up.
- **Admin/cross-user views** (an admin seeing or revoking *other* users' authorized apps) — this feature is strictly per-user ("My"). Could be a follow-up once a multi-user/role model is needed.
- **Editing client registrations** (rename, change redirect URIs, rotate). View + revoke + connect only.
- The OAuth login-delegation page `/auth/oauth-login` and the unified login page (delivered by `049` / `019`).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` (Next.js) — new `/accounts` segment + "My Authorized Apps" page; BFF routes calling identity's `ListAuthorizedApps`/`RevokeAuthorizedApp` (header propagation) and the agent discovery health probe; copy-URL connect affordance.
- `xstockstrat-identity` (Node.js) — implements the new `ListAuthorizedApps`/`RevokeAuthorizedApp` RPCs with per-user scoping; refresh-token invalidation for revoke; user↔client association needed to list/scope (extends 049's OAuth schema).
- `packages/proto` — additive `identity/v1/identity.proto` RPCs + messages.

## Proto Contract Changes

Additive, non-breaking, in `packages/proto/identity/v1/identity.proto`:
- `ListAuthorizedApps(ListAuthorizedAppsRequest{ user_id }) → ListAuthorizedAppsResponse{ repeated AuthorizedApp apps }`
- `RevokeAuthorizedApp(RevokeAuthorizedAppRequest{ user_id, client_id }) → RevokeAuthorizedAppResponse{ }`
- `message AuthorizedApp { client_id, client_name, authorized_at, last_used_at, repeated redirect_uris }`
- New field numbers only; no existing field/RPC changed or renumbered. Run `./scripts/buf-gen.sh`; `buf lint` + `buf breaking` must pass (additive → non-breaking). Exact field numbers fixed at `/sdd-spec`.
- Approval: identity owner + proto reviewer (additive — not the 2-owner+lead breaking path).

## Config Key Changes

- [x] No new config keys — reuses env var `AGENT_PUBLIC_URL` (from feature 049) for the connect URL / health probe.

## Database Changes

Identity migration (golang-migrate; `services/xstockstrat-identity/migrations/NNN_*.up.sql` + `.down.sql`), NNN-sequenced **after 049's `003_oauth`** (i.e. likely `004`; confirm against the merged 049 + `merge-order.md` at `/sdd-spec` to avoid a number collision). Purpose: associate OAuth refresh tokens with the **(user_id, client_id)** pair so per-user listing (FR-2/FR-3) and per-app revoke (FR-4) work, and (best-effort) track `last_used_at`. Exact shape — add a `client_id` (and `last_used_at`) column to the existing `identity.refresh_tokens`, vs. a small join/index — is decided at `/sdd-spec` against 049's `003_oauth` schema. Never edit an applied migration; this is a new numbered one. Up+down pair required. DBA + identity owner review.

## Feature Workflow Notes

Branch to create: `feature/auth2-authorized-apps-ui` (branch from `main-dev`).
**Hard dependency:** `049-unify-admin-auth-gates` Part B must merge first (provides the OAuth backend, `oauth_clients`/`oauth_auth_codes`/`refresh_tokens` schema, `AGENT_PUBLIC_URL`); this feature **extends** that schema and adds RPCs to it. Add a blocking row to `docs/roadmap/features/merge-order.md` at `/sdd-spec`.
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval each — `xstockstrat-ui` and `xstockstrat-identity`
- [x] Additive proto change → identity owner + proto reviewer (`buf breaking` must pass)
- [x] DB migration (identity `00N_*`) → DBA + identity owner
- [x] Security review — revocation correctness, per-user isolation / IDOR, no secret/token exposure in list responses, refresh-token invalidation semantics

## Acceptance Criteria

1. An authenticated user navigating to `/accounts/authorized-apps` sees a list of the apps they have authorized against the agent, each with name, client identifier, authorized-at, and (when available) last-used.
2. The list is per-user: user A never sees user B's authorized apps; a `RevokeAuthorizedApp` call with another user's `client_id` is rejected/no-ops server-side (no IDOR).
3. "Disconnect" on an app revokes its refresh token(s) for that user; afterwards the app is gone from the list, and the app can no longer mint a new access token via refresh (verified against identity).
4. The "Connect a new app" section shows the `AGENT_PUBLIC_URL`-derived MCP server URL (not hardcoded) with one-click copy and Claude.ai instructions; renders no API keys/tokens/secrets.
5. The connect section shows a reachable/unreachable indicator from a BFF probe of `${AGENT_PUBLIC_URL}/.well-known/oauth-protected-resource`, degrading gracefully on probe failure.
6. `/accounts/*` is unreachable without authentication (redirects to login).
7. `buf lint` + `buf breaking` pass for the additive identity proto changes; the identity migration applies cleanly up and down via `scripts/db-migrate.sh`.

## Open Questions

- [x] Should listing/auditing/revoking be in scope? **Resolved (user, 2026-06-07):** yes — it is the core purpose of this page (this corrected the earlier UI-only framing).
- [x] Per-user vs single shared operator list? **Resolved (user, 2026-06-07):** per-user ("My" = the caller's own apps), server-enforced in identity (FR-3).
- [x] Revoke depth? **Resolved (user, 2026-06-07):** refresh-token revoke reusing 049 infra; in-flight access JWT expires naturally. Immediate JWT denylist is out of scope / follow-up.
- [x] Where does the backend live? **Resolved (user, 2026-06-07):** folded into 051 (identity RPCs + migration + UI in one feature).
- [x] Agent URL source / nav placement / health probe? **Resolved earlier:** reuse `AGENT_PUBLIC_URL`; new "Accounts" segment; include BFF health probe.
- [x] **/sdd-spec detail (approach decided; exact shape deferred):** the `identity` schema will associate refresh tokens with `(user_id, client_id)` + `last_used_at`; the exact column/table form and migration number are resolved against the merged 049 `003_oauth` schema at `/sdd-spec`.
- [x] **/sdd-spec detail:** `/sdd-spec` confirms 049 persists enough to derive "authorized apps for a user" (refresh tokens carry/can carry `user_id` + `client_id`); if not, the migration adds the linkage (already accounted for in Database Changes).
