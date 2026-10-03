/**
 * ListKeys reports each key's `updated_at` from the resolved row (feature 219).
 *
 * The pool stub emulates the `DISTINCT ON (key)` resolution by `$3` (per-user row when a user id
 * is passed, else global) because a mocked pool cannot execute SQL; the SQL-shape assertion below
 * proves the column rides in the same resolved SELECT, and listKeysDedup.test.ts guards ORDER BY.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';

describe('ListKeys updatedAt (resolved row) over a real gRPC connection', () => {
  let server: grpc.Server;
  let client: any;
  let lastListKeysSql: string | undefined;

  const globalTradingState = {
    key: 'platform.trading_state',
    description: 'Platform-wide trading state',
    default_value: 'ACTIVE',
    value_data: 'ACTIVE',
    is_secret: false,
    consuming_service: 'xstockstrat-trading',
    environment: 'staging',
    updated_at: new Date('2026-09-01T10:00:00Z'),
  };
  const perUserTradingState = {
    ...globalTradingState,
    value_data: 'REDUCE_ONLY',
    updated_at: new Date('2026-09-15T08:30:00Z'),
  };
  const secretRow = {
    key: 'marketdata.alpaca.api_key',
    description: 'Alpaca API key',
    default_value: '',
    value_data: '[redacted]',
    is_secret: true,
    consuming_service: 'xstockstrat-marketdata',
    environment: 'staging',
    updated_at: new Date('2026-09-20T12:00:00Z'),
  };
  const rowWithoutUpdatedAt = {
    key: 'marketdata.fmp.enabled',
    description: '',
    default_value: 'false',
    value_data: 'false',
    is_secret: false,
    consuming_service: 'xstockstrat-marketdata',
    environment: 'staging',
  };

  before(async () => {
    const pool: any = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM config.config_values') && sql.includes('SELECT')) {
          lastListKeysSql = sql;
        }
        const [namespace, , userId] = params;
        if (namespace === 'marketdata') return { rows: [secretRow, rowWithoutUpdatedAt] };
        return { rows: [userId === 'u-123' ? perUserTradingState : globalTradingState] };
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

  function listKeys(req: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      client.listKeys(req, (err: any, res: any) => (err ? reject(err) : resolve(res)));
    });
  }

  function findKey(res: any, key: string): any {
    const entry = res.keys.find((k: any) => k.key === key);
    assert.ok(entry, `expected ${key} in the ListKeys response`);
    return entry;
  }

  it('selects updated_at inside the DISTINCT ON resolved SELECT', async () => {
    await listKeys({ namespace: 'platform', environment: 'ENVIRONMENT_STAGING', userId: '' });
    assert.match(
      lastListKeysSql ?? '',
      /SELECT DISTINCT ON \(key\)[\s\S]*updated_at[\s\S]*FROM config\.config_values/,
    );
  });

  it('AC-6: user scope returns the per-user row updatedAt', async () => {
    const res = await listKeys({
      namespace: 'platform',
      environment: 'ENVIRONMENT_STAGING',
      userId: 'u-123',
    });
    const entry = findKey(res, 'platform.trading_state');
    assert.ok(entry.updatedAt instanceof Date, 'updatedAt must decode as a Date');
    assert.equal(entry.updatedAt.toISOString(), '2026-09-15T08:30:00.000Z');
  });

  it('AC-13: global scope returns the global row updatedAt', async () => {
    const res = await listKeys({
      namespace: 'platform',
      environment: 'ENVIRONMENT_STAGING',
      userId: '',
    });
    const entry = findKey(res, 'platform.trading_state');
    assert.ok(entry.updatedAt instanceof Date, 'updatedAt must decode as a Date');
    assert.equal(entry.updatedAt.toISOString(), '2026-09-01T10:00:00.000Z');
  });

  it('AC-7: a secret row stays redacted but still carries updatedAt', async () => {
    const res = await listKeys({ namespace: 'marketdata', environment: 'ENVIRONMENT_STAGING' });
    const entry = findKey(res, 'marketdata.alpaca.api_key');
    assert.equal(entry.currentValue, '[redacted]');
    assert.equal(entry.isSecret, true);
    assert.ok(entry.updatedAt instanceof Date, 'updatedAt must decode as a Date');
    assert.equal(entry.updatedAt.toISOString(), '2026-09-20T12:00:00.000Z');
  });

  it('leaves updatedAt unset when the row has no updated_at', async () => {
    const res = await listKeys({ namespace: 'marketdata', environment: 'ENVIRONMENT_STAGING' });
    const entry = findKey(res, 'marketdata.fmp.enabled');
    assert.equal(entry.updatedAt, undefined);
  });
});
