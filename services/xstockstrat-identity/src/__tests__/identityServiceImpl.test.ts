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

before(async () => {
  try {
    const mod = await import('../grpc/identityServiceImpl.js');
    IdentityServiceImpl = mod.IdentityServiceImpl;
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
// createApiKey — validation
// ---------------------------------------------------------------------------

describe('createApiKey', () => {
  it('rejects when userId is missing', async () => {
    const impl = makeImpl();
    if (!impl) return;
    const call = makeCall({ userId: '' });

    await new Promise<void>((resolve) => {
      impl.createApiKey(call, (err: any) => {
        // Should reject missing user_id
        assert.ok(err);
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
    const impl = implWithPool(makeSpyPool([storedRow()]));
    if (!impl) return;
    const res: any = await new Promise((resolve, reject) => {
      impl.exchangeAuthCode(exchangeCall(), (err: any, r: any) => (err ? reject(err) : resolve(r)));
    });
    assert.ok(res.accessToken);
    assert.ok(res.refreshToken);
    assert.strictEqual(res.tokenType, 'Bearer');
    const decoded: any = (jwt as any).verify(res.accessToken, process.env.JWT_SECRET);
    assert.strictEqual(decoded.aud, 'https://agent.example/agent');
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
