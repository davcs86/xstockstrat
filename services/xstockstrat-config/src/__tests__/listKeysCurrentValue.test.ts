/**
 * ListKeys currentValue regression (config-ui "editing configs" bug).
 *
 * `listKeys` used to SELECT only `default_value` — CONFIG-2's seed metadata column that a
 * SetConfig write never touches — and had no way to report a row's live `value_data` at all.
 * config-ui's NamespaceEditor displayed and edit-prefilled from that same defaultValue field
 * (the only "value"-shaped thing ListKeys returned), so every save appeared to silently
 * revert: the write landed in `value_data`, the UI kept showing the untouched seed default.
 *
 * These assertions guard both layers of the fix:
 *  1. the SQL SELECT clause actually reads `value_data` (a future edit could drop it again
 *     without any of the other listKeys tests noticing, since they stub `pool.query` without
 *     inspecting the query text);
 *  2. the response's `currentValue` is that `value_data`, independent of `defaultValue`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';

describe('ListKeys currentValue reports the live value_data, not the seed default', () => {
  let server: grpc.Server;
  let client: any;
  let lastListKeysSql: string | undefined;

  before(async () => {
    const rows = [
      {
        key: 'marketdata.fmp.enabled',
        description: 'Master gate for the FMP fundamentals source; off by default',
        default_value: 'false', // never changes after an edit (CONFIG-2)
        value_data: 'true', // what an admin actually set via SetConfig
        is_secret: false,
        consuming_service: 'xstockstrat-marketdata',
        environment: 'dev',
        trading_mode: 'all',
      },
    ];
    const pool: any = {
      query: async (sql: string) => {
        if (sql.includes('FROM config.config_values') && sql.includes('SELECT')) {
          lastListKeysSql = sql;
        }
        return { rows };
      },
      connect: async () => ({ query: async () => {}, on: () => {} }),
    };
    server = new grpc.Server();
    server.addService(
      createConfigServiceDefinition(),
      new ConfigServiceImpl(pool) as unknown as grpc.UntypedServiceImplementation,
    );
    const port: number = await new Promise((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) =>
        err ? reject(err) : resolve(p),
      );
    });
    const { ConfigServiceClient } = await import('@xstockstrat/proto/config/v1/config');
    client = new ConfigServiceClient(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  });

  after(() => {
    client?.close();
    server?.forceShutdown();
  });

  function listKeys(): Promise<any> {
    return new Promise((resolve, reject) => {
      client.listKeys({ namespace: 'marketdata' }, (err: any, res: any) =>
        err ? reject(err) : resolve(res),
      );
    });
  }

  it('SELECTs value_data alongside default_value', async () => {
    await listKeys();
    assert.ok(lastListKeysSql, 'listKeys must issue a SELECT against config.config_values');
    assert.match(lastListKeysSql!, /value_data/, 'the SELECT clause must read value_data');
  });

  it('currentValue reflects value_data even when it has diverged from defaultValue', async () => {
    const res = await listKeys();
    const key = res.keys.find((k: any) => k.key === 'marketdata.fmp.enabled');
    assert.equal(key.defaultValue, 'false', 'defaultValue stays the untouched seed metadata');
    assert.equal(key.currentValue, 'true', 'currentValue must be the live value_data');
  });
});
