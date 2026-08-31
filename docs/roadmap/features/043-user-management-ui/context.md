# Context: user-management-ui

**Feature**: `docs/roadmap/features/043-user-management-ui/feature.md`
**Product Spec**: `docs/roadmap/features/043-user-management-ui/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/043-user-management-ui/implementation-spec.md`

---

## Session 2026-05-28T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Confirmed `identity.users` table already has `roles TEXT[]` and `is_active` — no DB migration required.
- Identified 6 new additive-only RPCs needed on `xstockstrat-identity`; all proto changes are non-breaking.
- UI will be a new "Users" section in `xstockstrat-config-ui` (not a new frontend).

## Session 2026-08-31 — sdd-story (in-place regenerate)

- Regenerated `product-spec.md` to the current template (kept feature number **043** and directory; status stays `draft`). Preserved all scope: FR-1..FR-10 verbatim, the six additive identity RPCs, and the `/config-ui` Users section. Corrected the affected-service name from `xstockstrat-config-ui` to the registry name `xstockstrat-ui` (config-ui is a segment, not a service); added the `## Consumer Surface(s)` (C-14, UI) section.
- Authored `acceptance.feature` (`@AC-1`..`@AC-10`, each tagged to its `@FR-*`); moved the previously inlined Acceptance Criteria list into it and left `## Acceptance Criteria` as a C-15 pointer.
- Folded three ledger traps into `## Open Questions` as one-line "Known trap" notes: admin authz must be enforced at every RPC write path via the `x-access-scope` admin bit, not UI-only (unify-admin-auth-gates / C-10(c)); backends are gRPC-only so no HTTP-header identity assumptions (formula-management-ui); and register the new Users section into the shared nav with a reachability test (060 / C-10(a)).
- Updated `feature.md`: added the acceptance.feature artifact link, bumped `**Last Updated**` to 2026-08-31, appended the regenerated Status History row.

## Session 2026-08-31 — sdd-review fixes (product-spec)

Product-spec review returned **PASS WITH WARNINGS**; addressed all three warnings (status stays `draft`,
number/slug unchanged, all FR-1..FR-10 and the six additive identity RPCs preserved).

- **Open Questions reorganized (review criterion 9).** `## Open Questions` no longer holds any unchecked
  genuine-unknown `- [ ]`; it now reads "None — moved to Design-Phase Decisions / Design Guardrails below."
  - New `## Design Guardrails` section (plain bullets): the three known-trap reminders — server-side authz
    at every RPC write path via `x-access-scope` (C-10(c)); gRPC-only identity plumbing (no HTTP-header
    identity); shared-nav `PLATFORM_SUBNAV` reachability with a nav test (C-10(a)) — plus the new
    ledger-audit-plumbing note (below).
  - New `## Design-Phase Decisions (owned by /sdd-design)` section (plain bullets): the three genuine forks
    — roles as a closed enum vs. open `TEXT[]` strings; a Next.js middleware admin route-guard as
    defense-in-depth; whether `UpdatePassword`/`SetUserActive` should invalidate existing refresh tokens.
- **Last-admin lockout guard added (warning 2).** Added **FR-11**: `SetUserActive(active=false)` and
  `SetUserRoles` must refuse to deactivate/demote the final active admin (incl. seeded `admin@localhost`),
  returning gRPC `FAILED_PRECONDITION` "cannot remove last admin", enforced server-side in identity.
  Added covering scenario **@AC-11 @FR-11** in `acceptance.feature` with concrete values (deactivating the
  only remaining active admin, and stripping its `admin` role, are both rejected with `FAILED_PRECONDITION`
  "cannot remove last admin"). Noted the guard in the identity Affected-Services entry.
- **Identity→ledger audit = new plumbing (warning 3).** Added a Design Guardrails note that FR-8/AC-8's
  per-action ledger audit is NOT an existing capability to reuse: identity has no ledger-write client today
  — the fictional `xstockstrat-ledger` dep + `LEDGER_ENDPOINT` were removed and auth events are only
  `log.info` lines (grounded in `services/xstockstrat-identity/docs/context-constitution-findings.md`). The
  gRPC ledger client + `LEDGER_ENDPOINT` wiring + `AppendEvent` calls + password/hash redaction are new
  plumbing to build and verify at design.
- Verified: NO unchecked `- [ ]` remains under `## Open Questions`.

## Session 2026-08-31 — sdd-review product-spec (approved)

- Product spec approved: `draft` → `spec-ready`. All `/sdd-review` blockers and warnings were addressed (see the sdd-review-fixes session above).
- NOTE: the confirming re-review pass was interrupted by a session usage/rate limit; fixes were applied against each reviewer's explicit findings. For 021 specifically, the orchestrator manually caught and fixed a residual field-name error (`service_origin` → `source_service`; the ledger `Event` has no `user_id` field). A quick re-review can re-confirm on resume.

## Session 2026-08-31 — sdd-design (FULL)

Wrote `recon.md` (Phase 0) + `design.md` (Phase 1). Did NOT flip `status.md` (left `spec-ready`);
no code/other files changed.

**Grounded recon findings (evidence-cited in recon.md):**
- Admin gate to reuse: the config service's `authz.ts` is the canonical Node role check —
  `ADMIN_SCOPE=0x04`, `hasAdminAccessScope(md)` (reads `x-access-scope`, fails closed), `ADMIN_SCOPE_ERROR`
  (`services/xstockstrat-config/src/grpc/authz.ts:22,44-48,56-59`). Port it into identity; gate all six RPCs
  (reads too, per AC-7).
- Identity→ledger is genuinely new **code**, but the **endpoint env is already wired**: `LEDGER_ENDPOINT`
  + `depends_on`/`WAIT_FOR` on ledger exist in `docker-compose.yml:185-186`, `.do/app.yaml:351-356`,
  `.do/app.dev.yaml:16,20`. (The findings-doc "ledger dep removed from identity" is accurate only for the
  CLAUDE.md deps table, not the deploy specs.) `LedgerServiceClient` (grpc-js) export confirmed at
  `packages/proto/gen/ts/ledger/v1/ledger.ts:1389` (existence via grep; `/sdd-spec` pins the specifier, F-04).
- No DB migration (users table already has roles/is_active/timestamps, `001:6-14`). No new config keys.
- Nav: `NAV_GROUPS` (not `PLATFORM_SUBNAV`) is the live shell; `NavItem.adminOnly` + `Backfills`
  precedent (`navGroups.tsx:67`) + `visibleItems` filter (`PlatformHeader.tsx:203`) give admin-hide for free.
- `middleware.ts` is authN-only today (has `claims.roles`, no route-level authZ).
- C-03 now binds identity (its first outbound per-request call).

**Resolved the four Design-Phase Decisions (recommendations; see design.md § Process note):**
- **Roles enum vs strings** → **closed `Role` enum** (`ROLE_UNSPECIFIED=0`,ADMIN,TRADER,VIEWER) on write
  inputs + `User` view; `TokenClaims.roles` stays `repeated string`. C-04 (closed deployment-time set) wins
  over the strings alternative; the enum obliges an exhaustive TS `Record<Role,…>` in the same PR (C-10(a/d),
  ledger 2026-07-21). Rejected: open strings + server allow-list.
- **Middleware admin route-guard** → **do NOT add one**. Load-bearing authz = BFF `forwardAdmin` + identity
  server gate (both fail-closed); nav hides via `adminOnly`. A third Edge authZ site is UX-only scope creep.
- **Refresh-token invalidation on mutate** → **revoke on `UpdatePassword` and `SetUserActive(false)`** (reuse
  `UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1`, `identityServiceImpl.ts:209-212`, keyed on
  the *target* user_id — sidesteps the `revokeToken` unsigned-decode finding). Leave `SetUserRoles` eventual
  (≤ access-TTL 15 min). Access-token deactivation lag (≤15 min) accepted as open risk.
- **Last-admin guard** → **atomic conditional UPDATE** guarded by `EXISTS(other active active-admin)` (or a
  row-locking tx), NOT count-then-write (TOCTOU on concurrent demotions). `FAILED_PRECONDITION "cannot remove
  last admin"` when 0 rows affected and the target is the final active admin.
- **Ledger audit client** → best-effort **after** the DB commit, awaited + try/catch (log on failure, don't
  roll back), `idempotency_key` for safe retry, payload built from an explicit safe-field allow-list (never
  spread the request → no password/hash), C-03 headers forwarded. Residual "ledger down ⇒ audit lost" risk
  accepted (platform norm).

**Floor check:** no unresolved F-* breach. F-01 (no migration), F-06 (reuse single Pool, gRPC not a new DB
pool), F-07 (endpoint is env, TTLs from config), F-04 (client specifier pinned by grep at spec).

**Process caveat (P-04 / ledger 2026-08-08):** run in a subagent without `Task`/`AskUserQuestion`; the
proposer/adversary debate and the approval gate were self-run and are **provisional**. The four forks above
must be confirmed by the operator before/at `/sdd-spec`. Status intentionally NOT advanced to
`design-approved` by this subagent.

## Session 2026-08-31 — sdd-spec

- Generated implementation-spec.md with **10 steps** (isolated `/sdd-spec` run: this session wrote
  only implementation-spec.md and this context log; `status.md` and `feature.md` were intentionally
  left unchanged for the orchestrator to advance). Consumed the approved design.md (chosen approach:
  6 additive admin RPCs + `/config-ui` Users section + best-effort redacted ledger audit) and reused
  recon.md's Codebase Map as grounded evidence; re-verified the deeper details recon pointed to
  before citing them.
- Step boundaries follow recon's recommended scope: proto → proto-gen → identity authz gate →
  identity servicer → identity unit tests → identity ledger audit client → audit unit test → UI BFF →
  UI Users section → UI e2e. Every `@AC-1..@AC-11` mapped to a covering step (see § Scenario Coverage).
- Key codebase findings (all grep/Read-confirmed):
  - **Ledger client specifier pinned by grep (F-04):** `LedgerServiceClient` is a grpc-js generic
    client constructor exported at `packages/proto/gen/ts/ledger/v1/ledger.ts:1389`; import subpath
    `@xstockstrat/proto/ledger/v1/ledger` (mirrors identity's own server import at `src/index.ts:5`).
    Never read `gen/` for the shape — only grep-pinned the export.
  - **Identity `authz.ts` already exists** (feature 130) with `first`/`userIdFrom`/`HEADER_USER_ID`
    but **no admin gate**; Step 3 ports the config gate verbatim (`ADMIN_SCOPE=0x04`,
    `hasAdminAccessScope`, `ADMIN_SCOPE_ERROR`) from `services/xstockstrat-config/src/grpc/authz.ts:22,44-48,56-59`.
  - **No DB migration** — `users` already has `roles TEXT[]`/`is_active`/`created_at`/`updated_at`
    (`migrations/001_identity_tables.up.sql:6-14`); last migration is `006_user_metadata`.
  - **`LEDGER_ENDPOINT` for identity is already wired** (`docker-compose.yml:185-186` + both `.do`
    specs) — no deployment-file change; only the reader code is new. Identity becomes an outbound
    caller for the first time → C-03 binds it (headers read from `call.metadata`, `x-trace-id` =
    `correlation_id`); do NOT revive the dead `src/middleware/propagation.ts`.
  - **Atomic last-admin guard (FR-11/AC-11)** designed as a single conditional `UPDATE` guarded by
    `EXISTS(other active admin)` — no count-then-write (TOCTOU).
  - **`Role` enum → exhaustive TS `Record<Role,…>`** obligation (C-10(a/d), fails.md 2026-07-21) lands
    in the same PR as the enum via `src/lib/roleLabels.ts`; `pnpm run build` (tsc) is its gate.
  - **⚠ Test-execution trap (fails.md 2026-07-29 / 074):** the existing identity test lazy-imports
    `../grpc/identityServiceImpl.js` in a silent try/catch (strip-only guard). The new paired tests
    must actually resolve and assert; the `c8 --lines 40` `test:coverage` gate is the backstop, and
    P-06 red-before-green must show a real red.
  - **`e2e/fixtures/users.ts` exists** with identity constants only (no `User`-view row) → Step 10
    extends it with a `User`-view fixture + `INVENTORY.md` row (C-12).
- Floor check: no F-* breach. F-01 (no migration), F-04 (ledger specifier grep-pinned), F-06 (gRPC
  client, not a new `pg.Pool`; single identity Pool reused), F-07 (endpoint from env, TTLs from config).
- Deduped reviewers across the 10 steps (recorded per-step in implementation-spec.md): Proto Reviewer,
  xstockstrat-identity owner, Security, xstockstrat-ledger owner, xstockstrat-ui owner. Next:
  `/sdd-review user-management-ui impl-spec`.

## Session 2026-08-31 — sdd-review impl-spec (advisory)

- Result: 0 failures, 3 warnings, 2 notes (advisory; no Floor breach). Nav correctly registers in the RENDERED NAV_GROUPS (page reachable); proto/handlers/last-admin-guard/revocation/audit-client all confirmed grounded.
- Unresolved ⚠ carried into execution:
  - Step 6: audit `idempotency_key` `${eventType}:${targetUserId}:${Date.now()}` is NOT stable across retries, defeating ledger dedup. Derive from stable inputs (e.g. `eventType:targetUserId` + a per-request/correlation id), or drop the "deterministic" claim and state fire-once best-effort. — [ ] unaddressed
  - Step 9 instruction 5: adding Users to `PLATFORM_SUBNAV.config` is dead work (`PlatformHeader.tsx:116` ignores that prop) — drop instruction 5 and remove `PlatformHeader.tsx` from Step 9 Files; AC-9/reachability is delivered entirely by the `navGroups.tsx` registration (instruction 4). — [ ] unaddressed
  - Step 2: `packages/proto/gen/**` wildcard Files — accepted proto-gen convention, bounded by the freshness check. — [ ] note only
  - Notes: last-admin guard is atomic per-row but two concurrent demotions of DIFFERENT admins can write-skew to zero under READ COMMITTED (design-accepted R4; needs SERIALIZABLE/advisory lock only if strict >=1 admin required); Role enum interim window safe (brand-new enum, no pre-existing exhaustive consumer). — [ ] note only
- Overlap findings: batch scan CLEAN; 043 shares navGroups.tsx / PlatformHeader.tsx with 029/031 (rebase-only).

## Session 2026-08-31 — sdd-execute (sequential)

Executed on `feature/user-management-ui`, off clean `main-dev`. Unattended run. Reused the pinned
codegen container built for feature 021 (buf 1.72.0 + plugins). Carried the two impl-review ⚠ into
execution: Step 6 audit idempotency_key must be stable (addressed at Step 6); Step 9 drops the dead
`PLATFORM_SUBNAV.config` edit (addressed at Step 9 — nav is `NAV_GROUPS`-only).

### Step 1 — proto: 6 admin RPCs + Role enum + password-free User view [done]
- `identity.proto`: added `CreateUser/ListUsers/GetUser/UpdatePassword/SetUserRoles/SetUserActive`
  RPCs; closed `Role` enum (UNSPECIFIED/ADMIN/TRADER/VIEWER); `User` view (no password/hash); the six
  request/response pairs (roles as `Role` enum on write inputs). TokenClaims untouched (JWT shape).
- TDD N/A. `buf lint` OK; `buf breaking` against main-dev clean (additive). Files: `identity.proto`.

### Step 2 — proto-gen: regenerate stubs [done]
- `./scripts/buf-gen.sh` in the codegen container. 12 gen files changed, **all identity** (Go pb/grpc/
  connect, Python pb2/grpc, TS ts-proto + connect + compiled dist), 0 non-identity — additive, no drift.
- TDD N/A. Files: `packages/proto/gen/**`.

### Step 3 — service: port the config admin gate into identity authz.ts [done]
- `authz.ts`: added `import { Metadata, status }`, `ADMIN_SCOPE=0x04`, `HEADER_ACCESS_SCOPE`,
  `hasAdminAccessScope` (fails closed), `ADMIN_SCOPE_ERROR` (PERMISSION_DENIED "admin scope required") —
  ported verbatim from config's authz. Existing `first`/`userIdFrom`/`HEADER_USER_ID` unchanged.
- TDD paired with Step 5. Files: `services/xstockstrat-identity/src/grpc/authz.ts`.

### Step 4 — service: six admin RPCs in the identity servicer [done]
- `identityServiceImpl.ts`: Role enum↔DB-string maps (`rolesToStrings`/`stringsToRoles`), `toUserView`
  (password-free), a shared `adminGate` (metadata + ADMIN bit, AC-7), and `createUser` (bcrypt.hash(10),
  23505→ALREADY_EXISTS), `listUsers`, `getUser`, `updatePassword` (hash then revoke target's refresh
  tokens, empty body), `setUserRoles`/`setUserActive` (atomic last-admin guard via a conditional UPDATE
  + existence check → FAILED_PRECONDITION "cannot remove last admin"; deactivate also revokes tokens).
  No audit calls here (Step 6).
- TDD (P-06): red 15/48 fail against pre-Step-3/4 dist (methods absent) → green 48/48 after. Real gate
  = compiled-dist run (configured strip-types runner is vacuous — see Deviation Log). lint 0 errors.
- Files: `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts`.

### Step 5 — test: identity admin-RPC unit tests (gate + servicer) [done]
- Added a route-by-SQL capturing pool + `adminCall`/`nonAdminCall` and cases for AC-7 (6 methods denied,
  no query), AC-1/AC-10 (password-free views), AC-2 (bcrypt hash param, ALREADY_EXISTS), AC-3 (password
  update then revoke, in order; empty body), AC-4 (Role enum→string mapping), AC-5/AC-6 (deactivate
  revokes / reactivate doesn't), AC-11 (last-admin FAILED_PRECONDITION for both setUserActive/setUserRoles).
  Inline literals single-consumer (C-13). Files:
  `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts`.

### Step 6 — service: identity → ledger audit client [done]
- Created `src/grpc/ledgerAudit.ts`: `createLedgerAudit()` builds a grpc-js `LedgerServiceClient`
  (insecure, `LEDGER_ENDPOINT`), `append()` forwards x-user-id/x-access-scope/x-trace-id (C-03),
  sets `source_service='xstockstrat-identity'`, `stream_key='user:<id>'`, `correlation_id=trace`,
  payload = the explicit safe allow-list (never the request), and is best-effort (swallows errors).
  **Addressed impl-review ⚠**: `idempotency_key` is `${eventType}:${targetUserId}:${traceId}` when a
  trace id is present (stable → dedups retries), else empty (fire-once) — NOT `Date.now()`.
- `identityServiceImpl.ts`: optional 3rd constructor arg (`audit`, default NOOP); a resilient
  `auditSafe` wrapper; emits `identity.user.{created,password_updated,roles_updated,activated,
  deactivated}` after each successful mutation with a secret-free payload (`updatePassword` UPDATE
  gained `RETURNING email`). `index.ts` constructs + injects the real client.
- TDD paired with Step 7. Files: `ledgerAudit.ts`, `identityServiceImpl.ts`, `index.ts`.

### Step 7 — test: identity audit-event unit test [done]
- Added audit cases: each mutation emits its event once with `acting_admin_user_id` (from x-user-id) +
  `target_user_id` and NO password/newPassword/passwordHash key (AC-8/AC-10); reads emit nothing;
  best-effort proven — a throwing audit sink still returns mutation success (design R5). Also updated
  the Step-5 updatePassword mock to return `rows:[{email}]` (Step 6 added `RETURNING email`).
- TDD (P-06): red 3 audit tests fail with the Step-6 wiring stashed → green 52/52 after. Files:
  `identityServiceImpl.test.ts`.

### Step 8 — service: register six IdentityService RPCs on config-ui BFF [done]
- `configUiBff.ts`: imported `IdentityService` + reused `identityClient` (`connectClients.ts:35`,
  already present for auth). Added `router.service(IdentityService, {...})`: `listUsers`/`getUser`/
  `setUserRoles`/`setUserActive` via `forwardAdmin` (admin-gate + header propagation for free);
  `createUser`/`updatePassword` as explicit admin-gated bodies (`requireSession`+`requireAdminScope`+
  `backendHeaders`) so the write-only password is forwarded but never injected/echoed (AC-10). Only
  these six are registered — connect-node leaves the rest of IdentityService unimplemented, so
  config-ui exposes user management only. No new propagation code (backendHeaders reused). TDD:
  covered by Step 10 e2e (BFF RPC round-trips). Files: `services/xstockstrat-ui/src/lib/configUiBff.ts`.

### Step 9 — service: config-ui Users section (page, nav, browser client, Role map) [done]
- Created `src/lib/browserClients/configUiIdentityClient.ts` (`makeBrowserTransport('/config-ui/api')`
  + `createClient(IdentityService, …)` — per-segment, refresh-guarded transport).
- Created `src/lib/roleLabels.ts`: exhaustive `Record<Role,string> ROLE_LABELS` (+ `ASSIGNABLE_ROLES`,
  `rolesLabel()`) so a new proto Role fails `tsc` here (C-10(a/d), mirrors opportunityShared.tsx).
- Created `src/app/config-ui/users/page.tsx` ('use client'): React-Query `listUsers`, `DataTable`
  (email / roles via `rolesLabel` / status Badge / created via `timestampDate`), Create + Reset-password
  + Edit-roles `FormDialog`s, Deactivate/Reactivate via `DropdownMenu`; last-admin `FAILED_PRECONDITION`
  surfaced via `CardNotice` (AC-11, `ConnectError.rawMessage`), never swallowed. Password fields
  write-only (AC-10). C-17 tokens/state primitives; every row action button has a unique accessible
  name (`Actions for <email>`).
- Nav: added `{ label: 'Users', href: '/config-ui/users', adminOnly: true }` to the Settings group in
  `navGroups.tsx` (single source of truth). **Deviation (honored impl-review fix):** the spec's
  instruction 5 (also add to `PLATFORM_SUBNAV.config`) was DROPPED — `PLATFORM_SUBNAV` is dead code
  (feature 083 renders the Section nav from `NAV_GROUPS`); editing it would add an unreachable link.
  `PlatformHeader.tsx` untouched. See implementation-spec.md § Deviation Log.
- TDD: N/A (frontend page — behavior gated by Step 10 e2e). Lint + tsc build clean.

### Step 10 — test: config-ui Users e2e [done]
- Extended `e2e/fixtures/users.ts` with `USER_VIEW_*` (primary [Admin,Trader] active / trader /
  inactive-viewer / last-admin) + `USER_VIEWS` + `LAST_ADMIN_USER_ID`; catalog row in `INVENTORY.md`
  (C-12, reuses `TEST_USER_ID`/`TEST_USER_EMAIL`). `mock-backend.ts`: six `identityHandlers` methods
  (registered on all three mock ports; config-ui BFF dials 9091) — list/get return password-free
  `User` views, setUserRoles/setUserActive throw `FAILED_PRECONDITION 'cannot remove last admin'` for
  `LAST_ADMIN_USER_ID`.
- `e2e/config-ui/users.spec.ts`: AC-1/AC-10 (rows render email/roles/status, no `password_hash`/`$2b$`),
  AC-9 (Section-landmark nav walk to /config-ui/users), AC-11 (last-admin guard message + row kept),
  AC-8 (create round-trips through BFF, no error). AC-9 targets
  `getByRole('navigation',{name:'Section'})` to avoid the hidden mobile-offcanvas copy; AC-1 scopes
  'Inactive' to the status Badge and gives the first row `{timeout:30000}` for BFF cold-compile.
- TDD (P-06): implemented spec+page first (red — page 404/empty), then wired; final **5/5 passed
  (1.2m)** with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=…/chromium-1194/chrome-linux/chrome
  --timeout=120000 --workers=1`. CI runs the authoritative e2e. Files: `users.spec.ts`,
  `mock-backend.ts`, `fixtures/users.ts`, `fixtures/INVENTORY.md`.

### Feature close-out [code-completed]
- All 10 steps done. status.md → `code-completed`. Steps 8–10 committed; branch pushed; integration
  PR opened against `main-dev`. Features 128 (#1052) and 021 (#1053) already merged to main-dev.
- C-16 acceptance-scenario promotion into the durable identity + config-ui business-rule suites is
  deferred to `/promote` at launch (documented backstop), not done here.
