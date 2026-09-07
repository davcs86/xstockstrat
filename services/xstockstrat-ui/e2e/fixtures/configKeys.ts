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
    // feature 147: the `secret.*` name prefix is retired — secret-ness is the is_secret flag
    // alone. This is a real encrypted vendor-credential row; the value is redacted to '[secret]'
    // at every read edge and only ciphertext is stored.
    key: 'marketdata.alpaca.api_key',
    description: 'Alpaca API key (encrypted at rest)',
    defaultValue: '[secret]',
    isSecret: true,
    consumingService: 'xstockstrat-marketdata',
    environment: 1,
  },
  {
    // feature 161: the FLOAT_MAP `analysis.signals.source_weights` key was removed; the config-ui
    // validation surface is now the scalar decay key. valueType 2 == VALUE_TYPE_FLOAT_SCALAR.
    key: 'analysis.scoring.signal_decay_half_life_hours',
    description: 'Exponential age-decay half-life in hours; 0 disables. Bounds [0, 8760].',
    defaultValue: '24.0',
    isSecret: false,
    consumingService: 'xstockstrat-analysis',
    environment: 1,
    tradingMode: 0,
    validation: { valueType: 2, minValue: 0.0, maxValue: 8760 },
  },
  {
    // feature 184: opportunity-queue keys seeded (migration 028) + write-bounded. A bounded INT key —
    // the ListKeys hint emits VALUE_TYPE_FLOAT_SCALAR (2) for every bounded key regardless of int/float
    // (configServiceImpl.ts:529), so valueType is 2, same as the float row. 0 (midnight) is a legitimate
    // lower edge (min inclusive).
    key: 'analysis.opportunity.refresh_hour_utc',
    description:
      'Hour (UTC) of the daily opportunity refresh pass. 0 = midnight is legitimate. Bounds [0, 23].',
    defaultValue: '0',
    isSecret: false,
    consumingService: 'xstockstrat-analysis',
    environment: 1,
    tradingMode: 0,
    validation: { valueType: 2, minValue: 0, maxValue: 23 },
  },
  {
    // feature 184: a bounded FLOAT key. 0 reads as the 0.3 default (get_float zero-trap) — read-path fix
    // routed to feature 185; the bound still admits 0 as a valid operator write within [0, 1].
    key: 'analysis.opportunity.signal_rank_weight',
    description:
      'Weight of the signal axis in the queue ORDER BY. Bounds [0, 1]. 0 reads as the 0.3 default (get_float).',
    defaultValue: '0.3',
    isSecret: false,
    consumingService: 'xstockstrat-analysis',
    environment: 1,
    tradingMode: 0,
    validation: { valueType: 2, minValue: 0, maxValue: 1 },
  },
  {
    // feature 184: a seeded-but-UNBOUNDED opportunity key — proves a registered key with no documented
    // failure mode surfaces in config-ui with no validation hint (no validation field).
    key: 'analysis.opportunity.snooze_default_hours',
    description:
      'Default bounded "snooze until" when a SNOOZE carries no explicit timestamp. Seeded unbounded.',
    defaultValue: '24',
    isSecret: false,
    consumingService: 'xstockstrat-analysis',
    environment: 1,
    tradingMode: 0,
  },
];
