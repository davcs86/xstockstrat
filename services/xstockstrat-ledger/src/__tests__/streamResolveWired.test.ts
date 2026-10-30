// Wired tier: real EventNotifier + makeResolveRow + LedgerServiceImpl over fake pg clients; no real DB.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  LARGE_PAYLOAD,
  TRIMMED_RECORDED_AT,
  makeEventRow,
  toTrimmedStub,
} from './fixtures/ledgerEvents';
import { makeRecordingCall } from './fixtures/streamCall';

let EventNotifier: any;
let makeResolveRow: any;
let LedgerServiceImpl: any;
let rowToEvent: any;

// These imports must throw on failure — never wrap them in try/catch or early-return on a
// missing subject; a swallowed import turns every case into a silent pass.
before(async () => {
  EventNotifier = (await import('../services/eventNotifier.js')).EventNotifier;
  makeResolveRow = (await import('../services/eventRowResolver.js')).makeResolveRow;
  const impl = await import('../grpc/ledgerServiceImpl.js');
  LedgerServiceImpl = impl.LedgerServiceImpl;
  rowToEvent = impl.rowToEvent;
});

const tick = () => new Promise((r) => setTimeout(r, 5));

// The LISTEN client: routes LISTEN / SET statement_timeout / the PK SELECT; a held SELECT parks.
class WiredClient {
  handlers: Record<string, Array<(...a: any[]) => void>> = {};
  rows = new Map<string, any>();
  selects: any[] = [];
  holdSelects = false;
  held: Array<() => void> = [];

  on(event: string, cb: (...a: any[]) => void) {
    (this.handlers[event] ||= []).push(cb);
    return this;
  }
  async connect() {}
  async end() {}
  async query(q: any) {
    const text: string = typeof q === 'string' ? q : q.text;
    if (/^(LISTEN|SET statement_timeout)/.test(text)) return { rows: [] };
    this.selects.push(q);
    if (this.holdSelects) await new Promise<void>((r) => this.held.push(r));
    const row = this.rows.get(q.values[0]);
    return { rows: row ? [row] : [] };
  }
  notify(body: any) {
    (this.handlers.notification || []).forEach((cb) => cb({ payload: JSON.stringify(body) }));
  }
}

// Borrow-counting pool with max-1 semantics: a second outstanding checkout throws.
function makeCountingPool(replay: () => Promise<{ rows: any[] }>) {
  const p = {
    queries: 0,
    connects: 0,
    outstanding: 0,
    async query(sql: string) {
      p.queries++;
      if (/^INSERT INTO ledger\.events/.test(sql))
        return { rows: [{ sequence: 99, recorded_at: new Date() }] };
      return replay();
    },
    async connect() {
      if (p.outstanding >= 1) throw new Error('pool exhausted (max 1)');
      p.connects++;
      p.outstanding++;
      return { query: async () => ({ rows: [] }), release: () => p.outstanding-- };
    },
  };
  return p;
}

async function wire(replay: () => Promise<{ rows: any[] }> = async () => ({ rows: [] })) {
  const client = new WiredClient();
  const notifier = new EventNotifier(() => client, {
    resolveRow: makeResolveRow({ getInt: () => 2000 }),
  });
  await notifier.start();
  const pool = makeCountingPool(replay);
  const impl = new LedgerServiceImpl(pool, {}, notifier);
  return { client, notifier, pool, impl };
}

describe('test harness', () => {
  it('imports the implementations under test', () => {
    assert.strictEqual(typeof EventNotifier, 'function');
    assert.strictEqual(typeof makeResolveRow, 'function');
    assert.strictEqual(typeof LedgerServiceImpl, 'function');
  });
});

describe('StreamEvents live trimmed-row resolve (wired)', () => {
  it('AC-1: a live trimmed event is delivered full and equals the GetEvent mapping', async () => {
    const { client, notifier, impl } = await wire();
    const occurredAt = new Date('2026-10-21T11:59:59.000Z');
    const full = makeEventRow({
      event_id: 'evt-big',
      sequence: 7,
      payload: LARGE_PAYLOAD,
      correlation_id: 'corr-42',
      metadata: { broker: 'alpaca' },
      user_id: 'user-7',
      occurred_at: occurredAt,
      recorded_at: new Date(TRIMMED_RECORDED_AT),
    });
    client.rows.set(full.event_id, full);
    const call = makeRecordingCall({});
    await impl.streamEvents(call);
    client.notify(toTrimmedStub(full));
    await tick();

    assert.deepStrictEqual(client.selects[0].values, ['evt-big', TRIMMED_RECORDED_AT]);
    assert.strictEqual(call.writes.length, 1);
    const msg = call.writes[0];
    assert.deepStrictEqual(msg.payload, LARGE_PAYLOAD);
    assert.strictEqual(JSON.stringify(msg.payload).length, 8000);
    assert.ok(!Number.isNaN(msg.occurredAt.getTime()), 'occurredAt is a valid Date');
    assert.strictEqual(msg.occurredAt.getTime(), occurredAt.getTime());
    assert.strictEqual(msg.sourceService, 'xstockstrat-trading');
    assert.strictEqual(msg.correlationId, 'corr-42');
    assert.deepStrictEqual(msg.metadata, { broker: 'alpaca' });
    assert.strictEqual(msg.userId, 'user-7');
    assert.deepStrictEqual(msg, rowToEvent(full));
    await notifier.stop();
  });

  it('AC-4: the resolve never borrows the query pool, so AppendEvent runs while the reader is stalled', async () => {
    const { client, notifier, pool, impl } = await wire();
    const big = makeEventRow({ event_id: 'evt-8', sequence: 8, payload: LARGE_PAYLOAD });
    const small = makeEventRow({
      event_id: 'evt-9',
      sequence: 9,
      payload: { note: 'x'.repeat(89) },
    });
    client.rows.set(big.event_id, big);
    const call = makeRecordingCall({}, { writeReturns: false });
    await impl.streamEvents(call);
    const afterReplay = { queries: pool.queries, connects: pool.connects };

    client.holdSelects = true;
    client.notify(toTrimmedStub(big));
    client.notify({ ...small, occurred_at: small.occurred_at.toISOString() });
    await tick();
    assert.strictEqual(client.held.length, 1, 'the resolve is in flight on the LISTEN client');

    const appended = await new Promise<any>((resolve, reject) =>
      impl.appendEvent(
        { request: { eventType: 'order.filled', sourceService: 'trading', streamKey: 'order:1' } },
        (err: any, resp: any) => (err ? reject(err) : resolve(resp)),
      ),
    );
    assert.ok(appended.eventId, 'AppendEvent calls back while the reader is stalled');

    client.held.forEach((r) => r());
    await tick();
    assert.strictEqual(pool.connects, afterReplay.connects, 'resolve path: zero pool checkouts');
    assert.strictEqual(pool.queries, afterReplay.queries + 1, 'only the append used the pool');
    assert.deepStrictEqual(
      call.writes.map((w: any) => w.sequence),
      [8, 9],
    );
    assert.deepStrictEqual(call.writes[0].payload, LARGE_PAYLOAD);
    assert.deepStrictEqual(call.writes[1].payload, small.payload);
    await notifier.stop();
  });

  it('AC-5: a trimmed event appended during replay is flushed full, in order, once', async () => {
    let releaseReplay: (r: any) => void = () => {};
    const replayRows = Array.from({ length: 50 }, (_, i) =>
      makeEventRow({ event_id: `evt-${i + 1}`, sequence: i + 1 }),
    );
    const { client, notifier, impl } = await wire(
      () =>
        new Promise((resolve) => {
          releaseReplay = resolve;
        }),
    );
    const occurredAt = new Date('2026-10-21T11:59:58.000Z');
    const big = makeEventRow({
      event_id: 'evt-51',
      sequence: 51,
      payload: LARGE_PAYLOAD,
      occurred_at: occurredAt,
    });
    client.rows.set(big.event_id, big);
    const call = makeRecordingCall({});
    const done = impl.streamEvents(call);
    client.notify(toTrimmedStub(big));
    await tick();
    releaseReplay({ rows: replayRows });
    await done;

    const seqs = call.writes.map((w: any) => w.sequence);
    assert.deepStrictEqual(
      seqs,
      Array.from({ length: 51 }, (_, i) => i + 1),
    );
    assert.deepStrictEqual(call.writes[50].payload, LARGE_PAYLOAD);
    assert.strictEqual(call.writes[50].occurredAt.getTime(), occurredAt.getTime());
    await notifier.stop();
  });
});
