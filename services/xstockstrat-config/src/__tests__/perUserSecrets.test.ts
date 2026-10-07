/**
 * Feature 224 (FR-14, AC-35): per-user secrets in xstockstrat-config.
 *
 * Covers per-user secret writes (owner-only, encrypted at rest), exact-scope GetSecret resolution,
 * per-user redaction on GetConfig/ListKeys/WatchConfig, and the SAN-bound ingest GetSecret grant.
 * Direct handler calls over an in-memory config_values table keyed like the unique index.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';
import type { Pool } from 'pg';

process.env.CONFIG_SECRETS_ENCRYPTION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { HEADER_ACCESS_SCOPE, HEADER_INTERNAL_CALLER, HEADER_USER_ID } from '../grpc/authz';

const ALICE = 'user-alice';
const BOB = 'user-bob';
const KEY_A = 'mcp_credential.5b0e7c1a-1f7e-4a8e-9a43-0d3f6b2c9e11';
const KEY_B = 'mcp_credential.c2d4e6f8-3a5b-4c7d-8e9f-a1b2c3d4e5f6';
const TOK_A = 'tok-a';
const TOK_B = 'tok-b';
const ENV_PROD = 2;
const INGEST_SAN = 'DNS:xstockstrat-ingest';

interface Row {
  namespace: string;
  key: string;
  value_type: string;
  value_data: string;
  value_encrypted: Buffer | null;
  is_secret: boolean;
  description: string;
  default_value: string;
  environment: string;
  user_id: string | null;
  consuming_service: string;
  updated_at: Date;
}

type InsertParams = [string, string, string, string, Buffer | null, boolean, string, string, string, string | null, string | null];

interface RpcErr { code: number; message: string }
interface RpcRes {
  found?: boolean;
  value?: string;
  values?: Record<string, { stringVal?: string; isSecret?: boolean }>;
  keys?: Array<{ key: string; currentValue: string; isSecret: boolean }>;
}
type Handler = (call: object, cb: (err: RpcErr | null, res: RpcRes) => void) => Promise<void>;
type AuthContextFn = () => { sslPeerCertificate?: { subjectaltname?: string } };

/** In-memory config.config_values honouring the (namespace, key, environment, COALESCE(user_id,'')) index. */
function makeStorePool(store: Map<string, Row>, inserts: InsertParams[]): Pool {
  const id = (ns: string, key: string, env: string, uid: string | null) => `${ns}|${key}|${env}|${uid ?? ''}`;
  const rows = () => [...store.values()];
  return {
    query: async (sql: string, params: unknown[] = []) => {
      const p = params as string[];
      if (sql.includes('INSERT INTO config.config_values')) {
        const ins = params as InsertParams;
        inserts.push(ins);
        const [namespace, key, value_type, value_data, value_encrypted, is_secret, , , environment, user_id] = ins;
        store.set(id(namespace, key, environment, user_id), {
          namespace, key, value_type, value_data, value_encrypted, is_secret, environment, user_id,
          description: '', default_value: '', consuming_service: 'xstockstrat-ingest', updated_at: new Date(),
        });
        return { rows: [] };
      }
      if (sql.includes('pg_notify')) return { rows: [] };
      if (sql.includes('SELECT is_secret FROM') || sql.includes('SELECT value_encrypted FROM')) {
        let uid: string | null;
        if (sql.includes("COALESCE(user_id,'') = COALESCE($4,'')")) uid = p[3] || null;
        else if (sql.includes('user_id = $4')) uid = p[3];
        else if (sql.includes('user_id IS NULL')) uid = null;
        else throw new Error(`unrecognised scope in: ${sql}`);
        const r = store.get(id(p[0], p[1], p[2], uid));
        return { rows: r ? [r] : [] };
      }
      if (sql.includes('DISTINCT ON (key)')) {
        const scoped = rows().filter(
          (r) => r.namespace === p[0] && r.environment === p[1] && (r.user_id === null || r.user_id === p[2]),
        );
        const byKey = new Map<string, Row>();
        for (const r of scoped) if (!byKey.has(r.key) || r.user_id !== null) byKey.set(r.key, r);
        return { rows: [...byKey.values()] };
      }
      if (sql.includes('user_id = $3')) {
        return { rows: rows().filter((r) => r.namespace === p[0] && r.environment === p[1] && r.user_id === p[2]) };
      }
      if (sql.includes('user_id IS NULL')) {
        return { rows: rows().filter((r) => r.user_id === null && (p.length === 0 || (r.namespace === p[0] && r.environment === p[1]))) };
      }
      return { rows: [] };
    },
    connect: async () => ({ query: async () => {}, on: () => {} }),
  } as unknown as Pool;
}

function md(pairs: Record<string, string>): grpc.Metadata {
  const m = new grpc.Metadata();
  for (const [k, v] of Object.entries(pairs)) m.set(k, v);
  return m;
}

function invoke(fn: Handler, call: object): Promise<{ err: RpcErr | null; res: RpcRes }> {
  return new Promise((resolve) => {
    void fn(call, (err, res) => resolve({ err, res }));
  });
}

describe('per-user secrets (feature 224 FR-14)', () => {
  let store: Map<string, Row>;
  let inserts: InsertParams[];
  let impl: ConfigServiceImpl;

  const setSecret = (callerUserId: string, targetUserId: string, key: string, plaintext: string) =>
    invoke(impl.setConfig.bind(impl), {
      request: {
        namespace: 'ingest', key, value: { stringVal: plaintext, isSecret: true },
        environment: ENV_PROD, userId: targetUserId, createKey: true, reason: 'mcp bearer',
      },
      metadata: md({ [HEADER_USER_ID]: callerUserId }),
    });

  const getSecret = (
    request: Record<string, unknown>,
    callerID: string,
    authContext: AuthContextFn | undefined,
  ) =>
    invoke(impl.getSecret.bind(impl), {
      request: { environment: ENV_PROD, ...request },
      metadata: md({ [HEADER_INTERNAL_CALLER]: callerID }),
      getAuthContext: authContext,
    });

  const ingestPeer = () => ({ sslPeerCertificate: { subjectaltname: INGEST_SAN } });

  beforeEach(async () => {
    store = new Map();
    inserts = [];
    impl = new ConfigServiceImpl(makeStorePool(store, inserts));
  });

  it('AC-35: an owner per-user secret write is accepted and stored as ciphertext + [redacted]', async () => {
    const { err } = await setSecret(ALICE, ALICE, KEY_A, TOK_A);
    assert.equal(err, null, `per-user secret write must be accepted, got: ${err?.message}`);
    const p = inserts[inserts.length - 1];
    assert.equal(p[3], '[redacted]', 'value_data must be the redaction sentinel');
    assert.equal(p[5], true, 'is_secret must be true');
    assert.equal(p[9], ALICE, 'row must be scoped to the owner');
    const ct = p[4] as Buffer;
    assert.ok(Buffer.isBuffer(ct) && ct.length > 0, 'value_encrypted must hold ciphertext');
    assert.ok(!ct.toString('latin1').includes(TOK_A), 'ciphertext must not contain the plaintext');
  });

  it('a non-owner writing another user\'s per-user secret is PERMISSION_DENIED', async () => {
    const { err } = await setSecret(BOB, ALICE, KEY_A, TOK_B);
    assert.equal(err?.code, grpc.status.PERMISSION_DENIED);
    assert.equal(inserts.length, 0);
  });

  describe('with alice and bob each holding a per-user secret', () => {
    beforeEach(async () => {
      assert.equal((await setSecret(ALICE, ALICE, KEY_A, TOK_A)).err, null);
      assert.equal((await setSecret(BOB, BOB, KEY_B, TOK_B)).err, null);
    });

    it('GetSecret resolves each owner\'s secret with exact scope', async () => {
      const a = await getSecret({ namespace: 'ingest', key: KEY_A, userId: ALICE }, 'ingest', ingestPeer);
      assert.equal(a.err, null);
      assert.deepEqual([a.res.found, a.res.value], [true, TOK_A]);
      const b = await getSecret({ namespace: 'ingest', key: KEY_B, userId: BOB }, 'ingest', ingestPeer);
      assert.equal(b.err, null);
      assert.deepEqual([b.res.found, b.res.value], [true, TOK_B]);
    });

    it('GetSecret never falls back across scopes (empty user_id or another user → found:false)', async () => {
      const global = await getSecret({ namespace: 'ingest', key: KEY_A, userId: '' }, 'ingest', ingestPeer);
      assert.equal(global.err, null);
      assert.deepEqual([global.res.found, global.res.value], [false, '']);
      const cross = await getSecret({ namespace: 'ingest', key: KEY_A, userId: BOB }, 'ingest', ingestPeer);
      assert.equal(cross.err, null);
      assert.deepEqual([cross.res.found, cross.res.value], [false, '']);
    });

    it('ingest GetSecret without the xstockstrat-ingest peer SAN is PERMISSION_DENIED', async () => {
      const req = { namespace: 'ingest', key: KEY_A, userId: ALICE };
      const otherSan = await getSecret(req, 'ingest', () => ({ sslPeerCertificate: { subjectaltname: 'DNS:xstockstrat-client' } }));
      assert.equal(otherSan.err?.code, grpc.status.PERMISSION_DENIED);
      const noPeer = await getSecret(req, 'ingest', () => ({}));
      assert.equal(noPeer.err?.code, grpc.status.PERMISSION_DENIED);
      const noAuthContext = await getSecret(req, 'ingest', undefined);
      assert.equal(noAuthContext.err?.code, grpc.status.PERMISSION_DENIED);
    });

    it('per-user secrets stay [redacted] on GetConfig/ListKeys/WatchConfig for alice, bob, and an admin', async () => {
      const readers = [
        { userId: ALICE, ownKey: KEY_A },
        { userId: BOB, ownKey: KEY_B },
        { userId: '', ownKey: undefined }, // admin / global reader
      ];
      for (const { userId, ownKey } of readers) {
        const meta = md(userId ? { [HEADER_USER_ID]: userId } : { [HEADER_ACCESS_SCOPE]: '4' });
        const cfg = await invoke(impl.getConfig.bind(impl), {
          request: { namespace: 'ingest', environment: ENV_PROD, userId }, metadata: meta,
        });
        const keys = await invoke(impl.listKeys.bind(impl), {
          request: { namespace: 'ingest', environment: ENV_PROD, userId }, metadata: meta,
        });
        const writes: RpcRes[] = [];
        impl.watchConfig({
          request: { namespace: 'ingest', client_id: 'c', environment: ENV_PROD, userId },
          metadata: meta, on: () => {}, write: (w: RpcRes) => writes.push(w),
        });
        await new Promise((r) => setTimeout(r, 20)); // initial snapshot is sent async
        assert.equal(writes.length, 1, 'watcher must receive the initial snapshot');

        for (const out of [cfg.res, keys.res, writes[0]]) {
          const s = JSON.stringify(out);
          assert.ok(!s.includes(TOK_A) && !s.includes(TOK_B), `plaintext leaked to ${userId || 'admin'}: ${s}`);
        }
        if (ownKey) {
          assert.equal(cfg.res.values?.[ownKey]?.stringVal, '[redacted]');
          assert.equal(cfg.res.values?.[ownKey]?.isSecret, true);
          assert.equal(writes[0].values?.[ownKey]?.stringVal, '[redacted]');
          const lk = keys.res.keys?.find((k) => k.key === ownKey);
          assert.equal(lk?.currentValue, '[redacted]');
          assert.equal(lk?.isSecret, true);
        }
      }
    });
  });

  it('marketdata exact-key GetSecret is unchanged: no SAN required, global scope resolves', async () => {
    const write = await invoke(impl.setConfig.bind(impl), {
      request: {
        namespace: 'marketdata', key: 'alpaca.api_key', value: { stringVal: 'alpaca-xyz', isSecret: true },
        environment: ENV_PROD, createKey: true, author: 'op', reason: 'seed',
      },
      metadata: md({ [HEADER_ACCESS_SCOPE]: '4' }),
    });
    assert.equal(write.err, null);
    const r = await getSecret({ namespace: 'marketdata', key: 'alpaca.api_key' }, 'marketdata', () => ({}));
    assert.equal(r.err, null);
    assert.deepEqual([r.res.found, r.res.value], [true, 'alpaca-xyz']);
  });
});
