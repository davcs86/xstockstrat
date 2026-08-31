# Design: user-management-ui

**Created**: 2026-08-31
**Rounds**: 2 (full; termination: approved — self-run debate, operator-confirm items flagged below)
**Approved by**: user @ 2026-08-31 (provisional — see § Process note)
**Grounded in**: recon.md

---

## Chosen Approach

Add six additive, admin-gated RPCs to `IdentityService`, surface them through the `/config-ui`
segment BFF as a new admin-only "Users" section, and emit a redacted ledger audit event per
mutation. No DB migration (the `users` table already carries `roles TEXT[]`, `is_active`,
`created_at`, `updated_at` — `migrations/001_identity_tables.up.sql:6-14`).

**1. Proto (additive).** `CreateUser`, `ListUsers`, `GetUser`, `UpdatePassword`, `SetUserRoles`,
`SetUserActive` + their request/response messages and a `User` view message with **no**
password/hash field. **Roles carried as a closed `Role` enum** (`ROLE_UNSPECIFIED=0, ROLE_ADMIN,
ROLE_TRADER, ROLE_VIEWER`) on the write inputs (`CreateUserRequest.roles`, `SetUserRolesRequest.roles`)
**and** the `User` view (C-04 — see resolution R1). Fresh field numbers per message; `TokenClaims.roles`
stays `repeated string` (`identity.proto:49`, untouched) → non-breaking (C-09).

**2. Identity admin gate.** Port the config service's Node admin gate verbatim into identity —
`ADMIN_SCOPE=0x04` + `hasAdminAccessScope(md)` (reads `x-access-scope`, fails closed) + `ADMIN_SCOPE_ERROR`
(`services/xstockstrat-config/src/grpc/authz.ts:22,44-48,56-59`). **Every** one of the six RPCs calls it
first (AC-7 covers reads too, so `ListUsers`/`GetUser` are gated as well — a deliberate divergence from
config, where reads are open). This is the load-bearing authz layer (guardrail: `unify-admin-auth-gates`
/ C-10(c)); the acting admin's id comes from `userIdFrom(call.metadata)` (`authz.ts:24`).

**3. Identity servicer.** Untyped `(call, callback)` house style, `bcrypt` for create/reset:
- `CreateUser` — `bcrypt.hash` the initial password, `INSERT` with the mapped `roles` (default `{trader}`),
  return the `User` view (never the hash). Duplicate email → `ALREADY_EXISTS`.
- `UpdatePassword` — admin reset (no current-password arg); `bcrypt.hash`, `UPDATE password_hash`,
  **then revoke the target's refresh tokens** (R3).
- `SetUserRoles` / `SetUserActive` — mutate `roles` / `is_active` behind the **atomic last-admin guard** (R4);
  deactivate also revokes refresh tokens (R3).
- `GetUser` / `ListUsers` — read-back views (email, roles, is_active, created_at), no hash.

**4. Identity → ledger audit client (new plumbing).** Construct a grpc-js `LedgerServiceClient`
(`@xstockstrat/proto/ledger/v1/ledger`, confirmed export) against the already-wired `LEDGER_ENDPOINT`
(`docker-compose.yml:185-186`, `.do/app.yaml:351-356`, `.do/app.dev.yaml:16,20`) using
`grpc.credentials.createInsecure()` (mirrors `index.ts` server creds). After each **successful** mutation,
`AppendEvent` with: `event_type` = `identity.user.{created|password_updated|roles_updated|activated|deactivated}`,
`source_service` = `xstockstrat-identity`, `stream_key` = `user:<target_user_id>`, `correlation_id` =
inbound `x-trace-id`, `idempotency_key` = `<event_type>:<target_user_id>:<monotonic/ts>`, and an
**explicitly-constructed** `payload` Struct of safe fields only (`acting_admin_user_id`, `target_user_id`,
`target_email`, and action-specific: new roles list / active bool) — **never** spread the request, so no
password/hash can leak (AC-8/AC-10). Best-effort after commit (R5); forwards C-03 headers on the call.

**5. Consumer surface — `/config-ui` Users section (C-14).** BFF: register the six RPCs on
`configUiBff` (`IdentityService`) reusing `identityClient` (`connectClients.ts:35`) — `ListUsers`/`GetUser`
via `forwardAdmin`; `SetUserRoles`/`SetUserActive` via `forwardAdmin`; `CreateUser`/`UpdatePassword` keep an
explicit body that `requireAdminScope` then forwards **without echoing the password** (mirrors
`setConfig`, `configUiBff.ts:21-43`). UI: a list page (`data-table`) + create/reset/roles dialogs
(`FormDialog`) + a deactivate confirm (`alert-dialog`), state via `EmptyState`/`CardNotice`/
`QueryStateMessages` (C-17). Nav: add "Users" to `NAV_GROUPS` Settings group with `adminOnly:true`
(exact `Backfills` precedent, `navGroups.tsx:67`) + `PLATFORM_SUBNAV.config`; a nav-reachability e2e
walks the rendered shell (C-10(a)).

## Rejected Alternatives

- **Open `TEXT[]` role strings at the RPC boundary (server-side allow-list only)** — rejected: roles are a
  closed, deployment-time set (`viewer/trader/admin` are hardcoded in `rolesToAccessScope`, `auth.ts:98-108`),
  which is exactly C-04's "prefer enum" case; an enum self-documents and validates at decode. Trade-off
  accepted: the enum adds a TS exhaustive-map obligation (R1) and a read-map, versus strings' zero mapping
  but no boundary type-safety. (Operator-confirm — see R1.)
- **Middleware admin route-guard for `/config-ui/users`** — rejected as the *primary* guard and as net-new
  scope: `src/middleware.ts` is authN-only today; the load-bearing authz is the BFF `forwardAdmin` + the
  identity server gate (both fail-closed), and the nav already hides the entry (`adminOnly`). A third authZ
  site in the Edge bundle duplicates logic for UX only. Trade-off: a non-admin who deep-links to the page
  sees an empty shell whose every RPC returns `PERMISSION_DENIED` — acceptable and matches platform
  convention (Backfills/config). (Operator-confirm — see R2.)
- **Synchronous, mutation-failing ledger audit (roll back on ledger error)** — rejected: no cross-service
  transaction exists; making user-management brittle to a ledger redeploy is worse than a best-effort audit,
  and every other service audits best-effort-after-commit. (See R5 residual risk.)
- **Naive count-then-mutate last-admin guard** — rejected: TOCTOU (two concurrent demotions both pass). Use
  the atomic conditional UPDATE (R4).
- **New `pg.Pool` / DB read for the audit or guard** — rejected: reuse the single identity `Pool` (max 2,
  `index.ts:32-41`); no new backend connection (F-06). The ledger write is a gRPC client, not a DB pool.
- **Hard-delete users** — out of scope (preserve ledger FK references); `SetUserActive(false)` only.

## Open Risks

- [ ] **Access-token deactivation lag.** `SetUserActive(false)` blocks new logins/refreshes immediately
  (`is_active` filter, `identityServiceImpl.ts:57,150`) and revokes refresh tokens, but an already-minted
  access JWT stays valid until expiry (≤ `identity.jwt.access_ttl_seconds`, default 900s). Accepted — matches
  the platform's short-TTL, no-per-call-revocation-list model. — to be noted at the identity servicer step.
- [ ] **Role-change propagation lag.** `SetUserRoles` does not force token invalidation (R3); a demoted
  admin keeps the admin scope bit until the access token refreshes (≤15 min). Accepted default; operator may
  opt into revoke-on-role-change. — identity servicer step.
- [ ] **Audit durability.** Best-effort ledger write (R5): if the ledger is unreachable, the mutation still
  succeeds and the audit event is lost (logged as an error). Accepted, consistent with platform norm. — audit-client step.
- [ ] **Ledger client import specifier** must be pinned by `/sdd-spec` via grep, not by Reading `gen/` (F-04). — proto/audit-client step.

## Constitution Rules Touched

- `C-04` — honored by: closed `Role` enum with `ROLE_UNSPECIFIED=0` for the closed role set (R1).
- `C-03` — honored by: identity's new outbound `AppendEvent` propagates `x-user-id`/`x-access-scope`/`x-trace-id` (identity becomes an outbound caller for the first time; correlation_id = inbound trace).
- `C-09` — honored by: additive proto only, fresh field numbers, `buf lint`/`buf breaking`/`buf-gen` in the proto step; `TokenClaims` unchanged.
- `C-10(a)` — honored by: "Users" registered in `NAV_GROUPS` + `PLATFORM_SUBNAV.config` with a nav-reachability test.
- `C-10(c)` — honored by: admin enforced at **every** identity RPC write path via the trusted `x-access-scope` bit (not UI-only), per `unify-admin-auth-gates`.
- `C-10(a/d)` — honored by: the `Role` enum's exhaustive TS `Record<Role,…>` label map shipped in the same PR as the enum (ledger 2026-07-21 trap).
- `C-08` / `P-06` — honored by: each identity service step has a paired red-before-green test meeting the Node ≥40% threshold; e2e covers AC-1..AC-11 (C-15).
- `C-12` — honored by: new user domain fixtures added to `services/xstockstrat-ui/e2e/fixtures/` + `INVENTORY.md`.
- `C-14` — honored by: the `/config-ui` Users section is a named, in-scope consumer surface with its own steps.
- `C-16` — honored by: preserves the ui-auth login flow; extends the deactivated/reactivated-login guarantee (below).
- `C-17` — honored by: reuse `data-table`/`FormDialog`/`alert-dialog`/`EmptyState`/`CardNotice`/`QueryStateMessages`, design-role tokens, accessible control names.
- `F-01` — honored by: no migration touched (no schema change needed).
- `F-06` — honored by: reuse identity's single `Pool` (max 2); the audit path is a gRPC client, no new DB connection.
- `F-07` — honored by: no hardcoded config values; endpoints come from `LEDGER_ENDPOINT` env (connection var, not a config value), TTLs from `WatchConfig`.
- `F-04` — honored by: the ledger client specifier is pinned by grep at spec time, never invented.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1..@AC-7` "ui-auth-improvements" (`services/xstockstrat-ui/acceptance/ui-auth-improvements.feature`) — not regressed: no change to the login POST, cookies, or 401-redirect.
- EXTEND login guarantee — new case added: a deactivated user cannot log in and a reactivated user can (AC-5/AC-6), making explicit the existing `is_active` filter (`identityServiceImpl.ts:57`).
- PRESERVE `config-secrets-and-scoping.feature` and `platform.feature @AC-8` — untouched; no config change, no new shared secret.
- (No prior `xstockstrat-identity` acceptance suite; this feature's scenarios seed it at launch.)

## Process note

Run in a subagent without `Task`/`AskUserQuestion` access, so the proposer/adversary rounds and the P-04
approval gate were **self-run and are provisional** (ledger `fails.md` 2026-08-08, 121/122/123). The four
genuine forks below must be confirmed by the real operator before/at `/sdd-spec`; each carries a concrete
recommendation, not a silent guess (C-11 / P-03):
- **R1 (roles)**: closed `Role` enum (C-04-favored) vs. open strings — recommend **enum**.
- **R2 (middleware guard)**: recommend **no** new middleware admin route-guard (BFF+backend are load-bearing; nav hides).
- **R3 (token invalidation)**: recommend **revoke refresh tokens on `UpdatePassword` and `SetUserActive(false)`**; leave `SetUserRoles` eventual (≤15 min).
- **R4 (last-admin guard)**: recommend an **atomic conditional UPDATE** (guarded by `EXISTS(other active admin)`) — no count-then-write.
- **R5 (audit)**: recommend **best-effort after commit** with idempotency key + error logging.
