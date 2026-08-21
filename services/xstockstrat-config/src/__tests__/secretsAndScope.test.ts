/**
 * Feature 147 security + scope behavior for ConfigServiceImpl.
 *
 * Covers: AC-1/AC-1b (encrypt-on-write, row-authoritative is_secret), AC-2/AC-3 (redaction at
 * GetConfig/ListKeys), AC-4/AC-5/AC-16 (GetSecret allow-list + distinct failure modes),
 * AC-11/AC-13/AC-14 (per-user overlay on GetConfig and WatchConfig, secrets stay redacted).
 *
 * GetSecret and setConfig-encrypt are exercised over a REAL loopback gRPC connection so metadata
 * delivery (the x-internal-caller gate) and the ts-proto wire shape are proven, not assumed
 * (docs/roadmap/ledger/fails.md 2026-07-27). Redaction/overlay read paths are driven by direct
 * handler calls with a mock pool.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';

const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env.CONFIG_SECRETS_ENCRYPTION_KEY = TEST_KEY;

import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { createConfigServiceDefinition } from '../grpc/serviceDefinition';
import { HEADER_ACCESS_SCOPE, HEADER_INTERNAL_CALLER } from '../grpc/authz';
import { encryptSecret } from '../crypto';

interface Handlers {
  existenceIsSecret?: boolean | null; // SELECT is_secret gate; null = not registered
  getSecretCiphertext?: Buffer | null; // SELECT value_encrypted
  globalRows?: any[]; // reload (user_id IS NULL)
  overlayRows?: any[]; // overlay (user_id = $3)
  onInsert?: (params: any[]) => void;
}

/** A programmable pool: per-branch handlers keyed on distinctive SQL fragments. The `handlers`
 * object is captured by reference, so mutating it between calls changes the mock's responses. */
function makePool(handlers: Handlers): any {
  return {
    query: async (sql: string, params?: any[]) => {
      if (sql.includes('SELECT is_secret FROM config.config_values')) {
        return { rows: handlers.existenceIsSecret == null ? [] : [{ is_secret: handlers.existenceIsSecret }] };
      }
      if (sql.includes('SELECT value_encrypted FROM config.config_values')) {
        return { rows: [{ value_encrypted: handlers.getSecretCiphertext ?? null }] };
      }
      if (sql.includes('INSERT INTO config.config_values')) {
        handlers.onInsert?.(params ?? []);
        return { rows: [] };
      }
      if (sql.includes('user_id IS NULL')) return { rows: handlers.globalRows ?? [] };
      if (sql.includes('user_id = $3')) return { rows: handlers.overlayRows ?? [] };
      return { rows: [] };
    },
    connect: async () => ({ query: async () => {}, on: () => {} }),
  };
}

function md(pairs: Record<string, string>): grpc.Metadata {
  const m = new grpc.Metadata();
  for (const [k, v] of Object.entries(pairs)) m.set(k, v);
  return m;
}

// ───────────────────────── GetSecret over real gRPC (AC-4/AC-5/AC-16) ─────────────────────────
describe('GetSecret allow-list + failure modes', () => {
  let server: grpc.Server;
  let client: any;
  const state: Handlers = {};

  before(async () => {
    server = new grpc.Server();
    server.addService(
      createConfigServiceDefinition(),
      new ConfigServiceImpl(makePool(state)) as unknown as grpc.UntypedServiceImplementation,
    );
    const port: number = await new Promise((resolve, reject) =>
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => (e ? reject(e) : resolve(p))),
    );
    const { ConfigServiceClient } = await import('@xstockstrat/proto/config/v1/config');
    client = new ConfigServiceClient(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  });
  after(() => { client?.close(); server?.forceShutdown(); });

  function getSecret(metadata: grpc.Metadata, req: Record<string, unknown>) {
    return new Promise<{ err: any; res: any }>((resolve) =>
      client.getSecret(req, metadata, (err: any, res: any) => resolve({ err, res })),
    );
  }

  it('AC-4: an allow-listed caller resolves the decrypted plaintext', async () => {
    state.getSecretCiphertext = encryptSecret('alpaca-key-xyz');
    const { err, res } = await getSecret(md({ [HEADER_INTERNAL_CALLER]: 'marketdata' }), {
      namespace: 'marketdata', key: 'alpaca.api_key', environment: 'ENVIRONMENT_PRODUCTION',
    });
    assert.equal(err, null);
    assert.equal(res.found, true);
    assert.equal(res.value, 'alpaca-key-xyz');
  });

  it('AC-5: a caller not on the allow-list is denied, no plaintext', async () => {
    state.getSecretCiphertext = encryptSecret('alpaca-key-xyz');
    const { err, res } = await getSecret(md({}), {
      namespace: 'marketdata', key: 'alpaca.api_key', environment: 'ENVIRONMENT_PRODUCTION',
    });
    assert.ok(err);
    assert.equal(err.code, grpc.status.PERMISSION_DENIED);
    assert.equal(res, undefined);
  });

  it('AC-5: an allow-listed caller cannot resolve a key outside its grant', async () => {
    state.getSecretCiphertext = encryptSecret('nope');
    const { err } = await getSecret(md({ [HEADER_INTERNAL_CALLER]: 'marketdata' }), {
      namespace: 'marketdata', key: 'not.granted', environment: 'ENVIRONMENT_PRODUCTION',
    });
    assert.ok(err);
    assert.equal(err.code, grpc.status.PERMISSION_DENIED);
  });

  it('AC-16: a NULL-ciphertext (unset) secret returns found=false, not an error', async () => {
    state.getSecretCiphertext = null;
    const { err, res } = await getSecret(md({ [HEADER_INTERNAL_CALLER]: 'marketdata' }), {
      namespace: 'marketdata', key: 'fmp.api_key', environment: 'ENVIRONMENT_PRODUCTION',
    });
    assert.equal(err, null);
    assert.equal(res.found, false);
    assert.equal(res.value, '');
  });

  it('AC-16: a ciphertext that cannot be decrypted is an INTERNAL error, never a partial value', async () => {
    state.getSecretCiphertext = Buffer.from('this-is-not-valid-gcm-ciphertext-bytes-xx');
    const { err, res } = await getSecret(md({ [HEADER_INTERNAL_CALLER]: 'marketdata' }), {
      namespace: 'marketdata', key: 'fmp.api_key', environment: 'ENVIRONMENT_PRODUCTION',
    });
    assert.ok(err, 'a decrypt failure must surface as an error');
    assert.equal(err.code, grpc.status.INTERNAL);
    assert.equal(res, undefined);
  });
});

// ───────────────────────── Encrypt-on-write over real gRPC (AC-1/AC-1b) ─────────────────────────
describe('SetConfig encrypts a secret (row-authoritative)', () => {
  let server: grpc.Server;
  let client: any;
  let lastInsert: any[] | undefined;
  const state: Handlers = { existenceIsSecret: true, onInsert: (p) => { lastInsert = p; } };

  before(async () => {
    server = new grpc.Server();
    server.addService(
      createConfigServiceDefinition(),
      new ConfigServiceImpl(makePool(state)) as unknown as grpc.UntypedServiceImplementation,
    );
    const port: number = await new Promise((resolve, reject) =>
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => (e ? reject(e) : resolve(p))),
    );
    const { ConfigServiceClient } = await import('@xstockstrat/proto/config/v1/config');
    client = new ConfigServiceClient(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  });
  after(() => { client?.close(); server?.forceShutdown(); });

  function setConfig(req: Record<string, unknown>) {
    const metadata = md({ [HEADER_ACCESS_SCOPE]: '4' });
    return new Promise<{ err: any }>((resolve) =>
      client.setConfig(req, metadata, (err: any) => resolve({ err })),
    );
  }

  // INSERT params: [namespace, key, value_type, value_data, value_encrypted, is_secret, ...]
  it('AC-1/AC-1b: a write to a secret key stores ciphertext + the redaction sentinel, not plaintext', async () => {
    lastInsert = undefined;
    const { err } = await setConfig({
      namespace: 'marketdata', key: 'fmp.api_key', value: { stringVal: 'fmp-live-abc123' },
      author: 'op', reason: 'set secret', environment: 'ENVIRONMENT_PRODUCTION',
      // deliberately NO is_secret on the request — is_secret is row-authoritative (AC-1b).
    });
    assert.equal(err, null);
    assert.ok(lastInsert, 'the INSERT must run');
    assert.equal(lastInsert![3], '[redacted]', 'value_data must be the sentinel, never the plaintext');
    assert.equal(lastInsert![5], true, 'is_secret must be forced from the stored row');
    const ct = lastInsert![4] as Buffer;
    assert.ok(Buffer.isBuffer(ct) && ct.length > 0, 'value_encrypted must be a non-empty ciphertext');
    assert.ok(!ct.toString('latin1').includes('fmp-live-abc123'), 'ciphertext must not contain the plaintext');
  });
});

// ───────────────────────── Redaction + per-user overlay (direct handler calls) ─────────────────────────
describe('redaction and per-user overlay', () => {
  const SECRET_ROW = {
    namespace: 'marketdata', key: 'alpaca.api_key', value_type: 'string',
    value_data: '[redacted]', is_secret: true, description: 'k', default_value: '', environment: 'production',
  };
  const GLOBAL_INT_ROW = {
    namespace: 'portfolio', key: 'watchlist.max_per_user', value_type: 'int',
    value_data: '50', is_secret: false, description: 'k', default_value: '50', environment: 'production',
  };

  it('AC-2: GetConfig redacts a secret value', async () => {
    const impl: any = new ConfigServiceImpl(makePool({ globalRows: [SECRET_ROW] }));
    await impl.reloadNamespace('marketdata', 'production');
    let result: any;
    await impl.getConfig({ request: { namespace: 'marketdata', environment: 2 } }, (_e: any, r: any) => (result = r));
    assert.equal(result.values['alpaca.api_key'].isSecret, true);
    assert.equal(result.values['alpaca.api_key'].stringVal, '[redacted]');
  });

  it('AC-3: ListKeys redacts a secret currentValue', async () => {
    // Even a secret row whose value_data somehow held a real value must redact on the ListKeys edge.
    const leaky = { ...SECRET_ROW, value_data: 'REAL-SECRET', consuming_service: 'xstockstrat-marketdata' };
    const pool = {
      query: async (sql: string) => (sql.includes('DISTINCT ON (key)') ? { rows: [leaky] } : { rows: [] }),
      connect: async () => ({ query: async () => {}, on: () => {} }),
    };
    const impl: any = new ConfigServiceImpl(pool as any);
    let result: any;
    await impl.listKeys({ request: { namespace: 'marketdata', environment: 2 } }, (_e: any, r: any) => (result = r));
    const k = result.keys.find((x: any) => x.key === 'alpaca.api_key');
    assert.equal(k.isSecret, true);
    assert.equal(k.currentValue, '[redacted]', 'a secret must never expose its value via ListKeys');
  });

  it('AC-11: GetConfig overlays a per-user value over the global value', async () => {
    const impl: any = new ConfigServiceImpl(makePool({
      globalRows: [GLOBAL_INT_ROW],
      overlayRows: [{ ...GLOBAL_INT_ROW, value_data: '200' }],
    }));
    await impl.reloadNamespace('portfolio', 'production');
    let asUser: any, asGlobal: any;
    await impl.getConfig({ request: { namespace: 'portfolio', environment: 2, userId: 'u-123' } }, (_e: any, r: any) => (asUser = r));
    await impl.getConfig({ request: { namespace: 'portfolio', environment: 2 } }, (_e: any, r: any) => (asGlobal = r));
    assert.equal(asUser.values['watchlist.max_per_user'].intVal, 200, 'per-user value must win');
    assert.equal(asGlobal.values['watchlist.max_per_user'].intVal, 50, 'a global caller sees the global value');
  });

  it('AC-13/AC-14: WatchConfig overlay reaches a per-user subscriber and keeps secrets redacted', async () => {
    // A secret in the SAME namespace as the subscriber, so it rides the same overlaid snapshot.
    const portfolioSecret = {
      namespace: 'portfolio', key: 'broker.token', value_type: 'string',
      value_data: '[redacted]', is_secret: true, description: 'k', default_value: '', environment: 'production',
    };
    const impl: any = new ConfigServiceImpl(makePool({
      globalRows: [GLOBAL_INT_ROW, portfolioSecret],
      overlayRows: [{ ...GLOBAL_INT_ROW, value_data: '200' }],
    }));
    await impl.reloadNamespace('portfolio', 'production');

    const writes: any[] = [];
    const fakeCall: any = {
      request: { namespace: 'portfolio', client_id: 'c', environment: 2, userId: 'u-123' },
      on: () => {},
      write: (p: any) => writes.push(p),
    };
    impl.watchConfig(fakeCall);
    await new Promise((r) => setTimeout(r, 20)); // watchConfig sends the initial snapshot async
    assert.ok(writes.length >= 1, 'the subscriber must receive an initial snapshot');
    // AC-13: per-user overlay reaches the stream.
    assert.equal(writes[0].values['watchlist.max_per_user'].intVal, 200, 'per-user overlay must reach the stream');
    // AC-14: the secret in the overlaid snapshot stays redacted.
    assert.equal(writes[0].values['broker.token'].isSecret, true);
    assert.equal(writes[0].values['broker.token'].stringVal, '[redacted]', 'a secret must stay redacted in a per-user overlay');
  });
});
