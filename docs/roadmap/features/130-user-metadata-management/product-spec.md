# Product Spec: user-metadata-management

**Created**: 2026-08-14

---

## Problem Statement

The platform's `users` table stores only authentication-related fields (username, password hash, access scope). There is no way for an admin to record or view their own contact details (email, phone, display name), and no API or UI surface to manage this metadata. Notifications, audit trails, and future multi-user features all need richer user profiles.

## User Story

As an admin user, I want to view and update my own profile metadata (email, phone number, display name), so that the platform can identify me and my contact details are available for notifications and audit trails.

## Functional Requirements

FR-1. Add metadata columns to the `users` table: `email` (text, nullable), `phone` (text, nullable), `display_name` (text, nullable), `metadata` (JSONB, default `{}`), `metadata_updated_at` (timestamptz, nullable).
FR-2. Add `GetUserMetadata` and `UpdateUserMetadata` gRPC RPCs to the identity service proto contract.
FR-3. `GetUserMetadata` returns the caller's own metadata (user_id derived from `x-user-id` header). `user_id` is included in the response as a read-only field.
FR-4. `UpdateUserMetadata` accepts a partial update (only provided fields are set) and enforces self-only access: the caller can only update the user matching their `x-user-id` header.
FR-5. Implement the identity service handlers for both RPCs, reading/writing the new columns.
FR-6. Add an `/accounts/profile` page in `xstockstrat-ui` that displays the current user's metadata (including user_id as read-only) and allows editing phone and display_name. _(Design deviation: moved from `/config-ui/profile` to `/accounts/profile` — `/accounts` already owns identity-adjacent surfaces using plain REST routes; email is read-only per design, not editable.)_
FR-7. Register the profile page in `PLATFORM_SUBNAV` so it is reachable from the shared nav (C-10(a)).
FR-8. Add `get_user_metadata` and `set_user_metadata` MCP tools to `xstockstrat-agent`.
FR-9. `get_user_metadata` returns the caller's metadata (including read-only user_id and email). `set_user_metadata` accepts partial updates for phone, display_name, and the JSONB metadata field. _(Design deviation: email excluded from `set_user_metadata` — read-only credential; editing requires a dedicated ChangeEmail RPC with password confirmation.)_
FR-10. Both MCP tools enforce self-only access via the forwarded `x-user-id` header — no target_user_id parameter in this phase.

## Out of Scope

- Managing other users' metadata (admin-over-others) — deferred to a future phase.
- Email/phone verification workflows.
- Profile picture / avatar upload.
- Using metadata for notification delivery routing (notify service integration) — future feature.
- Exposing metadata in the trader or insights UI segments.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-identity` — new DB columns, new gRPC RPCs (GetUserMetadata, UpdateUserMetadata)
- `xstockstrat-ui` — new `/accounts/profile` page, REST API route, NAV_GROUPS + PLATFORM_SUBNAV registration
- `xstockstrat-agent` — new MCP tools (get_user_metadata, set_user_metadata)
- `packages/proto` — new proto messages and RPCs in identity.proto

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.

- [x] **UI** — `xstockstrat-ui` segment(s): `/accounts` (new `/accounts/profile` page showing user metadata with edit form; user_id and email displayed as read-only)
- [x] **Agent** — `xstockstrat-agent` MCP tool(s): `get_user_metadata` (read own profile), `set_user_metadata` (update own profile fields)
- [ ] **None** — internal/platform-only, no end-user surface.

## Proto Contract Changes

- New messages: `GetUserMetadataRequest`, `GetUserMetadataResponse`, `UpdateUserMetadataRequest`, `UpdateUserMetadataResponse`
- New RPCs on `IdentityService`: `GetUserMetadata`, `UpdateUserMetadata`
- New message: `UserMetadata` (user_id, email, phone, display_name, metadata as google.protobuf.Struct, updated_at as google.protobuf.Timestamp)

## Config Key Changes

- [ ] No new config keys

## Database Changes

- New migration `006_user_metadata.up.sql` / `006_user_metadata.down.sql` in `services/xstockstrat-identity/migrations/`
- Adds columns to existing `users` table: `email`, `phone`, `display_name`, `metadata` (JSONB), `metadata_updated_at`

## Feature Workflow Notes

Branch to create: `feature/user-metadata-management` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

1. `users` table has `email`, `phone`, `display_name`, `metadata` (JSONB), and `metadata_updated_at` columns after migration 006 runs.
2. `GetUserMetadata` RPC returns the caller's own metadata with `user_id` as a read-only field; returns NOT_FOUND if user doesn't exist.
3. `UpdateUserMetadata` RPC updates only the caller's own record; rejects attempts to update a different user with PERMISSION_DENIED.
4. `/accounts/profile` page renders the current user's metadata, displays user_id and email as non-editable, and allows saving changes to phone and display_name.
5. Profile page is reachable from the accounts navigation (NAV_GROUPS Settings + PLATFORM_SUBNAV accounts).
6. `get_user_metadata` MCP tool returns the caller's profile including user_id.
7. `set_user_metadata` MCP tool updates the caller's profile fields and returns the updated metadata.
8. No user can read or modify another user's metadata through any surface (UI, agent, gRPC).

## Open Questions

- [ ] Should email have a uniqueness constraint? (Probably not in this phase — no verification, and multi-user is out of scope. But worth confirming before migration ships.)
- [ ] Known trap (ledger): Proto field access in TS uses camelCase (fails.md: fix-mcp-config-key-registry) — ensure the UI BFF reads proto fields via camelCase, not snake_case.
- [ ] Known trap (ledger): Migration numbering collision — verify `006` is still free at execute time by checking the actual migrations directory, not this spec (fails.md: multiple entries on concurrent NNN collision).
