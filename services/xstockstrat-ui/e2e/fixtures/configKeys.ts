/**
 * Canonical SetConfig payload factory for BFF smoke tests (api-smoke.spec.ts).
 *
 * Shape source: `xstockstrat.config.v1.SetConfigRequest`
 * (packages/proto/config/v1/config.proto:88-100).
 *
 * `value` uses the Connect JSON *wire* shape for a oneof — the alternative's own field name
 * as a direct key (`{ stringVal: '...' }`) — not protobuf-es's `{ case, value }` in-memory
 * accessor shape (that shape is only for constructing messages in TS/JS, e.g. `create()` or
 * a `page.route()` mocked handler return value; see `e2e/mock-backend.ts`'s `getConfig()` for
 * that convention). This fixture is POSTed as a raw JSON string (`api-smoke.spec.ts`'s
 * `callBff`), so it goes through `fromJson` wire decoding — `{ case, value }` isn't a
 * recognized `ConfigValue` field name there, decodes as an empty oneof, and the write silently
 * no-ops despite a 200 response — caught by `api-smoke.spec.ts`'s currentValue regression test.
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */
export function setConfigPayload(overrides: Record<string, unknown> = {}) {
  return {
    namespace: 'platform',
    key: 'platform.log_level',
    value: { stringVal: 'debug' },
    reason: 'Updated via config-ui',
    environment: 1,
    tradingMode: 0,
    ...overrides,
  };
}

/**
 * Canonical ListKeys metadata rows the config-ui mock backend serves.
 *
 * Shape source: `xstockstrat.config.v1.ConfigKeyMeta`
 * (packages/proto/config/v1/config.proto:117-127).
 *
 * `defaultValue` is seed metadata only (CONFIG-2: a SetConfig write never touches it).
 * `e2e/mock-backend.ts`'s ConfigService.listKeys() spreads these and computes each row's
 * `currentValue` from its own `configValueOverrides` map (seeded to `defaultValue`, then
 * whatever the mock's SetConfig handler last wrote) — the same defaultValue/value_data split
 * the real xstockstrat-config service's `config.config_values` table has.
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */
export const CONFIG_KEY_FIXTURES = [
  {
    key: 'platform.log_level',
    description: 'Global log level for all services',
    defaultValue: 'info',
    isSecret: false,
    consumingService: 'all',
    environment: 1,
    tradingMode: 0,
  },
  {
    key: 'platform.maintenance_mode',
    description: 'Halts all trading operations when true',
    defaultValue: 'false',
    isSecret: false,
    consumingService: 'all',
    environment: 1,
    tradingMode: 0,
  },
  {
    key: 'platform.trading_state',
    description: 'Richer halt state: ACTIVE | REDUCE_ONLY | HALTED',
    defaultValue: 'ACTIVE',
    isSecret: false,
    consumingService: 'xstockstrat-trading',
    environment: 1,
    tradingMode: 1,
  },
  {
    key: 'secret.alpaca_api_key',
    description: 'Alpaca API key for live trading',
    defaultValue: '[secret]',
    isSecret: true,
    consumingService: 'trading',
    environment: 2,
    tradingMode: 2,
  },
  {
    key: 'analysis.signals.source_weights',
    description: 'JSON weight map for signal sources',
    defaultValue: '{}',
    isSecret: false,
    consumingService: 'xstockstrat-analysis',
    environment: 1,
    tradingMode: 0,
    validation: { valueType: 1, minValue: 0.0, maxValue: 1.0 },
  },
];
