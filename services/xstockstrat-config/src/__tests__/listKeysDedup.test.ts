/**
 * ListKeys duplicate-row regression.
 *
 * A key can have both a trading_mode='all' row and a mode-exact shadow row for the same
 * (namespace, key, environment) scope (see the setConfig existence-gate comment in
 * configServiceImpl.ts). listKeys' WHERE clause matches BOTH ((trading_mode = $mode OR
 * trading_mode = 'all')), so without de-dup the same key is returned twice — /config-ui
 * rendered two rows sharing one key, and since the page keys row/edit state on the bare
 * key string, both entered edit mode together and Save could target the wrong scope.
 *
 * These assertions exercise listKeys' post-query resolution directly against a mocked pool
 * (matching the existing listKeysWire.test.ts style), independent of DB row order.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';

async function startServer(rows: any[]) {
  const pool: any = {
    query: async () => ({ rows }),
    connect: async () => ({ query: async () => {}, on: () => {} }),
  };
  const server = new grpc.Server();
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
  const client = new ConfigServiceClient(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  return { server, client };
}

function listKeys(client: any): Promise<any> {
  return new Promise((resolve, reject) => {
    client.listKeys({ namespace: 'marketdata' }, (err: any, res: any) =>
      err ? reject(err) : resolve(res),
    );
  });
}

describe('ListKeys de-dup when a key has both an all-scope and a mode-exact row', () => {
  const allRow = {
    key: 'marketdata.fmp.enabled',
    description: 'Master gate for the FMP fundamentals source; off by default',
    default_value: 'false',
    is_secret: false,
    consuming_service: 'xstockstrat-marketdata',
    environment: 'dev',
    trading_mode: 'all',
  };
  const modeExactRow = {
    ...allRow,
    default_value: 'true',
    trading_mode: 'paper',
  };

  it('returns exactly one row for the key, regardless of DB row order', async () => {
    for (const rows of [[allRow, modeExactRow], [modeExactRow, allRow]]) {
      const { server, client } = await startServer(rows);
      try {
        const res = await listKeys(client);
        const matches = res.keys.filter((k: any) => k.key === 'marketdata.fmp.enabled');
        assert.equal(matches.length, 1, `expected one row, got ${matches.length} for order ${JSON.stringify(rows.map((r) => r.trading_mode))}`);
      } finally {
        client.close();
        server.forceShutdown();
      }
    }
  });

  it('prefers the mode-exact row over the all-scope row', async () => {
    for (const rows of [[allRow, modeExactRow], [modeExactRow, allRow]]) {
      const { server, client } = await startServer(rows);
      try {
        const res = await listKeys(client);
        const match = res.keys.find((k: any) => k.key === 'marketdata.fmp.enabled');
        assert.equal(match.defaultValue, 'true', 'the mode-exact row must win over the all-scope row');
        assert.equal(match.tradingMode, 'TRADING_MODE_PAPER');
      } finally {
        client.close();
        server.forceShutdown();
      }
    }
  });

  it('leaves a key with only one registered row unaffected', async () => {
    const { server, client } = await startServer([allRow]);
    try {
      const res = await listKeys(client);
      const matches = res.keys.filter((k: any) => k.key === 'marketdata.fmp.enabled');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].defaultValue, 'false');
      assert.equal(matches[0].tradingMode, 'TRADING_MODE_UNSPECIFIED');
    } finally {
      client.close();
      server.forceShutdown();
    }
  });
});
