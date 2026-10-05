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
import { EventEmitter } from 'node:events';

// We import ConfigWatcher but need to prevent it from dialling a gRPC channel.
// The constructor creates a ConfigServiceClient and calls startWatch(), both
// of which are async-safe for unreachable endpoints. We test the getter logic
// by patching the snapshot directly via `as any`.
//
// If the @xstockstrat/proto package is unavailable in the test environment the
// import will throw — we guard for that with a graceful skip.

let ConfigWatcher: typeof import('../services/configWatcher').ConfigWatcher;

before(async () => {
  const mod = await import('../services/configWatcher.js');
  ConfigWatcher = mod.ConfigWatcher;
});

// The constructor dials a real gRPC channel and retries forever, which hangs the
// runner. These cases only exercise getter logic against an injected snapshot, so
// build the instance without running the constructor.
function makeWatcher(): any {
  return Object.create(ConfigWatcher.prototype);
}

describe('test harness', () => {
  it('imports the watcher under test', () => {
    assert.ok(ConfigWatcher, 'ConfigWatcher must import — never skip silently');
  });
});

describe('ConfigWatcher getters', () => {
  it('returns default when snapshot is null', () => {
    const w = makeWatcher();
    (w as any).snapshot = null;

    assert.strictEqual(w.getString('any.key', 'myDefault'), 'myDefault');
    assert.strictEqual(w.getInt('any.key', 42), 42);
    assert.strictEqual(w.getFloat('any.key', 3.14), 3.14);
    assert.strictEqual(w.getBool('any.key', true), true);
  });

  it('returns string value from snapshot', () => {
    const w = makeWatcher();
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
    const w = makeWatcher();
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
    const w = makeWatcher();
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
    const w = makeWatcher();
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

// Regression for docs/reports/2026-10-03-node-configwatcher-stream-doubling-defect.md: grpc-js emits
// both 'end' and 'error' for one failed server stream; that must yield exactly one reconnect.
describe('ConfigWatcher reconnect', () => {
  function fakeStubWatcher() {
    const calls: Array<{ stream: any; cancelled: number }> = [];
    const w = makeWatcher();
    Object.assign(w, { namespace: 'test', call: null, reconnectTimer: null, reconnectAttempt: 0, resolveSnapshot: () => {} });
    (w as any).stub = {
      watchConfig: () => {
        const stream: any = new EventEmitter();
        const rec = { stream, cancelled: 0 };
        stream.cancel = () => { rec.cancelled++; };
        calls.push(rec);
        return stream;
      },
    };
    return { w, calls };
  }

  it('reconnects once per failed stream, cancelling it', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { w, calls } = fakeStubWatcher();
    (w as any).startWatch();
    calls[0].stream.emit('end');
    calls[0].stream.emit('error', new Error('14 UNAVAILABLE'));
    t.mock.timers.tick(60_000);
    assert.strictEqual(calls.length, 2, 'one failure must open exactly one replacement stream');
    assert.ok(calls[0].cancelled >= 1, 'the failed stream must be cancelled');
  });

  it('does not multiply streams across repeated failures', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { w, calls } = fakeStubWatcher();
    (w as any).startWatch();
    for (let i = 0; i < 6; i++) {
      const s = calls[calls.length - 1].stream;
      s.emit('end');
      s.emit('error', new Error('14 UNAVAILABLE'));
      t.mock.timers.tick(60_000);
    }
    assert.strictEqual(calls.length, 7, 'six failures → six reconnects, not 2^6');
  });

  it('backs off exponentially and resets after data', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { w, calls } = fakeStubWatcher();
    (w as any).startWatch();
    calls[0].stream.emit('error', new Error('x'));
    t.mock.timers.tick(499);
    assert.strictEqual(calls.length, 1, 'no reconnect before the jittered backoff floor (500ms)');
    t.mock.timers.tick(60_000);
    assert.strictEqual(calls.length, 2);
    calls[1].stream.emit('data', { namespace: 'test', version: '1', values: {}, changedKeys: [] });
    assert.strictEqual((w as any).reconnectAttempt, 0, 'a delivered snapshot resets the backoff');
  });
});
