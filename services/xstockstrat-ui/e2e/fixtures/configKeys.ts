/**
 * Canonical SetConfig payload factory for BFF smoke tests (api-smoke.spec.ts).
 *
 * Shape source: `xstockstrat.config.v1.SetConfigRequest`
 * (packages/proto/config/v1/config.proto:88-100).
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */
export function setConfigPayload(overrides: Record<string, unknown> = {}) {
  return {
    namespace: 'platform',
    key: 'platform.log_level',
    value: { value: { case: 'stringVal', value: 'debug' } },
    reason: 'Updated via config-ui',
    environment: 1,
    tradingMode: 0,
    ...overrides,
  };
}
