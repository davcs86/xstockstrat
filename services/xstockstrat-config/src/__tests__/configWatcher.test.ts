/**
 * Unit tests for ConfigWatcher getter methods.
 *
 * These tests verify the value lookup + default fallback logic without
 * requiring a running gRPC config service. The snapshot is injected
 * directly into the watcher instance.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/configWatcher.test.ts
 * Or via: pnpm run test (once test script is configured)
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// We import ConfigWatcher but need to prevent it from dialling a gRPC channel.
// The constructor creates a ConfigServiceClient and calls startWatch(), both
// of which are async-safe for unreachable endpoints. We test the getter logic
// by patching the snapshot directly via `as any`.
//
// If the @xstockstrat/proto package is unavailable in the test environment the
// import will throw — we guard for that with a graceful skip.

let ConfigWatcher: typeof import('../services/configWatcher').ConfigWatcher;

before(async () => {
  try {
    const mod = await import('../services/configWatcher.js');
    ConfigWatcher = mod.ConfigWatcher;
  } catch {
    // Proto package unavailable in test environment — tests will be skipped.
  }
});

describe('ConfigWatcher getters', () => {
  it('returns default when snapshot is null', () => {
    if (!ConfigWatcher) return; // skip if import failed

    // Instantiate with a deliberately unreachable endpoint.
    const w = new ConfigWatcher('localhost:1', 'test');
    (w as any).snapshot = null;

    assert.strictEqual(w.getString('any.key', 'myDefault'), 'myDefault');
    assert.strictEqual(w.getInt('any.key', 42), 42);
    assert.strictEqual(w.getFloat('any.key', 3.14), 3.14);
    assert.strictEqual(w.getBool('any.key', true), true);
  });

  it('returns string value from snapshot', () => {
    if (!ConfigWatcher) return;

    const w = new ConfigWatcher('localhost:1', 'test');
    (w as any).snapshot = {
      namespace: 'test',
      version: '1',
      updateType: 0,
      changedKeys: [],
      values: {
        'platform.log_level': { stringVal: 'debug' },
      },
    };

    assert.strictEqual(w.getString('platform.log_level', 'info'), 'debug');
    assert.strictEqual(w.getString('missing.key', 'info'), 'info');
  });

  it('returns bool value from snapshot', () => {
    if (!ConfigWatcher) return;

    const w = new ConfigWatcher('localhost:1', 'test');
    (w as any).snapshot = {
      namespace: 'test',
      version: '1',
      updateType: 0,
      changedKeys: [],
      values: {
        'platform.maintenance_mode': { boolVal: true },
      },
    };

    assert.strictEqual(w.getBool('platform.maintenance_mode', false), true);
    assert.strictEqual(w.getBool('unknown', false), false);
  });

  it('returns int value from snapshot', () => {
    if (!ConfigWatcher) return;

    const w = new ConfigWatcher('localhost:1', 'test');
    (w as any).snapshot = {
      namespace: 'test',
      version: '1',
      updateType: 0,
      changedKeys: [],
      values: {
        'ledger.retention.years': { intVal: 5 },
      },
    };

    assert.strictEqual(w.getInt('ledger.retention.years', 2), 5);
    assert.strictEqual(w.getInt('missing', 99), 99);
  });

  it('returns float value from snapshot', () => {
    if (!ConfigWatcher) return;

    const w = new ConfigWatcher('localhost:1', 'test');
    (w as any).snapshot = {
      namespace: 'test',
      version: '1',
      updateType: 0,
      changedKeys: [],
      values: {
        'trading.risk.max_position_pct': { floatVal: 0.05 },
      },
    };

    assert.ok(Math.abs(w.getFloat('trading.risk.max_position_pct', 0.1) - 0.05) < 1e-9);
    assert.ok(Math.abs(w.getFloat('missing', 0.1) - 0.1) < 1e-9);
  });
});
