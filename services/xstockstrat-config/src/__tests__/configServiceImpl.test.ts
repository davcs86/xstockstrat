/**
 * Unit tests for ConfigServiceImpl.listKeys validation-field population.
 *
 * The DB pool is mocked with a stub returning controlled rows, so no running
 * TimescaleDB is required. If the @xstockstrat/proto package is unavailable in
 * the test environment the import throws — guarded with a graceful skip.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/configServiceImpl.test.ts
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let ConfigServiceImpl: typeof import('../grpc/configServiceImpl').ConfigServiceImpl;

// The import is deliberately NOT wrapped in try/catch. A previous version swallowed
// the failure and every case early-returned, so the suite reported "pass" while
// asserting nothing (feature 074). A broken stub environment must fail loudly.
before(async () => {
  const mod = await import('../grpc/configServiceImpl.js');
  ConfigServiceImpl = mod.ConfigServiceImpl;
});

describe('test harness', () => {
  it('imports the implementation under test', () => {
    assert.ok(ConfigServiceImpl, 'ConfigServiceImpl must import — never skip silently');
  });
});

describe('ConfigServiceImpl.listKeys — validation field', () => {
  function makePool(rows: Record<string, unknown>[]): any {
    return {
      query: async (_sql: string, _params?: unknown[]) => ({ rows }),
      connect: async () => ({
        query: async () => {},
        on: () => {},
      }),
    };
  }

  it('populates validation for analysis.signals.source_weights', async () => {
    const pool = makePool([
      {
        key: 'analysis.signals.source_weights',
        description: 'Weights',
        default_value: '{}',
        is_secret: false,
        consuming_service: 'xstockstrat-analysis',
        environment: 'dev',
        trading_mode: 'all',
      },
    ]);
    const impl = new ConfigServiceImpl(pool);
    let result: any = null;
    await impl.listKeys(
      { request: { namespace: 'analysis', environment: 1, trading_mode: 1 } },
      (_err: unknown, res: unknown) => {
        result = res;
      },
    );
    assert.ok(result, 'callback was called with a result');
    assert.strictEqual(result.keys.length, 1);
    const k = result.keys[0];
    assert.ok(k.validation, 'validation field must be present');
    // packages/proto/buf.gen.yaml sets stringEnums=true, so ts-proto emits the enum's
    // string constant rather than its wire number.
    assert.strictEqual(k.validation.value_type, 'VALUE_TYPE_FLOAT_MAP');
    assert.ok(Math.abs(k.validation.min_value - 0.0) < 1e-6);
    assert.ok(Math.abs(k.validation.max_value - 1.0) < 1e-6);
  });

  it('omits validation for non-weight keys', async () => {
    const pool = makePool([
      {
        key: 'platform.log_level',
        description: 'Log level',
        default_value: 'info',
        is_secret: false,
        consuming_service: 'all',
        environment: 'dev',
        trading_mode: 'all',
      },
    ]);
    const impl = new ConfigServiceImpl(pool);
    let result: any = null;
    await impl.listKeys(
      { request: { namespace: 'platform', environment: 1, trading_mode: 0 } },
      (_err: unknown, res: unknown) => {
        result = res;
      },
    );
    assert.ok(result);
    const k = result.keys[0];
    assert.strictEqual(k.validation, undefined, 'non-weight key must have no validation');
  });
});
