/**
 * End-to-end (RPC-level) tests for the internal-caller `SetConfig` path (feature 102 —
 * broker-state-reconciliation), following `setConfigAuthz.test.ts`'s exact loopback-gRPC
 * harness. `internalCallerAuthz.test.ts` (Step 5) already tests `hasInternalCallerAuthority`
 * as a pure function; this file proves it is genuinely wired into the real `setConfig` RPC
 * handler — including the persisted `caller_identity` column and the direction-restriction
 * negative case (`design.md` Open Risk #4: "a negative test asserting an internal-caller write
 * of ACTIVE is rejected must exist before this ships").
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import { HEADER_ACCESS_SCOPE } from '../grpc/authz';
import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';

function md(pairs: Record<string, string>): grpc.Metadata {
  const m = new grpc.Metadata();
  for (const [k, v] of Object.entries(pairs)) m.set(k, v);
  return m;
}

describe('internal-caller SetConfig over a real gRPC connection', () => {
  let server: grpc.Server;
  let client: any;
  let queries: { sql: string; params?: unknown[] }[] = [];
  let keyExists = true;

  function insertQuery() {
    return queries.find((q) => q.sql.includes('INSERT INTO config.config_values'));
  }

  before(async () => {
    const recordingPool: any = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        // Feature 147: existence gate reads is_secret.
        if (sql.includes('SELECT is_secret FROM config.config_values')) {
          return { rows: keyExists ? [{ is_secret: false }] : [] };
        }
        return { rows: [] };
      },
      connect: async () => ({ query: async () => {}, on: () => {} }),
    };

    server = new grpc.Server();
    server.addService(
      createConfigServiceDefinition(),
      new ConfigServiceImpl(recordingPool) as unknown as grpc.UntypedServiceImplementation,
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

  function setConfig(metadata: grpc.Metadata, overrides: Record<string, unknown> = {}) {
    const request = {
      namespace: 'platform',
      key: 'trading_state',
      value: { stringVal: 'REDUCE_ONLY' },
      author: 'system:reconciliation-poller',
      reason: 'reconciliation test',
      ...overrides,
    };
    return new Promise<{ err: any; res: any }>((resolve) => {
      client.setConfig(request, metadata, (err: any, res: any) => resolve({ err, res }));
    });
  }

  it('accepts an internal-caller write of REDUCE_ONLY, with no admin scope, and persists caller_identity', async () => {
    queries = [];
    keyExists = true;
    const { err } = await setConfig(md({ 'x-internal-caller': 'trading-reconciliation-poller' }));
    assert.equal(err, null, 'internal-caller write must succeed without admin scope');
    const insert = insertQuery();
    assert.ok(insert, 'the INSERT must run');
    // Feature 147 params: [namespace, key, value_type, value_data, value_encrypted, is_secret,
    // updated_by, update_reason, environment, user_id, caller_identity].
    assert.equal(insert!.params?.[10], 'trading-reconciliation-poller');
  });

  it('accepts the same caller writing HALTED', async () => {
    queries = [];
    keyExists = true;
    const { err } = await setConfig(md({ 'x-internal-caller': 'trading-reconciliation-poller' }), {
      value: { stringVal: 'HALTED' },
    });
    assert.equal(err, null);
    assert.ok(insertQuery());
  });

  it('rejects the same caller writing ACTIVE — direction restriction — and writes nothing', async () => {
    queries = [];
    const { err } = await setConfig(md({ 'x-internal-caller': 'trading-reconciliation-poller' }), {
      value: { stringVal: 'ACTIVE' },
    });
    assert.ok(err, 'expected a gRPC error');
    assert.equal(err.code, grpc.status.PERMISSION_DENIED);
    assert.equal(insertQuery(), undefined, 'no INSERT may run for a direction-restricted write');
  });

  it('rejects an unlisted internal-caller id, and writes nothing', async () => {
    queries = [];
    const { err } = await setConfig(md({ 'x-internal-caller': 'some-unlisted-caller' }));
    assert.ok(err);
    assert.equal(err.code, grpc.status.PERMISSION_DENIED);
    assert.equal(insertQuery(), undefined);
  });

  it('rejects a call with neither admin scope nor an internal-caller header (pre-existing behavior unaffected)', async () => {
    queries = [];
    const { err } = await setConfig(md({}));
    assert.ok(err);
    assert.equal(err.code, grpc.status.PERMISSION_DENIED);
    assert.equal(insertQuery(), undefined);
  });

  it('an ordinary admin write to a different key leaves caller_identity unset', async () => {
    queries = [];
    keyExists = true;
    const { err } = await setConfig(md({ [HEADER_ACCESS_SCOPE]: '7' }), {
      namespace: 'platform',
      key: 'log_level',
      value: { stringVal: 'debug' },
      author: 'tester',
    });
    assert.equal(err, null, 'admin write must succeed');
    const insert = insertQuery();
    assert.ok(insert);
    assert.equal(insert!.params?.[10], null, 'a normal human write must not populate caller_identity');
  });
});
