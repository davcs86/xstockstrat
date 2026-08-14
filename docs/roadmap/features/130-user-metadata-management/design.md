# Design: user-metadata-management

**Created**: 2026-08-14
**Rounds**: 3 (quick; termination: approved)
**Approved by**: user @ 2026-08-14
**Grounded in**: recon.md

---

## Chosen Approach

### Proto & RPCs

Add two RPCs to `IdentityService` in `packages/proto/identity/v1/identity.proto:9-27`:

- **`GetUserMetadata`** — takes an empty request; identity handler reads caller from `x-user-id` gRPC
  metadata. Returns `UserMetadata` message with `user_id` (string), `email` (string), `phone`
  (optional string), `display_name` (optional string), `metadata` (google.protobuf.Struct),
  `metadata_updated_at` (google.protobuf.Timestamp).
- **`UpdateUserMetadata`** — request carries `optional string phone`, `optional string display_name`,
  `optional google.protobuf.Struct metadata`. **No email field** — email is read-only in all
  consumers (login credential; editing without re-auth is a security gap). Identity handler reads
  caller from `x-user-id` gRPC metadata. Returns the updated `UserMetadata`.

Proto `optional` keyword enables presence tracking: ts-proto yields `undefined` for absent fields
(partial update semantics — only provided fields are SET). Recon trap at `recon.md:86`: handlers
read camelCase (`call.request.displayName`, not `call.request.display_name`).

### Migration

`006_user_metadata.{up,down}.sql` in `services/xstockstrat-identity/migrations/` (next after
`005_drop_api_keys` per `recon.md:19`). Adds to `identity.users`:

- `phone TEXT`
- `display_name TEXT`
- `metadata JSONB NOT NULL DEFAULT '{}'` with `CHECK (octet_length(metadata::text) <= 8192)`
- `metadata_updated_at TIMESTAMPTZ`

Does NOT add `email` — already `TEXT NOT NULL UNIQUE` from migration 001 (`recon.md:21`).

### Identity Service Handlers

Implement `getUserMetadata` and `updateUserMetadata` in `identityServiceImpl.ts:22` (class
`IdentityServiceImpl`). Both handlers:

1. Extract caller via `userIdFrom(call.metadata)` — a new `src/grpc/authz.ts` module replicating
   the `first(md, key)` + `userIdFrom(md)` accessor pattern from `xstockstrat-config`'s
   `services/xstockstrat-config/src/grpc/authz.ts:34,51`.
2. Runtime guard: `if (!call.metadata?.get)` → `callback({ code: 13, message: 'missing metadata' })`.
   This is the first use of `call.metadata` in the identity service (all existing handlers use
   `call.request.*` with `call: any` typing).
3. JSDoc at the top of both methods documenting the pattern fork: "Unlike listAuthorizedApps/
   revokeAuthorizedApp (which accept userId in the request body), this RPC derives the caller from
   the propagated x-user-id metadata header (C-03). New identity RPCs should follow this pattern."

`getUserMetadata`: queries `SELECT user_id, email, phone, display_name, metadata,
metadata_updated_at FROM identity.users WHERE user_id = $1`, returns NOT_FOUND (code 5) if absent.
Pattern: `listAuthorizedApps` at `identityServiceImpl.ts:461-492`.

`updateUserMetadata`: builds dynamic SET clause from non-undefined optional fields, always sets
`metadata_updated_at = NOW()`. General errors map to code 13. Pattern: existing error handling
throughout `identityServiceImpl.ts`.

**Smoke test**: verify `getUserMetadata` and `updateUserMetadata` are callable methods on
`IdentityServiceImpl.prototype` (mitigates `as unknown as grpc.UntypedServiceImplementation` cast
at `index.ts:49` that silently masks missing handlers).

**Dual-codegen round-trip test**: partial update (set phone only), read back, assert display_name
unchanged — validates protobuf-es optional presence (BFF sender) and ts-proto undefined semantics
(handler receiver) agree.

### UI — `/accounts/profile`

Place at `/accounts/profile` (not `/config-ui/profile` per product spec FR-6 — deviation justified:
`/accounts` already owns all identity-adjacent surfaces using plain REST routes with `identityClient`
directly; the config-ui BFF router at `configUiBff.ts:15-51` serves only ConfigService +
IngestService and should not mix in IdentityService).

**API route**: `src/app/accounts/api/profile/route.ts` (GET + PUT). Follows the authorized-apps
pattern at `services/xstockstrat-ui/src/app/accounts/api/authorized-apps/route.ts:25-71`:
`getSessionFromRequest(req)` for auth, then `identityClient.getUserMetadata(...)` /
`identityClient.updateUserMetadata(...)` via `connectClients.ts:35`.

**DRY fix**: extract `restBackendHeaders(req, claims)` into `src/lib/restBackendHeaders.ts` using
`HEADER_USER_ID`, `HEADER_ACCESS_SCOPE`, `HEADER_TRACE_ID` from `headers.ts:12-14`. Refactor
existing `authorized-apps/route.ts:11-17` local `backendHeaders` to import from this shared helper
(resolves the documented DRY finding at `context-constitution-findings.md:19`).

**Page**: `src/app/accounts/profile/page.tsx` (client component). Form pattern from
`sources/page.tsx:172` — `useState<FormState>` + `setField` + Card/Input/Button layout. Shows:
`user_id` (read-only), `email` (read-only), `phone` (editable), `display_name` (editable),
`metadata` (JSONB editor, editable).

**Nav registration (C-10(a)):**
- Primary: `NAV_GROUPS[4].items` (Settings group) at `navGroups.tsx:84-92` —
  `{ label: 'Profile', href: '/accounts/profile' }`
- Secondary: `PLATFORM_SUBNAV.accounts` at `PlatformHeader.tsx:90-93` (back-compat with legacy nav)

### Agent Tools (C-14)

Two tools registered via `@server.tool()` at `tools.py:151-153`:

- **`get_user_metadata`** — no parameters. Calls `_caller_user_id(ctx, "get_user_metadata")` at
  `tools.py:107-122`, passes to `client.get_user_metadata(user_id)` which sends `x-user-id` as gRPC
  metadata via `[*_metadata(), ("x-user-id", user_id)]` (same spread shape as 6 existing
  `x-access-scope` call sites at `client.py:451,550,714,859,985,1184`). Returns
  `{ userId, email, phone, displayName, metadata }`.

- **`set_user_metadata`** — optional params: `phone: str | None`, `display_name: str | None`,
  `metadata: dict | None`. Email excluded per user steer. At least one field must be non-None or
  the tool raises. Same metadata forwarding pattern. Returns updated profile.

**Tool count bump**: "twenty-two" → "twenty-four" in 5 locations: `tools.py:4`,
`CLAUDE.md:30`, `mcp-tools.md:3`, `mcp-tools.md:37`, `copilot.ts:14`. Also update
`COPILOT_MCP_TOOL_COUNT` from 18 to 24 (already stale). Update `test_tools_endpoint.py:23-46`
exact set assertion to include both new tool names.

### Consumer Surfaces (C-14)

- **UI**: `/accounts/profile` page in `xstockstrat-ui` — displays read-only user_id + email,
  editable phone + display_name + metadata
- **Agent**: `get_user_metadata` + `set_user_metadata` MCP tools in `xstockstrat-agent`

## Rejected Alternatives

- **`/config-ui/profile`** — rejected because it requires either adding `IdentityService` to the
  config-ui BFF router (cross-service contamination) or creating a standalone REST route that breaks
  the segment's BFF-router convention. `/accounts` already owns identity-adjacent surfaces.
- **Request-body `userId` (matching existing identity RPCs)** — rejected because the user steered to
  C-03 header propagation for self-only enforcement. The metadata approach is architecturally cleaner
  for new RPCs, even though identity is a leaf service with no outbound propagation need.
- **Editable email in `UpdateUserMetadataRequest`** — rejected because email is the authentication
  credential (`WHERE email = $1` at `identityServiceImpl.ts:56`). Allowing mutation without re-auth
  creates a credential-change security gap. If email editing is later wanted, it belongs in a
  dedicated `ChangeEmail` RPC with password confirmation (separate feature).
- **Full BFF Connect-RPC router for `/accounts`** — rejected because `/accounts` has only 3 routes
  (authorized-apps, agent-health, profile); a full BFF is overbuilt for this surface area. The
  plain REST-route pattern matches the segment's existing convention.
- **Duplicate `backendHeaders` in profile route** — rejected because adding a third copy of the
  local `backendHeaders` at `authorized-apps/route.ts:11-17` worsens a documented DRY finding.
  Extracting `restBackendHeaders` resolves it.

## Open Risks

- [ ] **Dual user_id sourcing in identity** — old RPCs (`listAuthorizedApps`, `revokeAuthorizedApp`)
  read userId from `call.request.userId`; new RPCs read from `call.metadata.get('x-user-id')`. Fork
  documented via JSDoc. Future identity RPCs should use the metadata pattern. Consider migrating old
  RPCs in a follow-up feature if this becomes a maintenance burden.
- [ ] **Migration 006 collision** — verify `006` is still free at execute time (ledger trap:
  concurrent features targeting same migration number).
- [ ] **`call: any` typing in identity handlers** — no compile-time safety for `call.metadata`
  access. Runtime guard added, but a future improvement could narrow the type to
  `ServerUnaryCall<Req, Res>`.
- [ ] **Product spec FR-6 deviation** — product spec says `/config-ui/profile`; design uses
  `/accounts/profile`. Deviation justified and user-approved; update product spec at impl-spec time.
- [ ] **Recon BFF guidance superseded** — `recon.md:63` recommends extending `configUiBff.ts` with
  IdentityService handlers. The `/accounts` placement uses REST routes instead. Impl-spec writer
  should follow `authorized-apps/route.ts` pattern, not recon's BFF recommendation.

## Constitution Rules Touched

- `C-01` — honored by: all design claims cite `recon.md` `path:line` evidence from codebase
  discovery; no invented paths or symbols.
- `C-03` — honored by: self-only enforcement uses x-user-id gRPC metadata propagation. Identity
  handler extracts from `call.metadata` (new for identity, established in config service). Agent
  forwards via `[*_metadata(), ("x-user-id", user_id)]` spread pattern.
- `C-07` — honored by: migration `006_user_metadata.{up,down}.sql`, next after `005_drop_api_keys`.
- `C-08` — honored by: smoke test for handler registration, dual-codegen round-trip test, unit tests
  for both handlers.
- `C-09` — honored by: proto step runs `buf lint` + `buf breaking`; `./scripts/buf-gen.sh` after
  `.proto` change.
- `C-10(a)` — honored by: profile page registered in NAV_GROUPS (Settings group, primary) and
  PLATFORM_SUBNAV (secondary/back-compat).
- `C-12` — honored by: UI tests use existing fixtures from `e2e/fixtures/users.ts:9-10`
  (`TEST_USER_ID`, `TEST_USER_EMAIL`).
- `C-14` — honored by: both consumer surfaces (UI `/accounts/profile`, Agent `get_user_metadata` +
  `set_user_metadata`) named, scoped, and designed with implementation steps.
- `F-01` — honored by: new migration 006; no editing of applied migrations.
- `F-06` — honored by: identity service already direct `:25060` with pool max 2; no change to
  connection budget.
- `F-07` — honored by: no hardcoded config values; no new config keys introduced.
