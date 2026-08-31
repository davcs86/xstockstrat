/**
 * Canonical test-user identity. Every mocked JWT, identity claim, and
 * author/owner field in the test-data inventory refers to this user.
 *
 * Shape source: JWT claims minted by xstockstrat-identity (user_id / email / roles).
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */

export const TEST_USER_ID = 'test-user-001';
export const TEST_USER_EMAIL = 'test@example.com';

/**
 * A second, distinct test identity (feature 133). Used by cross-user strategy-ownership tests
 * to prove that user B can neither see nor mutate a strategy owned by user A — the composite
 * `(user_id, strategy_id)` PK means both users may hold the same `strategy_id` without collision.
 */
export const TEST_USER_B_ID = 'test-user-002';
export const TEST_USER_B_EMAIL = 'test-b@example.com';

// ── User-view fixtures (feature 043 — user-management admin section) ─────────
// Shape source: xstockstrat.identity.v1.User (Connect-JSON camelCase, password-free). Consumed by
// the mock IdentityService admin handlers and the config-ui Users e2e.
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { Role } from '@xstockstrat/proto/identity/v1/identity_pb';

// The mock returns FAILED_PRECONDITION for a deactivate/demote of this user (last-admin guard, AC-11).
export const LAST_ADMIN_USER_ID = 'admin-only-001';

const CREATED = timestampFromDate(new Date('2026-01-01T00:00:00Z'));

export const USER_VIEW_PRIMARY = {
  userId: TEST_USER_ID,
  email: TEST_USER_EMAIL,
  roles: [Role.ADMIN, Role.TRADER],
  isActive: true,
  createdAt: CREATED,
};
export const USER_VIEW_TRADER = {
  userId: 'test-user-100',
  email: 'bob@example.com',
  roles: [Role.TRADER],
  isActive: true,
  createdAt: CREATED,
};
export const USER_VIEW_INACTIVE = {
  userId: 'test-user-101',
  email: 'carol@example.com',
  roles: [Role.VIEWER],
  isActive: false,
  createdAt: CREATED,
};
export const USER_VIEW_LAST_ADMIN = {
  userId: LAST_ADMIN_USER_ID,
  email: 'root@example.com',
  roles: [Role.ADMIN],
  isActive: true,
  createdAt: CREATED,
};

export const USER_VIEWS = [
  USER_VIEW_PRIMARY,
  USER_VIEW_TRADER,
  USER_VIEW_INACTIVE,
  USER_VIEW_LAST_ADMIN,
];
