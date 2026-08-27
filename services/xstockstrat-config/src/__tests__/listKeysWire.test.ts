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
        value_data: 'secret://vault/example-api-key',
        is_secret: true,
        consuming_service: 'xstockstrat-marketdata',
        environment: 'production',
      },
      {
        // feature 161: the DB `key` column is namespace-stripped (namespace 'analysis' is a
        // separate column), so the scalar-bounds registry lookup must reconstruct the full path
        // `${namespace}.${key}`. Storing the SPLIT form here is what makes this fixture
        // representative — the former full-path fixture masked the `[r.key]` lookup bug.
        key: 'scoring.signal_decay_half_life_hours',
        description: 'Exponential age-decay half-life in hours; 0 disables. Bounds [0, 8760].',
        default_value: '24.0',
        value_data: '48.0',
        is_secret: false,
        consuming_service: 'xstockstrat-analysis',
        environment: 'staging',
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
      // namespace 'analysis' so the decay row's registry lookup (`${namespace}.${key}`) resolves.
      client.listKeys({ namespace: 'analysis' }, (err: any, res: any) =>
        err ? reject(err) : resolve(res),
      );
    });
  }

  it('reports isSecret truthfully — the guard /config-ui depends on', async () => {
    const res = await listKeys();
    const secret = res.keys.find((k: any) => k.key === 'secret.example.api_key');
    const plain = res.keys.find((k: any) => k.key === 'scoring.signal_decay_half_life_hours');
    assert.equal(secret.isSecret, true, 'a secret key must arrive flagged');
    assert.equal(plain.isSecret, false);
  });

  it('preserves defaultValue and consumingService', async () => {
    const res = await listKeys();
    const secret = res.keys.find((k: any) => k.key === 'secret.example.api_key');
    assert.equal(secret.defaultValue, 'placeholder');
    assert.equal(secret.consumingService, 'xstockstrat-marketdata');
  });

  it('reports currentValue from value_data, distinct from the defaultValue seed metadata', async () => {
    // Regression: currentValue used to be absent entirely, so config-ui had no way to show
    // (or re-edit) a key's live value — only its never-updated seed default (CONFIG-2).
    const res = await listKeys();
    const plain = res.keys.find((k: any) => k.key === 'scoring.signal_decay_half_life_hours');
    assert.equal(plain.currentValue, '48.0');
    assert.notEqual(plain.currentValue, plain.defaultValue);
  });

  it('encodes environment as a real enum value, not UNRECOGNIZED', async () => {
    // Feature 147: trading_mode is no longer emitted; environment is production/staging.
    const res = await listKeys();
    const secret = res.keys.find((k: any) => k.key === 'secret.example.api_key');
    const plain = res.keys.find((k: any) => k.key === 'scoring.signal_decay_half_life_hours');
    assert.equal(secret.environment, 'ENVIRONMENT_PRODUCTION');
    assert.equal(plain.environment, 'ENVIRONMENT_STAGING');
  });

  it('populates FLOAT_SCALAR validation for the registered decay key (AC-6)', async () => {
    // feature 161: the scalar-bounds registry is keyed on the FULL path; ListKeys must emit the
    // bounds so config-ui renders them. The DB `key` column is the split form, so this only passes
    // when the handler reconstructs `${namespace}.${key}` — the reviewer-flagged fix.
    const res = await listKeys();
    const plain = res.keys.find((k: any) => k.key === 'scoring.signal_decay_half_life_hours');
    assert.ok(plain.validation, 'validation must survive encoding');
    assert.equal(plain.validation.valueType, 'VALUE_TYPE_FLOAT_SCALAR');
    assert.ok(Math.abs(plain.validation.minValue - 0) < 1e-6);
    assert.ok(Math.abs(plain.validation.maxValue - 8760) < 1e-6);
    assert.equal(plain.defaultValue, '24.0');
  });

  it('no longer surfaces the removed analysis.signals.source_weights key (AC-8)', async () => {
    // feature 161 / migration 020: the dead FLOAT_MAP key is gone; it must not appear, and no key
    // may carry FLOAT_MAP validation any more (the emit branch was removed).
    const res = await listKeys();
    assert.equal(
      res.keys.find((k: any) => k.key === 'signals.source_weights' || k.key === 'analysis.signals.source_weights'),
      undefined,
    );
    assert.equal(
      res.keys.some((k: any) => k.validation?.valueType === 'VALUE_TYPE_FLOAT_MAP'),
      false,
    );
  });
});
