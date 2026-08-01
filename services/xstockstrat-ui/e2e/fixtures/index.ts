/**
 * Test-data inventory — canonical mocked/dummy domain objects for
 * xstockstrat-ui tests (Playwright e2e and vitest unit).
 *
 * Rules (docs/patterns/test-data-inventory.md):
 *  - One canonical fixture per domain entity; specs and mock-backend.ts import
 *    it instead of re-declaring the literal.
 *  - Field names/values follow the Connect-JSON camelCase proto shape, so a
 *    fixture works both as a gRPC handler response init and a page.route body.
 *  - Every module is catalogued in e2e/fixtures/INVENTORY.md; update the
 *    catalog in the same commit as any fixture change (`/sdd-qa` skill).
 *  - Scenario-specific one-off literals (sentinel ids, error-path payloads)
 *    may stay inline in their spec — list recurring sentinels in INVENTORY.md.
 */

export * from './users';
export * from './accounts';
export * from './portfolios';
export * from './strategies';
export * from './formulas';
export * from './backtests';
export * from './opportunities';
export * from './copilotThread';
