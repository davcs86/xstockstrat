// Unit tests for IdentityServiceImpl and authz — pool and config are inline mocks; no real DB.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

let IdentityServiceImpl: any;
let userIdFrom: any;
let first: any;
let isBlockedDefaultAdmin: any;
let SEED_ADMIN_PASSWORD_HASH: any;

// This import must throw on failure — never wrap it in try/catch or early-return on a
// missing subject; a swallowed import turns every case into a silent pass.
before(async () => {
  const mod = await import('../grpc/identityServiceImpl.js');
  IdentityServiceImpl = mod.IdentityServiceImpl;
  isBlockedDefaultAdmin = mod.isBlockedDefaultAdmin;
  SEED_ADMIN_PASSWORD_HASH = mod.SEED_ADMIN_PASSWORD_HASH;
  const authz = await import('../grpc/authz.js');
  userIdFrom = authz.userIdFrom;
  first = authz.first;
});

describe('test harness', () => {
  it('imports the implementation under test', () => {
    assert.strictEqual(
      typeof IdentityServiceImpl,
      'function',
      'IdentityServiceImpl must import — never skip silently',
    );
    assert.strictEqual(
      typeof userIdFrom,
      'function',
      'authz.userIdFrom must import — never skip silently',
    );
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePool(rows: any[] = [], throws?: Error) {
  return {
    async query(_sql: string, _params?: any[]) {
      if (throws) throw throws;
      return { rows };
    },
  };
}

function makeImpl(rows: any[] = [], throws?: Error) {
  const pool = makePool(rows, throws);
  const config = { getInt: (_key: string, def: number) => def } as any;
  return new IdentityServiceImpl(pool, config);
}

function makeCall(req: any) {
  return { request: req };
}

function makeCallWithMetadata(req: any, userId: string) {
  return {
    request: req,
    metadata: {
      get: (key: string) => (key === 'x-user-id' ? [userId] : []),
    },
  };
}

// ---------------------------------------------------------------------------
// authenticateUser — validation fast paths
// ---------------------------------------------------------------------------

describe('authenticateUser', () => {
  it('rejects when email is missing', async () => {
    const impl = makeImpl();
    const call = makeCall({ email: '', password: 'secret' });

    await new Promise<void>((resolve) => {
      impl.authenticateUser(call, (err: any) => {
        assert.ok(err);
        assert.strictEqual(err.code, 3);
        resolve();
      });
    });
  });

  it('rejects when password is missing', async () => {
    const impl = makeImpl();
    const call = makeCall({ email: 'user@example.com', password: '' });

    await new Promise<void>((resolve) => {
      impl.authenticateUser(call, (err: any) => {
        assert.ok(err);
        assert.strictEqual(err.code, 3);
        resolve();
      });
    });
  });

  it('returns error code 16 when user not found', async () => {
    const impl = makeImpl([]); // empty rows
    const call = makeCall({ email: 'unknown@example.com', password: 'pass' });

    await new Promise<void>((resolve) => {
      impl.authenticateUser(call, (err: any) => {
        assert.ok(err);
        assert.strictEqual(err.code, 16);
        resolve();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// authenticateUser — default seed-admin lockout in production (H-4)
// ---------------------------------------------------------------------------

describe('default seed-admin lockout', () => {
  it('isBlockedDefaultAdmin blocks the committed seed hash only in production', () => {
    assert.strictEqual(isBlockedDefaultAdmin(SEED_ADMIN_PASSWORD_HASH, 'production'), true);
    assert.strictEqual(isBlockedDefaultAdmin(SEED_ADMIN_PASSWORD_HASH, 'development'), false);
    assert.strictEqual(isBlockedDefaultAdmin(SEED_ADMIN_PASSWORD_HASH, undefined), false);
    assert.strictEqual(
      isBlockedDefaultAdmin('$2b$10$someOtherRealUserHashValueHere0000000000000', 'production'),
      false,
    );
  });

  it('feature 274 AC-20: the refusal log line carries user_id and never the email', async () => {
    const impl = makeImpl([
      { user_id: 'u-admin', password_hash: SEED_ADMIN_PASSWORD_HASH, roles: ['admin', 'trader'] },
    ]);
    const prev = process.env.APPLICATION_ENV;
    process.env.APPLICATION_ENV = 'production';
    const written: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await new Promise<void>((resolve) =>
        impl.authenticateUser(makeCall({ email: 'admin@localhost', password: 'admin' }), () =>
          resolve(),
        ),
      );
    } finally {
      process.stdout.write = original;
      if (prev === undefined) delete process.env.APPLICATION_ENV;
      else process.env.APPLICATION_ENV = prev;
    }
    const output = written.join('');
    assert.match(output, /Refused default seed-admin login/);
    assert.ok(output.includes('"user_id":"u-admin"'), `user_id missing from: ${output}`);
    assert.ok(!output.includes('admin@localhost'), 'the email was logged');
  });

  it('authenticateUser refuses the default seed-admin credential in production (code 16)', async () => {
    const impl = makeImpl([
      { user_id: 'u-admin', password_hash: SEED_ADMIN_PASSWORD_HASH, roles: ['admin', 'trader'] },
    ]);
    const prev = process.env.APPLICATION_ENV;
    process.env.APPLICATION_ENV = 'production';
    try {
      await new Promise<void>((resolve) => {
        impl.authenticateUser(
          makeCall({ email: 'admin@localhost', password: 'admin' }),
          (err: any) => {
            assert.ok(err, 'expected the seed-admin login to be refused');
            assert.strictEqual(err.code, 16);
            resolve();
          },
        );
      });
    } finally {
      if (prev === undefined) delete process.env.APPLICATION_ENV;
      else process.env.APPLICATION_ENV = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// validateToken
// ---------------------------------------------------------------------------

describe('validateToken', () => {
  it('rejects when token is missing', async () => {
    const impl = makeImpl();
    const call = makeCall({ token: '' });

    await new Promise<void>((resolve) => {
      impl.validateToken(call, (err: any) => {
        assert.ok(err);
        assert.ok(err.code === 3 || err.code === 16);
        resolve();
      });
    });
  });

  it('rejects an invalid / tampered token', async () => {
    const impl = makeImpl();
    const call = makeCall({ token: 'not.a.valid.jwt' });

    await new Promise<void>((resolve) => {
      impl.validateToken(call, (err: any) => {
        assert.ok(err);
        resolve();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// revokeToken
// ---------------------------------------------------------------------------

describe('revokeToken', () => {
  it('succeeds immediately when no token provided', async () => {
    const impl = makeImpl();
    // If revokeToken just calls callback with success for missing token:
    const call = makeCall({ token: '' });

    await new Promise<void>((resolve) => {
      impl.revokeToken(call, (_err: any, _resp: any) => {
        // Either succeeds with revoked:true or errors — just verify no crash
        resolve();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: success responses must carry `Date` Timestamp fields so the
// ts-proto grpc-js serializer can encode them. Before the fix, `{ seconds }`
// plain objects threw `getTime is not a function` inside `responseSerialize`
// (after the handler returned), which grpc-js surfaced to callers — e.g. the
// trader login route — as an INTERNAL trailers-only error.
// ---------------------------------------------------------------------------

describe('validateToken success serialization (regression)', () => {
  it('returns Date timestamps that ts-proto encodes without throwing', async () => {
    const impl = makeImpl();

    const { TokenClaims } = await import('@xstockstrat/proto/identity/v1/identity');

    process.env.JWT_SECRET = 'regression-test-secret';
    const now = Math.floor(Date.now() / 1000);
    const token = (jwt as any).sign(
      {
        user_id: 'u1',
        email: 'u@example.com',
        roles: ['trader'],
        issued_at: now,
        expires_at: now + 900,
      },
      process.env.JWT_SECRET,
    );

    const res: any = await new Promise((resolve, reject) => {
      impl.validateToken(makeCall({ token }), (err: any, r: any) =>
        err ? reject(err) : resolve(r),
      );
    });

    assert.ok(res.issuedAt instanceof Date, 'issuedAt must be a Date');
    assert.ok(res.expiresAt instanceof Date, 'expiresAt must be a Date');
    // The exact serialization grpc-js performs via responseSerialize — the call
    // that threw before the fix. Must not throw now.
    assert.doesNotThrow(() => TokenClaims.encode(res).finish());
  });
});

// ---------------------------------------------------------------------------
// OAuth 2.1 RPCs (feature 049 Part B)
// ---------------------------------------------------------------------------

/** A pool that records every SQL statement it sees and returns `rows` for all queries. */
function makeSpyPool(rows: any[] = []) {
  const queries: string[] = [];
  const params: any[][] = [];
  return {
    queries,
    params,
    async query(sql: string, p?: any[]) {
      queries.push(sql);
      params.push(p ?? []);
      return { rows };
    },
    async connect() {
      return { query: this.query, release() {} };
    },
  };
}

function implWithPool(pool: any) {
  const config = { getInt: (_key: string, def: number) => def } as any;
  return new IdentityServiceImpl(pool, config);
}

function challengeFor(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/** The `client_id` bound to the single refresh-token INSERT a spy pool recorded. */
function refreshInsertClientId(pool: { queries: string[]; params: any[][] }): unknown {
  const i = pool.queries.findIndex((q) => /INSERT INTO identity\.refresh_tokens/.test(q));
  assert.ok(i >= 0, 'expected a refresh-token INSERT');
  return pool.params[i][3];
}

async function withAppEnvUnset(fn: () => Promise<void>): Promise<void> {
  const prev = process.env.APPLICATION_ENV;
  delete process.env.APPLICATION_ENV;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.APPLICATION_ENV;
    else process.env.APPLICATION_ENV = prev;
  }
}

/** AC-4 shared claim half: every access token carries the same claims and TTL. */
function assertSharedClaims(accessToken: string): any {
  const decoded: any = (jwt as any).verify(accessToken, process.env.JWT_SECRET);
  for (const key of ['user_id', 'email', 'roles', 'issued_at', 'expires_at']) {
    assert.ok(key in decoded, `missing claim ${key}`);
  }
  assert.strictEqual(decoded.user_id, 'u1');
  assert.strictEqual(decoded.email, 'u@example.com');
  assert.deepStrictEqual(decoded.roles, ['trader']);
  assert.strictEqual(decoded.expires_at - decoded.issued_at, 900);
  return decoded;
}

describe('registerOAuthClient', () => {
  it('rejects a non-https redirect uri', async () => {
    const impl = makeImpl([]);
    const call = makeCall({ redirectUris: ['http://evil.example/cb'], clientName: 'x' });
    await new Promise<void>((resolve) => {
      impl.registerOAuthClient(call, (err: any) => {
        assert.ok(err);
        assert.strictEqual(err.code, 3);
        resolve();
      });
    });
  });

  it('returns a client_id for a valid https redirect uri', async () => {
    const impl = makeImpl([]);
    const call = makeCall({ redirectUris: ['https://app.example/cb'], clientName: 'x' });
    const res: any = await new Promise((resolve, reject) => {
      impl.registerOAuthClient(call, (err: any, r: any) => (err ? reject(err) : resolve(r)));
    });
    assert.ok(res.clientId.startsWith('oauthc_'));
    assert.deepStrictEqual(res.redirectUris, ['https://app.example/cb']);
  });
});

describe('exchangeAuthCode', () => {
  const verifier = 'a'.repeat(64);

  function storedRow(overrides: any = {}) {
    return {
      client_id: 'oauthc_1',
      user_id: 'u1',
      redirect_uri: 'https://app.example/cb',
      code_challenge: challengeFor(verifier),
      resource: 'https://agent.example/agent',
      consumed_at: null,
      expires_at: new Date(Date.now() + 60_000),
      email: 'u@example.com',
      roles: ['trader'],
      ...overrides,
    };
  }

  function exchangeCall(over: any = {}) {
    return makeCall({
      code: 'rawcode',
      codeVerifier: verifier,
      redirectUri: 'https://app.example/cb',
      clientId: 'oauthc_1',
      resource: 'https://agent.example/agent',
      ...over,
    });
  }

  it('PKCE happy path returns access + refresh, JWT carries aud', async () => {
    process.env.JWT_SECRET = 'oauth-test-secret';
    const pool = makeSpyPool([storedRow()]);
    const impl = implWithPool(pool);
    const res: any = await new Promise((resolve, reject) => {
      impl.exchangeAuthCode(exchangeCall(), (err: any, r: any) => (err ? reject(err) : resolve(r)));
    });
    assert.ok(res.accessToken);
    assert.ok(res.refreshToken);
    assert.strictEqual(res.tokenType, 'Bearer');
    const decoded: any = (jwt as any).verify(res.accessToken, process.env.JWT_SECRET);
    assert.strictEqual(decoded.aud, 'https://agent.example/agent');
    // Feature 051: the OAuth grant's refresh token must be tagged with its client_id so
    // it becomes listable/revocable in "My Authorized Apps".
    assert.ok(
      pool.queries.some((q) => /INSERT INTO identity\.refresh_tokens[^)]*client_id/.test(q)),
    );
  });

  it('@AC-4 OAuth exchange: shared claims, aud = resource, refresh tagged with client_id', async () => {
    process.env.JWT_SECRET = 'ac4-secret';
    await withAppEnvUnset(async () => {
      const pool = makeSpyPool([storedRow({ resource: 'https://agent.example/mcp' })]);
      const res: any = await new Promise((resolve, reject) => {
        implWithPool(pool).exchangeAuthCode(
          exchangeCall({ resource: 'https://agent.example/mcp' }),
          (err: any, r: any) => (err ? reject(err) : resolve(r)),
        );
      });
      const decoded = assertSharedClaims(res.accessToken);
      assert.strictEqual(decoded.aud, 'https://agent.example/mcp');
      assert.strictEqual(refreshInsertClientId(pool), 'oauthc_1');
    });
  });

  it('rejects a bad code_verifier as invalid_grant', async () => {
    process.env.JWT_SECRET = 'oauth-test-secret';
    const impl = implWithPool(makeSpyPool([storedRow()]));
    await new Promise<void>((resolve) => {
      impl.exchangeAuthCode(exchangeCall({ codeVerifier: 'wrong-verifier' }), (err: any) => {
        assert.ok(err);
        assert.strictEqual(err.code, 16);
        assert.strictEqual(err.message, 'invalid_grant');
        resolve();
      });
    });
  });

  it('rejects a consumed code', async () => {
    const impl = implWithPool(makeSpyPool([storedRow({ consumed_at: new Date() })]));
    await new Promise<void>((resolve) => {
      impl.exchangeAuthCode(exchangeCall(), (err: any) => {
        assert.strictEqual(err.code, 16);
        resolve();
      });
    });
  });

  it('rejects an expired code', async () => {
    const impl = implWithPool(
      makeSpyPool([storedRow({ expires_at: new Date(Date.now() - 1000) })]),
    );
    await new Promise<void>((resolve) => {
      impl.exchangeAuthCode(exchangeCall(), (err: any) => {
        assert.strictEqual(err.code, 16);
        resolve();
      });
    });
  });

  it('rejects a non-matching redirect_uri', async () => {
    const impl = implWithPool(makeSpyPool([storedRow()]));
    await new Promise<void>((resolve) => {
      impl.exchangeAuthCode(
        exchangeCall({ redirectUri: 'https://other.example/cb' }),
        (err: any) => {
          assert.strictEqual(err.code, 16);
          resolve();
        },
      );
    });
  });

  function exchange(
    impl: any,
    over: any = {},
  ): Promise<{ err?: number; message?: string; res?: any }> {
    return new Promise((resolve) =>
      impl.exchangeAuthCode(exchangeCall(over), (err: any, r: any) =>
        resolve(err ? { err: err.code, message: err.message } : { res: r }),
      ),
    );
  }

  it('@AC-1 lets exactly one of 20 concurrent exchanges of the same code win', async () => {
    process.env.JWT_SECRET = 'oauth-test-secret';
    const pool = makeAuthCodeDb(storedRow());
    const impl = implWithPool(pool);
    const results = await Promise.all(Array.from({ length: 20 }, () => exchange(impl)));
    const winners = results.filter((r) => r.res?.accessToken && r.res?.refreshToken);
    assert.strictEqual(winners.length, 1);
    const losers = results.filter((r) => r.err !== undefined);
    assert.strictEqual(losers.length, 19);
    for (const l of losers) {
      assert.strictEqual(l.err, 16);
      assert.strictEqual(l.message, 'invalid_grant');
    }
    assert.strictEqual(pool.db.committedInserts.length, 1);
    assert.strictEqual(pool.db.committedInserts[0].params[3], 'oauthc_1');
  });

  it('@AC-1 rejects a code that expires between validation and the claim', async () => {
    process.env.JWT_SECRET = 'oauth-test-secret';
    const pool = makeAuthCodeDb(storedRow(), { expireAtClaim: true });
    const out = await exchange(implWithPool(pool));
    assert.strictEqual(out.err, 16);
    assert.strictEqual(pool.db.committedInserts.length, 0);
  });

  it('@AC-2 rejects a second sequential exchange of a consumed code', async () => {
    process.env.JWT_SECRET = 'oauth-test-secret';
    const impl = implWithPool(makeAuthCodeDb(storedRow()));
    const first = await exchange(impl);
    assert.ok(first.res?.accessToken);
    const second = await exchange(impl);
    assert.strictEqual(second.err, 16);
    assert.strictEqual(second.message, 'invalid_grant');
  });

  it('@AC-3 does not consume the code when the refresh-token INSERT fails', async () => {
    process.env.JWT_SECRET = 'oauth-test-secret';
    const pool = makeAuthCodeDb(storedRow(), { failInsert: true });
    const out = await exchange(implWithPool(pool));
    assert.strictEqual(out.err, 13);
    assert.strictEqual(out.res, undefined);
    assert.strictEqual(pool.db.consumedAt, null);
    assert.strictEqual(pool.db.committedInserts.length, 0);
  });

  it('@AC-3 does not consume the code when minting fails (JWT_SECRET unset)', async () => {
    const prev = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      const pool = makeAuthCodeDb(storedRow());
      const out = await exchange(implWithPool(pool));
      assert.strictEqual(out.err, 13);
      assert.strictEqual(pool.db.consumedAt, null);
      assert.strictEqual(pool.db.committedInserts.length, 0);
    } finally {
      if (prev === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prev;
    }
  });

  it('@AC-5 leaves the code redeemable after verifier, redirect or client mismatches', async () => {
    process.env.JWT_SECRET = 'oauth-test-secret';
    const pool = makeAuthCodeDb(storedRow());
    const impl = implWithPool(pool);
    for (const over of [
      { codeVerifier: 'wrong-verifier' },
      { redirectUri: 'https://evil.example/callback' },
      { clientId: 'other-client' },
    ]) {
      const out = await exchange(impl, over);
      assert.strictEqual(out.err, 16);
      assert.strictEqual(out.message, 'invalid_grant');
      assert.strictEqual(pool.db.consumedAt, null);
    }
    const ok = await exchange(impl);
    assert.ok(ok.res?.accessToken);
    assert.ok(ok.res?.refreshToken);
  });

  it('@AC-6 rejects an expired code without issuing a refresh token', async () => {
    process.env.JWT_SECRET = 'oauth-test-secret';
    const pool = makeAuthCodeDb(storedRow({ expires_at: new Date(Date.now() - 1000) }));
    const out = await exchange(implWithPool(pool));
    assert.strictEqual(out.err, 16);
    assert.strictEqual(pool.db.committedInserts.length, 0);
  });
});

// One stored refresh token with transactional semantics: a revoke takes effect only on COMMIT, and an
// open claim holds the row the way Postgres' row lock does, so a concurrent conditional claim loses.
function makeTokenDb(row: any, opts: { failInsert?: boolean } = {}) {
  const db: { revoked: boolean; inserts: number; lockedBy: object | null } = {
    revoked: false,
    inserts: 0,
    lockedBy: null,
  };
  const run = async (sql: string, tx?: { revoke: boolean }) => {
    await Promise.resolve();
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) {
      if (tx && /COMMIT/.test(sql) && tx.revoke) db.revoked = true;
      if (tx && db.lockedBy === tx) db.lockedBy = null;
      if (tx) tx.revoke = false;
      return { rows: [] };
    }
    if (/^\s*SELECT/.test(sql)) return { rows: db.revoked ? [] : [row] };
    if (/INSERT INTO identity\.refresh_tokens/.test(sql)) {
      if (opts.failInsert) throw new Error('insert failed');
      db.inserts++;
      return { rows: [] };
    }
    if (/SET revoked_at = NOW\(\)/.test(sql)) {
      const conditional = /revoked_at IS NULL/.test(sql);
      if (conditional && (db.revoked || (db.lockedBy && db.lockedBy !== tx))) return { rows: [] };
      if (tx) {
        tx.revoke = true;
        db.lockedBy = tx;
      } else db.revoked = true;
      return { rows: [row] };
    }
    return { rows: [] };
  };
  return {
    db,
    query: (sql: string) => run(sql),
    async connect() {
      const tx = { revoke: false };
      return { query: (sql: string) => run(sql, tx), release() {} };
    },
  };
}

// One stored auth code: autocommit writes apply at once, in-transaction writes only on COMMIT, and an
// open claim holds the row so a concurrent conditional claim loses. Only a predicated UPDATE is conditional.
function makeAuthCodeDb(row: any, opts: { failInsert?: boolean; expireAtClaim?: boolean } = {}) {
  type Tx = { consume: boolean; inserts: Array<{ params: any[] }> };
  const db: {
    consumedAt: Date | null;
    committedInserts: Array<{ params: any[] }>;
    lockedBy: Tx | null;
  } = {
    consumedAt: null,
    committedInserts: [],
    lockedBy: null,
  };
  const run = async (sql: string, params: any[] = [], tx?: Tx) => {
    await Promise.resolve();
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) {
      if (tx && /COMMIT/.test(sql)) {
        if (tx.consume) db.consumedAt = new Date();
        db.committedInserts.push(...tx.inserts);
      }
      if (tx && db.lockedBy === tx) db.lockedBy = null;
      if (tx) {
        tx.consume = false;
        tx.inserts = [];
      }
      return { rows: [] };
    }
    if (/^\s*SELECT/.test(sql)) return { rows: [{ ...row, consumed_at: db.consumedAt }] };
    if (/INSERT INTO identity\.refresh_tokens/.test(sql)) {
      if (opts.failInsert) throw new Error('connection terminated');
      if (tx) tx.inserts.push({ params });
      else db.committedInserts.push({ params });
      return { rows: [] };
    }
    if (/SET consumed_at = NOW\(\)/.test(sql)) {
      const conditional = /consumed_at IS NULL/.test(sql) && /expires_at > NOW\(\)/.test(sql);
      if (
        conditional &&
        (db.consumedAt !== null || (db.lockedBy && db.lockedBy !== tx) || opts.expireAtClaim)
      ) {
        return { rows: [] };
      }
      if (tx) {
        tx.consume = true;
        db.lockedBy = tx;
      } else db.consumedAt = new Date();
      return { rows: [{ code: 'claimed' }] };
    }
    return { rows: [] };
  };
  return {
    db,
    query: (sql: string, params?: any[]) => run(sql, params),
    async connect() {
      const tx: Tx = { consume: false, inserts: [] };
      return { query: (sql: string, params?: any[]) => run(sql, params, tx), release() {} };
    },
  };
}

function refresh(impl: any, method: string, req: any): Promise<{ err?: number; token?: string }> {
  return new Promise((resolve) =>
    impl[method](makeCall(req), (err: any, r: any) =>
      resolve(err ? { err: err.code } : { token: r.refreshToken }),
    ),
  );
}

for (const [method, req] of [
  ['refreshToken', { refreshToken: 'r1' }],
  ['refreshOAuthToken', { refreshToken: 'r1', resource: 'https://agent.example/agent' }],
] as const) {
  describe(`${method} rotation is single-use`, () => {
    const row = {
      token_id: 't1',
      user_id: 'u1',
      client_id: null,
      email: 'u@example.com',
      roles: ['trader'],
    };

    it('lets exactly one of two concurrent refreshes of the same token win', async () => {
      process.env.JWT_SECRET = 'rotation-secret';
      const pool = makeTokenDb(row);
      const impl = implWithPool(pool);
      const results = await Promise.all([refresh(impl, method, req), refresh(impl, method, req)]);
      assert.strictEqual(results.filter((r) => r.token).length, 1);
      assert.deepStrictEqual(
        results.filter((r) => r.err).map((r) => r.err),
        [16],
      );
      assert.strictEqual(pool.db.inserts, 1);
    });

    it('keeps the presented token valid when issuing its successor fails', async () => {
      process.env.JWT_SECRET = 'rotation-secret';
      const pool = makeTokenDb(row, { failInsert: true });
      const impl = implWithPool(pool);
      const res = await refresh(impl, method, req);
      assert.strictEqual(res.err, 13);
      assert.strictEqual(pool.db.revoked, false);
    });
  });
}

describe('refreshOAuthToken', () => {
  it('rotates the refresh token and mints a new aud-bound access JWT', async () => {
    process.env.JWT_SECRET = 'oauth-test-secret';
    const pool = makeSpyPool([
      { token_id: 't1', user_id: 'u1', email: 'u@example.com', roles: ['trader'] },
    ]);
    const impl = implWithPool(pool);
    const call = makeCall({ refreshToken: 'old-refresh', resource: 'https://agent.example/agent' });
    const res: any = await new Promise((resolve, reject) => {
      impl.refreshOAuthToken(call, (err: any, r: any) => (err ? reject(err) : resolve(r)));
    });
    assert.ok(res.accessToken);
    assert.ok(res.refreshToken);
    const decoded: any = (jwt as any).verify(res.accessToken, process.env.JWT_SECRET);
    assert.strictEqual(decoded.aud, 'https://agent.example/agent');
    // Rotation: a conditional revoked_at claim must have been issued (AC-B5).
    assert.ok(
      pool.queries.some((q) => /SET revoked_at = NOW\(\)[\s\S]*revoked_at IS NULL/.test(q)),
    );
  });

  it('rejects an unknown refresh token', async () => {
    const impl = implWithPool(makeSpyPool([]));
    await new Promise<void>((resolve) => {
      impl.refreshOAuthToken(makeCall({ refreshToken: 'nope', resource: 'r' }), (err: any) => {
        assert.strictEqual(err.code, 16);
        resolve();
      });
    });
  });
});

// The OAuth-exchange AC-4 case lives in describe('exchangeAuthCode') to reuse storedRow/exchangeCall.
describe('token claim-shape parity (AC-4)', () => {
  it('@AC-4 login: shared claims, no aud, refresh client_id NULL', async () => {
    process.env.JWT_SECRET = 'ac4-secret';
    await withAppEnvUnset(async () => {
      const pool = makeSpyPool([
        { user_id: 'u1', password_hash: SEED_ADMIN_PASSWORD_HASH, roles: ['trader'] },
      ]);
      const res: any = await new Promise((resolve, reject) => {
        implWithPool(pool).authenticateUser(
          makeCall({ email: 'u@example.com', password: 'admin' }),
          (err: any, r: any) => (err ? reject(err) : resolve(r)),
        );
      });
      const decoded = assertSharedClaims(res.accessToken);
      assert.ok(!('aud' in decoded), 'first-party login token must carry no aud');
      assert.strictEqual(refreshInsertClientId(pool), null);
    });
  });

  it('@AC-4 first-party refresh: shared claims, no aud, refresh client_id NULL', async () => {
    process.env.JWT_SECRET = 'ac4-secret';
    await withAppEnvUnset(async () => {
      const pool = makeSpyPool([
        {
          token_id: 't1',
          user_id: 'u1',
          client_id: null,
          email: 'u@example.com',
          roles: ['trader'],
        },
      ]);
      const res: any = await new Promise((resolve, reject) => {
        implWithPool(pool).refreshToken(makeCall({ refreshToken: 'r1' }), (err: any, r: any) =>
          err ? reject(err) : resolve(r),
        );
      });
      const decoded = assertSharedClaims(res.accessToken);
      assert.ok(!('aud' in decoded), 'first-party refresh token must carry no aud');
      assert.strictEqual(refreshInsertClientId(pool), null);
    });
  });
});

describe('validateToken aud surfacing', () => {
  it('surfaces the aud claim from a signed JWT', async () => {
    process.env.JWT_SECRET = 'oauth-test-secret';
    const impl = makeImpl();
    const now = Math.floor(Date.now() / 1000);
    const token = (jwt as any).sign(
      {
        user_id: 'u1',
        email: 'u@x.com',
        roles: [],
        issued_at: now,
        expires_at: now + 900,
        aud: 'https://agent.example/agent',
      },
      process.env.JWT_SECRET,
    );
    const res: any = await new Promise((resolve, reject) => {
      impl.validateToken(makeCall({ token }), (err: any, r: any) =>
        err ? reject(err) : resolve(r),
      );
    });
    assert.strictEqual(res.aud, 'https://agent.example/agent');
  });
});

// ---------------------------------------------------------------------------
// Authorized-apps management (feature 051)
// ---------------------------------------------------------------------------

describe('listAuthorizedApps', () => {
  it('rejects when userId is missing', async () => {
    const impl = makeImpl();
    await new Promise<void>((resolve) => {
      impl.listAuthorizedApps(makeCall({ userId: '' }), (err: any) => {
        assert.ok(err);
        assert.strictEqual(err.code, 3);
        resolve();
      });
    });
  });

  it('returns per-user apps with only non-sensitive fields and JOINs oauth_clients', async () => {
    const pool = makeSpyPool([
      {
        client_id: 'oauthc_1',
        client_name: 'Claude.ai',
        redirect_uris: ['https://claude.ai/cb'],
        authorized_at: new Date(),
        last_used_at: null,
      },
    ]);
    const impl = implWithPool(pool);
    const res: any = await new Promise((resolve, reject) => {
      impl.listAuthorizedApps(makeCall({ userId: 'u1' }), (err: any, r: any) =>
        err ? reject(err) : resolve(r),
      );
    });
    assert.strictEqual(res.apps[0].clientId, 'oauthc_1');
    assert.strictEqual(res.apps[0].clientName, 'Claude.ai');
    assert.strictEqual(res.apps[0].lastUsedAt, undefined);
    // No token/secret field ever leaks into the response (FR-7).
    assert.ok(!('tokenHash' in res.apps[0]));
    // Per-user scoped + joins the client metadata table.
    assert.ok(pool.queries.some((q) => /JOIN identity\.oauth_clients/.test(q)));
    assert.ok(pool.queries.some((q) => /WHERE rt\.user_id/.test(q)));
  });
});

describe('revokeAuthorizedApp', () => {
  it('rejects when userId is missing', async () => {
    const impl = makeImpl();
    await new Promise<void>((resolve) => {
      impl.revokeAuthorizedApp(makeCall({ userId: '', clientId: 'oauthc_1' }), (err: any) => {
        assert.strictEqual(err.code, 3);
        resolve();
      });
    });
  });

  it('rejects when clientId is missing', async () => {
    const impl = makeImpl();
    await new Promise<void>((resolve) => {
      impl.revokeAuthorizedApp(makeCall({ userId: 'u1', clientId: '' }), (err: any) => {
        assert.strictEqual(err.code, 3);
        resolve();
      });
    });
  });

  it('revokes scoped by both user_id AND client_id (IDOR-safe)', async () => {
    const pool = makeSpyPool([]);
    const impl = implWithPool(pool);
    const res: any = await new Promise((resolve, reject) => {
      impl.revokeAuthorizedApp(
        makeCall({ userId: 'u1', clientId: 'oauthc_1' }),
        (err: any, r: any) => (err ? reject(err) : resolve(r)),
      );
    });
    assert.strictEqual(res.success, true);
    assert.ok(pool.queries.some((q) => /WHERE user_id = \$1 AND client_id = \$2/.test(q)));
  });
});

// ---------------------------------------------------------------------------
// getUserMetadata (feature 130)
// ---------------------------------------------------------------------------

describe('getUserMetadata', () => {
  it('returns NOT_FOUND (code 5) when user does not exist', async () => {
    const impl = makeImpl([]);
    await new Promise<void>((resolve) => {
      impl.getUserMetadata(makeCallWithMetadata({}, 'nonexistent-user'), (err: any) => {
        assert.equal(err.code, 5);
        resolve();
      });
    });
  });

  it('returns user metadata for an existing user', async () => {
    const row = {
      user_id: 'u1',
      email: 'a@b.com',
      phone: '+1234',
      display_name: 'Alice',
      metadata: {},
      metadata_updated_at: new Date(),
    };
    const impl = makeImpl([row]);
    await new Promise<void>((resolve) => {
      impl.getUserMetadata(makeCallWithMetadata({}, 'u1'), (err: any, res: any) => {
        assert.equal(err, null);
        assert.equal(res.userMetadata.userId, 'u1');
        assert.equal(res.userMetadata.email, 'a@b.com');
        assert.equal(res.userMetadata.phone, '+1234');
        resolve();
      });
    });
  });

  it('rejects when call.metadata is missing', async () => {
    const impl = makeImpl([]);
    await new Promise<void>((resolve) => {
      impl.getUserMetadata(makeCall({}), (err: any) => {
        assert.equal(err.code, 13);
        resolve();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// updateUserMetadata (feature 130)
// ---------------------------------------------------------------------------

describe('updateUserMetadata', () => {
  it('rejects when no fields are provided', async () => {
    const impl = makeImpl([]);
    await new Promise<void>((resolve) => {
      impl.updateUserMetadata(makeCallWithMetadata({}, 'u1'), (err: any) => {
        assert.equal(err.code, 3);
        resolve();
      });
    });
  });

  it('partial update: sets phone only, preserves display_name', async () => {
    const row = {
      user_id: 'u1',
      email: 'a@b.com',
      phone: '+9999',
      display_name: 'Alice',
      metadata: {},
      metadata_updated_at: new Date(),
    };
    const impl = makeImpl([row]);
    await new Promise<void>((resolve) => {
      impl.updateUserMetadata(
        makeCallWithMetadata({ phone: '+9999' }, 'u1'),
        (err: any, res: any) => {
          assert.equal(err, null);
          assert.equal(res.userMetadata.phone, '+9999');
          assert.equal(res.userMetadata.displayName, 'Alice');
          resolve();
        },
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Handler registration smoke (feature 130)
// ---------------------------------------------------------------------------

describe('handler registration (smoke)', () => {
  it('getUserMetadata is a callable method on the prototype', () => {
    assert.equal(typeof IdentityServiceImpl.prototype.getUserMetadata, 'function');
  });

  it('updateUserMetadata is a callable method on the prototype', () => {
    assert.equal(typeof IdentityServiceImpl.prototype.updateUserMetadata, 'function');
  });
});

// ---------------------------------------------------------------------------
// authz: userIdFrom / first (feature 130 — Step 4 coverage)
// ---------------------------------------------------------------------------

describe('authz: userIdFrom / first', () => {
  it('userIdFrom extracts x-user-id from metadata', () => {
    const md = { get: (key: string) => (key === 'x-user-id' ? ['uid-123'] : []) };
    assert.equal(userIdFrom(md), 'uid-123');
  });

  it('userIdFrom returns empty string when x-user-id is absent', () => {
    const md = { get: () => [] };
    assert.equal(userIdFrom(md), '');
  });

  it('first returns the first element of a metadata array', () => {
    const md = { get: (key: string) => (key === 'x-trace-id' ? ['t1', 't2'] : []) };
    assert.equal(first(md, 'x-trace-id'), 't1');
  });

  it('first returns empty string for a missing key', () => {
    const md = { get: () => [] };
    assert.equal(first(md, 'x-missing'), '');
  });
});

// ---------------------------------------------------------------------------
// User management (admin-gated, feature 043)
// ---------------------------------------------------------------------------

// A pool that routes by SQL regex and records every call (sql + params), so tests can assert
// which queries fired, in order, and with what params — without a real DB.
function routePool(routes: Array<{ re: RegExp; resp: any }>) {
  const calls: Array<{ sql: string; params?: any[] }> = [];
  const pool = {
    calls,
    async query(sql: string, params?: any[]) {
      calls.push({ sql, params });
      for (const r of routes) if (r.re.test(sql)) return r.resp;
      return { rows: [], rowCount: 0 };
    },
  };
  return pool;
}

function makeAdminImpl(pool: any) {
  const config = { getInt: (_k: string, d: number) => d } as any;
  return new IdentityServiceImpl(pool, config);
}

function adminCall(req: any, userId = 'admin-1') {
  return {
    request: req,
    metadata: {
      get: (k: string) => (k === 'x-user-id' ? [userId] : k === 'x-access-scope' ? ['4'] : []),
    },
  };
}

function nonAdminCall(req: any) {
  return {
    request: req,
    metadata: {
      get: (k: string) => (k === 'x-user-id' ? ['u9'] : k === 'x-access-scope' ? ['2'] : []),
    },
  };
}

const USER_ROW = {
  user_id: 'u-1',
  email: 'alice@example.com',
  roles: ['trader'],
  is_active: true,
  created_at: new Date('2026-01-01T00:00:00Z'),
};

function runRpc(impl: any, method: string, call: any): Promise<{ err: any; resp: any }> {
  return new Promise((resolve) => {
    impl[method](call, (err: any, resp: any) => resolve({ err, resp }));
  });
}

describe('user management admin gate (AC-7)', () => {
  const methods = [
    'createUser',
    'listUsers',
    'getUser',
    'updatePassword',
    'setUserRoles',
    'setUserActive',
  ];
  for (const m of methods) {
    it(`${m} denies a non-admin caller with PERMISSION_DENIED and runs no query`, async () => {
      const pool = routePool([]);
      const impl = makeAdminImpl(pool);
      const { err } = await runRpc(
        impl,
        m,
        nonAdminCall({ userId: 'u-1', email: 'a@b.c', password: 'x', newPassword: 'x' }),
      );
      assert.ok(err, `${m} must deny`);
      assert.equal(err.code, 7);
      assert.equal(pool.calls.length, 0, `${m} must not touch the DB when denied`);
    });
  }
});

describe('listUsers (AC-1/AC-10)', () => {
  it('returns password-free user views', async () => {
    const pool = routePool([
      { re: /SELECT .* FROM identity\.users ORDER BY created_at/, resp: { rows: [USER_ROW] } },
    ]);
    const impl = makeAdminImpl(pool);
    const { err, resp } = await runRpc(impl, 'listUsers', adminCall({}));
    assert.equal(err, null);
    assert.equal(resp.users.length, 1);
    const u = resp.users[0];
    assert.equal(u.email, 'alice@example.com');
    assert.deepEqual(u.roles, [2]); // trader
    assert.equal(u.isActive, true);
    assert.ok(!('passwordHash' in u) && !('password' in u), 'no password/hash on the view');
  });
});

describe('createUser (AC-2/AC-10)', () => {
  it('hashes the password (never stores plaintext) and returns a password-free view', async () => {
    const pool = routePool([
      { re: /INSERT INTO identity\.users/, resp: { rows: [USER_ROW], rowCount: 1 } },
    ]);
    const impl = makeAdminImpl(pool);
    const { err, resp } = await runRpc(
      impl,
      'createUser',
      adminCall({ email: 'alice@example.com', password: 'plaintext-pw', roles: [2] }),
    );
    assert.equal(err, null);
    const insert = pool.calls.find((c) => /INSERT INTO identity\.users/.test(c.sql))!;
    assert.notEqual(insert.params![1], 'plaintext-pw', 'must not store the plaintext');
    assert.ok(String(insert.params![1]).startsWith('$2'), 'stored value is a bcrypt hash');
    assert.deepEqual(insert.params![2], ['trader']); // role enum 2 → 'trader'
    assert.equal(resp.user.isActive, true);
    assert.ok(!('password' in resp.user));
  });

  it('maps a Postgres unique-violation to ALREADY_EXISTS', async () => {
    const pool = {
      calls: [] as any[],
      async query(sql: string, params?: any[]) {
        this.calls.push({ sql, params });
        const e: any = new Error('dup');
        e.code = '23505';
        throw e;
      },
    };
    const impl = makeAdminImpl(pool);
    const { err } = await runRpc(impl, 'createUser', adminCall({ email: 'a@b.c', password: 'x' }));
    assert.equal(err.code, 6);
  });
});

describe('updatePassword (AC-3/AC-10)', () => {
  it('updates the hash then revokes the target refresh tokens, returning an empty body', async () => {
    const pool = routePool([
      {
        re: /UPDATE identity\.users SET password_hash/,
        resp: { rows: [{ email: 'alice@example.com' }], rowCount: 1 },
      },
      { re: /UPDATE identity\.refresh_tokens SET revoked_at/, resp: { rowCount: 1 } },
    ]);
    const impl = makeAdminImpl(pool);
    const { err, resp } = await runRpc(
      impl,
      'updatePassword',
      adminCall({ userId: 'u-1', newPassword: 'newpw' }),
    );
    assert.equal(err, null);
    assert.deepEqual(resp, {});
    const order = pool.calls.map((c) => c.sql);
    const iPw = order.findIndex((s) => /password_hash/.test(s));
    const iRevoke = order.findIndex((s) => /refresh_tokens SET revoked_at/.test(s));
    assert.ok(iPw >= 0 && iRevoke > iPw, 'password update precedes token revoke');
    const pwUpdate = pool.calls.find((c) => /password_hash/.test(c.sql))!;
    assert.ok(String(pwUpdate.params![0]).startsWith('$2'), 'stores a bcrypt hash, not plaintext');
  });
});

describe('setUserRoles (AC-4)', () => {
  it('maps Role enums to DB strings and returns the mapped view', async () => {
    const pool = routePool([
      {
        re: /UPDATE identity\.users SET roles/,
        resp: { rows: [{ ...USER_ROW, roles: ['trader', 'admin'] }], rowCount: 1 },
      },
    ]);
    const impl = makeAdminImpl(pool);
    const { err, resp } = await runRpc(
      impl,
      'setUserRoles',
      adminCall({ userId: 'u-1', roles: [2, 1] }),
    );
    assert.equal(err, null);
    const upd = pool.calls.find((c) => /SET roles/.test(c.sql))!;
    assert.deepEqual(upd.params![1], ['trader', 'admin']);
    assert.equal(upd.params![2], true); // new roles include admin
    assert.deepEqual(resp.user.roles.sort(), [1, 2]);
  });
});

describe('setUserActive (AC-5/AC-6)', () => {
  it('deactivate flips is_active=false AND revokes refresh tokens', async () => {
    const pool = routePool([
      {
        re: /UPDATE identity\.users SET is_active/,
        resp: { rows: [{ ...USER_ROW, is_active: false }], rowCount: 1 },
      },
      { re: /UPDATE identity\.refresh_tokens SET revoked_at/, resp: { rowCount: 1 } },
    ]);
    const impl = makeAdminImpl(pool);
    const { err } = await runRpc(
      impl,
      'setUserActive',
      adminCall({ userId: 'u-1', active: false }),
    );
    assert.equal(err, null);
    assert.ok(pool.calls.some((c) => /is_active/.test(c.sql)));
    assert.ok(
      pool.calls.some((c) => /refresh_tokens SET revoked_at/.test(c.sql)),
      'deactivate revokes tokens',
    );
  });

  it('reactivate flips is_active=true and does NOT revoke tokens', async () => {
    const pool = routePool([
      { re: /UPDATE identity\.users SET is_active/, resp: { rows: [USER_ROW], rowCount: 1 } },
    ]);
    const impl = makeAdminImpl(pool);
    const { err } = await runRpc(impl, 'setUserActive', adminCall({ userId: 'u-1', active: true }));
    assert.equal(err, null);
    assert.ok(
      !pool.calls.some((c) => /refresh_tokens SET revoked_at/.test(c.sql)),
      'reactivate must not revoke',
    );
  });
});

describe('last-admin guard (AC-11)', () => {
  it('setUserActive(false) on the last admin → FAILED_PRECONDITION cannot remove last admin', async () => {
    // Guarded UPDATE affects 0 rows; existence check shows the target exists.
    const pool = routePool([
      { re: /UPDATE identity\.users SET is_active/, resp: { rows: [], rowCount: 0 } },
      { re: /SELECT 1 FROM identity\.users WHERE user_id/, resp: { rowCount: 1 } },
    ]);
    const impl = makeAdminImpl(pool);
    const { err } = await runRpc(
      impl,
      'setUserActive',
      adminCall({ userId: 'admin-only', active: false }),
    );
    assert.equal(err.code, 9);
    assert.equal(err.message, 'cannot remove last admin');
  });

  it('setUserRoles stripping admin from the last admin → FAILED_PRECONDITION', async () => {
    const pool = routePool([
      { re: /UPDATE identity\.users SET roles/, resp: { rows: [], rowCount: 0 } },
      { re: /SELECT 1 FROM identity\.users WHERE user_id/, resp: { rowCount: 1 } },
    ]);
    const impl = makeAdminImpl(pool);
    const { err } = await runRpc(
      impl,
      'setUserRoles',
      adminCall({ userId: 'admin-only', roles: [2] }),
    );
    assert.equal(err.code, 9);
    assert.equal(err.message, 'cannot remove last admin');
  });
});

// ---------------------------------------------------------------------------
// Ledger audit (feature 043, Step 7) — AC-8/AC-10
// ---------------------------------------------------------------------------

function makeFakeAudit() {
  const calls: Array<{ eventType: string; targetUserId: string; payload: any }> = [];
  return {
    calls,
    async append(eventType: string, targetUserId: string, _md: any, payload: any) {
      calls.push({ eventType, targetUserId, payload });
    },
  };
}

function makeAuditImpl(pool: any, audit: any) {
  const config = { getInt: (_k: string, d: number) => d } as any;
  return new IdentityServiceImpl(pool, config, audit);
}

const NO_SECRET_KEYS = ['password', 'newPassword', 'new_password', 'passwordHash', 'password_hash'];
function assertNoSecret(payload: any) {
  for (const k of NO_SECRET_KEYS) assert.ok(!(k in payload), `audit payload must not carry ${k}`);
}

describe('ledger audit emits (AC-8/AC-10)', () => {
  it('createUser emits identity.user.created with a secret-free payload from x-user-id', async () => {
    const pool = routePool([
      { re: /INSERT INTO identity\.users/, resp: { rows: [USER_ROW], rowCount: 1 } },
    ]);
    const audit = makeFakeAudit();
    const impl = makeAuditImpl(pool, audit);
    await runRpc(
      impl,
      'createUser',
      adminCall({ email: 'alice@example.com', password: 'secret-pw', roles: [2] }, 'admin-42'),
    );
    assert.equal(audit.calls.length, 1);
    assert.equal(audit.calls[0].eventType, 'identity.user.created');
    assert.equal(audit.calls[0].payload.acting_admin_user_id, 'admin-42');
    assert.equal(audit.calls[0].payload.target_user_id, 'u-1');
    assertNoSecret(audit.calls[0].payload);
  });

  it('updatePassword emits identity.user.password_updated with NO password in the payload', async () => {
    const pool = routePool([
      {
        re: /UPDATE identity\.users SET password_hash/,
        resp: { rows: [{ email: 'alice@example.com' }], rowCount: 1 },
      },
      { re: /refresh_tokens SET revoked_at/, resp: { rowCount: 1 } },
    ]);
    const audit = makeFakeAudit();
    const impl = makeAuditImpl(pool, audit);
    await runRpc(impl, 'updatePassword', adminCall({ userId: 'u-1', newPassword: 'brand-new-pw' }));
    assert.equal(audit.calls.length, 1);
    assert.equal(audit.calls[0].eventType, 'identity.user.password_updated');
    assertNoSecret(audit.calls[0].payload);
  });

  it('setUserRoles and setUserActive emit their events; reads emit nothing', async () => {
    const rolesAudit = makeFakeAudit();
    const rolesImpl = makeAuditImpl(
      routePool([
        { re: /SET roles/, resp: { rows: [{ ...USER_ROW, roles: ['trader'] }], rowCount: 1 } },
      ]),
      rolesAudit,
    );
    await runRpc(rolesImpl, 'setUserRoles', adminCall({ userId: 'u-1', roles: [2] }));
    assert.equal(rolesAudit.calls[0].eventType, 'identity.user.roles_updated');

    const activeAudit = makeFakeAudit();
    const activeImpl = makeAuditImpl(
      routePool([
        { re: /SET is_active/, resp: { rows: [{ ...USER_ROW, is_active: false }], rowCount: 1 } },
        { re: /refresh_tokens SET revoked_at/, resp: { rowCount: 1 } },
      ]),
      activeAudit,
    );
    await runRpc(activeImpl, 'setUserActive', adminCall({ userId: 'u-1', active: false }));
    assert.equal(activeAudit.calls[0].eventType, 'identity.user.deactivated');
    assert.equal(activeAudit.calls[0].payload.active, false);

    // reads do not audit
    const readAudit = makeFakeAudit();
    const readImpl = makeAuditImpl(
      routePool([{ re: /FROM identity\.users/, resp: { rows: [USER_ROW] } }]),
      readAudit,
    );
    await runRpc(readImpl, 'listUsers', adminCall({}));
    await runRpc(readImpl, 'getUser', adminCall({ userId: 'u-1' }));
    assert.equal(readAudit.calls.length, 0, 'reads must not audit');
  });

  it('is best-effort: a throwing audit sink does not fail the mutation (AC-8 / design R5)', async () => {
    const pool = routePool([
      { re: /INSERT INTO identity\.users/, resp: { rows: [USER_ROW], rowCount: 1 } },
    ]);
    const throwingAudit = {
      async append() {
        throw new Error('ledger unavailable');
      },
    };
    const impl = makeAuditImpl(pool, throwingAudit);
    const { err, resp } = await runRpc(
      impl,
      'createUser',
      adminCall({ email: 'a@b.c', password: 'x' }),
    );
    assert.equal(err, null, 'mutation still succeeds when the audit throws');
    assert.ok(resp.user);
  });
});

// ---------------------------------------------------------------------------
// Admin cross-user profile metadata (feature 183) — AC-7 / AC-8 / AC-10
// ---------------------------------------------------------------------------

const META_ROW = {
  user_id: 'target-1',
  email: 'target@example.com',
  phone: '+1-555-0100',
  display_name: 'Jane Q',
  metadata: { team: 'quant' },
  metadata_updated_at: new Date('2026-02-02T00:00:00Z'),
};

describe('admin metadata gate (AC-10)', () => {
  for (const m of ['adminGetUserMetadata', 'adminUpdateUserMetadata']) {
    it(`${m} denies a non-admin caller (PERMISSION_DENIED) and runs no query`, async () => {
      const pool = routePool([]);
      const impl = makeAdminImpl(pool);
      const { err } = await runRpc(impl, m, nonAdminCall({ userId: 'target-1', displayName: 'x' }));
      assert.ok(err, `${m} must deny`);
      assert.equal(err.code, 7);
      assert.equal(pool.calls.length, 0, `${m} must not touch the DB when denied`);
    });
  }
});

describe('adminGetUserMetadata (AC-7)', () => {
  it("returns the target's metadata, selected by the request-body user_id (not x-user-id)", async () => {
    const pool = routePool([
      { re: /SELECT .* FROM identity\.users WHERE user_id/, resp: { rows: [META_ROW] } },
    ]);
    const impl = makeAdminImpl(pool);
    const { err, resp } = await runRpc(
      impl,
      'adminGetUserMetadata',
      adminCall({ userId: 'target-1' }, 'admin-9'),
    );
    assert.equal(err, null);
    assert.equal(resp.userMetadata.userId, 'target-1');
    assert.equal(resp.userMetadata.displayName, 'Jane Q');
    assert.equal(resp.userMetadata.phone, '+1-555-0100');
    const sel = pool.calls.find((c) => /FROM identity\.users WHERE user_id/.test(c.sql))!;
    assert.deepEqual(
      sel.params,
      ['target-1'],
      'SELECT parameterized by request user_id, not the admin caller',
    );
  });

  it('returns NOT_FOUND (code 5) for a missing target', async () => {
    const pool = routePool([
      { re: /SELECT .* FROM identity\.users WHERE user_id/, resp: { rows: [] } },
    ]);
    const impl = makeAdminImpl(pool);
    const { err } = await runRpc(impl, 'adminGetUserMetadata', adminCall({ userId: 'ghost' }));
    assert.equal(err.code, 5);
  });

  it('requires user_id (INVALID_ARGUMENT) and emits no audit on read', async () => {
    const audit = makeFakeAudit();
    const impl = makeAuditImpl(routePool([]), audit);
    const { err } = await runRpc(impl, 'adminGetUserMetadata', adminCall({}));
    assert.equal(err.code, 3);
    assert.equal(audit.calls.length, 0, 'reads never audit');
  });
});

describe('adminUpdateUserMetadata (AC-8)', () => {
  it('partial update: display_name only, advances metadata_updated_at, audits acting admin + target (no values)', async () => {
    const pool = routePool([
      {
        re: /UPDATE identity\.users SET .* WHERE user_id/,
        resp: { rows: [{ ...META_ROW, display_name: 'Jane Quant' }], rowCount: 1 },
      },
    ]);
    const audit = makeFakeAudit();
    const impl = makeAuditImpl(pool, audit);
    const { err, resp } = await runRpc(
      impl,
      'adminUpdateUserMetadata',
      adminCall({ userId: 'target-1', displayName: 'Jane Quant' }, 'admin-9'),
    );
    assert.equal(err, null);
    assert.equal(resp.userMetadata.displayName, 'Jane Quant');
    const upd = pool.calls.find((c) => /UPDATE identity\.users SET/.test(c.sql))!;
    assert.ok(/display_name = \$1/.test(upd.sql), 'only display_name in the SET clause');
    assert.ok(!/phone = /.test(upd.sql), 'phone not touched by a display_name-only update');
    assert.ok(/metadata_updated_at = NOW\(\)/.test(upd.sql));
    assert.equal(audit.calls.length, 1);
    assert.equal(audit.calls[0].eventType, 'identity.user.metadata_updated');
    assert.equal(audit.calls[0].payload.acting_admin_user_id, 'admin-9');
    assert.equal(audit.calls[0].payload.target_user_id, 'target-1');
    assert.deepEqual(audit.calls[0].payload.updated_fields, ['displayName']);
    assertNoSecret(audit.calls[0].payload);
    assert.ok(!('metadata' in audit.calls[0].payload), 'no metadata values in the audit payload');
  });

  it('rejects an empty update (INVALID_ARGUMENT) with no DB write', async () => {
    const pool = routePool([]);
    const impl = makeAdminImpl(pool);
    const { err } = await runRpc(
      impl,
      'adminUpdateUserMetadata',
      adminCall({ userId: 'target-1' }),
    );
    assert.equal(err.code, 3);
    assert.equal(pool.calls.length, 0);
  });

  it('returns NOT_FOUND (code 5) for a missing target', async () => {
    const pool = routePool([{ re: /UPDATE identity\.users SET/, resp: { rows: [], rowCount: 0 } }]);
    const impl = makeAdminImpl(pool);
    const { err } = await runRpc(
      impl,
      'adminUpdateUserMetadata',
      adminCall({ userId: 'ghost', phone: '+1' }),
    );
    assert.equal(err.code, 5);
  });

  it('reads user_id via ts-proto camelCase (a snake_case-only user_id is not read → INVALID_ARGUMENT)', async () => {
    const pool = routePool([{ re: /UPDATE/, resp: { rows: [META_ROW], rowCount: 1 } }]);
    const impl = makeAdminImpl(pool);
    const { err } = await runRpc(
      impl,
      'adminUpdateUserMetadata',
      adminCall({ user_id: 'target-1', displayName: 'x' }),
    );
    assert.equal(err.code, 3, 'snake_case user_id must not be read; camelCase required');
  });
});

describe('mapDbError — 8KB metadata CHECK (SQLSTATE 23514) → INVALID_ARGUMENT', () => {
  it('self updateUserMetadata maps 23514 to code 3 (fixes the pre-existing INTERNAL leak)', async () => {
    const e: any = new Error('metadata size');
    e.code = '23514';
    const impl = makeImpl([], e);
    const { err } = await runRpc(
      impl,
      'updateUserMetadata',
      makeCallWithMetadata({ displayName: 'x' }, 'u1'),
    );
    assert.equal(err.code, 3);
    assert.equal(err.message, 'metadata exceeds 8KB limit');
  });

  it('adminUpdateUserMetadata maps 23514 to code 3; a generic error still maps to code 13', async () => {
    const e514: any = new Error('too big');
    e514.code = '23514';
    const impl514 = makeAdminImpl({
      calls: [],
      async query() {
        throw e514;
      },
    } as any);
    const r514 = await runRpc(
      impl514,
      'adminUpdateUserMetadata',
      adminCall({ userId: 'target-1', displayName: 'x' }),
    );
    assert.equal(r514.err.code, 3);
    const eGen: any = new Error('boom');
    const implGen = makeAdminImpl({
      calls: [],
      async query() {
        throw eGen;
      },
    } as any);
    const rGen = await runRpc(
      implGen,
      'adminUpdateUserMetadata',
      adminCall({ userId: 'target-1', phone: '+1' }),
    );
    assert.equal(rGen.err.code, 13);
  });
});

describe('admin metadata handler registration (smoke)', () => {
  it('adminGetUserMetadata / adminUpdateUserMetadata are callable prototype methods', () => {
    assert.equal(typeof IdentityServiceImpl.prototype.adminGetUserMetadata, 'function');
    assert.equal(typeof IdentityServiceImpl.prototype.adminUpdateUserMetadata, 'function');
  });
});
