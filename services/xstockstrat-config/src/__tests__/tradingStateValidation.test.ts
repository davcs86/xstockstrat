/**
 * Write-time validation tests for `platform.trading_state` (feature 100).
 *
 * Same in-process loopback gRPC harness as `setConfigAuthz.test.ts` — a real grpc.Server,
 * the real service definition, the real impl, dialled by the generated client with real
 * Metadata — so the guard is proven end-to-end over the wire, not just as a hand-called
 * function (see docs/roadmap/ledger/fails.md 2026-07-27, the same rationale that harness
 * file documents). The recording pool returns a row for the existence SELECT so every case
 * here reaches the new guard in front of an already-registered key, not confounded by the
 * unrelated existence gate (feature 091).
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

describe('platform.trading_state write-time validation', () => {
  let server: grpc.Server;
  let client: any;
  let queries: { sql: string; params?: unknown[] }[] = [];

  function insertQuery() {
    return queries.find((q) => q.sql.includes('INSERT INTO config.config_values'));
  }

  before(async () => {
    // The key is always registered here — every case exercises the new validation guard,
    // not the unrelated existence gate (feature 091).
    const recordingPool: any = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        // Feature 147: existence gate reads is_secret.
        if (sql.includes('SELECT is_secret FROM config.config_values')) {
          return { rows: [{ is_secret: false }] };
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

  function setConfig(stringVal: string) {
    const request = {
      namespace: 'platform',
      key: 'trading_state',
      value: { stringVal },
      author: 'tester',
      reason: 'trading state validation test',
    };
    const metadata = md({ [HEADER_ACCESS_SCOPE]: '7' }); // admin scope
    return new Promise<{ err: any; res: any }>((resolve) => {
      client.setConfig(request, metadata, (err: any, res: any) => resolve({ err, res }));
    });
  }

  it('accepts HALTED', async () => {
    queries = [];
    const { err } = await setConfig('HALTED');
    assert.equal(err, null);
    assert.ok(insertQuery(), 'the INSERT must run for a valid literal');
  });

  it('accepts REDUCE_ONLY', async () => {
    queries = [];
    const { err } = await setConfig('REDUCE_ONLY');
    assert.equal(err, null);
    assert.ok(insertQuery());
  });

  it('accepts ACTIVE', async () => {
    queries = [];
    const { err } = await setConfig('ACTIVE');
    assert.equal(err, null);
    assert.ok(insertQuery());
  });

  it('rejects an invalid literal with INVALID_ARGUMENT and writes nothing', async () => {
    queries = [];
    const { err } = await setConfig('PAUSED');
    assert.ok(err, 'expected a gRPC error for an invalid literal');
    assert.equal(err.code, grpc.status.INVALID_ARGUMENT);
    assert.match(err.details ?? err.message, /must be one of ACTIVE, REDUCE_ONLY, HALTED/);
    assert.equal(insertQuery(), undefined, 'no INSERT may run for an invalid literal');
  });

  it('rejects an empty string and writes nothing', async () => {
    queries = [];
    const { err } = await setConfig('');
    assert.ok(err, 'expected a gRPC error for an empty literal');
    assert.equal(err.code, grpc.status.INVALID_ARGUMENT);
    assert.equal(insertQuery(), undefined);
  });

  it('does not affect writes to a different key', async () => {
    queries = [];
    const request = {
      namespace: 'platform',
      key: 'log_level',
      value: { stringVal: 'anything' },
      author: 'tester',
      reason: 'unaffected-key test',
    };
    const { err } = await new Promise<{ err: any; res: any }>((resolve) => {
      client.setConfig(request, md({ [HEADER_ACCESS_SCOPE]: '7' }), (err: any, res: any) =>
        resolve({ err, res }),
      );
    });
    assert.equal(err, null, 'a write to a different key must be unaffected by the new guard');
    assert.ok(insertQuery());
  });
});
