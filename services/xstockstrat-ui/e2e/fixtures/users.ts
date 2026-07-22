/**
 * Canonical test-user identity. Every mocked JWT, identity claim, and
 * author/owner field in the test-data inventory refers to this user.
 *
 * Shape source: JWT claims minted by xstockstrat-identity (user_id / email / roles).
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */

export const TEST_USER_ID = 'test-user-001';
export const TEST_USER_EMAIL = 'test@example.com';
