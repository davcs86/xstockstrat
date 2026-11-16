// WebhookWorker tests (feature 334). Outbound HTTP is stubbed via globalThis.fetch and the pool is a
// scripted fake: no network, no database. The logger is replaced before the modules under test load,
// so every log call they make is captured.
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import configProto = require('@xstockstrat/proto/config/v1/config');
import mtlsModule = require('../mtls');
import loggerModule = require('../services/logger');
import { counterValue, install, points } from './fixtures/collectingReader';
import { fakeConfig, type Cfg } from './fixtures/fakeConfig';
import { alertRecorder, scriptedPool, settle, type PoolCall, type PoolOpts } from './fixtures/scriptedPool';
import { abortError, networkError, stubFetch, type FetchReply, type FetchStub } from './fixtures/stubFetch';

type WorkerModule = typeof import('../fanout/webhookWorker');
type ImplModule = typeof import('../grpc/notifyServiceImpl');
type WatcherModule = typeof import('../services/configWatcher');

const ORIGIN = 'webhooks.ts.example.net:8443';
const URL_PLAIN = `https://${ORIGIN}/hooks`;
// Path and query stand for the capability part of a callback URL: they must never leak.
const URL_SECRET = `https://${ORIGIN}/hooks/s3cret-path?token=abc123`;
const SECRET_FRAGMENTS = [URL_SECRET, 's3cret-path', 'abc123'];
const EVENT = 'ingest.backfill.completed';

interface LogRecord {
  level: string;
  msg: string;
  meta: unknown;
}
const records: LogRecord[] = [];
const capture = (level: string) => (msg: unknown, meta?: unknown) => {
  records.push({ level, msg: String(msg), meta });
};
const fakeLog = { debug: capture('debug'), info: capture('info'), warn: capture('warn'), error: capture('error') };

class FakeStream extends EventEmitter {
  cancel(): void {}
}
const streams: FakeStream[] = [];
class FakeConfigServiceClient {
  watchConfig(): FakeStream {
    const stream = new FakeStream();
    streams.push(stream);
    return stream;
  }
  close(): void {}
}

let WebhookWorker: WorkerModule['WebhookWorker'];
let backoffDelaySeconds: WorkerModule['backoffDelaySeconds'];
let NotifyServiceImpl: ImplModule['NotifyServiceImpl'];
let ConfigWatcher: WatcherModule['ConfigWatcher'];

before(async () => {
  Object.assign(configProto, { ConfigServiceClient: FakeConfigServiceClient });
  Object.assign(mtlsModule, { clientCredentials: () => grpc.credentials.createInsecure() });
  Object.assign(loggerModule, { getLogger: () => fakeLog });
  ({ WebhookWorker, backoffDelaySeconds } = await import('../fanout/webhookWorker'));
  ({ NotifyServiceImpl } = await import('../grpc/notifyServiceImpl'));
  ({ ConfigWatcher } = await import('../services/configWatcher'));
});

let fetchStub: FetchStub | null = null;
const stopFns: (() => void)[] = [];

afterEach(() => {
  for (const stop of stopFns.splice(0)) stop();
  fetchStub?.restore();
  fetchStub = null;
  mock.timers.reset();
  records.length = 0;
  delete process.env.APPLICATION_ENV;
});

function useFetch(reply: number | ((call: any, index: number) => FetchReply)): FetchStub {
  fetchStub = stubFetch(reply);
  return fetchStub;
}

function deliveryRow(over: Record<string, unknown> = {}): any {
  return {
    delivery_id: 'd-1',
    idempotency_key: 'backfill:job-1:PARTIAL',
    callback_url: URL_PLAIN,
    event_name: EVENT,
    payload: { job_id: 'job-1', status: 'PARTIAL' },
    source_service: 'xstockstrat-ingest',
    attempts: 0,
    created_at: new Date('2026-11-11T20:00:00.123Z'),
    ...over,
  };
}

const ALLOWED: Cfg = { str: { 'webhook.allowed_origins': ORIGIN } };
function cfg(int: Record<string, number> = {}, allowlist = ORIGIN): any {
  return fakeConfig({ int, str: { 'webhook.allowed_origins': allowlist } });
}

function makeWorker(pool: { obj: any }, config: any, emit: (a: any) => Promise<unknown>) {
  const worker = new WebhookWorker(pool.obj, config, emit);
  stopFns.push(() => worker.stop());
  return worker;
}

async function runOnce(rows: any[], reply: number | ((call: any, i: number) => FetchReply), config = cfg(), poolOpts: PoolOpts = {}) {
  const fetched = useFetch(reply);
  const pool = scriptedPool(rows, poolOpts);
  const emit = alertRecorder();
  const worker = makeWorker(pool, config, emit.fn);
  await worker.tick();
  await settle();
  return { fetched, pool, alerts: emit.alerts, worker };
}

function keysAtAnyDepth(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysAtAnyDepth(v, out));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysAtAnyDepth(v, out);
    }
  }
  return out;
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

describe('webhook worker harness', () => {
  it('imports the modules under test', () => {
    assert.equal(typeof WebhookWorker, 'function');
    assert.equal(typeof backoffDelaySeconds, 'function');
    assert.equal(ALLOWED.str?.['webhook.allowed_origins'], ORIGIN);
  });
});

describe('WebhookWorker delivery (feature 334)', () => {
  it('@AC-8: a 201 marks the row delivered and the request matches the wire format exactly', async () => {
    const reader = install();
    const { fetched, pool, alerts } = await runOnce([deliveryRow()], 201);

    assert.equal(fetched.calls.length, 1);
    const { url, init } = fetched.calls[0];
    assert.equal(url, URL_PLAIN);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.deepEqual(init.headers, {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'backfill:job-1:PARTIAL',
    });
    assert.equal(
      init.body,
      JSON.stringify({
        event_name: EVENT,
        payload: {
          source_service: 'xstockstrat-ingest',
          environment: 'staging',
          occurred_at: '2026-11-11T20:00:00.123Z',
          data: { job_id: 'job-1', status: 'PARTIAL' },
        },
      }),
    );
    const body = JSON.parse(init.body);
    assert.match(body.payload.occurred_at, RFC3339);
    assert.equal(new Date(body.payload.occurred_at).getTime(), deliveryRow().created_at.getTime());
    assert.equal(keysAtAnyDepth(body).includes('user_id'), false);

    assert.equal(pool.updates().length, 1);
    assert.equal(pool.delivered().length, 1);
    const stmt = pool.delivered()[0];
    assert.match(stmt.sql.replace(/\s+/g, ' '), /attempts = attempts \+ 1.*WHERE delivery_id = \$1 AND state = 'pending'/);
    assert.equal(stmt.params[0], 'd-1');
    assert.equal(alerts.length, 0);

    const sent = (await points(reader, 'notify.delivery')).filter(
      (p) => p.attributes.channel === 'webhook' && p.attributes.outcome === 'sent',
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].value, 1);
  });

  it('@AC-8: the environment is production only when APPLICATION_ENV is production', async () => {
    process.env.APPLICATION_ENV = 'production';
    const prod = await runOnce([deliveryRow()], 201);
    assert.equal(JSON.parse(prod.fetched.calls[0].init.body).payload.environment, 'production');
    prod.fetched.restore();
    process.env.APPLICATION_ENV = 'development';
    const dev = await runOnce([deliveryRow()], 201);
    assert.equal(JSON.parse(dev.fetched.calls[0].init.body).payload.environment, 'staging');
  });

  it('@AC-8: a user_id nested in the stored payload is the publisher\'s data, the envelope adds none', async () => {
    const { fetched } = await runOnce([deliveryRow({ payload: { job_id: 'j', nested: [{ deep: { ok: 1 } }] } })], 201);
    const body = JSON.parse(fetched.calls[0].init.body);
    assert.deepEqual(Object.keys(body).sort(), ['event_name', 'payload']);
    assert.deepEqual(Object.keys(body.payload).sort(), ['data', 'environment', 'occurred_at', 'source_service']);
    assert.equal(keysAtAnyDepth(body).includes('user_id'), false);
  });

  it('posts to the re-serialized href of the parsed URL, not the stored string', async () => {
    const { fetched, pool } = await runOnce([deliveryRow({ callback_url: 'HTTPS://WEBHOOKS.TS.EXAMPLE.NET:8443/hooks' })], 201);
    assert.equal(fetched.calls[0].url, URL_PLAIN);
    assert.equal(pool.delivered().length, 1);
  });

  it('200 with a duplicate body and 201 are both delivered, and the response body is cancelled, never read', async () => {
    const { fetched, pool, alerts } = await runOnce(
      [deliveryRow({ delivery_id: 'd-1' }), deliveryRow({ delivery_id: 'd-2', idempotency_key: 'backfill:job-2:COMPLETED' })],
      (_c, i) => (i === 0 ? { status: 200, body: '{"duplicate": true}' } : { status: 201, body: '{"id": 7}' }),
    );
    assert.equal(fetched.calls.length, 2);
    assert.deepEqual(pool.delivered().map((c) => c.params[0]).sort(), ['d-1', 'd-2']);
    assert.equal(pool.dead().length, 0);
    assert.equal(pool.retried().length, 0);
    assert.equal(alerts.length, 0);
    assert.equal(fetched.bodyReads(), 0);
    assert.equal(fetched.bodyCancels(), 2);
  });

  for (const status of [408, 429, 500, 503]) {
    it(`@AC-9: a ${status} leaves the row pending with one more attempt and a later next attempt`, async () => {
      const { pool, alerts } = await runOnce([deliveryRow()], status);
      assert.equal(pool.updates().length, 1);
      assert.equal(pool.retried().length, 1);
      assert.equal(pool.dead().length, 0);
      const stmt = pool.retried()[0];
      const sql = stmt.sql.replace(/\s+/g, ' ');
      assert.match(sql, /attempts = attempts \+ 1/);
      assert.match(sql, /next_attempt_at = NOW\(\) \+ make_interval\(secs => \$2\)/);
      assert.match(sql, /WHERE delivery_id = \$1 AND state = 'pending'/);
      assert.doesNotMatch(sql, /state = 'dead'|state = 'delivered'/);
      assert.equal(stmt.params[0], 'd-1');
      assert.equal(stmt.params[1], 30);
      assert.equal(stmt.params[2], `http ${status}`);
      assert.equal(alerts.length, 0);
    });
  }

  it('@AC-9: a refused connection leaves the row pending with one more attempt', async () => {
    const reader = install();
    const { pool, alerts } = await runOnce([deliveryRow()], () => ({ throws: networkError('ECONNREFUSED') }));
    assert.equal(pool.retried().length, 1);
    assert.equal(pool.dead().length, 0);
    assert.ok(pool.retried()[0].params[1] > 0);
    assert.equal(pool.retried()[0].params[2], 'network: ECONNREFUSED');
    assert.equal(alerts.length, 0);
    assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'error'), 1);
  });

  it('@AC-9: a timeout aborts the request and leaves the row pending with one more attempt', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const fetched = useFetch(() => ({ hang: true }));
    const pool = scriptedPool([deliveryRow()]);
    const emit = alertRecorder();
    const worker = makeWorker(pool, cfg(), emit.fn);
    await worker.tick();
    await settle();
    assert.equal(fetched.calls[0].init.signal.aborted, false);
    assert.equal(pool.updates().length, 0);
    mock.timers.tick(10_000);
    await settle();
    assert.equal(fetched.calls[0].init.signal.aborted, true);
    assert.equal(pool.retried().length, 1);
    assert.ok(pool.retried()[0].params[1] > 0);
    assert.equal(pool.retried()[0].params[2], 'timeout');
    assert.equal(pool.dead().length, 0);
    assert.equal(emit.alerts.length, 0);
  });

  for (const status of [400, 404, 413, 422]) {
    it(`@AC-10: a ${status} marks the row dead at once and raises one WARNING alert`, async () => {
      const { fetched, pool, alerts } = await runOnce([deliveryRow()], status);
      assert.equal(fetched.calls.length, 1);
      assert.equal(pool.updates().length, 1);
      assert.equal(pool.dead().length, 1);
      const stmt = pool.dead()[0];
      const sql = stmt.sql.replace(/\s+/g, ' ');
      assert.match(sql, /WHERE delivery_id = \$1 AND state = 'pending'/);
      assert.match(sql, /attempts = attempts \+ \$2/);
      assert.deepEqual(stmt.params, ['d-1', 1, `http ${status}`]);
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].severity, 'ALERT_SEVERITY_WARNING');
      assert.equal(alerts[0].category, 'webhook');
      assert.equal(alerts[0].sourceService, 'xstockstrat-notify');
      assert.ok(!alerts[0].targetUserId);
      assert.equal(alerts[0].title, `Webhook delivery dead: ${EVENT} → ${ORIGIN}`);
      assert.match(alerts[0].body, /backfill:job-1:PARTIAL/);
      assert.match(alerts[0].body, new RegExp(`http ${status}`));
    });
  }

  it('@AC-11: the attempt that reaches webhook.max_attempts marks the row dead and alerts once', async () => {
    const { pool, alerts } = await runOnce([deliveryRow({ attempts: 2 })], 503, cfg({ 'webhook.max_attempts': 3 }));
    assert.equal(pool.updates().length, 1);
    assert.equal(pool.dead().length, 1);
    assert.deepEqual(pool.dead()[0].params, ['d-1', 1, 'http 503']);
    assert.equal(pool.retried().length, 0);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].body, /3 attempts/);
  });

  it('@AC-11: one attempt short of webhook.max_attempts still retries', async () => {
    const { pool, alerts } = await runOnce([deliveryRow({ attempts: 1 })], 503, cfg({ 'webhook.max_attempts': 3 }));
    assert.equal(pool.retried().length, 1);
    assert.equal(pool.dead().length, 0);
    assert.equal(alerts.length, 0);
  });

  it('@AC-12: backoffDelaySeconds doubles from the base and is capped at the maximum', () => {
    assert.deepEqual([1, 2, 3, 4].map((n) => backoffDelaySeconds(n, 30, 120)), [30, 60, 120, 120]);
    assert.equal(backoffDelaySeconds(1, 30, 3600), 30);
    assert.equal(backoffDelaySeconds(8, 30, 3600), 3600);
    assert.equal(backoffDelaySeconds(2000, 30, 3600), 3600);
    assert.equal(backoffDelaySeconds(1, 500, 120), 120);
  });

  it('@AC-12: the retry statement carries 30, 60, 120, 120 seconds for attempts 1 to 4 (base 30, max 120)', async () => {
    const config = cfg({ 'webhook.backoff_base_seconds': 30, 'webhook.backoff_max_seconds': 120 });
    const secs: number[] = [];
    for (const attempts of [0, 1, 2, 3]) {
      const { pool, fetched } = await runOnce([deliveryRow({ attempts })], 503, config);
      assert.equal(pool.retried().length, 1);
      secs.push(pool.retried()[0].params[1]);
      fetched.restore();
    }
    assert.deepEqual(secs, [30, 60, 120, 120]);
  });

  it('@AC-13: a hanging target does not delay another row; it then times out and stays pending', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const rowA = deliveryRow({ delivery_id: 'd-A', idempotency_key: 'backfill:job-A:COMPLETED' });
    const rowB = deliveryRow({ delivery_id: 'd-B', idempotency_key: 'backfill:job-B:COMPLETED' });
    const fetched = useFetch((_c, i) => (i === 0 ? { hang: true } : { status: 201 }));
    const pool = scriptedPool([rowA, rowB]);
    const emit = alertRecorder();
    const worker = makeWorker(pool, cfg(), emit.fn);

    await worker.tick();
    await settle();
    assert.equal(fetched.calls.length, 2);
    assert.deepEqual(pool.delivered().map((c) => c.params[0]), ['d-B']);
    assert.equal(pool.updates().length, 1, 'row A must still be in flight with no outcome');
    assert.equal(fetched.calls[0].init.signal.aborted, false);

    // The in-flight row is excluded from the next due-select.
    await worker.tick();
    await settle();
    assert.deepEqual(pool.selects()[1].params[0], ['d-A']);
    assert.equal(fetched.calls.length, 2);

    mock.timers.tick(10_000);
    await settle();
    assert.equal(pool.retried().length, 1);
    assert.equal(pool.retried()[0].params[0], 'd-A');
    assert.equal(pool.retried()[0].params[2], 'timeout');
    assert.equal(pool.dead().length, 0);
  });

  it('@AC-14: a freshly constructed worker delivers a row that was already pending', async () => {
    const { fetched, pool } = await runOnce([deliveryRow({ attempts: 1 })], 201);
    assert.equal(fetched.calls.length, 1);
    assert.equal(pool.delivered().length, 1);
    const select = pool.selects()[0].sql.replace(/\s+/g, ' ');
    assert.match(select, /FROM notify\.webhook_deliveries WHERE state = 'pending' AND next_attempt_at <= NOW\(\)/);
    assert.match(select, /ORDER BY next_attempt_at LIMIT \$2/);
  });

  it('@AC-15: a row whose origin left the allowlist is marked dead with no request, and alerts', async () => {
    const { fetched, pool, alerts } = await runOnce([deliveryRow({ attempts: 2 })], 201, cfg({}, ''));
    assert.equal(fetched.calls.length, 0);
    assert.equal(pool.updates().length, 1);
    assert.equal(pool.dead().length, 1);
    assert.deepEqual(pool.dead()[0].params, ['d-1', 0, 'url rejected: origin_not_allowed']);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, 'ALERT_SEVERITY_WARNING');
    assert.match(alerts[0].title, new RegExp(`^Webhook delivery dead: ${EVENT} → `));
    assert.match(alerts[0].body, /url rejected: origin_not_allowed/);
  });

  it('@AC-15: the allowlist is read on every attempt, not once', async () => {
    let allowlist = ORIGIN;
    const config = { ...cfg(), getString: () => allowlist };
    const fetched = useFetch(201);
    const pool = scriptedPool([deliveryRow()]);
    const emit = alertRecorder();
    const worker = makeWorker(pool, config, emit.fn);
    allowlist = 'other.example.net';
    await worker.tick();
    await settle();
    assert.equal(fetched.calls.length, 0);
    assert.equal(pool.dead().length, 1);
  });

  it('@AC-16: a 302 is not followed — redirect is manual, fetch runs once, the row is dead', async () => {
    const { fetched, pool, alerts } = await runOnce([deliveryRow()], () => ({
      status: 302,
      headers: { location: 'https://evil.example.org/hooks' },
    }));
    assert.equal(fetched.calls.length, 1);
    assert.equal(fetched.calls[0].init.redirect, 'manual');
    assert.equal(fetched.calls[0].url, URL_PLAIN);
    assert.equal(pool.updates().length, 1);
    assert.equal(pool.dead().length, 1);
    assert.deepEqual(pool.dead()[0].params, ['d-1', 1, 'redirect not followed']);
    assert.equal(alerts.length, 1);
    assert.ok(!JSON.stringify(alerts).includes('evil.example.org'));
  });

  it('@AC-16: an opaque redirect (status 0) and every other 3xx are dead without a second request', async () => {
    for (const reply of [{ status: 0, type: 'opaqueredirect' }, { status: 301 }, { status: 307 }, { status: 308 }]) {
      const { fetched, pool } = await runOnce([deliveryRow()], () => reply);
      assert.equal(fetched.calls.length, 1, JSON.stringify(reply));
      assert.deepEqual(pool.dead().map((c) => c.params[2]), ['redirect not followed'], JSON.stringify(reply));
      fetched.restore();
    }
  });

  it('two dead rows raise alerts with different bodies', async () => {
    const { alerts } = await runOnce(
      [
        deliveryRow({ delivery_id: 'd-1', idempotency_key: 'backfill:job-1:COMPLETED' }),
        deliveryRow({ delivery_id: 'd-2', idempotency_key: 'backfill:job-2:COMPLETED' }),
      ],
      404,
    );
    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].title, alerts[1].title);
    assert.notEqual(alerts[0].body, alerts[1].body);
  });

  it('no alert, metric or log when the dead statement changed no row', async () => {
    const reader = install();
    const { pool, alerts } = await runOnce([deliveryRow()], 404, cfg(), { updateRowCount: 0 });
    assert.equal(pool.dead().length, 1);
    assert.equal(alerts.length, 0);
    assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'dead'), 0);
    assert.equal(records.filter((r) => r.level === 'error').length, 0);
  });

  it('the dead metric and the ERROR log are recorded before the alert, and survive a failing alert', async () => {
    const reader = install();
    const fetched = useFetch(404);
    const pool = scriptedPool([deliveryRow()]);
    let seenAtAlert: { dead: number; errors: number } | null = null;
    const worker = makeWorker(pool, cfg(), async () => {
      seenAtAlert = {
        dead: await counterValue(reader, 'notify.delivery', 'outcome', 'dead'),
        errors: records.filter((r) => r.level === 'error').length,
      };
      throw new Error('alert insert failed');
    });
    await worker.tick();
    await settle();
    assert.equal(fetched.calls.length, 1);
    assert.deepEqual(seenAtAlert, { dead: 1, errors: 1 });
    const dead = (await points(reader, 'notify.delivery')).filter(
      (p) => p.attributes.channel === 'webhook' && p.attributes.outcome === 'dead',
    );
    assert.equal(dead.length, 1);
    const errors = records.filter((r) => r.level === 'error');
    assert.equal(errors.length, 2, 'the dead-letter line, then the failed-alert line');
    assert.deepEqual(errors[0].meta, {
      eventName: EVENT,
      origin: ORIGIN,
      idempotencyKey: 'backfill:job-1:PARTIAL',
      attempts: 1,
      lastError: 'http 404',
    });
  });
});

describe('WebhookWorker claim, concurrency and failure isolation (feature 334)', () => {
  it('uses single pool.query statements only — no pool.connect, no transaction', async () => {
    const outcomes: (number | FetchReply)[] = [201, 503, 404, { throws: networkError('ECONNRESET') }];
    for (const outcome of outcomes) {
      const { pool, fetched } = await runOnce([deliveryRow()], typeof outcome === 'number' ? outcome : () => outcome);
      assert.equal(pool.connects(), 0);
      for (const c of pool.calls) assert.doesNotMatch(c.sql, /\b(BEGIN|COMMIT|ROLLBACK|FOR UPDATE)\b/i);
      fetched.restore();
    }
    const src = readFileSync(join(__dirname, '..', '..', 'src', 'fanout', 'webhookWorker.ts'), 'utf8');
    assert.doesNotMatch(src, /pool\.connect|BEGIN/);
  });

  it('at most 4 attempts are in flight, and a full worker does not query', async () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => deliveryRow({ delivery_id: `d-${n}`, idempotency_key: `k-${n}` }));
    const fetched = useFetch(() => ({ hang: true }));
    const pool = scriptedPool(rows);
    const worker = makeWorker(pool, cfg(), alertRecorder().fn);
    await worker.tick();
    await settle();
    assert.equal(pool.selects().length, 1);
    assert.equal(pool.selects()[0].params[1], 4);
    assert.equal(fetched.calls.length, 4);
    await worker.tick();
    await settle();
    assert.equal(pool.selects().length, 1);
    assert.equal(fetched.calls.length, 4);
  });

  it('runs one tick at a time', async () => {
    useFetch(201);
    const pool = scriptedPool([deliveryRow()], { hangSelect: true });
    const worker = makeWorker(pool, cfg(), alertRecorder().fn);
    void worker.tick();
    await worker.tick();
    await settle();
    assert.equal(pool.selects().length, 1);
  });

  it('a failing due-select is contained by the tick and the next tick runs', async () => {
    useFetch(201);
    const pool = scriptedPool([deliveryRow()], { failOn: /^\s*SELECT/i });
    const worker = makeWorker(pool, cfg(), alertRecorder().fn);
    await assert.doesNotReject(worker.tick());
    await assert.doesNotReject(worker.tick());
    assert.equal(pool.selects().length, 2);
  });

  it('a rejecting pool.query inside an attempt raises no unhandledRejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      for (const reply of [201, 503, 404]) {
        const { pool, fetched } = await runOnce([deliveryRow()], reply, cfg(), { failOn: /^\s*UPDATE/i });
        assert.ok(pool.updates().length >= 1);
        fetched.restore();
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      await settle();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    assert.deepEqual(unhandled, []);
  });

  it('an unexpected throw inside an attempt records a retry best-effort', async () => {
    // The delivered statement fails once; the attempt falls back to a retry statement.
    const { pool, alerts } = await runOnce([deliveryRow()], 201, cfg(), { failOn: /state = 'delivered'/ });
    assert.equal(pool.delivered().length, 1);
    assert.equal(pool.retried().length, 1);
    assert.equal(pool.retried()[0].params[0], 'd-1');
    assert.ok(pool.retried()[0].params[1] > 0);
    assert.equal(alerts.length, 0);
  });

  it('stop() aborts an in-flight request and records no outcome for its row', async () => {
    const fetched = useFetch(() => ({ hang: true }));
    const pool = scriptedPool([deliveryRow()]);
    const emit = alertRecorder();
    const worker = makeWorker(pool, cfg(), emit.fn);
    await worker.tick();
    await settle();
    assert.equal(fetched.calls[0].init.signal.aborted, false);
    worker.stop();
    await settle();
    assert.equal(fetched.calls[0].init.signal.aborted, true);
    assert.equal(pool.updates().length, 0);
    assert.equal(emit.alerts.length, 0);
    await worker.tick();
    assert.equal(pool.selects().length, 1, 'a stopped worker does not tick');
  });

  it('start() ticks on a timer and stop() clears it; nothing is logged per tick', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    useFetch(201);
    const pool = scriptedPool([]);
    const worker = makeWorker(pool, cfg(), alertRecorder().fn);
    worker.start();
    assert.equal(pool.selects().length, 0);
    mock.timers.tick(5000);
    await settle();
    assert.equal(pool.selects().length, 1);
    mock.timers.tick(5000);
    await settle();
    assert.equal(pool.selects().length, 2);
    assert.deepEqual(records, []);
    worker.stop();
    mock.timers.tick(20_000);
    await settle();
    assert.equal(pool.selects().length, 2);
  });
});

describe('WebhookWorker never exposes the callback URL (feature 334)', () => {
  it('the URL appears in no last_error, alert or log call, on every outcome', async () => {
    const secretRow = (over: Record<string, unknown> = {}) => deliveryRow({ callback_url: URL_SECRET, ...over });
    const scenarios: { reply: number | (() => FetchReply); config?: any; pool?: PoolOpts; failAlert?: boolean }[] = [
      { reply: 201 },
      { reply: 503 },
      { reply: 404 },
      { reply: 404, failAlert: true },
      { reply: () => ({ status: 302, headers: { location: `${URL_SECRET}&next=1` } }) },
      { reply: () => ({ throws: networkError('ECONNREFUSED', `connect failed for ${URL_SECRET}`) }) },
      { reply: () => ({ throws: new Error(`boom ${URL_SECRET}`) }) },
      { reply: () => ({ throws: abortError() }) },
      { reply: 503, config: cfg({ 'webhook.max_attempts': 1 }) },
      { reply: 201, config: cfg({}, '') },
      { reply: 201, config: cfg({}, 'bad entry/with/path,' + ORIGIN + '/x') },
      { reply: 201, pool: { failOn: /^\s*UPDATE/i } },
      { reply: 404, pool: { failOn: /^\s*UPDATE/i } },
    ];
    const seen: unknown[] = [];
    for (const s of scenarios) {
      const fetched = useFetch(s.reply);
      const pool = scriptedPool([secretRow()], s.pool);
      const emit = alertRecorder(s.failAlert);
      const worker = makeWorker(pool, s.config ?? cfg(), emit.fn);
      await worker.tick();
      await settle();
      seen.push(pool.calls.map((c) => c.params), emit.alerts);
      fetched.restore();
    }
    seen.push(records.map((r) => [r.msg, r.meta]));
    assert.ok(records.length > 0, 'the scenarios must have logged something');
    const dump = JSON.stringify(seen, (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v));
    for (const fragment of SECRET_FRAGMENTS) {
      assert.equal(dump.includes(fragment), false, `"${fragment}" reached a statement parameter, an alert or a log call`);
    }
  });
});

describe('WebhookWorker config readers (feature 334)', () => {
  it('webhook.max_attempts ≤ 0 reads as the default 8', async () => {
    for (const stored of [0, -3]) {
      const config = cfg({ 'webhook.max_attempts': stored });
      const before8 = await runOnce([deliveryRow({ attempts: 6 })], 503, config);
      assert.equal(before8.pool.retried().length, 1, `stored ${stored}: attempt 7 retries`);
      assert.equal(before8.pool.dead().length, 0);
      before8.fetched.restore();
      const at8 = await runOnce([deliveryRow({ attempts: 7 })], 503, config);
      assert.equal(at8.pool.dead().length, 1, `stored ${stored}: attempt 8 is dead`);
      at8.fetched.restore();
    }
  });

  it('webhook.backoff_base_seconds ≤ 0 reads as the default 30', async () => {
    for (const stored of [0, -1]) {
      const { pool, fetched } = await runOnce([deliveryRow()], 503, cfg({ 'webhook.backoff_base_seconds': stored }));
      assert.equal(pool.retried()[0].params[1], 30);
      fetched.restore();
    }
  });

  it('webhook.backoff_max_seconds ≤ 0 reads as the default 3600', async () => {
    for (const stored of [0, -1]) {
      const config = cfg({ 'webhook.max_attempts': 20, 'webhook.backoff_max_seconds': stored });
      const { pool, fetched } = await runOnce([deliveryRow({ attempts: 9 })], 503, config);
      assert.equal(pool.retried()[0].params[1], 3600);
      fetched.restore();
    }
  });

  // Returns the first millisecond at which the request of a hanging target is aborted.
  async function abortsAfterMs(stored: number | undefined, probes: number[]): Promise<number> {
    mock.timers.enable({ apis: ['setTimeout'] });
    const fetched = useFetch(() => ({ hang: true }));
    const int = stored === undefined ? {} : { 'webhook.request_timeout_seconds': stored };
    const worker = makeWorker(scriptedPool([deliveryRow()]), cfg(int), alertRecorder().fn);
    await worker.tick();
    await settle();
    let elapsed = 0;
    let result = -1;
    for (const at of probes) {
      mock.timers.tick(at - elapsed);
      elapsed = at;
      await settle();
      if (fetched.calls[0].init.signal.aborted) {
        result = at;
        break;
      }
    }
    worker.stop();
    fetched.restore();
    mock.timers.reset();
    return result;
  }

  it('webhook.request_timeout_seconds: default 10 s, and ≤ 0 reads as the default', async () => {
    assert.equal(await abortsAfterMs(undefined, [9_999, 10_000]), 10_000);
    assert.equal(await abortsAfterMs(0, [9_999, 10_000]), 10_000);
    assert.equal(await abortsAfterMs(-5, [9_999, 10_000]), 10_000);
  });

  it('webhook.request_timeout_seconds is clamped to 1–60 s', async () => {
    assert.equal(await abortsAfterMs(1, [999, 1_000]), 1_000);
    assert.equal(await abortsAfterMs(45, [44_999, 45_000]), 45_000);
    assert.equal(await abortsAfterMs(60, [59_999, 60_000]), 60_000);
    assert.equal(await abortsAfterMs(61, [59_999, 60_000, 61_000]), 60_000);
    assert.equal(await abortsAfterMs(86_400, [59_999, 60_000]), 60_000);
  });

  it('reads the keys live through the real ConfigWatcher snapshot, and a later snapshot takes effect', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const snapshot = (values: Record<string, { intVal?: number; stringVal?: string }>, version: string) => {
      const built: Record<string, configProto.ConfigValue> = {};
      for (const [k, v] of Object.entries(values)) built[k] = configProto.ConfigValue.fromPartial(v);
      return configProto.ConfigSnapshot.fromPartial({ namespace: 'notify', version, values: built });
    };
    streams.length = 0;
    const watcher = new ConfigWatcher('xstockstrat-config:50060', 'notify');
    await settle();
    // Every stored value differs from its code default (8 / 30 / 3600 / 10).
    streams[0].emit(
      'data',
      snapshot(
        {
          'webhook.allowed_origins': { stringVal: ORIGIN },
          'webhook.max_attempts': { intVal: 3 },
          'webhook.backoff_base_seconds': { intVal: 7 },
          'webhook.backoff_max_seconds': { intVal: 11 },
          'webhook.request_timeout_seconds': { intVal: 2 },
        },
        '1',
      ),
    );

    const fetched = useFetch((_c, i) => (i === 3 ? { hang: true } : { status: 503 }));
    const pool = scriptedPool([
      deliveryRow({ delivery_id: 'd-1', attempts: 0 }),
      deliveryRow({ delivery_id: 'd-2', attempts: 1 }),
      deliveryRow({ delivery_id: 'd-3', attempts: 2 }),
      deliveryRow({ delivery_id: 'd-4', attempts: 0 }),
    ]);
    const emit = alertRecorder();
    const worker = makeWorker(pool, watcher, emit.fn);
    await worker.tick();
    await settle();
    const secsById = Object.fromEntries(pool.retried().map((c) => [c.params[0], c.params[1]]));
    assert.deepEqual(secsById, { 'd-1': 7, 'd-2': 11 }, 'base 7 doubled to 14 is capped at max 11');
    assert.deepEqual(pool.dead().map((c) => c.params[0]), ['d-3'], 'the third attempt is the last with max_attempts 3');
    mock.timers.tick(1_999);
    await settle();
    assert.equal(fetched.calls[3].init.signal.aborted, false);
    mock.timers.tick(1);
    await settle();
    assert.equal(fetched.calls[3].init.signal.aborted, true, 'the request timeout is the stored 2 s');

    // A later snapshot empties the allowlist: the next attempt sends nothing.
    streams[0].emit('data', snapshot({ 'webhook.allowed_origins': { stringVal: '' } }, '2'));
    const pool2 = scriptedPool([deliveryRow({ delivery_id: 'd-9' })]);
    const worker2 = makeWorker(pool2, watcher, emit.fn);
    await worker2.tick();
    await settle();
    assert.equal(fetched.calls.length, 4);
    assert.deepEqual(pool2.dead().map((c) => c.params), [['d-9', 0, 'url rejected: origin_not_allowed']]);
  });
});

describe('dead-letter alert through NotifyServiceImpl (feature 334)', () => {
  it('emitInternalAlert persists one WARNING alert, broadcasts it and queues both side channels without metadata', async () => {
    const calls: PoolCall[] = [];
    const pool = {
      async query(sql: string, params: any[] = []) {
        calls.push({ sql, params });
        return { rows: [], rowCount: 1 };
      },
    };
    const dispatched: { channel: string; alert: any; md: unknown }[] = [];
    const fanout = { dispatch: async (alert: any) => void dispatched.push({ channel: 'fanout', alert, md: undefined }) };
    const webPush = {
      dispatch: async (alert: any, md: unknown) => void dispatched.push({ channel: 'push', alert, md }),
    };
    const impl = new NotifyServiceImpl(pool as any, cfg(), fanout as any, webPush as any);
    const streamed: any[] = [];
    impl.streamAlerts({
      request: { userId: 'u-sub', categories: [], severities: [], includeAcknowledged: false },
      on() {},
      write(alert: any) {
        streamed.push(alert);
      },
    });

    const fetched = useFetch(404);
    const workerPool = scriptedPool([deliveryRow()]);
    const worker = makeWorker(workerPool, cfg(), (alert) => impl.emitInternalAlert(alert));
    await worker.tick();
    await settle();
    assert.equal(fetched.calls.length, 1);

    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /INSERT INTO notify\.alerts/);
    const [, severity, category, title, body, sourceService, targetUserId] = calls[0].params;
    assert.equal(severity, 2);
    assert.equal(category, 'webhook');
    assert.equal(title, `Webhook delivery dead: ${EVENT} → ${ORIGIN}`);
    assert.match(body, /backfill:job-1:PARTIAL/);
    assert.equal(sourceService, 'xstockstrat-notify');
    assert.equal(targetUserId, null);
    assert.equal(streamed.length, 1);
    assert.equal(streamed[0].title, title);
    assert.deepEqual(dispatched.map((d) => d.channel).sort(), ['fanout', 'push']);
    assert.equal(dispatched.find((d) => d.channel === 'push')?.md, undefined);
  });

  it('a failing alert insert is logged at ERROR and does not escape the worker', async () => {
    const pool = { query: async () => Promise.reject(new Error('alerts insert failed')) };
    const impl = new NotifyServiceImpl(pool as any, cfg(), { dispatch: async () => {} } as any, { dispatch: async () => {} } as any);
    useFetch(404);
    const workerPool = scriptedPool([deliveryRow()]);
    const worker = makeWorker(workerPool, cfg(), (alert) => impl.emitInternalAlert(alert));
    await assert.doesNotReject(worker.tick());
    await settle();
    assert.equal(workerPool.dead().length, 1);
    assert.equal(records.filter((r) => r.level === 'error').length, 2);
  });
});

describe('src/index.ts wiring (feature 334)', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'src', 'index.ts'), 'utf8');

  it('starts the worker after the server starts and stops it before the pool ends', () => {
    const start = src.indexOf('webhookWorker.start()');
    const stop = src.indexOf('webhookWorker.stop()');
    assert.ok(start > 0 && stop > 0, 'index.ts must start and stop the worker');
    assert.ok(start > src.indexOf('grpcServer.start()'));
    assert.ok(stop < src.indexOf('pool.end()'));
    assert.ok(stop < src.indexOf('grpcServer.forceShutdown()'));
    assert.ok(stop > src.indexOf('const shutdown = () =>'));
  });

  it('constructs the worker on the shared pool and the config watcher', () => {
    assert.match(src, /new WebhookWorker\(pool, configWatcher, /);
    assert.equal(src.split('new Pool(').length - 1, 1);
  });
});
