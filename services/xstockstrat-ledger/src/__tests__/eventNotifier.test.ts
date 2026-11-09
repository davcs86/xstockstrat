// Unit tests for EventNotifier — a FakeClient stands in for pg.Client; no real DB.
import { describe, it, before, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { transports } from 'winston';
import { type CollectingReader, install, values } from './fixtures/collectingReader';
import { LARGE_PAYLOAD, TRIMMED_RECORDED_AT, makeEventRow } from './fixtures/ledgerEvents';

let EventNotifier: any;

// This import must throw on failure — never wrap it in try/catch or early-return on a
// missing subject; a swallowed import turns every case into a silent pass.
before(async () => {
  const mod = await import('../services/eventNotifier.js');
  EventNotifier = mod.EventNotifier;
});

describe('test harness', () => {
  it('imports the implementation under test', () => {
    assert.strictEqual(typeof EventNotifier, 'function', 'EventNotifier must import — never skip silently');
  });
});

// Minimal pg.Client stand-in: records LISTENs and lets the test push
// notifications / simulate connection errors.
class FakeClient {
  handlers: Record<string, Array<(...a: any[]) => void>> = {};
  connected = false;
  ended = false;
  listens: string[] = [];
  failConnect = false;

  on(event: string, cb: (...a: any[]) => void) {
    (this.handlers[event] ||= []).push(cb);
    return this;
  }
  async connect() {
    if (this.failConnect) throw new Error('connect refused');
    this.connected = true;
  }
  async query(sql: string) {
    if (/^LISTEN/i.test(sql)) this.listens.push(sql);
    return { rows: [] };
  }
  async end() {
    this.ended = true;
  }
  emit(event: string, ...args: any[]) {
    (this.handlers[event] || []).forEach((cb) => cb(...args));
  }
  notify(payload: string) {
    this.emit('notification', { payload });
  }
}

function row(overrides: any = {}) {
  return JSON.stringify({
    event_id: 'e1',
    event_type: 'order.filled',
    source_service: 'trading',
    stream_key: 'order:1',
    sequence: 1,
    payload: {},
    ...overrides,
  });
}

const tick = () => new Promise((r) => setTimeout(r, 5));

// Fast-path cases never resolve; a call here would mean a full row took the resolve path.
const resolveRow = async () => {
  throw new Error('resolveRow must not be called for a full row');
};

// A trimmed NOTIFY body: the stub carries no `payload` key (JSON.stringify drops undefined).
const stub = (overrides: any = {}) =>
  row({ payload: undefined, recorded_at: TRIMMED_RECORDED_AT, ...overrides });

// Controllable resolveRow: each call parks a deferred the test settles (or leaves hanging).
function makeResolver() {
  const calls: Array<{
    client: any;
    stub: any;
    resolve: (r: any) => void;
    reject: (e: any) => void;
  }> = [];
  const fn = (client: any, s: any) =>
    new Promise<any>((resolve, reject) => {
      calls.push({ client, stub: s, resolve, reject });
    });
  return { fn, calls };
}

// A subscriber that records deliveries, gap signals and resyncs.
function recorder(filter: any = {}) {
  const r = { got: [] as any[], gaps: [] as any[], reconnects: 0, sub: null as any };
  r.sub = {
    ...filter,
    onEvent: (x: any) => r.got.push(x),
    onGap: (g: any) => r.gaps.push(g),
    onReconnect: () => {
      r.reconnects++;
    },
  };
  return r;
}

describe('EventNotifier', () => {
  it('LISTENs on the shared channel once connected', async () => {
    const client = new FakeClient();
    const n = new EventNotifier(() => client, { resolveRow });
    await n.start();
    assert.ok(client.connected);
    assert.ok(client.listens.some((s) => /LISTEN "ledger_stream_all"/.test(s)));
    await n.stop();
    assert.ok(client.ended);
  });

  it('fans out an event to a matching subscriber', async () => {
    const client = new FakeClient();
    const n = new EventNotifier(() => client, { resolveRow });
    await n.start();
    const got: any[] = [];
    n.subscribe({ onEvent: (r: any) => got.push(r) });
    client.notify(row({ sequence: 5 }));
    assert.strictEqual(got.length, 1);
    assert.strictEqual(got[0].sequence, 5);
    await n.stop();
  });

  it('filters by stream_key and event_type', async () => {
    const client = new FakeClient();
    const n = new EventNotifier(() => client, { resolveRow });
    await n.start();
    const got: any[] = [];
    n.subscribe({ streamKey: 'order:1', eventType: 'order.filled', onEvent: (r: any) => got.push(r) });

    client.notify(row({ stream_key: 'order:2' })); // wrong stream_key
    client.notify(row({ event_type: 'order.canceled' })); // wrong event_type
    client.notify(row()); // matches both filters
    assert.strictEqual(got.length, 1);
    assert.strictEqual(got[0].stream_key, 'order:1');
    await n.stop();
  });

  it('stops delivering after unsubscribe', async () => {
    const client = new FakeClient();
    const n = new EventNotifier(() => client, { resolveRow });
    await n.start();
    const got: any[] = [];
    const unsub = n.subscribe({ onEvent: (r: any) => got.push(r) });
    client.notify(row());
    unsub();
    client.notify(row({ sequence: 2 }));
    assert.strictEqual(got.length, 1);
    await n.stop();
  });

  it('ignores malformed NOTIFY payloads', async () => {
    const client = new FakeClient();
    const n = new EventNotifier(() => client, { resolveRow });
    await n.start();
    const got: any[] = [];
    n.subscribe({ onEvent: (r: any) => got.push(r) });
    client.notify('{not json');
    client.emit('notification', {}); // no payload
    assert.strictEqual(got.length, 0);
    await n.stop();
  });

  it('one subscriber throwing does not break fan-out to others', async () => {
    const client = new FakeClient();
    const n = new EventNotifier(() => client, { resolveRow });
    await n.start();
    const got: any[] = [];
    n.subscribe({ onEvent: () => { throw new Error('boom'); } });
    n.subscribe({ onEvent: (r: any) => got.push(r) });
    client.notify(row());
    assert.strictEqual(got.length, 1);
    await n.stop();
  });

  it('reconnects after a connection error and fires onReconnect', async () => {
    const clients: FakeClient[] = [];
    const n = new EventNotifier(
      () => {
        const c = new FakeClient();
        clients.push(c);
        return c;
      },
      { resolveRow, reconnectDelayMs: 1 }, // fast reconnect for the test
    );
    await n.start();
    let reconnects = 0;
    n.subscribe({ onEvent: () => {}, onReconnect: () => { reconnects++; } });

    // Simulate the live connection dropping.
    clients[0].emit('error', new Error('connection lost'));
    await tick();
    await tick();

    assert.ok(clients.length >= 2, 'should have created a replacement client');
    assert.ok(clients[1].connected, 'replacement client should be connected');
    assert.strictEqual(reconnects, 1, 'onReconnect should fire once after a reconnect');
    await n.stop();
  });
});

describe('EventNotifier — trimmed-row resolve (feature 248)', () => {
  async function started() {
    const clients: FakeClient[] = [];
    const resolver = makeResolver();
    const n = new EventNotifier(
      () => {
        const c = new FakeClient();
        clients.push(c);
        return c;
      },
      { resolveRow: resolver.fn, reconnectDelayMs: 1 },
    );
    await n.start();
    return { n, clients, resolver };
  }

  it('AC-2: a stub keeps its place — later rows wait behind the in-flight resolve', async () => {
    const { n, clients, resolver } = await started();
    const a = recorder();
    n.subscribe(a.sub);
    clients[0].notify(row({ event_id: 'e1', sequence: 1 }));
    clients[0].notify(stub({ event_id: 'e2', sequence: 2 }));
    clients[0].notify(row({ event_id: 'e3', sequence: 3 }));
    await tick();
    assert.deepStrictEqual(
      a.got.map((r) => r.sequence),
      [1],
      'nothing past the stub before it resolves',
    );
    assert.strictEqual(resolver.calls.length, 1);
    assert.strictEqual(resolver.calls[0].client, clients[0], 'resolves on the LISTEN client');
    resolver.calls[0].resolve(
      makeEventRow({ event_id: 'e2', sequence: 2, payload: LARGE_PAYLOAD }),
    );
    await tick();
    assert.deepStrictEqual(
      a.got.map((r) => r.sequence),
      [1, 2, 3],
    );
    assert.deepStrictEqual(a.got[1].payload, LARGE_PAYLOAD, 'the stub is delivered resolved');
    await n.stop();
  });

  it('AC-3: an event_type-filtered subscriber gets the full payload; non-matching stubs are not read', async () => {
    const { n, clients, resolver } = await started();
    const a = recorder({ eventType: 'order.filled' });
    n.subscribe(a.sub);
    clients[0].notify(stub({ event_type: 'order.canceled', sequence: 4 }));
    await tick();
    assert.strictEqual(resolver.calls.length, 0, 'no subscriber matched — no read');
    clients[0].notify(stub({ event_type: 'order.filled', sequence: 5 }));
    await tick();
    assert.strictEqual(resolver.calls.length, 1);
    resolver.calls[0].resolve(makeEventRow({ sequence: 5, payload: LARGE_PAYLOAD }));
    await tick();
    assert.strictEqual(a.got.length, 1);
    assert.deepStrictEqual(a.got[0].payload, LARGE_PAYLOAD);
    await n.stop();
  });

  it('AC-8: a stream_key-filtered subscriber gets the full payload and occurred_at', async () => {
    const { n, clients, resolver } = await started();
    const a = recorder({ streamKey: 'order-42' });
    n.subscribe(a.sub);
    clients[0].notify(stub({ stream_key: 'order-7', sequence: 6 }));
    await tick();
    assert.strictEqual(resolver.calls.length, 0);
    clients[0].notify(stub({ stream_key: 'order-42', sequence: 7 }));
    await tick();
    assert.strictEqual(resolver.calls.length, 1);
    const occurred = new Date('2026-10-21T11:59:59.000Z');
    resolver.calls[0].resolve(
      makeEventRow({
        stream_key: 'order-42',
        sequence: 7,
        payload: LARGE_PAYLOAD,
        occurred_at: occurred,
      }),
    );
    await tick();
    assert.strictEqual(a.got.length, 1);
    assert.deepStrictEqual(a.got[0].payload, LARGE_PAYLOAD);
    assert.deepStrictEqual(a.got[0].occurred_at, occurred);
    await n.stop();
  });

  for (const [label, notFound] of [
    ['AC-6: a read error', false],
    ['AC-7: no row', true],
  ] as const) {
    it(`${label} → onGap once, the sub leaves fan-out, other subs unaffected`, async () => {
      const { n, clients, resolver } = await started();
      const a = recorder();
      const b = recorder({ streamKey: 'order:2' });
      n.subscribe(a.sub);
      n.subscribe(b.sub);
      clients[0].notify(stub({ stream_key: 'order:1', sequence: 11 }));
      await tick();
      assert.strictEqual(resolver.calls.length, 1);
      if (notFound) resolver.calls[0].resolve(null);
      else resolver.calls[0].reject(new Error('boom'));
      await tick();
      assert.strictEqual(a.gaps.length, 1);
      assert.strictEqual(a.gaps[0].notFound, notFound);
      assert.strictEqual(typeof a.gaps[0].message, 'string');
      clients[0].notify(row({ stream_key: 'order:2', sequence: 12 }));
      await tick();
      assert.deepStrictEqual(a.got, [], 'a gapped subscriber gets nothing more');
      assert.deepStrictEqual(b.gaps, []);
      assert.deepStrictEqual(
        b.got.map((r) => r.sequence),
        [12],
      );
      await n.stop();
    });
  }

  it('AC-9: a backstop timeout gaps the sub, ends the listener, and the reconnect resyncs the rest', async () => {
    const { n, clients, resolver } = await started();
    const a = recorder();
    const b = recorder({ streamKey: 'order:9' });
    n.subscribe(a.sub);
    n.subscribe(b.sub);
    clients[0].notify(stub({ sequence: 13 }));
    await tick();
    assert.strictEqual(resolver.calls.length, 1);
    resolver.calls[0].reject(new Error('Query read timeout'));
    await tick();
    assert.deepStrictEqual(
      a.gaps.map((g) => g.notFound),
      [false],
    );
    assert.strictEqual(clients[0].ended, true, 'the wedged listener is ended');
    clients[0].emit('end');
    await tick();
    await tick();
    assert.ok(clients.length >= 2, 'a replacement listener is created');
    assert.ok(clients[1].connected);
    assert.strictEqual(b.reconnects, 1, 'remaining subscribers resync once');
    assert.strictEqual(a.reconnects, 0);
    await n.stop();
  });

  it('a subscriber added after enqueue is neither gapped nor delivered that event', async () => {
    const { n, clients, resolver } = await started();
    const a = recorder();
    n.subscribe(a.sub);
    clients[0].notify(stub({ sequence: 14 }));
    await tick();
    const c = recorder();
    n.subscribe(c.sub);
    assert.strictEqual(resolver.calls.length, 1);
    resolver.calls[0].resolve(null);
    await tick();
    assert.strictEqual(a.gaps.length, 1);
    assert.deepStrictEqual(c.gaps, []);
    assert.deepStrictEqual(c.got, []);
    await n.stop();
  });

  it('a subscriber removed during the resolve is not written to', async () => {
    const { n, clients, resolver } = await started();
    const a = recorder();
    const unsub = n.subscribe(a.sub);
    clients[0].notify(stub({ sequence: 15 }));
    await tick();
    unsub();
    assert.strictEqual(resolver.calls.length, 1);
    resolver.calls[0].resolve(makeEventRow({ sequence: 15, payload: LARGE_PAYLOAD }));
    await tick();
    assert.deepStrictEqual(a.got, []);
    assert.deepStrictEqual(a.gaps, []);
    await n.stop();
  });

  it('the queue is cleared on reconnect: a stale result and the rows behind it are dropped', async () => {
    const { n, clients, resolver } = await started();
    const a = recorder();
    n.subscribe(a.sub);
    clients[0].notify(stub({ sequence: 16 }));
    clients[0].notify(row({ sequence: 17 }));
    await tick();
    clients[0].emit('error', new Error('connection lost'));
    await tick();
    await tick();
    assert.ok(clients[1].connected);
    assert.strictEqual(resolver.calls.length, 1);
    resolver.calls[0].resolve(makeEventRow({ sequence: 16, payload: LARGE_PAYLOAD }));
    await tick();
    assert.deepStrictEqual(a.got, []);
    assert.deepStrictEqual(a.gaps, []);
    assert.strictEqual(a.reconnects, 1);
    await n.stop();
  });

  it('the queue is cleared on stop(): a held resolve writes nothing', async () => {
    const { n, clients, resolver } = await started();
    const a = recorder();
    n.subscribe(a.sub);
    clients[0].notify(stub({ sequence: 18 }));
    await tick();
    await n.stop();
    assert.strictEqual(resolver.calls.length, 1);
    resolver.calls[0].resolve(makeEventRow({ sequence: 18, payload: LARGE_PAYLOAD }));
    await tick();
    assert.deepStrictEqual(a.got, []);
    assert.deepStrictEqual(a.gaps, []);
  });

  it('stale-drain guard: a stub enqueued on the new generation is resolved and delivered', async () => {
    const { n, clients, resolver } = await started();
    const a = recorder();
    n.subscribe(a.sub);
    clients[0].notify(stub({ sequence: 19 }));
    await tick();
    clients[0].emit('error', new Error('connection lost'));
    await tick();
    await tick();
    clients[1].notify(stub({ sequence: 20 }));
    await tick();
    assert.strictEqual(resolver.calls.length, 1, 'the new head waits for the in-flight drain');
    resolver.calls[0].resolve(makeEventRow({ sequence: 19, payload: LARGE_PAYLOAD }));
    await tick();
    assert.strictEqual(resolver.calls.length, 2, 'the new head is resolved, not dropped');
    assert.strictEqual(resolver.calls[1].stub.sequence, 20);
    assert.strictEqual(resolver.calls[1].client, clients[1]);
    resolver.calls[1].resolve(makeEventRow({ sequence: 20, payload: LARGE_PAYLOAD }));
    await tick();
    assert.deepStrictEqual(
      a.got.map((r) => r.sequence),
      [20],
    );
    assert.deepStrictEqual(a.got[0].payload, LARGE_PAYLOAD);
    await n.stop();
  });

  it('every failure path warns and drain never rejects', async () => {
    const warns: any[] = [];
    const proto: any = transports.Console.prototype;
    const origLog = proto.log;
    proto.log = function (info: any, cb?: () => void) {
      if (info.message === 'trimmed row resolve failed') warns.push(info);
      if (cb) cb();
    };
    const rejections: any[] = [];
    const onRejection = (e: any) => rejections.push(e);
    const listenersBefore = process.listenerCount('unhandledRejection');
    process.on('unhandledRejection', onRejection);
    try {
      const { n, clients, resolver } = await started();
      n.subscribe(recorder().sub);
      n.subscribe(recorder().sub);
      clients[0].notify(stub({ sequence: 21 }));
      clients[0].notify(stub({ sequence: 22 }));
      clients[0].notify(stub({ sequence: 23 }));
      await tick();
      assert.strictEqual(resolver.calls.length, 1);
      resolver.calls[0].resolve(null);
      await tick();
      assert.strictEqual(resolver.calls.length, 2);
      resolver.calls[1].reject(Object.assign(new Error('canceling statement'), { code: '57014' }));
      await tick();
      assert.strictEqual(resolver.calls.length, 3);
      resolver.calls[2].reject(new Error('boom'));
      await tick();
      await n.stop();
    } finally {
      process.off('unhandledRejection', onRejection);
      proto.log = origLog;
    }
    assert.deepStrictEqual(rejections, []);
    assert.strictEqual(process.listenerCount('unhandledRejection'), listenersBefore);
    assert.deepStrictEqual(
      warns.map((w) => w.reason),
      ['not_found', 'timeout', 'error'],
    );
  });
});

describe('EventNotifier — listener health and reconnect-storm logging (feature 294)', () => {
  const DELAY_MS = 2000;
  const flush = () => new Promise<void>((r) => setImmediate(r));
  let reader: CollectingReader;

  before(() => {
    reader = install();
  });

  async function sample(name: string): Promise<number | undefined> {
    const vs = await values(reader, name);
    assert.ok(vs.length <= 1, `${name}: ${JSON.stringify(vs)}`);
    return vs[0];
  }

  // consecutive_failures of each listener WARN, in order.
  function captureFailureWarns(t: TestContext): Array<{ message: string; n: number }> {
    const warns: Array<{ message: string; n: number }> = [];
    t.mock.method(transports.Console.prototype, 'log', (info: any, cb?: () => void) => {
      if (info.consecutive_failures !== undefined) {
        warns.push({ message: info.message, n: info.consecutive_failures });
      }
      cb?.();
    });
    return warns;
  }

  // clients[i] fails connect() when failAt(i); every client is kept for the test to drive.
  function scripted(failAt: (i: number) => boolean) {
    const clients: FakeClient[] = [];
    const n = new EventNotifier(
      () => {
        const c = new FakeClient();
        c.failConnect = failAt(clients.length);
        clients.push(c);
        return c;
      },
      { resolveRow, reconnectDelayMs: DELAY_MS },
    );
    return { n, clients };
  }

  async function advance(t: TestContext, ms: number) {
    t.mock.timers.tick(ms);
    await flush();
  }

  it('AC-27: listener_up goes 0 on a drop and 1 after the reconnect 2 s later; reconnects +1', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { n, clients } = scripted(() => false);
    await n.start();
    assert.strictEqual(await sample('ledger.notify.listener_up'), 1);
    const before = (await sample('ledger.notify.listener_reconnects')) ?? 0;

    clients[0].emit('error', new Error('connection lost'));
    assert.strictEqual(await sample('ledger.notify.listener_up'), 0);
    await advance(t, DELAY_MS - 1);
    assert.strictEqual(clients.length, 1, 'no retry before the 2 s delay');
    await advance(t, 1);
    assert.strictEqual(clients.length, 2);
    assert.ok(clients[1].connected);
    assert.strictEqual(await sample('ledger.notify.listener_up'), 1);
    assert.strictEqual(await sample('ledger.notify.listener_reconnects'), before + 1);
    await n.stop();
  });

  it('AC-40: 30 refused connects warn only at failures 1, 10, 20, 30, each retry 2 s apart; a later failure logs as 1', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const warns = captureFailureWarns(t);
    const { n, clients } = scripted((i) => i < 30);
    await n.start();
    await flush();
    for (let attempt = 2; attempt <= 30; attempt++) {
      await advance(t, DELAY_MS - 1);
      assert.strictEqual(clients.length, attempt - 1, `attempt ${attempt} waits the full 2 s`);
      await advance(t, 1);
      assert.strictEqual(clients.length, attempt);
    }
    assert.deepStrictEqual(
      warns.map((w) => w.n),
      [1, 10, 20, 30],
    );
    assert.ok(warns.every((w) => w.message === 'notify listener connect failed, retrying'));
    assert.strictEqual(await sample('ledger.notify.listener_up'), 0);

    await advance(t, DELAY_MS);
    assert.strictEqual(clients.length, 31);
    assert.ok(clients[30].connected, 'the 31st attempt connects');
    assert.strictEqual(await sample('ledger.notify.listener_up'), 1);

    clients[30].emit('error', new Error('connection lost'));
    assert.deepStrictEqual(warns[warns.length - 1], {
      message: 'notify listener error, reconnecting',
      n: 1,
    });
    await n.stop();
  });

  it('AC-40: an established client emitting error twice and end counts one failure', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const warns = captureFailureWarns(t);
    const { n, clients } = scripted((i) => i > 0);
    await n.start();
    // node-pg 8.x emits 'error' then 'end' when an idle (LISTENing) client's socket dies.
    clients[0].emit('error', new Error('connection lost'));
    clients[0].emit('error', new Error('connection lost again'));
    clients[0].emit('end');
    assert.deepStrictEqual(
      warns.map((w) => w.n),
      [1],
    );
    for (let attempt = 1; attempt <= 8; attempt++) await advance(t, DELAY_MS);
    assert.strictEqual(clients.length, 9);
    assert.strictEqual(warns.length, 1, 'failures 2-9 are not logged');
    await advance(t, DELAY_MS);
    assert.deepStrictEqual(warns[warns.length - 1], {
      message: 'notify listener connect failed, retrying',
      n: 10,
    });
    await n.stop();
  });
});
