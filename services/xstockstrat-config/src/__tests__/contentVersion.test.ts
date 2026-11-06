// Feature 295 @AC-26: the snapshot version is derived from content, so a no-op backstop reload or
// liveness re-send reports no new version and one real change reports exactly one.
import { describe, it, before, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as grpc from '@grpc/grpc-js';

let ConfigServiceImpl: typeof import('../grpc/configServiceImpl').ConfigServiceImpl;

before(async () => {
  ConfigServiceImpl = (await import('../grpc/configServiceImpl.js')).ConfigServiceImpl;
});

const KEY = 'ledger.export.max_window_days';
const VERSION = /^[0-9a-f]{16}$/;
const flush = () => new Promise<void>((r) => setImmediate(r));

class EchoListener extends EventEmitter {
  async query(sql: string, params: unknown[] = []) {
    if (/pg_notify\('config_heartbeat'/.test(sql)) {
      queueMicrotask(() =>
        this.emit('notification', { channel: 'config_heartbeat', payload: params[0] }),
      );
    }
    return { rows: [] };
  }
  release = () => undefined;
  change(payload: object) {
    this.emit('notification', { channel: 'config_changed', payload: JSON.stringify(payload) });
  }
}

function makeRig() {
  const listeners: EchoListener[] = [];
  let reloadAlls = 0;
  const rows: Record<string, unknown>[] = [
    { namespace: 'ledger', key: KEY, value_type: 'int', value_data: '90' },
    { namespace: 'ledger', key: 'ledger.export.format', value_type: 'string', value_data: 'csv' },
  ].map((r) => ({ ...r, is_secret: false, environment: 'staging', updated_at: new Date(0) }));
  const pool: any = {
    connect: async () => {
      const c = new EchoListener();
      listeners.push(c);
      return c;
    },
    query: async (sql: string, params: unknown[] = []) => {
      const marker = /config_markers/.test(sql) ? { marker_active: false } : {};
      const copy = (rs: Record<string, unknown>[]) => rs.map((r) => ({ ...r, ...marker }));
      if (/user_id = \$3/.test(sql)) return { rows: [] };
      if (/namespace = \$1 AND environment = \$2 AND user_id IS NULL/.test(sql)) {
        return {
          rows: copy(rows.filter((r) => r.namespace === params[0] && r.environment === params[1])),
        };
      }
      if (/WHERE user_id IS NULL/.test(sql) && params.length === 0) {
        reloadAlls++;
        return { rows: copy(rows) };
      }
      throw new Error(`unrouted SQL: ${sql}`);
    },
  };
  const setValue = (v: string) => {
    rows[0].value_data = v;
  };
  return { pool, listeners, setValue, reloadAlls: () => reloadAlls };
}

function fakeCall() {
  const call: any = new EventEmitter();
  call.request = {
    namespace: 'ledger',
    environment: 'ENVIRONMENT_STAGING',
    user_id: '',
    client_id: 'c1',
  };
  call.metadata = new grpc.Metadata();
  call.writes = [] as any[];
  call.write = (p: any) => {
    call.writes.push(p);
    return true;
  };
  call.destroy = () => undefined;
  return call;
}

function getConfigVersion(impl: any): Promise<string> {
  return new Promise((resolve, reject) =>
    impl.getConfig(
      { request: { namespace: 'ledger', environment: 'ENVIRONMENT_STAGING', user_id: '' } },
      (err: unknown, res: any) => (err ? reject(err) : resolve(res.version)),
    ),
  );
}

async function advance(t: TestContext, seconds: number) {
  for (let s = 0; s < seconds; s += 10) {
    t.mock.timers.tick(10_000);
    await flush();
    await flush();
  }
}

describe('config content version (feature 295)', () => {
  it('@AC-26 a no-op reload or re-send keeps the version; one change adds exactly one', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    const rig = makeRig();
    const impl = new ConfigServiceImpl(rig.pool);
    await impl.initialize();
    const call = fakeCall();
    impl.watchConfig(call);
    await flush();
    const v0 = call.writes[0].version;
    assert.match(v0, VERSION, 'the version is 16 hex characters');
    assert.strictEqual(
      await getConfigVersion(impl),
      v0,
      'GetConfig reports the subscriber version',
    );

    const writesBefore = call.writes.length;
    await advance(t, 10);
    assert.ok(
      call.writes.length > writesBefore,
      'the 10 s liveness re-send wrote to the subscriber',
    );

    const reloadsBefore = rig.reloadAlls();
    await advance(t, 300);
    assert.ok(rig.reloadAlls() > reloadsBefore, 'the 5-min backstop reloadAll ran');
    const versions = () => new Set(call.writes.map((w: any) => w.version));
    assert.deepStrictEqual([...versions()], [v0], 'no new version without a row change');
    assert.strictEqual(
      await getConfigVersion(impl),
      v0,
      'the version is stable across the two calls',
    );

    const twin = new ConfigServiceImpl(rig.pool);
    await twin.initialize();
    assert.strictEqual(
      await getConfigVersion(twin),
      v0,
      'identical content yields the identical version',
    );

    rig.setValue('180');
    rig.listeners[0].change({ namespace: 'ledger', environment: 'staging' });
    await flush();
    await flush();
    const last = call.writes[call.writes.length - 1];
    assert.strictEqual(last.values[KEY]?.intVal, 180);
    assert.match(last.version, VERSION);
    assert.strictEqual(versions().size, 2, 'exactly one new version');
  });
});
