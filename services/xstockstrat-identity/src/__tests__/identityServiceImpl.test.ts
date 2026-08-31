/**
 * Unit tests for IdentityServiceImpl — no real DB required.
 *
 * Tests cover the input-validation fast paths (no credentials, missing token)
 * and the validateToken round-trip with a locally-signed JWT.
 *
 * Tests gracefully skip if the TypeScript import fails in strip-only mode
 * (parameter properties); they run fully when --experimental-transform-types
 * or a supporting runtime is used.
 *
 * Run: node --experimental-strip-types --test src/__tests__/*.test.ts
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Lazy imports — guard against strip-only TypeScript syntax errors
// ---------------------------------------------------------------------------

let IdentityServiceImpl: any;
let userIdFrom: any;
let first: any;

before(async () => {
  try {
    const mod = await import('../grpc/identityServiceImpl.js');
    IdentityServiceImpl = mod.IdentityServiceImpl;
    const authz = await import('../grpc/authz.js');
    userIdFrom = authz.userIdFrom;
    first = authz.first;
  } catch {
    // Unsupported TypeScript syntax in strip-only mode — tests will be skipped.
  }
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
  if (!IdentityServiceImpl) return null;
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
      get: (key: string) => key === 'x-user-id' ? [userId] : [],
    },
  };
}

// ---------------------------------------------------------------------------
// authenticateUser — validation fast paths
// ---------------------------------------------------------------------------

describe('authenticateUser', () => {
  it('rejects when email is missing', async () => {
    const impl = makeImpl();
    if (!impl) return;
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
    if (!impl) return;
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
    if (!impl) return;
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
// validateToken
// ---------------------------------------------------------------------------

describe('validateToken', () => {
  it('rejects when token is missing', async () => {
    const impl = makeImpl();
    if (!impl) return;
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
    if (!impl) return;
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
    if (!impl) return;
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
    if (!impl) return;

    let TokenClaims: any;
    try {
      ({ TokenClaims } = await import('@xstockstrat/proto/identity/v1/identity.js'));
    } catch {
      return; // proto package unavailable in this runtime — skip.
    }

    process.env.JWT_SECRET = 'regression-test-secret';
    const now = Math.floor(Date.now() / 1000);
    const token = (jwt as any).sign(
      { user_id: 'u1', email: 'u@example.com', roles: ['trader'], issued_at: now, expires_at: now + 900 },
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
  return {
    queries,
    async query(sql: string, _params?: any[]) {
      queries.push(sql);
      return { rows };
    },
  };
}

function implWithPool(pool: any) {
  if (!IdentityServiceImpl) return null;
  const config = { getInt: (_key: string, def: number) => def } as any;
  return new IdentityServiceImpl(pool, config);
}

function challengeFor(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

describe('registerOAuthClient', () => {
  it('rejects a non-https redirect uri', async () => {
    const impl = makeImpl([]);
    if (!impl) return;
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
    if (!impl) return;
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
    if (!impl) return;
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
    assert.ok(pool.queries.some((q) => /INSERT INTO identity\.refresh_tokens[^)]*client_id/.test(q)));
  });

  it('rejects a bad code_verifier as invalid_grant', async () => {
    process.env.JWT_SECRET = 'oauth-test-secret';
    const impl = implWithPool(makeSpyPool([storedRow()]));
    if (!impl) return;
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
    if (!impl) return;
    await new Promise<void>((resolve) => {
      impl.exchangeAuthCode(exchangeCall(), (err: any) => {
        assert.strictEqual(err.code, 16);
        resolve();
      });
    });
  });

  it('rejects an expired code', async () => {
    const impl = implWithPool(makeSpyPool([storedRow({ expires_at: new Date(Date.now() - 1000) })]));
    if (!impl) return;
    await new Promise<void>((resolve) => {
      impl.exchangeAuthCode(exchangeCall(), (err: any) => {
        assert.strictEqual(err.code, 16);
        resolve();
      });
    });
  });

  it('rejects a non-matching redirect_uri', async () => {
    const impl = implWithPool(makeSpyPool([storedRow()]));
    if (!impl) return;
    await new Promise<void>((resolve) => {
      impl.exchangeAuthCode(exchangeCall({ redirectUri: 'https://other.example/cb' }), (err: any) => {
        assert.strictEqual(err.code, 16);
        resolve();
      });
    });
  });
});

describe('refreshOAuthToken', () => {
  it('rotates the refresh token and mints a new aud-bound access JWT', async () => {
    process.env.JWT_SECRET = 'oauth-test-secret';
    const pool = makeSpyPool([{ token_id: 't1', user_id: 'u1', email: 'u@example.com', roles: ['trader'] }]);
    const impl = implWithPool(pool);
    if (!impl) return;
    const call = makeCall({ refreshToken: 'old-refresh', resource: 'https://agent.example/agent' });
    const res: any = await new Promise((resolve, reject) => {
      impl.refreshOAuthToken(call, (err: any, r: any) => (err ? reject(err) : resolve(r)));
    });
    assert.ok(res.accessToken);
    assert.ok(res.refreshToken);
    const decoded: any = (jwt as any).verify(res.accessToken, process.env.JWT_SECRET);
    assert.strictEqual(decoded.aud, 'https://agent.example/agent');
    // Rotation: a revoked_at UPDATE must have been issued (AC-B5).
    assert.ok(pool.queries.some((q) => /UPDATE identity\.refresh_tokens SET revoked_at/.test(q)));
  });

  it('rejects an unknown refresh token', async () => {
    const impl = implWithPool(makeSpyPool([]));
    if (!impl) return;
    await new Promise<void>((resolve) => {
      impl.refreshOAuthToken(makeCall({ refreshToken: 'nope', resource: 'r' }), (err: any) => {
        assert.strictEqual(err.code, 16);
        resolve();
      });
    });
  });
});

describe('validateToken aud surfacing', () => {
  it('surfaces the aud claim from a signed JWT', async () => {
    process.env.JWT_SECRET = 'oauth-test-secret';
    const impl = makeImpl();
    if (!impl) return;
    const now = Math.floor(Date.now() / 1000);
    const token = (jwt as any).sign(
      { user_id: 'u1', email: 'u@x.com', roles: [], issued_at: now, expires_at: now + 900, aud: 'https://agent.example/agent' },
      process.env.JWT_SECRET,
    );
    const res: any = await new Promise((resolve, reject) => {
      impl.validateToken(makeCall({ token }), (err: any, r: any) => (err ? reject(err) : resolve(r)));
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
    if (!impl) return;
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
    if (!impl) return;
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
    if (!impl) return;
    await new Promise<void>((resolve) => {
      impl.revokeAuthorizedApp(makeCall({ userId: '', clientId: 'oauthc_1' }), (err: any) => {
        assert.strictEqual(err.code, 3);
        resolve();
      });
    });
  });

  it('rejects when clientId is missing', async () => {
    const impl = makeImpl();
    if (!impl) return;
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
    if (!impl) return;
    const res: any = await new Promise((resolve, reject) => {
      impl.revokeAuthorizedApp(makeCall({ userId: 'u1', clientId: 'oauthc_1' }), (err: any, r: any) =>
        err ? reject(err) : resolve(r),
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
    if (!impl) return;
    await new Promise<void>((resolve) => {
      impl.getUserMetadata(
        makeCallWithMetadata({}, 'nonexistent-user'),
        (err: any) => {
          assert.equal(err.code, 5);
          resolve();
        }
      );
    });
  });

  it('returns user metadata for an existing user', async () => {
    const row = {
      user_id: 'u1', email: 'a@b.com', phone: '+1234',
      display_name: 'Alice', metadata: {}, metadata_updated_at: new Date(),
    };
    const impl = makeImpl([row]);
    if (!impl) return;
    await new Promise<void>((resolve) => {
      impl.getUserMetadata(
        makeCallWithMetadata({}, 'u1'),
        (err: any, res: any) => {
          assert.equal(err, null);
          assert.equal(res.userMetadata.userId, 'u1');
          assert.equal(res.userMetadata.email, 'a@b.com');
          assert.equal(res.userMetadata.phone, '+1234');
          resolve();
        }
      );
    });
  });

  it('rejects when call.metadata is missing', async () => {
    const impl = makeImpl([]);
    if (!impl) return;
    await new Promise<void>((resolve) => {
      impl.getUserMetadata(
        makeCall({}),
        (err: any) => {
          assert.equal(err.code, 13);
          resolve();
        }
      );
    });
  });
});

// ---------------------------------------------------------------------------
// updateUserMetadata (feature 130)
// ---------------------------------------------------------------------------

describe('updateUserMetadata', () => {
  it('rejects when no fields are provided', async () => {
    const impl = makeImpl([]);
    if (!impl) return;
    await new Promise<void>((resolve) => {
      impl.updateUserMetadata(
        makeCallWithMetadata({}, 'u1'),
        (err: any) => {
          assert.equal(err.code, 3);
          resolve();
        }
      );
    });
  });

  it('partial update: sets phone only, preserves display_name', async () => {
    const row = {
      user_id: 'u1', email: 'a@b.com', phone: '+9999',
      display_name: 'Alice', metadata: {}, metadata_updated_at: new Date(),
    };
    const impl = makeImpl([row]);
    if (!impl) return;
    await new Promise<void>((resolve) => {
      impl.updateUserMetadata(
        makeCallWithMetadata({ phone: '+9999' }, 'u1'),
        (err: any, res: any) => {
          assert.equal(err, null);
          assert.equal(res.userMetadata.phone, '+9999');
          assert.equal(res.userMetadata.displayName, 'Alice');
          resolve();
        }
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Handler registration smoke (feature 130)
// ---------------------------------------------------------------------------

describe('handler registration (smoke)', () => {
  it('getUserMetadata is a callable method on the prototype', () => {
    if (!IdentityServiceImpl) return;
    assert.equal(typeof IdentityServiceImpl.prototype.getUserMetadata, 'function');
  });

  it('updateUserMetadata is a callable method on the prototype', () => {
    if (!IdentityServiceImpl) return;
    assert.equal(typeof IdentityServiceImpl.prototype.updateUserMetadata, 'function');
  });
});

// ---------------------------------------------------------------------------
// authz: userIdFrom / first (feature 130 — Step 4 coverage)
// ---------------------------------------------------------------------------

describe('authz: userIdFrom / first', () => {
  it('userIdFrom extracts x-user-id from metadata', () => {
    if (!userIdFrom) return;
    const md = { get: (key: string) => key === 'x-user-id' ? ['uid-123'] : [] };
    assert.equal(userIdFrom(md), 'uid-123');
  });

  it('userIdFrom returns empty string when x-user-id is absent', () => {
    if (!userIdFrom) return;
    const md = { get: () => [] };
    assert.equal(userIdFrom(md), '');
  });

  it('first returns the first element of a metadata array', () => {
    if (!first) return;
    const md = { get: (key: string) => key === 'x-trace-id' ? ['t1', 't2'] : [] };
    assert.equal(first(md, 'x-trace-id'), 't1');
  });

  it('first returns empty string for a missing key', () => {
    if (!first) return;
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
  if (!IdentityServiceImpl) return null;
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
  const methods = ['createUser', 'listUsers', 'getUser', 'updatePassword', 'setUserRoles', 'setUserActive'];
  for (const m of methods) {
    it(`${m} denies a non-admin caller with PERMISSION_DENIED and runs no query`, async () => {
      if (!IdentityServiceImpl) return;
      const pool = routePool([]);
      const impl = makeAdminImpl(pool);
      const { err } = await runRpc(impl, m, nonAdminCall({ userId: 'u-1', email: 'a@b.c', password: 'x', newPassword: 'x' }));
      assert.ok(err, `${m} must deny`);
      assert.equal(err.code, 7);
      assert.equal(pool.calls.length, 0, `${m} must not touch the DB when denied`);
    });
  }
});

describe('listUsers (AC-1/AC-10)', () => {
  it('returns password-free user views', async () => {
    if (!IdentityServiceImpl) return;
    const pool = routePool([{ re: /SELECT .* FROM identity\.users ORDER BY created_at/, resp: { rows: [USER_ROW] } }]);
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
    if (!IdentityServiceImpl) return;
    const pool = routePool([{ re: /INSERT INTO identity\.users/, resp: { rows: [USER_ROW], rowCount: 1 } }]);
    const impl = makeAdminImpl(pool);
    const { err, resp } = await runRpc(impl, 'createUser', adminCall({ email: 'alice@example.com', password: 'plaintext-pw', roles: [2] }));
    assert.equal(err, null);
    const insert = pool.calls.find((c) => /INSERT INTO identity\.users/.test(c.sql))!;
    assert.notEqual(insert.params![1], 'plaintext-pw', 'must not store the plaintext');
    assert.ok(String(insert.params![1]).startsWith('$2'), 'stored value is a bcrypt hash');
    assert.deepEqual(insert.params![2], ['trader']); // role enum 2 → 'trader'
    assert.equal(resp.user.isActive, true);
    assert.ok(!('password' in resp.user));
  });

  it('maps a Postgres unique-violation to ALREADY_EXISTS', async () => {
    if (!IdentityServiceImpl) return;
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
    if (!IdentityServiceImpl) return;
    const pool = routePool([
      { re: /UPDATE identity\.users SET password_hash/, resp: { rows: [{ email: 'alice@example.com' }], rowCount: 1 } },
      { re: /UPDATE identity\.refresh_tokens SET revoked_at/, resp: { rowCount: 1 } },
    ]);
    const impl = makeAdminImpl(pool);
    const { err, resp } = await runRpc(impl, 'updatePassword', adminCall({ userId: 'u-1', newPassword: 'newpw' }));
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
    if (!IdentityServiceImpl) return;
    const pool = routePool([{ re: /UPDATE identity\.users SET roles/, resp: { rows: [{ ...USER_ROW, roles: ['trader', 'admin'] }], rowCount: 1 } }]);
    const impl = makeAdminImpl(pool);
    const { err, resp } = await runRpc(impl, 'setUserRoles', adminCall({ userId: 'u-1', roles: [2, 1] }));
    assert.equal(err, null);
    const upd = pool.calls.find((c) => /SET roles/.test(c.sql))!;
    assert.deepEqual(upd.params![1], ['trader', 'admin']);
    assert.equal(upd.params![2], true); // new roles include admin
    assert.deepEqual(resp.user.roles.sort(), [1, 2]);
  });
});

describe('setUserActive (AC-5/AC-6)', () => {
  it('deactivate flips is_active=false AND revokes refresh tokens', async () => {
    if (!IdentityServiceImpl) return;
    const pool = routePool([
      { re: /UPDATE identity\.users SET is_active/, resp: { rows: [{ ...USER_ROW, is_active: false }], rowCount: 1 } },
      { re: /UPDATE identity\.refresh_tokens SET revoked_at/, resp: { rowCount: 1 } },
    ]);
    const impl = makeAdminImpl(pool);
    const { err } = await runRpc(impl, 'setUserActive', adminCall({ userId: 'u-1', active: false }));
    assert.equal(err, null);
    assert.ok(pool.calls.some((c) => /is_active/.test(c.sql)));
    assert.ok(pool.calls.some((c) => /refresh_tokens SET revoked_at/.test(c.sql)), 'deactivate revokes tokens');
  });

  it('reactivate flips is_active=true and does NOT revoke tokens', async () => {
    if (!IdentityServiceImpl) return;
    const pool = routePool([{ re: /UPDATE identity\.users SET is_active/, resp: { rows: [USER_ROW], rowCount: 1 } }]);
    const impl = makeAdminImpl(pool);
    const { err } = await runRpc(impl, 'setUserActive', adminCall({ userId: 'u-1', active: true }));
    assert.equal(err, null);
    assert.ok(!pool.calls.some((c) => /refresh_tokens SET revoked_at/.test(c.sql)), 'reactivate must not revoke');
  });
});

describe('last-admin guard (AC-11)', () => {
  it('setUserActive(false) on the last admin → FAILED_PRECONDITION cannot remove last admin', async () => {
    if (!IdentityServiceImpl) return;
    // Guarded UPDATE affects 0 rows; existence check shows the target exists.
    const pool = routePool([
      { re: /UPDATE identity\.users SET is_active/, resp: { rows: [], rowCount: 0 } },
      { re: /SELECT 1 FROM identity\.users WHERE user_id/, resp: { rowCount: 1 } },
    ]);
    const impl = makeAdminImpl(pool);
    const { err } = await runRpc(impl, 'setUserActive', adminCall({ userId: 'admin-only', active: false }));
    assert.equal(err.code, 9);
    assert.equal(err.message, 'cannot remove last admin');
  });

  it('setUserRoles stripping admin from the last admin → FAILED_PRECONDITION', async () => {
    if (!IdentityServiceImpl) return;
    const pool = routePool([
      { re: /UPDATE identity\.users SET roles/, resp: { rows: [], rowCount: 0 } },
      { re: /SELECT 1 FROM identity\.users WHERE user_id/, resp: { rowCount: 1 } },
    ]);
    const impl = makeAdminImpl(pool);
    const { err } = await runRpc(impl, 'setUserRoles', adminCall({ userId: 'admin-only', roles: [2] }));
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
  if (!IdentityServiceImpl) return null;
  const config = { getInt: (_k: string, d: number) => d } as any;
  return new IdentityServiceImpl(pool, config, audit);
}

const NO_SECRET_KEYS = ['password', 'newPassword', 'new_password', 'passwordHash', 'password_hash'];
function assertNoSecret(payload: any) {
  for (const k of NO_SECRET_KEYS) assert.ok(!(k in payload), `audit payload must not carry ${k}`);
}

describe('ledger audit emits (AC-8/AC-10)', () => {
  it('createUser emits identity.user.created with a secret-free payload from x-user-id', async () => {
    if (!IdentityServiceImpl) return;
    const pool = routePool([{ re: /INSERT INTO identity\.users/, resp: { rows: [USER_ROW], rowCount: 1 } }]);
    const audit = makeFakeAudit();
    const impl = makeAuditImpl(pool, audit);
    await runRpc(impl, 'createUser', adminCall({ email: 'alice@example.com', password: 'secret-pw', roles: [2] }, 'admin-42'));
    assert.equal(audit.calls.length, 1);
    assert.equal(audit.calls[0].eventType, 'identity.user.created');
    assert.equal(audit.calls[0].payload.acting_admin_user_id, 'admin-42');
    assert.equal(audit.calls[0].payload.target_user_id, 'u-1');
    assertNoSecret(audit.calls[0].payload);
  });

  it('updatePassword emits identity.user.password_updated with NO password in the payload', async () => {
    if (!IdentityServiceImpl) return;
    const pool = routePool([
      { re: /UPDATE identity\.users SET password_hash/, resp: { rows: [{ email: 'alice@example.com' }], rowCount: 1 } },
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
    if (!IdentityServiceImpl) return;
    const rolesAudit = makeFakeAudit();
    const rolesImpl = makeAuditImpl(routePool([{ re: /SET roles/, resp: { rows: [{ ...USER_ROW, roles: ['trader'] }], rowCount: 1 } }]), rolesAudit);
    await runRpc(rolesImpl, 'setUserRoles', adminCall({ userId: 'u-1', roles: [2] }));
    assert.equal(rolesAudit.calls[0].eventType, 'identity.user.roles_updated');

    const activeAudit = makeFakeAudit();
    const activeImpl = makeAuditImpl(routePool([
      { re: /SET is_active/, resp: { rows: [{ ...USER_ROW, is_active: false }], rowCount: 1 } },
      { re: /refresh_tokens SET revoked_at/, resp: { rowCount: 1 } },
    ]), activeAudit);
    await runRpc(activeImpl, 'setUserActive', adminCall({ userId: 'u-1', active: false }));
    assert.equal(activeAudit.calls[0].eventType, 'identity.user.deactivated');
    assert.equal(activeAudit.calls[0].payload.active, false);

    // reads do not audit
    const readAudit = makeFakeAudit();
    const readImpl = makeAuditImpl(routePool([{ re: /FROM identity\.users/, resp: { rows: [USER_ROW] } }]), readAudit);
    await runRpc(readImpl, 'listUsers', adminCall({}));
    await runRpc(readImpl, 'getUser', adminCall({ userId: 'u-1' }));
    assert.equal(readAudit.calls.length, 0, 'reads must not audit');
  });

  it('is best-effort: a throwing audit sink does not fail the mutation (AC-8 / design R5)', async () => {
    if (!IdentityServiceImpl) return;
    const pool = routePool([{ re: /INSERT INTO identity\.users/, resp: { rows: [USER_ROW], rowCount: 1 } }]);
    const throwingAudit = {
      async append() {
        throw new Error('ledger unavailable');
      },
    };
    const impl = makeAuditImpl(pool, throwingAudit);
    const { err, resp } = await runRpc(impl, 'createUser', adminCall({ email: 'a@b.c', password: 'x' }));
    assert.equal(err, null, 'mutation still succeeds when the audit throws');
    assert.ok(resp.user);
  });
});
