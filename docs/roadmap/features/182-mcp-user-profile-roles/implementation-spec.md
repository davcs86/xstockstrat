# Implementation Spec: mcp-user-profile-roles

**Status**: `complete`
**Created**: 2026-09-06
**Feature**: `docs/roadmap/features/182-mcp-user-profile-roles/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/mcp-user-profile-roles`

---

## Execution Summary

This feature exposes user administration (create/list/get/set-roles/activate-deactivate/reset-password)
and admin cross-user profile access as **5 new admin-gated MCP tools** on `xstockstrat-agent`. The six
user-admin identity RPCs already exist (feature 043) and are reused unchanged; the net-new backend work
is **two additive identity RPCs** (`AdminGetUserMetadata`/`AdminUpdateUserMetadata`) for cross-user
profile access, since today's metadata RPCs are self-only.

Order follows the dependency chain: **proto first** (add RPCs + request messages), **proto-gen** (regenerate
stubs), then **identity service + test** (implement the two new RPCs behind `adminGate`, extract shared
metadata helpers, add a shared `mapDbError` that also fixes the pre-existing self-path 8KB-error leak),
then **agent client + test** (8 gRPC helpers), then **agent tools + test** (register the 5 tools + extend
the executable tool-name guard), then **docs/inventory sync** (the six MCP inventory surfaces — ledger
RC-1, `fails.md:308-310`). Each non-frontend
`service` step is paired with a red-first `test` step (C-08/P-06).

**Consumer surface (C-14):** the named surface is the Agent — the 5 MCP tools land in Steps 7–8. There is
no UI surface (product spec `## Consumer Surface(s)` marks UI unchecked; admin user management has no
config-ui page in scope).

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` (create via manage_user) | Step 8 |
| `@AC-2` (set_roles) | Step 8 |
| `@AC-3` (set_active deactivate) | Step 8 |
| `@AC-4` (reset_password, no echo) | Step 6 (caplog no-plaintext), Step 8 (dispatch, no-echo) |
| `@AC-5` (list_users) | Step 8 |
| `@AC-6` (get_user) | Step 8 |
| `@AC-7` (admin reads another user's profile) | Step 4 (identity RPC), Step 8 (tool) |
| `@AC-8` (admin partial-updates another's profile; metadata_updated_at advances) | Step 4 (identity RPC), Step 8 (tool) |
| `@AC-9` (non-admin denied every tool) | Step 8 (per-tool denial) |
| `@AC-10` (identity enforces admin gating server-side) | Step 4 (adminGate denial on both new RPCs) |

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the edited `.proto`.
- Step 3 (identity service) requires Step 2: the new RPC method stubs must exist in the generated
  `IdentityServiceService` before `addService` will route them.
- Step 4 (identity test) covers Step 3 [service] — paired, red-first.
- Step 5 (agent client) requires Step 2: the Python `identity_pb2` stubs for the new request messages
  must exist.
- Step 6 (agent client test) covers Step 5 [service] — paired, red-first.
- Step 7 (agent tools) requires Step 5: the tools call the new `client.py` helpers.
- Step 8 (agent tools test) covers Step 7 [service] — paired, red-first; also extends the executable
  tool-name guard `tests/test_tools_endpoint.py` to the 40-name set (must run green after Step 7).
- Step 9 (docs/inventory sync) requires Steps 7–8: the tool count (35→40) and tool descriptions are
  only final once the tools are registered. Inventory-drift guard (ledger RC-1, `fails.md:308-310`, not
  a Constitution Floor ID): all inventory surfaces land in the same PR.

---

### Step 1 — proto: add AdminGetUserMetadata / AdminUpdateUserMetadata RPCs + request messages

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/identity/v1/identity.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking changes without deprecation, `buf lint`/`buf breaking` pass; xstockstrat-identity — admin-gated cross-user profile contract; xstockstrat-agent — MCP tool contract stability; Security — admin auth-scope surface

**Codebase Evidence**:
- Self-metadata RPCs declared at `identity.proto:30-31` (`GetUserMetadata`, `UpdateUserMetadata`); the
  `IdentityService` block closes at `identity.proto:41`.
- `UserMetadata` message (fields 1-6) at `identity.proto:130-137`; `GetUserMetadataResponse` `:139`
  (`UserMetadata user_metadata = 1`); `UpdateUserMetadataResponse` `:145`. `UpdateUserMetadataRequest`
  (optional phone=1, display_name=2, metadata=3) `:140-144`.
- `import "google/protobuf/struct.proto";` already present `:7` — no new import needed for the `Struct`
  metadata field.
- Admin RPC group (feature 043) `:35-40`; adding non-breaking additions follows the same additive
  pattern the existing admin RPCs used (`docs/runbooks/proto-versioning.md` § "Non-breaking changes").

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. Append two RPC declarations to the `IdentityService` block, after the self-metadata pair at
   `identity.proto:31` (group them with the existing metadata self RPCs). Reuse the existing response
   messages (do **not** add `Admin*Response` messages — rejected in design.md):
   ```proto
   // Admin cross-user profile metadata (admin-gated, feature 182). Target selected by request
   // body user_id, never x-user-id (C-03). Reuse the self responses.
   rpc AdminGetUserMetadata(AdminGetUserMetadataRequest) returns (GetUserMetadataResponse);
   rpc AdminUpdateUserMetadata(AdminUpdateUserMetadataRequest) returns (UpdateUserMetadataResponse);
   ```
2. Add the two request messages immediately after `UpdateUserMetadataResponse` at `identity.proto:145`,
   mirroring the self request shapes but with a leading `user_id` selector:
   ```proto
   message AdminGetUserMetadataRequest { string user_id = 1; }
   message AdminUpdateUserMetadataRequest {
     string user_id = 1;
     optional string phone = 2;
     optional string display_name = 3;
     optional google.protobuf.Struct metadata = 4;
   }
   ```
   Field numbers restart per message (each is a new message), so `user_id = 1` does not collide.
3. Do **not** modify the feature-043 admin RPCs or messages (`:35-40`, `:158-195`) — FR-1..FR-6 reuse
   them unchanged.

**Verification**:
```
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/mcp-user-profile-roles"
```
Both green (additions are non-breaking). If the feature branch does not yet exist on the remote, run
`buf breaking --against ".git#branch=main-dev"`.

---

### Step 2 — proto-gen: regenerate stubs for the new identity RPCs

**Status**: `done`
**Service**: `packages/proto`
**Files** (regenerated wholesale by `./scripts/buf-gen.sh` — never hand-edited; the exact set below is
the current `identity/v1` output, re-emitted with the two new RPCs/messages):
- `packages/proto/gen/go/identity/v1/identity.pb.go` — modify (regenerated)
- `packages/proto/gen/go/identity/v1/identity_grpc.pb.go` — modify (regenerated)
- `packages/proto/gen/go/identity/v1/identityv1connect/identity.connect.go` — modify (regenerated)
- `packages/proto/gen/python/identity/v1/identity_pb2.py` — modify (regenerated)
- `packages/proto/gen/python/identity/v1/identity_pb2_grpc.py` — modify (regenerated)
- `packages/proto/gen/ts/identity/v1/identity.ts` — modify (regenerated)
- `packages/proto/gen/ts/identity/v1/identity_connect.ts` — modify (regenerated)
- `packages/proto/gen/ts/identity/v1/identity_pb.ts` — modify (regenerated; the protobuf-es
  `UserMetadataSchema` used by the Step 4 projection-parity test)
- plus the compiled TS output under `packages/proto/gen/ts/dist/` (emitted by the TS compile in
  `buf-gen.sh`) — regenerated, not hand-edited

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking changes without deprecation, `buf lint`/`buf breaking` pass; xstockstrat-identity — admin-gated cross-user profile contract; xstockstrat-agent — MCP tool contract stability; Security — admin auth-scope surface
(inherited from Step 1)

**Codebase Evidence**:
- Codegen entry point: `./scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs) — generates
  TS/Python/Go stubs and compiles the TS package.
- Freshness gate: `docs/runbooks/proto-versioning.md` § "Verifying the generated stubs match the protos"
  — `git diff packages/proto/gen/` must be empty after regen (CI `proto-freshness` job, C-09).
- Never hand-edit `gen/` — checked-in codegen output (root `CLAUDE.md` § Key File Paths Reference).

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Stage the regenerated stubs together with the `.proto` change from Step 1 (commit proto source +
   generated stubs together, per `docs/runbooks/proto-versioning.md`).
3. Do not hand-edit any file under `packages/proto/gen/`.

**Verification**:
```
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```
Exit 0 (empty diff) proves the committed stubs match the `.proto` (C-09 / `proto-freshness`). Confirm the
new symbols exist: `grep -rn "AdminGetUserMetadata\|AdminUpdateUserMetadata" packages/proto/gen/python/identity/v1/`.

---

### Step 3 — service: implement admin metadata RPCs + extract shared helpers + mapDbError (xstockstrat-identity)

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify

**Reviewers**: xstockstrat-identity — JWT/scope integrity, admin-gated user administration, never plaintext secrets; Security — identity auth-scope, admin gating, no password/PII in logs

**Codebase Evidence**:
- `adminGate(call, callback)` (metadata present + `hasAdminAccessScope`, fails closed) at
  `identityServiceImpl.ts:638-649` — the sole server-side authority; returns `false` + calls back on denial.
- `auditSafe(eventType, targetUserId, metadata, payload)` at `identityServiceImpl.ts:625-636`
  (best-effort, swallows errors). Existing admin write example: `setUserRoles` emits
  `this.auditSafe('identity.user.roles_updated', userId, call.metadata, {...})` at `:768`.
- Self `getUserMetadata` `:536-566` (SELECT `user_id, email, phone, display_name, metadata,
  metadata_updated_at`; NOT_FOUND at `:548-550`; row→proto projection `:552-561` with `?? undefined`
  shape and `metadata` JSON round-trip). Self `updateUserMetadata` `:572-615` (dynamic SET clause
  `:580-588`, empty-update `INVALID_ARGUMENT` at `:586-588`, NOT_FOUND `:597-599`, projection `:601-610`).
- **Pre-existing 8KB-error leak**: self `updateUserMetadata` catch at `:611-614` maps *every* error to
  `code 13` (INTERNAL); the 8KB CHECK (`migrations/006_user_metadata.up.sql:7-8`,
  `users_metadata_size CHECK (octet_length(metadata::text) <= 8192)`) raises SQLSTATE `23514`, which
  today leaks as INTERNAL rather than INVALID_ARGUMENT. `createUser` `:651+` (catch also code 13).
- Role maps: `ROLE_ENUM_TO_STRING` `:15`, `ROLE_STRING_TO_ENUM` `:16`, `rolesToStrings` `:18-20`,
  `stringsToRoles` `:22-24` (unknown strings → `0` = `ROLE_UNSPECIFIED`, silently dropped by
  `rolesToStrings`).
- `userIdFrom` imported from `./authz` (`:8`), used to derive acting-admin id for audit payloads.
- Auto-wiring: `src/index.ts:49-52` calls `addService(IdentityServiceService, identityImpl)` once;
  `@grpc/grpc-js` binds by method name — **no `src/index.ts` edit**; implement two same-named class
  methods `adminGetUserMetadata` / `adminUpdateUserMetadata`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Extract three metadata helpers** (module-level functions or private methods) from the self handlers
   at `:536-615`, so self + both admin handlers share one row→proto mapper, one SELECT, one SET-builder
   (closes the fails.md:537-539 lockstep trap):
   - `rowToUserMetadata(r)` → returns the `userMetadata` object shape from `:552-561`, emitting **all six
     keys unconditionally** with the `?? undefined` / `HasField`-friendly shape (never conditional-spread).
   - `selectUserMetadata(pool, userId)` → the SELECT at `:543-546`, returning `result.rows`.
   - `buildMetadataSet(req)` → the dynamic SET clause build from `:580-585` (phone/displayName/metadata,
     ts-proto camelCase presence), returning `{ sets, params }`. The empty-check stays in the handler
     (not in `buildMetadataSet`) so both call sites behave identically (design.md).
   Rewrite self `getUserMetadata`/`updateUserMetadata` to call these helpers (behavior byte-identical;
   existing self tests must stay green).
2. **Add a shared `mapDbError(err)` helper**: `23505`→`{code: 6, ...}` (ALREADY_EXISTS),
   `23514`→`{code: 3, message: 'metadata exceeds 8KB limit'}` (INVALID_ARGUMENT), else
   `{code: 13, message: err.message}` (INTERNAL). Apply it in the catch blocks of `createUser`, self
   `updateUserMetadata` (fixing the `:611-614` leak), and the new `adminUpdateUserMetadata`. Do **not**
   apply to handlers that cannot raise those SQLSTATEs (no dead branches).
3. **Implement `adminGetUserMetadata(call, callback)`**:
   - `if (!this.adminGate(call, callback)) return;`
   - `const userId = call.request.userId;` (ts-proto camelCase); `if (!userId) return callback({code: 3,
     message: 'user_id required'});`
   - `const rows = await selectUserMetadata(this.pool, userId);` → NOT_FOUND (`code 5`) when empty
     (mirror `:548-550`); else `callback(null, { userMetadata: rowToUserMetadata(rows[0]) })`.
   - **No audit on read** (consistent with `getUser`/`listUsers`). Log only `err.message` on error
     (never the profile body), mirroring `:563`.
4. **Implement `adminUpdateUserMetadata(call, callback)`**:
   - `adminGate`; read `call.request.userId` (camelCase) → `user_id required` INVALID_ARGUMENT if empty.
   - `const { sets, params } = buildMetadataSet(call.request);` → if no fields set,
     `INVALID_ARGUMENT` "at least one field required" (mirror `:586-588`).
   - Append `metadata_updated_at = NOW()` and the `WHERE user_id = $N RETURNING ...` (mirror `:589-596`);
     NOT_FOUND when `rows.length === 0`.
   - On success emit `this.auditSafe('identity.user.metadata_updated', userId, call.metadata,
     { acting_admin_user_id: userIdFrom(call.metadata), target_user_id: userId, updated_fields: [...] })`
     — acting admin + target only, **no metadata values / no secrets** (mirror `:768` shape). Then
     `callback(null, { userMetadata: rowToUserMetadata(rows[0]) })`.
   - Catch block routes through `mapDbError(err)`; log only `err.message`.
5. Read `call.request.userId` and all new fields via ts-proto **camelCase** (fails.md:667-669); a
   snake_case read silently no-ops.
6. Update the stale `adminGate` doc comment ("shared by all **six** admin RPCs", `:638`) to reflect the
   two new callers (now eight) — a one-line comment fix, in the same file, to avoid doc drift.

**Verification**: (run in the paired test Step 4)
```
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage
```

---

### Step 4 — test: identity admin metadata RPCs + mapDbError + camelCase/projection parity

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.test.ts` — modify

**Reviewers**: xstockstrat-identity — JWT/scope integrity, admin-gated user administration; Security — identity auth-scope, admin gating, no password/PII in logs

**Codebase Evidence**:
- Existing self-metadata tests to keep green: `identityServiceImpl.test.ts:493-542` (getUserMetadata)
  and `:548-582` (updateUserMetadata) — cited in design.md as the refactor safety net.
- `adminGate` denial contract: non-admin `x-access-scope` → `ADMIN_SCOPE_ERROR` (`authz.ts:35`,
  `PERMISSION_DENIED`) before touching the users table (`identityServiceImpl.ts:644-646`).
- 8KB CHECK constraint `migrations/006_user_metadata.up.sql:7-8` (SQLSTATE `23514`).
- Test-data rule (C-13): identity is a Node service; its canonical fixture home is
  `src/__tests__/fixtures/` but **does not exist today** — do not create it speculatively. Inline row
  literals are compliant while single-consumer; centralize only on a second consumer.

**TDD**: `red-green required`

**Covers**: `AC-7, AC-8, AC-10`

**Instructions**: Write these cases (each asserts new behavior → **fails on the pre-Step-3 tree**):
1. **@AC-10** — `adminGetUserMetadata` and `adminUpdateUserMetadata` each deny a non-admin
   `x-access-scope` with `PERMISSION_DENIED` (`code 7`) and perform **no** pool query (assert the pool
   mock was not called) — proves gating is at the service, not only the agent.
2. **@AC-7** — `adminGetUserMetadata` with an admin caller and a body `user_id` returns the *target's*
   `userMetadata` (display_name/phone/metadata), and the SELECT was parameterized by the **request**
   `user_id`, not any `x-user-id` header.
3. **@AC-8** — `adminUpdateUserMetadata` partial update (display_name only) updates only that column,
   sets `metadata_updated_at = NOW()`, emits `identity.user.metadata_updated` via `auditSafe`
   (acting-admin + target, **no metadata values**), and the **read** RPC emits **no** audit.
4. **NOT_FOUND** — both new RPCs return `code 5` for a missing target `user_id`.
5. **mapDbError** — a `23514` SQLSTATE from the metadata write maps to `INVALID_ARGUMENT` (`code 3`,
   "metadata exceeds 8KB limit") on **both** self `updateUserMetadata` (the fixed leak) and
   `adminUpdateUserMetadata`; a generic error still maps to `code 13`.
6. **empty-update** — `adminUpdateUserMetadata` with no fields → `INVALID_ARGUMENT` "at least one field
   required".
7. **camelCase wire-loopback** — the new `AdminUpdateUserMetadataRequest` fields are read via ts-proto
   camelCase: construct the request through the generated message and assert the handler sees the values
   (a snake_case read would no-op) (fails.md:667-669).
8. Confirm the existing self tests (`:493-542`, `:548-582`) still pass unchanged.

**Verification**:
```
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage
```
Confirm the coverage summary reports ≥ 40% (CI threshold for `xstockstrat-identity`) and all new cases pass.

---

### Step 5 — service: agent client gRPC helpers for the 8 identity RPCs (xstockstrat-agent)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: xstockstrat-agent — MCP tool/client contract stability, admin `x-access-scope` forwarded only by management tools, no secret values in output

**Codebase Evidence**:
- Propagation helper `_metadata(*extra)` at `client.py:56-75` — emits the caller trio (`x-user-id` when
  non-empty, `x-access-scope`, `x-trace-id`) from the per-request caller context; de-dupes redundant
  `extra`. Reusing it satisfies C-03/header propagation.
- Self-metadata helper shape to mirror: `get_user_metadata(user_id)` `client.py:1270-1290` and
  `update_user_metadata(...)` `:1293-1330` — lazy `from gen.identity.v1 import identity_pb2,
  identity_pb2_grpc`, `grpc.aio.insecure_channel(IDENTITY_ENDPOINT)`, `_metadata(("x-user-id", user_id))`,
  and a camelCase projection using `m.HasField(...)` (`userId/email/phone/displayName/metadata/
  metadataUpdatedAt`). `IDENTITY_ENDPOINT` already wired in `client.py`.
- `Struct` build pattern for metadata write: `from google.protobuf.struct_pb2 import Struct; s.update(...)`
  (`client.py:1310-1313`).
- Role enum ints for the admin user RPCs: identity's `ROLE_STRING_TO_ENUM = {admin:1, trader:2,
  viewer:3}` (`identityServiceImpl.ts:16`) — port as a Python `ROLE_STRING_TO_ENUM` in `client.py`
  (backend `rolesToStrings` drops unknown/`0` enums, so client-side validation is authoritative).

**TDD**: `red-green required`

**Covers**: —

**Instructions**: Add a Python `ROLE_STRING_TO_ENUM = {"admin": 1, "trader": 2, "viewer": 3}` const, and
8 async helpers, each: lazy-import `identity_pb2`/`identity_pb2_grpc`, open an ephemeral
`grpc.aio.insecure_channel(IDENTITY_ENDPOINT)`, call the RPC, and project the response to a camelCase dict.
1. `create_user(email, password, roles: list[str])` → `CreateUserRequest(email=…, password=…,
   roles=[ROLE_STRING_TO_ENUM[r] for r in roles])`; project the `User` response
   (`userId/email/roles/isActive`, roles mapped back to strings). Forward `_metadata()` (derived scope,
   **no** `x-user-id` extra — the caller's own id already rides the context; the target is the new row).
2. `list_users()` → `ListUsersRequest()`; project `users` list.
3. `get_user(user_id)` → `GetUserRequest(user_id=user_id)`; project `User`.
4. `set_user_roles(user_id, roles: list[str])` → `SetUserRolesRequest(user_id=…, roles=[ints])`; project.
5. `set_user_active(user_id, active: bool)` → `SetUserActiveRequest(user_id=…, active=active)`; project.
6. `reset_password(user_id, new_password)` → `UpdatePasswordRequest(user_id=…, new_password=…)`; return
   `{"success": True, "user_id": user_id}` — **never** echo the password.
7. `admin_get_user_metadata(user_id)` → `AdminGetUserMetadataRequest(user_id=user_id)`, `_metadata()`
   (derived admin scope, **no** `x-user-id` override); project like the self metadata helper.
8. `admin_update_user_metadata(user_id, phone=None, display_name=None, metadata=None)` →
   `AdminUpdateUserMetadataRequest(user_id=user_id)` + set only provided fields (Struct for metadata),
   `_metadata()`; project the `UserMetadata` response.
   For all 8: forward via `_metadata()` so the caller's verified `x-access-scope` reaches identity's
   `adminGate` (fails.md:532/546-549 — scope only from verified claims; target `user_id` is a body
   selector, never identity). Read response fields via the generated message accessors (camelCase in the
   returned dict, `HasField` for optionals) (fails.md:667-669).

**Verification**: (run in the paired test Step 6)
```
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run --no-sync pytest --cov=app --cov-fail-under=40
```

---

### Step 6 — test: agent client projection + no-plaintext-password (xstockstrat-agent)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify or create (confirm existing filename in the
  service's `tests/` during execute; create only if absent)

**Reviewers**: xstockstrat-agent — client contract stability, no secret values in output/logs

**Codebase Evidence**:
- Projection-shape / descriptor-parity model: `tests/test_backtest_view.py:189`
  (`test_summary_key_set_covers_every_proto_field`) — the executable parity pattern for a hand-written
  proto projection (referenced in recon.md Patterns to REUSE).
- `_metadata()` derived-scope forwarding contract `client.py:56-75`.
- C-13: the agent's canonical fixture home is `tests/conftest.py` (exists: `ADMIN/TRADER/VIEWER` claim
  dicts + `_ctx()` at `conftest.py:12-27`). Domain literals used by a second test file move here; a
  single-consumer inline literal is compliant.

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**: Write cases that fail on the pre-Step-5 tree:
1. **Projection parity** — for `admin_get_user_metadata`, assert the returned dict's key set is exactly
   `{userId, email, phone, displayName, metadata, metadataUpdatedAt}` (mirror the self projection and the
   `test_backtest_view.py` parity model), proving `rowToUserMetadata` emits all six keys.
2. **@AC-4 no-plaintext-password** — patch the identity stub; call `reset_password(user_id,
   "N3w-P4ssw0rd!")` and `create_user(..., password="Str0ng-P4ss!")` under `caplog`; assert the plaintext
   password appears in **no** log record and **not** in the returned dict.
3. **Derived-scope forward** — assert the admin helpers call the stub with metadata produced by
   `_metadata()` (caller trio forwarded; no hardcoded admin scope; no `x-user-id` override on the admin
   metadata helpers).
4. Reuse `ADMIN`/`_ctx` from `tests/conftest.py` where a claims context is needed (C-13); do not
   re-declare inline claim dicts.

**Verification**:
```
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run --no-sync pytest --cov=app --cov-fail-under=40
```
Confirm coverage ≥ 40% and the new cases pass.

---

### Step 7 — service: register the 5 admin MCP tools (xstockstrat-agent)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: xstockstrat-agent — MCP tool contract stability (name/params/return), admin `x-access-scope` forwarded only by management tools; Security — admin gating, no password/PII in tool output

**Codebase Evidence**:
- Op-dispatch pattern to mirror (`manage_account`): `@server.tool()` at `tools.py:1601`, `async def
  manage_account(ctx, operation, ...)` `:1602`; per-op `if operation == …` dispatch with early
  `raise ValueError`; the friendly admin early check `scope = _caller_access_scope(ctx, "manage_account");
  if not (scope & 0x04): raise PermissionError("… requires admin scope")` at `:1667-1670`; trailing
  `raise ValueError(f"unknown operation '{operation}' …")` `:1679-1682`; `AioRpcError` → `RuntimeError`
  via `_grpc_error_message(...)` `:1684`.
- Caller-scope helper `_caller_access_scope(ctx, tool)` `tools.py:106-115`; caller-id helper
  `_caller_user_id(ctx, tool)` `:118+`. Existing metadata tools `get_user_metadata` `:1300`,
  `set_user_metadata` `:1310` (the self tools — leave unchanged, FR out-of-scope).
- `_grpc_error_message(e, not_found=…)` pattern used across tools (e.g. `:1293`, `:1684`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**: Register 5 new `@server.tool()` functions in `register_tools()`. Each admin tool does a
**friendly early admin check** (`scope = _caller_access_scope(ctx, "<tool>"); if not (scope & 0x04): raise
PermissionError("<tool> requires admin scope")`) so a non-admin is rejected before any client call
(@AC-9: "no state modified"), then calls the Step-5 client helper (which forwards the derived scope so
identity's `adminGate` remains the authoritative gate). Wrap client calls with
`try/except grpc.aio.AioRpcError as e: raise RuntimeError(_grpc_error_message(e, not_found="user not found")) from e`.
1. `manage_user(ctx, operation, user_id="", email="", password="", roles=None, active=None)` —
   `manage_account`-style dispatch:
   - `create` → require `email` + `password`; validate each role in `roles` against `{admin, trader,
     viewer}`, raising `ValueError` on unknown/empty; call `client.create_user`.
   - `set_roles` → require `user_id` + non-empty validated `roles`; call `client.set_user_roles`.
   - `set_active` → require `user_id` and a non-None `active`; call `client.set_user_active`.
   - `reset_password` → require `user_id` + `password`; call `client.reset_password`; return the
     success dict (no password echo).
   - trailing `raise ValueError("unknown operation '…' (expected create/set_roles/set_active/reset_password)")`.
   Docstring states admin-only and that passwords are write-only / never echoed.
2. `list_users(ctx)` → early admin check → `client.list_users()`.
3. `get_user(ctx, user_id)` → early admin check → `client.get_user(user_id)`.
4. `admin_get_user_metadata(ctx, user_id)` → early admin check → `client.admin_get_user_metadata(user_id)`.
5. `admin_set_user_metadata(ctx, user_id, phone=None, display_name=None, metadata=None)` → early admin
   check → pre-check all-None args → `RuntimeError("at least one field …")` (mirror `set_user_metadata`
   `:1321-1324`) → `client.admin_update_user_metadata(...)`.

Header propagation: these tools add new outbound identity gRPC calls **only via the Step-5 client
helpers**, which forward the caller trio through `_metadata()` (`client.py:56-75`) — no new propagation
mechanism; the derived `x-access-scope` reaches `adminGate` and the target `user_id` rides the request
body, never `x-user-id` (fails.md:532/546-549).

**Verification**: (run in the paired test Step 8)
```
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run --no-sync pytest --cov=app --cov-fail-under=40
```

---

### Step 8 — test: agent tool dispatch + per-tool admin denial + 40-name inventory guard (xstockstrat-agent)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_user_tools.py` — create
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify (extend the exact tool-name set to 40)

**Reviewers**: xstockstrat-agent — MCP tool contract stability, tool-count parity across inventory surfaces; Security — admin gating, password not echoed

**Codebase Evidence**:
- Admin-gate tool-test template: `tests/test_account_tools.py:168-181`
  (`test_resume_dispatches_to_client` uses `_ctx(ADMIN)` + `patch.object(client, ...)` +
  `mock.assert_awaited_once_with(...)`; `test_resume_requires_admin_scope` uses `_ctx(TRADER)`,
  `pytest.raises(PermissionError, match="admin scope")`, `mock.assert_not_awaited()`).
- Shared claim fixtures `ADMIN/TRADER/VIEWER` + `_ctx` at `tests/conftest.py:12-27` (import
  `from tests.conftest import _ctx, ADMIN, TRADER`) — C-13 canonical home.
- Executable inventory guard: `tests/test_tools_endpoint.py:17-58` asserts `names ==` the exact set;
  the current set has **35** tool names (`app/tools.py:4` "Thirty-five tools").

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9`

**Instructions**: In `test_user_tools.py`, mirror `test_account_tools.py`; each case fails on the
pre-Step-7 tree (tool not registered):
1. **@AC-1** — `manage_user` op `create` with `_ctx(ADMIN)` dispatches to `client.create_user` and
   returns the new user's `userId/email/roles/isActive`; assert the returned dict has no `password`.
2. **@AC-2** — op `set_roles` dispatches to `client.set_user_roles(user_id, ["trader","admin"])` and
   returns the updated user.
3. **@AC-3** — op `set_active` with `active=False` dispatches to `client.set_user_active(user_id, False)`.
4. **@AC-4** — op `reset_password` dispatches to `client.reset_password`; assert the plaintext password
   is not in the returned dict.
5. **@AC-5** — `list_users` dispatches to `client.list_users` and returns the entries.
6. **@AC-6** — `get_user` dispatches to `client.get_user(user_id)`.
7. **@AC-7** — `admin_get_user_metadata(user_id)` dispatches to `client.admin_get_user_metadata`.
8. **@AC-8** — `admin_set_user_metadata(user_id, display_name="Jane Quant")` dispatches to
   `client.admin_update_user_metadata` with only `display_name` set.
9. **@AC-9** — for **each** of the 5 tools, `_ctx(TRADER)` (no admin bit) raises `PermissionError`
   (`match="admin scope"`) and the patched client helper is **not** awaited (`assert_not_awaited()`) —
   proves no state change.
10. **unknown op / unknown role** — `manage_user` with a bad `operation` raises `ValueError`
    (`match="create/set_roles/set_active/reset_password"`); `set_roles`/`create` with an unknown role
    string raises `ValueError`.
11. In `test_tools_endpoint.py`, extend the `names ==` set at `:23-58` to include the 5 new names
    (`manage_user`, `list_users`, `get_user`, `admin_get_user_metadata`, `admin_set_user_metadata`) →
    exact **40**-name set.

Reuse `_ctx`/`ADMIN`/`TRADER` from `tests/conftest.py` (C-13) — no inline claim dicts.

**Verification**:
```
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run --no-sync pytest --cov=app --cov-fail-under=40
```
Confirm coverage ≥ 40%, all new cases pass, and `test_list_tools_returns_all_registered_tools` passes
against the 40-name set.

---

### Step 9 — docs: sync all six MCP inventory surfaces to 40 tools

**Status**: `done`
**Service**: `docs/runbooks/` + `xstockstrat-agent` + `xstockstrat-ui`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify (module docstring)
- `docs/runbooks/mcp-tools.md` — modify (count + new tool entries)
- `services/xstockstrat-agent/CLAUDE.md` — modify (count + MCP-tools table rows + management-tool-auth paragraph)
- `services/xstockstrat-ui/src/lib/copilot.ts` — modify (`COPILOT_MCP_TOOL_COUNT`)

**Reviewers**: none

**Codebase Evidence**:
- `app/tools.py:4` module docstring "Thirty-five tools:" (list follows).
- `docs/runbooks/mcp-tools.md:3` "Complete reference for the thirty-five tools…"; `:37` "`GET /api/tools`
  returns the same thirty-five tools'…"; management-denial paragraph at `:946` ("since feature 092 this
  is how **every** management…").
- `services/xstockstrat-agent/CLAUDE.md:43` "The agent registers thirty-five tools…".
- `services/xstockstrat-ui/src/lib/copilot.ts` `COPILOT_MCP_TOOL_COUNT = 32` (currently stale; correct
  to **40** — operator-approved in-scope, see design.md/context.md). This is a manual-sync surface with
  no executable cross-service guard (the UI learns the catalog at runtime via `GET /api/tools`).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `app/tools.py:4` — change "Thirty-five tools:" → "Forty tools:" and add the 5 new tools to the
   docstring list with one-line descriptions.
2. `docs/runbooks/mcp-tools.md` — update `:3` and `:37` counts (thirty-five → forty); add reference
   entries (parameter/return/error) for `manage_user`, `list_users`, `get_user`,
   `admin_get_user_metadata`, `admin_set_user_metadata` in the management section; extend the
   management-tool-authorization note (`:946`) to name the new admin tools.
3. `services/xstockstrat-agent/CLAUDE.md:43` — update the count and add the 5 tools to the MCP-tools
   table and the management-tool-authorization paragraph.
4. `services/xstockstrat-ui/src/lib/copilot.ts` — set `COPILOT_MCP_TOOL_COUNT = 40`, rewrite the stale
   comment, and add a cross-reference comment pointing to `tests/test_tools_endpoint.py` as the
   authoritative source (no auto-guard is feasible).

**Verification**:
```
grep -rn "hirty-five\|forty\|Forty" services/xstockstrat-agent/app/tools.py services/xstockstrat-agent/CLAUDE.md docs/runbooks/mcp-tools.md
grep -n "COPILOT_MCP_TOOL_COUNT" services/xstockstrat-ui/src/lib/copilot.ts
```
Confirm no surviving "thirty-five" count reference and `COPILOT_MCP_TOOL_COUNT = 40`. Cross-check the
executable guard already enforces the 40-name set (Step 8, `test_tools_endpoint.py`).

---

## Deviation Log

- **Step 1/2 (proto) — buf via Docker.** Host `buf` is absent; `buf lint`/`buf breaking` (Step 1) and
  `buf-gen.sh` (Step 2) run inside the version-pinned `xstockstrat-codegen` Docker image (built from
  `Dockerfile.codegen`). **Disposition**: CI-equivalent fallback (sequential-mode verification
  fallback — matches the `proto-freshness` toolchain).
- **Step 3/4 (identity) — tests run via tsc-compile, not the specced `pnpm test`.** The sandbox has
  Node 22 (`.nvmrc`), but the identity `test`/`test:coverage` scripts use
  `node --experimental-strip-types`, which on Node 22 (a) can't lower TypeScript parameter properties
  and (b) doesn't resolve the tests' `../grpc/*.js` specifiers to `.ts` — so the suite silently
  **skips every test** (the file's `before()` try/catch swallows the import error). CI runs Node 24
  (`.github/workflows/ci.yml` setup-node "24"), where strip-types handles both and the suite executes.
  CI-equivalent here: `tsc -p` (temp tsconfig incl. tests) → `node --test dist-test/**` + `c8`.
  Verified real red→green: pre-Step-3 tree = **12 failures** (all new admin-metadata tests + the
  mapDbError self-leak fix), post-Step-3 = **64/64 pass**, coverage **76% lines** (≥ 40%).
  `tsc` build also passes (compile-checks the change). **Disposition**: CI-equivalent fallback.
  (Latent repo condition surfaced, not caused by this feature: identity tests are vacuous under
  Node 22 strip-types — logged to `fails.md`.)
- **Step 4 — test file path correction.** Step 4's `**Files**` cited
  `services/xstockstrat-identity/src/grpc/identityServiceImpl.test.ts`; the real (and only) identity
  test file is `src/__tests__/identityServiceImpl.test.ts` (per `package.json` `test` glob). Used the
  real path. **Disposition**: unambiguous path correction — no scope change.
