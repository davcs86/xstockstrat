# Implementation Spec: user-management-ui

**Status**: `pending`
**Created**: 2026-08-31
**Feature**: `docs/roadmap/features/043-user-management-ui/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/user-management-ui`

---

## Execution Summary

Six additive, admin-gated RPCs are added to `IdentityService`, then surfaced through the `/config-ui`
segment BFF as a new admin-only "Users" section, with a redacted ledger audit event per mutation. The
order follows the recon boundaries: **proto → codegen → identity authz gate → identity servicer →
identity unit tests → identity ledger audit client → audit unit test → UI BFF → UI Users section →
UI e2e**. Backend lands first (the RPCs and their guards are the load-bearing authz per C-10(c)); the
UI comes after so its client calls hit real generated stubs. No DB migration (the `users` table
already carries `roles TEXT[]`, `is_active`, `created_at`, `updated_at` —
`services/xstockstrat-identity/migrations/001_identity_tables.up.sql:6-14`). No new config keys. No new
env var — `LEDGER_ENDPOINT` for identity is already wired in `docker-compose.yml` and both `.do`
specs (recon.md § Dependencies; only the code that reads it is new).

**Consumer surface (C-14).** The product spec names one surface: the `/config-ui` **Users** section
(list, create, reset password, assign/remove roles, deactivate/reactivate). Steps 8–10 land it
(BFF + pages + nav + e2e). The Agent surface is explicitly out of scope (product-spec § Consumer
Surface — no MCP tool change).

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| AC-1 (ListUsers; no password field) | 5 (unit), 10 (e2e list render) |
| AC-2 (CreateUser then login) | 5 |
| AC-3 (UpdatePassword admin reset; old password fails) | 5 |
| AC-4 (SetUserRoles add + remove) | 5 |
| AC-5 (SetUserActive deactivate blocks login) | 5 |
| AC-6 (reactivate re-enables login) | 5 |
| AC-7 (non-admin denied every RPC) | 5 |
| AC-8 (ledger audit per mutation; no password in event) | 7 |
| AC-9 (Users reachable in config-ui nav) | 10 (nav-reachability e2e) |
| AC-10 (passwords never returned/displayed) | 5 (RPC bodies), 7 (audit payload), 10 (UI field) |
| AC-11 (last active admin cannot be deactivated or demoted) | 5 |

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the edited `.proto`.
- Step 4 (servicer) requires Step 3 (authz gate): every RPC calls `hasAdminAccessScope` first.
- Step 5 (identity unit tests) covers Step 3 + Step 4 (paired test, C-08 / P-06).
- Step 6 (ledger audit client) requires Step 4: it adds `AppendEvent` calls after each successful
  mutation the servicer implements. Best-effort after commit — the mutation is not rolled back on
  audit failure (design R5).
- Step 7 (audit unit test) covers Step 6.
- Step 8 (UI BFF) requires Step 2 (generated TS stubs expose the new `IdentityService` methods).
- Step 9 (UI Users section) requires Step 8 (the pages call the BFF routes) and Step 1 (the `Role`
  enum's exhaustive TS label map — C-10(a/d) — ships in the same PR as the enum).
- Step 10 (UI e2e) covers Steps 8 + 9 (the `/config-ui` consumer surface, C-14).

---

### Step 1 — proto: Add six admin RPCs, a `Role` enum, and a password-free `User` view

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/identity/v1/identity.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, `buf lint`/`buf breaking` pass; xstockstrat-identity owner — JWT/role scoping, never plaintext secrets; xstockstrat-ui owner — Connect-RPC call safety, no secret values in UI

**Codebase Evidence**:
- Service RPC block ends at `identity.proto:31-32` (`GetUserMetadata`/`UpdateUserMetadata`, feature 130); new RPCs append after line 31 inside `service IdentityService`.
- `TokenClaims.roles` is `repeated string` (`identity.proto:49`) and MUST stay unchanged (design.md § Chosen Approach 1 — non-breaking; `TokenClaims` is the JWT claim shape, not the admin write inputs).
- Existing message-numbering house style: each message numbers its own fields from 1 (e.g. `AuthenticateUserRequest` `:34-37`, `UserMetadata` `:121-128`). Fresh field numbers per new message → additive/non-breaking (C-09).
- `users` columns available for the `User` view: `user_id UUID`, `email TEXT`, `roles TEXT[]`, `is_active BOOLEAN`, `created_at`, `updated_at` (`migrations/001_identity_tables.up.sql:6-14`, per recon.md § Codebase Map).
- Enum-over-string + `_UNSPECIFIED=0` sentinel required (root CLAUDE.md § Proto Contract Governance; C-04).

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. Add a closed `Role` enum (C-04) near the new messages:
   ```proto
   enum Role {
     ROLE_UNSPECIFIED = 0;
     ROLE_ADMIN = 1;
     ROLE_TRADER = 2;
     ROLE_VIEWER = 3;
   }
   ```
   (Roles mirror the hardcoded `viewer/trader/admin` set in `services/xstockstrat-ui/src/lib/auth.ts` — design.md § Rejected Alternatives.)
2. Add a `User` view message with **no** `password` or `password_hash` field (FR-10/AC-10):
   ```proto
   message User {
     string user_id = 1;
     string email = 2;
     repeated Role roles = 3;
     bool is_active = 4;
     google.protobuf.Timestamp created_at = 5;
   }
   ```
   (`google.protobuf.timestamp` is already imported at `identity.proto:8`.)
3. Add the six RPCs to `service IdentityService` after line 31:
   ```proto
   // User management (admin-gated, feature 043)
   rpc CreateUser(CreateUserRequest) returns (CreateUserResponse);
   rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);
   rpc GetUser(GetUserRequest) returns (GetUserResponse);
   rpc UpdatePassword(UpdatePasswordRequest) returns (UpdatePasswordResponse);
   rpc SetUserRoles(SetUserRolesRequest) returns (SetUserRolesResponse);
   rpc SetUserActive(SetUserActiveRequest) returns (SetUserActiveResponse);
   ```
4. Add the request/response messages, each numbering fields from 1. Carry roles as the `Role` enum on the write inputs (design R1):
   - `CreateUserRequest { string email = 1; string password = 2; repeated Role roles = 3; }` / `CreateUserResponse { User user = 1; }`
   - `ListUsersRequest {}` / `ListUsersResponse { repeated User users = 1; }`
   - `GetUserRequest { string user_id = 1; }` / `GetUserResponse { User user = 1; }`
   - `UpdatePasswordRequest { string user_id = 1; string new_password = 2; }` / `UpdatePasswordResponse {}` (empty — no password echoed, AC-10)
   - `SetUserRolesRequest { string user_id = 1; repeated Role roles = 2; }` / `SetUserRolesResponse { User user = 1; }`
   - `SetUserActiveRequest { string user_id = 1; bool active = 2; }` / `SetUserActiveResponse { User user = 1; }`
5. Do not touch `TokenClaims` or any existing message/field number.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against '.git#branch=main-dev'
```
Confirm `buf lint` passes and `buf breaking` reports no breaking change (additive only). Confirm every new enum has `ROLE_UNSPECIFIED = 0`.

---

### Step 2 — proto-gen: Regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated; never hand-edited)

**Reviewers**: Proto Reviewer — field number uniqueness per message, `buf lint`/`buf breaking` pass; xstockstrat-identity owner — JWT/role scoping; xstockstrat-ui owner — Connect-RPC call safety (inherited from Step 1)

**Codebase Evidence**:
- Codegen entry point: `./scripts/buf-gen.sh` (root CLAUDE.md § Generating Proto Stubs) — generates TS, Python, Go and compiles the TS package; CI `proto-freshness` enforces an empty diff after running it.
- Identity server imports the generated grpc-js service via subpath `@xstockstrat/proto/identity/v1/identity` (`services/xstockstrat-identity/src/index.ts:5`); the browser/BFF import the connect stub via `@xstockstrat/proto/identity/v1/identity_pb` (`services/xstockstrat-ui/src/lib/connectClients.ts:5`). Both subpaths regenerate here.

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root (no host toolchain required — see `docs/runbooks/codegen-toolchain-host-setup.md` if the Docker path is unavailable).
2. Stage the regenerated `packages/proto/gen/**` output. Do not hand-edit any generated file.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen | head
```
Confirm the only changed files under `packages/proto/gen/` are the identity stubs (TS/Python/Go) carrying the six new methods and the `Role`/`User` types. Re-running `./scripts/buf-gen.sh` a second time must leave an empty `git diff packages/proto/gen/` (freshness).

---

### Step 3 — service: Port the config admin gate into identity `authz.ts`

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/authz.ts` — modify

**Reviewers**: xstockstrat-identity owner — JWT expiry/rotation, API key scoping, secret store integration; Security — auth scope correctness (admin gate)

**Codebase Evidence**:
- Identity `authz.ts` today exports only `first(md,key)` and `userIdFrom(md)` + `HEADER_USER_ID` (`services/xstockstrat-identity/src/grpc/authz.ts:15-26`) — **no admin-scope check** (recon.md § Codebase Map).
- Canonical Node admin gate to copy verbatim (recon "Patterns to REUSE"): `services/xstockstrat-config/src/grpc/authz.ts:22` (`export const ADMIN_SCOPE = 0x04`), `:24` (`HEADER_ACCESS_SCOPE = 'x-access-scope'`), `:44-48` (`hasAdminAccessScope(md)` — `Number.parseInt(...) || '0'`, `NaN → false`, `& ADMIN_SCOPE`), `:56-59` (`ADMIN_SCOPE_ERROR = { code: status.PERMISSION_DENIED, message: 'admin scope required' }`).
- Config's `authz.ts` imports `{ Metadata, status } from '@grpc/grpc-js'` (`config authz.ts:19`); identity's currently imports only `{ Metadata }` (`identity authz.ts:13`) — add `status`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `services/xstockstrat-identity/src/grpc/authz.ts`, change the import to `import { Metadata, status } from '@grpc/grpc-js';`.
2. Add, copied from `services/xstockstrat-config/src/grpc/authz.ts:22,24,44-48,56-59` (do not invent a new shape — recon mandates reuse):
   - `export const ADMIN_SCOPE = 0x04;`
   - `export const HEADER_ACCESS_SCOPE = 'x-access-scope';`
   - `export function hasAdminAccessScope(md?: Metadata): boolean` — reads `first(md, HEADER_ACCESS_SCOPE) || '0'`, `Number.parseInt(...,10)`, returns `false` on `NaN`, else `Boolean(parsed & ADMIN_SCOPE)` (fails closed on absent/unparseable header).
   - `export const ADMIN_SCOPE_ERROR = { code: status.PERMISSION_DENIED, message: 'admin scope required' };`
3. Keep the existing `first` / `userIdFrom` / `HEADER_USER_ID` exports unchanged (still used by the metadata-self RPCs and reused as the acting-admin id source).

**Verification**: Lint + the paired unit test in Step 5 exercise this module. Standalone:
```bash
cd services/xstockstrat-identity && pnpm run lint
```
Confirm `hasAdminAccessScope` and `ADMIN_SCOPE_ERROR` are exported (grep):
```bash
grep -n "hasAdminAccessScope\|ADMIN_SCOPE_ERROR\|ADMIN_SCOPE = 0x04" services/xstockstrat-identity/src/grpc/authz.ts
```

---

### Step 4 — service: Implement the six admin RPCs in the identity servicer

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify

**Reviewers**: xstockstrat-identity owner — JWT expiry/rotation, role scoping, never plaintext secrets; Security — auth scope correctness, last-admin lockout, password hashing

**Codebase Evidence**:
- House style is untyped `async (call, callback)` handlers on `IdentityServiceImpl` (`identityServiceImpl.ts:23-27`, constructor `(pool, config)`); new RPCs follow the metadata-derived-caller pattern of `getUserMetadata` (`:527-557`) which guards `if (!call.metadata?.get)` then `userIdFrom(call.metadata)`.
- `bcrypt` is already imported (`identityServiceImpl.ts:5`) and used with `bcrypt.compare` (`:65`); use `bcrypt.hash(password, 10)` for create/reset (bcrypt cost is not otherwise pinned in this file).
- Seed admin: `admin@localhost`, roles `{admin,trader}`, `is_active=true` (`migrations/002_seed_admin.up.sql:9-15`, per recon) — the identity subject of the AC-11 last-admin guard.
- `authenticateUser` filters `is_active = true` (`identityServiceImpl.ts:57`) and `refreshToken` JOINs `u.is_active = true` (`:150`) — deactivation blocks login/refresh for free (AC-5); no change needed there.
- Refresh-token revocation SQL to reuse for password-reset + deactivate (recon "Patterns to REUSE"): `UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL` (`identityServiceImpl.ts:210-212`) — keyed on the **target** `user_id` (sidesteps the `revokeToken` unsigned-decode finding, recon Risks).
- `Date` (not `{seconds}`) must be returned for `google.protobuf.Timestamp` fields or grpc-js throws INTERNAL (`identityServiceImpl.ts:12-21`, `secondsToDate`); return `new Date(row.created_at)` in the `User` view.
- `first`/`userIdFrom` already imported from `./authz` (`identityServiceImpl.ts:8`); extend that import to add `hasAdminAccessScope`, `ADMIN_SCOPE_ERROR` (added in Step 3).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Extend the authz import: `import { userIdFrom, hasAdminAccessScope, ADMIN_SCOPE_ERROR } from './authz';`.
2. Add a private `Role`-enum↔`TEXT[]` mapping pair (the generated `Role` enum is numeric; DB stores role strings). Map `ROLE_ADMIN→'admin'`, `ROLE_TRADER→'trader'`, `ROLE_VIEWER→'viewer'`; reject/skip `ROLE_UNSPECIFIED` on write inputs. Provide `rolesToStrings(roles: number[]): string[]` and `stringsToRoles(roles: string[]): number[]` (unknown DB strings map to `ROLE_UNSPECIFIED`, kept so the view never drops a stored role silently).
3. **Admin gate every RPC first** (AC-7, C-10(c) — reads gated too, a deliberate divergence from config): at the top of each of the six handlers, guard `if (!call.metadata?.get) return callback({ code: 13, message: 'missing metadata' });` then `if (!hasAdminAccessScope(call.metadata)) return callback(ADMIN_SCOPE_ERROR);`. The acting-admin id is `userIdFrom(call.metadata)` (for the audit payload in Step 6 and the last-admin comparison).
4. `createUser(call, callback)` — validate `email`/`password` non-empty (`code: 3`); `const hash = await bcrypt.hash(password, 10);` map roles (default `['trader']` when empty, matching the column default); `INSERT INTO identity.users (email, password_hash, roles) VALUES ($1,$2,$3) RETURNING user_id, email, roles, is_active, created_at`; on Postgres unique-violation (`err.code === '23505'`) return `{ code: 6, message: 'user already exists' }` (ALREADY_EXISTS). Return `{ user: <User view> }` — never the hash (AC-10).
5. `listUsers` — `SELECT user_id, email, roles, is_active, created_at FROM identity.users ORDER BY created_at`; return `{ users: rows.map(toUserView) }`, no `password_hash` selected (AC-1/AC-10).
6. `getUser` — validate `user_id`; `SELECT ... WHERE user_id = $1`; `code: 5` NOT_FOUND when absent; return `{ user }`.
7. `updatePassword` — admin reset, **no** current-password argument (FR-3); `const hash = await bcrypt.hash(new_password, 10)`; `UPDATE identity.users SET password_hash=$1, updated_at=NOW() WHERE user_id=$2`; `code: 5` if 0 rows; **then** revoke the target's refresh tokens (design R3) via the reuse SQL above keyed on `user_id`. Return empty `UpdatePasswordResponse` (AC-10 — no password/hash echoed).
8. `setUserRoles` — map roles to strings; enforce the **atomic last-admin guard** (design R4, FR-11/AC-11). Use a single conditional UPDATE that refuses to strip `admin` from the final active admin:
   ```sql
   UPDATE identity.users SET roles = $2::text[], updated_at = NOW()
   WHERE user_id = $1
     AND (
       $3 = true  -- new roles still include 'admin'
       OR NOT ('admin' = ANY(roles))  -- target isn't currently an admin
       OR EXISTS (SELECT 1 FROM identity.users
                  WHERE user_id <> $1 AND is_active = true AND 'admin' = ANY(roles))
     )
   RETURNING user_id, email, roles, is_active, created_at
   ```
   where `$3` is a JS boolean = "new roles contain admin". If 0 rows returned **and** the target exists and is the last active admin, return `{ code: 9, message: 'cannot remove last admin' }` (FAILED_PRECONDITION); if the target simply doesn't exist, `code: 5`. Return `{ user }` on success.
9. `setUserActive` — for `active=false`, enforce the same atomic last-admin guard (AC-11): the conditional UPDATE only flips `is_active=false` when the target is not the final active admin (`$2 = true OR NOT('admin'=ANY(roles)) OR EXISTS(other active admin)`), else `code: 9` `'cannot remove last admin'`. For `active=true` no guard. On a successful deactivate, also revoke the target's refresh tokens (design R3). Return `{ user }`.
10. Add a `toUserView(row)` helper returning `{ userId, email, roles: stringsToRoles(row.roles ?? []), isActive: row.is_active, createdAt: new Date(row.created_at) }`.
11. Do **not** add audit/ledger calls here — that is Step 6 (best-effort after commit).

**Verification**: Paired unit test is Step 5. Lint gate here:
```bash
cd services/xstockstrat-identity && pnpm run lint
```
Confirm the last-admin guard SQL and role mapping are present:
```bash
grep -n "cannot remove last admin\|EXISTS (SELECT 1 FROM identity.users\|bcrypt.hash\|hasAdminAccessScope" services/xstockstrat-identity/src/grpc/identityServiceImpl.ts
```

---

### Step 5 — test: Identity admin-RPC unit tests (authz gate + servicer)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify (add cases)

**Reviewers**: xstockstrat-identity owner — role scoping, never plaintext secrets; Security — auth scope correctness, last-admin lockout coverage

**Codebase Evidence**:
- Existing test harness: `node:test` + `assert/strict`; `makePool(rows, throws)` fakes `pool.query`, `makeImpl(rows, throws)` builds the impl with a fake `config.getInt`, `makeCall(req)` and `makeCallWithMetadata(req, userId)` build the `call` object (`src/__tests__/identityServiceImpl.test.ts:42-69`). Extend these to also stamp `x-access-scope`.
- ⚠ **fails.md 2026-07-29 (074) — a graceful-skip guard must not be silent.** The existing test lazy-imports `../grpc/identityServiceImpl.js` in a `try/catch` (`test file:26-36`) and skips on strip-only failure; a suite that reports pass while executing zero assertions is not coverage. The `test:coverage` c8 `--lines 40` gate (`package.json:13`) fails if the import silently no-ops, so it is the backstop — but the new cases must be written to actually resolve and assert (P-06 red-before-green: break one deliberately and watch it go red before relying on the suite).
- Coverage command: `pnpm run test:coverage` = `c8 --lines 40 node --experimental-strip-types --test src/__tests__/*.test.ts` (`package.json:13`); lint = `pnpm run lint` (`:14`).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-10, AC-11`

**Instructions**:
1. Extend `makeCallWithMetadata` (or add `makeAdminCall(req)`) to set `x-access-scope` to the admin bit (`'4'`) and a non-admin variant (`'2'` = trader) for the AC-7 denial cases.
2. **AC-7** — for each of `createUser`, `listUsers`, `getUser`, `updatePassword`, `setUserRoles`, `setUserActive`, assert a non-admin `x-access-scope` yields `callback` with `code === 7` (PERMISSION_DENIED) and no `pool.query` mutation ran (spy the fake pool).
3. **AC-1/AC-10** — `listUsers` with admin scope returns rows whose objects contain `email`, `roles`, `isActive`, `createdAt` and **no** `password`/`passwordHash` key (assert `!('passwordHash' in user)`).
4. **AC-2** — `createUser` with admin scope + a fake pool returning the inserted row calls `bcrypt.hash` (assert the INSERT SQL captured by the fake pool is parameterized with a hash, not the plaintext) and returns a `user` view with `isActive === true`; response has no password field.
5. **AC-3** — `updatePassword` with admin scope issues the `UPDATE ... password_hash` and **then** the `UPDATE identity.refresh_tokens SET revoked_at=NOW() WHERE user_id=$1` (assert both queries fired, in order, via the fake pool's captured SQL); response body is empty (no password/hash).
6. **AC-4** — `setUserRoles` maps `[ROLE_TRADER, ROLE_ADMIN]` → `{trader,admin}` in the UPDATE param and returns the mapped `roles` in the view; a second call with `[ROLE_TRADER]` maps to `{trader}`.
7. **AC-5/AC-6** — `setUserActive(active=false)` fires the `is_active=false` UPDATE **and** the refresh-token revoke; `setUserActive(active=true)` fires only the `is_active=true` UPDATE (no revoke). (The "login blocked/allowed" half of AC-5/AC-6 is structurally guaranteed by the unchanged `is_active` filter at `identityServiceImpl.ts:57,150`; assert that filter is present rather than standing up a DB.)
8. **AC-11** — with a fake pool that returns 0 rows from the guarded UPDATE and a follow-up existence query showing the target is the only active admin, assert both `setUserActive(admin@localhost, active=false)` and `setUserRoles(admin@localhost, [trader])` return `code === 9` (FAILED_PRECONDITION) with message `'cannot remove last admin'`; when another active admin exists, the same calls succeed.
9. Import any reused domain literals per C-13: identity is a Node service; its canonical fixture home is `src/__tests__/fixtures/` and does **not** exist today. Keep test user rows **inline** — a single consumer per literal is compliant (C-13 materializes on the second consumer). State this verdict in the step; do not create a fixture home speculatively.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage
```
Confirm lint passes and `c8` reports total line coverage ≥ 40% **with the new cases actually executing** (not skipped). Sanity-check non-zero assertions by deliberately breaking one expectation and observing a red run before the green (P-06). C-13: confirm no second inline copy of a user literal was introduced —
```bash
grep -n "admin@localhost\|test-user" services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts
```
(single-consumer inline literals pass).

---

### Step 6 — service: Identity → ledger audit client (new plumbing)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/ledgerAudit.ts` — create
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify (emit an audit event after each successful mutation)
- `services/xstockstrat-identity/src/index.ts` — modify (construct the audit client, inject into the servicer)

**Reviewers**: xstockstrat-identity owner — never plaintext secrets, outbound-call correctness; Security — no password/hash in the audit payload, header propagation; xstockstrat-ledger owner — append-only invariant, event shape

**Codebase Evidence**:
- Ledger grpc-js client: `LedgerServiceClient` is a generic client constructor exported at `packages/proto/gen/ts/ledger/v1/ledger.ts:1389` (confirmed via grep, F-04 — not by reading `gen/`); its `new (address, credentials, options?)` signature is at `:1393`. Import subpath mirrors identity's own server import: `@xstockstrat/proto/ledger/v1/ledger` (identity imports its server at `@xstockstrat/proto/identity/v1/identity`, `src/index.ts:5`).
- `AppendEventRequest` shape (`packages/proto/ledger/v1/ledger.proto:33-46`): `event_type`, `source_service`, `correlation_id`, `stream_key`, `payload` (`google.protobuf.Struct`), `metadata` (`map<string,string>`), `occurred_at`, `idempotency_key`.
- Credentials: mirror the server's insecure creds — identity constructs its server with `grpc.ServerCredentials.createInsecure()` (`src/index.ts:54`); the client uses `grpc.credentials.createInsecure()`.
- `LEDGER_ENDPOINT` for identity is already wired: `docker-compose.yml:185-186` (identity block + `WAIT_FOR` on ledger), `.do/app.yaml`/`.do/app.dev.yaml` (recon.md § Dependencies). **No env-plumbing / deployment-file change needed** — only the code that reads `process.env.LEDGER_ENDPOINT` is new.
- Identity is becoming an outbound per-request caller for the first time → **C-03** binds it. The three headers are read from the inbound `call.metadata` (available in every handler) and attached to the outbound grpc-js `Metadata`; `x-trace-id` also becomes the event `correlation_id`. Identity's `src/middleware/propagation.ts` is dead AsyncLocalStorage code (recon Risks) — do **not** revive it; pass the metadata explicitly.
- Pool/DB budget: this is a gRPC client, **not** a new `pg.Pool` — reuse of the single identity `Pool` (max 2, `src/index.ts:32-41`) is unchanged (F-06).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `src/grpc/ledgerAudit.ts` exporting a small `LedgerAudit` class (or factory) that:
   - Constructs `new LedgerServiceClient(process.env.LEDGER_ENDPOINT ?? 'xstockstrat-ledger:50057', grpc.credentials.createInsecure())`.
   - Exposes `async append(eventType, targetUserId, callMetadata, safePayload)` that builds an `AppendEventRequest` with `source_service='xstockstrat-identity'`, `stream_key='user:'+targetUserId`, `correlation_id = first(callMetadata,'x-trace-id')`, `idempotency_key = ` a deterministic key (`` `${eventType}:${targetUserId}:${Date.now()}` ``), `payload` built **only** from the explicit `safePayload` allow-list (never spread the request — AC-8/AC-10), and forwards `x-user-id`/`x-access-scope`/`x-trace-id` from `callMetadata` onto the outbound grpc-js `Metadata` (C-03).
   - Is **best-effort after commit** (design R5): wrap the `appendEvent` in try/catch and `log.error` on failure — never throw back into the mutation path.
2. In `index.ts`, construct the audit client once and pass it to `new IdentityServiceImpl(pool, configWatcher, ledgerAudit)`; extend the constructor signature to accept it (optional, so existing tests that pass `(pool, config)` still work — the audit arg defaults to a no-op).
3. In `identityServiceImpl.ts`, after each **successful** mutation (create / password / roles / active), `await` the audit append with an explicit safe payload:
   - `createUser` → `identity.user.created`, payload `{ acting_admin_user_id, target_user_id, target_email }`.
   - `updatePassword` → `identity.user.password_updated`, payload `{ acting_admin_user_id, target_user_id, target_email }` (**no** password/hash).
   - `setUserRoles` → `identity.user.roles_updated`, payload `{ acting_admin_user_id, target_user_id, target_email, roles: <string[]> }`.
   - `setUserActive` → `identity.user.activated` / `identity.user.deactivated`, payload `{ acting_admin_user_id, target_user_id, target_email, active: <bool> }`.
   `acting_admin_user_id = userIdFrom(call.metadata)`. `listUsers`/`getUser` are reads → no audit.
4. Use `google.protobuf.Struct` for `payload` — the grpc-js generated type expects a Struct; build it from the plain safe-payload object per the ts-proto Struct helper the ledger stub exposes (mirror how other Struct payloads are constructed; do not hand-encode).

**Verification**: Paired test is Step 7. Lint + specifier grep here:
```bash
cd services/xstockstrat-identity && pnpm run lint
grep -n "LedgerServiceClient\|@xstockstrat/proto/ledger/v1/ledger\|createInsecure\|source_service\|user:" services/xstockstrat-identity/src/grpc/ledgerAudit.ts
grep -n "x-trace-id\|x-user-id\|x-access-scope" services/xstockstrat-identity/src/grpc/ledgerAudit.ts
```
Confirm the outbound call forwards the three propagation headers (C-03) and the client import matches the pinned specifier.

---

### Step 7 — test: Identity audit-event unit test

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify (add audit cases) or `src/__tests__/ledgerAudit.test.ts` — create

**Reviewers**: xstockstrat-identity owner — outbound-call correctness; Security — no password/hash in audit payload; xstockstrat-ledger owner — event shape

**Codebase Evidence**:
- The servicer takes the audit client as a constructor arg (Step 6) → inject a fake `LedgerAudit` whose `append` records calls, exactly as `makePool` fakes `pool.query` (`src/__tests__/identityServiceImpl.test.ts:42-49`).
- Best-effort contract: a throwing fake audit must **not** fail the mutation (design R5) — assert the RPC still `callback(null, …)` when the audit append rejects.

**TDD**: `red-green required`

**Covers**: `AC-8, AC-10`

**Instructions**:
1. With admin scope, assert each successful mutation calls the fake `append` exactly once with the right `eventType` and a payload containing `acting_admin_user_id` + `target_user_id` and **no** `password`/`newPassword`/`passwordHash` key (assert absence — AC-8/AC-10).
2. Assert `listUsers`/`getUser` do **not** call `append`.
3. Assert best-effort: when the fake `append` throws/rejects, the mutation RPC still returns success (no rollback, no error surfaced — design R5).
4. Assert the acting-admin id in the payload equals the `x-user-id` from the call metadata (not a request-body field).

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage
```
Confirm the audit cases execute and pass and coverage stays ≥ 40%. Break the "no password in payload" assertion once to confirm it can go red (P-06).

---

### Step 8 — service: Register the six RPCs on the config-ui BFF

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/configUiBff.ts` — modify

**Reviewers**: xstockstrat-ui owner — Connect-RPC call safety, no secret values rendered in UI, config mutation safety

**Codebase Evidence**:
- `configUiBff.ts` registers services on the shared router via `router.service(Service, { ... })` and exports `dispatchConnect = createDispatch(router, '/config-ui/api')` (`services/xstockstrat-ui/src/lib/configUiBff.ts:19-59`).
- BFF helpers (recon "Patterns to REUSE"): `forwardAdmin((req,opts)=>client.method(req,opts))` gates admin + forwards identity headers (`bffShared.ts:75-79`, built on `forward` `:63-72` + `backendHeaders` `:41-47` which sets `x-user-id`/`x-access-scope`/`x-trace-id`); `requireAdminScope(claims)` throws PermissionDenied (`bffShared.ts:50-54`). `setConfig` is the precedent for an explicit-body handler that must not echo a sensitive field (`configUiBff.ts:21-43`).
- Reusable typed identity client: `identityClient = createClient(IdentityService, makeTransport(IDENTITY_ENDPOINT))` (`services/xstockstrat-ui/src/lib/connectClients.ts:35`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Import `IdentityService` from `@xstockstrat/proto/identity/v1/identity_pb` and `identityClient` from `@/lib/connectClients`.
2. Add a `router.service(IdentityService, { ... })` block registering the six methods:
   - `listUsers`, `getUser`, `setUserRoles`, `setUserActive` via `forwardAdmin((req, opts) => identityClient.<method>(req, opts))` (both reads are admin-gated server-side too, but `forwardAdmin` keeps the UI honest).
   - `createUser`, `updatePassword` — keep an **explicit body** that calls `requireSession` + `requireAdminScope` then forwards `{ ...req }` with `backendHeaders(claims, ctx)` (mirror `setConfig`, `configUiBff.ts:21-43`). The password stays in the request body forwarded to the backend but is **never** logged or echoed back (AC-10). Do not inject or rewrite the password.
   - Because `IdentityService` has other methods (auth/OAuth/metadata) not registered here, only these six are reachable through config-ui — connect-node leaves the rest unimplemented (same pattern as the `AnalysisService` single-method registration, `configUiBff.ts:51-55`).
3. Header propagation is satisfied by reuse: `forwardAdmin`/the explicit body both call `backendHeaders` which already forwards `x-user-id`/`x-access-scope`/`x-trace-id` (`bffShared.ts:41-47`) — cite this, no new propagation code.

**Verification**: Covered by the Step 10 e2e (config-ui BFF RPC round-trips). Lint gate:
```bash
cd services/xstockstrat-ui && pnpm run lint
grep -n "IdentityService\|forwardAdmin\|requireAdminScope\|createUser\|updatePassword" services/xstockstrat-ui/src/lib/configUiBff.ts
```
Confirm all six methods are registered and the two password-carrying methods use an admin-gated explicit body.

---

### Step 9 — service: config-ui "Users" section (pages, nav, browser client, Role label map)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/users/page.tsx` — create (user list + create/reset/roles/activate actions)
- `services/xstockstrat-ui/src/lib/browserClients/configUiIdentityClient.ts` — create
- `services/xstockstrat-ui/src/components/shared/navGroups.tsx` — modify (add "Users" nav entry)
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify (add "Users" to `PLATFORM_SUBNAV.config`)
- `services/xstockstrat-ui/src/lib/roleLabels.ts` — create (exhaustive `Record<Role, string>` map, C-10(a/d))

**Reviewers**: xstockstrat-ui owner — Trading/analytics display, no secret values rendered in UI, admin route correctness

**Codebase Evidence**:
- Admin CRUD page template + state/table/dialog primitives (recon "Patterns to REUSE"): `src/app/config-ui/sources/page.tsx`; `components/ui/data-table.tsx`, `components/ui/alert-dialog.tsx` (deactivate confirm), `components/shared/{FormDialog,EmptyState,CardNotice,QueryStateMessages}.tsx` (C-17 state primitives).
- Browser client pattern: a per-segment client built on `makeBrowserTransport('/config-ui/api')` (mirror `traderConfigClient.ts:10-11`, which does `makeBrowserTransport('/trader/api')` + `createClient(ConfigService, transport)`); use `IdentityService` from `@xstockstrat/proto/identity/v1/identity_pb`.
- Nav model (single source of truth, feature 083): `NAV_GROUPS` in `navGroups.tsx`; `NavItem.adminOnly` hides an entry from non-admins for free via `visibleItems = items.filter(i => !i.adminOnly || isAdmin)` (`PlatformHeader.tsx:203`), with `Backfills` as the exact `adminOnly:true` precedent (`navGroups.tsx:67`). Settings group items are `navGroups.tsx:85-96`.
- Legacy secondary nav `PLATFORM_SUBNAV.config` = Namespaces / Audit Log / Sources (`PlatformHeader.tsx:86-90`).
- Exhaustive-enum-map obligation (fails.md 2026-07-21, C-10(a/d)): the `Role` enum added in Step 1 forces an exhaustive `Record<Role, …>` in the UI or `tsc`/`pnpm build` fails (precedent: `src/lib/opportunityShared.tsx` enum maps; xstockstrat-ui CLAUDE.md § Enum render maps).
- C-17 tokens/primitives: use design-role tokens (`bg-background`/`text-destructive`/etc.) and canonical state primitives — no hardcoded colors, unique accessible names on every control.

**TDD**: `N/A (frontend page — behavior verified by the Step 10 e2e; no unit-coverage threshold for xstockstrat-ui pages)`

**Covers**: —

**Instructions**:
1. Create `configUiIdentityClient.ts`: `const transport = makeBrowserTransport('/config-ui/api'); export const configUiIdentityClient = createClient(IdentityService, transport);` (mirrors `traderConfigClient.ts`).
2. Create `src/lib/roleLabels.ts`: an exhaustive `Record<Role, string>` (`ROLE_UNSPECIFIED→'—'`, `ROLE_ADMIN→'Admin'`, `ROLE_TRADER→'Trader'`, `ROLE_VIEWER→'Viewer'`) so a future enum value fails `tsc` here (C-10(a/d)). Add a `rolesLabel(roles: Role[])` helper if convenient.
3. Create `src/app/config-ui/users/page.tsx` templated off `config-ui/sources/page.tsx`:
   - A `DataTable` of users (email, roles via `roleLabels`, active status, created date) — AC-1/AC-9. Route loading/empty/error through `QueryStateMessages`/`EmptyState`/`Skeleton` (C-17).
   - A "Create user" `FormDialog` (email, password, role multi-select) → `configUiIdentityClient.createUser`. The password field is write-only (never rendered back) — AC-10.
   - A "Reset password" `FormDialog` (new password) → `updatePassword`. Write-only field.
   - A roles editor (multi-select) → `setUserRoles`.
   - A deactivate/reactivate control gated behind an `alert-dialog` confirm → `setUserActive`; surface the `FAILED_PRECONDITION`/`PERMISSION_DENIED` errors via `CardNotice` (AC-11 last-admin message shown, not swallowed).
   - Never render a password or password hash anywhere (AC-10).
4. Register the nav entry in `navGroups.tsx` — add to the Settings group `items` array (`navGroups.tsx:85-96`): `{ label: 'Users', href: '/config-ui/users', adminOnly: true }` (exact `Backfills` `adminOnly:true` precedent). This makes it admin-hidden for free (`visibleItems`, `PlatformHeader.tsx:203`) — FR-7/AC-9.
5. Add `{ label: 'Users', href: '/config-ui/users' }` to `PLATFORM_SUBNAV.config` (`PlatformHeader.tsx:86-90`) so the config secondary nav lists it (AC-9).
6. Use only design-role tokens and existing `ui/*` primitives + variants (C-17); give every icon-only/action control a unique accessible name.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
```
`pnpm run build` (tsc) must pass — proving the exhaustive `Record<Role,…>` map covers every enum value (C-10(a/d)). Confirm the nav registration:
```bash
grep -n "config-ui/users" services/xstockstrat-ui/src/components/shared/navGroups.tsx services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx
```

---

### Step 10 — test: config-ui Users e2e (list, actions, nav reachability)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/users.spec.ts` — create
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (mock the six `IdentityService` methods)
- `services/xstockstrat-ui/e2e/fixtures/users.ts` — modify (add a `User`-view fixture)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog the new fixture)

**Reviewers**: xstockstrat-ui owner — display accuracy, admin route correctness, no secret rendered

**Codebase Evidence**:
- e2e layout: specs under `e2e/config-ui/` (e.g. `sources.spec.ts`), mock gRPC backend `e2e/mock-backend.ts`, auth helpers `e2e/helpers/auth.ts` (recon; xstockstrat-ui CLAUDE.md § Testing). No coverage threshold — Playwright e2e is the gate.
- Existing `users.ts` fixture holds identity constants only (`TEST_USER_ID`/`TEST_USER_EMAIL` + a second user `TEST_USER_B_*`, `e2e/fixtures/users.ts:9-18`) — there is **no** `User`-view row object yet, so this feature adds one (a new domain object → fixture module extension + `INVENTORY.md` row, C-12).
- Nav-reachability precedent (C-10(a), fails.md 2026-07-01/060): a new page must have a test that walks the rendered shell to the page. ⚠ fails.md 2026-08-09 (shadcn) — when a page's nav/breadcrumb uses `getByRole`/`getByLabel`, grep the suite for colliding accessible names before asserting; run at least once against a broader scope.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-8, AC-9, AC-10, AC-11`

**Instructions**:
1. Extend `e2e/fixtures/users.ts` with an exported `User`-view fixture (Connect-JSON camelCase per proto: `{ userId, email, roles: [Role...], isActive, createdAt }`) and a small list for the table; add its catalog row to `e2e/fixtures/INVENTORY.md` (C-12). Reuse `TEST_USER_ID`/`TEST_USER_EMAIL` for the primary row rather than a new literal.
2. In `e2e/mock-backend.ts`, add handlers for the six `IdentityService` methods returning the fixture (list/get return `User` views with **no** password/hash; create/reset return their empty/`User` responses). Model a non-admin session returning `PERMISSION_DENIED`, and a last-admin `FAILED_PRECONDITION` for the AC-11 case.
3. `users.spec.ts` (signed in as admin via `e2e/helpers/auth.ts`):
   - **AC-9 nav reachability** — from the shell, open the config-ui navigation and click the "Users" entry; assert the URL is `/config-ui/users` and the user list renders email/roles/active/created columns. Grep the suite for colliding `getByRole('link'|...)`/`getByLabel` names before locking the locator (fails.md 2026-08-09).
   - **AC-1/AC-10** — the rendered rows show email/roles/status/created and **no** password/hash text anywhere on the page.
   - **AC-11** — the deactivate/demote action on the last admin surfaces the `'cannot remove last admin'` message (mock returns FAILED_PRECONDITION) and the row stays active/admin.
   - **AC-8 (surface)** — a successful create/reset/roles/activate action completes without error (the ledger audit is a backend concern proven in Step 7; here assert the mutation round-trips through the BFF).
4. Import fixtures from `../fixtures` and auth from `../helpers/auth` — never inline domain literals (C-12).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -- config-ui/users.spec.ts
```
Then a broader run to catch nav-locator collisions (fails.md 2026-08-09):
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- config-ui
```
Confirm the suite passes and fixtures are imported (not inline):
```bash
grep -n "from '../fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/config-ui/users.spec.ts
grep -n "Users\|User view" services/xstockstrat-ui/e2e/fixtures/INVENTORY.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
