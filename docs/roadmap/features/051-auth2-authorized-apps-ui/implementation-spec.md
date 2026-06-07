# Implementation Spec: auth2-authorized-apps-ui

**Status**: `pending`
**Created**: 2026-06-07 (regenerated 2026-06-07 against merged 049)
**Feature**: `docs/roadmap/features/051-auth2-authorized-apps-ui/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/auth2-authorized-apps-ui`

---

## Dependency status — 049 is now MERGED (re-confirmed at /sdd-spec)

The earlier spec run flagged feature `049-unify-admin-auth-gates` Part B as **not yet merged**.
That is no longer true. Re-verified in `main-dev` at this `/sdd-spec` run (2026-06-07):

- `packages/proto/identity/v1/identity.proto` (read in full, 121 lines) now contains the OAuth 2.1
  RPCs: `RegisterOAuthClient`, `GetOAuthClient`, `IssueAuthCode`, `ExchangeAuthCode`,
  `RefreshOAuthToken` (service block L21-25) plus messages `OAuthClient`, `OAuthTokenResponse`,
  etc. (L77-120). **The service block ends at L25; new RPCs go after it.**
- `services/xstockstrat-identity/migrations/` now ends at **`003_oauth`** (confirmed via `ls`:
  `000_schema`, `001_identity_tables`, `002_seed_admin`, `003_oauth`). `003_oauth.up.sql` creates
  `identity.oauth_clients` (`client_id` PK, `redirect_uris TEXT[]`, `client_name`, `created_at`)
  and `identity.oauth_auth_codes`. **The next free migration number is `004`** (no ambiguity now).
- `identity.refresh_tokens` (`001_identity_tables.up.sql:27-34`) still has columns
  `token_id, user_id, token_hash, expires_at, created_at, revoked_at` — **no `client_id`, no
  `last_used_at`**. 049's OAuth flow reuses `refresh_tokens` but **does not record which OAuth
  client a refresh token belongs to**: `issueRefreshToken(userId)` inserts only `(user_id,
  token_hash, expires_at)` (`identityServiceImpl.ts:332-341`).
- `AGENT_PUBLIC_URL` exists in the deployment files but **only in the `xstockstrat-agent` block**
  (docker-compose L500 `http://localhost:9000`; app.dev.yaml/app.yaml L262 `${APP_URL}/agent`).
  It is **absent from the `xstockstrat-ui` block** (grep over the UI block → no match) and must
  be added there (Step 7).

### Key consequence — refresh tokens are not yet client-tagged

Because 049's `issueRefreshToken(userId)` does **not** store `client_id`, the
`refresh_tokens` table cannot today distinguish an OAuth-client grant from a first-party user
session, and `ListAuthorizedApps` would return nothing. **This feature must (a) add a
`client_id` column [Step 3] AND (b) make the OAuth token-mint paths write it [Step 4]** — the
`exchangeAuthCode` (initial grant) and `refreshOAuthToken` (rotation) paths must propagate the
`client_id` into `issueRefreshToken`. Without (b), the list stays empty. The earlier spec run
missed this; it is now Step 4's primary correctness requirement.

---

## Execution Summary

Proto first (additive list/revoke RPCs + `AuthorizedApp` message after the existing OAuth RPCs),
then regenerate stubs (both the ts-proto `identity.ts` consumed by the identity service and the
protobuf-es `identity_pb.ts` consumed by the UI come from one `buf-gen.sh` run). Then migration
`004` adds `client_id` + `last_used_at` to `refresh_tokens` (FK to `oauth_clients`). Then the
identity service work: tag OAuth refresh tokens with their `client_id` on mint/rotation (so apps
become listable), implement the per-user-scoped `listAuthorizedApps` (JOIN `oauth_clients`) and
IDOR-safe `revokeAuthorizedApp`, plus unit tests. Then the `xstockstrat-ui` work, split into a
server-side data layer and the presentation layer: the BFF routes (list/revoke with header
propagation + agent-health probe + segment health) [Step 6], then the `/accounts` segment + "My
Authorized Apps" page + nav [Step 7], then `AGENT_PUBLIC_URL` wiring into the UI deployment blocks
[Step 8], and E2E covering both UI steps [Step 9]. Docs/merge-order last [Step 10].

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs are generated from the edited `.proto`.
- Step 3 (migration) requires 049's `003_oauth` (merged — `oauth_clients` is the FK target).
- Step 4 (identity service) requires Step 2 (regenerated ts-proto stub exposes the new methods on
  `IdentityServiceService`) and Step 3 (the `client_id` / `last_used_at` columns).
- Step 5 [test] covers Step 4 [service] — identity unit tests (also runs 049's existing OAuth tests
  as a regression guard, since Step 4 edits the shared mint/rotation paths).
- Step 6 (UI BFF routes) requires Step 2 (regenerated `identity_pb.ts` exposes the new methods on
  the protobuf-es `IdentityService` used by `identityClient`).
- Step 7 (UI segment + page + nav) requires Step 6 (the page consumes the BFF routes at runtime).
- Step 8 (UI deployment wiring for `AGENT_PUBLIC_URL`) is required by Step 6's agent-health probe
  and Step 7's connect section at runtime.
- Step 9 [test] covers Steps 6 + 7 [service] — UI E2E.
- Step 10 (docs) last — identity CLAUDE.md update + merge-order note.

---

### Step 1 — proto: Add ListAuthorizedApps / RevokeAuthorizedApp RPCs + AuthorizedApp message

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/identity/v1/identity.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, additive (no field removal/renumber), `buf breaking` passes; `xstockstrat-identity` (service owner) — JWT/refresh-token handling, per-user isolation, no plaintext secrets; `xstockstrat-ui` (service owner) — no secret values rendered in UI (response shape carries only non-sensitive metadata)

**Codebase Evidence**:
- Confirmed via Read of `packages/proto/identity/v1/identity.proto` (full, 121 lines). `IdentityService`
  block now ends at L25 with `rpc RefreshOAuthToken(...)` (049's OAuth RPCs occupy L21-25). New RPCs
  go after L25, before the closing brace at L26.
- Existing OAuth messages end at L120 (`RefreshOAuthTokenRequest`). New messages go at end of file.
- Timestamp style: `google.protobuf.Timestamp` already imported (L7) and used (e.g. `OAuthClient.created_at = 4`, L82). `redirect_uris` already modeled as `repeated string` on `OAuthClient` (L80) — mirror that for `AuthorizedApp.redirect_uris`.
- Request/response pair naming pattern: `message GetOAuthClientRequest { string client_id = 1; }` (L90), `message ListApiKeysResponse { repeated ApiKey keys = 1; }` (L73).
- Per CLAUDE.md Proto Contract Governance: all new fields are open strings/timestamps/repeated — no enum needed; no zero-value sentinel concerns.

**Instructions**:
- Add two RPCs to the `IdentityService` block, after `RefreshOAuthToken` at L25:
  ```
  // Per-user authorized-app management (feature 051) — list/revoke OAuth clients the
  // calling user has granted access to the MCP agent. Additive over 049's OAuth backend.
  rpc ListAuthorizedApps(ListAuthorizedAppsRequest) returns (ListAuthorizedAppsResponse);
  rpc RevokeAuthorizedApp(RevokeAuthorizedAppRequest) returns (RevokeAuthorizedAppResponse);
  ```
- Add the following messages at the end of the file (after L120), mirroring the `OAuthClient`
  timestamp/`repeated string` style:
  ```
  // ── Authorized-apps management (feature 051) ─────────────────────────────────
  message AuthorizedApp {
    string client_id = 1;
    string client_name = 2;
    google.protobuf.Timestamp authorized_at = 3;
    // Best-effort "last refreshed" time (bumped on refresh-token rotation), NOT per-request
    // access. May be unset. The UI labels this "Last refreshed", not "Last used".
    google.protobuf.Timestamp last_used_at = 4;
    repeated string redirect_uris = 5;
  }
  message ListAuthorizedAppsRequest { string user_id = 1; }
  message ListAuthorizedAppsResponse { repeated AuthorizedApp apps = 1; }
  message RevokeAuthorizedAppRequest { string user_id = 1; string client_id = 2; }
  message RevokeAuthorizedAppResponse { bool success = 1; }
  ```
- Field numbers are fresh per-message; no existing field/RPC is changed or renumbered → additive,
  non-breaking. Do NOT add token/secret fields to `AuthorizedApp` (FR-7).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=main-dev"
```
Both must pass (additive change → `buf breaking` reports no breaking changes). `main-dev` is the
canonical breaking-check base per `docs/runbooks/feature-workflow.md`.

---

### Step 2 — proto-gen: Regenerate stubs (Go / Python / TS)

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/ts/identity/v1/identity.ts` — regenerate (ts-proto, grpc-js — consumed by identity service)
- `packages/proto/gen/ts/identity/v1/identity_pb.ts` — regenerate (protobuf-es — consumed by UI)
- `packages/proto/gen/ts/identity/v1/identity_connect.ts` — regenerate (connect-es)
- `packages/proto/gen/go/identity/v1/*` — regenerate
- `packages/proto/gen/python/identity/v1/*` — regenerate

**Reviewers**: Proto Reviewer — field number uniqueness, additive, `buf breaking` passes; `xstockstrat-identity` (service owner); `xstockstrat-ui` (service owner) _(inherited from Step 1)_

**Codebase Evidence**:
- Identity service imports the ts-proto form: `import { IdentityServiceService } from '@xstockstrat/proto/identity/v1/identity'` (`services/xstockstrat-identity/src/index.ts:5`); registered via `grpcServer.addService(IdentityServiceService, ...)` (`src/index.ts:44-47`).
- UI imports the protobuf-es form: `import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb'` (`services/xstockstrat-ui/src/lib/connectClients.ts:5`); `identityClient = createClient(IdentityService, ...)` (L33).
- CLAUDE.md: `./scripts/buf-gen.sh` "generates TypeScript, Python, and Go stubs and compiles the TS package."

**Instructions**:
- Run `./scripts/buf-gen.sh` from the repo root. Commit the proto source (Step 1) and all
  regenerated stubs together in one commit (per `docs/runbooks/proto-versioning.md` and the
  `proto-freshness` CI job).

**Verification**:
```bash
./scripts/buf-gen.sh
git diff --stat packages/proto/gen/   # should show only the new identity RPCs/messages
```
After running, `git diff packages/proto/gen/` must be empty on a second run (stubs current).

---

### Step 3 — migration: Add client_id + last_used_at to refresh_tokens (link to oauth_clients)

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/migrations/004_refresh_token_client.up.sql` — create
- `services/xstockstrat-identity/migrations/004_refresh_token_client.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts vs 049's `003_oauth`), up+down pair present, index correctness, run-order via `scripts/db-migrate.sh`; `xstockstrat-identity` (service owner) — JWT/refresh-token handling, per-user isolation

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-identity/migrations/`: last migration is **`003_oauth`**
  (049). Next free number is **`004`** — no collision (049 is merged; 003 is taken).
- `identity.refresh_tokens` shape confirmed via Read of `001_identity_tables.up.sql:27-34`:
  `token_id UUID PK, user_id UUID FK→users, token_hash TEXT UNIQUE, expires_at, created_at,
  revoked_at`. Existing index `idx_refresh_user ON refresh_tokens (user_id)` (L37).
- FK target `identity.oauth_clients (client_id TEXT PRIMARY KEY)` confirmed via Read of
  `003_oauth.up.sql:7-12` — exists now. `oauth_auth_codes` uses
  `REFERENCES identity.oauth_clients(client_id) ON DELETE CASCADE` (`003_oauth.up.sql:16`) — mirror it.
- `003_oauth.down.sql` drops child-then-parent (`003_oauth.down.sql:5-6`) — the down pattern to follow.
- Naming convention (root CLAUDE.md / feature-workflow): `NNN_description.up.sql` + `.down.sql`,
  NNN continues from the last file. Never edit an applied migration.

**Instructions**:
- `004_refresh_token_client.up.sql`:
  - Add `client_id TEXT` (nullable) referencing `oauth_clients` with cascade:
    `ALTER TABLE identity.refresh_tokens ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES identity.oauth_clients(client_id) ON DELETE CASCADE;`
    `client_id IS NULL` = a first-party user-session token (today's `authenticateUser`/`refreshToken`
    behavior, unchanged); a non-NULL `client_id` = an OAuth-client grant that appears in "My
    Authorized Apps".
  - Add `last_used_at TIMESTAMPTZ` (nullable):
    `ALTER TABLE identity.refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;`
  - Add a partial index for per-(user, client) listing/revoke (FR-2/FR-4):
    `CREATE INDEX IF NOT EXISTS idx_refresh_user_client ON identity.refresh_tokens (user_id, client_id) WHERE client_id IS NOT NULL;`
- `004_refresh_token_client.down.sql` (reverse order):
  `DROP INDEX IF EXISTS identity.idx_refresh_user_client;`
  `ALTER TABLE identity.refresh_tokens DROP COLUMN IF EXISTS last_used_at;`
  `ALTER TABLE identity.refresh_tokens DROP COLUMN IF EXISTS client_id;`
- Up+down pair required.

**Verification**:
```bash
./scripts/db-migrate.sh        # applies 004 up cleanly
```
Confirm the migration applies up and rolls back down without error; `idx_refresh_user_client`
and the two columns exist after up and are gone after down.

---

### Step 4 — service: Tag OAuth refresh tokens with client_id; implement list/revoke (per-user scoped)

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-identity` (service owner) — JWT expiry/rotation, refresh-token invalidation semantics, per-user isolation (no IDOR), never plaintext secrets

**Codebase Evidence**:
- Confirmed via Read of `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` (full, 526 lines).
- **049's refresh-token mint does NOT record `client_id`:** `issueRefreshToken(userId)` (L332-341)
  inserts only `(user_id, token_hash, expires_at)`. It is called by `exchangeAuthCode` (L480, with
  `row.user_id` — the OAuth grant) and `refreshOAuthToken` (L518, with `user_id` — rotation), and
  the new token is never associated with the OAuth `clientId` available in those scopes
  (`exchangeAuthCode` has `clientId` from `call.request` L443; `refreshOAuthToken` has the rotated
  token's row but not its `client_id` — see fix below).
- Per-user-scoped query pattern to mirror: `listApiKeys` (L274-294) filters `WHERE user_id = $1`
  and maps rows to camelCase. IDOR-safe revoke: `revokeApiKey` (L296-304) scopes by **both**
  `key_id` AND `user_id` (`WHERE key_id = $1 AND user_id = $2`, L298).
- Refresh-token invalidation pattern: `revokeToken` (L201-218) does
  `UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`.
- Timestamp encoding rule (L11-20): responses MUST carry `Date` instances; `listApiKeys` maps
  `createdAt: new Date(r.created_at)` (L288).
- Error codes: `code: 3` (INVALID_ARGUMENT) missing args, `code: 13` (INTERNAL) DB error,
  `code: 16` (UNAUTHENTICATED) bad credentials/grant.

**Instructions**:
1. **Make OAuth refresh tokens client-tagged (the listability prerequisite):**
   - Change `issueRefreshToken` (L332) to accept an optional client id:
     `private async issueRefreshToken(userId: string, clientId?: string): Promise<string>` and
     insert it: `INSERT INTO identity.refresh_tokens (user_id, token_hash, expires_at, client_id) VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval, $4)` with param `clientId ?? null`.
     The existing first-party callers (`authenticateUser` L87-91, `refreshToken` L173-177) insert
     inline and pass no `client_id` — leave them as-is (NULL client_id = user session, unchanged).
   - In `exchangeAuthCode` (L480): pass the OAuth client id —
     `const refreshToken = await this.issueRefreshToken(row.user_id, clientId);` (`clientId` from
     `call.request`, L443).
   - In `refreshOAuthToken` (L493-525): the rotation must carry the `client_id` forward. Add
     `rt.client_id` to the SELECT (L499-507), then `await this.issueRefreshToken(user_id, client_id)`
     (L518). Also bump `last_used_at` on rotation: when a row is found, set
     `UPDATE identity.refresh_tokens SET last_used_at = NOW() WHERE token_id = $1` (best-effort,
     before/with the revoke at L511-514) so `ListAuthorizedApps` can surface it. **Semantics:**
     this is a "last refreshed" timestamp (bumped only on refresh-token rotation), **not** a
     per-`/sse`-request access time — the UI labels it accordingly (Step 7). Tracking true
     per-request access is out of scope (would require a write on every access-token validation).
2. **Add `async listAuthorizedApps(call, callback)`:**
   - Read `userId` from `call.request`; if empty → `callback({ code: 3, message: 'userId required' })`.
   - Query distinct OAuth-client grants for that user, JOINing `oauth_clients` for name/redirects:
     ```sql
     SELECT rt.client_id,
            oc.client_name,
            oc.redirect_uris,
            MIN(rt.created_at)   AS authorized_at,
            MAX(rt.last_used_at) AS last_used_at
     FROM identity.refresh_tokens rt
     JOIN identity.oauth_clients oc ON oc.client_id = rt.client_id
     WHERE rt.user_id = $1
       AND rt.client_id IS NOT NULL
       AND rt.revoked_at IS NULL
       AND rt.expires_at > NOW()
     GROUP BY rt.client_id, oc.client_name, oc.redirect_uris
     ```
   - Map: `{ apps: rows.map(r => ({ clientId: r.client_id, clientName: r.client_name ?? r.client_id, authorizedAt: new Date(r.authorized_at), lastUsedAt: r.last_used_at ? new Date(r.last_used_at) : undefined, redirectUris: r.redirect_uris ?? [] })) }`.
     **Render only non-sensitive metadata — never `token_hash` or any secret** (FR-7). Wrap in
     try/catch → `callback({ code: 13, message: err.message })`.
3. **Add `async revokeAuthorizedApp(call, callback)`:**
   - Read `userId` and `clientId`; if either empty → `callback({ code: 3, ... })`.
   - `UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL`
     — scoped by **both** `user_id` and `client_id` (IDOR-safe, mirrors `revokeApiKey` L298). A
     forged/foreign `client_id` matches zero rows (no-op) — never another user's grant (FR-3).
   - `callback(null, { success: true })`; wrap in try/catch → `code: 13` on error.
- These methods read/write only `identity.refresh_tokens` and read `identity.oauth_clients`; they
  make **no new outbound gRPC call**, so §5c header-propagation does not apply to this step.
- **Regression guard (this step edits 049-owned code):** the changes to `issueRefreshToken`,
  `exchangeAuthCode`, and `refreshOAuthToken` are the only non-additive part of this feature. The
  first-party callers (`authenticateUser` L87-91, `refreshToken` L173-177) insert inline and are
  left untouched, so their behavior is unchanged. 049's existing OAuth tests
  (`exchangeAuthCode`/`refreshOAuthToken`, test L271-390) MUST still pass after this change — Step 5
  re-runs the full identity suite to enforce that.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint
```
Plus the behavioral/coverage check in Step 5 (which also re-runs 049's existing OAuth tests as a
regression guard). Lint (`eslint src --ext .ts`) must pass with no errors.

---

### Step 5 — test: Unit tests for client-tagging + listAuthorizedApps / revokeAuthorizedApp

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-identity` (service owner)

**Codebase Evidence**:
- Confirmed via Read of `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts`.
  Tests use `node:test`; `makePool(rows, throws)` (L37-44), `makeImpl(rows)` (L46-51), and
  `makeSpyPool(rows)` (L224-233, records SQL into `queries`) + `implWithPool` (L235-239) for SQL
  assertions. Existing OAuth tests (`exchangeAuthCode`, `refreshOAuthToken`) at L271-390 already
  use `makeSpyPool` and assert on captured SQL (e.g. rotation check L377). `challengeFor` helper L241-243.
- Runner / coverage from `package.json:13`: `test:coverage` =
  `c8 --reporter=text --reporter=lcov --lines 40 node --experimental-strip-types --test src/__tests__/*.test.ts`.
  Threshold = 40% lines. (Note: strip-only import guard at L24-31 — follow the `if (!impl) return;` pattern.)

**Instructions**:
- Add `describe('listAuthorizedApps')`:
  - rejects when `userId` missing → `code: 3`.
  - with `implWithPool(makeSpyPool([{ client_id: 'oauthc_1', client_name: 'Claude.ai', redirect_uris: ['https://claude.ai/cb'], authorized_at: new Date(), last_used_at: null }]))`,
    assert `apps[0].clientId === 'oauthc_1'`, `apps[0].clientName === 'Claude.ai'`,
    `apps[0].lastUsedAt === undefined`, and that **no token/secret field is present** (assert
    `!('tokenHash' in apps[0])`). Assert the captured SQL JOINs `oauth_clients` and filters
    `WHERE rt.user_id` (regex over `pool.queries`).
- Add `describe('revokeAuthorizedApp')`:
  - rejects when `userId` or `clientId` missing → `code: 3`.
  - with `makeSpyPool([])`, assert `success: true` on happy path; assert the captured UPDATE SQL is
    scoped by **both** `user_id` AND `client_id` (regex: `/WHERE user_id = \$1 AND client_id = \$2/`).
- Add a client-tagging assertion to the existing OAuth flow: extend the `exchangeAuthCode` PKCE
  happy-path test (L300-312) to assert the captured INSERT into `refresh_tokens` includes a
  `client_id` column (regex over `pool.queries`: `/INSERT INTO identity\.refresh_tokens[^)]*client_id/`).
- Follow the existing `await new Promise<void>(resolve => impl.method(makeCall(req), cb))` shape and
  the `if (!impl) return;` guard.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage
```
`test:coverage` must pass the `--lines 40` gate; new tests must pass. It runs **all**
`src/__tests__/*.test.ts`, including 049's existing `exchangeAuthCode`/`refreshOAuthToken` tests —
this is the regression guard for Step 4's edits to those shared paths (they must stay green).

---

### Step 6 — service: UI BFF routes (list/revoke + agent-health + segment health)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/api/authorized-apps/route.ts` — create (BFF: list + revoke via identity)
- `services/xstockstrat-ui/src/app/accounts/api/agent-health/route.ts` — create (BFF: probe agent discovery endpoint)
- `services/xstockstrat-ui/src/app/accounts/api/health/route.ts` — create (segment health, mirrors config-ui)
- `services/xstockstrat-ui/src/middleware.ts` — verify only (no change expected — see Evidence)

**Reviewers**: `xstockstrat-ui` (service owner) — Connect-RPC call safety, environment scope correctness, no secret values rendered in UI; Security — per-user IDOR isolation, no token/secret exposure in BFF JSON

**Codebase Evidence**:
- **Middleware already protects `/accounts/*`**: confirmed via Read of `src/middleware.ts:9-14`. The
  matcher is a single negative-lookahead excluding only static assets + public auth routes
  (`api/auth/login`, `api/health`, `health`, `auth/login`, `auth/oauth-login`). Any other path —
  including `/accounts/api/...` — already requires a valid session. **No matcher edit needed**
  (FR-8); the BFF routes also call `getSessionFromRequest` for defense-in-depth + the 401 path.
- BFF auth + header-propagation pattern confirmed via Read of `src/lib/configUiBff.ts`:
  `backendHeaders(claims, ctx)` (L21-27) sets `x-user-id` = `claims.user_id`, `x-access-scope` =
  `String(rolesToAccessScope(claims.roles))`, `x-trace-id` =
  `ctx.requestHeader.get('x-trace-id') ?? generateTraceId()`. Simpler Route-Handler variant confirmed
  via `src/app/config-ui/api/audit/route.ts:17-21`: `getSessionFromRequest(req)` → 401 if no claims.
- `identityClient` (protobuf-es) confirmed in `src/lib/connectClients.ts:33`
  (`createClient(IdentityService, makeTransport(IDENTITY_ENDPOINT))`); after Step 2 it exposes
  `.listAuthorizedApps()` / `.revokeAuthorizedApp()`. Header forwarding via the options object
  `{ headers }` — pattern at `configUiBff.ts:34`. `connectCodeToHttp` exported at
  `connectClients.ts:40` for error→HTTP mapping. `IDENTITY_ENDPOINT` already wired for the UI (no new endpoint var).
- Auth helpers in `src/lib/auth.ts`: `getSessionFromRequest`, `verifyAccessToken`,
  `rolesToAccessScope`, `generateTraceId` (imported in configUiBff.ts:6 and audit/route.ts:3).
- Segment health route shape confirmed via Read of `config-ui/api/health/route.ts`:
  `export async function GET() { return NextResponse.json({ status: 'ok', service: 'xstockstrat-ui/config-ui' }); }`.

**Instructions**:
- **BFF list/revoke (`accounts/api/authorized-apps/route.ts`)**: implement `GET` and `POST` Route
  Handlers. Read the session via `getSessionFromRequest(req)` (→ 401 if none, like audit/route.ts).
  Build propagation headers like `configUiBff.ts:backendHeaders` (`x-user-id` = `claims.user_id`,
  `x-access-scope` = `String(rolesToAccessScope(claims.roles))`, `x-trace-id` =
  `req.headers.get('x-trace-id') ?? generateTraceId()`). `GET` →
  `identityClient.listAuthorizedApps({ userId: claims.user_id }, { headers })`. `POST` (revoke) →
  `identityClient.revokeAuthorizedApp({ userId: claims.user_id, clientId }, { headers })`. **Always
  derive `userId` from the verified session, never from the request body** (FR-3 IDOR). Map Connect
  errors to HTTP via `connectCodeToHttp` (`connectClients.ts:40`). Return only the non-sensitive
  `AuthorizedApp` fields (FR-7).
- **BFF agent health (`accounts/api/agent-health/route.ts`)**: `GET` reads the session (401 if none),
  then server-side `fetch(\`${process.env.AGENT_PUBLIC_URL}/.well-known/oauth-protected-resource\`)`
  and returns `{ reachable: res.ok, status: res.status }` — **no payload** (FR-10). On fetch throw,
  return `{ reachable: false }` with HTTP 200 so the page degrades gracefully.
- **Segment health (`accounts/api/health/route.ts`)**: mirror `config-ui/api/health/route.ts` —
  `return NextResponse.json({ status: 'ok', service: 'xstockstrat-ui/accounts' })`.
- §5c header propagation: the list/revoke BFF adds a **new outbound gRPC call** to identity. It
  forwards `x-user-id`/`x-access-scope`/`x-trace-id` via the `{ headers }` object built exactly like
  `configUiBff.ts:backendHeaders` (L21-27) — cite that as the reused mechanism. The `agent-health`
  call is an outbound HTTPS probe (not a backend gRPC call), so it does not require the three internal headers.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Plus the E2E check in Step 9. Lint = `next lint`. Manually confirm: `GET /accounts/api/authorized-apps`
unauthenticated → 401; authenticated → the user's apps only; no token/secret strings appear in the BFF JSON.

---

### Step 7 — service: UI /accounts segment, My Authorized Apps page, nav

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/layout.tsx` — create
- `services/xstockstrat-ui/src/app/accounts/authorized-apps/page.tsx` — create
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify (add 'accounts' segment to nav)

**Reviewers**: `xstockstrat-ui` (service owner) — environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- Segment scaffolding pattern confirmed via Read of `src/app/config-ui/layout.tsx`: a `layout.tsx`
  wraps children in `<PlatformHeader segment=... subNav={[...]} />` + `<main>`, with exported
  `metadata`. Sub-nav items are `SubNavItem` (`PlatformHeader.tsx:15-20`). The authorized-apps page
  uses simple `fetch` + `useState`/`useEffect` against the Step 6 BFF routes, so **no react-query
  `Providers` wrapper is needed** (omit `providers.tsx`).
- Nav segments confirmed in `PlatformHeader.tsx`: `PlatformSegment = 'trader' | 'insights' | 'config'`
  (L12); `PLATFORM_NAV` array (L29-33); `SEGMENT_HOME` map (L35-39). Icons imported from
  `lucide-react` (L6: `BarChart2, TrendingUp, Settings, Menu, Activity`). Adding an "Accounts" entry
  requires extending all three + adding one icon import (e.g. `KeyRound`).
- Reusable UI primitives confirmed under `components/ui/`: `table.tsx`, `card.tsx`, `button.tsx`.
- The BFF routes this page calls are created in Step 6 (`/accounts/api/authorized-apps`,
  `/accounts/api/agent-health`); the segment is already auth-gated by middleware (see Step 6 Evidence).

**Instructions**:
- **Nav (`PlatformHeader.tsx`)**: extend `PlatformSegment` (L12) to include `'accounts'`; add an
  icon import on L6; add `{ segment: 'accounts', label: 'Accounts', href: '/accounts/authorized-apps', icon: <KeyRound className="h-4 w-4" /> }`
  to `PLATFORM_NAV` (L29-33); add `accounts: '/accounts/authorized-apps'` to `SEGMENT_HOME` (L35-39).
- **Layout (`accounts/layout.tsx`)**: mirror `config-ui/layout.tsx` — export `metadata`, render
  `<PlatformHeader segment="accounts" subNav={[{ label: 'Authorized Apps', href: '/accounts/authorized-apps', match: 'exact' }]} />` and `<main className="p-4 sm:p-6">{children}</main>`. No `<Providers>` wrapper (no react-query — see Evidence).
- **Page (`accounts/authorized-apps/page.tsx`)**: client component that (a) fetches the list from
  `GET /accounts/api/authorized-apps`, rendering each app's name / client id / authorized-at /
  **"Last refreshed"** in a table (reuse `components/ui/table.tsx`, `card.tsx`, `button.tsx`); label
  the `lastUsedAt` column **"Last refreshed"** (not "Last used") — it reflects refresh-token rotation,
  not per-request access (see Step 4 semantics); (b) a "Disconnect" button per row that, after a
  confirm step, calls `POST /accounts/api/authorized-apps` with `{ action: 'revoke', clientId }` then
  refetches; (c) a "Connect a new app" section showing `AGENT_PUBLIC_URL` as a read-only
  copy-to-clipboard field + Claude.ai instructions ("Settings → Connectors → Add custom connector");
  and (d) a reachable/unreachable indicator driven by `GET /accounts/api/agent-health`. The
  `AGENT_PUBLIC_URL` value must come from a **server boundary** (read `process.env.AGENT_PUBLIC_URL`
  in the layout/page server scope or a tiny server route and pass it down — never `NEXT_PUBLIC_*`).
  Render **no tokens/secrets** (FR-7).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Plus the E2E check in Step 9. Lint = `next lint`. Manually confirm: navigating to
`/accounts/authorized-apps` unauthenticated redirects to `/auth/login`; authenticated shows the
list + connect section; the last-refreshed column is labeled accordingly; no token/secret strings
appear in the rendered HTML.

---

### Step 8 — service: Wire AGENT_PUBLIC_URL into the xstockstrat-ui deployment block

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `docker-compose.yml` — modify (xstockstrat-ui `environment:` block)
- `.do/app.dev.yaml` — modify (xstockstrat-ui `envs:` block)
- `.do/app.yaml` — modify (xstockstrat-ui `envs:` block)

**Reviewers**: `xstockstrat-ui` (service owner) — environment scope correctness

**Codebase Evidence**:
- `AGENT_PUBLIC_URL` already exists in all three files but **only in the `xstockstrat-agent` block**
  — confirmed via grep: docker-compose L500 (`AGENT_PUBLIC_URL: http://localhost:9000`, under
  `xstockstrat-agent:` L479); app.dev.yaml & app.yaml L262 (`value: ${APP_URL}/agent`, under
  `- name: xstockstrat-agent` L229). It is **absent from the `xstockstrat-ui` block** in all three.
- `xstockstrat-ui` blocks: docker-compose `environment:` at L441-455 (ends with
  `OTEL_EXPORTER_OTLP_ENDPOINT` L455, `ports:` at L456); app.dev.yaml/app.yaml UI service at L385,
  `envs:` ending around L401-424 (already has `IDENTITY_ENDPOINT` L401, and `APP_URL` →
  `value: ${APP_URL}` — confirmed present in the UI block). The identity BFF call needs **no** new
  endpoint var (`IDENTITY_ENDPOINT` already wired for UI in all three).
- Naming rule (root CLAUDE.md Env Var Convention): `AGENT_PUBLIC_URL` is a browser-facing HTTPS base
  URL, **not** a gRPC `host:port` → correctly has **no `_ENDPOINT` suffix** (FR-9). Match the value
  the agent block uses (`${APP_URL}/agent` on DO; the local equivalent on compose).

**Instructions**:
- `docker-compose.yml` xstockstrat-ui `environment:` block (after `OTEL_EXPORTER_OTLP_ENDPOINT`
  L455): add `AGENT_PUBLIC_URL: http://xstockstrat-agent:9000`. (Match the agent's local SSE port;
  the agent block uses `http://localhost:9000` for its own self-URL, but for the UI to probe the
  agent over the compose network use the service name `xstockstrat-agent`.) Confirmed absent in the
  UI block via grep.
- `.do/app.dev.yaml` xstockstrat-ui `envs:` block: add
  `- key: AGENT_PUBLIC_URL` / `value: ${APP_URL}/agent` (same value the agent block uses — `/agent`
  is the DO route prefix → xstockstrat-agent per CLAUDE.md Frontend Ingress).
- `.do/app.yaml` xstockstrat-ui `envs:` block: same addition as app.dev.yaml.

**Verification**:
```bash
grep -n "AGENT_PUBLIC_URL" docker-compose.yml .do/app.dev.yaml .do/app.yaml
```
Confirm **two** entries per file now (one under the agent block, one under the xstockstrat-ui
block), with no `_ENDPOINT` suffix.

---

### Step 9 — test: E2E for /accounts/authorized-apps (covers Steps 6 + 7)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/accounts/authorized-apps.spec.ts` — create
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (add identity list/revoke mock responses)

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- E2E lives under `services/xstockstrat-ui/e2e/<segment>/*.spec.ts` (confirmed via inventory:
  `e2e/config-ui/*.spec.ts`, `e2e/trader/*.spec.ts`, `e2e/insights/*.spec.ts`, plus
  `e2e/auth.spec.ts`, `e2e/mock-backend.ts`, `e2e/global-setup.ts`, `e2e/helpers/auth.ts`).
- `mock-backend.ts` (Read L1-60) starts three http2 mock servers and defines `identityHandlers`
  (L58+) shared across segments; `IDENTITY_ENDPOINT` points all segments at port 9091. Add the
  `listAuthorizedApps` / `revokeAuthorizedApp` handlers to `identityHandlers` following the existing
  `authenticateUser` stub style (L59-60).
- Runner: `package.json` `test:e2e` = `playwright test` (L14). Next.js segments have **no coverage
  threshold** per §6 test table — E2E covers UI.

**Instructions**:
- Add `e2e/accounts/authorized-apps.spec.ts` asserting: (1) unauthenticated visit to
  `/accounts/authorized-apps` redirects to `/auth/login` (mirror `e2e/auth.spec.ts`); (2)
  authenticated session renders the authorized-apps table with a mocked app row (name, client id,
  authorized-at) and a "Disconnect" button; (3) "Disconnect" → confirm → row disappears after revoke;
  (4) the "Connect a new app" section shows the agent URL with a copy control and the
  reachable/unreachable indicator; (5) no token/secret string is present in the page.
- Extend `e2e/mock-backend.ts` `identityHandlers` to stub `listAuthorizedApps` (return one
  `AuthorizedApp`) and `revokeAuthorizedApp` (return `{ success: true }`). For the agent-health BFF
  probe, mock `${AGENT_PUBLIC_URL}/.well-known/oauth-protected-resource` (Playwright `page.route` or
  an env override) so the indicator renders deterministically.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run test:e2e
```
No coverage threshold applies (Next.js segment) — the new E2E spec passing satisfies the gate.

---

### Step 10 — docs: identity CLAUDE.md update + merge-order note

**Status**: `pending`
**Service**: `docs/` + `services/xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/CLAUDE.md` — modify (document new RPCs + refresh_tokens columns)
- `docs/roadmap/features/merge-order.md` — modify (optional note — 049 already launched; see below)

**Reviewers**: none

**Codebase Evidence**:
- Identity CLAUDE.md (Read) lists the gRPC methods in the Ports section ("all thirteen methods:
  AuthenticateUser … RefreshOAuthToken") and a "Database / Migrations" section ending at `003_oauth`.
  The two new RPCs and migration `004` columns should be reflected.
- `merge-order.md` (Read) table columns: `Feature | Must wait for | Reason | Resolved`. **049 is
  already merged** into `main-dev` (proto + `003_oauth` + `AGENT_PUBLIC_URL` all present), so the
  hard dependency on 049 is effectively satisfied — a blocking row is no longer strictly required.

**Instructions**:
- Update `services/xstockstrat-identity/CLAUDE.md`:
  - In the Ports section method list, change "thirteen methods" → "fifteen methods" and append
    `ListAuthorizedApps`, `RevokeAuthorizedApp`.
  - In "Database / Migrations", add a line for `004_refresh_token_client` — adds
    `refresh_tokens.client_id` (FK → `oauth_clients`, ON DELETE CASCADE, NULL = first-party session)
    and `refresh_tokens.last_used_at`; note OAuth refresh tokens are now tagged with their `client_id`
    on mint/rotation so "My Authorized Apps" can list/revoke them.
- `merge-order.md`: since 049 is already merged, add a **resolved** row for the record (or skip if
  the convention is to omit satisfied deps):
  `| auth2-authorized-apps-ui | unify-admin-auth-gates | Extends 049's OAuth backend (oauth_clients/refresh_tokens schema, AGENT_PUBLIC_URL); 049 shipped the OAuth grant flow + 003_oauth this feature builds on | Yes |`

**Verification**:
Read both files back; the CLAUDE.md method-count + migration line and the merge-order row are
present. No build/test command (docs only).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Steps 1–2 — proto toolchain installed on host (no Docker/buf preinstalled)
**Spec said**: Run `buf lint && buf breaking` (Step 1) and `./scripts/buf-gen.sh` (Step 2).
**Actual**: `buf` was not installed and the Docker codegen container could not run (Docker daemon
not available). Installed `buf` v1.69.0 (the CI `proto-freshness` pin in `.github/workflows/ci.yml`)
on the host, plus the Go/Python/TS proto plugins at their CI-pinned versions, then ran the same
commands. `git diff packages/proto/gen/` after `buf-gen.sh` is limited to the intended identity
additions (mirrors CI's stale-stub check).
**Reason**: Sequential-mode CI-equivalent verification fallback (skill REPO CONVENTIONS → "Proto
codegen container blocked"). **Disposition**: CI-equivalent fallback.

### Deviation: Step 3 — migration verified on a throwaway local PG cluster (no Docker/migrate)
**Spec said**: Run `./scripts/db-migrate.sh` (requires DATABASE_URL + golang-migrate inside the
db-migrator container).
**Actual**: Docker was unavailable, `migrate` was not installed, and no DATABASE_URL was set.
Initialized a throwaway PostgreSQL 16 cluster (the host's `/usr/lib/postgresql/16/bin`), applied
identity migrations `000`→`003` then `004` up, asserted `client_id` + `last_used_at` columns and
`idx_refresh_user_client` exist, then applied `004` down and asserted all three are gone (proves
reversibility). Cluster torn down afterward.
**Reason**: Sequential-mode CI-equivalent verification fallback (skill REPO CONVENTIONS → "migrate /
DB unavailable"). **Disposition**: CI-equivalent fallback.

- **(Re-spec, /sdd-spec 2026-06-07):** Feature 049 (hard dependency) is now **merged** into
  `main-dev` — the OAuth proto RPCs, `003_oauth` migration (`oauth_clients`/`oauth_auth_codes`),
  and `AGENT_PUBLIC_URL` (agent block) all exist. The earlier spec's "049 not merged" banner is
  superseded. Re-confirmed numbers: identity migration is unambiguously **`004`**; proto RPCs go
  after `RefreshOAuthToken` (L25). **New finding driving Step 4:** 049's `issueRefreshToken(userId)`
  does NOT persist `client_id`, so OAuth grants are not currently client-distinguishable in
  `refresh_tokens`. Step 4 must extend the mint/rotation paths (`exchangeAuthCode`,
  `refreshOAuthToken`) to record `client_id` (and `last_used_at`) — otherwise `ListAuthorizedApps`
  returns nothing. `AGENT_PUBLIC_URL` exists only in the agent deployment block and must be added to
  the UI block (Step 8).
- **(sdd-review impl-spec fixes, 2026-06-07):** Applied non-ordering advisory fixes — Step 1
  `buf breaking` now targets `main-dev` (canonical base); the old 8-file UI step was split into
  Step 6 (BFF routes) + Step 7 (segment/page/nav), dropping the conditional `providers.tsx`
  (page uses plain `fetch`); Step 4/5 made the 049 OAuth-test regression guard explicit; and
  `last_used_at` is documented/labeled as "last refreshed" (rotation-time, not per-request).
  Total steps 9 → 10. The Step 6→Step 8 deployment-ordering note (B3) was intentionally left as-is.
