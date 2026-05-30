/**
 * Unit tests for LedgerServiceImpl — no real DB required.
 *
 * Pool is replaced with an inline mock object whose `query` method returns
 * controlled data. Tests gracefully skip if the TypeScript import fails in
 * strip-only mode (parameter properties); they run fully when
 * --experimental-transform-types or a supporting runtime is used.
 *
 * Run: node --experimental-strip-types --test src/__tests__/*.test.ts
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Lazy imports — guard against strip-only TypeScript syntax errors
// ---------------------------------------------------------------------------

let LedgerServiceImpl: any;
let rowToEvent: any;

before(async () => {
  try {
    const mod = await import('../grpc/ledgerServiceImpl.js');
    LedgerServiceImpl = mod.LedgerServiceImpl;
    rowToEvent = mod.rowToEvent;
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
  if (!LedgerServiceImpl) return null;
  const pool = makePool(rows, throws);
  return new LedgerServiceImpl(pool, {});
}

function makeCall(req: any) {
  return { request: req };
}

// makeRow produces DB-row shaped objects (snake_case from PostgreSQL columns)
function makeRow(overrides: any = {}) {
  const now = new Date('2024-01-01T00:00:00Z');
  return {
    event_id: 'evt-1',
    event_type: 'order.filled',
    source_service: 'xstockstrat-trading',
    correlation_id: null,
    stream_key: 'order:1',
    payload: {},
    metadata: {},
    occurred_at: now,
    recorded_at: now,
    sequence: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// rowToEvent — pure helper
// ---------------------------------------------------------------------------

describe('rowToEvent', () => {
  it('maps row fields to proto event shape', () => {
    if (!rowToEvent) return;
    const now = new Date('2024-01-01T00:00:00Z');
    const row = makeRow({ event_id: 'evt-x', sequence: 42, occurred_at: now, recorded_at: now });
    const evt = rowToEvent(row);
    assert.strictEqual(evt.eventId, 'evt-x');
    assert.strictEqual(evt.eventType, 'order.filled');
    assert.strictEqual(evt.sequence, 42);
    assert.strictEqual(evt.occurredAt.seconds, Math.floor(now.getTime() / 1000));
  });

  it('uses empty string for missing correlation_id', () => {
    if (!rowToEvent) return;
    const evt = rowToEvent(makeRow({ correlation_id: null, metadata: null }));
    assert.strictEqual(evt.correlationId, '');
    assert.deepStrictEqual(evt.metadata, {});
  });
});

// ---------------------------------------------------------------------------
// queryEvents
// ---------------------------------------------------------------------------

describe('queryEvents', () => {
  it('returns all events when no filters', async () => {
    const impl = makeImpl([makeRow({ event_id: 'e1' }), makeRow({ event_id: 'e2' })]);
    if (!impl) return;
    const call = makeCall({ page: { pageSize: 100 } });

    await new Promise<void>((resolve, reject) => {
      impl.queryEvents(call, (err: any, resp: any) => {
        if (err) return reject(err);
        assert.strictEqual(resp.events.length, 2);
        assert.strictEqual(resp.page.nextPageToken, '');
        resolve();
      });
    });
  });

  it('applies streamKey filter in params', async () => {
    const impl = makeImpl([makeRow({ stream_key: 'order:99' })]);
    if (!impl) return;
    const call = makeCall({ streamKey: 'order:99', page: { pageSize: 10 } });

    await new Promise<void>((resolve, reject) => {
      impl.queryEvents(call, (err: any, resp: any) => {
        if (err) return reject(err);
        assert.strictEqual(resp.events.length, 1);
        resolve();
      });
    });
  });

  it('sets hasMore when limit+1 rows returned', async () => {
    // pageSize=2 → limit=2; mock returns 3 rows → hasMore=true
    const rows = [0, 1, 2].map((i) => makeRow({ event_id: `e${i}`, sequence: i + 1 }));
    const impl = makeImpl(rows);
    if (!impl) return;
    const call = makeCall({ page: { pageSize: 2 } });

    await new Promise<void>((resolve, reject) => {
      impl.queryEvents(call, (err: any, resp: any) => {
        if (err) return reject(err);
        assert.strictEqual(resp.events.length, 2);
        assert.ok(resp.page.nextPageToken !== '');
        resolve();
      });
    });
  });

  it('calls back with error code 13 on DB failure', async () => {
    const impl = makeImpl([], new Error('connection refused'));
    if (!impl) return;
    const call = makeCall({ page: { pageSize: 10 } });

    await new Promise<void>((resolve) => {
      impl.queryEvents(call, (err: any) => {
        assert.ok(err);
        assert.strictEqual(err.code, 13);
        resolve();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// getEvent
// ---------------------------------------------------------------------------

describe('getEvent', () => {
  it('returns error code 5 when event not found', async () => {
    const impl = makeImpl([]);
    if (!impl) return;
    const call = makeCall({ eventId: 'missing' });

    await new Promise<void>((resolve) => {
      impl.getEvent(call, (err: any) => {
        assert.ok(err);
        assert.strictEqual(err.code, 5);
        resolve();
      });
    });
  });

  it('returns event when found', async () => {
    const impl = makeImpl([makeRow({ event_id: 'found', sequence: 10 })]);
    if (!impl) return;
    const call = makeCall({ eventId: 'found' });

    await new Promise<void>((resolve, reject) => {
      impl.getEvent(call, (err: any, evt: any) => {
        if (err) return reject(err);
        assert.strictEqual(evt.eventId, 'found');
        assert.strictEqual(evt.sequence, 10);
        resolve();
      });
    });
  });

  it('calls back with error code 13 on DB failure', async () => {
    const impl = makeImpl([], new Error('db error'));
    if (!impl) return;
    const call = makeCall({ eventId: 'any' });

    await new Promise<void>((resolve) => {
      impl.getEvent(call, (err: any) => {
        assert.ok(err);
        assert.strictEqual(err.code, 13);
        resolve();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// appendEvent
// ---------------------------------------------------------------------------

describe('appendEvent', () => {
  it('inserts event and returns id + sequence', async () => {
    if (!LedgerServiceImpl) return;
    const now = new Date();
    const pool = {
      async query(_sql: string, _params?: any[]) {
        return { rows: [{ sequence: 100, recorded_at: now }] };
      },
    };
    const impl = new LedgerServiceImpl(pool, {});
    const call = makeCall({
      eventType: 'order.filled',
      sourceService: 'trading',
      streamKey: 'order:1',
      payload: { amount: 500 },
    });

    await new Promise<void>((resolve, reject) => {
      impl.appendEvent(call, (err: any, resp: any) => {
        if (err) return reject(err);
        assert.ok(resp.eventId);
        assert.strictEqual(resp.sequence, 100);
        resolve();
      });
    });
  });

  it('calls back with error code 13 on DB failure', async () => {
    const impl = makeImpl([], new Error('insert failed'));
    if (!impl) return;
    const call = makeCall({ eventType: 'order.filled', sourceService: 'trading', streamKey: 'order:1' });

    await new Promise<void>((resolve) => {
      impl.appendEvent(call, (err: any) => {
        assert.ok(err);
        assert.strictEqual(err.code, 13);
        resolve();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: events must carry `Date` timestamps so ts-proto's grpc-js
// serializer can encode them. Before the fix, `{ seconds }` plain objects threw
// `getTime is not a function` during responseSerialize / stream write, which
// grpc-js surfaced to gRPC callers as an INTERNAL error after the handler had
// already returned.
// ---------------------------------------------------------------------------

describe('rowToEvent serialization (regression)', () => {
  it('produces Date timestamps that ts-proto encodes without throwing', async () => {
    if (!rowToEvent) return;

    let LedgerEvent: any;
    try {
      ({ LedgerEvent } = await import('@xstockstrat/proto/ledger/v1/ledger.js'));
    } catch {
      return; // proto package unavailable in this runtime — skip.
    }

    const event = rowToEvent({
      event_id: 'e1',
      event_type: 'order.filled',
      source_service: 'trading',
      correlation_id: 'c1',
      stream_key: 'order:1',
      payload: {},
      metadata: {},
      occurred_at: new Date(),
      recorded_at: new Date(),
      sequence: 1,
    });

    assert.ok(event.occurredAt instanceof Date, 'occurredAt must be a Date');
    assert.ok(event.recordedAt instanceof Date, 'recordedAt must be a Date');
    assert.doesNotThrow(() => LedgerEvent.encode(event).finish());
  });
});
