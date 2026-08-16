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
