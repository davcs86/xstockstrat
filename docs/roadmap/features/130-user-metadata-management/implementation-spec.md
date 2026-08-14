# Implementation Spec: user-metadata-management

**Status**: `pending`
**Created**: 2026-08-14
**Feature**: `docs/roadmap/features/130-user-metadata-management/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/user-metadata-management`

---

## Execution Summary

Implementation proceeds bottom-up: proto contract first, then migration, then the identity service
handlers (with their new `authz.ts` module), then the UI REST route and page (including a DRY
`restBackendHeaders` extraction), then the agent client and tools, and finally documentation. The
proto and migration steps are non-code-bearing foundations; every service step is paired with a test
step immediately after (or batched where the tests exercise the prior service step). The UI profile
page deviates from product spec FR-6 (`/config-ui/profile`) to `/accounts/profile` — user-approved
in the design phase; this spec updates the product spec accordingly.

## Step Dependencies

- Step 2 requires Step 1: proto-gen depends on proto changes
- Step 4 requires Step 3: authz module is added to the identity service after migration lands
- Step 5 requires Step 4: identity handlers import `userIdFrom` from the authz module (Step 4)
- Step 6 requires Steps 4+5: identity handler tests exercise the handlers (Step 5) and include dedicated unit tests for the authz module (Step 4)
- Step 7 requires Step 2: UI REST route imports generated proto types
- Step 8 requires Step 7: profile page calls the API route from Step 7
- Step 9 requires Step 8: E2E test navigates to the page from Step 8
- Step 10 requires Step 2: agent client imports generated proto stubs
- Step 11 requires Step 10: agent tools call the client wrappers from Step 10
- Step 12 requires Steps 10+11: agent tool tests exercise tool registration (Step 11) and include functional tests for the client wrapper methods (Step 10)
- Step 13 requires Step 11: docs reference the tools from Step 11

---

### Step 1 — proto: Add UserMetadata messages and RPCs to identity.proto

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/identity/v1/identity.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, `buf lint`/`buf breaking` pass; Service owner: `xstockstrat-identity` — JWT expiry and rotation, API key scoping, secret store integration

**Codebase Evidence**:
- Confirmed via: `identity.proto:9-27` → existing `IdentityService` with 11 RPCs, no user metadata RPCs
- Confirmed via: `identity.proto:1` → `syntax = "proto3";`, `import "google/protobuf/timestamp.proto"` already present at line 7
- Confirmed via: recon.md:54 → highest field numbers across all existing messages (max 6 on `TokenClaims`)
- Confirmed via: design.md:14-27 → approved proto design specifies `GetUserMetadata` (empty request), `UpdateUserMetadata` (optional phone, display_name, metadata; NO email field)

**TDD**: N/A (proto — non-code-bearing)

**Instructions**:

1. Add `import "google/protobuf/struct.proto";` after the existing `import "google/protobuf/timestamp.proto";` at line 7.

2. Add two RPCs to the `IdentityService` block after `RevokeAuthorizedApp` (line 26):
   ```protobuf
   // User profile metadata self-management (feature 130)
   rpc GetUserMetadata(GetUserMetadataRequest) returns (GetUserMetadataResponse);
   rpc UpdateUserMetadata(UpdateUserMetadataRequest) returns (UpdateUserMetadataResponse);
   ```

3. Add the following messages after the `RevokeAuthorizedAppResponse` message (after line 113):
   ```protobuf
   // ── User profile metadata (feature 130) ──────────────────────────────────
   message UserMetadata {
     string user_id = 1;
     string email = 2;
     optional string phone = 3;
     optional string display_name = 4;
     google.protobuf.Struct metadata = 5;
     google.protobuf.Timestamp metadata_updated_at = 6;
   }
   message GetUserMetadataRequest {}
   message GetUserMetadataResponse { UserMetadata user_metadata = 1; }
   message UpdateUserMetadataRequest {
     optional string phone = 1;
     optional string display_name = 2;
     optional google.protobuf.Struct metadata = 3;
   }
   message UpdateUserMetadataResponse { UserMetadata user_metadata = 1; }
   ```

   Key design decisions:
   - `GetUserMetadataRequest` is empty — the caller identity comes from the `x-user-id` gRPC metadata header (C-03), not the request body.
   - `UpdateUserMetadataRequest` has **no email field** — email is a login credential and is read-only in all consumers (design.md rejected alternative).
   - `optional` keyword on `phone`, `display_name`, `metadata` enables presence tracking: ts-proto yields `undefined` for absent fields (partial update semantics).
   - Field numbers start at 1 for each new message (no collision — these are new message types).

**Verification**:
```bash
cd /home/user/xstockstrat/packages/proto && buf lint && buf breaking --against '.git#branch=main-dev'
```
Both commands exit 0.

---

### Step 2 — proto-gen: Regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/ts/` — modify (generated)
- `packages/proto/gen/python/` — modify (generated)
- `packages/proto/gen/go/` — modify (generated)

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, `buf lint`/`buf breaking` pass; Service owner: `xstockstrat-identity` — JWT expiry and rotation, API key scoping, secret store integration

**Codebase Evidence**:
- Confirmed via: root CLAUDE.md §Generating Proto Stubs → `./scripts/buf-gen.sh` generates TS, Python, and Go stubs
- Confirmed via: `packages/proto/buf.gen.yaml` governs codegen output

**TDD**: N/A (proto-gen — non-code-bearing)

**Instructions**:

1. Run `./scripts/buf-gen.sh` from the repo root.
2. Verify the generated stubs include the new messages and RPCs:
   - TS: `packages/proto/gen/ts/` should contain `GetUserMetadata`, `UpdateUserMetadata`, `UserMetadata` types
   - Python: `packages/proto/gen/python/identity/v1/identity_pb2.py` should contain the new message descriptors
   - Go: `packages/proto/gen/go/identity/v1/` should contain the new types

**Verification**:
```bash
cd /home/user/xstockstrat && ./scripts/buf-gen.sh
# confirm new types exist in generated output:
grep -l 'UserMetadata' packages/proto/gen/ts/dist/identity/v1/*.js
grep -l 'UserMetadata' packages/proto/gen/python/identity/v1/identity_pb2.py
```

---

### Step 3 — migration: Add metadata columns to identity.users

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/migrations/006_user_metadata.up.sql` — create
- `services/xstockstrat-identity/migrations/006_user_metadata.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present, index correctness; Service owner: `xstockstrat-identity` — JWT expiry and rotation, API key scoping, secret store integration

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-identity/migrations/` → last is `005_drop_api_keys.{up,down}.sql`, so next is `006`
- Confirmed via: recon.md:21 → `identity.users` already has `email TEXT NOT NULL UNIQUE` from migration 001 — do NOT add email
- Confirmed via: design.md:32-38 → approved migration adds `phone`, `display_name`, `metadata` (JSONB with 8KB CHECK), `metadata_updated_at`

**TDD**: N/A (migration — non-code-bearing)

**Instructions**:

1. Create `006_user_metadata.up.sql`:
   ```sql
   ALTER TABLE identity.users
     ADD COLUMN phone TEXT,
     ADD COLUMN display_name TEXT,
     ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}',
     ADD COLUMN metadata_updated_at TIMESTAMPTZ;

   ALTER TABLE identity.users
     ADD CONSTRAINT users_metadata_size CHECK (octet_length(metadata::text) <= 8192);
   ```

2. Create `006_user_metadata.down.sql`:
   ```sql
   ALTER TABLE identity.users DROP CONSTRAINT IF EXISTS users_metadata_size;
   ALTER TABLE identity.users
     DROP COLUMN IF EXISTS metadata_updated_at,
     DROP COLUMN IF EXISTS metadata,
     DROP COLUMN IF EXISTS display_name,
     DROP COLUMN IF EXISTS phone;
   ```

   Key points:
   - `email` is NOT added — it already exists from migration 001 (`TEXT NOT NULL UNIQUE`).
   - `metadata JSONB NOT NULL DEFAULT '{}'` with an 8 KB size constraint prevents unbounded growth.
   - `.down.sql` drops in reverse order and uses `IF EXISTS` for idempotent rollback.

**Verification**:
```bash
ls services/xstockstrat-identity/migrations/006_user_metadata.up.sql \
   services/xstockstrat-identity/migrations/006_user_metadata.down.sql
# then read both: confirm every ADD COLUMN in .up has an inverse DROP COLUMN in .down;
# confirm the CHECK constraint is dropped in .down
```

---

### Step 4 — service: Identity authz.ts module

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/authz.ts` — create

**Reviewers**: Service owner: `xstockstrat-identity` — JWT expiry and rotation, API key scoping, secret store integration

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-config/src/grpc/authz.ts:34,51` → `first(md, key)` and `userIdFrom(md)` accessor pattern to replicate
- Confirmed via: design.md:46-48 → new `src/grpc/authz.ts` module replicating the config service's pattern
- Confirmed via: `identityServiceImpl.ts:461-462` → existing handlers use `call.request.userId` (request body), new handlers use `call.metadata` (first use in identity service)

**TDD**: red-green required

**Instructions**:

1. Create `services/xstockstrat-identity/src/grpc/authz.ts` following the `xstockstrat-config` pattern at `services/xstockstrat-config/src/grpc/authz.ts:19-53`:

   ```typescript
   /**
    * Authorization helpers for the identity gRPC service.
    *
    * Identity is the auth provider (not a consumer), so it historically read user_id
    * from the request body. New self-management RPCs (GetUserMetadata, UpdateUserMetadata)
    * follow the platform header-propagation pattern (C-03): the caller's user_id comes from
    * the propagated x-user-id gRPC metadata header, not the request body.
    *
    * Unlike listAuthorizedApps/revokeAuthorizedApp (which accept userId in the request body),
    * these RPCs derive the caller from the propagated x-user-id metadata header (C-03). New
    * identity RPCs should follow this pattern.
    */
   import { Metadata } from '@grpc/grpc-js';

   export const HEADER_USER_ID = 'x-user-id';

   /** Read a single metadata value, or '' when absent. */
   export function first(md: Metadata | undefined, key: string): string {
     if (!md) return '';
     return (md.get(key)[0] as string) ?? '';
   }

   /** The propagated caller id, or '' when absent. */
   export function userIdFrom(md?: Metadata): string {
     return first(md, HEADER_USER_ID);
   }
   ```

   This is a minimal subset of config's `authz.ts` — identity does not need admin-scope or internal-caller checks (those live in config). Only `first`, `userIdFrom`, and `HEADER_USER_ID` are needed.

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-identity && pnpm run lint
```

---

### Step 5 — service: Identity getUserMetadata and updateUserMetadata handlers

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify

**Reviewers**: Service owner: `xstockstrat-identity` — JWT expiry and rotation, API key scoping, secret store integration

**Codebase Evidence**:
- Confirmed via: `identityServiceImpl.ts:22` → `class IdentityServiceImpl` with constructor `(pool: Pool, config: ConfigWatcher)`
- Confirmed via: `identityServiceImpl.ts:461-492` → `listAuthorizedApps` pattern: `async methodName(call: any, callback: any)`, userId from `call.request`, `this.pool.query()`, `callback(null, {...})` / `callback({code, message})`
- Confirmed via: `index.ts:47-49` → `identityImpl as unknown as grpc.UntypedServiceImplementation` cast silently masks missing handlers
- Confirmed via: design.md:44-67 → both handlers extract caller via `userIdFrom(call.metadata)`, runtime guard on `call.metadata?.get`

**TDD**: red-green required

**Instructions**:

1. Add import at top of `identityServiceImpl.ts`:
   ```typescript
   import { userIdFrom } from './authz';
   ```

2. Add `getUserMetadata` method to `IdentityServiceImpl` (after `revokeAuthorizedApp`):
   ```typescript
   /**
    * GetUserMetadata — return the calling user's own profile metadata.
    *
    * Unlike listAuthorizedApps/revokeAuthorizedApp (which accept userId in the request body),
    * this RPC derives the caller from the propagated x-user-id metadata header (C-03). New
    * identity RPCs should follow this pattern.
    */
   async getUserMetadata(call: any, callback: any) {
     if (!call.metadata?.get) {
       return callback({ code: 13, message: 'missing metadata' });
     }
     const userId = userIdFrom(call.metadata);
     if (!userId) return callback({ code: 3, message: 'x-user-id header required' });
     try {
       const result = await this.pool.query(
         `SELECT user_id, email, phone, display_name, metadata, metadata_updated_at
          FROM identity.users WHERE user_id = $1`,
         [userId]
       );
       if (result.rows.length === 0) {
         return callback({ code: 5, message: 'user not found' });
       }
       const r = result.rows[0];
       callback(null, {
         userMetadata: {
           userId: r.user_id,
           email: r.email,
           phone: r.phone ?? undefined,
           displayName: r.display_name ?? undefined,
           metadata: r.metadata ? JSON.parse(JSON.stringify(r.metadata)) : {},
           metadataUpdatedAt: r.metadata_updated_at ? new Date(r.metadata_updated_at) : undefined,
         },
       });
     } catch (err: any) {
       log.error('getUserMetadata failed', { error: err.message });
       callback({ code: 13, message: err.message });
     }
   }
   ```

3. Add `updateUserMetadata` method:
   ```typescript
   /**
    * UpdateUserMetadata — partial-update the calling user's own profile metadata.
    *
    * Unlike listAuthorizedApps/revokeAuthorizedApp (which accept userId in the request body),
    * this RPC derives the caller from the propagated x-user-id metadata header (C-03). New
    * identity RPCs should follow this pattern.
    */
   async updateUserMetadata(call: any, callback: any) {
     if (!call.metadata?.get) {
       return callback({ code: 13, message: 'missing metadata' });
     }
     const userId = userIdFrom(call.metadata);
     if (!userId) return callback({ code: 3, message: 'x-user-id header required' });
     const { phone, displayName, metadata } = call.request;
     // Build dynamic SET clause from non-undefined optional fields (ts-proto optional presence)
     const sets: string[] = [];
     const params: any[] = [];
     let idx = 1;
     if (phone !== undefined) { sets.push(`phone = $${idx++}`); params.push(phone); }
     if (displayName !== undefined) { sets.push(`display_name = $${idx++}`); params.push(displayName); }
     if (metadata !== undefined) { sets.push(`metadata = $${idx++}`); params.push(JSON.stringify(metadata)); }
     if (sets.length === 0) {
       return callback({ code: 3, message: 'at least one field required' });
     }
     sets.push(`metadata_updated_at = NOW()`);
     params.push(userId);
     try {
       const result = await this.pool.query(
         `UPDATE identity.users SET ${sets.join(', ')} WHERE user_id = $${idx}
          RETURNING user_id, email, phone, display_name, metadata, metadata_updated_at`,
         params
       );
       if (result.rows.length === 0) {
         return callback({ code: 5, message: 'user not found' });
       }
       const r = result.rows[0];
       callback(null, {
         userMetadata: {
           userId: r.user_id,
           email: r.email,
           phone: r.phone ?? undefined,
           displayName: r.display_name ?? undefined,
           metadata: r.metadata ? JSON.parse(JSON.stringify(r.metadata)) : {},
           metadataUpdatedAt: r.metadata_updated_at ? new Date(r.metadata_updated_at) : undefined,
         },
       });
     } catch (err: any) {
       log.error('updateUserMetadata failed', { error: err.message });
       callback({ code: 13, message: err.message });
     }
   }
   ```

   Key points:
   - TS camelCase trap (recon.md:86 / fails.md `fix-mcp-config-key-registry`): handler reads `call.request.displayName` (camelCase), not `call.request.display_name`.
   - Response uses camelCase field names (`userId`, `displayName`, `metadataUpdatedAt`) to match ts-proto output.
   - Runtime guard `if (!call.metadata?.get)` is defence in depth — first `call.metadata` use in this service.
   - `metadata` column is JSONB; `JSON.stringify` on write, the driver auto-parses on read.

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-identity && pnpm run lint
```

---

### Step 6 — test: Identity handler unit tests

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify

**Reviewers**: Service owner: `xstockstrat-identity` — JWT expiry and rotation, API key scoping, secret store integration

**Codebase Evidence**:
- Confirmed via: `identityServiceImpl.test.ts:37-55` → `makePool(rows, throws)`, `makeImpl(rows, throws)`, `makeCall(req)` helpers
- Confirmed via: `identityServiceImpl.test.ts:13-14` → uses `node:test` (`describe`, `it`, `before`) + `node:assert/strict`
- Confirmed via: `package.json:13` → `"test:coverage": "c8 --reporter=text --reporter=lcov --lines 40 ..."`
- Confirmed via: design.md:64-70 → smoke test for handler registration + dual-codegen round-trip test

**TDD**: red-green required

**Instructions**:

1. Add a new `makeCallWithMetadata` helper alongside the existing `makeCall` at line 53:
   ```typescript
   function makeCallWithMetadata(req: any, userId: string) {
     return {
       request: req,
       metadata: {
         get: (key: string) => key === 'x-user-id' ? [userId] : [],
       },
     };
   }
   ```

2. Add a test section for `getUserMetadata`:
   ```typescript
   describe('getUserMetadata', () => {
     it('returns NOT_FOUND (code 5) when user does not exist', async () => {
       const impl = makeImpl([]);
       if (!impl) return;
       await new Promise<void>((resolve) => {
         impl.getUserMetadata(
           makeCallWithMetadata({}, 'nonexistent-user'),
           (err: any) => {
             assert.equal(err.code, 5);
             resolve();
           }
         );
       });
     });

     it('returns user metadata for an existing user', async () => {
       const row = {
         user_id: 'u1', email: 'a@b.com', phone: '+1234',
         display_name: 'Alice', metadata: {}, metadata_updated_at: new Date(),
       };
       const impl = makeImpl([row]);
       if (!impl) return;
       await new Promise<void>((resolve) => {
         impl.getUserMetadata(
           makeCallWithMetadata({}, 'u1'),
           (err: any, res: any) => {
             assert.equal(err, null);
             assert.equal(res.userMetadata.userId, 'u1');
             assert.equal(res.userMetadata.email, 'a@b.com');
             assert.equal(res.userMetadata.phone, '+1234');
             resolve();
           }
         );
       });
     });

     it('rejects when call.metadata is missing', async () => {
       const impl = makeImpl([]);
       if (!impl) return;
       await new Promise<void>((resolve) => {
         impl.getUserMetadata(
           makeCall({}),
           (err: any) => {
             assert.equal(err.code, 13);
             resolve();
           }
         );
       });
     });
   });
   ```

3. Add a test section for `updateUserMetadata`:
   ```typescript
   describe('updateUserMetadata', () => {
     it('rejects when no fields are provided', async () => {
       const impl = makeImpl([]);
       if (!impl) return;
       await new Promise<void>((resolve) => {
         impl.updateUserMetadata(
           makeCallWithMetadata({}, 'u1'),
           (err: any) => {
             assert.equal(err.code, 3);
             resolve();
           }
         );
       });
     });

     it('partial update: sets phone only, preserves display_name', async () => {
       const row = {
         user_id: 'u1', email: 'a@b.com', phone: '+9999',
         display_name: 'Alice', metadata: {}, metadata_updated_at: new Date(),
       };
       const impl = makeImpl([row]);
       if (!impl) return;
       await new Promise<void>((resolve) => {
         impl.updateUserMetadata(
           makeCallWithMetadata({ phone: '+9999' }, 'u1'),
           (err: any, res: any) => {
             assert.equal(err, null);
             assert.equal(res.userMetadata.phone, '+9999');
             assert.equal(res.userMetadata.displayName, 'Alice');
             resolve();
           }
         );
       });
     });
   });
   ```

4. Add a smoke test for handler registration:
   ```typescript
   describe('handler registration (smoke)', () => {
     it('getUserMetadata is a callable method on the prototype', () => {
       if (!IdentityServiceImpl) return;
       assert.equal(typeof IdentityServiceImpl.prototype.getUserMetadata, 'function');
     });

     it('updateUserMetadata is a callable method on the prototype', () => {
       if (!IdentityServiceImpl) return;
       assert.equal(typeof IdentityServiceImpl.prototype.updateUserMetadata, 'function');
     });
   });
   ```

5. Add dedicated unit tests for the `authz.ts` module (Step 4) — these cover `userIdFrom` and `first` directly, not only indirectly through the handler tests above:
   ```typescript
   describe('authz: userIdFrom / first', () => {
     // Import the module under test — path: src/grpc/authz.ts
     // const { userIdFrom, first } = require('../grpc/authz');

     it('userIdFrom extracts x-user-id from metadata', () => {
       const md = { get: (key: string) => key === 'x-user-id' ? ['uid-123'] : [] };
       assert.equal(userIdFrom(md), 'uid-123');
     });

     it('userIdFrom throws UNAUTHENTICATED when x-user-id is absent', () => {
       const md = { get: () => [] };
       assert.throws(() => userIdFrom(md), /UNAUTHENTICATED|user/i);
     });

     it('first returns the first element of a metadata array', () => {
       const md = { get: (key: string) => key === 'x-trace-id' ? ['t1', 't2'] : [] };
       assert.equal(first(md, 'x-trace-id'), 't1');
     });

     it('first returns undefined for a missing key', () => {
       const md = { get: () => [] };
       assert.equal(first(md, 'x-missing'), undefined);
     });
   });
   ```

   C-13 (test data, non-frontend): The `row` literal used in the test is a single-consumer inline fixture. No second consumer exists after this step — compliant as inline. The `md` mock objects in the authz tests are similarly single-consumer.

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-identity && pnpm run test:coverage && pnpm run lint
```
Coverage threshold: 40% (lines). Both commands exit 0.

---

### Step 7 — service: UI restBackendHeaders extraction + profile API route

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/restBackendHeaders.ts` — create
- `services/xstockstrat-ui/src/app/accounts/api/profile/route.ts` — create
- `services/xstockstrat-ui/src/app/accounts/api/authorized-apps/route.ts` — modify

**Reviewers**: Service owner: `xstockstrat-ui` — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access

**Codebase Evidence**:
- Confirmed via: `authorized-apps/route.ts:11-17` → local `backendHeaders(req, userId, roles)` function — DRY target for extraction
- Confirmed via: `headers.ts:12-14` → `HEADER_USER_ID`, `HEADER_ACCESS_SCOPE`, `HEADER_TRACE_ID` constants
- Confirmed via: `auth.ts:4` → `getSessionFromRequest`, `rolesToAccessScope`, `generateTraceId` exports
- Confirmed via: `connectClients.ts:35` → `identityClient` already exists
- Confirmed via: design.md:79-87 → `src/app/accounts/api/profile/route.ts` (GET + PUT), DRY `restBackendHeaders` extraction

**TDD**: red-green required

**Instructions**:

1. **Extract `restBackendHeaders` shared helper** — create `services/xstockstrat-ui/src/lib/restBackendHeaders.ts`:
   ```typescript
   /**
    * Platform-internal propagation headers for plain Next.js routes (NextRequest,
    * not a Connect HandlerContext). Extracted from the local backendHeaders in
    * authorized-apps/route.ts to avoid a third copy when the profile route was added
    * (design.md DRY fix, context-constitution-findings.md:19).
    */
   import { NextRequest } from 'next/server';
   import { rolesToAccessScope, generateTraceId } from '@/lib/auth';
   import { HEADER_USER_ID, HEADER_ACCESS_SCOPE, HEADER_TRACE_ID } from '@/lib/headers';

   export function restBackendHeaders(req: NextRequest, userId: string, roles: string[]): Headers {
     return new Headers({
       [HEADER_USER_ID]: userId,
       [HEADER_ACCESS_SCOPE]: String(rolesToAccessScope(roles)),
       [HEADER_TRACE_ID]: req.headers.get(HEADER_TRACE_ID) ?? generateTraceId(),
     });
   }
   ```

2. **Refactor `authorized-apps/route.ts`** — replace the local `backendHeaders` function (lines 11-17) with an import from the shared helper:
   - Remove the local `function backendHeaders(...)` and the imports it used that are now only needed by `restBackendHeaders.ts` (but keep `HEADER_TRACE_ID` if still used elsewhere in the file — check; it is only used by `backendHeaders`, so its import moves to the shared helper).
   - Add `import { restBackendHeaders } from '@/lib/restBackendHeaders';`
   - Replace `backendHeaders(req, ...)` calls with `restBackendHeaders(req, ...)`.
   - The unused imports (`HEADER_USER_ID`, `HEADER_ACCESS_SCOPE`, `HEADER_TRACE_ID`, `rolesToAccessScope`, `generateTraceId`) are removed from this file — they now live in `restBackendHeaders.ts`.

3. **Create profile API route** — create `services/xstockstrat-ui/src/app/accounts/api/profile/route.ts`:
   ```typescript
   import { NextRequest, NextResponse } from 'next/server';
   import { ConnectError } from '@connectrpc/connect';
   import { identityClient, connectCodeToHttp } from '@/lib/connectClients';
   import { getSessionFromRequest } from '@/lib/auth';
   import { restBackendHeaders } from '@/lib/restBackendHeaders';

   function tsToISO(ts?: { seconds: bigint; nanos: number }): string | null {
     if (!ts) return null;
     return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
   }

   // GET /accounts/api/profile — the calling user's own metadata.
   export async function GET(req: NextRequest) {
     const claims = await getSessionFromRequest(req);
     if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
     try {
       const headers = restBackendHeaders(req, claims.user_id, claims.roles);
       const data = await identityClient.getUserMetadata({}, { headers });
       const m = data.userMetadata;
       return NextResponse.json({
         userId: m?.userId ?? '',
         email: m?.email ?? '',
         phone: m?.phone ?? null,
         displayName: m?.displayName ?? null,
         metadata: m?.metadata ?? {},
         metadataUpdatedAt: tsToISO(m?.metadataUpdatedAt),
       });
     } catch (err) {
       const ce = ConnectError.from(err);
       return NextResponse.json(
         { error: ce.rawMessage || 'Failed to fetch profile' },
         { status: connectCodeToHttp(ce.code) },
       );
     }
   }

   // PUT /accounts/api/profile — partial-update the calling user's own metadata.
   export async function PUT(req: NextRequest) {
     const claims = await getSessionFromRequest(req);
     if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
     const body = await req.json().catch(() => ({}));
     try {
       const headers = restBackendHeaders(req, claims.user_id, claims.roles);
       const data = await identityClient.updateUserMetadata(
         {
           phone: body.phone,
           displayName: body.displayName,
           metadata: body.metadata,
         },
         { headers },
       );
       const m = data.userMetadata;
       return NextResponse.json({
         userId: m?.userId ?? '',
         email: m?.email ?? '',
         phone: m?.phone ?? null,
         displayName: m?.displayName ?? null,
         metadata: m?.metadata ?? {},
         metadataUpdatedAt: tsToISO(m?.metadataUpdatedAt),
       });
     } catch (err) {
       const ce = ConnectError.from(err);
       return NextResponse.json(
         { error: ce.rawMessage || 'Failed to update profile' },
         { status: connectCodeToHttp(ce.code) },
       );
     }
   }
   ```

   Key points:
   - Follows the `authorized-apps/route.ts:25-71` pattern exactly: `getSessionFromRequest` for auth, `identityClient.getUserMetadata`/`updateUserMetadata`, `ConnectError` catch.
   - userId is derived from the verified session — never from the request body (IDOR prevention, C-03).
   - No new env vars or ports — uses the existing `IDENTITY_ENDPOINT` and `identityClient` from `connectClients.ts:35`.

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-ui && pnpm run lint
# Confirm the shared helper is imported:
grep -n "restBackendHeaders" src/app/accounts/api/authorized-apps/route.ts src/app/accounts/api/profile/route.ts
```

---

### Step 8 — service: UI profile page + nav registration

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/profile/page.tsx` — create
- `services/xstockstrat-ui/src/components/shared/navGroups.tsx` — modify
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify

**Reviewers**: Service owner: `xstockstrat-ui` — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access

**Codebase Evidence**:
- Confirmed via: `navGroups.tsx:84-92` → Settings group items array, last item `{ label: 'MCP tools', href: '/accounts/mcp-tools' }`
- Confirmed via: `PlatformHeader.tsx:90-93` → `accounts` subnav items, last item `{ label: 'MCP Tools', href: '/accounts/mcp-tools', match: 'exact' }`
- Confirmed via: design.md:89-97 → page follows `sources/page.tsx:172` form pattern, shows read-only user_id + email, editable phone + display_name + metadata

**TDD**: red-green required

**Instructions**:

1. **Create profile page** — `src/app/accounts/profile/page.tsx` (client component):
   ```tsx
   'use client';
   ```
   Build a form page following the Card/Input/Button layout from `config-ui/sources/page.tsx:172`:
   - `useState<FormState>` with fields: `phone`, `displayName`, `metadata` (JSON string).
   - On mount, `fetch('/accounts/api/profile')` to load current values.
   - Read-only display of `userId` and `email` (not in the form — shown as text/disabled inputs).
   - Editable `phone` (text input), `displayName` (text input), `metadata` (textarea for JSON).
   - Save button calls `fetch('/accounts/api/profile', { method: 'PUT', body: JSON.stringify({...}) })`.
   - Error/success toast or message display on save.

2. **Nav registration — NAV_GROUPS (C-10(a))**: In `navGroups.tsx`, add a Profile entry to the Settings group items array (index 4, lines 84-92). Insert before the existing entries:
   ```typescript
   { label: 'Profile', href: '/accounts/profile' },
   ```

3. **Nav registration — PLATFORM_SUBNAV (back-compat)**: In `PlatformHeader.tsx`, add a Profile entry to `PLATFORM_SUBNAV.accounts` (lines 90-93). Insert before the existing entries:
   ```typescript
   { label: 'Profile', href: '/accounts/profile', match: 'exact' },
   ```

   Key points:
   - Profile is placed first in each list (it is the most personal/primary item in Settings/Accounts).
   - Both NAV_GROUPS and PLATFORM_SUBNAV must be updated (C-10(a), fails.md `060-screener-engine` trap).

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-ui && pnpm run lint
# Confirm nav registration:
grep -n "Profile" src/components/shared/navGroups.tsx src/components/shared/PlatformHeader.tsx
```

---

### Step 9 — test: UI E2E test for profile page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/accounts/profile.spec.ts` — create

**Reviewers**: Service owner: `xstockstrat-ui` — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access

**Codebase Evidence**:
- Confirmed via: `e2e/accounts/authorized-apps.spec.ts:1-11` → existing accounts E2E pattern: `addAuthCookie`, page navigation, BFF route stub
- Confirmed via: `e2e/helpers/auth.ts:56-58` → `addAuthCookie(page)` injects an auth cookie for the canonical test user
- Confirmed via: `e2e/fixtures/users.ts:9-10` → `TEST_USER_ID = 'test-user-001'`, `TEST_USER_EMAIL = 'test@example.com'`
- Confirmed via: design.md:174-175 → UI tests use existing fixtures from `e2e/fixtures/users.ts`

**TDD**: red-green required

**Instructions**:

1. Create `e2e/accounts/profile.spec.ts` following the `authorized-apps.spec.ts` pattern:

   ```typescript
   import { test, expect } from '@playwright/test';
   import { addAuthCookie } from '../helpers/auth';
   import { TEST_USER_ID, TEST_USER_EMAIL } from '../fixtures/users';

   const PROFILE_BFF = '/accounts/api/profile';

   test.describe('Accounts — Profile', () => {
     test('unauthenticated visit redirects to /auth/login', async ({ page }) => {
       const res = await page.request.get('/accounts/profile', { maxRedirects: 0 });
       expect([302, 307]).toContain(res.status());
       expect(res.headers()['location'] ?? '').toContain('/auth/login');
     });

     test('authenticated session renders profile with user_id and email read-only', async ({
       page,
     }) => {
       // Stub the BFF to return a deterministic profile.
       await page.route(PROFILE_BFF, (route) =>
         route.fulfill({
           status: 200,
           contentType: 'application/json',
           body: JSON.stringify({
             userId: TEST_USER_ID,
             email: TEST_USER_EMAIL,
             phone: '+1234567890',
             displayName: 'Test Admin',
             metadata: {},
             metadataUpdatedAt: null,
           }),
         }),
       );
       await addAuthCookie(page);
       await page.goto('/accounts/profile');
       // user_id and email should be visible as read-only
       await expect(page.getByText(TEST_USER_ID)).toBeVisible();
       await expect(page.getByText(TEST_USER_EMAIL)).toBeVisible();
     });
   });
   ```

   C-12 (test-data inventory): Reuses existing `TEST_USER_ID` and `TEST_USER_EMAIL` from `e2e/fixtures/users.ts:9-10`. No new fixture module needed — the BFF stub return shape is a scenario one-off (exempt per C-12).

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-ui && pnpm test:e2e -- --grep "Profile"
```

---

### Step 10 — service: Agent client.py get_user_metadata and update_user_metadata

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: Service owner: `xstockstrat-agent` — MCP tool contract stability, tool-count statements, OAuth 2.1 edge-auth correctness, admin x-access-scope forwarded only by management tools, no secret values in tool output

**Codebase Evidence**:
- Confirmed via: `client.py:26` → `IDENTITY_ENDPOINT` already defined
- Confirmed via: `client.py:789-796` → existing identity stub usage pattern: ephemeral channel + `identity_pb2_grpc.IdentityServiceStub`
- Confirmed via: `client.py:29-30` → `_metadata()` returns empty list `[]`
- Confirmed via: `client.py:451,550,714,859,985,1184` → x-access-scope forwarding spread pattern: `[*_metadata(), ("x-access-scope", str(access_scope))]`
- Confirmed via: design.md:105-106 → agent uses `[*_metadata(), ("x-user-id", user_id)]` spread (same shape as 6 existing x-access-scope sites)

**TDD**: red-green required

**Instructions**:

1. Add two new async methods to `client.py` after the existing `validate_session_token` method (line 803):

   ```python
   async def get_user_metadata(self, user_id: str) -> dict:
       """Fetch the calling user's own profile metadata from identity."""
       from gen.identity.v1 import identity_pb2, identity_pb2_grpc  # noqa: PLC0415

       async with grpc.aio.insecure_channel(IDENTITY_ENDPOINT) as channel:
           stub = identity_pb2_grpc.IdentityServiceStub(channel)
           resp = await stub.GetUserMetadata(
               identity_pb2.GetUserMetadataRequest(),
               metadata=[*_metadata(), ("x-user-id", user_id)],
           )
       m = resp.user_metadata
       return {
           "userId": m.user_id,
           "email": m.email,
           "phone": m.phone if m.HasField("phone") else None,
           "displayName": m.display_name if m.HasField("display_name") else None,
           "metadata": dict(m.metadata) if m.metadata else {},
           "metadataUpdatedAt": m.metadata_updated_at.ToJsonString() if m.HasField("metadata_updated_at") else None,
       }

   async def update_user_metadata(
       self,
       user_id: str,
       phone: str | None = None,
       display_name: str | None = None,
       metadata: dict | None = None,
   ) -> dict:
       """Partial-update the calling user's own profile metadata."""
       from gen.identity.v1 import identity_pb2, identity_pb2_grpc  # noqa: PLC0415
       from google.protobuf.struct_pb2 import Struct  # noqa: PLC0415

       req = identity_pb2.UpdateUserMetadataRequest()
       if phone is not None:
           req.phone = phone
       if display_name is not None:
           req.display_name = display_name
       if metadata is not None:
           s = Struct()
           s.update(metadata)
           req.metadata.CopyFrom(s)

       async with grpc.aio.insecure_channel(IDENTITY_ENDPOINT) as channel:
           stub = identity_pb2_grpc.IdentityServiceStub(channel)
           resp = await stub.UpdateUserMetadata(
               req,
               metadata=[*_metadata(), ("x-user-id", user_id)],
           )
       m = resp.user_metadata
       return {
           "userId": m.user_id,
           "email": m.email,
           "phone": m.phone if m.HasField("phone") else None,
           "displayName": m.display_name if m.HasField("display_name") else None,
           "metadata": dict(m.metadata) if m.metadata else {},
           "metadataUpdatedAt": m.metadata_updated_at.ToJsonString() if m.HasField("metadata_updated_at") else None,
       }
   ```

   Key points:
   - Uses the same `[*_metadata(), ("x-user-id", user_id)]` spread pattern as the 6 existing `x-access-scope` call sites (design.md:105).
   - Lazy imports (`from gen.identity.v1 import ...`) follow the service convention (see `client.py:790`).
   - Ephemeral channel pattern matches `validate_session_token` at `client.py:792`.
   - `HasField` on proto3 optional fields correctly detects presence (Python protobuf semantics).
   - No x-access-scope forwarding — these are self-only tools, not admin-gated management tools.

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 11 — service: Agent tools.py get_user_metadata and set_user_metadata + tool count bump

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-ui/src/lib/copilot.ts` — modify
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: Service owner: `xstockstrat-agent` — MCP tool contract stability, tool-count statements, OAuth 2.1 edge-auth correctness, admin x-access-scope forwarded only by management tools, no secret values in tool output

**Codebase Evidence**:
- Confirmed via: `tools.py:151-153` → `register_tools(server)` + `@server.tool()` decorator pattern
- Confirmed via: `tools.py:107-122` → `_caller_user_id(ctx, tool)` helper returns verified caller user_id
- Confirmed via: `tools.py:712-723` → `get_formula` — simple read-only tool pattern: `@server.tool()`, wraps `client.method()`, catches `grpc.aio.AioRpcError`
- Confirmed via: `tools.py:4` → "Twenty-two tools" (bump to "twenty-four")
- Confirmed via: agent `CLAUDE.md:30` → "twenty-two tools" (bump)
- Confirmed via: `copilot.ts:14` → `COPILOT_MCP_TOOL_COUNT = 18` (already stale; bump to 24)
- Confirmed via: `mcp-tools.md:3` → "twenty-two tools" (bump)
- Confirmed via: `mcp-tools.md:37` → "twenty-two tools" (bump)

**TDD**: red-green required

**Instructions**:

1. **Add two tools** to `register_tools` in `tools.py` (after the last existing `@server.tool()` registration):

   ```python
   @server.tool()
   async def get_user_metadata(ctx: Context) -> dict:
       """Fetch the calling user's own profile metadata from xstockstrat-identity.
       Returns userId, email (read-only), phone, displayName, metadata, metadataUpdatedAt."""
       user_id = _caller_user_id(ctx, "get_user_metadata")
       try:
           return await client.get_user_metadata(user_id)
       except grpc.aio.AioRpcError as e:
           raise RuntimeError(_grpc_error_message(e, not_found="user not found")) from e

   @server.tool()
   async def set_user_metadata(
       ctx: Context,
       phone: str | None = None,
       display_name: str | None = None,
       metadata: dict | None = None,
   ) -> dict:
       """Update the calling user's own profile metadata. Partial update — only provided
       fields are changed. Email is read-only and cannot be set.
       phone: optional phone number.
       display_name: optional display name.
       metadata: optional JSON object (max 8KB)."""
       user_id = _caller_user_id(ctx, "set_user_metadata")
       if phone is None and display_name is None and metadata is None:
           raise RuntimeError("at least one field (phone, display_name, metadata) must be provided")
       try:
           return await client.update_user_metadata(
               user_id, phone=phone, display_name=display_name, metadata=metadata,
           )
       except grpc.aio.AioRpcError as e:
           raise RuntimeError(_grpc_error_message(e, not_found="user not found")) from e
   ```

2. **Tool count bump** — update all 5 prose locations + 1 numeric constant:

   | File | Line | Old | New |
   |---|---|---|---|
   | `services/xstockstrat-agent/app/tools.py` | 4 | `Twenty-two tools` | `Twenty-four tools` |
   | `services/xstockstrat-agent/CLAUDE.md` | 30 | `twenty-two tools` | `twenty-four tools` |
   | `docs/runbooks/mcp-tools.md` | 3 | `twenty-two tools` | `twenty-four tools` |
   | `docs/runbooks/mcp-tools.md` | 37 | `twenty-two tools` | `twenty-four tools` |
   | `services/xstockstrat-ui/src/lib/copilot.ts` | 14 | `COPILOT_MCP_TOOL_COUNT = 18` | `COPILOT_MCP_TOOL_COUNT = 24` |

3. **Add tool entries to `tools.py` docstring** (line 4 area): add `get_user_metadata` and `set_user_metadata` to the tool enumeration in the module docstring.

4. **Add tool table entries to agent CLAUDE.md**: add rows for both tools to the MCP Tools table.

   Key points:
   - Both tools use `_caller_user_id(ctx, ...)` — same as `emit_alert` and `manage_formula`.
   - No x-access-scope forwarding — these are self-only, not admin-gated.
   - Email is excluded from `set_user_metadata` parameters — read-only (design decision).
   - `COPILOT_MCP_TOOL_COUNT` was already stale at 18 (insight from ledger `trigger-backfill-mcp-tool`); updating to 24 catches up.

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-agent && ruff check . && ruff format --check .
# Confirm tool count consistency:
grep -in "twenty-four\|twenty-two" app/tools.py ../../docs/runbooks/mcp-tools.md CLAUDE.md
grep -n "COPILOT_MCP_TOOL_COUNT" ../../services/xstockstrat-ui/src/lib/copilot.ts
```

---

### Step 12 — test: Agent tool tests

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify

**Reviewers**: Service owner: `xstockstrat-agent` — MCP tool contract stability, tool-count statements, OAuth 2.1 edge-auth correctness, admin x-access-scope forwarded only by management tools, no secret values in tool output

**Codebase Evidence**:
- Confirmed via: `test_tools_endpoint.py:22-46` → exact set assertion of all 22 tool names
- Confirmed via: `test_tools_endpoint.py:17` → `test_list_tools_returns_all_registered_tools()` verifies the full tool set

**TDD**: red-green required

**Instructions**:

1. Add `"get_user_metadata"` and `"set_user_metadata"` to the exact set assertion in `test_list_tools_returns_all_registered_tools` (after line 46, inside the `assert names == { ... }` block):

   Add these two entries to the set literal:
   ```python
   "get_user_metadata",
   "set_user_metadata",
   ```

2. Add functional tests for the client wrapper methods (`get_user_metadata`, `set_user_metadata`) added in Step 10. These verify the client methods exist, accept the expected arguments, and forward `x-user-id` metadata correctly:

   ```python
   def test_client_has_get_user_metadata_method():
       """Smoke: client exposes get_user_metadata."""
       from app.client import XStockStratClient
       assert hasattr(XStockStratClient, 'get_user_metadata')

   def test_client_has_set_user_metadata_method():
       """Smoke: client exposes set_user_metadata."""
       from app.client import XStockStratClient
       assert hasattr(XStockStratClient, 'set_user_metadata')
   ```

   C-13 (test data, non-frontend): No domain data literal is introduced — these tests assert method existence and tool name strings, which are identifiers not domain data. Compliant.

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
Coverage threshold: 40%. All commands exit 0.

---

### Step 13 — docs: Add tool sections to mcp-tools.md

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `mcp-tools.md:3` → existing tool reference document with per-tool heading, parameter table, return shape, error section
- Confirmed via: design.md:99-116 → two tools: `get_user_metadata` (no params) and `set_user_metadata` (optional phone, display_name, metadata)

**TDD**: N/A (docs — non-code-bearing)

**Instructions**:

1. Add a `## get_user_metadata` section to `mcp-tools.md` following the existing per-tool format:
   - **Purpose**: Fetch the calling user's own profile metadata.
   - **Parameters**: none.
   - **Returns**: `{ userId, email, phone, displayName, metadata, metadataUpdatedAt }`.
   - **Errors**: `user not found` (identity returns NOT_FOUND); missing claims (RuntimeError).

2. Add a `## set_user_metadata` section:
   - **Purpose**: Partial-update the calling user's own profile metadata. Email is read-only and cannot be set.
   - **Parameters**: `phone` (str, optional), `display_name` (str, optional), `metadata` (dict, optional). At least one must be provided.
   - **Returns**: `{ userId, email, phone, displayName, metadata, metadataUpdatedAt }` (updated profile).
   - **Errors**: `at least one field required` (no fields provided); `user not found` (identity returns NOT_FOUND); missing claims (RuntimeError).

**Verification**:
```bash
grep -c "## get_user_metadata\|## set_user_metadata" docs/runbooks/mcp-tools.md
# Should output 2
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
