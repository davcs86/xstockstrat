# Implementation Spec: auth2-authorized-apps-ui

**Status**: `pending`
**Created**: 2026-06-07
**Feature**: `docs/roadmap/features/051-auth2-authorized-apps-ui/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/auth2-authorized-apps-ui`

---

## ⚠️ Hard Dependency / Schema Gap — read before executing

This feature **extends feature `049-unify-admin-auth-gates` Part B**, which is **NOT yet
merged into `main-dev`**. Verified at `/sdd-spec` time (2026-06-07):

- `packages/proto/identity/v1/identity.proto` (read in full) has **no** OAuth RPCs — only the
  8 pre-existing methods (`AuthenticateUser`…`RevokeApiKey`). No `oauth_clients`, no DCR, no
  OAuth message types.
- `services/xstockstrat-identity/migrations/` ends at `002_seed_admin` (confirmed via `ls`).
  There is **no `003_oauth`** migration. The `oauth_clients` / `oauth_auth_codes` tables the
  product spec references **do not exist** in the codebase yet.
- `identity.refresh_tokens` (defined in `001_identity_tables.up.sql:27-34`) has columns
  `token_id, user_id, token_hash, expires_at, created_at, revoked_at` — **no `client_id`,
  no `last_used_at`, no OAuth-client linkage**. Today every refresh token is a first-party
  user session token (issued by `authenticateUser` / `refreshToken`), with no notion of an
  external OAuth client.

**Consequence:** the migration number (`004`), the exact OAuth schema this feature joins
against (`oauth_clients` for `client_name` / `redirect_uris`), and the proto field numbers
**must be re-confirmed against the merged 049 at execute time**. The numbers below are the
planned values; if 049 lands a `004_*` migration of its own, bump this one to the next free
NNN. Add the blocking row to `merge-order.md` (Step 9) before any final integration PR.

This spec is written so each step's `**Codebase Evidence**` states exactly what exists today
vs. what 049 must provide — so `/sdd-execute` can detect drift.

---

## Execution Summary

Proto first (additive RPCs + `AuthorizedApp` message), then regenerate stubs (both the
ts-proto `identity.ts` consumed by the identity service and the protobuf-es `identity_pb.ts`
consumed by the UI come from one `buf-gen.sh` run). Then the identity migration adds the
`(user_id, client_id)` linkage + `last_used_at` to `refresh_tokens`, followed by the identity
RPC implementations (per-user scoped list + revoke) and their unit tests. Finally the
`xstockstrat-ui` work: the new `/accounts` segment + "My Authorized Apps" page, a BFF route
that proxies the two identity RPCs with header propagation, a BFF health-probe route for the
agent discovery endpoint, the `AGENT_PUBLIC_URL` deployment wiring, and E2E coverage. Docs/
merge-order last.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs are generated from the edited `.proto`.
- Step 3 (migration) requires the merged 049 OAuth schema (see hard-dependency banner) to
  confirm the final NNN and the `oauth_clients` join target.
- Step 4 (identity service) requires Step 2 (regenerated ts-proto stub exposes the new methods
  on `IdentityServiceService`) and Step 3 (the `client_id` / `last_used_at` columns).
- Step 5 [test] covers Step 4 [service] — identity unit tests.
- Step 6 (UI BFF + page) requires Step 2 (regenerated `identity_pb.ts` exposes the new methods
  on the protobuf-es `IdentityService` used by `identityClient`).
- Step 7 (UI deployment wiring for `AGENT_PUBLIC_URL`) is required by Step 6's health probe.
- Step 8 [test] covers Step 6 [service] — UI E2E.
- Step 9 (docs) last — records merge-order block + identity CLAUDE.md update.

---

### Step 1 — proto: Add ListAuthorizedApps / RevokeAuthorizedApp RPCs + AuthorizedApp message

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/identity/v1/identity.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, additive (no field removal/renumber), `buf breaking` passes; `xstockstrat-identity` (service owner) — JWT/refresh-token handling, per-user isolation, no plaintext secrets; `xstockstrat-ui` (service owner) — no secret values rendered in UI (response shape carries only non-sensitive metadata)

**Codebase Evidence**:
- Confirmed via Read of `packages/proto/identity/v1/identity.proto` (full file, 67 lines). Service block `IdentityService` ends at L18 with `rpc RevokeApiKey(...)`. Existing imports: `google/protobuf/timestamp.proto` (L7). Pattern for request/response pairs: `message RevokeApiKeyRequest { string key_id = 1; string user_id = 2; }` (L65), `message ListApiKeysResponse { repeated ApiKey keys = 1; }` (L64).
- Timestamp fields already use `google.protobuf.Timestamp` (e.g. `ApiKey.created_at = 6`, L52).
- Per CLAUDE.md Proto Contract Governance: closed value sets prefer enums; here all new fields are open strings/timestamps/repeated — no enum needed. No zero-value sentinel concerns.

**Instructions**:
- Add two RPCs to the `IdentityService` service block (after `RevokeApiKey` at L17):
  ```
  rpc ListAuthorizedApps(ListAuthorizedAppsRequest) returns (ListAuthorizedAppsResponse);
  rpc RevokeAuthorizedApp(RevokeAuthorizedAppRequest) returns (RevokeAuthorizedAppResponse);
  ```
- Add the following messages at the end of the file (after L66), mirroring the existing
  request/response naming and the `ApiKey` timestamp style:
  ```
  message AuthorizedApp {
    string client_id = 1;
    string client_name = 2;
    google.protobuf.Timestamp authorized_at = 3;
    google.protobuf.Timestamp last_used_at = 4;   // best-effort; may be unset
    repeated string redirect_uris = 5;
  }
  message ListAuthorizedAppsRequest { string user_id = 1; }
  message ListAuthorizedAppsResponse { repeated AuthorizedApp apps = 1; }
  message RevokeAuthorizedAppRequest { string user_id = 1; string client_id = 2; }
  message RevokeAuthorizedAppResponse { bool success = 1; }
  ```
- Field numbers are fresh; no existing field/RPC is changed or renumbered → additive,
  non-breaking. Do NOT expose token/secret fields on `AuthorizedApp` (FR-7).
- **If 049 already added `AuthorizedApp` or these RPCs** (deep-overlap warning in context.md),
  reuse/extend rather than duplicate — re-confirm at execute time after 049 merges.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/auth2-authorized-apps-ui"
```
Both must pass (additive change → `buf breaking` reports no breaking changes).

---

### Step 2 — proto-gen: Regenerate stubs (Go / Python / TS)

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/ts/identity/v1/identity.ts` — regenerate (ts-proto, grpc-js — consumed by identity service)
- `packages/proto/gen/ts/identity/v1/identity_pb.ts` — regenerate (protobuf-es — consumed by UI)
- `packages/proto/gen/ts/identity/v1/identity_connect.ts` — regenerate (connect-es)
- `packages/proto/gen/go/identity/v1/*` — regenerate
- `packages/proto/gen/python/identity/v1/*` — regenerate

**Reviewers**: Proto Reviewer — field number uniqueness, additive, `buf breaking` passes; `xstockstrat-identity` (service owner); `xstockstrat-ui` (service owner) _(inherited from Step 1)_

**Codebase Evidence**:
- Confirmed via Read of `packages/proto/buf.gen.yaml`: one config emits ts-proto
  (`protoc-gen-ts_proto`, `outputServices=grpc-js`), protobuf-es (`protoc-gen-es`), and
  connect-es (`protoc-gen-connect-es`) into `gen/ts`. Confirmed via `ls gen/ts/identity/v1/`:
  `identity.ts`, `identity_pb.ts`, `identity_connect.ts` all already exist.
- Identity service imports the ts-proto form: `import { IdentityServiceService } from '@xstockstrat/proto/identity/v1/identity'` (`services/xstockstrat-identity/src/index.ts:5`).
- UI imports the protobuf-es form: `import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb'` (`services/xstockstrat-ui/src/lib/connectClients.ts:5`).
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

### Step 3 — migration: Link refresh tokens to OAuth clients + last_used_at

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/migrations/004_authorized_apps.up.sql` — create
- `services/xstockstrat-identity/migrations/004_authorized_apps.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts vs 049's OAuth migration), up+down pair present, index correctness, run-order via `scripts/db-migrate.sh`; `xstockstrat-identity` (service owner) — JWT/refresh-token handling, per-user isolation

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-identity/migrations/`: last applied migration is
  `002_seed_admin` (files `000_schema`, `001_identity_tables`, `002_seed_admin`). **No
  `003_oauth` exists yet** — it is expected from 049. NNN here is planned as `004` assuming
  049 lands `003`; **bump to next free NNN if 049's set differs** (see hard-dependency banner).
- `identity.refresh_tokens` shape confirmed via Read of `001_identity_tables.up.sql:27-37`:
  `token_id UUID PK, user_id UUID FK→users, token_hash TEXT UNIQUE, expires_at, created_at,
  revoked_at`. Existing index `idx_refresh_user ON refresh_tokens (user_id)` (L37).
- Naming convention from root CLAUDE.md / feature-workflow: `NNN_description.up.sql` +
  `.down.sql`, NNN continues from the last file. Never edit an applied migration.

**Instructions**:
- Add a nullable `client_id TEXT` column and a nullable `last_used_at TIMESTAMPTZ` column to
  `identity.refresh_tokens`. `client_id` NULL means a first-party user-session token (today's
  behavior, FR-3 isolation preserved); a non-NULL `client_id` means an OAuth-client grant
  that should appear in "My Authorized Apps".
- Add an index supporting per-(user, client) listing/revoke (FR-2/FR-4):
  `CREATE INDEX IF NOT EXISTS idx_refresh_user_client ON identity.refresh_tokens (user_id, client_id) WHERE client_id IS NOT NULL;`
- If 049's `oauth_clients` table exists (confirm at execute time), `client_id` should reference
  it (`REFERENCES identity.oauth_clients(client_id)`) so `client_name` / `redirect_uris` can be
  joined for the list response. **If `oauth_clients` does not yet exist, do not add the FK** —
  leave `client_id` as a plain column and join is deferred until 049 merges (note the deviation).
- `.down.sql` must drop the index and the two columns (reverse order). Up+down pair required.

**Verification**:
```bash
./scripts/db-migrate.sh        # applies 004 up cleanly
# then verify down reverses (per docs/patterns/database.md down-migration check)
```
Confirm the migration applies up and rolls back down without error; `idx_refresh_user_client`
exists after up and is gone after down.

---

### Step 4 — service: Implement ListAuthorizedApps / RevokeAuthorizedApp (per-user scoped)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-identity` (service owner) — JWT expiry/rotation, refresh-token invalidation semantics, per-user isolation (no IDOR), never plaintext secrets

**Codebase Evidence**:
- Confirmed via Read of `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` (full,
  305 lines). Methods are camelCase on the class (`authenticateUser`, `refreshToken`,
  `revokeToken`, `listApiKeys`, `revokeApiKey`); grpc-js dispatches via
  `IdentityServiceService` added in `src/index.ts:44-47`.
- Per-user-scoped query pattern: `listApiKeys` (L273-293) filters `WHERE user_id = $1` and maps
  rows to camelCase response objects. `revokeApiKey` (L295-303) scopes deletes by **both**
  `key_id` AND `user_id` (`WHERE key_id = $1 AND user_id = $2`) — the IDOR-safe pattern to
  mirror for `RevokeAuthorizedApp`.
- Refresh-token invalidation pattern: `revokeToken` (L200-217) does
  `UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`.
  Revoke-by-client must add `AND client_id = $2`.
- Timestamp encoding rule: responses MUST carry `Date` instances (helper `secondsToDate`,
  L18-20; comment L11-17). `listApiKeys` maps `createdAt: new Date(r.created_at)` (L287).
- Error code conventions: `code: 3` (INVALID_ARGUMENT) for missing args, `code: 13` (INTERNAL)
  on DB error, `code: 16` (UNAUTHENTICATED) for bad credentials.

**Instructions**:
- Add `async listAuthorizedApps(call, callback)`:
  - Read `userId` from `call.request`; if empty, `callback({ code: 3, message: 'userId required' })`.
  - Query the distinct OAuth-client grants for that user from `identity.refresh_tokens`
    (filtered `WHERE user_id = $1 AND client_id IS NOT NULL AND revoked_at IS NULL AND expires_at > NOW()`),
    grouping by `client_id` and selecting `MIN(created_at) AS authorized_at`,
    `MAX(last_used_at) AS last_used_at`. If 049's `oauth_clients` exists, LEFT JOIN it to
    populate `client_name` and `redirect_uris`; otherwise return `client_name = client_id` and
    empty `redirect_uris` (document the deviation).
  - Map to the response: `{ apps: rows.map(r => ({ clientId, clientName, authorizedAt: new Date(...), lastUsedAt: r.last_used_at ? new Date(r.last_used_at) : undefined, redirectUris: r.redirect_uris ?? [] })) }`.
    **Render only non-sensitive metadata — never `token_hash` or any secret** (FR-7).
- Add `async revokeAuthorizedApp(call, callback)`:
  - Read `userId` and `clientId`; if either empty, `callback({ code: 3, ... })`.
  - `UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL`
    — scoped by **both** `user_id` and `client_id` (IDOR-safe, mirrors `revokeApiKey` L297).
    A forged/foreign `client_id` simply matches zero rows (no-op) — never another user's grant.
  - `callback(null, { success: true })`.
- These methods read/write only `identity.refresh_tokens` (and optionally read `oauth_clients`);
  they make **no new outbound gRPC call**, so §5c header-propagation does not apply to this step.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint
```
Plus the behavioral/coverage check in Step 5. Lint must pass with no errors.

---

### Step 5 — test: Unit tests for ListAuthorizedApps / RevokeAuthorizedApp

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-identity` (service owner)

**Codebase Evidence**:
- Confirmed via Read of `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts`.
  Tests use `node:test`, mock the pool via `makePool(rows, throws)` (L36-43) and `makeImpl`
  (L45-50), and assert validation fast paths and `callback` codes. Existing examples: missing
  args → `code: 3` (L60-101), DB rows shape control.
- Test runner / coverage from `services/xstockstrat-identity/package.json`:
  `test:coverage` = `c8 --reporter=text --reporter=lcov --lines 40 node --experimental-strip-types --test src/__tests__/*.test.ts` (L13). Threshold = 40% lines.

**Instructions**:
- Add a `describe('listAuthorizedApps')` block:
  - rejects when `userId` missing → `code: 3`.
  - with `makeImpl([{ client_id: 'c1', client_name: 'Claude.ai', authorized_at: new Date(), last_used_at: null, redirect_uris: ['https://claude.ai/cb'] }])`,
    asserts the response maps `apps[0].clientId === 'c1'`, `apps[0].clientName === 'Claude.ai'`,
    and that **no token/secret field is present** on the returned app object (assert
    `'tokenHash' not in apps[0]`).
- Add a `describe('revokeAuthorizedApp')` block:
  - rejects when `userId` or `clientId` missing → `code: 3`.
  - with a mock pool, asserts `success: true` on the happy path; assert the IDOR-safe query is
    parameterized by both `user_id` and `client_id` (capture the SQL/params in the mock and
    assert both placeholders are bound).
- Follow the existing `await new Promise<void>(resolve => impl.method(makeCall(req), cb))` shape.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage
```
`test:coverage` must pass the `--lines 40` gate; new tests must pass.

---

### Step 6 — service: UI /accounts segment, My Authorized Apps page, BFF routes

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/layout.tsx` — create
- `services/xstockstrat-ui/src/app/accounts/providers.tsx` — create (only if the page uses react-query; otherwise omit)
- `services/xstockstrat-ui/src/app/accounts/authorized-apps/page.tsx` — create
- `services/xstockstrat-ui/src/app/accounts/api/authorized-apps/route.ts` — create (BFF: list + revoke via identity)
- `services/xstockstrat-ui/src/app/accounts/api/agent-health/route.ts` — create (BFF: probe agent discovery endpoint)
- `services/xstockstrat-ui/src/app/accounts/api/health/route.ts` — create (segment health, mirrors config-ui)
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify (add 'accounts' segment to nav)
- `services/xstockstrat-ui/src/middleware.ts` — verify (no change expected — see Evidence)

**Reviewers**: `xstockstrat-ui` (service owner) — Connect-RPC call safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- Segment scaffolding pattern confirmed via Read of `src/app/config-ui/layout.tsx`: a `layout.tsx`
  wraps children in `<Providers>` + `<PlatformHeader segment=... subNav=[...] />`. Sub-nav items
  are `SubNavItem` (`PlatformHeader.tsx:15-20`).
- Nav segments confirmed in `PlatformHeader.tsx`: `PlatformSegment = 'trader' | 'insights' | 'config'`
  (L12), `PLATFORM_NAV` array (L29-33), `SEGMENT_HOME` map (L35-39). Adding an "Accounts" entry
  requires extending all three.
- **Middleware already protects `/accounts/*`**: confirmed via Read of `src/middleware.ts:9-14`.
  The matcher is a single negative-lookahead excluding only static assets + the public auth
  routes (`auth/login`, `auth/oauth-login`, `api/auth/login`, `api/health`, `health`). Any path
  not excluded — including `/accounts/...` — already requires a valid session (redirects to
  `/auth/login`). **No matcher edit needed** (FR-8 satisfied by the existing catch-all). The
  segment's own `api/health` route name (`accounts/api/health`) is not in the exclusion list, so
  it is auth-gated like config-ui's `api/health` (which is also gated). Confirm no public-probe
  requirement; if an unauthenticated health endpoint is needed, name it under `health` per the
  existing exclusion — but the spec's health probe (FR-10) is the *agent* probe, which is the
  authenticated `agent-health` BFF route.
- BFF auth + header-propagation pattern confirmed via Read of `src/lib/configUiBff.ts`:
  `requireSession(ctx)` reads the `access_token` cookie and `verifyAccessToken`; `backendHeaders`
  (L21-27) sets `x-user-id`, `x-access-scope` (via `rolesToAccessScope`), `x-trace-id` on the
  outbound call. Simpler Route-Handler variant confirmed via `src/app/config-ui/api/audit/route.ts`:
  reads `getSessionFromRequest(req)` → 401 if no claims, then calls backend.
- `identityClient` (protobuf-es) confirmed in `src/lib/connectClients.ts:33`
  (`createClient(IdentityService, makeTransport(IDENTITY_ENDPOINT))`); after Step 2 it exposes
  `.listAuthorizedApps()` / `.revokeAuthorizedApp()`. Header forwarding via the options object
  `{ headers }` — pattern at `configUiBff.ts:34`.
- Auth helpers confirmed in `src/lib/auth.ts`: `getSessionFromRequest`, `verifyAccessToken`,
  `rolesToAccessScope` (L60-72), `generateTraceId` (L74-76).

**Instructions**:
- **Nav (`PlatformHeader.tsx`)**: extend `PlatformSegment` to include `'accounts'`; add
  `{ segment: 'accounts', label: 'Accounts', href: '/accounts/authorized-apps', icon: <… /> }`
  to `PLATFORM_NAV` (pick an existing `lucide-react` icon already imported, e.g. add one to the
  import on L6); add `accounts: '/accounts/authorized-apps'` to `SEGMENT_HOME`.
- **Layout (`accounts/layout.tsx`)**: mirror `config-ui/layout.tsx` — render
  `<PlatformHeader segment="accounts" subNav={[{ label: 'Authorized Apps', href: '/accounts/authorized-apps', match: 'exact' }]} />` and `<main>`. Add `metadata`.
- **Page (`accounts/authorized-apps/page.tsx`)**: client component that (a) fetches the list from
  `GET /accounts/api/authorized-apps`, rendering each app's name / client id / authorized-at /
  last-used in a table (reuse `components/ui/table.tsx`, `card.tsx`, `button.tsx`); (b) a
  "Disconnect" button per row that, after a confirm step, calls
  `POST /accounts/api/authorized-apps` with `{ action: 'revoke', clientId }` then refetches;
  (c) a "Connect a new app" section showing `AGENT_PUBLIC_URL` (passed from a server boundary —
  read `process.env.AGENT_PUBLIC_URL` in the layout/page server scope or a small server route,
  never `NEXT_PUBLIC_*`) as a read-only copy-to-clipboard field + Claude.ai instructions; and
  (d) a reachable/unreachable indicator driven by `GET /accounts/api/agent-health`. Render **no
  tokens/secrets** (FR-7).
- **BFF list/revoke (`accounts/api/authorized-apps/route.ts`)**: implement `GET` and `POST`
  Route Handlers. Read the session via `getSessionFromRequest(req)` (→ 401 if none). Build
  propagation headers exactly like `configUiBff.ts:backendHeaders` (`x-user-id` = `claims.user_id`,
  `x-access-scope` = `String(rolesToAccessScope(claims.roles))`, `x-trace-id` =
  `req.headers.get('x-trace-id') ?? generateTraceId()`). `GET` → `identityClient.listAuthorizedApps({ userId: claims.user_id }, { headers })`.
  `POST` (revoke) → `identityClient.revokeAuthorizedApp({ userId: claims.user_id, clientId }, { headers })`.
  **Always derive `userId` from the verified session, never from the request body** (FR-3 IDOR).
  Map Connect errors to HTTP via `connectCodeToHttp` (`connectClients.ts:40`).
- **BFF agent health (`accounts/api/agent-health/route.ts`)**: `GET` reads the session (401 if
  none), then server-side `fetch(`${process.env.AGENT_PUBLIC_URL}/.well-known/oauth-protected-resource`)`
  and returns `{ reachable: res.ok, status: res.status }` — **no payload** (FR-10). On
  fetch throw, return `{ reachable: false }` with HTTP 200 so the page degrades gracefully.
- **Segment health (`accounts/api/health/route.ts`)**: mirror `config-ui/api/health/route.ts`
  (`return NextResponse.json({ status: 'ok', service: 'xstockstrat-ui/accounts' })`).
- §5c header propagation: the list/revoke BFF adds a **new outbound gRPC call** to identity.
  It forwards `x-user-id`/`x-access-scope`/`x-trace-id` via the `{ headers }` object built exactly
  like `configUiBff.ts:backendHeaders` — cite that as the reused mechanism. The `agent-health`
  call is an outbound HTTPS probe (not a backend gRPC call), so it does not require the three
  internal headers.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Plus the E2E check in Step 8. Manually confirm: navigating to `/accounts/authorized-apps`
unauthenticated redirects to `/auth/login`; authenticated shows the list + connect section;
no token/secret strings appear in the rendered HTML or BFF JSON.

---

### Step 7 — service: Wire AGENT_PUBLIC_URL into xstockstrat-ui deployment configs

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `docker-compose.yml` — modify (xstockstrat-ui `environment:` block)
- `.do/app.dev.yaml` — modify (xstockstrat-ui `envs:` block)
- `.do/app.yaml` — modify (xstockstrat-ui `envs:` block)

**Reviewers**: `xstockstrat-ui` (service owner) — environment scope correctness

**Codebase Evidence**:
- `AGENT_PUBLIC_URL` is **absent from all three deployment files** — confirmed via
  `grep -n "AGENT_PUBLIC_URL" docker-compose.yml .do/app.dev.yaml .do/app.yaml` → no match.
  It is the env var feature 049 (FR-B2/B12) establishes for the agent's public base URL.
- The xstockstrat-ui blocks exist: `docker-compose.yml:433` (`environment:` at L441-455, with
  `IDENTITY_ENDPOINT` etc.), `.do/app.dev.yaml:383` (`envs:` at L392-421), `.do/app.yaml:383`.
- Naming rule (root CLAUDE.md Env Var Convention): `AGENT_PUBLIC_URL` is a browser-facing HTTPS
  base URL, **not** a gRPC `host:port` → it correctly has **no `_ENDPOINT` suffix** (FR-9).
- `IDENTITY_ENDPOINT` is **already wired** for the UI in all three files (docker-compose L447,
  app.dev.yaml L399-400) — the identity BFF call needs **no** new endpoint var.

**Instructions**:
- `docker-compose.yml` xstockstrat-ui `environment:` block (after L455): add
  `AGENT_PUBLIC_URL: http://xstockstrat-agent:9000` (local agent SSE port per CLAUDE.md Service
  Registry; confirm the local value 049 uses when it merges — match it). Confirmed absent:
  `grep -n AGENT_PUBLIC_URL docker-compose.yml` → no match.
- `.do/app.dev.yaml` xstockstrat-ui `envs:` block (after L421): add
  `- key: AGENT_PUBLIC_URL` / `value: ${APP_URL}/agent` (the DO route prefix `/agent` →
  xstockstrat-agent per CLAUDE.md Frontend Ingress; confirm against 049's value at execute time).
- `.do/app.yaml` xstockstrat-ui `envs:` block: same addition as app.dev.yaml.
- **If 049 already added `AGENT_PUBLIC_URL` to the UI block**, do not duplicate — reuse it.

**Verification**:
```bash
grep -n "AGENT_PUBLIC_URL" docker-compose.yml .do/app.dev.yaml .do/app.yaml
```
Confirm one entry in each file, under the xstockstrat-ui block, with no `_ENDPOINT` suffix.

---

### Step 8 — test: E2E for /accounts/authorized-apps

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/accounts/authorized-apps.spec.ts` — create
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (add identity list/revoke mock responses if not present)

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- E2E lives under `services/xstockstrat-ui/e2e/<segment>/*.spec.ts` (confirmed via file
  inventory: `e2e/config-ui/*.spec.ts`, `e2e/trader/*.spec.ts`, `e2e/insights/*.spec.ts`,
  plus `e2e/auth.spec.ts`, `e2e/mock-backend.ts`, `e2e/global-setup.ts`).
- Runner: `package.json` `test:e2e` = `playwright test` (L14). Next.js segments have **no
  coverage threshold** per the §6 test table — E2E covers UI.

**Instructions**:
- Add `e2e/accounts/authorized-apps.spec.ts` asserting: (1) unauthenticated visit to
  `/accounts/authorized-apps` redirects to `/auth/login` (mirror `e2e/auth.spec.ts`); (2)
  authenticated session renders the authorized-apps table with a mocked app row (name, client
  id, authorized-at) and a "Disconnect" button; (3) "Disconnect" → confirm → row disappears
  after revoke; (4) the "Connect a new app" section shows the agent URL with a copy control and
  the reachable/unreachable indicator; (5) no token/secret string is present in the page.
- Extend `e2e/mock-backend.ts` to stub the identity `listAuthorizedApps` / `revokeAuthorizedApp`
  responses and the `agent-health` probe (follow the existing mock-backend RPC-stub style).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run test:e2e
```
No coverage threshold applies (Next.js segment) — the new E2E spec passing satisfies the gate.

---

### Step 9 — docs: merge-order block + identity CLAUDE.md update

**Status**: `pending`
**Service**: `docs/` + `services/xstockstrat-identity`
**Files**:
- `docs/roadmap/features/merge-order.md` — modify (add blocking row: 051 waits for 049)
- `services/xstockstrat-identity/CLAUDE.md` — modify (document new RPCs + the refresh_tokens columns)

**Reviewers**: none

**Codebase Evidence**:
- `merge-order.md` table shape confirmed via Read: columns `Feature | Must wait for | Reason |
  Resolved`; existing rows e.g. `live-strategy-alert-engine | strategy-engine | ... | No`.
- Identity CLAUDE.md confirmed via Read: lists the 8 gRPC methods in the Ports section and a
  "Config Keys Consumed" table — the new RPCs and migration columns should be reflected.

**Instructions**:
- Add a `merge-order.md` row:
  `| auth2-authorized-apps-ui | unify-admin-auth-gates | Hard dependency: extends 049's OAuth backend (oauth_clients/refresh_tokens schema, AGENT_PUBLIC_URL); 049 ships the OAuth grant flow + 003 migration this feature builds on; identity migration must sequence after 049's | No |`
  (use the slug form per the file's convention; mark `Resolved: No` until 049 is `launched`).
- Update `services/xstockstrat-identity/CLAUDE.md`: add `ListAuthorizedApps` and
  `RevokeAuthorizedApp` to the method list in the Ports section; note the `refresh_tokens`
  `client_id` / `last_used_at` columns added by migration `004`.

**Verification**:
Read both files back; the merge-order row and the two CLAUDE.md additions are present. No
build/test command (docs only).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- **(Pre-execution, /sdd-spec 2026-06-07):** Feature 049 (hard dependency) is not yet merged
  into `main-dev`. The OAuth schema this feature extends (`oauth_clients`, `003_oauth`
  migration, `refresh_tokens.client_id`, `AGENT_PUBLIC_URL`) **does not exist in the codebase
  at spec time** — verified by reading the proto, the migrations dir, and the three deployment
  files. Migration number (`004`), the `oauth_clients` join target, the proto field numbers, and
  the `AGENT_PUBLIC_URL` deployment values must be re-confirmed against the merged 049 at
  execute time. Do not begin Step 3/4/7 until 049 has merged and these are confirmed.
