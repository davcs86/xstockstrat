// Commsgun app-key resolver tests (feature 338). The config client and the watcher are fakes; the
// logger is replaced before the module under test loads, so every log call it makes is captured.
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as grpc from '@grpc/grpc-js';
import { Environment } from '@xstockstrat/proto/common/v1/common';
import loggerModule = require('../services/logger');

type SecretModule = typeof import('../services/commsgunSecret');

const KEY_A = 'old-key-0123456789abcdef0123456789';
const KEY_B = 'new-key-0123456789abcdef0123456789';
const PROD_KEY = 'prod-key-0123456789abcdef0123456789ab';
const STAGING_KEY = 'stag-key-0123456789abcdef0123456789ab';

const records: unknown[] = [];
const capture = (level: string) => (msg: unknown, meta?: unknown) => {
  records.push({ level, msg: String(msg), meta });
};
const fakeLog = { debug: capture('debug'), info: capture('info'), warn: capture('warn'), error: capture('error') };

let mod: SecretModule;

before(async () => {
  Object.assign(loggerModule, { getLogger: () => fakeLog });
  mod = await import('../services/commsgunSecret');
});

afterEach(() => {
  records.length = 0;
  delete process.env.APPLICATION_ENV;
});

interface RecordedCall {
  req: { namespace: string; key: string; environment: Environment; userId: string };
  md: grpc.Metadata;
  opts: grpc.CallOptions;
  at: number;
  found(value: string): void;
  notFound(): void;
  fail(code: grpc.status | undefined): void;
}

function fakeClient(): { client: import('../services/commsgunSecret').CommsgunSecretClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client = {
    getSecret(req: any, md: grpc.Metadata, opts: grpc.CallOptions, cb: (err: unknown, resp?: unknown) => void) {
      calls.push({
        req,
        md,
        opts,
        at: Date.now(),
        found: (value) => cb(null, { value, found: true }),
        notFound: () => cb(null, { value: '', found: false }),
        fail: (code) => cb(Object.assign(new Error('rpc failed'), code === undefined ? {} : { code })),
      });
    },
  } as unknown as import('../services/commsgunSecret').CommsgunSecretClient;
  return { client, calls };
}

class FakeWatcher extends EventEmitter {
  private snap: { version: string } | null;
  constructor(version: string | null = '7') {
    super();
    this.snap = version === null ? null : { version };
  }
  getSnapshot(): { version: string } | null {
    return this.snap;
  }
  update(version: string): void {
    this.snap = { version };
    this.emit('update', this.snap);
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Starts a resolver whose boot resolve is answered by `answer`. */
async function started(answer: (call: RecordedCall) => void, version = '7') {
  const { client, calls } = fakeClient();
  const watcher = new FakeWatcher(version);
  const secret = mod.createCommsgunSecret(watcher, 'config:50060', client);
  const boot = secret.start();
  await settle();
  assert.equal(calls.length, 1, 'start() must make the boot resolve');
  answer(calls[0]);
  await boot;
  return { secret, watcher, calls };
}

function assertNoKeyInLogs(): void {
  const dump = JSON.stringify(records);
  for (const key of [KEY_A, KEY_B, PROD_KEY, STAGING_KEY]) {
    assert.ok(!dump.includes(key), 'a log record contains a key value');
  }
}

describe('commsgunSecret test harness', () => {
  it('imports the module under test', () => {
    assert.equal(typeof mod.createCommsgunSecret, 'function');
    assert.equal(typeof mod.resolveCommsgunAppKey, 'function');
  });
});

describe('resolveCommsgunAppKey request', () => {
  it('asks for notify / commsgun.app_key at global scope as the internal caller notify, with a deadline', async () => {
    const { client, calls } = fakeClient();
    const before = Date.now();
    const pending = mod.resolveCommsgunAppKey(client);
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.req.namespace, 'notify');
    assert.equal(call.req.key, 'commsgun.app_key');
    assert.equal(call.req.userId, '');
    assert.deepEqual(call.md.get('x-internal-caller'), ['notify']);
    const deadline = Number(call.opts.deadline);
    assert.ok(deadline >= before + mod.COMMSGUN_SECRET_DEADLINE_MS, 'deadline too early');
    assert.ok(deadline <= Date.now() + mod.COMMSGUN_SECRET_DEADLINE_MS, 'deadline beyond the constant');
    call.found(KEY_A);
    assert.deepEqual(await pending, { found: true, value: KEY_A });
  });

  for (const [appEnv, want] of [
    ['production', Environment.ENVIRONMENT_PRODUCTION],
    ['staging', Environment.ENVIRONMENT_STAGING],
    ['development', Environment.ENVIRONMENT_STAGING],
    [undefined, Environment.ENVIRONMENT_STAGING],
  ] as const) {
    it(`@AC-24 APPLICATION_ENV=${appEnv} resolves the ${want} key only`, async () => {
      if (appEnv === undefined) delete process.env.APPLICATION_ENV;
      else process.env.APPLICATION_ENV = appEnv;
      const { secret } = await started((call) => {
        // Each environment's secret differs; the answer follows the environment that was asked for.
        call.found(call.req.environment === Environment.ENVIRONMENT_PRODUCTION ? PROD_KEY : STAGING_KEY);
      });
      const expected = want === Environment.ENVIRONMENT_PRODUCTION ? PROD_KEY : STAGING_KEY;
      assert.deepEqual(secret.state(), { kind: 'key', value: expected });
    });
  }
});

describe('commsgun key state', () => {
  it('is unknown before the first resolve', () => {
    const { client } = fakeClient();
    const secret = mod.createCommsgunSecret(new FakeWatcher(), 'config:50060', client);
    assert.deepEqual(secret.state(), { kind: 'unknown' });
    assert.deepEqual(secret.failures(), { count: 0, statusClass: '' });
  });

  it('found=true is key; found=false is absent; an empty value is absent', async () => {
    assert.deepEqual((await started((c) => c.found(KEY_A))).secret.state(), { kind: 'key', value: KEY_A });
    assert.deepEqual((await started((c) => c.notFound())).secret.state(), { kind: 'absent' });
    assert.deepEqual((await started((c) => c.found(''))).secret.state(), { kind: 'absent' });
  });

  it('@AC-33 a failed boot resolve stays unknown, and the next update retries and recovers', async () => {
    const { secret, watcher, calls } = await started((c) => c.fail(grpc.status.UNAVAILABLE));
    assert.deepEqual(secret.state(), { kind: 'unknown' });
    assert.deepEqual(secret.failures(), { count: 1, statusClass: 'UNAVAILABLE' });
    watcher.update('7'); // same version: retried only because the last resolve failed
    await settle();
    assert.equal(calls.length, 2);
    calls[1].found(KEY_A);
    await settle();
    assert.deepEqual(secret.state(), { kind: 'key', value: KEY_A });
    assert.deepEqual(secret.failures(), { count: 0, statusClass: '' });
  });

  it('@AC-34 two consecutive PERMISSION_DENIED failures are counted and named', async () => {
    const { secret, watcher, calls } = await started((c) => c.fail(grpc.status.PERMISSION_DENIED));
    watcher.update('7');
    await settle();
    calls[1].fail(grpc.status.PERMISSION_DENIED);
    await settle();
    assert.deepEqual(secret.failures(), { count: 2, statusClass: 'PERMISSION_DENIED' });
    assert.deepEqual(secret.state(), { kind: 'unknown' });
  });

  it('a failure without a gRPC code is classed UNKNOWN, and start() never rejects', async () => {
    const { secret } = await started((c) => c.fail(undefined));
    assert.deepEqual(secret.failures(), { count: 1, statusClass: 'UNKNOWN' });
  });

  it('a failed refresh keeps the last resolved key', async () => {
    const { secret, watcher, calls } = await started((c) => c.found(KEY_A));
    watcher.update('8');
    await settle();
    calls[1].fail(grpc.status.DEADLINE_EXCEEDED);
    await settle();
    assert.deepEqual(secret.state(), { kind: 'key', value: KEY_A });
    assert.deepEqual(secret.failures(), { count: 1, statusClass: 'DEADLINE_EXCEEDED' });
  });
});

describe('commsgun key refresh', () => {
  it('@AC-41 re-resolves only when the config version changes', async () => {
    const { watcher, calls } = await started((c) => c.found(KEY_A), '7');
    for (let i = 0; i < 3; i++) watcher.update('7');
    await settle();
    assert.equal(calls.length, 1, 'a liveness re-send at the same version must not resolve');
    watcher.update('8');
    await settle();
    assert.equal(calls.length, 2);
  });

  it('@AC-15 an update at a new version replaces the key', async () => {
    const { secret, watcher, calls } = await started((c) => c.found(KEY_A));
    watcher.update('8');
    await settle();
    calls[1].found(KEY_B);
    await settle();
    assert.deepEqual(secret.state(), { kind: 'key', value: KEY_B });
  });

  it('an update during a pending resolve causes exactly one follow-up, whose answer is final', async () => {
    const { secret, watcher, calls } = await started((c) => c.found(KEY_A));
    watcher.update('8');
    await settle();
    assert.equal(calls.length, 2);
    // The rotation lands while the version-8 resolve is still pending.
    watcher.update('9');
    watcher.update('9');
    await settle();
    assert.equal(calls.length, 2, 'no concurrent resolve');
    calls[1].found(KEY_A);
    await settle();
    assert.equal(calls.length, 3, 'exactly one follow-up');
    calls[2].found(KEY_B);
    await settle();
    assert.deepEqual(secret.state(), { kind: 'key', value: KEY_B });
    watcher.update('9');
    await settle();
    assert.equal(calls.length, 3);
  });

  it('stop() removes the listener', async () => {
    const { secret, watcher, calls } = await started((c) => c.found(KEY_A));
    secret.stop();
    watcher.update('8');
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(watcher.listenerCount('update'), 0);
  });
});

describe('commsgun key confidentiality', () => {
  it('no log line carries a key value, on success, rotation or failure', async () => {
    const { watcher, calls } = await started((c) => c.found(KEY_A));
    watcher.update('8');
    await settle();
    calls[1].found(KEY_B);
    await settle();
    watcher.update('9');
    await settle();
    calls[2].fail(grpc.status.UNAVAILABLE);
    await settle();
    assert.ok(records.length > 0, 'the resolver logs its outcomes');
    assertNoKeyInLogs();
  });
});
