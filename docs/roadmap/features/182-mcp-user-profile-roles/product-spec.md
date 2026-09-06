# Product Spec: mcp-user-profile-roles

**Created**: 2026-09-06

---

## Problem Statement

Platform administrators can manage users and roles today only through the identity service's gRPC
RPCs directly or the `scripts/manage-users.sh` shell helper — there is no way to do it through the
MCP agent, where an administrator otherwise operates the platform. This feature exposes user
administration (create, list, inspect, set roles, activate/deactivate, reset password) and admin
view/edit of any user's profile metadata as MCP agent tools, all gated on the ADMIN access scope.

## User Story

As a platform administrator using the MCP agent, I want tools to create, list, inspect, role-manage,
activate/deactivate, and password-reset users, and to view and edit any user's profile metadata, so
that I can administer users, roles, and profiles from the agent without dropping to shell scripts or
raw gRPC.

## Functional Requirements

FR-1. A `manage_user` tool with operation `create` provisions a new user (email + initial password +
initial roles) via identity `CreateUser`, returning the created user's `user_id`, `email`, `roles`,
and `is_active`.

FR-2. `manage_user` operation `set_roles` replaces a target user's roles with a supplied role set
(subset of the closed enum `admin`/`trader`/`viewer`) via identity `SetUserRoles`, returning the
updated user.

FR-3. `manage_user` operation `set_active` activates or deactivates a target user via identity
`SetUserActive`, returning the updated user's `is_active`.

FR-4. `manage_user` operation `reset_password` sets a target user's password via identity
`UpdatePassword`, returning success without echoing the password.

FR-5. A `list_users` reader returns all users (`user_id`, `email`, `roles`, `is_active`,
`created_at`) via identity `ListUsers`.

FR-6. A `get_user` reader returns one user by `user_id` via identity `GetUser`.

FR-7. An administrator can read **any** user's profile metadata (`email`, `phone`, `display_name`,
`metadata`, `metadata_updated_at`) by target `user_id`, via a **new** admin identity RPC.

FR-8. An administrator can update **any** user's profile metadata (partial update of `phone`,
`display_name`, `metadata`) by target `user_id`, via a **new** admin identity RPC.

FR-9. Every tool and operation in FR-1..FR-8 is gated on the ADMIN access scope (`x-access-scope`
bit `0x04`): a non-admin caller receives `PERMISSION_DENIED` and no state changes.

FR-10. The identity RPCs backing FR-7/FR-8 accept a **target** `user_id` in the request body (not
derived from `x-user-id`) and enforce ADMIN gating server-side, mirroring the existing
`adminGate()` used by the feature-043 admin RPCs.

## Out of Scope

- Self-service profile tools `get_user_metadata` / `set_user_metadata` — already shipped (feature
  130); their existing self-only behavior (keyed off `x-user-id`) is unchanged.
- Any UI surface (config-ui or otherwise) for user administration.
- New role values or a permissions/scopes model — the role set stays the closed enum
  `admin`/`trader`/`viewer`.
- Deleting users (no `DeleteUser` RPC exists; deactivate via FR-3 is the lifecycle terminal state).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `packages/proto` — new admin cross-user profile RPCs + request/response messages (FR-7/FR-8/FR-10).
- `xstockstrat-identity` — implement the new admin metadata RPCs, ADMIN-gated; reuse existing
  metadata columns on `identity.users` (no migration).
- `xstockstrat-agent` — new MCP tools `manage_user`, `list_users`, `get_user`, and the admin
  cross-user profile read/write surface; new `app/client.py` helpers; tool-count + docs sync.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — no UI surface.
- [x] **Agent** — `xstockstrat-agent` MCP tools: **new** `manage_user` (op enum
  create/set_roles/set_active/reset_password), `list_users`, `get_user`, plus an admin cross-user
  profile read/write surface (exact tool shape — new dedicated tools vs. an admin `target_user_id`
  arg on the existing `get_user_metadata`/`set_user_metadata` — is an OPEN QUESTION for `/sdd-design`).
- [ ] **None**.

## Proto Contract Changes

- [x] Proto changes required — **additive / non-breaking**:
  - New RPCs on `IdentityService` for admin cross-user profile access (e.g. `AdminGetUserMetadata`,
    `AdminUpdateUserMetadata` — final names decided in `/sdd-design`).
  - New request/response messages taking a target `user_id` (reuse existing `UserMetadata` for the
    response where possible).
  - The feature-043 admin RPCs (`CreateUser`, `ListUsers`, `GetUser`, `SetUserRoles`,
    `SetUserActive`, `UpdatePassword`) and their messages already exist — **no proto change** for
    FR-1..FR-6.

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No schema changes — the `phone` / `display_name` / `metadata` / `metadata_updated_at` columns
  added by migration `006_user_metadata` already back the admin profile RPCs.

## Feature Workflow Notes

Branch to create: `feature/mcp-user-profile-roles` (branch from `main-dev`).
Approval gates required (per docs/runbooks/feature-workflow.md + approval-flow.md):
- [x] 1 service owner approval + Proto Reviewer (non-breaking/additive proto change)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, additions are non-breaking
- [ ] DBA review + service owner (schema migration) — N/A, no migration
- [x] Security review (identity auth-scope + admin-gated user administration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **OQ-1 (tool shape for admin profile).** Should admin cross-user profile read/write be *new*
  dedicated tools, or an optional admin `target_user_id` argument on the existing
  `get_user_metadata`/`set_user_metadata` tools? The latter is DRYer but changes two shipped tool
  contracts and mixes self-service + admin authz in one tool. Decide in `/sdd-design`.
- [ ] **OQ-2 (create-user password handling).** `manage_user create` and `reset_password` take a
  plaintext password argument. Confirm the agent tool never echoes it back and that it is not logged
  (identity hashes server-side). Should initial-password be optional with a generated value returned
  once instead?
- [ ] **Known trap (ledger F-12 / RC-1, fails.md:308-310).** Adding agent tools drifts the six MCP
  inventory surfaces (tool docstrings, `docs/runbooks/mcp-tools.md`, the `strat-lab` skill/plugin,
  the tool-count statements, `app/client.py` request builders, and any parity test). All must be
  updated in the **same** PR, and the new request/response projections pinned by a parity/contract
  test (mirror `tests/test_backtest_view.py`).
- [ ] **Known trap (ledger, fails.md:532 & 546-549).** Admin `x-access-scope` must be forwarded only
  from verified OAuth claims via the established caller-propagation path — never from a tool
  parameter or a pre-auth signed blob. Target `user_id` is a request *selector*, never the identity.
- [ ] **Known trap (ledger, fails.md:667-669 & 537-539).** identity is TS: new proto request fields
  must be read via ts-proto camelCase (or `?? both`) and proven with a wire-level loopback test, and
  any row→proto mapper for `UserMetadata` updated in lockstep with the new RPCs.
