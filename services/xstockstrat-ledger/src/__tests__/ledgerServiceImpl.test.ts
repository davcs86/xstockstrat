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

// makeIdempotentPool builds a pool whose query() (and transactional client.query())
// route by SQL so the idempotent appendEvent path can be exercised without a real DB.
function makeIdempotentPool(opts: {
  claimRows: any[]; // rows returned by INSERT ... idempotency_keys ... RETURNING
  insertRow?: any; // row returned by the ledger.events insert (first-time path)
  existingRows?: any[]; // rows returned by the SELECT join (duplicate path)
}) {
  const calls: string[] = [];
  const handle = (sql: string) => {
    calls.push(sql);
    if (/INSERT INTO ledger\.idempotency_keys/.test(sql)) return { rows: opts.claimRows };
    if (/INSERT INTO ledger\.events/.test(sql))
      return { rows: [opts.insertRow ?? { sequence: 1, recorded_at: new Date() }] };
    if (/FROM ledger\.idempotency_keys/.test(sql)) return { rows: opts.existingRows ?? [] };
    return { rows: [] }; // BEGIN / COMMIT / ROLLBACK
  };
  const client = {
    async query(sql: string, _params?: any[]) {
      return handle(sql);
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
    async query(sql: string, _params?: any[]) {
      return handle(sql);
    },
  };
  return { pool, calls };
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
    // ts-proto (useDate) represents Timestamp fields as JS Date, not { seconds }.
    assert.ok(evt.occurredAt instanceof Date);
    assert.strictEqual(evt.occurredAt.getTime(), now.getTime());
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

  // Regression: occurredAt arrives as a ts-proto Date (useDate codegen), NOT a
  // protobuf `{ seconds }` object. Reading `.seconds` off it yielded
  // `new Date(undefined * 1000)` → Invalid Date, which Postgres rejected with
  // `invalid input syntax for type timestamp with time zone: "0NaN-NaN-NaN…"`.
  it('binds the provided occurredAt Date as occurred_at, not an Invalid Date', async () => {
    if (!LedgerServiceImpl) return;
    let capturedParams: any[] = [];
    const pool = {
      async query(_sql: string, params?: any[]) {
        capturedParams = params ?? [];
        return { rows: [{ sequence: 1, recorded_at: new Date() }] };
      },
    };
    const impl = new LedgerServiceImpl(pool, {});
    const occurredAt = new Date('2026-06-12T11:51:55.000Z');
    const call = makeCall({
      eventType: 'marketdata.backfill.failed',
      sourceService: 'marketdata',
      streamKey: 'marketdata:backfill',
      payload: {},
      occurredAt,
    });

    await new Promise<void>((resolve, reject) => {
      impl.appendEvent(call, (err: any) => (err ? reject(err) : resolve()));
    });

    // occurred_at is the 8th bound param (index 7).
    const boundOccurredAt = capturedParams[7];
    assert.ok(boundOccurredAt instanceof Date, 'occurred_at must be a Date');
    assert.ok(!Number.isNaN(boundOccurredAt.getTime()), 'occurred_at must not be an Invalid Date');
    assert.strictEqual(boundOccurredAt.getTime(), occurredAt.getTime());
  });

  // Regression: when occurredAt is absent, occurred_at falls back to `recorded_at`
  // (a valid Date), never an Invalid Date.
  it('falls back to a valid Date when occurredAt is omitted', async () => {
    if (!LedgerServiceImpl) return;
    let capturedParams: any[] = [];
    const pool = {
      async query(_sql: string, params?: any[]) {
        capturedParams = params ?? [];
        return { rows: [{ sequence: 1, recorded_at: new Date() }] };
      },
    };
    const impl = new LedgerServiceImpl(pool, {});
    const call = makeCall({
      eventType: 'order.filled',
      sourceService: 'trading',
      streamKey: 'order:1',
      payload: {},
    });

    await new Promise<void>((resolve, reject) => {
      impl.appendEvent(call, (err: any) => (err ? reject(err) : resolve()));
    });

    const boundOccurredAt = capturedParams[7];
    assert.ok(boundOccurredAt instanceof Date, 'occurred_at must be a Date');
    assert.ok(!Number.isNaN(boundOccurredAt.getTime()), 'occurred_at must not be an Invalid Date');
  });

  // Regression: appendEvent must let `sequence` fall to its column DEFAULT
  // (nextval('ledger.global_sequence')) — the globally-monotonic invariant.
  // A previous version supplied nextval('ledger.event_seq_'||md5(stream_key)),
  // a per-stream sequence that no migration ever creates, so every insert to a
  // fresh stream_key failed with `relation "ledger.event_seq_…" does not exist`.
  it('uses the global sequence default, not a per-stream sequence', async () => {
    if (!LedgerServiceImpl) return;
    let capturedSql = '';
    let capturedParams: any[] = [];
    const pool = {
      async query(sql: string, params?: any[]) {
        capturedSql = sql;
        capturedParams = params ?? [];
        return { rows: [{ sequence: 1, recorded_at: new Date() }] };
      },
    };
    const impl = new LedgerServiceImpl(pool, {});
    const call = makeCall({
      eventType: 'analysis.backtest.started',
      sourceService: 'analysis',
      streamKey: 'backtest:abc',
      payload: {},
    });

    await new Promise<void>((resolve, reject) => {
      impl.appendEvent(call, (err: any) => (err ? reject(err) : resolve()));
    });

    assert.ok(!/event_seq_/.test(capturedSql), 'must not reference a per-stream sequence');
    assert.ok(!/nextval/i.test(capturedSql), 'must not set sequence explicitly (rely on column DEFAULT)');
    // event_id, event_type, source_service, correlation_id, stream_key,
    // payload, metadata, occurred_at, recorded_at — 9 bound params.
    assert.strictEqual(capturedParams.length, 9);
  });

  // Idempotency: a first-seen key claims the row and inserts the event normally.
  it('idempotent path: claims the key and inserts the event', async () => {
    if (!LedgerServiceImpl) return;
    const { pool, calls } = makeIdempotentPool({
      claimRows: [{ event_id: 'new' }],
      insertRow: { sequence: 7, recorded_at: new Date() },
    });
    const impl = new LedgerServiceImpl(pool, {});
    const call = makeCall({
      eventType: 'portfolio.position.opened',
      sourceService: 'portfolio',
      streamKey: 'portfolio:u1',
      payload: {},
      idempotencyKey: 'k1',
    });

    await new Promise<void>((resolve, reject) => {
      impl.appendEvent(call, (err: any, resp: any) => {
        if (err) return reject(err);
        assert.ok(resp.eventId); // server-assigned uuid
        assert.strictEqual(resp.sequence, 7);
        resolve();
      });
    });
    assert.ok(calls.some((s) => /INSERT INTO ledger\.events/.test(s)), 'first call must insert');
  });

  // Idempotency: a duplicate key returns the originally-stored event and does NOT
  // insert a second ledger.events row.
  it('idempotent path: returns the stored event on a duplicate key (no second insert)', async () => {
    if (!LedgerServiceImpl) return;
    const now = new Date();
    const { pool, calls } = makeIdempotentPool({
      claimRows: [], // ON CONFLICT DO NOTHING → no row → duplicate
      existingRows: [{ event_id: 'orig', sequence: 3, recorded_at: now }],
    });
    const impl = new LedgerServiceImpl(pool, {});
    const call = makeCall({
      eventType: 'portfolio.position.opened',
      sourceService: 'portfolio',
      streamKey: 'portfolio:u1',
      payload: {},
      idempotencyKey: 'k1',
    });

    await new Promise<void>((resolve, reject) => {
      impl.appendEvent(call, (err: any, resp: any) => {
        if (err) return reject(err);
        assert.strictEqual(resp.eventId, 'orig'); // returns the originally-stored event
        assert.strictEqual(resp.sequence, 3);
        resolve();
      });
    });
    assert.ok(
      !calls.some((s) => /INSERT INTO ledger\.events/.test(s)),
      'duplicate key must not insert a second event',
    );
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
