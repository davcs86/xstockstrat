// CommsgunClient tests (feature 338). Outbound HTTP is stubbed via globalThis.fetch; no network.
import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  CommsgunClient,
  classifyStatus,
  commsgunBody,
  parseRetryAfter,
  type CommsgunSendResult,
} from '../fanout/commsgunClient.js';
import { fakeConfig } from './fixtures/fakeConfig.js';
import { networkError, stubFetch, type FetchReply, type FetchStub } from './fixtures/stubFetch.js';

const URL = 'https://comms.ts.example.net/v1/messages';
const KEY = 'k-0123456789abcdef0123456789abcdef';
const ROW = { recipient: 'ops@example.com', subject: '[ALERT_SEVERITY_WARNING] AAPL breakout', text: 'body text' };
const REQUEST = {
  url: URL,
  appId: 'xstockstrat-staging',
  key: KEY,
  alertId: '7b0c1a52-4d1e-4b7a-9c53-0f6a3f1d2e90',
  body: commsgunBody(ROW),
};

let fetchStub: FetchStub | null = null;

afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
  mock.timers.reset();
});

function useFetch(reply: number | ((call: any, index: number) => FetchReply)): FetchStub {
  fetchStub = stubFetch(reply);
  return fetchStub;
}

function client(timeoutSeconds?: number): CommsgunClient {
  return new CommsgunClient(
    fakeConfig(timeoutSeconds === undefined ? {} : { int: { 'commsgun.request_timeout_seconds': timeoutSeconds } }),
  );
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

// A result may carry classes and numbers only: never the URL, the key or an error message.
function assertClean(result: CommsgunSendResult): void {
  const dump = JSON.stringify(result);
  for (const secret of [URL, 'comms.ts.example.net', KEY, 'fetch failed']) {
    assert.ok(!dump.includes(secret), `the result contains ${secret}: ${dump}`);
  }
}

describe('commsgunClient test harness', () => {
  it('imports the module under test', () => {
    assert.equal(typeof CommsgunClient, 'function');
  });
});

describe('commsgunBody', () => {
  it('@AC-4 is the four-key email body in a fixed order, without a sender', () => {
    assert.equal(
      commsgunBody(ROW),
      '{"channel":"email","to":["ops@example.com"],"subject":"[ALERT_SEVERITY_WARNING] AAPL breakout","text":"body text"}',
    );
    assert.deepEqual(Object.keys(JSON.parse(commsgunBody(ROW))), ['channel', 'to', 'subject', 'text']);
  });
});

describe('CommsgunClient.send', () => {
  it('@AC-4 a 202 is delivered, from one POST with the app, bearer and idempotency headers', async () => {
    const fetched = useFetch(202);
    const result = await client().send(REQUEST, new AbortController());
    assert.deepEqual(result, { kind: 'delivered' });
    assert.equal(fetched.calls.length, 1);
    const { url, init } = fetched.calls[0];
    assert.equal(url, URL);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.deepEqual(init.headers, {
      'Content-Type': 'application/json',
      'X-Commsgun-App': 'xstockstrat-staging',
      Authorization: `Bearer ${KEY}`,
      'Idempotency-Key': `alert:${REQUEST.alertId}`,
    });
    const body = JSON.parse(init.body);
    assert.equal(body.channel, 'email');
    assert.deepEqual(body.to, ['ops@example.com']);
    assert.equal('from' in body, false);
  });

  it('@AC-7 two sends of one row carry equal idempotency keys and byte-identical bodies', async () => {
    const fetched = useFetch((_call, index) => ({ status: index === 0 ? 503 : 202 }));
    const c = client();
    await c.send({ ...REQUEST, body: commsgunBody(ROW) }, new AbortController());
    await c.send({ ...REQUEST, body: commsgunBody(ROW) }, new AbortController());
    assert.equal(fetched.calls.length, 2);
    const [first, second] = fetched.calls.map((call) => call.init);
    assert.equal(first.headers['Idempotency-Key'], second.headers['Idempotency-Key']);
    assert.equal(first.body, second.body);
  });

  it('@AC-8 a 200 duplicate is delivered and its body is cancelled, never read', async () => {
    const fetched = useFetch(() => ({ status: 200, body: '{"duplicate": true}' }));
    assert.deepEqual(await client().send(REQUEST, new AbortController()), { kind: 'delivered' });
    assert.equal(fetched.bodyReads(), 0);
    assert.equal(fetched.bodyCancels(), 1);
  });

  it('@AC-9 a 429 is a retry carrying Retry-After; a 503 without it carries null', async () => {
    useFetch(() => ({ status: 429, headers: { 'retry-after': '120' } }));
    const limited = await client().send(REQUEST, new AbortController());
    assert.deepEqual(limited, { kind: 'retry', errorClass: '429', outcome: 'http_error', retryAfterSeconds: 120 });
    fetchStub?.restore();
    useFetch(503);
    const busy = await client().send(REQUEST, new AbortController());
    assert.deepEqual(busy, { kind: 'retry', errorClass: '5xx', outcome: 'http_error', retryAfterSeconds: null });
    assertClean(limited);
    assertClean(busy);
  });

  it('permanent statuses keep their own class, and fetch runs once', async () => {
    for (const [status, errorClass] of [
      [401, '401'],
      [403, '403'],
      [409, '409'],
      [413, '413'],
      [422, '422'],
      [404, '4xx'],
      [408, '4xx'],
      [302, '3xx'],
    ] as const) {
      const fetched = useFetch(status);
      const result = await client().send(REQUEST, new AbortController());
      assert.deepEqual(result, { kind: 'permanent', errorClass }, `status ${status}`);
      assert.equal(fetched.calls.length, 1);
      assertClean(result);
      fetched.restore();
    }
  });

  it('an opaque redirect is permanent / 3xx, and any other odd status is permanent / other', async () => {
    useFetch(() => ({ status: 0, type: 'opaqueredirect' }));
    assert.deepEqual(await client().send(REQUEST, new AbortController()), { kind: 'permanent', errorClass: '3xx' });
    fetchStub?.restore();
    useFetch(0);
    assert.deepEqual(await client().send(REQUEST, new AbortController()), { kind: 'permanent', errorClass: 'other' });
  });

  it('@AC-20 a hanging reply is a timeout retry after request_timeout_seconds', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const fetched = useFetch(() => ({ hang: true }));
    const controller = new AbortController();
    const pending = client(1).send(REQUEST, controller);
    await settle();
    mock.timers.tick(999);
    await settle();
    assert.equal(controller.signal.aborted, false);
    mock.timers.tick(1);
    const result = await pending;
    assert.equal(fetched.calls[0].init.signal, controller.signal);
    assert.deepEqual(result, { kind: 'retry', errorClass: 'timeout', outcome: 'timeout', retryAfterSeconds: null });
    assertClean(result);
  });

  it('the timeout key is clamped: 0 and a negative read as 10 s, 86400 as 60 s', async () => {
    for (const [stored, wantMs] of [
      [0, 10_000],
      [-5, 10_000],
      [86_400, 60_000],
      [undefined, 10_000],
    ] as const) {
      mock.timers.enable({ apis: ['setTimeout'] });
      useFetch(() => ({ hang: true }));
      const controller = new AbortController();
      const pending = client(stored).send(REQUEST, controller);
      await settle();
      mock.timers.tick(wantMs - 1);
      await settle();
      assert.equal(controller.signal.aborted, false, `stored=${stored} aborted early`);
      mock.timers.tick(1);
      assert.equal((await pending).kind, 'retry');
      assert.equal(controller.signal.aborted, true, `stored=${stored} not aborted at ${wantMs} ms`);
      fetchStub?.restore();
      mock.timers.reset();
    }
  });

  it('@AC-21 a network error is a retry classed by its code only', async () => {
    useFetch(() => ({ throws: networkError('ECONNRESET', `fetch failed for ${URL}`) }));
    const result = await client().send(REQUEST, new AbortController());
    assert.deepEqual(result, {
      kind: 'retry',
      errorClass: 'network: ECONNRESET',
      outcome: 'error',
      retryAfterSeconds: null,
    });
    assertClean(result);
  });

  it('an abort by the caller ends the request as a timeout-class retry without throwing', async () => {
    useFetch(() => ({ hang: true }));
    const controller = new AbortController();
    const pending = client().send(REQUEST, controller);
    await settle();
    controller.abort();
    assert.equal((await pending).kind, 'retry');
  });
});

describe('classifyStatus', () => {
  it('2xx is delivered; 429 and 5xx retry; everything else is permanent', () => {
    for (const s of [200, 202, 299]) assert.equal(classifyStatus(s).kind, 'delivered');
    for (const s of [429, 500, 503, 599]) assert.equal(classifyStatus(s).kind, 'retry');
    for (const s of [0, 100, 301, 400, 401, 408, 418, 600]) assert.equal(classifyStatus(s).kind, 'permanent');
  });
});

describe('parseRetryAfter', () => {
  it('accepts a non-negative integer of seconds only', () => {
    assert.equal(parseRetryAfter('120'), 120);
    assert.equal(parseRetryAfter('0'), 0);
    assert.equal(parseRetryAfter(' 30 '), 30);
    for (const bad of [null, '', '  ', '-1', '1.5', 'Wed, 21 Oct 2026 07:28:00 GMT', '12s', '1e3']) {
      assert.equal(parseRetryAfter(bad), null, `value ${JSON.stringify(bad)}`);
    }
  });
});
