// Static import, no skip guard: a load failure must fail the suite, never pass it vacuously.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';
import type { Pool } from 'pg';
import { listAdminUserIds } from '../grpc/adminDirectory.ts';

interface FakePool {
  pool: Pool;
  queries: string[];
}

function fakePool(result: Array<{ user_id: string }> | Error): FakePool {
  const queries: string[] = [];
  const pool = {
    query: async (sql: string) => {
      queries.push(sql);
      if (result instanceof Error) throw result;
      return { rows: result };
    },
  } as unknown as Pool;
  return { pool, queries };
}

function callWith(san?: string, md: Record<string, string> = {}, noAuthContext = false) {
  const metadata = new grpc.Metadata();
  for (const [k, v] of Object.entries(md)) metadata.set(k, v);
  if (noAuthContext) return { metadata };
  return { getAuthContext: () => ({ sslPeerCertificate: { subjectaltname: san } }), metadata };
}

interface Outcome {
  err: grpc.ServiceError | null;
  resp?: { userIds: string[] };
}

async function invoke(pool: Pool, call: ReturnType<typeof callWith>): Promise<Outcome> {
  return new Promise<Outcome>((resolve) => {
    void listAdminUserIds(pool, call, (err, resp) =>
      resolve({ err: (err as grpc.ServiceError | null) ?? null, resp: resp ?? undefined }),
    );
  });
}

const ADMIN_ROWS = [{ user_id: 'user-99' }];
const SPOOF_MD = { 'x-access-scope': '4', 'x-user-id': 'system' };

async function assertDenied(call: ReturnType<typeof callWith>): Promise<void> {
  const fp = fakePool(ADMIN_ROWS);
  const { err, resp } = await invoke(fp.pool, call);
  assert.equal(err?.code, grpc.status.PERMISSION_DENIED);
  assert.equal(resp, undefined);
  assert.equal(fp.queries.length, 0);
}

describe('ListAdminUserIds (SAN-gated, header-blind)', () => {
  it('harness: the handler module loads', () => {
    assert.equal(typeof listAdminUserIds, 'function');
  });

  it('@AC-9: notify peer SAN receives the active admin user IDs only', async () => {
    const fp = fakePool(ADMIN_ROWS);
    const { err, resp } = await invoke(fp.pool, callWith('DNS:xstockstrat-notify'));
    assert.equal(err, null);
    assert.deepEqual(resp?.userIds, ['user-99']);
    assert.deepEqual(Object.keys(resp ?? {}), ['userIds']);
    assert.equal(fp.queries.length, 1);
    assert.match(fp.queries[0], /is_active = true/);
    assert.match(fp.queries[0], /'admin' = ANY\(roles\)/);
  });

  it('@AC-10: a non-notify peer SAN is denied before any DB access', async () => {
    await assertDenied(callWith('DNS:xstockstrat-ui'));
  });

  it('@AC-10: look-alike SANs are denied (exact match only)', async () => {
    await assertDenied(callWith('DNS:xstockstrat-notify.evil'));
    await assertDenied(callWith('DNS:xstockstrat-notifyx'));
  });

  it('@AC-10: a peer certificate without subjectaltname is denied', async () => {
    await assertDenied(callWith(undefined));
  });

  it('@AC-10: a call without an auth context (plaintext) is denied', async () => {
    await assertDenied(callWith(undefined, {}, true));
  });

  it('@AC-10: privileged headers do not grant a non-notify peer access', async () => {
    await assertDenied(callWith('DNS:xstockstrat-ui', SPOOF_MD));
  });

  it('@AC-9: the notify peer response is identical with or without privileged headers', async () => {
    const fp = fakePool(ADMIN_ROWS);
    const { err, resp } = await invoke(fp.pool, callWith('DNS:xstockstrat-notify', SPOOF_MD));
    assert.equal(err, null);
    assert.deepEqual(resp, { userIds: ['user-99'] });
    assert.equal(fp.queries.length, 1);
  });

  it('a DB failure returns a generic INTERNAL without the thrown text', async () => {
    const fp = fakePool(new Error('relation "identity.users" secret-detail'));
    const { err } = await invoke(fp.pool, callWith('DNS:xstockstrat-notify'));
    assert.equal(err?.code, grpc.status.INTERNAL);
    assert.ok(!String(err?.message).includes('secret-detail'));
  });
});
