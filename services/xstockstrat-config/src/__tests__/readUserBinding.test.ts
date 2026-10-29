/**
 * Read-binding matrix for GetConfig / ListKeys (feature 263): a non-admin caller's foreign body
 * user_id is bound to its own x-user-id; admins and header-less callers keep the body id.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import { HEADER_ACCESS_SCOPE, HEADER_USER_ID, boundReadUserId } from '../grpc/authz';
import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';

const NAMESPACE = 'analysis';
const MAX_DURATION_KEY = 'analysis.backtest.max_duration_seconds';
const SECRET_KEY = 'analysis.vendor.api_key';
const SECRET_PLAINTEXT = 'u-a-plaintext-must-not-leak';
const NON_ADMIN_SCOPE = '11';
const ADMIN_SCOPE_VALUE = '15';

const OVERLAY_ROWS: Record<string, any[]> = {
  'u-a': [
    {
      key: MAX_DURATION_KEY,
      value_type: 'int',
      value_data: '450',
      is_secret: false,
      environment: 'staging',
    },
    {
      key: SECRET_KEY,
      value_type: 'string',
      value_data: SECRET_PLAINTEXT,
      is_secret: true,
      environment: 'staging',
    },
  ],
  'u-b': [
    {
      key: MAX_DURATION_KEY,
      value_type: 'int',
      value_data: '900',
      is_secret: false,
      environment: 'staging',
    },
  ],
};

function md(pairs: Record<string, string>): grpc.Metadata {
  const m = new grpc.Metadata();
  for (const [k, v] of Object.entries(pairs)) m.set(k, v);
  return m;
}

const nonAdminA = () => md({ [HEADER_USER_ID]: 'u-a', [HEADER_ACCESS_SCOPE]: NON_ADMIN_SCOPE });
const adminCaller = () =>
  md({ [HEADER_USER_ID]: 'u-admin', [HEADER_ACCESS_SCOPE]: ADMIN_SCOPE_VALUE });

describe('boundReadUserId', () => {
  it('binds a non-admin caller asking for a foreign id to its own id', () => {
    assert.equal(boundReadUserId({ metadata: nonAdminA() }, 'u-b'), 'u-a');
  });

  it('keeps the body id for an admin caller', () => {
    assert.equal(boundReadUserId({ metadata: adminCaller() }, 'u-b'), 'u-b');
  });

  it('keeps the body id for a header-less caller', () => {
    assert.equal(boundReadUserId({ metadata: new grpc.Metadata() }, 'u-b'), 'u-b');
    assert.equal(boundReadUserId({}, 'u-b'), 'u-b');
  });

  it('keeps an empty body id global, even for a non-admin caller', () => {
    assert.equal(boundReadUserId({ metadata: nonAdminA() }, ''), '');
  });

  it('keeps the caller own id', () => {
    assert.equal(boundReadUserId({ metadata: nonAdminA() }, 'u-a'), 'u-a');
  });

  it('treats an unparseable scope as non-admin (fails closed)', () => {
    const m = md({ [HEADER_USER_ID]: 'u-a', [HEADER_ACCESS_SCOPE]: 'nope' });
    assert.equal(boundReadUserId({ metadata: m }, 'u-b'), 'u-a');
  });
});

describe('GetConfig / ListKeys read binding over a real gRPC connection', () => {
  let server: grpc.Server;
  let client: any;
  let overlayParams: any[] | undefined;
  let overlayQueries = 0;
  let listParams: any[] | undefined;

  before(async () => {
    const pool: any = {
      query: async (sql: string, params?: any[]) => {
        if (sql.includes('DISTINCT ON (key)')) {
          listParams = params;
          return { rows: [] };
        }
        if (sql.includes('WHERE namespace = $1 AND environment = $2 AND user_id = $3')) {
          overlayQueries += 1;
          overlayParams = params;
          return { rows: OVERLAY_ROWS[params?.[2]] ?? [] };
        }
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

  function reset() {
    overlayParams = undefined;
    overlayQueries = 0;
    listParams = undefined;
  }

  function getConfig(metadata: grpc.Metadata, userId: string): Promise<any> {
    return new Promise((resolve, reject) =>
      client.getConfig({ namespace: NAMESPACE, userId }, metadata, (e: any, res: any) =>
        e ? reject(e) : resolve(res),
      ),
    );
  }

  function listKeys(metadata: grpc.Metadata, userId: string): Promise<any> {
    return new Promise((resolve, reject) =>
      client.listKeys({ namespace: NAMESPACE, userId }, metadata, (e: any, res: any) =>
        e ? reject(e) : resolve(res),
      ),
    );
  }

  it('AC-4: a non-admin GetConfig for a foreign id returns the caller own overlay', async () => {
    reset();
    const res = await getConfig(nonAdminA(), 'u-b');
    assert.equal(overlayParams?.[2], 'u-a');
    assert.equal(Number(res.values[MAX_DURATION_KEY].intVal), 450);
    assert.notEqual(Number(res.values[MAX_DURATION_KEY].intVal), 900);
  });

  it('AC-5: a non-admin ListKeys for a foreign id binds to the caller', async () => {
    reset();
    await listKeys(nonAdminA(), 'u-b');
    assert.equal(listParams?.[2], 'u-a');
  });

  it('AC-6: a non-admin asking for its own id reads its own overlay', async () => {
    reset();
    await getConfig(nonAdminA(), 'u-a');
    assert.equal(overlayParams?.[2], 'u-a');
    await listKeys(nonAdminA(), 'u-a');
    assert.equal(listParams?.[2], 'u-a');
  });

  it('AC-8: an admin keeps the body id on both RPCs', async () => {
    reset();
    const res = await getConfig(adminCaller(), 'u-b');
    assert.equal(overlayParams?.[2], 'u-b');
    assert.equal(Number(res.values[MAX_DURATION_KEY].intVal), 900);
    await listKeys(adminCaller(), 'u-b');
    assert.equal(listParams?.[2], 'u-b');
  });

  it('a header-less caller keeps the body id on both RPCs', async () => {
    reset();
    await getConfig(new grpc.Metadata(), 'u-b');
    assert.equal(overlayParams?.[2], 'u-b');
    await listKeys(new grpc.Metadata(), 'u-b');
    assert.equal(listParams?.[2], 'u-b');
  });

  it('an empty body id stays global: no overlay query, ListKeys binds ""', async () => {
    reset();
    await getConfig(nonAdminA(), '');
    assert.equal(overlayQueries, 0, 'the global read must skip the per-user overlay query');
    await listKeys(nonAdminA(), '');
    assert.equal(listParams?.[2], '');
  });

  it('a per-user secret under a bound overlay comes back redacted', async () => {
    reset();
    const res = await getConfig(nonAdminA(), 'u-b');
    const secret = res.values[SECRET_KEY];
    assert.ok(secret, 'the bound overlay must include the caller secret row');
    assert.equal(secret.isSecret, true);
    assert.equal(secret.stringVal, '[redacted]');
    assert.doesNotMatch(JSON.stringify(res), new RegExp(SECRET_PLAINTEXT));
  });

  it('regression pin: a header-carrying non-admin internal caller is bound, not refused', async () => {
    reset();
    const internal = md({
      [HEADER_USER_ID]: 'svc-internal',
      [HEADER_ACCESS_SCOPE]: NON_ADMIN_SCOPE,
    });
    const res = await getConfig(internal, 'u-b');
    assert.ok(res, 'GetConfig must succeed rather than error');
    assert.equal(overlayParams?.[2], 'svc-internal');
    const keys = await listKeys(internal, 'u-b');
    assert.ok(keys, 'ListKeys must succeed rather than error');
    assert.equal(listParams?.[2], 'svc-internal');
  });
});
