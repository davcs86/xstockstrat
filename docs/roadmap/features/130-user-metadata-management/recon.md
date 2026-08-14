# Recon: user-metadata-management

**Created**: 2026-08-14
**From**: product-spec.md
**Affected services**: xstockstrat-identity, xstockstrat-ui, xstockstrat-agent, packages/proto

---

## Objective

Add user profile metadata (phone, display_name, JSONB metadata) to the identity service's `users` table, with gRPC RPCs for self-read/self-update, a `/config-ui/profile` UI page, and two MCP agent tools. Admins manage only their own profile in this phase.

## Codebase Map

- **`xstockstrat-identity`** (Node.js/TypeScript)
  - Entry point: `services/xstockstrat-identity/src/index.ts:32-49` (pool setup, gRPC server binding)
  - Handler: `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:22` (class `IdentityServiceImpl`, constructor takes `(pool: Pool, config: ConfigWatcher)`)
  - Method signature: `async methodName(call: any, callback: any)` — request via `call.request.fieldName` (camelCase)
  - Last migration: `005_drop_api_keys.up.sql` → next is `006`
  - Config-read: via `ConfigWatcher` passed to constructor
  - Existing users table: `services/xstockstrat-identity/migrations/001_identity_tables.up.sql:6-13` — columns: `user_id` (UUID PK), `email` (TEXT NOT NULL UNIQUE), `password_hash`, `roles` (TEXT[]), `is_active` (BOOLEAN), `created_at`, `updated_at`
  - Closest analog RPC: `listAuthorizedApps` at `identityServiceImpl.ts:461-492` (takes userId from request, queries DB, returns structured response)
  - Error pattern: `callback({ code: <grpc_code>, message: '...' })` — codes 3/5/13/16
  - Success pattern: `callback(null, { ...responseFields })`
  - Tests: `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts`
  - Header propagation: `src/middleware/propagation.ts` exists but is **unused** (identity is the auth provider, not consumer)

- **`xstockstrat-ui`** (Next.js)
  - Config-UI segment: `services/xstockstrat-ui/src/app/config-ui/` — 3 existing routes: root, `[namespace]`, `audit`, `sources`
  - BFF router: `services/xstockstrat-ui/src/lib/configUiBff.ts:15-51` (creates router, registers `ConfigService` + `IngestService`)
  - BFF route handler: `services/xstockstrat-ui/src/app/config-ui/api/[...connect]/route.ts:1-6`
  - Browser client pattern: `services/xstockstrat-ui/src/lib/browserClients/configClient.ts:1-6` (transport baseUrl `/config-ui/api`)
  - PLATFORM_SUBNAV: `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx:72,85-89` (config entries: Namespaces, Audit Log, Sources)
  - NAV_GROUPS Settings: `services/xstockstrat-ui/src/components/shared/navGroups.tsx:80-93`
  - Identity gRPC client (server-side, already exists): `services/xstockstrat-ui/src/lib/connectClients.ts:35`
  - Auth/session: `services/xstockstrat-ui/src/lib/auth.ts:4-9` (`JwtClaims { user_id, email, roles, issued_at, expires_at }`)
  - BFF shared helpers: `services/xstockstrat-ui/src/lib/bffShared.ts` — `requireSession(ctx):32`, `backendHeaders(claims, ctx):41`, `forward(call):63`, `requireAdminScope(claims):50`, `createBffRouter():82`
  - Best form reference: `services/xstockstrat-ui/src/app/config-ui/sources/page.tsx:172` (full CRUD form with FormState, setField, Card/Input/Button)
  - Mutation hook pattern: `services/xstockstrat-ui/src/app/config-ui/hooks/useSetConfig.ts:8-19`
  - Test fixtures: `services/xstockstrat-ui/e2e/fixtures/users.ts:9-10` (`TEST_USER_ID`, `TEST_USER_EMAIL`)
  - E2E convention: `services/xstockstrat-ui/e2e/config-ui/namespace-nav.spec.ts` (addAuthCookie, goto, expect)

- **`xstockstrat-agent`** (Python)
  - Tool registration: `services/xstockstrat-agent/app/tools.py:151-153` (`register_tools(server)`, `@server.tool()` decorator)
  - Identity client: `services/xstockstrat-agent/app/client.py:26,789-790` (`IDENTITY_ENDPOINT`, `identity_pb2_grpc.IdentityServiceStub`)
  - Caller user_id: `services/xstockstrat-agent/app/tools.py:107-122` (`_caller_user_id(ctx, tool)` — from ASGI scope claims)
  - Caller access_scope: `services/xstockstrat-agent/app/tools.py:95-104` (`_caller_access_scope(ctx, tool)`)
  - Simple tool pattern: `services/xstockstrat-agent/app/tools.py:712-723` (`get_formula` — wraps `client.get_formula()`)
  - Tool count locations (5): `tools.py:4`, `CLAUDE.md:30`, `mcp-tools.md:3`, `mcp-tools.md:37`, `copilot.ts:14`
  - Tool docs: `docs/runbooks/mcp-tools.md` — per-tool heading, parameter table, return shape, error section

- **`packages/proto`**
  - Identity proto: `packages/proto/identity/v1/identity.proto:9-27` — 11 existing RPCs (auth + OAuth), no user metadata RPCs
  - Highest field numbers: `AuthenticateUserRequest:2`, `AuthTokenResponse:4`, `TokenClaims:6`, `OAuthClient:4`, `IssueAuthCodeRequest:5`, `AuthorizedApp:5`, `ListAuthorizedAppsRequest:1`, `RevokeAuthorizedAppRequest:2`

## Patterns to REUSE

- **gRPC handler** → follow `listAuthorizedApps` pattern at `identityServiceImpl.ts:461-492` (userId from request, DB query, callback response)
- **DB query** → reuse `this.pool.query('SQL $1', [param])` pattern used throughout identityServiceImpl.ts
- **BFF routing** → extend `configUiBff.ts:15-51` router with `IdentityService` handlers
- **BFF session/headers** → reuse `requireSession(ctx)` + `backendHeaders(claims, ctx)` from `bffShared.ts:32,41`
- **Browser client** → create `browserClients/identityClient.ts` following `configClient.ts:1-6` pattern
- **Form page** → follow Sources page at `sources/page.tsx:172` (FormState + setField + Card layout)
- **Mutation hook** → follow `useSetConfig.ts:8-19` pattern (useMutation + invalidateQueries)
- **Nav registration** → add to PLATFORM_SUBNAV at `PlatformHeader.tsx:85-89` + NAV_GROUPS at `navGroups.tsx:80-93` (C-10(a))
- **Agent tool** → follow `get_formula` at `tools.py:712-723` + `_caller_user_id` at `tools.py:107-122`
- **Agent client** → extend identity stub usage at `client.py:789-790` with new RPC wrappers
- **Test fixtures** → reuse `users.ts:9-10` (`TEST_USER_ID`, `TEST_USER_EMAIL`) (C-12)
- **E2E auth** → reuse `addAuthCookie` from `e2e/helpers/auth.ts` (C-12)

## Dependencies

- **Proto/RPC**: New RPCs `GetUserMetadata` + `UpdateUserMetadata` on `IdentityService`; new messages `UserMetadata`, `GetUserMetadataRequest`, `GetUserMetadataResponse`, `UpdateUserMetadataRequest`, `UpdateUserMetadataResponse` in `identity.proto`
- **Migration**: next number `006` for `services/xstockstrat-identity/migrations/`
- **Config keys**: none
- **Inter-service edges**: `xstockstrat-ui` → `xstockstrat-identity` (gRPC, already wired via `connectClients.ts:35`); `xstockstrat-agent` → `xstockstrat-identity` (gRPC, already wired via `client.py:26`)
- **New env vars / ports**: none — `IDENTITY_ENDPOINT` already exists in both consumers
- **Tool count update**: 5 locations must be bumped from "twenty-two" to "twenty-four" (+ `COPILOT_MCP_TOOL_COUNT` from 18 to 24, already stale)

## Risks / Not-found

- **PRODUCT-SPEC CORRECTION NEEDED**: `users` table already HAS an `email` column (`TEXT NOT NULL UNIQUE`) from migration 001. FR-1 says to ADD `email` — migration 006 must add only `phone`, `display_name`, `metadata` (JSONB), `metadata_updated_at`. The existing `email` column is already populated (seed user has email).
- **No gRPC metadata extraction in identity service**: identity reads user_id from request fields, not `x-user-id` headers. The new RPCs should follow the same pattern — accept `user_id` in the request, trust the caller (UI BFF validates JWT, agent validates claims).
- **Agent does not forward `x-user-id` outbound**: `_metadata()` returns empty. For self-only tools, the user_id should come from `_caller_user_id(ctx, tool)` and be passed in the request body (matching identity's pattern), not as metadata.
- **No identity browser client for config-ui**: needs creating (`browserClients/identityClient.ts`)
- **Ledger trap — TS camelCase**: proto fields read via camelCase in TS (`call.request.userId`, not `call.request.user_id`) — fails.md fix-mcp-config-key-registry
- **Ledger trap — migration NNN collision**: verify `006` is still free at execute time
- **Ledger trap — nav registration**: new page MUST be in PLATFORM_SUBNAV + NAV_GROUPS (C-10(a), fails.md 060-screener-engine)

## Recommended Scope

1. **Proto** — add `UserMetadata` message, request/response messages, and 2 RPCs to `identity.proto`; run `buf-gen.sh`
2. **Migration** — `006_user_metadata.{up,down}.sql` adding `phone`, `display_name`, `metadata` (JSONB), `metadata_updated_at` to `identity.users`
3. **Identity service** — implement `getUserMetadata` + `updateUserMetadata` handlers in `identityServiceImpl.ts`
4. **Identity tests** — unit tests for both new handlers
5. **UI BFF** — extend `configUiBff.ts` with IdentityService handlers; create `browserClients/identityClient.ts`
6. **UI page** — new `/config-ui/profile` page with form (user_id read-only, email/phone/display_name editable); hooks
7. **UI nav** — register Profile in PLATFORM_SUBNAV + NAV_GROUPS
8. **UI E2E** — profile page e2e test
9. **Agent client** — add `get_user_metadata()` / `update_user_metadata()` to `client.py`
10. **Agent tools** — register `get_user_metadata` / `set_user_metadata` in `tools.py`; update tool count (5 locations)
11. **Agent docs** — add tool sections to `mcp-tools.md`
