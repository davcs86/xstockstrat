// Feature 319 @AC-2: RevokeToken acts only on a signature-verified (HS256) token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as jwt from 'jsonwebtoken';
import { IdentityServiceImpl } from '../grpc/identityServiceImpl';
import { install, values } from './fixtures/collectingReader';

const SECRET = 'revoke-319-secret';
process.env.JWT_SECRET = SECRET;

const reader = install();
const config = { getInt: (_key: string, def: number) => def } as any;

const REVOKE_SQL =
  'UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL';

type Query = { sql: string; params: unknown[] | undefined };

function recordingPool(): { pool: any; queries: Query[] } {
  const queries: Query[] = [];
  return {
    queries,
    pool: {
      async query(sql: string, params?: unknown[]) {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    },
  };
}

function revoke(pool: any, token: string): Promise<{ err: any; resp: any }> {
  const impl = new IdentityServiceImpl(pool, config);
  return new Promise((resolve) =>
    impl.revokeToken({ request: { token } }, (err: any, resp: any) => resolve({ err, resp })),
  );
}

function validate(token: string): Promise<any> {
  const impl = new IdentityServiceImpl({} as any, config);
  return new Promise((resolve) =>
    impl.validateToken({ request: { token } }, (err: any) => resolve(err)),
  );
}

async function unverifiable(): Promise<number> {
  return (await values(reader, 'identity.revoke.unverifiable')).reduce((a, b) => a + b, 0);
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const written: string[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: any) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return written.join('');
}

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const UNSIGNED = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ user_id: 'victim-1' })}.`;

async function assertIgnored(token: string): Promise<void> {
  const { pool, queries } = recordingPool();
  const before = await unverifiable();
  const { err, resp } = await revoke(pool, token);
  assert.equal(err, null);
  assert.deepEqual(resp, { success: true });
  assert.equal(queries.length, 0, 'an unverifiable token must not revoke anything');
  assert.equal((await unverifiable()) - before, 1);
}

test('@AC-2 (319) an unsigned token revokes nothing and counts as unverifiable', async () => {
  await assertIgnored(UNSIGNED);
});

test('@AC-2 (319) an expired but correctly signed token still revokes its owner', async () => {
  const expired = jwt.sign(
    { user_id: 'victim-1', exp: Math.floor(Date.now() / 1000) - 60 },
    SECRET,
  );
  const { pool, queries } = recordingPool();
  const before = await unverifiable();
  const { err, resp } = await revoke(pool, expired);
  assert.equal(err, null);
  assert.deepEqual(resp, { success: true });
  assert.deepEqual(queries, [{ sql: REVOKE_SQL, params: ['victim-1'] }]);
  assert.equal((await unverifiable()) - before, 0);
});

test('a token signed with a different secret is ignored', async () => {
  await assertIgnored(jwt.sign({ user_id: 'victim-1' }, 'some-other-secret'));
});

test('an HS384 token is ignored by RevokeToken and rejected by ValidateToken', async () => {
  const hs384 = jwt.sign({ user_id: 'victim-1' }, SECRET, { algorithm: 'HS384' });
  await assertIgnored(hs384);
  assert.deepEqual(await validate(hs384), { code: 16, message: 'invalid or expired token' });
});

test('a garbage token is ignored', async () => {
  await assertIgnored('not-a-jwt');
});

test('a missing JWT_SECRET is an internal error, not an unverifiable token', async () => {
  const token = jwt.sign({ user_id: 'victim-1' }, SECRET);
  const { pool, queries } = recordingPool();
  const before = await unverifiable();
  delete process.env.JWT_SECRET;
  let result: { err: any; resp: any };
  try {
    result = await revoke(pool, token);
  } finally {
    process.env.JWT_SECRET = SECRET;
  }
  assert.equal(result.err?.code, 13);
  assert.equal(queries.length, 0);
  assert.equal((await unverifiable()) - before, 0);
});

test('the unverifiable WARN carries neither the token nor the user id', async () => {
  const { pool } = recordingPool();
  const output = await captureStdout(async () => {
    await revoke(pool, UNSIGNED);
  });
  assert.ok(output.includes('RevokeToken: unverifiable token ignored'), output);
  assert.ok(!output.includes(UNSIGNED), 'the token was logged');
  assert.ok(!output.includes('victim-1'), 'the user id was logged');
});

test('an empty token still succeeds without a query or a count', async () => {
  const { pool, queries } = recordingPool();
  const before = await unverifiable();
  const { err, resp } = await revoke(pool, '');
  assert.equal(err, null);
  assert.deepEqual(resp, { success: true });
  assert.equal(queries.length, 0);
  assert.equal((await unverifiable()) - before, 0);
});
