// Feature 294 identity signals. Own file: the once-per-process "JWT secret missing" ERROR has no reset seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as jwt from 'jsonwebtoken';
import * as grpc from '@grpc/grpc-js';
import { LedgerServiceClient } from '@xstockstrat/proto/ledger/v1/ledger';
import { IdentityServiceImpl } from '../grpc/identityServiceImpl';
import { createLedgerAudit } from '../grpc/ledgerAudit';
import * as mtls from '../mtls';
import { counterValue, install, points } from './fixtures/collectingReader';
import { fakeConfig } from './fixtures/fakeConfig';
import { callWith } from './fixtures/sanCall';

const reader = install();
const config = fakeConfig();

function validate(token: string): Promise<{ code: number; message: string }> {
  const impl = new IdentityServiceImpl({} as any, config);
  return new Promise((resolve) =>
    impl.validateToken({ request: { token } }, (err: any) => resolve(err)),
  );
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

const validateFailures = (reason: string) =>
  counterValue(reader, 'identity.token.validate_failures', 'reason', reason);

test('@AC-23 classifies expired, invalid and secret_missing; only the missing secret logs, once', async () => {
  process.env.JWT_SECRET = 'ac23-secret';
  const expired = jwt.sign(
    { user_id: 'u1', exp: Math.floor(Date.now() / 1000) - 60 },
    'ac23-secret',
  );
  const responses: Array<{ code: number; message: string }> = [];

  const perCallOutput = await captureStdout(async () => {
    responses.push(await validate(expired));
    responses.push(await validate('not.a.valid.jwt'));
  });
  assert.equal(await validateFailures('expired'), 1);
  assert.equal(await validateFailures('invalid'), 1);
  assert.equal(perCallOutput, '', 'expired and invalid tokens must not log per call');

  delete process.env.JWT_SECRET;
  let missingOutput: string;
  try {
    missingOutput = await captureStdout(async () => {
      responses.push(await validate(expired));
      responses.push(await validate(expired));
    });
  } finally {
    process.env.JWT_SECRET = 'ac23-secret';
  }
  assert.equal(await validateFailures('secret_missing'), 2);
  const errors = missingOutput
    .split('\n')
    .filter((l) => /error/.test(l) && /ValidateToken: JWT secret missing/.test(l));
  assert.equal(errors.length, 1, `expected one ERROR, got: ${missingOutput}`);
  assert.ok(!missingOutput.includes(expired), 'the token was logged');

  for (const r of responses) assert.deepEqual(r, { code: 16, message: 'invalid or expired token' });
});

test('@AC-24 a failed audit append is counted and timed, and AppendEvent gets no deadline', async () => {
  const proto = LedgerServiceClient.prototype as any;
  const originalAppend = proto.appendEvent;
  const originalCredentials = mtls.clientCredentials;
  const calls: unknown[][] = [];
  (mtls as any).clientCredentials = () => grpc.credentials.createInsecure();
  proto.appendEvent = (...args: unknown[]) => {
    calls.push(args);
    (args[args.length - 1] as (err: Error) => void)(new Error('ledger unavailable'));
  };
  try {
    const audit = createLedgerAudit('localhost:1');
    await audit.append('identity.user.created', 'u-1', undefined, { roles: ['trader'] });
  } finally {
    proto.appendEvent = originalAppend;
    (mtls as any).clientCredentials = originalCredentials;
  }

  assert.equal(
    await counterValue(reader, 'identity.audit.failures', 'event_type', 'identity.user.created'),
    1,
  );
  const durations = await points(reader, 'identity.audit.append.duration');
  assert.equal(
    durations.reduce((n, p) => n + ((p.value as { count?: number }).count ?? 0), 0),
    1,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 3, 'AppendEvent must be called as (request, metadata, callback)');
  assert.ok(calls[0][1] instanceof grpc.Metadata);
  assert.ok(
    !calls[0].some((a) => a !== null && typeof a === 'object' && 'deadline' in (a as object)),
    'AppendEvent call options carry a deadline',
  );
});

test('@AC-28 a failed audit of a successful link still answers OK and counts identity.external.linked', async () => {
  const proto = LedgerServiceClient.prototype as any;
  const originalAppend = proto.appendEvent;
  const originalCredentials = mtls.clientCredentials;
  (mtls as any).clientCredentials = () => grpc.credentials.createInsecure();
  proto.appendEvent = (...args: unknown[]) => {
    (args[args.length - 1] as (err: Error) => void)(new Error('ledger unavailable'));
  };
  const prevEnv = process.env.APPLICATION_ENV;
  delete process.env.APPLICATION_ENV;
  const { SEED_ADMIN_PASSWORD_HASH } = await import('../grpc/identityServiceImpl');
  const rows = [
    [{ user_id: 'u1', email: 'u@example.com', password_hash: SEED_ADMIN_PASSWORD_HASH, roles: [], is_active: true }],
    [],
  ];
  const pool = { query: async () => ({ rows: rows.shift() ?? [] }) } as any;
  const impl = new IdentityServiceImpl(
    pool,
    fakeConfig({ strings: { 'auth.mode': 'both' } }),
    createLedgerAudit('localhost:1'),
  );
  let output = '';
  let reply: unknown = 'unset';
  try {
    output = await captureStdout(async () => {
      reply = await new Promise((resolve) =>
        impl.linkExternalIdentity(
          {
            ...callWith('DNS:xstockstrat-ui'),
            request: { userId: 'u1', issuer: 'https://auth.example.test', subject: 's', password: 'admin' },
          },
          (err: any) => resolve(err ?? null),
        ),
      );
      await new Promise(setImmediate);
      await new Promise(setImmediate);
    });
  } finally {
    proto.appendEvent = originalAppend;
    (mtls as any).clientCredentials = originalCredentials;
    if (prevEnv === undefined) delete process.env.APPLICATION_ENV;
    else process.env.APPLICATION_ENV = prevEnv;
  }
  assert.equal(reply, null, 'the link answers OK despite the audit failure');
  assert.equal(
    await counterValue(reader, 'identity.audit.failures', 'event_type', 'identity.external.linked'),
    1,
  );
  assert.ok(/ledger audit append failed \(best-effort\)/.test(output), 'the ERROR was logged');
});
