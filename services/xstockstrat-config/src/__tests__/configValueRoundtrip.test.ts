/**
 * Value round-trip and is_secret propagation (feature 075).
 *
 * Two defects this guards:
 *
 *  1. `setConfig` used to persist `JSON.stringify(value)` -- the whole ConfigValue message --
 *     into `value_data`, while every read path parses that column as a BARE SCALAR. A write of
 *     "abc" round-tripped as the literal {"stringVal":"abc"}. `inferValueType` compounded it by
 *     testing snake_case fields against a ts-proto camelCase request, so int/float/bool writes
 *     were all recorded as value_type='string'.
 *
 *  2. `ConfigValue.is_secret` was never populated on the read path, so GetConfig/WatchConfig
 *     reported is_secret=false for every key -- including secret.* ones. Latent until a consumer
 *     trusts the field, which is exactly what feature 073's get_config redaction will do.
 *
 * The write cases go over a real gRPC connection so the request is the genuine ts-proto wire
 * shape (camelCase), which is what made the snake_case checks fail silently in the first place.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import { HEADER_ACCESS_SCOPE } from '../grpc/authz';
import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';

describe('is_secret propagation on the read path', () => {
  it('GetConfig reports is_secret=true for a secret row', async () => {
    const rows = [
      {
        namespace: 'marketdata',
        key: 'secret.marketdata.fmp.api_key',
        value_type: 'string',
        value_data: 'secret://vault/fmp',
        is_secret: true,
        description: 'FMP key',
        default_value: '',
        environment: 'dev',
        trading_mode: 'all',
      },
      {
        namespace: 'marketdata',
        key: 'marketdata.fmp.enabled',
        value_type: 'bool',
        value_data: 'true',
        is_secret: false,
        description: 'toggle',
        default_value: 'false',
        environment: 'dev',
        trading_mode: 'all',
      },
    ];
    const pool: any = {
      query: async () => ({ rows }),
      connect: async () => ({ query: async () => {}, on: () => {} }),
    };
    const impl: any = new ConfigServiceImpl(pool);
    // Populate the snapshot cache without opening a LISTEN connection.
    await (impl as any).reloadNamespace('marketdata', 'dev', 'all');

    let result: any = null;
    await impl.getConfig(
      { request: { namespace: 'marketdata', environment: 1, trading_mode: 0 } },
      (_e: unknown, res: unknown) => {
        result = res;
      },
    );

    assert.ok(result, 'getConfig returned a snapshot');
    const secret = result.values['secret.marketdata.fmp.api_key'];
    const plain = result.values['marketdata.fmp.enabled'];
    assert.equal(secret.isSecret, true, 'a secret key must be flagged on the wire');
    assert.equal(plain.isSecret, false, 'a non-secret key must not be flagged');
  });
});

describe('SetConfig value round-trip over a real gRPC connection', () => {
  let server: grpc.Server;
  let client: any;
  let lastInsert: unknown[] | undefined;

  before(async () => {
    const pool: any = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO config.config_values')) lastInsert = params;
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

  function write(value: Record<string, unknown>) {
    const md = new grpc.Metadata();
    md.set(HEADER_ACCESS_SCOPE, '4');
    return new Promise<void>((resolve, reject) => {
      client.setConfig(
        { namespace: 'platform', key: 'k', value, author: 'tester', reason: 'roundtrip' },
        md,
        (err: any) => (err ? reject(err) : resolve()),
      );
    });
  }

  // params order: [namespace, key, value_type, value_data, author, reason, env, mode]
  const VALUE_TYPE = 2;
  const VALUE_DATA = 3;

  it('stores a string as a bare scalar, not a JSON blob', async () => {
    await write({ stringVal: 'abc' });
    assert.equal(lastInsert?.[VALUE_TYPE], 'string');
    assert.equal(lastInsert?.[VALUE_DATA], 'abc', 'must be the bare scalar, not {"stringVal":"abc"}');
  });

  it('classifies and stores an int', async () => {
    await write({ intVal: 42 });
    assert.equal(lastInsert?.[VALUE_TYPE], 'int', 'camelCase intVal must not fall through to string');
    assert.equal(String(lastInsert?.[VALUE_DATA]), '42');
  });

  it('classifies and stores a float', async () => {
    await write({ floatVal: 1.5 });
    assert.equal(lastInsert?.[VALUE_TYPE], 'float');
    assert.equal(String(lastInsert?.[VALUE_DATA]), '1.5');
  });

  it('classifies and stores a bool', async () => {
    await write({ boolVal: true });
    assert.equal(lastInsert?.[VALUE_TYPE], 'bool');
    assert.equal(String(lastInsert?.[VALUE_DATA]), 'true');
  });

  it('stores what buildConfigValue can read back (bool)', async () => {
    await write({ boolVal: true });
    // buildConfigValue parses value_data as `row.value_data === 'true'` for value_type 'bool'.
    assert.equal(lastInsert?.[VALUE_DATA], 'true');
  });
});
