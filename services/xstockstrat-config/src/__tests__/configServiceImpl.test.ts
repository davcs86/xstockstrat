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
import { ADMIN_SCOPE_ERROR, HEADER_ACCESS_SCOPE, HEADER_USER_ID } from '../grpc/authz';

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
    const hooks: { reloadAll: Hook[]; reloadNamespace: Hook[]; overlay: Hook[] } = {
      reloadAll: [],
      reloadNamespace: [],
      overlay: [],
    };
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
          await hooks.overlay.shift()?.();
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

  function fakeCall(userId = '') {
    const call: any = new EventEmitter();
    call.request = { namespace: 'analysis', environment: 'ENVIRONMENT_STAGING', user_id: userId, client_id: 'c1' };
    call.metadata = new grpc.Metadata();
    call.writes = [] as any[];
    call.write = (p: any) => {
      call.writes.push(p);
    };
    call.destroys = 0;
    call.destroy = (s: unknown) => {
      call.destroys++;
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

  // winston's Console transport writes every level to console._stdout, i.e. process.stdout.
  function captureStdout(t: TestContext): string[] {
    const out: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    t.mock.method(process.stdout, 'write', (chunk: any, ...rest: any[]) => {
      out.push(String(chunk));
      return write(chunk, ...rest);
    });
    return out;
  }

  const terminations = (out: string[]) => out.filter((s) => s.includes('WatchConfig subscriber terminated'));
  const rejectOverlay = () => {
    throw new Error('overlay rejected');
  };

  async function booted() {
    const rig = makeRig();
    const impl = new ConfigServiceImpl(rig.pool);
    await impl.initialize();
    return { rig, impl };
  }

  it('@AC-6 a failed initial snapshot ends the stream with INTERNAL and gets no later write', async (t) => {
    const seen = unhandled(t);
    const { rig, impl } = await booted();
    rig.hooks.overlay.push(rejectOverlay);
    const call = fakeCall('u-1');
    impl.watchConfig(call);
    await flush();
    assert.strictEqual(call.destroyed?.code, 13, 'the stream is ended with INTERNAL');
    assert.strictEqual(call.writes.length, 0);

    rig.setValue('600');
    rig.clients[0].notify(NOTIFY_ANALYSIS);
    await flush();
    assert.strictEqual(call.writes.length, 0, 'an ended subscriber receives no broadcast');
    assert.deepStrictEqual(seen, []);
  });

  it('@AC-7 a change broadcast while the snapshot is in flight reaches the new subscriber', async () => {
    const { rig, impl } = await booted();
    let release!: () => void;
    rig.hooks.overlay.push(() => new Promise<void>((r) => (release = r)));
    const call = fakeCall('u-1');
    impl.watchConfig(call);
    await flush();

    rig.setValue('600');
    rig.clients[0].notify(NOTIFY_ANALYSIS);
    await flush();
    assert.strictEqual(call.writes.length, 0, 'the snapshot is still in flight');

    release();
    await flush();
    assert.strictEqual(call.writes[0].updateType, 'CONFIG_UPDATE_TYPE_SNAPSHOT', 'SNAPSHOT first');
    assert.strictEqual(call.writes.length, 2, 'one catch-up DELTA after the SNAPSHOT');
    assert.strictEqual(lastDeltaValue(call), 600);
  });

  it('@AC-8 a failed broadcast ends the subscriber with INTERNAL and logs the error', async (t) => {
    const seen = unhandled(t);
    const { rig, impl } = await booted();
    const call = fakeCall('u-1');
    impl.watchConfig(call);
    await flush();
    assert.strictEqual(call.writes.length, 1, 'the initial SNAPSHOT reached the subscriber');

    const out = captureStdout(t);
    rig.hooks.overlay.push(rejectOverlay);
    rig.clients[0].notify(NOTIFY_ANALYSIS);
    await flush();
    assert.strictEqual(call.destroyed?.code, 13, 'the call is ended with INTERNAL');
    assert.ok(
      out.some((s) => s.includes('error') && s.includes('overlay rejected')),
      `error-level record expected, got ${JSON.stringify(out)}`,
    );

    rig.clients[0].notify(NOTIFY_ANALYSIS);
    await flush();
    assert.strictEqual(call.writes.length, 1, 'no write after the subscriber was ended');
    assert.deepStrictEqual(seen, []);
  });

  it('cancel during catch-up: no write, no destroy and no termination log', async (t) => {
    const seen = unhandled(t);
    const { rig, impl } = await booted();
    let release!: () => void;
    rig.hooks.overlay.push(() => new Promise<void>((r) => (release = r)));
    const call = fakeCall('u-1');
    impl.watchConfig(call);
    await flush();
    rig.clients[0].notify(NOTIFY_ANALYSIS);
    await flush();

    const out = captureStdout(t);
    call.emit('cancelled');
    release();
    await flush();
    assert.strictEqual(call.writes.length, 0, 'no write after cancel');
    assert.strictEqual(call.destroys, 0, 'a cancelled call is not destroyed');
    assert.deepStrictEqual(terminations(out), []);
    assert.deepStrictEqual(seen, []);
  });

  it('ends a subscriber once: two failures give one destroy and one error log', async (t) => {
    const { rig, impl } = await booted();
    const call = fakeCall('u-1');
    impl.watchConfig(call);
    await flush();

    const out = captureStdout(t);
    rig.hooks.overlay.push(rejectOverlay, rejectOverlay);
    rig.clients[0].notify(NOTIFY_ANALYSIS);
    rig.clients[0].notify(NOTIFY_ANALYSIS);
    await flush();
    await flush();
    assert.strictEqual(call.destroys, 1);
    assert.strictEqual(terminations(out).length, 1);
  });

  it('logs the propagated x-trace-id when a subscriber is terminated', async (t) => {
    const { rig, impl } = await booted();
    rig.hooks.overlay.push(rejectOverlay);
    const call = fakeCall('u-1');
    call.metadata.set('x-trace-id', 't-258');
    const out = captureStdout(t);
    impl.watchConfig(call);
    await flush();
    const lines = terminations(out);
    assert.strictEqual(lines.length, 1, JSON.stringify(out));
    assert.ok(lines[0].includes('"traceId":"t-258"'), lines[0]);
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

describe('ConfigServiceImpl — unary DB failures (feature 258)', () => {
  const KEY = 'analysis.backtest.max_duration_seconds';
  const OVERLAY = /user_id = \$3/;
  const GATE = /SELECT is_secret/;
  const WRITE = /INSERT INTO config\.config_values/;

  function makePool(fail: RegExp | null, gateRows: Record<string, unknown>[] = []) {
    const sqls: string[] = [];
    const pool: any = {
      query: async (sql: string) => {
        sqls.push(sql);
        if (fail && fail.test(sql)) throw new Error('connection terminated');
        if (GATE.test(sql)) return { rows: gateRows };
        return { rows: [] };
      },
      connect: async () => ({ query: async () => ({ rows: [] }), on: () => {}, release: () => {} }),
    };
    return { pool, sqls };
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

  function adminMd(): grpc.Metadata {
    const m = new grpc.Metadata();
    m.set(HEADER_ACCESS_SCOPE, '4');
    m.set(HEADER_USER_ID, 'admin-7');
    return m;
  }

  async function invoke(handler: (call: any, cb: any) => Promise<void>, call: any) {
    const calls: Array<{ err: any; res: any }> = [];
    await handler(call, (err: any, res: any) => {
      calls.push({ err, res });
    });
    await new Promise<void>((r) => setImmediate(r));
    assert.strictEqual(calls.length, 1, 'the callback is invoked exactly once');
    return calls[0];
  }

  function setConfigCall(value: Record<string, unknown>, metadata = adminMd(), key = KEY) {
    return {
      metadata,
      request: { namespace: 'analysis', key, value, author: 'admin-7', environment: 'ENVIRONMENT_STAGING' },
    };
  }

  it('@AC-3 GetConfig returns code 13 when the per-user overlay query fails', async (t) => {
    const seen = unhandled(t);
    const { pool, sqls } = makePool(OVERLAY);
    const impl = new ConfigServiceImpl(pool);
    const { err } = await invoke(impl.getConfig.bind(impl), {
      request: { namespace: 'analysis', userId: 'u-1', environment: 'ENVIRONMENT_STAGING' },
    });
    assert.ok(sqls.some((q) => OVERLAY.test(q)), 'the overlay SELECT was issued');
    assert.strictEqual(err?.code, 13);
    assert.deepStrictEqual(seen, []);
  });

  it('@AC-4 SetConfig returns code 13 when the existence-gate query fails, with no write', async (t) => {
    const seen = unhandled(t);
    const { pool, sqls } = makePool(GATE);
    const impl = new ConfigServiceImpl(pool);
    const { err } = await invoke(impl.setConfig.bind(impl), setConfigCall({ intVal: 600 }));
    assert.strictEqual(err?.code, 13);
    assert.ok(!sqls.some((q) => WRITE.test(q)), 'no INSERT after a gate failure');
    assert.deepStrictEqual(seen, []);
  });

  it('@AC-11 SetConfig returns code 13 when the value write fails after the gate passes', async (t) => {
    const seen = unhandled(t);
    const { pool, sqls } = makePool(WRITE, [{ is_secret: false }]);
    const impl = new ConfigServiceImpl(pool);
    const { err } = await invoke(impl.setConfig.bind(impl), setConfigCall({ intVal: 600 }));
    assert.ok(sqls.some((q) => WRITE.test(q)), 'the INSERT was issued');
    assert.strictEqual(err?.code, 13);
    assert.deepStrictEqual(seen, []);
  });

  it('keeps INVALID_ARGUMENT for an out-of-bounds value, before any query', async () => {
    const { pool, sqls } = makePool(null);
    const impl = new ConfigServiceImpl(pool);
    const { err } = await invoke(
      impl.setConfig.bind(impl),
      setConfigCall({ floatVal: -1 }, adminMd(), 'analysis.scoring.signal_decay_half_life_hours'),
    );
    assert.strictEqual(err?.code, 3);
    assert.deepStrictEqual(sqls, []);
  });

  it('keeps NOT_FOUND for an unregistered key without create_key', async () => {
    const { pool, sqls } = makePool(null, []);
    const impl = new ConfigServiceImpl(pool);
    const { err } = await invoke(impl.setConfig.bind(impl), setConfigCall({ intVal: 600 }));
    assert.strictEqual(err?.code, 5);
    assert.ok(!sqls.some((q) => WRITE.test(q)));
  });

  it('keeps PERMISSION_DENIED for a global write without admin scope, before any query', async () => {
    const { pool, sqls } = makePool(null);
    const impl = new ConfigServiceImpl(pool);
    const { err } = await invoke(impl.setConfig.bind(impl), setConfigCall({ intVal: 600 }, new grpc.Metadata()));
    assert.deepStrictEqual(err, ADMIN_SCOPE_ERROR);
    assert.deepStrictEqual(sqls, []);
  });
});
