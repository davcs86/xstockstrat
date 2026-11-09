// Own process (node --test isolates each file): the OTel globals are set once, and initTelemetry()
// must run before the implementation (and its module-level logger) is imported.
import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import * as bcrypt from 'bcrypt';
import { startOtlpReceiver, waitFor } from './fixtures/otlpReceiver';

mock.method(console, 'info', () => {});

const PASSWORD = 'Hunter2!Plain';
const otlp = startOtlpReceiver();
let SEED_ADMIN_PASSWORD_HASH: string;
let IdentityServiceImpl: any;

before(async () => {
  const port = await otlp.listen();
  process.env.OTEL_ENABLED = 'true';
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${port}/otlp`;
  process.env.OTEL_BLRP_SCHEDULE_DELAY = '50';
  process.env.JWT_SECRET = 'otlp-test-jwt-secret';
  const { initTelemetry } = await import('../telemetry');
  initTelemetry();
  const mod = await import('../grpc/identityServiceImpl.js');
  IdentityServiceImpl = mod.IdentityServiceImpl;
  SEED_ADMIN_PASSWORD_HASH = mod.SEED_ADMIN_PASSWORD_HASH;
});

after(async () => {
  const { shutdownTelemetry } = await import('../telemetry');
  await shutdownTelemetry();
  otlp.close();
});

function impl(userRow: Record<string, unknown>) {
  const pool = {
    async query(sql: string) {
      return { rows: sql.includes('SELECT user_id, password_hash') ? [userRow] : [] };
    },
  };
  return new IdentityServiceImpl(pool, { getInt: (_k: string, d: number) => d } as any);
}

function call(email: string, password: string) {
  return { request: { email, password } };
}

const logBodies = () => otlp.at('/v1/logs').map((r) => r.body);

// AC-20: PII removed at source, so it is absent from the exported record too.
test('the exported seed-admin refusal record carries user_id and not the email', async () => {
  const prev = process.env.APPLICATION_ENV;
  process.env.APPLICATION_ENV = 'production';
  try {
    await new Promise<void>((resolve) =>
      impl({
        user_id: 'u-admin',
        password_hash: SEED_ADMIN_PASSWORD_HASH,
        roles: ['admin'],
      }).authenticateUser(call('admin@localhost', 'admin'), () => resolve()),
    );
  } finally {
    if (prev === undefined) delete process.env.APPLICATION_ENV;
    else process.env.APPLICATION_ENV = prev;
  }
  const has = () => logBodies().some((b) => b.includes('Refused default seed-admin login'));
  assert.ok(await waitFor(has), 'the refusal record was not exported');
  const body = logBodies().find((b) => b.includes('Refused default seed-admin login'))!;
  assert.ok(body.includes('u-admin'), 'user_id missing from the exported record');
  assert.ok(!body.includes('admin@localhost'), 'the email was exported');
});

// AC-13: authentication logging exports neither the submitted password nor an issued token.
test('a served authenticateUser exports no password or token in any log record', async () => {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const result: any = await new Promise((resolve) =>
    impl({ user_id: 'u-1', password_hash: hash, roles: ['trader'] }).authenticateUser(
      call('someone@example.com', PASSWORD),
      (err: unknown, res: unknown) => resolve({ err, res }),
    ),
  );
  assert.equal(result.err, null);
  assert.ok(result.res.accessToken && result.res.refreshToken, 'tokens were issued');
  const has = () => logBodies().some((b) => b.includes('User authenticated'));
  assert.ok(await waitFor(has), 'the success record was not exported');
  await new Promise((r) => setTimeout(r, 300));
  for (const b of logBodies()) {
    assert.ok(!b.includes(PASSWORD), 'password exported');
    assert.ok(!b.includes(result.res.accessToken), 'access token exported');
    assert.ok(!b.includes(result.res.refreshToken), 'refresh token exported');
  }
});
