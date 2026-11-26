/**
 * End-to-end (RPC-level) tests for the internal-caller `SetConfig` path (feature 102 —
 * broker-state-reconciliation), following `setConfigAuthz.test.ts`'s exact loopback-gRPC
 * harness. `internalCallerAuthz.test.ts` (Step 5) already tests `hasInternalCallerAuthority`
 * as a pure function; this file proves it is genuinely wired into the real `setConfig` RPC
 * handler — including the persisted `caller_identity` column and the direction-restriction
 * negative case (`design.md` Open Risk #4: "a negative test asserting an internal-caller write
 * of ACTIVE is rejected must exist before this ships").
 */
import { describe, it, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';
import { transports } from 'winston';

import { HEADER_ACCESS_SCOPE, HEADER_INTERNAL_CALLER, HEADER_USER_ID } from '../grpc/authz';
import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';
import * as mtls from '../mtls';
import { startMtlsLoopback } from './mtlsTestPki';

function md(pairs: Record<string, string>): grpc.Metadata {
  const m = new grpc.Metadata();
  for (const [k, v] of Object.entries(pairs)) m.set(k, v);
  return m;
}

describe('internal-caller SetConfig over a real gRPC connection', () => {
  let server: grpc.Server;
  let client: any;
  let notifyClient: any;
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
        if (sql.includes('SELECT key, is_secret FROM config.config_values')) {
          return { rows: keyExists ? [{ key: params?.[1], is_secret: false }] : [] };
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

    const { port, clients } = await startMtlsLoopback(server, ['xstockstrat-trading', 'xstockstrat-notify']);
    const { ConfigServiceClient } = await import('@xstockstrat/proto/config/v1/config');
    const target = mtls.targetOverride('xstockstrat-config');
    client = new ConfigServiceClient(`127.0.0.1:${port}`, clients['xstockstrat-trading'], target);
    notifyClient = new ConfigServiceClient(`127.0.0.1:${port}`, clients['xstockstrat-notify'], target);
  });

  after(() => {
    client?.close();
    notifyClient?.close();
    server?.forceShutdown();
  });

  function setConfig(metadata: grpc.Metadata, overrides: Record<string, unknown> = {}, c: any = client) {
    const request = {
      namespace: 'platform',
      key: 'trading_state',
      value: { stringVal: 'REDUCE_ONLY' },
      reason: 'reconciliation test',
      ...overrides,
    };
    return new Promise<{ err: any; res: any }>((resolve) => {
      c.setConfig(request, metadata, (err: any, res: any) => resolve({ err, res }));
    });
  }

  it('@AC-2 accepts an internal-caller write of REDUCE_ONLY, with no admin scope, attributed to the caller', async (t) => {
    const out: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    t.mock.method(process.stdout, 'write', (chunk: any, ...rest: any[]) => {
      out.push(String(chunk));
      return write(chunk, ...rest);
    });
    queries = [];
    keyExists = true;
    const { err } = await setConfig(md({ 'x-internal-caller': 'trading-reconciliation-poller' }), {
      author: 'someone-else@example.com',
    });
    assert.equal(err, null, 'internal-caller write must succeed without admin scope');
    const insert = insertQuery();
    assert.ok(insert, 'the INSERT must run');
    // Feature 147 params: [namespace, key, value_type, value_data, value_encrypted, is_secret,
    // updated_by, update_reason, environment, user_id, caller_identity].
    assert.equal(insert!.params?.[10], 'trading-reconciliation-poller');
    assert.equal(insert!.params?.[6], 'trading-reconciliation-poller');
    assert.equal(insert!.params?.[1], 'trading_state');
    assert.ok(!out.some((l) => /canonicalis/i.test(l)), 'no rewrite line is logged');
  });

  it('306 @AC-3 a prefixed poller key is INVALID_ARGUMENT and writes nothing', async () => {
    queries = [];
    keyExists = true;
    const { err } = await setConfig(md({ 'x-internal-caller': 'trading-reconciliation-poller' }), {
      key: 'platform.trading_state',
    });
    assert.equal(err?.code, grpc.status.INVALID_ARGUMENT);
    assert.equal(insertQuery(), undefined);
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
    const { err } = await setConfig(md({ 'x-internal-caller': 'some-unlisted-caller' }), {
      key: 'trading_state',
    });
    assert.ok(err);
    assert.equal(err.code, grpc.status.PERMISSION_DENIED);
    assert.equal(insertQuery(), undefined);
  });

  it('rejects a call with neither admin scope nor an internal-caller header (pre-existing behavior unaffected)', async () => {
    queries = [];
    const { err } = await setConfig(md({}), { key: 'trading_state' });
    assert.ok(err);
    assert.equal(err.code, grpc.status.PERMISSION_DENIED);
    assert.equal(insertQuery(), undefined);
  });

  it('an ordinary admin write to a different key leaves caller_identity unset', async () => {
    queries = [];
    keyExists = true;
    const { err } = await setConfig(md({ [HEADER_ACCESS_SCOPE]: '7', [HEADER_USER_ID]: 'admin-7' }), {
      namespace: 'platform',
      key: 'log_level',
      value: { stringVal: 'debug' },
    });
    assert.equal(err, null, 'admin write must succeed');
    const insert = insertQuery();
    assert.ok(insert);
    assert.equal(insert!.params?.[10], null, 'a normal human write must not populate caller_identity');
  });

  function captureLogs(t: TestContext): Array<Record<string | symbol, unknown>> {
    const records: Array<Record<string | symbol, unknown>> = [];
    t.mock.method(transports.Console.prototype, 'log', (info: any, cb?: () => void) => {
      records.push(info);
      cb?.();
    });
    return records;
  }

  it('@AC-1 (319) denies the poller header from a peer without the trading SAN, and writes nothing', async (t) => {
    const logs = captureLogs(t);
    const poller = md({ [HEADER_INTERNAL_CALLER]: 'trading-reconciliation-poller' });
    queries = [];
    keyExists = true;
    const denied = await setConfig(poller, { value: { stringVal: 'HALTED' } }, notifyClient);
    assert.equal(denied.err?.code, grpc.status.PERMISSION_DENIED);
    assert.equal(queries.length, 0, 'no INSERT (and so no audit row) for a denied call');

    const denials = logs.filter((r) => String(r.message).startsWith('SetConfig denied'));
    assert.equal(denials.length, 1, JSON.stringify(logs));
    const [d] = denials;
    assert.equal(d[Symbol.for('level')], 'error');
    assert.equal(d.hadPeerSan, true);
    assert.equal(d.peerSan, 'xstockstrat-notify');
    assert.equal(d.targetState, 'HALTED');
    const fields = Object.keys(d).filter((k) => !['level', 'message', 'service'].includes(k));
    assert.deepEqual(fields.sort(), [
      'hadPeerSan',
      'internalCaller',
      'key',
      'namespace',
      'peerSan',
      'reason',
      'targetState',
    ]);

    queries = [];
    const allowed = await setConfig(poller, { value: { stringVal: 'HALTED' } }, client);
    assert.equal(allowed.err, null, 'the same request from the trading leaf succeeds');
    const insert = insertQuery();
    assert.ok(insert);
    assert.equal(insert!.params?.[6], 'trading-reconciliation-poller');
    assert.equal(insert!.params?.[10], 'trading-reconciliation-poller');
  });

  it('an admin write carrying a forged x-internal-caller is attributed to the admin, caller_identity unset', async () => {
    queries = [];
    keyExists = true;
    const { err } = await setConfig(
      md({
        [HEADER_ACCESS_SCOPE]: '7',
        [HEADER_USER_ID]: 'admin-7',
        [HEADER_INTERNAL_CALLER]: 'trading-reconciliation-poller',
      }),
      { namespace: 'platform', key: 'log_level', value: { stringVal: 'debug' } },
      notifyClient,
    );
    assert.equal(err, null, 'admin write must succeed');
    const insert = insertQuery();
    assert.ok(insert);
    assert.equal(insert!.params?.[6], 'admin-7');
    assert.equal(insert!.params?.[10], null, 'an unauthorized x-internal-caller is never persisted');
  });
});
