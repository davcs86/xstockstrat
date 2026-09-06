# Recon: mcp-user-profile-roles

**Created**: 2026-09-06
**From**: product-spec.md
**Affected services**: `packages/proto`, `xstockstrat-identity`, `xstockstrat-agent`

---

## Objective

Expose user administration (create/list/get/set-roles/activate-deactivate/reset-password) and admin
view/edit of **any** user's profile metadata as admin-gated MCP agent tools. The six user-admin RPCs
already exist (feature 043); the net-new work is the agent tool surface + client wiring, plus **new
additive identity RPCs** for admin cross-user profile access (today's metadata RPCs are self-only).

## Codebase Map

- **`packages/proto`**
  - Identity contract: `packages/proto/identity/v1/identity.proto`
  - Admin RPC decls (feature 043): `identity.proto:35-40`; `Role` enum `:150-155`; `User` (fields 1-5) `:158-164`; request/response `:166-195`
  - Self-only metadata (feature 130): `GetUserMetadataRequest {}` `:138`, `UpdateUserMetadataRequest {optional phone=1; display_name=2; metadata=3}` `:140-144`, `UserMetadata` (fields 1-6) `:130-137`
- **`xstockstrat-identity`** (Node.js/TS, gRPC 50058)
  - Servicer: `src/grpc/identityServiceImpl.ts`; wired `src/index.ts:45-52`
  - `adminGate()` (metadata present + `hasAdminAccessScope`, fails closed): `identityServiceImpl.ts:638`
  - Admin handlers: `createUser :651`, `listUsers :679`, `getUser :692`, `setUserRoles :739`, `setUserActive :782`; each audits via `auditSafe`/`src/grpc/ledgerAudit.ts`
  - Self metadata handlers: `getUserMetadata`/`updateUserMetadata` `:536-615` (subject from `x-user-id` via `userIdFrom`, never body)
  - Authz: `src/grpc/authz.ts:10` `ADMIN_SCOPE = 0x04`, `HEADER_ACCESS_SCOPE`, `ADMIN_SCOPE_ERROR :35`
  - Role maps: `identityServiceImpl.ts:15-24` (`ROLE_ENUM_TO_STRING`/`ROLE_STRING_TO_ENUM`, `rolesToStrings`/`stringsToRoles`)
  - Last migration: `006_user_metadata.up.sql` (`services/xstockstrat-identity/migrations/`) — metadata columns already present; **no new migration**
- **`xstockstrat-agent`** (Python, MCP HTTP 9000)
  - Tools registered in `register_tools()` — `app/tools.py` (`@server.tool()`); gRPC helpers in `app/client.py` (lazy stub import + ephemeral channel + `_metadata()`)
  - Caller identity: `_caller_user_id` `tools.py:118`, `_caller_access_scope` `tools.py:106`; scope map `app/scopes.py:39` (admin→0x0F incl. `_ADMIN=0x04` `scopes.py:35`); propagation `_metadata()` `client.py:56`
  - Self-metadata tools: `get_user_metadata tools.py:1300`, `set_user_metadata tools.py:1310`; client `client.py:1270/1293`

## Patterns to REUSE

- **manage_user verb dispatch** → reuse the `manage_account` style: `if operation ==` dispatch inside the tool, each op calling a distinct `client.py` helper, trailing `else: raise ValueError("unknown operation …")` — `tools.py:1602`, dispatch `:1640/:1654/:1660/:1664`, reject `:1675`. (Not `manage_strategy`'s op→single-RPC-enum map at `client.py:825`, since manage_user ops map to *different* RPCs.)
- **Admin gating** → forward the caller's **derived** scope (never hardcode admin), and let identity's `adminGate` authorize. Optional friendlier early check mirrors `manage_account resume`: `scope = _caller_access_scope(...); if not (scope & 0x04): raise PermissionError(...)` — `tools.py:1667`. Backend gate is authoritative — `authz.ts:10`.
- **Client helper shape** → mirror `get_user_metadata`/`update_user_metadata` (`client.py:1270-1319`): lazy `identity_pb2` import, ephemeral channel, `_metadata(...)`, `MessageToDict(preserving_proto_field_name=False→camelCase)` projection with `HasField`.
- **New admin-profile RPC shape** → reuse the existing `UserMetadata` message (`identity.proto:130`) as the response; new request adds a target `user_id` selector to the self-only request shapes.
- **Audit** → reuse `auditSafe`/`ledgerAudit.ts` as the existing admin handlers do (e.g. `identity.user.roles_updated`) for the new admin-profile write.
- **Tests** → `tests/conftest.py:12-17` (`ADMIN`/`TRADER`/`VIEWER` claim dicts + `_ctx()`); admin-gate template `tests/test_account_tools.py:169/:183` (`test_resume_dispatches_to_client` / `test_resume_requires_admin_scope`); inventory guard `tests/test_tools_endpoint.py:17` (exact tool-name set); descriptor-parity model `tests/test_backtest_view.py:189`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1` "Admin lists all users" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — `ListUsers` returns email/roles/active/created, never a password/hash.
- **PRESERVE** `@AC-2` "Admin creates a new user who can then sign in" (same) — `CreateUser` yields a listable, loginable active user.
- **PRESERVE** `@AC-3` "Admin resets a password without the current password" (same) — `UpdatePassword` echoes no hash; old password stops working.
- **PRESERVE** `@AC-4` "Admin assigns and removes roles" (same) — `SetUserRoles` round-trips via `GetUser`.
- **PRESERVE** `@AC-5` / `@AC-6` "Admin deactivates / reactivates a user" (same) — `SetUserActive` toggles login.
- **EXTEND** `@AC-7` "A non-admin caller is denied every user-management RPC" (same) — the new admin cross-user profile RPCs must **join** this admin-gated denial set (non-admin → `PERMISSION_DENIED`), not be left ungated.
- **EXTEND** `@AC-8` "Every user-management action writes a ledger audit event" (same) — the new cross-user profile **write** must append an audit event naming acting admin + affected user, no secret values.
- **PRESERVE** `@AC-10` "Passwords are never returned or displayed" (same) — binds the new profile surface too (no pw/hash in any response/log).
- **PRESERVE** `@AC-11` "The last active admin cannot be deactivated or demoted" (same) — `FAILED_PRECONDITION`; preserved since set_roles/set_active reuse existing handlers unchanged.
- **PRESERVE** `@AC-8 @feature-156` "admin MCP tool forwards derived x-access-scope; backend gates" (`services/xstockstrat-agent/acceptance/fix-fundamentals-signal-producer.feature`) — the forward-real-scope template the new admin tools must follow (never a hardcoded admin override).
- **PRESERVE** `@AC-1 @feature-148` "self-service tools forward only caller x-user-id, no admin scope" (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`) — the new cross-user admin tools must not regress the self-only `get_user_metadata`/`set_user_metadata` into cross-user reads.

## Dependencies

- Proto/RPC: **additive** — 2 new RPCs on `IdentityService` for admin cross-user profile (target `user_id` + reuse `UserMetadata`). Next field/RPC additions only; no removals/renumbering. `buf breaking` must stay green.
- Migration: **none** — `006_user_metadata` columns back the profile RPCs.
- Config keys: **none**.
- Inter-service edges: `xstockstrat-agent → xstockstrat-identity` (gRPC 50058), new RPCs on the existing channel; agent already calls identity for auth + self metadata.
- New env vars / ports: **none** (`IDENTITY_ENDPOINT` already wired in agent `client.py`).

## Risks / Not-found

- **OQ-1 (design fork — admin-profile tool shape).** Not decided: new dedicated admin tools vs. an admin `target_user_id` arg on the shipped self-service tools. Recon leans **new dedicated** — overloading the self-only tools mixes two authz models and risks regressing `@AC-1 @feature-148`. Debate settles this.
- **F-12 / RC-1 (fails.md:308-310) — six inventory surfaces drift.** Adding tools requires same-PR updates to: `tools.py:4` module docstring ("Thirty-five tools:"), `docs/runbooks/mcp-tools.md:3` & `:37`, `services/xstockstrat-agent/CLAUDE.md:43`, `app/client.py` builders, and the executable guard `tests/test_tools_endpoint.py:17` (exact name set). `plugins/strat-lab/skills/backtest/SKILL.md` references only strategy/backtest tools → **no change** unless those contracts move.
- **Pre-existing drift:** `services/xstockstrat-ui/src/lib/copilot.ts:13` `COPILOT_MCP_TOOL_COUNT = 32` is already wrong (real = 35) and unguarded by any parity test. Whether to correct it as part of this feature is a scope decision for the gate (it is a tool-count surface).
- **fails.md:532 & 546-549** — admin `x-access-scope` must come only from verified OAuth claims via `_caller_access_scope`/`_metadata`; the target `user_id` is a request selector, never the identity. No pre-auth blob carries identity.
- **fails.md:667-669 & 537-539** — identity is TS: new proto request fields read via ts-proto camelCase (or `?? both`), proven with a wire-level loopback test; any `UserMetadata` row→proto mapper updated in lockstep.
- **Gap (non-blocking):** self-service `get_user_metadata`/`set_user_metadata` have **no** promoted `@AC-*` suite, so their "don't regress self behavior" is not a C-16-enforceable guarantee today — this feature adds new tools rather than touching them, so no regression, but the gap is noted.

## Recommended Scope

Advisory step boundaries (input to grilling + `/sdd-spec`):
1. **proto** — add 2 additive admin metadata RPCs + request/response messages (reuse `UserMetadata`); `buf lint`/`buf breaking`/`buf-gen.sh`.
2. **identity service** — implement the 2 RPCs behind `adminGate`, target from body `user_id`, reuse metadata SET/SELECT, emit audit on write; + tests (@AC-7/@AC-8/@AC-10 parity).
3. **agent client** — add `client.py` helpers for `CreateUser`/`ListUsers`/`GetUser`/`SetUserRoles`/`SetUserActive`/`UpdatePassword` + the 2 admin-metadata RPCs (forward derived scope).
4. **agent tools** — `manage_user` (op dispatch), `list_users`, `get_user`, admin-profile read/write per OQ-1; + tool tests mirroring `test_account_tools.py`.
5. **inventory sync** — update the six F-12 surfaces + `test_tools_endpoint.py` exact set; decide copilot.ts.
