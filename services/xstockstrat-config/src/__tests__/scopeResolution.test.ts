/**
 * environment / user scope resolution over a real gRPC connection.
 *
 * Feature 078 origin: ts-proto is generated with stringEnums=true, so a decoded request carries the
 * string constant ('ENVIRONMENT_PRODUCTION') rather than the wire number. The old code looked the
 * string up in a numeric map, so environment silently collapsed to its zero-value. These assertions
 * inspect the SQL parameters the handler actually binds, driven over a real connection.
 *
 * Feature 147: trading_mode is no longer a config axis (deprecated, ignored). Scope is now
 * environment (production/staging) x user_id (global/per-user). ENVIRONMENT_DEV maps to 'staging'.
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
  let listParams: any[] | undefined;
  let writeParams: any[] | undefined;

  before(async () => {
    const pool: any = {
      query: async (sql: string, params?: any[]) => {
        // Existence gate (feature 147: reads is_secret); registered non-secret key.
        if (sql.includes('SELECT is_secret FROM config.config_values')) return { rows: [{ is_secret: false }] };
        if (sql.includes('INSERT INTO config.config_values')) writeParams = params;
        else if (sql.includes('DISTINCT ON (key)')) listParams = params;
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

  it('ListKeys honors production instead of collapsing to staging', async () => {
    await listKeys({ namespace: 'marketdata', environment: 'ENVIRONMENT_PRODUCTION' });
    // listKeys params: [namespace, environment, user_id]
    assert.equal(listParams?.[1], 'production', 'environment must not collapse to staging');
    assert.equal(listParams?.[2], '', 'user_id defaults to global (empty)');
  });

  it('ListKeys maps the deprecated ENVIRONMENT_DEV to staging', async () => {
    await listKeys({ namespace: 'marketdata', environment: 'ENVIRONMENT_DEV' });
    assert.equal(listParams?.[1], 'staging');
  });

  it('ListKeys honors an explicit per-user scope', async () => {
    await listKeys({ namespace: 'portfolio', environment: 'ENVIRONMENT_PRODUCTION', userId: 'u-123' });
    assert.equal(listParams?.[1], 'production');
    assert.equal(listParams?.[2], 'u-123');
  });

  it('an unspecified environment defaults to staging', async () => {
    await listKeys({ namespace: 'marketdata' });
    assert.equal(listParams?.[1], 'staging');
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
        },
        md,
        (e: any) => (e ? reject(e) : resolve()),
      ),
    );
    // INSERT params: [namespace, key, value_type, value_data, value_encrypted, is_secret,
    //                 updated_by, update_reason, environment, user_id, caller_identity]
    assert.equal(writeParams?.[8], 'production', 'a production write must not land in staging');
    assert.equal(writeParams?.[9], null, 'a global write must have a null user_id');
  });
});
