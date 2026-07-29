/**
 * environment / trading_mode scope resolution over a real gRPC connection (feature 078).
 *
 * ts-proto is generated with stringEnums=true, so a decoded request carries the string
 * constant ('ENVIRONMENT_PRODUCTION') rather than the wire number, and carries `tradingMode`
 * rather than `trading_mode`. The old code looked the string up in a numeric map and read a
 * snake_case field that never existed on the decoded message, so BOTH dimensions silently
 * collapsed to their zero-values: every request resolved to ('dev', 'all').
 *
 * Consequences that made this worth its own fix:
 *   - every production config row was unreachable over the RPC
 *   - every WatchConfig subscriber got dev config regardless of what it asked for
 *   - SetConfig wrote dev rows even when told production
 *
 * These assertions inspect the SQL parameters the handler actually binds, driven over a real
 * connection, because the bug lives entirely in decoding the request.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import { HEADER_ACCESS_SCOPE } from '../grpc/authz';
import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';

describe('scope resolution over a real gRPC connection', () => {
  let server: grpc.Server;
  let client: any;
  let readParams: any[] | undefined;
  let writeParams: any[] | undefined;

  before(async () => {
    const pool: any = {
      query: async (sql: string, params?: any[]) => {
        if (sql.includes('INSERT INTO config.config_values')) writeParams = params;
        else if (sql.includes('WHERE namespace')) readParams = params;
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
    return new Promise((resolve, reject) =>
      client.listKeys(req, (e: any) => (e ? reject(e) : resolve())),
    );
  }

  it('ListKeys honors production/live instead of collapsing to dev/all', async () => {
    await listKeys({
      namespace: 'marketdata',
      environment: 'ENVIRONMENT_PRODUCTION',
      tradingMode: 'TRADING_MODE_LIVE',
    });
    assert.equal(readParams?.[1], 'production', 'environment must not collapse to dev');
    assert.equal(readParams?.[2], 'live', 'trading_mode must not collapse to all');
  });

  it('ListKeys honors dev/paper', async () => {
    await listKeys({
      namespace: 'marketdata',
      environment: 'ENVIRONMENT_DEV',
      tradingMode: 'TRADING_MODE_PAPER',
    });
    assert.equal(readParams?.[1], 'dev');
    assert.equal(readParams?.[2], 'paper');
  });

  it('an unspecified scope still defaults to dev/all', async () => {
    await listKeys({ namespace: 'marketdata' });
    assert.equal(readParams?.[1], 'dev');
    assert.equal(readParams?.[2], 'all');
  });

  it('SetConfig writes the production row it was told to write', async () => {
    const md = new grpc.Metadata();
    md.set(HEADER_ACCESS_SCOPE, '4');
    await new Promise<void>((resolve, reject) =>
      client.setConfig(
        {
          namespace: 'marketdata',
          key: 'marketdata.fmp.enabled',
          value: { boolVal: true },
          author: 'tester',
          reason: 'scope test',
          environment: 'ENVIRONMENT_PRODUCTION',
          tradingMode: 'TRADING_MODE_LIVE',
        },
        md,
        (e: any) => (e ? reject(e) : resolve()),
      ),
    );
    // params order: [namespace, key, value_type, value_data, author, reason, env, mode]
    assert.equal(writeParams?.[6], 'production', 'a production write must not land in dev');
    assert.equal(writeParams?.[7], 'live');
  });
});
