# Durable per-service business rules for xstockstrat-identity, promoted from feature 183's
# acceptance.feature at archive time (Constitution C-16; the launch-time promotion was missed).
# Separate from feature 043's user-management-ui.feature (provenance kept per source feature).
# Source-feature provenance is carried on every scenario's `@feature-183` tag.

Feature: mcp-user-profile-roles (identity)
  The new admin profile-metadata RPCs on xstockstrat-identity enforce admin gating
  server-side, independent of any agent-layer check.

  @AC-10 @FR-10 @feature-183
  Scenario: Admin profile RPCs enforce admin gating at the identity service, not only in the agent
    Given a direct gRPC caller to the new admin metadata RPC whose x-access-scope lacks bit 0x04
    When it calls the admin read or admin update RPC with a target user_id
    Then identity returns PERMISSION_DENIED before touching the users table
