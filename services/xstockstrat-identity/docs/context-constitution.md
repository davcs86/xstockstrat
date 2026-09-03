# xstockstrat-identity — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549` — feature 043 added user-management admin RPCs +
ledger audit; added IDENTITY-5..9, re-grounded IDENTITY-1..4 as the file grew ~500→861 lines).
Captures the **non-obvious** local
invariants of the identity service (JWT mint/verify, OAuth 2.1 AS backend, gRPC 50058). Does not
restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-identity**.

## Rules (`IDENTITY-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **IDENTITY-1** | **The JWT signing secret is env-only (`process.env.JWT_SECRET`, throws if unset) — NEVER from the config service.** | Routing the key through `ConfigWatcher.getString('identity.jwt.secret')` like the TTLs would silently sign with `''`/default and every cross-service verify would fail. This is the one deliberate exception to root PLAT-6. | getter `src/grpc/identityServiceImpl.ts:57-65` (used `:60`) | `src/grpc/identityServiceImpl.ts:57-65` |
| **IDENTITY-2** | **Refresh tokens & auth codes are stored as SHA-256 **hex**; the PKCE S256 challenge is compared as `sha256(verifier).base64url`.** Don't mix the encodings. | Hashing the verifier as hex mismatches the stored `code_challenge`; storing raw tokens is a leak. | hex `identityServiceImpl.ts:114,169,201,282,371,395,444`; base64url PKCE compare `:415` | `src/grpc/identityServiceImpl.ts:415` |
| **IDENTITY-3** | **In-handler errors use raw numeric gRPC codes (`3`/`5`/`6`/`9`/`13`/`16`), never the `status.*` enum, and handlers are untyped (`(call: any, callback: any)` under the `UntypedServiceImplementation` cast) — EXCEPT the shared `authz.ts` denial, which uses the `status` enum (`ADMIN_SCOPE_ERROR = { code: status.PERMISSION_DENIED }`, ported from the config service).** Match the raw-code house style in handlers; the one `status`-enum site is the shared gate. | A strongly-typed handler fights the registration cast, and importing `grpc.status` inline is inconsistent with every other handler — but the feature-043 shared authz gate deliberately reuses config's `status`-enum error object. | in-handler raw codes `identityServiceImpl.ts:49,80,115,119,269`; `src/index.ts:53` cast; shared `status`-enum denial `src/grpc/authz.ts:13,45-48`, thrown `identityServiceImpl.ts:669` | `src/grpc/identityServiceImpl.ts:52` |
| **IDENTITY-4** | **OAuth access tokens are `aud`-bound to the resource URI (RFC 8707); `ValidateToken` surfaces `aud`.** The `resource` param is threaded through the whole OAuth flow. | The MCP agent's inbound auth requires `claims.aud == AGENT_PUBLIC_URL`; dropping `resource` or diverging `aud`/`AGENT_PUBLIC_URL` breaks agent auth. | `mintOAuthAccessToken` `identityServiceImpl.ts:252-272`; `aud` surfaced `:155` | `src/grpc/identityServiceImpl.ts:252-272` |
| **IDENTITY-5** | **Every admin user-management RPC gates on the ADMIN scope bit FIRST via `adminGate(call, callback)` — reads included** (a deliberate divergence from the config service, which leaves reads open; AC-7). | Copying config's read-open convention for a new admin read RPC leaks the full user table. `adminGate`/`hasAdminAccessScope` fail closed on an absent/NaN scope. | `createUser:676`, `listUsers:704`, `getUser:717`, `updatePassword:734`, `setUserRoles:765`, `setUserActive:808` (all `identityServiceImpl.ts`); `adminGate` `:662-673`, `hasAdminAccessScope` `src/grpc/authz.ts:38-42` | `src/grpc/identityServiceImpl.ts:662-673` |
| **IDENTITY-6** | **Self-scoped RPCs derive the caller from the propagated `x-user-id` metadata (`userIdFrom(call.metadata)`), NOT a `userId` request-body field** (root PLAT-11). Contrast the LEGACY `listAuthorizedApps`/`revokeAuthorizedApp`, which still read `userId` from the body. | Copying `listAuthorizedApps` (body `userId`) for a new self-service RPC is an IDOR — any user reads/writes another user's profile. `authz.ts:5-11` declares "New identity RPCs should follow this pattern." | `getUserMetadata:559`, `updateUserMetadata:598` (`userIdFrom(call.metadata)`); legacy body-read `listAuthorizedApps`/`revokeAuthorizedApp`; declaration `src/grpc/authz.ts:5-11` | `src/grpc/identityServiceImpl.ts:559` |
| **IDENTITY-7** | **Admin mutations emit a best-effort ledger audit AFTER commit via double-guarded `auditSafe`, and the payload is an explicit safe-field allow-list — NEVER the spread request** (which carries the plaintext password). | `await`-ing the audit in the success path unguarded fails/rolls back the mutation on a ledger outage; spreading `call.request` leaks the plaintext password into the event store. `auditSafe` wraps `audit.append`, which itself swallows all errors. | `auditSafe:649-660` (wraps `ledgerAudit.ts:41-71`); emit sites `createUser:690`, `updatePassword:752`, `setUserRoles:794`, `setUserActive:843` | `src/grpc/identityServiceImpl.ts:649-660` |
| **IDENTITY-8** | **The last-admin guard is enforced ATOMICALLY inside the UPDATE's `WHERE EXISTS(… another active admin …)` clause, never count-then-write; `rowCount === 0` then disambiguates not-found vs. last-admin.** | A `SELECT count(admins)` then a conditional UPDATE is a TOCTOU race — two concurrent calls each strip the final admin. (AC-11/FR-11.) | `setUserRoles:773-792`, `setUserActive:815-834` (identical shape) | `src/grpc/identityServiceImpl.ts:773-792` |
| **IDENTITY-9** | **`identity.users.roles` is a `TEXT[]`; the proto `Role` enum is numeric — convert ONLY via `ROLE_ENUM_TO_STRING`/`ROLE_STRING_TO_ENUM`; `ROLE_UNSPECIFIED` (0) is never written, and an unknown stored string maps back to 0 (never silently dropped).** | Writing the numeric enum, or the enum's proto name, straight into the `TEXT[]` column (or a `viewer`/`admin` string not in the map) corrupts the row. | maps `identityServiceImpl.ts:15-25`; used `toUserView:31`, `createUser:679`, `setUserRoles:768` | `src/grpc/identityServiceImpl.ts:15-25` |

## Gotchas & scars

- **`refreshOAuthToken` bumps `last_used_at` before revoking; `refreshToken` does not** — intentional: `last_used_at` is a feature-051 "Authorized Apps" surface that exists only for OAuth-client grants (non-NULL `client_id`), irrelevant to first-party sessions. Evidence: `identityServiceImpl.ts:460-468` vs `:165-225`.
- **`revokeToken` decodes the JWT *without* verifying the signature** and revokes all refresh tokens for the decoded `user_id`, returning `success:true` even for garbage input ("decode without verify to handle expired tokens") — flagged as a ⚠ security open question in findings. Evidence: `identityServiceImpl.ts:232,235,238`. NOTE: the new `updatePassword`/`setUserActive` deliberately **sidestep** it by revoking keyed on the target `user_id` (`:748-751,837-840`, comment "sidesteps the unsigned-token revoke finding").
- **bcrypt cost=10 parity**: the seed hash (`$2b$10$…`) and `manage-users.sh` (`BCRYPT_ROUNDS=10`) must agree with any hash-producing tool (compare reads cost from the hash, so it's non-load-bearing but keep it consistent). Two new hash sites both use cost 10: `createUser:682`, `updatePassword:740`. Evidence: `migrations/002_seed_admin.up.sql:12`, `identityServiceImpl.ts:682,740`.
- **User `metadata` size is enforced ONLY by a DB CHECK (`octet_length ≤ 8192`, `006_user_metadata.up.sql:8`), not in app code.** `updateUserMetadata:607,614` writes `JSON.stringify(metadata)` with no length guard and its catch (`:633`) doesn't special-case Postgres `23514`, so an oversized write surfaces as a generic `code:13` "internal", not a `code:3` validation error. An agent assuming metadata is app-validated returns the wrong error class.

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| `Date`-for-Timestamp on all responses (`secondsToDate`) | `identityServiceImpl.ts:18-20` (root PLAT-1/F2; PR #442) |
| pg pool cap 2 / `DB_POOL_MAX` | `src/index.ts:32-36`; root pool budget |
| Config 90s snapshot gate before serving | `src/index.ts:19` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
