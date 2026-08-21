/**
 * ListKeys per-user overlay query shape (feature 147).
 *
 * Before 147, a key could have both a trading_mode='all' row and a mode-exact row, and listKeys
 * de-duped them in JS. trading_mode is now gone; scope is environment x global/per-user, and the
 * de-dup + preference (per-user row wins over the global row for the same key) is delegated to a
 * single SQL statement: `SELECT DISTINCT ON (key) ... WHERE (user_id IS NULL OR user_id = $3)
 * ORDER BY key, (user_id = $3) DESC NULLS LAST`. This test guards that query shape — if the
 * DISTINCT ON or the preference ORDER BY is dropped, config-ui would render duplicate/wrong-scope
 * rows again. (End-to-end overlay behavior is proven against a real DB in the migration/service
 * integration checks; a mocked pool cannot execute DISTINCT ON.)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';

describe('ListKeys emits the per-user overlay query', () => {
  let server: grpc.Server;
  let client: any;
  let listSql = '';
  let listParams: any[] | undefined;

  before(async () => {
    const pool: any = {
      query: async (sql: string, params?: any[]) => {
        if (sql.includes('DISTINCT ON (key)')) {
          listSql = sql;
          listParams = params;
        }
        return { rows: [] };
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

  function listKeys(req: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => client.listKeys(req, (e: any) => (e ? reject(e) : resolve())));
  }

  it('de-dups per key via DISTINCT ON (key)', async () => {
    await listKeys({ namespace: 'marketdata', environment: 'ENVIRONMENT_PRODUCTION' });
    assert.match(listSql, /DISTINCT ON \(key\)/, 'a missing DISTINCT ON would re-introduce duplicate rows');
  });

  it('overlays the per-user row over the global row (user_id IS NULL OR user_id = $3), user wins', async () => {
    await listKeys({ namespace: 'portfolio', environment: 'ENVIRONMENT_PRODUCTION', userId: 'u-123' });
    assert.match(listSql, /user_id IS NULL OR user_id = \$3/, 'both global and per-user rows must be selected');
    assert.match(listSql, /ORDER BY key, \(user_id = \$3\) DESC/, 'the per-user row must be preferred over global');
    assert.equal(listParams?.[2], 'u-123', 'the user_id must be bound as $3');
  });

  it('resolves only global rows when no user_id is given', async () => {
    await listKeys({ namespace: 'marketdata', environment: 'ENVIRONMENT_PRODUCTION' });
    // user_id bound as '' means `user_id = ''` matches no real row, so only user_id IS NULL rows return.
    assert.equal(listParams?.[2], '');
  });
});
