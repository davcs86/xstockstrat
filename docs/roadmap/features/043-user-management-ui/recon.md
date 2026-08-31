# Recon: user-management-ui

**Created**: 2026-08-31
**From**: product-spec.md
**Affected services**: `xstockstrat-identity` (Node), `xstockstrat-ui` (`/config-ui` segment), `packages/proto/identity/v1`

---

## Objective

Give platform admins a UI to create users, reset passwords, assign roles, and deactivate/reactivate
accounts without touching the DB. Six additive identity RPCs (`CreateUser`, `ListUsers`, `GetUser`,
`UpdatePassword`, `SetUserRoles`, `SetUserActive`), each admin-gated server-side, each emitting a
ledger audit event, surfaced as a new admin-only "Users" section in `/config-ui`. A server-side
last-admin lockout guard (FR-11) protects the final active admin.

## Codebase Map

- **`xstockstrat-identity`** (Node.js 24 / TypeScript, gRPC-only :50058)
  - Entry point / server wiring: `src/index.ts:13-60` (builds `Pool` max=2, `ConfigWatcher`, single `@grpc/grpc-js` server; adds `IdentityServiceService`)
  - Servicer: `src/grpc/identityServiceImpl.ts` — untyped `(call, callback)` house style; `bcrypt`/`jsonwebtoken`/`pg`
    - `authenticateUser` filters `is_active = true` (`:57`); `refreshToken` JOINs `u.is_active = true` (`:150`); `refreshOAuthToken` same (`:425`)
    - `revokeToken` decodes **without verify** and revokes all `refresh_tokens` for `user_id` (`:202-219`) — ⚠ known finding
    - Header-derived caller pattern (the model new RPCs should follow): `getUserMetadata`/`updateUserMetadata` read `userIdFrom(call.metadata)` (`:527-557`, `:566-609`)
  - Authz helper: `src/grpc/authz.ts:15-26` — `userIdFrom(md)` / `first(md,key)` on `x-user-id`. **No admin-scope check here today.**
  - Config reads: `ConfigWatcher.getInt('identity.jwt.access_ttl_seconds', 900)` etc. (`identityServiceImpl.ts:39-45`)
  - Last migration: `006_user_metadata.up.sql`; `users` table has everything this feature needs already
  - `users` schema: `migrations/001_identity_tables.up.sql:6-14` — `user_id UUID PK`, `email TEXT UNIQUE`, `password_hash TEXT`, `roles TEXT[] DEFAULT '{"trader"}'`, `is_active BOOLEAN DEFAULT TRUE`, `created_at`, `updated_at`
  - Seed admin: `migrations/002_seed_admin.up.sql:9-15` — `admin@localhost`, roles `{admin,trader}`, bcrypt("admin")
  - `refresh_tokens`: `001:27-34` (+ `client_id`/`last_used_at` from `004_refresh_token_client.up.sql:8-13`) — revocation via `UPDATE … SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL` (`identityServiceImpl.ts:209-212`)

- **`xstockstrat-ui`** (Next.js 15, BFF)
  - Config-ui BFF: `src/lib/configUiBff.ts:17-59` — `router.service(ConfigService, …)`; `setConfig` gates admin + injects author (`:21-43`); `forwardAdmin` for the analysis scan (`:53-55`); `createDispatch(router,'/config-ui/api')`
  - Shared BFF plumbing: `src/lib/bffShared.ts` — `requireSession` (`:32`), `backendHeaders` (`:41-47`, sets `x-access-scope=rolesToAccessScope(roles)`), `requireAdminScope` (`:50-54`), `forward`/`forwardAdmin` (`:63-79`)
  - Existing identity Connect client (reusable by the BFF): `src/lib/connectClients.ts:19,35` (`identityClient`)
  - Edge-safe auth: `src/lib/auth.ts:96` (`ADMIN_SCOPE=0x04`), `:98-114` (`rolesToAccessScope`/`hasAdminScope`; roles = viewer/trader/admin), `verifyAccessToken:25`
  - Middleware: `src/middleware.ts:24-56` — **authN only** (redirect-to-login); has `claims.roles` but performs no role-based route-guard today
  - Nav model: `src/components/shared/navGroups.tsx` — `NavItem.adminOnly` (`:17-20`), `Backfills adminOnly:true` precedent (`:67`), Settings group (`:80-97`); `PlatformHeader.tsx:203` filters `adminOnly` via `useHeaderIsAdmin` (`:48-63`, reads `/api/auth/me` `{isAdmin}`); legacy `PLATFORM_SUBNAV.config` (`PlatformHeader.tsx:86-90`)
  - Config-ui page template: `src/app/config-ui/sources/page.tsx` (admin CRUD page pattern); state/table primitives present: `components/ui/data-table.tsx`, `components/ui/alert-dialog.tsx`, `components/shared/{FormDialog,EmptyState,CardNotice,QueryStateMessages}.tsx`

- **`packages/proto/identity/v1/identity.proto`**
  - Service RPC block `:10-32`; `TokenClaims.roles = repeated string` (`:49`); OAuth/metadata messages `:60-136`. Field numbers start fresh per new message → additive/non-breaking.

- **`xstockstrat-ledger`** (Node, :50057) — `packages/proto/ledger/v1/ledger.proto:13-52`: `AppendEvent(event_type, source_service, correlation_id, stream_key, payload Struct, metadata, occurred_at, idempotency_key)` → `AppendEventResponse`.

## Patterns to REUSE

- **Server-side admin gate (Node backend)** → reuse the config service's `authz.ts` shape verbatim: `ADMIN_SCOPE=0x04` + `hasAdminAccessScope(md)` reading `x-access-scope` (fails closed on absent/NaN) + `ADMIN_SCOPE_ERROR` (`PERMISSION_DENIED "admin scope required"`), `services/xstockstrat-config/src/grpc/authz.ts:22,44-48,56-59`. This is the platform's first-and-canonical Node role check; copy it into identity rather than inventing one.
- **Caller identity from metadata** → `userIdFrom(call.metadata)` already in identity `authz.ts:24` (the acting-admin id for audit + last-admin comparisons).
- **BFF admin forwarding** → `forwardAdmin(...)` / `requireAdminScope` in `bffShared.ts:50-79`; register the six RPCs on `IdentityService` in `configUiBff.ts` using the existing `identityClient` (`connectClients.ts:35`). `CreateUser`/`UpdatePassword` keep an explicit body (never echo the password), mirroring `setConfig`'s explicit body (`configUiBff.ts:21-43`).
- **Admin-only nav entry** → add "Users" to `NAV_GROUPS` Settings group with `adminOnly:true` (exact `Backfills` precedent, `navGroups.tsx:67`) + `PLATFORM_SUBNAV.config`; the `visibleItems` filter (`PlatformHeader.tsx:203`) hides it from non-admins for free.
- **UI state/table/dialog** → `data-table.tsx`, `FormDialog.tsx`, `alert-dialog.tsx` (confirm deactivate), `EmptyState`/`CardNotice`/`QueryStateMessages` (C-17); template off `config-ui/sources/page.tsx`.
- **Ledger client (Node, grpc-js)** → construct `LedgerServiceClient` (grpc-js constructor exported from `@xstockstrat/proto/ledger/v1/ledger`, confirmed present via grep at `packages/proto/gen/ts/ledger/v1/ledger.ts:1389`) with `grpc.credentials.createInsecure()` against `LEDGER_ENDPOINT` — same generator family identity already uses for its server (`IdentityServiceService`). Use `AppendEvent` with an `idempotency_key` for safe retries.
- **Refresh-token revocation** → the exact `UPDATE identity.refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL` already in `identityServiceImpl.ts:209-212` (reuse for password-reset / deactivate invalidation — keyed on the *target* user_id, not a token, so it sidesteps the unsigned-decode finding).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1..@AC-7` ui-auth-improvements (`services/xstockstrat-ui/acceptance/ui-auth-improvements.feature`, feature 153) — login/Remember-me/401-redirect flow. This feature adds new admin RPCs + a page; it must not alter the login POST, cookie, or redirect behavior.
- **EXTEND** the login guarantee: `authenticateUser` already filters `is_active=true` (`identityServiceImpl.ts:57`); AC-5/AC-6 make "a deactivated user cannot log in / a reactivated user can" an explicit, first-class asserted guarantee (net-new coverage over existing code).
- **PRESERVE** `config-secrets-and-scoping.feature` (config admin-gate + secret redaction) — untouched; identity reuses the same `x-access-scope` admin-bit convention, does not change config.
- **PRESERVE** `platform.feature @AC-8` (feature 147, no shared agent secret) — this feature introduces no new secret/shared credential.
- No existing acceptance suite for `xstockstrat-identity` yet (this feature's scenarios would seed it at launch, C-16).

## Dependencies

- **Proto/RPC**: additive to `packages/proto/identity/v1/identity.proto` — 6 RPCs + request/response messages + `User` view (no password/hash field). Optional additive `Role` enum (see design decision). Fresh field numbers → `buf breaking` passes (C-09). `TokenClaims.roles` (`:49`) stays `repeated string` (unchanged).
- **Migration**: **none** — `users` already has `roles TEXT[]`, `is_active`, `created_at`, `updated_at` (`001:6-14`). No `F-01` surface.
- **Config keys**: none new. TTLs already read from config.
- **Inter-service edges**: **NEW** `xstockstrat-identity → xstockstrat-ledger` (`AppendEvent`, gRPC) — identity's *first* outbound per-request call. `xstockstrat-ui /config-ui → xstockstrat-identity` (already reachable via `identityClient`).
- **New env vars / ports**: `LEDGER_ENDPOINT` for identity is **already wired** — `docker-compose.yml:185-186` (+`depends_on`/`WAIT_FOR` on ledger), `.do/app.yaml:351-356`, `.do/app.dev.yaml:16,20`. No env-plumbing change needed; only the code that reads it is new. (Note the drift: `services/xstockstrat-identity/docs/context-constitution-findings.md:12` says the ledger dep was "removed from identity" — accurate only for the CLAUDE.md deps table; the deploy specs still carry the endpoint.)

## Risks / Not-found

- **Last-admin guard is TOCTOU-prone** (FR-11). A naive "count active admins, then mutate" allows two concurrent demotions/deactivations of two different admins to both pass and strip the platform of all admins. Must be resolved atomically (single conditional `UPDATE` guarded by an `EXISTS(other active admin)` subquery, or a row-locking transaction). See design.
- **C-03 now binds identity.** Identity becomes a service that makes outbound per-request gRPC calls (`AppendEvent`), so it must propagate `x-user-id`/`x-access-scope`/`x-trace-id` (root CLAUDE.md § Header Propagation). Its `src/middleware/propagation.ts` is currently dead code; the ledger call must carry the inbound trace as `correlation_id` and forward the headers.
- **Audit durability vs. AC-8.** AC-8 requires an event "is appended" on success, but the platform norm for ledger writes is best-effort-after-commit (no cross-service transaction). Resolution + the residual "ledger down ⇒ mutation succeeds, audit lost" risk in design.
- **Ledger client import path** — `LedgerServiceClient` existence confirmed via grep; `/sdd-spec` must pin the exact package specifier (`@xstockstrat/proto/ledger/v1/ledger`) and grpc-js construction (mirror `index.ts`'s server credentials) without Reading `gen/` (F-04 / codegen no-read rule).
- **`revokeToken` unsigned-decode finding** (`context-constitution-findings.md:17`) — do NOT build the new token-invalidation on top of it; key revocation on the target `user_id` from the (admin-authenticated) request, not a decoded token.
- **Proto-enum → exhaustive-TS-map coupling** (ledger `fails.md` 2026-07-21, C-10(a/d)) — if a `Role` enum is added, the new Users UI must ship an exhaustive `Record<Role,…>` label map in the same PR or `tsc` fails.

## Recommended Scope

Advisory step boundaries (input to grilling / `/sdd-spec`):
1. **proto** — add 6 RPCs + messages + `User` view (+ optional `Role` enum); `buf lint`/`buf breaking`/`buf-gen`.
2. **identity authz** — port the config `authz.ts` admin gate into identity; gate all six RPCs.
3. **identity servicer** — implement the six RPCs (bcrypt for create/reset; role/active mutations; **atomic last-admin guard**; token-revocation on password-reset + deactivate) + paired tests.
4. **identity ledger audit client** — grpc-js `LedgerServiceClient`, read `LEDGER_ENDPOINT`, C-03 propagation, per-mutation `AppendEvent` with redacted payload + idempotency key + best-effort error handling + paired test (assert append + no password/hash).
5. **ui BFF** — register the six RPCs on `configUiBff` via `forwardAdmin`/explicit body; reuse `identityClient`.
6. **ui Users section** — list/create/reset/roles/activate pages via `data-table`/`FormDialog`/`alert-dialog`; nav registration (`NAV_GROUPS` `adminOnly` + `PLATFORM_SUBNAV.config`) + nav-reachability e2e (C-10(a)); e2e for AC-1..AC-11; fixtures per C-12.
