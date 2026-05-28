# Product Spec: user-management-ui

**Created**: 2026-05-28

---

## Problem Statement

Platform administrators have no UI to manage user accounts. Users are currently seeded only via a one-time SQL migration (`002_seed_admin.up.sql`). There is no way to create new users, change passwords, assign roles, or deactivate accounts without direct database access.

## User Story

As a platform administrator, I want a user management UI, so that I can create users, update passwords, assign roles, and deactivate accounts without touching the database.

## Functional Requirements

FR-1. Admin can list all users (email, roles, active status, created date).
FR-2. Admin can create a new user with email, initial password, and one or more roles.
FR-3. Admin can update any user's password (admin-initiated reset, no current-password required).
FR-4. Admin can update any user's roles (add or remove from the roles array).
FR-5. Admin can deactivate (soft-delete via `is_active = false`) a user, preventing login.
FR-6. Admin can reactivate a previously deactivated user.
FR-7. All user management actions require the caller to hold the `admin` role (enforced server-side).
FR-8. All user management actions are written to the ledger as audit events.
FR-9. The UI is accessible from a new "Users" section within `xstockstrat-config-ui`.
FR-10. Password values are never returned or displayed in any API response or UI field.

## Out of Scope

- Self-service password change by non-admin users (covered by FR-3 only for admins).
- Fine-grained permission scoping beyond role strings (roles remain `TEXT[]`).
- User profile fields beyond email, password, and roles.
- Multi-factor authentication.
- User deletion (hard delete) — deactivation only, to preserve ledger foreign key references.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-identity` — new admin RPCs: `CreateUser`, `ListUsers`, `GetUser`, `UpdatePassword`, `SetUserRoles`, `SetUserActive`
- `xstockstrat-config-ui` — new "Users" admin section with list, create, and edit pages
- `packages/proto` — new RPC definitions and request/response messages in the identity proto

## Proto Contract Changes

New RPCs to add to `packages/proto/identity/v1/identity.proto`:
- `CreateUser(CreateUserRequest) → CreateUserResponse`
- `ListUsers(ListUsersRequest) → ListUsersResponse`
- `GetUser(GetUserRequest) → GetUserResponse`
- `UpdatePassword(UpdatePasswordRequest) → UpdatePasswordResponse`
- `SetUserRoles(SetUserRolesRequest) → SetUserRolesResponse`
- `SetUserActive(SetUserActiveRequest) → SetUserActiveResponse`

New messages: `User` (view model — no password field), `CreateUserRequest`, `ListUsersRequest/Response`, `GetUserRequest/Response`, `UpdatePasswordRequest/Response`, `SetUserRolesRequest/Response`, `SetUserActiveRequest/Response`.

These are additive-only changes — no existing fields removed or renumbered.

## Config Key Changes

- [ ] No new config keys

## Database Changes

- [ ] No schema changes — `identity.users` already has `email`, `password_hash`, `roles TEXT[]`, `is_active`, `created_at`, `updated_at`.

## Feature Workflow Notes

Branch to create: `feature/user-management-ui` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — all proto changes are additive
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. Admin can log in to `xstockstrat-config-ui` and navigate to a "Users" section.
2. The Users page lists all users with email, roles, active status, and created date.
3. Admin can create a new user; the user can then log in with the supplied credentials.
4. Admin can change a user's password; the old password no longer works after the change.
5. Admin can add or remove roles; the change is reflected immediately on next login/token refresh.
6. Admin can deactivate a user; subsequent login attempts with that account return an auth error.
7. Admin can reactivate a deactivated user; login succeeds again.
8. No password hash or plaintext appears in any API response, log line, or UI field.
9. All actions produce ledger events visible in the audit log.
10. All admin RPCs reject calls from non-admin JWT holders with a permission denied error.

## Open Questions

- [ ] Which roles are valid? Currently the seed admin uses `admin` and the default is `trader` — should a closed enum be enforced, or remain open strings?
- [ ] Should the "Users" section be accessible only to `admin`-role users at the UI middleware level (Next.js route guard) in addition to server-side enforcement?
- [ ] Should `UpdatePassword` also invalidate all existing refresh tokens for that user?
