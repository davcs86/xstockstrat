import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

import {
  createAdminDirectory,
  ADMIN_LOOKUP_DEADLINE_MS,
  AdminLookupClient,
} from '../services/adminDirectory.js';

describe('adminDirectory test harness', () => {
  it('imports the directory under test', () => {
    assert.ok(
      createAdminDirectory,
      'createAdminDirectory import must succeed — never skip silently',
    );
  });
});

interface RecordedCall {
  md: grpc.Metadata;
  opts: grpc.CallOptions;
  settle: (err: unknown, userIds?: string[]) => void;
}

function fakeClient(): { client: AdminLookupClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client = {
    listAdminUserIds(
      _req: unknown,
      md: grpc.Metadata,
      opts: grpc.CallOptions,
      cb: (err: unknown, resp?: { userIds: string[] }) => void,
    ) {
      calls.push({
        md,
        opts,
        settle: (err, userIds) => (err ? cb(err) : cb(null, { userIds: userIds ?? [] })),
      });
    },
  } as unknown as AdminLookupClient;
  return { client, calls };
}

function inboundMd(): grpc.Metadata {
  const md = new grpc.Metadata();
  md.set('x-user-id', 'u-1');
  md.set('x-access-scope', '7');
  md.set('x-trace-id', 't-1');
  return md;
}

describe('createAdminDirectory', () => {
  it('@AC-8 freshness: every settled lookup re-asks identity (no result cache)', async () => {
    const { client, calls } = fakeClient();
    const dir = createAdminDirectory('identity:50058', client);

    const first = dir.listAdminUserIds(inboundMd());
    calls[0].settle(null, ['user-99']);
    assert.deepEqual(await first, ['user-99']);

    const second = dir.listAdminUserIds(inboundMd());
    calls[1].settle(null, []);
    assert.deepEqual(await second, []);
    assert.equal(calls.length, 2);
  });

  it('single-flight: concurrent callers share one in-flight lookup', async () => {
    const { client, calls } = fakeClient();
    const dir = createAdminDirectory('identity:50058', client);

    const a = dir.listAdminUserIds(inboundMd());
    const b = dir.listAdminUserIds(inboundMd());
    assert.equal(calls.length, 1);
    calls[0].settle(null, ['user-99']);
    const [ra, rb] = await Promise.all([a, b]);
    assert.deepEqual(ra, ['user-99']);
    assert.equal(ra, rb);

    const c = dir.listAdminUserIds(inboundMd());
    assert.equal(calls.length, 2);
    calls[1].settle(null, ['user-99']);
    await c;
  });

  it('applies a fixed deadline and never waitForReady', async () => {
    const { client, calls } = fakeClient();
    const dir = createAdminDirectory('identity:50058', client);

    const before = Date.now();
    const p = dir.listAdminUserIds(inboundMd());
    const deadline = calls[0].opts.deadline;
    const ms = deadline instanceof Date ? deadline.getTime() : Number(deadline);
    assert.ok(ms >= before, `deadline ${ms} before call start ${before}`);
    assert.ok(ms <= Date.now() + ADMIN_LOOKUP_DEADLINE_MS + 50, `deadline ${ms} too far out`);
    assert.equal((calls[0].opts as Record<string, unknown>).waitForReady, undefined);
    calls[0].settle(null, []);
    await p;
  });

  it('relays only the header trio from inbound metadata', async () => {
    const { client, calls } = fakeClient();
    const dir = createAdminDirectory('identity:50058', client);
    const md = inboundMd();
    md.set('authorization', 'Bearer secret');

    const p = dir.listAdminUserIds(md);
    assert.deepEqual(calls[0].md.getMap(), {
      'x-user-id': 'u-1',
      'x-access-scope': '7',
      'x-trace-id': 't-1',
    });
    calls[0].settle(null, []);
    await p;
  });

  it('@AC-11 failure: an identity error rejects and clears the in-flight slot', async () => {
    const { client, calls } = fakeClient();
    const dir = createAdminDirectory('identity:50058', client);

    const p = dir.listAdminUserIds(inboundMd());
    calls[0].settle({ code: 14 });
    await assert.rejects(p, (err: { code?: number }) => err.code === 14);

    const next = dir.listAdminUserIds(inboundMd());
    assert.equal(calls.length, 2);
    calls[1].settle(null, []);
    assert.deepEqual(await next, []);
  });

  it('tolerates get-less or absent inbound metadata', async () => {
    for (const md of [{} as unknown as grpc.Metadata, undefined]) {
      const { client, calls } = fakeClient();
      const dir = createAdminDirectory('identity:50058', client);
      const p = dir.listAdminUserIds(md);
      assert.deepEqual(calls[0].md.getMap(), {});
      calls[0].settle(null, []);
      await p;
    }
  });

  it('@AC-11 missing endpoint: lookups reject with IDENTITY_ENDPOINT unset', async () => {
    const dir = createAdminDirectory('');
    await assert.rejects(dir.listAdminUserIds(inboundMd()), /IDENTITY_ENDPOINT unset/);
  });
});
