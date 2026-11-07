/**
 * Feature 294 AC-48: config LISTEN health and WatchConfig termination metrics, read from an
 * in-memory MeterProvider over a fake pool whose LISTEN client the test drops and reconnects.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as grpc from '@grpc/grpc-js';

import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { type CollectingReader, install, points, values } from './fixtures/collectingReader';

const BOOT_MS = 1_700_000_000_000;
const flush = () => new Promise<void>((r) => setImmediate(r));

let reader: CollectingReader;

async function single(name: string): Promise<number | undefined> {
  const vs = await values(reader, name);
  assert.ok(vs.length <= 1, `${name}: ${JSON.stringify(vs)}`);
  return vs[0];
}

class FakeClient extends EventEmitter {
  async query() {
    return { rows: [] };
  }
  release() {}
}

describe('config listener and WatchConfig telemetry (AC-48)', () => {
  before(() => {
    reader = install();
  });

  it('@AC-48 listener_up tracks drop and reconnect, and stays 0 when the client errors mid-reload', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: BOOT_MS });
    const clients: FakeClient[] = [];
    let failNextReload = false;
    const pool: any = {
      connect: async () => {
        const c = new FakeClient();
        clients.push(c);
        return c;
      },
      query: async (sql: string) => {
        if (failNextReload && /WHERE user_id IS NULL/.test(sql)) {
          failNextReload = false;
          clients[clients.length - 1].emit('error', new Error('dropped mid-reload'));
        }
        return { rows: [] };
      },
    };
    const impl = new ConfigServiceImpl(pool);
    await impl.initialize();
    assert.equal(await single('config.listener_up'), 1);
    assert.equal(await single('config.listener_reconnects'), undefined, 'boot is not a reconnect');
    assert.equal(await single('config.last_reload_timestamp'), BOOT_MS / 1000);

    clients[0].emit('error', new Error('terminating connection'));
    assert.equal(await single('config.listener_up'), 0, '0 while disconnected');

    t.mock.timers.tick(1000);
    await flush();
    assert.equal(clients.length, 2, 'one reconnect attempt');
    assert.equal(await single('config.listener_up'), 1, '1 after reconnect');
    assert.equal(await single('config.listener_reconnects'), 1);
    assert.equal(await single('config.last_reload_timestamp'), (BOOT_MS + 1000) / 1000);

    clients[1].emit('error', new Error('terminating connection'));
    failNextReload = true;
    t.mock.timers.tick(1000);
    await flush();
    assert.equal(clients.length, 3);
    assert.equal(
      await single('config.listener_up'),
      0,
      'a client dropped mid-reload is never reported up',
    );
    assert.equal(await single('config.listener_reconnects'), 1, 'no reconnect counted for it');
  });

  it('@AC-48 a WatchConfig client error counts watch.terminated{client_error}', async () => {
    const impl = new ConfigServiceImpl({ query: async () => ({ rows: [] }) } as any);
    const call: any = new EventEmitter();
    call.request = {
      namespace: 'analysis',
      environment: 'ENVIRONMENT_STAGING',
      user_id: '',
      client_id: 'c1',
    };
    call.metadata = new grpc.Metadata();
    call.write = () => {};
    impl.watchConfig(call);
    await flush();
    call.emit('error', new Error('client went away'));
    const ps = await points(reader, 'config.watch.terminated');
    assert.deepEqual(
      ps.map((p) => [p.attributes.reason, p.value]),
      [['client_error', 1]],
    );
  });
});
