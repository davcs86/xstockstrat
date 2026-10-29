/**
 * Unit tests for ConfigServiceImpl.listKeys validation-field population.
 *
 * The DB pool is mocked with a stub returning controlled rows, so no running
 * TimescaleDB is required. If the @xstockstrat/proto package is unavailable in
 * the test environment the import throws — guarded with a graceful skip.
 *
 * Run with: node --experimental-strip-types --test src/__tests__/configServiceImpl.test.ts
 */
import { describe, it, before, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as grpc from '@grpc/grpc-js';

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

  it('populates FLOAT_SCALAR validation for the decay key (feature 161)', async () => {
    // The DB `key` column is namespace-stripped, so the row's key is the SPLIT form and the handler
    // must reconstruct `${namespace}.${key}` to hit the full-path registry (reviewer-flagged fix).
    const pool = makePool([
      {
        key: 'scoring.signal_decay_half_life_hours',
        description: 'Decay half-life',
        default_value: '24.0',
        is_secret: false,
        consuming_service: 'xstockstrat-analysis',
        environment: 'staging',
      },
    ]);
    const impl = new ConfigServiceImpl(pool);
    let result: any = null;
    await impl.listKeys(
      { request: { namespace: 'analysis', environment: 1 } },
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
    assert.strictEqual(k.validation.valueType, 'VALUE_TYPE_FLOAT_SCALAR');
    assert.ok(Math.abs(k.validation.minValue - 0.0) < 1e-6);
    assert.ok(Math.abs(k.validation.maxValue - 8760) < 1e-6);
  });

  it('omits validation for non-registered keys', async () => {
    const pool = makePool([
      {
        key: 'log_level',
        description: 'Log level',
        default_value: 'info',
        is_secret: false,
        consuming_service: 'all',
        environment: 'staging',
      },
    ]);
    const impl = new ConfigServiceImpl(pool);
    let result: any = null;
    await impl.listKeys(
      { request: { namespace: 'platform', environment: 1 } },
      (_err: unknown, res: unknown) => {
        result = res;
      },
    );
    assert.ok(result);
    const k = result.keys[0];
    assert.strictEqual(k.validation, undefined, 'non-registered key must have no validation');
  });
});

describe('ConfigServiceImpl — LISTEN lifecycle (feature 258)', () => {
  const KEY = 'analysis.backtest.max_duration_seconds';
  const NOTIFY_ANALYSIS = JSON.stringify({ namespace: 'analysis', environment: 'staging' });
  const flush = () => new Promise<void>((r) => setImmediate(r));

  class FakeClient extends EventEmitter {
    releases: unknown[] = [];
    constructor(private readonly log: string[]) {
      super();
    }
    async query(sql: string) {
      this.log.push(sql);
      return { rows: [] };
    }
    release = (err?: unknown) => {
      this.releases.push(err);
    };
    notify(payload: string) {
      this.emit('notification', { payload });
    }
  }

  type Hook = () => Promise<void> | void;

  function makeRig() {
    const log: string[] = [];
    const clients: FakeClient[] = [];
    const connectScript: Array<FakeClient | Error> = [];
    const hooks: { reloadAll: Hook[]; reloadNamespace: Hook[] } = { reloadAll: [], reloadNamespace: [] };
    const rows: Record<string, unknown>[] = [
      {
        namespace: 'analysis',
        key: KEY,
        value_type: 'int',
        value_data: '300',
        is_secret: false,
        environment: 'staging',
      },
    ];
    const pool: any = {
      connect: async () => {
        log.push('connect');
        const next = connectScript.shift() ?? new FakeClient(log);
        if (next instanceof Error) throw next;
        clients.push(next);
        return next;
      },
      query: async (sql: string, params: unknown[] = []) => {
        if (/user_id = \$3/.test(sql)) {
          log.push('overlay');
          return { rows: [] };
        }
        if (/namespace = \$1 AND environment = \$2 AND user_id IS NULL/.test(sql)) {
          log.push('reloadNamespace');
          const snap = rows
            .filter((r) => r.namespace === params[0] && r.environment === params[1])
            .map((r) => ({ ...r }));
          await hooks.reloadNamespace.shift()?.();
          return { rows: snap };
        }
        if (/WHERE user_id IS NULL/.test(sql) && params.length === 0) {
          log.push('reloadAll');
          const snap = rows.map((r) => ({ ...r }));
          await hooks.reloadAll.shift()?.();
          return { rows: snap };
        }
        throw new Error(`unrouted SQL: ${sql}`);
      },
    };
    const setValue = (v: string) => {
      rows[0].value_data = v;
    };
    const connects = () => log.filter((l) => l === 'connect').length;
    const listens = () => log.filter((l) => l === 'LISTEN config_changed').length;
    return { log, clients, connectScript, hooks, pool, setValue, connects, listens };
  }

  function fakeCall() {
    const call: any = new EventEmitter();
    call.request = { namespace: 'analysis', environment: 'ENVIRONMENT_STAGING', user_id: '', client_id: 'c1' };
    call.metadata = new grpc.Metadata();
    call.writes = [] as any[];
    call.write = (p: any) => {
      call.writes.push(p);
    };
    call.destroy = (s: unknown) => {
      call.destroyed = s;
    };
    return call;
  }

  function unhandled(t: TestContext) {
    const seen: unknown[] = [];
    const onRejection = (reason: unknown) => {
      seen.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    t.after(() => {
      process.off('unhandledRejection', onRejection);
    });
    return seen;
  }

  function lastDeltaValue(call: any): number | undefined {
    const last = call.writes[call.writes.length - 1];
    assert.ok(last, 'a write must have reached the subscriber');
    assert.strictEqual(last.updateType, 'CONFIG_UPDATE_TYPE_DELTA');
    return last.values[KEY]?.intVal;
  }

  function getConfig(impl: any): Promise<{ err: unknown; res: any }> {
    return new Promise((resolve) =>
      impl.getConfig(
        { request: { namespace: 'analysis', environment: 'ENVIRONMENT_STAGING', user_id: '' } },
        (err: unknown, res: unknown) => resolve({ err, res }),
      ),
    );
  }

  async function subscribed(t: TestContext) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const rig = makeRig();
    const impl = new ConfigServiceImpl(rig.pool);
    await impl.initialize();
    const call = fakeCall();
    impl.watchConfig(call);
    await flush();
    assert.strictEqual(call.writes.length, 1, 'the initial SNAPSHOT reached the subscriber');
    return { rig, impl, call };
  }

  function drop(client: FakeClient) {
    const err = new Error('terminating connection due to administrator command');
    client.emit('error', err);
    client.emit('end');
    return err;
  }

  it('runs LISTEN before the boot reloadAll SELECT', async () => {
    const rig = makeRig();
    await new ConfigServiceImpl(rig.pool).initialize();
    const listenAt = rig.log.indexOf('LISTEN config_changed');
    const reloadAt = rig.log.indexOf('reloadAll');
    assert.ok(listenAt >= 0 && reloadAt >= 0, JSON.stringify(rig.log));
    assert.ok(listenAt < reloadAt, 'LISTEN must precede the reloadAll SELECT');
  });

  it('@AC-1 reconnects after the LISTEN connection drops and delivers the next change', async (t) => {
    const seen = unhandled(t);
    const { rig, impl, call } = await subscribed(t);
    const err = drop(rig.clients[0]);
    assert.deepStrictEqual(rig.clients[0].releases, [err], 'exactly one release, carrying the error');

    t.mock.timers.tick(1000);
    await flush();
    assert.strictEqual(rig.connects(), 2, 'a second pool.connect');
    assert.strictEqual(rig.listens(), 2, 'a second LISTEN config_changed');

    rig.setValue('600');
    rig.clients[1].notify(NOTIFY_ANALYSIS);
    await flush();
    assert.strictEqual(lastDeltaValue(call), 600);
    const { res } = await getConfig(impl);
    assert.strictEqual(res.values[KEY].intVal, 600, 'the same instance serves the new value');
    assert.deepStrictEqual(seen, []);
  });

  it('@AC-9 resyncs a change committed while the listener was down, with no NOTIFY', async (t) => {
    const { rig, call } = await subscribed(t);
    drop(rig.clients[0]);
    rig.setValue('600');
    t.mock.timers.tick(1000);
    await flush();
    assert.ok(!rig.log.includes('reloadNamespace'), 'no notification was delivered');
    assert.strictEqual(lastDeltaValue(call), 600);
  });

  it('reconnect pool.connect() rejects twice, then succeeds, and the backoff resets', async (t) => {
    const seen = unhandled(t);
    const { rig, call } = await subscribed(t);
    drop(rig.clients[0]);
    rig.connectScript.push(new Error('connection terminated'), new Error('connection terminated'));

    t.mock.timers.tick(1000);
    await flush();
    assert.strictEqual(rig.connects(), 2, 'first reconnect attempt rejected');
    t.mock.timers.tick(1999);
    await flush();
    assert.strictEqual(rig.connects(), 2, 'no attempt before the 2 s backoff');
    t.mock.timers.tick(1);
    await flush();
    assert.strictEqual(rig.connects(), 3, 'second reconnect attempt rejected');
    const writesBefore = call.writes.length;
    t.mock.timers.tick(4000);
    await flush();
    assert.strictEqual(rig.connects(), 4);
    assert.strictEqual(rig.listens(), 2, 'LISTEN re-run on the new client');
    assert.strictEqual(call.writes.length, writesBefore + 1, 'a DELTA re-broadcast to the subscriber');
    assert.strictEqual(lastDeltaValue(call), 300);
    assert.deepStrictEqual(seen, []);

    drop(rig.clients[1]);
    t.mock.timers.tick(999);
    await flush();
    assert.strictEqual(rig.connects(), 4);
    t.mock.timers.tick(1);
    await flush();
    assert.strictEqual(rig.connects(), 5, 'the backoff reset to 1 s after a success');
  });

  it('reconnect reloadAll rejects once: the new client is released and the retry re-broadcasts', async (t) => {
    const seen = unhandled(t);
    const { rig, call } = await subscribed(t);
    drop(rig.clients[0]);
    const reloadErr = new Error('connection terminated');
    rig.hooks.reloadAll.push(() => {
      throw reloadErr;
    });
    t.mock.timers.tick(1000);
    await flush();
    assert.deepStrictEqual(rig.clients[1].releases, [reloadErr], 'released exactly once, with that error');

    rig.setValue('600');
    t.mock.timers.tick(2000);
    await flush();
    assert.strictEqual(rig.connects(), 3);
    assert.strictEqual(lastDeltaValue(call), 600);
    assert.deepStrictEqual(seen, []);
  });

  it('a notification during a reconnect reloadAll is applied after it, in chain order', async (t) => {
    const { rig, impl, call } = await subscribed(t);
    drop(rig.clients[0]);
    let release!: () => void;
    rig.hooks.reloadAll.push(() => new Promise<void>((r) => (release = r)));
    t.mock.timers.tick(1000);
    await flush();
    assert.strictEqual(rig.listens(), 2);

    rig.setValue('600');
    rig.clients[1].notify(NOTIFY_ANALYSIS);
    await flush();
    assert.ok(!rig.log.includes('reloadNamespace'), 'the notification waits for the in-flight reloadAll');

    const writesBefore = call.writes.length;
    release();
    await flush();
    const deltas = call.writes.slice(writesBefore).map((w: any) => w.values[KEY].intVal);
    assert.deepStrictEqual(deltas, [300, 600], 'stale resync first, then the notification');
    const { res } = await getConfig(impl);
    assert.strictEqual(res.values[KEY].intVal, 600, 'the cache holds the reloadNamespace data');
  });

  it('@AC-2 a failed notification reload is logged, not an unhandled rejection', async (t) => {
    const seen = unhandled(t);
    const rig = makeRig();
    const impl = new ConfigServiceImpl(rig.pool);
    await impl.initialize();
    const out: string[] = [];
    // winston's Console transport writes every level to console._stdout, i.e. process.stdout.
    const write = process.stdout.write.bind(process.stdout);
    t.mock.method(process.stdout, 'write', (chunk: any, ...rest: any[]) => {
      out.push(String(chunk));
      return write(chunk, ...rest);
    });
    rig.hooks.reloadNamespace.push(() => {
      throw new Error('connection terminated');
    });
    rig.clients[0].notify(NOTIFY_ANALYSIS);
    await flush();
    await flush();
    assert.deepStrictEqual(seen, []);
    assert.ok(
      out.some((s) => s.includes('error') && s.includes('connection terminated')),
      `error-level record expected, got ${JSON.stringify(out)}`,
    );
    const { err } = await getConfig(impl);
    assert.strictEqual(err, null);
  });

  it('ignores a malformed notification payload', async (t) => {
    const seen = unhandled(t);
    const rig = makeRig();
    await new ConfigServiceImpl(rig.pool).initialize();
    const before = rig.log.length;
    assert.doesNotThrow(() => rig.clients[0].notify('not json'));
    await flush();
    assert.deepStrictEqual(seen, []);
    assert.strictEqual(rig.log.length, before, 'no query for a malformed payload');
  });
});
