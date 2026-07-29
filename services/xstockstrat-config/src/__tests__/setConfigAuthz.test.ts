/**
 * Authorization tests for ConfigServiceImpl.setConfig (feature 074).
 *
 * Two layers, deliberately:
 *
 *  1. Unit cases over `hasAdminAccessScope` — bitmask semantics, fail-closed defaults.
 *  2. An in-process **loopback gRPC** suite: a real grpc.Server, the real service
 *     definition, the real impl, dialled over a real socket by the generated client
 *     with real Metadata.
 *
 * Layer 2 exists because layer 1 alone would be a consumer-contract demonstration
 * offered as producer-contract evidence: constructing a Metadata by hand and passing
 * it to the helper proves what the helper does *given* a Metadata — it proves nothing
 * about whether grpc-js actually delivers one at `call.metadata`. If that assumption
 * were wrong the gate would deny every admin write (a total config-write outage), and
 * no hand-built test could catch it. See docs/roadmap/ledger/fails.md 2026-07-27.
 *
 * The pool stub RECORDS queries, so a denied call asserts zero queries — direct
 * evidence that neither the INSERT nor the pg_notify broadcast ran.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import {
  ADMIN_SCOPE,
  HEADER_ACCESS_SCOPE,
  HEADER_USER_ID,
  hasAdminAccessScope,
  userIdFrom,
} from '../grpc/authz';
import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';

describe('test harness', () => {
  it('imports the implementation under test', () => {
    assert.ok(ConfigServiceImpl, 'ConfigServiceImpl must import — never skip silently');
    assert.ok(createConfigServiceDefinition, 'service definition must import');
  });
});

function md(pairs: Record<string, string>): grpc.Metadata {
  const m = new grpc.Metadata();
  for (const [k, v] of Object.entries(pairs)) m.set(k, v);
  return m;
}

describe('hasAdminAccessScope', () => {
  it('accepts the exact admin bit', () => {
    assert.equal(hasAdminAccessScope(md({ [HEADER_ACCESS_SCOPE]: '4' })), true);
  });

  it('accepts a scope that merely contains the admin bit (bitmask, not equality)', () => {
    assert.equal(hasAdminAccessScope(md({ [HEADER_ACCESS_SCOPE]: '7' })), true);
    assert.equal(ADMIN_SCOPE, 4);
  });

  it('denies a scope without the admin bit', () => {
    assert.equal(hasAdminAccessScope(md({ [HEADER_ACCESS_SCOPE]: '3' })), false);
    assert.equal(hasAdminAccessScope(md({ [HEADER_ACCESS_SCOPE]: '0' })), false);
  });

  it('fails closed on an absent header, absent metadata, and garbage', () => {
    assert.equal(hasAdminAccessScope(md({})), false);
    assert.equal(hasAdminAccessScope(undefined), false);
    assert.equal(hasAdminAccessScope(md({ [HEADER_ACCESS_SCOPE]: 'abc' })), false);
  });

  it('reads the propagated caller id, defaulting to empty', () => {
    assert.equal(userIdFrom(md({ [HEADER_USER_ID]: 'u-1' })), 'u-1');
    assert.equal(userIdFrom(md({})), '');
    assert.equal(userIdFrom(undefined), '');
  });
});

describe('SetConfig authorization over a real gRPC connection', () => {
  let server: grpc.Server;
  let client: any;
  let queries: { sql: string; params?: unknown[] }[] = [];

  before(async () => {
    // Records every query so a denied call can assert that NOTHING was written.
    const recordingPool: any = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [] };
      },
      connect: async () => ({ query: async () => {}, on: () => {} }),
    };

    server = new grpc.Server();
    // Same cast production uses in src/index.ts, so handler-name mapping and `this`
    // binding are exercised exactly as shipped.
    server.addService(
      createConfigServiceDefinition(),
      new ConfigServiceImpl(recordingPool) as unknown as grpc.UntypedServiceImplementation,
    );

    const port: number = await new Promise((resolve, reject) => {
      // Port 0 → kernel picks a free port, so parallel runs cannot collide.
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

  /** Promise wrapper so each case can await one unary call with explicit metadata. */
  function setConfig(metadata: grpc.Metadata, overrides: Record<string, unknown> = {}) {
    const request = {
      namespace: 'platform',
      key: 'platform.log_level',
      value: { stringVal: 'debug' },
      author: 'tester',
      reason: 'authz test',
      ...overrides,
    };
    return new Promise<{ err: any; res: any }>((resolve) => {
      client.setConfig(request, metadata, (err: any, res: any) => resolve({ err, res }));
    });
  }

  it('denies a call carrying no metadata at all, and writes nothing', async () => {
    queries = [];
    const { err } = await setConfig(new grpc.Metadata());
    assert.ok(err, 'expected a gRPC error');
    assert.equal(err.code, grpc.status.PERMISSION_DENIED);
    assert.match(err.details ?? err.message, /admin scope required/);
    assert.equal(queries.length, 0, 'no INSERT and no pg_notify may run on a denied call');
  });

  it('denies a non-admin scope, and writes nothing', async () => {
    queries = [];
    const { err } = await setConfig(md({ [HEADER_ACCESS_SCOPE]: '3' }));
    assert.ok(err);
    assert.equal(err.code, grpc.status.PERMISSION_DENIED);
    assert.equal(queries.length, 0);
  });

  it('allows an admin caller and performs the write', async () => {
    queries = [];
    const { err } = await setConfig(md({ [HEADER_ACCESS_SCOPE]: '7' }));
    assert.equal(err, null, 'admin write must succeed');
    assert.ok(queries.length >= 1, 'the INSERT must run for an authorized caller');
    // params[4] is `updated_by` in the INSERT's parameter list.
    assert.equal(queries[0].params?.[4], 'tester');
  });

  it('falls back to the propagated x-user-id when no author is supplied', async () => {
    queries = [];
    const { err } = await setConfig(md({ [HEADER_ACCESS_SCOPE]: '4', [HEADER_USER_ID]: 'u-42' }), {
      author: '',
    });
    assert.equal(err, null);
    assert.equal(queries[0].params?.[4], 'u-42', 'updated_by falls back to the caller id');
  });

  it('refuses an unattributable write (no author, no x-user-id)', async () => {
    queries = [];
    const { err } = await setConfig(md({ [HEADER_ACCESS_SCOPE]: '4' }), { author: '' });
    assert.ok(err);
    assert.equal(err.code, grpc.status.INVALID_ARGUMENT);
    assert.equal(queries.length, 0, 'an anonymous write must not reach config_audit');
  });

  // NOTE: these cases deliberately assert only on authz outcome, author resolution and
  // query count. They must NOT assert on environment/trading_mode: over the real wire
  // ts-proto sends camelCase with string enums, while the impl reads
  // `call.request.trading_mode` against a numeric map — a pre-existing logged defect
  // (docs/context-constitution-findings.md). Tripping over it here would couple this
  // security test to an unrelated bug.
});
