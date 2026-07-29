/**
 * ListKeys wire-encoding regression (feature 077).
 *
 * `listKeys` used to build its response with snake_case field names and numeric enums.
 * ts-proto encodes camelCase and (buf.gen.yaml stringEnums=true) string enum constants,
 * so `ConfigKeyMeta.encode()` read `undefined` for every one of those fields and wrote
 * proto defaults. Over the wire a client saw isSecret=false, empty defaultValue and
 * consumingService, and UNRECOGNIZED enums on EVERY key.
 *
 * That is not cosmetic: /config-ui's "cannot edit a secret key" guard reads isSecret from
 * ListKeys, so the guard was inert. Feature 075 fixed this same defect class for
 * ConfigSnapshot and missed ListKeysResponse.
 *
 * These assertions go over a REAL gRPC connection, because the bug is invisible to a test
 * that inspects the handler's pre-encode object -- which is exactly how it survived.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';

describe('ListKeys over a real gRPC connection', () => {
  let server: grpc.Server;
  let client: any;

  before(async () => {
    const rows = [
      {
        key: 'secret.example.api_key',
        description: 'a secret key',
        default_value: 'placeholder',
        is_secret: true,
        consuming_service: 'xstockstrat-marketdata',
        environment: 'production',
        trading_mode: 'live',
      },
      {
        key: 'analysis.signals.source_weights',
        description: 'weights',
        default_value: '{}',
        is_secret: false,
        consuming_service: 'xstockstrat-analysis',
        environment: 'dev',
        trading_mode: 'all',
      },
    ];
    const pool: any = {
      query: async () => ({ rows }),
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

  it('reports isSecret truthfully — the guard /config-ui depends on', async () => {
    const res = await listKeys();
    const secret = res.keys.find((k: any) => k.key === 'secret.example.api_key');
    const plain = res.keys.find((k: any) => k.key === 'analysis.signals.source_weights');
    assert.equal(secret.isSecret, true, 'a secret key must arrive flagged');
    assert.equal(plain.isSecret, false);
  });

  it('preserves defaultValue and consumingService', async () => {
    const res = await listKeys();
    const secret = res.keys.find((k: any) => k.key === 'secret.example.api_key');
    assert.equal(secret.defaultValue, 'placeholder');
    assert.equal(secret.consumingService, 'xstockstrat-marketdata');
  });

  it('encodes environment and tradingMode as real enum values, not UNRECOGNIZED', async () => {
    const res = await listKeys();
    const secret = res.keys.find((k: any) => k.key === 'secret.example.api_key');
    const plain = res.keys.find((k: any) => k.key === 'analysis.signals.source_weights');
    assert.equal(secret.environment, 'ENVIRONMENT_PRODUCTION');
    assert.equal(secret.tradingMode, 'TRADING_MODE_LIVE');
    assert.equal(plain.environment, 'ENVIRONMENT_DEV');
  });

  it('populates the validation sub-message for a registered weight key', async () => {
    const res = await listKeys();
    const plain = res.keys.find((k: any) => k.key === 'analysis.signals.source_weights');
    assert.ok(plain.validation, 'validation must survive encoding');
    assert.equal(plain.validation.valueType, 'VALUE_TYPE_FLOAT_MAP');
    assert.ok(Math.abs(plain.validation.maxValue - 1.0) < 1e-6);
  });
});
