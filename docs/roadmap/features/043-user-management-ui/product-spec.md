# Product Spec: user-management-ui

**Created**: 2026-05-28

---

## Problem Statement

Platform administrators have no UI to manage user accounts. Users are currently seeded only via a
one-time SQL migration (`002_seed_admin.up.sql`). There is no way to create new users, change
passwords, assign roles, or deactivate accounts without direct database access.

## User Story

As a platform administrator, I want a user management UI, so that I can create users, update
passwords, assign roles, and deactivate accounts without touching the database.

## Functional Requirements

FR-1. Admin can list all users (email, roles, active status, created date).
FR-2. Admin can create a new user with email, initial password, and one or more roles.
FR-3. Admin can update any user's password (admin-initiated reset, no current-password required).
FR-4. Admin can update any user's roles (add or remove from the roles array).
FR-5. Admin can deactivate (soft-delete via `is_active = false`) a user, preventing login.
FR-6. Admin can reactivate a previously deactivated user.
FR-7. All user management actions require the caller to hold the `admin` role (enforced server-side).
FR-8. All user management actions are written to the ledger as audit events.
FR-9. The UI is accessible from a new "Users" section within the `xstockstrat-ui` `/config-ui` segment.
FR-10. Password values are never returned or displayed in any API response or UI field.
FR-11. **Last-admin lockout guard.** `SetUserActive(active=false)` and `SetUserRoles` MUST refuse to
  deactivate or strip the `admin` role from the **final active admin** (including the seeded
  `admin@localhost`), returning a clear error (gRPC `FAILED_PRECONDITION`, "cannot remove last admin").
  The refusal is enforced server-side in `xstockstrat-identity`, checked against the live set of
  currently-active `admin` users — never a UI-only guard.

## Out of Scope

- Self-service password change by non-admin users (covered by FR-3 only for admins).
- Fine-grained permission scoping beyond role strings (roles remain `TEXT[]`).
- User profile fields beyond email, password, and roles.
- Multi-factor authentication.
- User deletion (hard delete) — deactivation only, to preserve ledger foreign key references.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-identity` — new admin RPCs: `CreateUser`, `ListUsers`, `GetUser`, `UpdatePassword`,
  `SetUserRoles`, `SetUserActive`; admin-role authorization on each; ledger audit event per action
  (**new plumbing** — identity has no ledger-write client today, see Design Guardrails); last-admin
  lockout guard on `SetUserActive`/`SetUserRoles` (FR-11).
- `xstockstrat-ui` — new "Users" admin section under the `/config-ui` segment (list, create, and edit
  surfaces) plus the BFF routes that call the identity RPCs over gRPC.
- `packages/proto` — new RPC definitions and request/response messages in the identity proto.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui`: a new "Users" section in the `/config-ui` segment (list all users,
  create user, reset password, assign/remove roles, deactivate/reactivate). This is the end-user
  surface; without it the new identity RPCs are unreachable by an operator.
- [ ] **Agent** — no MCP tool change.
- [ ] **None** — n/a.

## Proto Contract Changes

- [ ] No proto changes required
- **Additive (`packages/proto/identity/v1/identity.proto`)**:
  - `rpc CreateUser(CreateUserRequest) returns (CreateUserResponse)`
  - `rpc ListUsers(ListUsersRequest) returns (ListUsersResponse)`
  - `rpc GetUser(GetUserRequest) returns (GetUserResponse)`
  - `rpc UpdatePassword(UpdatePasswordRequest) returns (UpdatePasswordResponse)`
  - `rpc SetUserRoles(SetUserRolesRequest) returns (SetUserRolesResponse)`
  - `rpc SetUserActive(SetUserActiveRequest) returns (SetUserActiveResponse)`
  - New messages: `User` (view model — **no** password/hash field), `CreateUserRequest`,
    `CreateUserResponse`, `ListUsersRequest`, `ListUsersResponse`, `GetUserRequest`, `GetUserResponse`,
    `UpdatePasswordRequest`, `UpdatePasswordResponse`, `SetUserRolesRequest`, `SetUserRolesResponse`,
    `SetUserActiveRequest`, `SetUserActiveResponse`.
  - No existing message, field, or enum is removed or renumbered → **non-breaking** (`buf breaking`
    must pass). Field numbers start fresh per new message.

## Config Key Changes

- [ ] No new config keys

## Database Changes

- [ ] No schema changes — `identity.users` already has `email`, `password_hash`, `roles TEXT[]`,
  `is_active`, `created_at`, `updated_at`. No migration required.

## Feature Workflow Notes

Branch to create: `feature/user-management-ui` (branch from `main-dev`).

Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — additive (non-breaking) proto change; all identity RPCs are additive
- [ ] 2 service owners + platform lead — n/a (no breaking proto change)
- [ ] DBA review + service owner — n/a (no schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

None — moved to Design-Phase Decisions / Design Guardrails below.

## Design Guardrails

Known traps and new plumbing to honor at design/implementation — not open decisions, but constraints
the design must satisfy:

- **Server-side authz at every RPC write path (ledger 2026-08-06 `unify-admin-auth-gates` / C-10(c),
  115-fix-config-ui-env).** Enforce the admin check at every identity **RPC write path** via the
  trusted `x-access-scope` admin bit — a UI-only guard leaves each mutation reachable by direct
  gRPC/BFF call, and every mutating RPC must sit inside the authz gate (no new verb falling through
  the switch as non-mutating).
- **gRPC-only identity plumbing (ledger 2026-08-05 `formula-management-ui`).** Backends are
  **gRPC-only**; do not assume any HTTP-header identity mechanism or HTTP transport — the UI reaches
  identity over gRPC and forwards `x-user-id`/`x-access-scope`/`x-trace-id`, so verify authz plumbing
  against that model.
- **Shared-nav reachability (ledger 2026-07-01 `060-screener-engine` / C-10(a)).** A new UI
  section/route must be registered in the shared nav (`PLATFORM_SUBNAV`) with a nav-reachability test,
  or the Users page ships unreachable from the sidebar.
- **Identity→ledger audit is NEW plumbing, not a reuse.** FR-8/AC-8 require a ledger audit event per
  mutating action, but `xstockstrat-identity` has **no ledger-write client today** — the fictional
  `xstockstrat-ledger` dep and `LEDGER_ENDPOINT` were removed from identity, and its auth events are
  currently only `log.info` lines (see `services/xstockstrat-identity/docs/context-constitution-findings.md`).
  This audit client (gRPC client, `LEDGER_ENDPOINT` wiring, `AppendEvent` calls, redaction so no
  password/hash reaches the ledger) is **new plumbing to build and verify at design**, not an existing
  capability to reuse. Treat the ledger-write path as a first-class implementation step, not a
  one-line addition.

## Design-Phase Decisions (owned by /sdd-design)

Genuine design forks to resolve in `/sdd-design`:

- **Roles: closed enum vs. open `TEXT[]` strings.** The seed admin uses `admin` and the default is
  `trader` — enforce a closed enum, or keep open role strings? (Out of Scope already fixes storage as
  `TEXT[]`; this decides validation/typing at the RPC boundary.)
- **UI middleware admin route-guard (defense in depth).** Should the "Users" section be route-guarded
  to `admin` at the Next.js middleware level **in addition to** the server-side RPC enforcement, as
  defense in depth?
- **Refresh-token invalidation on mutate.** Should `UpdatePassword` (and `SetUserActive` deactivate)
  also invalidate the user's existing refresh tokens?
