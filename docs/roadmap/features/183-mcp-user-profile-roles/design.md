# Design: mcp-user-profile-roles

**Created**: 2026-09-06
**Rounds**: 4 (quick mode extended by operator; termination: approved)
**Approved by**: user @ 2026-09-06
**Grounded in**: recon.md

---

## Chosen Approach

Expose user administration and admin cross-user profile access as **5 new admin-gated MCP tools** on
`xstockstrat-agent` (the C-14 consumer surface — `@server.tool()` registrations in `app/tools.py`):

- **`manage_user`** — `manage_account`-style op-dispatch (`tools.py:1602`): per-op arg validation, a
  friendly early `if not (scope & 0x04): raise PermissionError(...)` (mirrors `tools.py:1667`), a
  distinct `client.py` helper per op, and a trailing `else: raise ValueError("unknown operation …")`.
  Ops → identity RPCs: `create`→`CreateUser`, `set_roles`→`SetUserRoles`, `set_active`→`SetUserActive`,
  `reset_password`→`UpdatePassword` (all feature-043, `identity.proto:35-40`, unchanged).
- **`list_users`** → `ListUsers`; **`get_user`** → `GetUser` (readers).
- **`admin_get_user_metadata`** → new `AdminGetUserMetadata`; **`admin_set_user_metadata`** → new
  `AdminUpdateUserMetadata`.

All 5 forward the caller's **derived** `x-access-scope` via the existing `_metadata()` propagation
(`client.py:56`) with **no `x-user-id` override**; the target `user_id` rides only in the request body.
Identity's `adminGate()` (`identityServiceImpl.ts:639`) is the sole server-side authority (a
`PERMISSION_DENIED` gate that fails closed); the agent-side scope check is a friendly early reject
only. Final MCP tool count **35 → 40**.

**Proto (additive, non-breaking):** two RPCs appended after `identity.proto:31`, reusing the existing
response messages:
```
rpc AdminGetUserMetadata(AdminGetUserMetadataRequest) returns (GetUserMetadataResponse);
rpc AdminUpdateUserMetadata(AdminUpdateUserMetadataRequest) returns (UpdateUserMetadataResponse);
```
New request messages after `identity.proto:145` (mirror the self shapes with a `user_id` selector):
```
message AdminGetUserMetadataRequest { string user_id = 1; }
message AdminUpdateUserMetadataRequest {
  string user_id = 1;
  optional string phone = 2;
  optional string display_name = 3;
  optional google.protobuf.Struct metadata = 4;
}
```
Reuses `UserMetadata` (`identity.proto:130`). No migration (the `006_user_metadata` columns already
back it), no config keys.

**Identity wiring & DRY:** the two new RPCs auto-wire via the single `addService(IdentityServiceService,
identityImpl)` call (`src/index.ts:49-52`) once buf-gen regenerates the service definition — **no
`src/index.ts` edit**; implement two same-named class methods `adminGetUserMetadata` /
`adminUpdateUserMetadata` on `IdentityServiceImpl` (`@grpc/grpc-js` binds by method name). Extract
three helpers from the self handlers (`identityServiceImpl.ts:536-615`) — `rowToUserMetadata(r)`
(emits **all 6 keys unconditionally**, `?? undefined` shape — never conditional-spread),
`selectUserMetadata(pool, userId)`, `buildMetadataSet(req)` — called by self + both admin handlers
(one row→proto mapper, one SET-builder; closes the fails.md:537-539 lockstep trap).

**Audit:** admin **write** (`adminUpdateUserMetadata`) emits `auditSafe('identity.user.metadata_updated',
{acting admin + target user_id, no secrets})` (reuses `identityServiceImpl.ts:625`, `ledgerAudit.ts`);
admin **read** does not audit (consistent with existing `getUser`/`listUsers`).

**Error/edge semantics** (all mirror existing precedent, verified against source in round 4):
- Not-found target → gRPC `NOT_FOUND` (code 5) for both new RPCs (self `getUserMetadata` :548-550;
  admin `getUser` :701); feature-043 handlers already return code 5 for missing users on
  set_roles/set_active (:765)/reset_password.
- Metadata 8KB CHECK (`006_user_metadata.up.sql:7-8`, `octet_length(metadata::text) <= 8192`) →
  Postgres SQLSTATE `23514` → gRPC `INVALID_ARGUMENT` (code 3, "metadata exceeds 8KB limit"), via a
  **shared `mapDbError(err)` helper** (23505→ALREADY_EXISTS, 23514→INVALID_ARGUMENT, else
  INTERNAL+`err.message`) applied to `createUser`, self `updateUserMetadata`, and the new
  `adminUpdateUserMetadata`. This also **fixes the pre-existing self-path leak** (self
  `updateUserMetadata` currently maps every error to INTERNAL, :611-614), keeping the self and admin
  paths byte-consistent (C-10). The helper is applied only to handlers that can raise those SQLSTATEs
  (no dead branches).
- Empty update (no fields) → `INVALID_ARGUMENT` "at least one field required" (self :586-588); the
  emptiness check stays in the handler (not `buildMetadataSet`) so both call sites behave identically;
  `admin_set_user_metadata` also pre-checks all-None args in the tool (mirrors `tools.py:1322-1325`).
- Role validation → client-side guard is authoritative: the tool validates each role string against
  `{admin, trader, viewer}` and raises `ValueError` on unknown (and on an empty/all-unknown
  `set_roles` list), because the backend silently drops unknown/`0` enums (`rolesToStrings` filter,
  `identityServiceImpl.ts:18-20`); `client.py` maps strings→`Role` enum ints (port of
  `ROLE_STRING_TO_ENUM`, `identityServiceImpl.ts:16`).
- Target = self → allowed for all ops; the atomic last-admin guard (`setUserRoles` :748-767,
  `setUserActive` :790-808, `rowCount===0`→`FAILED_PRECONDITION` "cannot remove last admin") already
  covers a self-demotion/deactivation of the last active admin. `reset_password` on self revokes own
  refresh tokens (existing behavior).
- Cross-user PII: `adminGate` is sole/sufficient authority (returning another user's profile IS the
  purpose); the only added requirement is **never log/trace the profile body** (handlers log only
  `err.message` today, :563/:612 — keep that). `metadata` JSONB is the user's own free-form field;
  no config-secret redaction applies.

**Ordered step boundaries for /sdd-spec:**
1. **proto** — add 2 RPCs (after :31) + 2 request messages (after :145); `./scripts/buf-gen.sh`;
   commit regenerated `packages/proto/gen/`. Gate: `buf lint` + `buf breaking` green; empty
   `git diff packages/proto/gen/` after regen (C-09).
2. **identity + tests** — extract `rowToUserMetadata`/`selectUserMetadata`/`buildMetadataSet` +
   `mapDbError`; add `adminGetUserMetadata`/`adminUpdateUserMetadata` methods (adminGate, body
   `user_id`, read no-audit / write `auditSafe`); route createUser + self updateUserMetadata + admin
   update through `mapDbError`. Paired tests (`identityServiceImpl.test.ts`): non-admin denial (@AC-7),
   write-audit / no-read-audit (@AC-8), no-secret (@AC-10), NOT_FOUND, 23514→INVALID_ARGUMENT (self +
   admin), empty-update, ts-proto **camelCase wire-loopback** on the new request fields, the
   **protobuf-es projection-parity** test (`UserMetadataSchema.fields.map(f=>f.localName)` set ===
   `Object.keys(rowToUserMetadata(fullyPopulatedRow))`), and the existing self tests (:493-542,
   :548-582) stay green.
3. **agent client + tests** — 8 `client.py` helpers (lazy `identity_pb2`, ephemeral channel,
   `_metadata()` derived-scope forward, camelCase projection) + Python `ROLE_STRING_TO_ENUM`. Tests:
   projection shape + `caplog` no-plaintext-password.
4. **agent tools + tests** — register the 5 tools; `tests/test_user_tools.py` (new) mirrors
   `test_account_tools.py:169/:183`: per-op dispatch, admin-scope-required denial (each tool),
   unknown-op / unknown-role `ValueError`, password-not-echoed.
5. **inventory sync** — same-PR F-12 surfaces: `app/tools.py:4` docstring (Thirty-five→Forty +5),
   `docs/runbooks/mcp-tools.md:3`&`:37` + entries, `services/xstockstrat-agent/CLAUDE.md` count +
   MCP-tools table rows + Management-tool-authorization paragraph, and the executable guard
   `tests/test_tools_endpoint.py:17` exact 40-name set. Separately `copilot.ts:13` 32→40 + rewritten
   comment + cross-reference comment to `test_tools_endpoint.py` (manual-sync surface; no auto-guard).

## Rejected Alternatives

- **Admin `target_user_id` arg on the shipped `get_user_metadata`/`set_user_metadata`** — DRYer (2 tools
  not 4) but mixes self + admin authz in one tool and risks regressing `@AC-1 @feature-148`; pay DRY
  below the tool boundary instead.
- **`manage_strategy` op→single-RPC-enum map for `manage_user`** — its ops map to *different* RPCs, so
  the enum-map shape doesn't fit; use `manage_account` per-op dispatch.
- **Overload self-only `GetUserMetadata`/`UpdateUserMetadata` with a body `user_id`** — breaks C-03
  "subject from `x-user-id`, never body"; add additive admin RPCs instead.
- **New dedicated `Admin*Response` messages** — unnecessary; reuse `GetUserMetadataResponse`/
  `UpdateUserMetadataResponse` (documented shared-contract constraint below).
- **`src/index.ts` per-method handler map** — no such map exists; the service uses the untyped-class +
  single `addService` house style. Just name the two class methods.
- **Auto-guarded cross-service tool-count parity (vitest `TOOL_NAMES`)** — infeasible; the UI learns the
  catalog at runtime via `GET /api/tools`. `copilot.ts` stays a manual F-12 surface (feature-164 lesson).
- **Generated-password-returned-once for create** — rejected; caller supplies plaintext, never echoed.
- **Leave the self-path 8KB leak as an Open Risk** — rejected at the gate; fixed in-scope via the shared
  `mapDbError` since the metadata write is this feature's own primary write path (C-10).

## Open Risks

- [ ] **Response-message coupling** — `GetUserMetadataResponse`/`UpdateUserMetadataResponse` now serve
  both self and admin RPCs; a future self-only response-field change must reconsider the admin caller
  (and vice-versa). Documented shared-contract constraint. → carry into `context.md` Open Threads; no
  action this feature.
- [ ] **Dual proto-flavor projection-parity indirection** — the service serializes `UserMetadata` via
  ts-proto while the parity guard reflects `UserMetadataSchema` via protobuf-es; both derive from the
  same `.proto`, correct only while both stay generated from that source. → verify in step 2.
- [ ] **copilot.ts cross-service manual-sync residual (F-12)** — corrected to 40 but has no executable
  cross-service guard; a future tool add can re-drift it. Mitigation is the cross-reference comment,
  not automation. → step 5.
- [ ] **Self-metadata C-16 gap (non-blocking)** — `get_user_metadata`/`set_user_metadata` have no
  promoted `@AC-*` suite; the local identity self tests (:493-582) pin behavior across the refactor.

## Constitution Rules Touched

- `C-03` — honored: identity is derived from verified claims/headers; the new RPCs take the target as a
  body `user_id` selector, never as the identity; the agent never overrides `x-user-id`.
- `C-04` — honored: roles use the existing closed `Role` enum (`ROLE_UNSPECIFIED=0`); no new string set.
- `C-08` / `P-06` — honored: every non-frontend step (2,3,4) is paired with a RED-first test step; the
  UI-only `copilot.ts` change (step 5) is exempt from C-08 pairing (frontend constant, no auto-guard
  feasible).
- `C-09` — honored: proto step runs `buf lint`/`buf breaking` + `buf-gen.sh` with an empty gen diff gate.
- `C-10` — honored: the shared `mapDbError` + extracted metadata helpers keep self/admin paths
  consistent; the six MCP inventory surfaces are all updated in the same PR with the executable
  `test_tools_endpoint.py` guard.
- `C-14` — honored: the consumer surface is the 5 named agent MCP tools; each earns its own step.
- `F-01` — honored: no migration edited (none added).
- `F-04` — honored: every path/symbol cited from recon/source; nothing invented.
- `F-07` — honored: no hardcoded config; no config keys introduced.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1`/`@AC-2`/`@AC-3`/`@AC-4`/`@AC-5`/`@AC-6`/`@AC-10`/`@AC-11` "user-management-ui"
  (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — not regressed: FR-1..FR-6
  reuse the feature-043 handlers unchanged; no password/hash added to `UserMetadata`.
- EXTEND `@AC-7` "non-admin denied every user-management RPC" (same suite) — the 2 new admin RPCs join
  the `adminGate` denial set (non-admin → `PERMISSION_DENIED`).
- EXTEND `@AC-8` "every user-management action writes a ledger audit event" (same suite) — admin
  metadata **write** emits `identity.user.metadata_updated` (acting admin + target, no secrets); reads
  do not audit (consistent with existing readers; operator-decided).
- PRESERVE `@AC-8 @feature-156` "admin MCP tool forwards derived x-access-scope; backend gates"
  (`services/xstockstrat-agent/acceptance/fix-fundamentals-signal-producer.feature`) — followed: derived
  scope via `_metadata()`, no hardcoded admin.
- PRESERVE `@AC-1 @feature-148` "self-service tools forward only x-user-id, no admin scope"
  (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`) — dedicated new tools; the
  self-service metadata tools are untouched.
