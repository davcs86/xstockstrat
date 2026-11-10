// Feature 295: a silently dead LISTEN feed is detected by the listener-socket heartbeat and recovered
// (@AC-21), and the pool carries the bounded-wait and TCP keepalive options.
import { describe, it, before, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';

let ConfigServiceImpl: typeof import('../grpc/configServiceImpl').ConfigServiceImpl;

before(async () => {
  ConfigServiceImpl = (await import('../grpc/configServiceImpl.js')).ConfigServiceImpl;
});

const KEY = 'indicators.sandbox.timeout_ms';
const HEARTBEAT_SQL = /pg_notify\('config_heartbeat'/;
const flush = () => new Promise<void>((r) => setImmediate(r));

class ListenerClient extends EventEmitter {
  sql: string[] = [];
  releases: unknown[] = [];
  // echo=false models a feed that acknowledges every query but never delivers a notification.
  constructor(private readonly echo: boolean) {
    super();
  }
  async query(sql: string, params: unknown[] = []) {
    this.sql.push(sql);
    if (this.echo && HEARTBEAT_SQL.test(sql)) {
      queueMicrotask(() =>
        this.emit('notification', { channel: 'config_heartbeat', payload: params[0] }),
      );
    }
    return { rows: [] };
  }
  release = (err?: unknown) => {
    this.releases.push(err);
  };
}

function makeRig() {
  const poolSql: string[] = [];
  const clients: ListenerClient[] = [];
  const connectScript: ListenerClient[] = [];
  const rows: Record<string, unknown>[] = [
    {
      namespace: 'indicators',
      key: KEY,
      value_type: 'int',
      value_data: '5000',
      is_secret: false,
      environment: 'staging',
      updated_at: new Date(0),
    },
  ];
  const pool: any = {
    connect: async () => {
      const c = connectScript.shift() ?? new ListenerClient(true);
      clients.push(c);
      return c;
    },
    query: async (sql: string, params: unknown[] = []) => {
      poolSql.push(sql);
      if (/user_id = \$3/.test(sql)) return { rows: [] };
      if (/namespace = \$1 AND environment = \$2 AND user_id IS NULL/.test(sql)) {
        return {
          rows: rows
            .filter((r) => r.namespace === params[0] && r.environment === params[1])
            .map((r) => ({ ...r })),
        };
      }
      if (/WHERE user_id IS NULL/.test(sql) && params.length === 0) {
        return { rows: rows.map((r) => ({ ...r })) };
      }
      throw new Error(`unrouted SQL: ${sql}`);
    },
  };
  const setValue = (v: string) => {
    rows[0].value_data = v;
  };
  return { pool, clients, connectScript, poolSql, setValue };
}

function fakeCall() {
  const call: any = new EventEmitter();
  call.request = {
    namespace: 'indicators',
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

async function advance(t: TestContext, seconds: number) {
  for (let s = 0; s < seconds; s++) {
    t.mock.timers.tick(1000);
    await flush();
  }
}

describe('config change feed liveness (feature 295)', () => {
  it('@AC-21 a silent LISTEN feed misses its heartbeat deadline, reconnects, and resyncs 15000', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    const rig = makeRig();
    rig.connectScript.push(new ListenerClient(false));
    const impl = new ConfigServiceImpl(rig.pool);
    await impl.initialize();
    const call = fakeCall();
    impl.watchConfig(call);
    await flush();
    assert.strictEqual(call.writes.length, 1, 'the initial SNAPSHOT reached the subscriber');
    assert.strictEqual(call.writes[0].values[KEY]?.intVal, 5000);

    rig.setValue('15000'); // the operator write whose NOTIFY the dead feed never delivers
    await advance(t, 45);

    const dead = rig.clients[0];
    assert.ok(
      dead.sql.some((s) => HEARTBEAT_SQL.test(s)),
      'the heartbeat ran on the listener client',
    );
    assert.strictEqual(dead.releases.length, 1, 'the dead listener was released once');
    assert.ok(
      dead.releases[0] instanceof Error,
      'released with an error so pg discards the socket',
    );
    assert.ok(rig.clients.length >= 2, 'a new listener client was connected');
    assert.ok(
      rig.clients[1].sql.includes('LISTEN config_changed'),
      'LISTEN re-run on the new client',
    );
    const deltas = call.writes.filter((w: any) => w.updateType === 'CONFIG_UPDATE_TYPE_DELTA');
    assert.ok(
      deltas.some((d: any) => d.values[KEY]?.intVal === 15000),
      `the resync DELTA carries 15000; got ${JSON.stringify(deltas.map((d: any) => d.values[KEY]))}`,
    );
    assert.deepStrictEqual(
      rig.poolSql.filter((s) => /config_heartbeat/.test(s)),
      [],
      'the heartbeat never uses a pool slot (F-06)',
    );
  });

  it('a feed that echoes its heartbeat is never dropped', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
    const rig = makeRig();
    const impl = new ConfigServiceImpl(rig.pool);
    await impl.initialize();
    await advance(t, 95);
    assert.strictEqual(rig.clients.length, 1, 'no reconnect while heartbeats arrive');
    assert.deepStrictEqual(rig.clients[0].releases, []);
  });
});

describe('config DB pool options (feature 295)', () => {
  it('bounds query waits and enables TCP keepalive, keeping the default max of 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfgpool-'));
    const preload = join(dir, 'capture-pool.js');
    // Replaces pg.Pool before index.js loads, prints the constructor options, and exits before any I/O.
    writeFileSync(
      preload,
      `const pg = require(${JSON.stringify(require.resolve('pg'))});
pg.Pool = class { constructor(o) { process.stdout.write('POOL_OPTIONS ' + JSON.stringify(o) + '\\n'); process.exit(0); } };
`,
    );
    const out = execFileSync(process.execPath, ['-r', preload, join(__dirname, '..', 'index.js')], {
      env: {
        PATH: process.env.PATH,
        CONFIG_SECRETS_ENCRYPTION_KEY: '0'.repeat(64),
        DATABASE_URL: 'postgres://u:p@127.0.0.1:1/xstockstrat?sslmode=disable',
      },
      encoding: 'utf8',
      timeout: 15_000,
    });
    const line = out.split('\n').find((l) => l.startsWith('POOL_OPTIONS '));
    assert.ok(line, `the Pool constructor was reached; output: ${out}`);
    const opts = JSON.parse(line.slice('POOL_OPTIONS '.length));
    assert.strictEqual(opts.query_timeout, 15000);
    assert.strictEqual(opts.statement_timeout, 15000);
    assert.strictEqual(opts.keepAlive, true);
    assert.strictEqual(opts.keepAliveInitialDelayMillis, 10000);
    assert.strictEqual(opts.max, 2);
  });
});
