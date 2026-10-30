// Unit tests for LedgerServiceImpl — the pool is an inline mock routed by SQL text; no real DB.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeEventRow as makeRow } from './fixtures/ledgerEvents';
import { makeRecordingCall as makeStreamCall } from './fixtures/streamCall';

let LedgerServiceImpl: any;
let rowToEvent: any;
let toSeq: any;
let parseSequenceToken: any;

// This import must throw on failure — never wrap it in try/catch or early-return on a
// missing subject; a swallowed import turns every case into a silent pass.
before(async () => {
  const mod = await import('../grpc/ledgerServiceImpl.js');
  LedgerServiceImpl = mod.LedgerServiceImpl;
  rowToEvent = mod.rowToEvent;
  toSeq = mod.toSeq;
  parseSequenceToken = mod.parseSequenceToken;
});

describe('test harness', () => {
  it('imports the implementation under test', () => {
    assert.strictEqual(typeof LedgerServiceImpl, 'function', 'LedgerServiceImpl must import — never skip silently');
  });
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
  const pool = makePool(rows, throws);
  return new LedgerServiceImpl(pool, {});
}

function captureQuery(rows: any[] = []) {
  const captured: { sql?: string; params?: any[] } = {};
  const pool = {
    async query(sql: string, params?: any[]) {
      captured.sql = sql;
      captured.params = params;
      return { rows };
    },
  };
  return { impl: new LedgerServiceImpl(pool, {}), captured };
}

function makeCall(req: any) {
  return { request: req };
}

// makeKeysetPool emulates the WHERE/ORDER/LIMIT the impl emits over pg-style string sequences.
// C-13: single consumer (queryEvents keyset tests in this file), so it stays inline.
function makeKeysetPool(rows: any[]) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const pool = {
    async query(sql: string, params: any[] = []) {
      calls.push({ sql, params });
      const param = (re: RegExp) => {
        const m = re.exec(sql);
        return m ? params[Number(m[1]) - 1] : undefined;
      };
      let out = rows.slice();
      const eventType = param(/event_type = \$(\d+)/);
      if (eventType !== undefined) out = out.filter((r) => r.event_type === eventType);
      const userId = param(/user_id = \$(\d+)/);
      if (userId !== undefined) out = out.filter((r) => r.user_id === userId);
      const after = param(/sequence > \$(\d+)::bigint/);
      if (after !== undefined) out = out.filter((r) => toSeq(r.sequence) > BigInt(after));
      if (/ORDER BY sequence ASC/.test(sql)) {
        out.sort((a, b) => (toSeq(a.sequence) < toSeq(b.sequence) ? -1 : 1));
      }
      return { rows: out.slice(0, params[params.length - 1]) };
    },
  };
  return { pool, calls };
}

function queryPage(impl: any, call: any): Promise<{ err: any; resp: any }> {
  return new Promise((resolve) => {
    impl.queryEvents(call, (err: any, resp: any) => resolve({ err, resp }));
  });
}

// makeIdempotentPool builds a pool whose query() (and transactional client.query())
// route by SQL so the idempotent appendEvent path can be exercised without a real DB.
function makeIdempotentPool(opts: {
  claimRows: any[]; // rows returned by INSERT ... idempotency_keys ... RETURNING
  insertRow?: any; // row returned by the ledger.events insert (first-time path)
  existingRows?: any[]; // rows returned by the SELECT join (duplicate path)
  connectThrows?: Error; // pool.connect() rejects with this
  throwOn?: RegExp; // client.query() throws when the SQL matches
}) {
  const calls: string[] = [];
  const releases: unknown[] = [];
  const handle = (sql: string) => {
    calls.push(sql);
    if (opts.throwOn?.test(sql)) throw new Error('connection terminated');
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
    release(err?: unknown) {
      releases.push(err);
    },
  };
  const pool = {
    async connect() {
      if (opts.connectThrows) throw opts.connectThrows;
      return client;
    },
    async query(sql: string, _params?: any[]) {
      return handle(sql);
    },
  };
  return { pool, calls, releases };
}

// ---------------------------------------------------------------------------
// rowToEvent — pure helper
// ---------------------------------------------------------------------------

describe('rowToEvent', () => {
  it('maps row fields to proto event shape', () => {
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
    const evt = rowToEvent(makeRow({ correlation_id: null, metadata: null }));
    assert.strictEqual(evt.correlationId, '');
    assert.deepStrictEqual(evt.metadata, {});
  });

  // Feature 021 — the DB user_id column surfaces on the wire shape (AC-8).
  it('maps user_id onto userId (empty string when NULL)', () => {
    assert.strictEqual(rowToEvent(makeRow({ user_id: 'u_7' })).userId, 'u_7');
    assert.strictEqual(rowToEvent(makeRow({ user_id: null })).userId, '');
  });
});

// ---------------------------------------------------------------------------
// queryEvents
// ---------------------------------------------------------------------------

describe('queryEvents', () => {
  it('returns all events when no filters', async () => {
    const impl = makeImpl([makeRow({ event_id: 'e1' }), makeRow({ event_id: 'e2' })]);
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
    const call = makeCall({ page: { pageSize: 10 } });

    await new Promise<void>((resolve) => {
      impl.queryEvents(call, (err: any) => {
        assert.ok(err);
        assert.strictEqual(err.code, 13);
        resolve();
      });
    });
  });

  // Regression: page.totalCount must always be a number. Before the fix, the
  // response's `page` object omitted `totalCount` entirely, leaving it
  // `undefined` — ts-proto's grpc-js serializer rejects an undefined int32
  // field with "invalid int32: undefined", surfacing to callers (e.g.
  // xstockstrat-portfolio's HydrateStops) as an Internal error.
  it('sets page.totalCount to a number so the int32 field encodes', async () => {
    const impl = makeImpl([makeRow({ event_id: 'e1' }), makeRow({ event_id: 'e2' })]);
    const call = makeCall({ page: { pageSize: 100 } });

    await new Promise<void>((resolve, reject) => {
      impl.queryEvents(call, (err: any, resp: any) => {
        if (err) return reject(err);
        assert.strictEqual(typeof resp.page.totalCount, 'number');
        assert.strictEqual(resp.page.totalCount, 2);
        resolve();
      });
    });
  });

  // Feature 263 — opt-in owner predicate (AC-2/AC-7); flag absent must keep internal callers' SQL.
  function runQuery(impl: any, call: any) {
    return new Promise<void>((resolve, reject) => {
      impl.queryEvents(call, (err: any) => (err ? reject(err) : resolve()));
    });
  }

  it('ownerOnly binds the caller x-user-id as a user_id predicate', async () => {
    const { impl, captured } = captureQuery();
    await runQuery(impl, makeStreamCall({ ownerOnly: true, page: { pageSize: 100 } }, 'u-a'));
    assert.strictEqual(
      captured.sql,
      'SELECT * FROM ledger.events WHERE user_id = $1 ORDER BY sequence ASC LIMIT $2',
    );
    assert.deepStrictEqual(captured.params, ['u-a', 101]);
  });

  it('ownerOnly with no caller binds the empty string (matches nothing)', async () => {
    const { impl, captured } = captureQuery();
    await runQuery(impl, makeStreamCall({ ownerOnly: true, page: { pageSize: 100 } }));
    assert.match(captured.sql ?? '', /WHERE user_id = \$1 /);
    assert.deepStrictEqual(captured.params, ['', 101]);
  });

  it('flag absent leaves the SQL and params unchanged (internal callers)', async () => {
    const { impl, captured } = captureQuery();
    await runQuery(
      impl,
      makeStreamCall({ eventType: 'order.filled', streamKey: 'order:1' }, 'u-a'),
    );
    assert.strictEqual(
      captured.sql,
      'SELECT * FROM ledger.events WHERE stream_key = $1 AND event_type = $2 ORDER BY sequence ASC LIMIT $3',
    );
    assert.deepStrictEqual(captured.params, ['order:1', 'order.filled', 101]);
    assert.doesNotMatch(captured.sql ?? '', /user_id/);
  });

  it('ownerOnly with eventType keeps placeholders sequential and LIMIT last', async () => {
    const { impl, captured } = captureQuery();
    await runQuery(
      impl,
      makeStreamCall({ ownerOnly: true, eventType: 'order.filled', page: { pageSize: 10 } }, 'u-a'),
    );
    assert.strictEqual(
      captured.sql,
      'SELECT * FROM ledger.events WHERE event_type = $1 AND user_id = $2 ORDER BY sequence ASC LIMIT $3',
    );
    assert.deepStrictEqual(captured.params, ['order.filled', 'u-a', 11]);
  });

  // Feature 257 — keyset page token on sequence (pg returns BIGINT sequence as a string).
  it('@AC-1 token walk returns each event once across the 9→10 digit boundary', async () => {
    const rows = [
      makeRow({ event_id: 'e1', sequence: '9' }),
      makeRow({ event_id: 'e2', sequence: '10' }),
      makeRow({ event_id: 'e3', sequence: '11' }),
    ];
    const { pool, calls } = makeKeysetPool(rows);
    const impl = new LedgerServiceImpl(pool, {});
    const p1 = await queryPage(impl, makeCall({ page: { pageSize: 2 } }));
    assert.ifError(p1.err);
    assert.deepStrictEqual(
      p1.resp.events.map((e: any) => e.eventId),
      ['e1', 'e2'],
    );
    assert.strictEqual(p1.resp.page.nextPageToken, '10');
    const p2 = await queryPage(
      impl,
      makeCall({ page: { pageSize: 2, pageToken: p1.resp.page.nextPageToken } }),
    );
    assert.ifError(p2.err);
    assert.deepStrictEqual(
      p2.resp.events.map((e: any) => e.eventId),
      ['e3'],
    );
    assert.strictEqual(p2.resp.page.nextPageToken, '');
    assert.match(calls[1].sql, /sequence > \$/);
    assert.ok(calls[1].params.includes('10'));
  });

  it('@AC-2 an oversized page_size is capped at 1000', async () => {
    const rows = Array.from({ length: 20_000 }, (_, i) =>
      makeRow({ event_id: `e${i + 1}`, sequence: String(i + 1) }),
    );
    const { pool, calls } = makeKeysetPool(rows);
    const { err, resp } = await queryPage(
      new LedgerServiceImpl(pool, {}),
      makeCall({ page: { pageSize: 1_000_000 } }),
    );
    assert.ifError(err);
    assert.strictEqual(resp.events.length, 1000);
    assert.notStrictEqual(resp.page.nextPageToken, '');
    assert.strictEqual(calls[0].params[calls[0].params.length - 1], 1001);
  });

  it('@AC-7 an omitted page_token returns the oldest page in sequence order', async () => {
    const rows = Array.from({ length: 150 }, (_, i) =>
      makeRow({
        event_id: `e${i + 1}`,
        sequence: String(i + 1),
        recorded_at: new Date(Date.UTC(2024, 0, 1, 0, 0, (i * 37) % 150)),
      }),
    );
    for (let i = rows.length - 1; i > 0; i--) {
      const j = (i * 7919) % (i + 1);
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    const want = (n: number) => Array.from({ length: n }, (_, i) => `e${i + 1}`);
    const { pool, calls } = makeKeysetPool(rows);
    const impl = new LedgerServiceImpl(pool, {});
    const first = await queryPage(impl, makeCall({}));
    assert.ifError(first.err);
    assert.deepStrictEqual(
      first.resp.events.map((e: any) => e.eventId),
      want(100),
    );
    assert.notStrictEqual(first.resp.page.nextPageToken, '');
    const all = await queryPage(impl, makeCall({ page: { pageSize: 500 } }));
    assert.deepStrictEqual(
      all.resp.events.map((e: any) => e.eventId),
      want(150),
    );
    assert.strictEqual(all.resp.page.nextPageToken, '');
    assert.match(calls[0].sql, /ORDER BY sequence ASC/);
  });

  it('an exactly-full last page returns an empty token (FR-2)', async () => {
    const { pool } = makeKeysetPool([
      makeRow({ event_id: 'e1', sequence: '1' }),
      makeRow({ event_id: 'e2', sequence: '2' }),
    ]);
    const { resp } = await queryPage(
      new LedgerServiceImpl(pool, {}),
      makeCall({ page: { pageSize: 2 } }),
    );
    assert.strictEqual(resp.events.length, 2);
    assert.strictEqual(resp.page.nextPageToken, '');
  });

  for (const bad of ['abc', '-1', '9223372036854775808', '0b9c6f1e-2d3a-4b5c-8d7e-1f2a3b4c5d6e']) {
    it(`a bad page_token ${JSON.stringify(bad)} → code 3 and no query`, async () => {
      const { pool, calls } = makeKeysetPool([makeRow()]);
      const { err } = await queryPage(
        new LedgerServiceImpl(pool, {}),
        makeCall({ page: { pageSize: 10, pageToken: bad } }),
      );
      assert.strictEqual(err?.code, 3);
      assert.strictEqual(calls.length, 0);
    });
  }

  it('ownerOnly and a page token compose as ANDed predicates with LIMIT last (263)', async () => {
    const { impl, captured } = captureQuery();
    await runQuery(
      impl,
      makeStreamCall(
        { ownerOnly: true, eventType: 't', page: { pageSize: 10, pageToken: '10' } },
        'u-a',
      ),
    );
    assert.match(captured.sql ?? '', /user_id = \$\d+ AND sequence > \$\d+::bigint/);
    assert.deepStrictEqual(captured.params, ['t', 'u-a', '10', 11]);
    assert.match(captured.sql ?? '', /LIMIT \$4$/);
  });

  it('toSeq compares numerically and parseSequenceToken treats empty as first page', () => {
    assert.ok(toSeq('10') > toSeq('9'));
    assert.strictEqual(toSeq(10), toSeq('10'));
    assert.strictEqual(toSeq(10n), toSeq('10'));
    assert.throws(() => toSeq('1e3'));
    assert.strictEqual(parseSequenceToken(''), null);
  });
});

// ---------------------------------------------------------------------------
// getEvent
// ---------------------------------------------------------------------------

describe('getEvent', () => {
  it('returns error code 5 when event not found', async () => {
    const impl = makeImpl([]);
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
    // payload, metadata, occurred_at, recorded_at, user_id — 10 bound params (feature 021).
    assert.strictEqual(capturedParams.length, 10);
  });

  // Idempotency: a first-seen key claims the row and inserts the event normally.
  it('idempotent path: claims the key and inserts the event', async () => {
    const { pool, calls, releases } = makeIdempotentPool({
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
    assert.deepStrictEqual(releases, [undefined], 'success path releases the client without an error');
  });

  // Idempotency: a duplicate key returns the originally-stored event and does NOT
  // insert a second ledger.events row.
  it('idempotent path: returns the stored event on a duplicate key (no second insert)', async () => {
    const now = new Date();
    const { pool, calls, releases } = makeIdempotentPool({
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
    assert.deepStrictEqual(releases, [undefined], 'duplicate path releases the client without an error');
  });

  // Feature 021 — owning user_id is stamped on the write path (AC-8/AC-11 write side).
  // user_id is the 10th bound param (index 9), after occurred_at (7) and recorded_at (8).
  function captureAppend() {
    let capturedParams: any[] = [];
    const pool = {
      async query(_sql: string, params?: any[]) {
        capturedParams = params ?? [];
        return { rows: [{ sequence: 1, recorded_at: new Date() }] };
      },
    };
    return { pool, params: () => capturedParams };
  }

  it('stamps req.userId onto the insert (request field wins)', async () => {
    const { pool, params } = captureAppend();
    const impl = new LedgerServiceImpl(pool, {});
    const call = makeCall({
      eventType: 'order.filled',
      sourceService: 'trading',
      streamKey: 'order:1',
      payload: {},
      userId: 'u_42',
    });
    await new Promise<void>((resolve, reject) => {
      impl.appendEvent(call, (err: any) => (err ? reject(err) : resolve()));
    });
    assert.strictEqual(params()[9], 'u_42');
  });

  it('falls back to the x-user-id metadata when req.userId is empty', async () => {
    const { pool, params } = captureAppend();
    const impl = new LedgerServiceImpl(pool, {});
    const call = {
      request: {
        eventType: 'order.filled',
        sourceService: 'trading',
        streamKey: 'order:1',
        payload: {},
      },
      metadata: { get: (k: string) => (k === 'x-user-id' ? ['u_99'] : []) },
    };
    await new Promise<void>((resolve, reject) => {
      impl.appendEvent(call, (err: any) => (err ? reject(err) : resolve()));
    });
    assert.strictEqual(params()[9], 'u_99');
  });

  it('stamps NULL when neither req.userId nor x-user-id metadata is present', async () => {
    const { pool, params } = captureAppend();
    const impl = new LedgerServiceImpl(pool, {});
    const call = makeCall({
      eventType: 'reconciliation.mismatch_found',
      sourceService: 'trading',
      streamKey: 'recon:1',
      payload: {},
    });
    await new Promise<void>((resolve, reject) => {
      impl.appendEvent(call, (err: any) => (err ? reject(err) : resolve()));
    });
    assert.strictEqual(params()[9], null);
  });
});

// ---------------------------------------------------------------------------
// exportEvents — feature 021 (server-streaming cursor read)
// ---------------------------------------------------------------------------

function makeExportImpl(cfg: { enabled?: boolean; maxDays?: number }) {
  let poolQueried = false;
  const pool = {
    options: { connectionString: 'postgres://x', ssl: false },
    async query() {
      poolQueried = true;
      return { rows: [] };
    },
  };
  const config = {
    getBool: (_k: string, d: boolean) => (cfg.enabled === undefined ? d : cfg.enabled),
    getInt: (_k: string, d: number) => (cfg.maxDays === undefined ? d : cfg.maxDays),
  };
  const impl = new LedgerServiceImpl(pool, config);
  // Capture the SQL/params the export would run; feed controlled batches. This replaces
  // the dedicated pg.Client + pg-cursor read so the filter/order/gate logic is unit-tested
  // without a DB; the real cursor path is exercised by the Playwright e2e (Step 13).
  const captured: { sql?: string; params?: any[] } = {};
  impl.streamExportRows = async (sql: string, params: any[], onBatch: (rows: any[]) => void) => {
    captured.sql = sql;
    captured.params = params;
    // Two batches → proves batched (non-buffered) streaming (AC-7).
    onBatch([
      {
        event_id: 'e1',
        event_type: 'fill',
        source_service: 'xstockstrat-trading',
        correlation_id: 'c1',
        stream_key: 'order:1',
        payload: { qty: 1 },
        metadata: {},
        occurred_at: new Date('2026-01-01T00:00:00Z'),
        recorded_at: new Date('2026-01-01T00:00:00Z'),
        sequence: 1,
        user_id: 'u_42',
      },
    ]);
    onBatch([
      {
        event_id: 'e2',
        event_type: 'signal',
        source_service: 'xstockstrat-analysis',
        correlation_id: 'c2',
        stream_key: 'sig:1',
        payload: {},
        metadata: {},
        occurred_at: new Date('2026-01-02T00:00:00Z'),
        recorded_at: new Date('2026-01-02T00:00:00Z'),
        sequence: 2,
        user_id: 'u_42',
      },
    ]);
  };
  return { impl, captured, poolQueried: () => poolQueried };
}

describe('exportEvents', () => {
  it('AC-10: rejects with FAILED_PRECONDITION (code 9) when ledger.export.enabled=false', async () => {
    const h = makeExportImpl({ enabled: false });
    const call = makeStreamCall({ eventType: '' }, 'u_42');
    await h.impl.exportEvents(call);
    assert.ok(call.destroyed, 'must destroy the stream');
    assert.strictEqual(call.destroyed.code, 9);
    assert.strictEqual(h.captured.sql, undefined, 'no query when disabled');
  });

  it('AC-5: rejects with INVALID_ARGUMENT (code 3) + exact message when window exceeds max', async () => {
    const h = makeExportImpl({ maxDays: 365 });
    const call = makeStreamCall(
      { start: new Date('2024-01-01T00:00:00Z'), end: new Date('2026-01-01T00:00:00Z'), eventType: '' },
      'u_42',
    );
    await h.impl.exportEvents(call);
    assert.ok(call.destroyed);
    assert.strictEqual(call.destroyed.code, 3);
    assert.strictEqual(call.destroyed.message, 'window exceeds ledger.export.max_window_days');
  });

  it('AC-11 + AC-1: scopes to the caller (WHERE user_id = $1) and orders by sequence ASC', async () => {
    const h = makeExportImpl({});
    const call = makeStreamCall(
      { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-02-01T00:00:00Z'), eventType: '' },
      'u_42',
    );
    await h.impl.exportEvents(call);
    assert.match(h.captured.sql ?? '', /WHERE user_id = \$1/);
    assert.match(h.captured.sql ?? '', /ORDER BY sequence ASC/);
    assert.doesNotMatch(h.captured.sql ?? '', /ORDER BY recorded_at/);
    assert.strictEqual((h.captured.params ?? [])[0], 'u_42');
  });

  it('AC-3: applies an event_type = ANY() predicate for a comma-joined subset', async () => {
    const h = makeExportImpl({});
    const call = makeStreamCall(
      { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-02-01T00:00:00Z'), eventType: 'fill,signal' },
      'u_42',
    );
    await h.impl.exportEvents(call);
    assert.match(h.captured.sql ?? '', /event_type = ANY\(\$4\)/);
    assert.deepStrictEqual((h.captured.params ?? [])[3], ['fill', 'signal']);
  });

  it('AC-4: omits the event_type predicate when empty (all types)', async () => {
    const h = makeExportImpl({});
    const call = makeStreamCall(
      { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-02-01T00:00:00Z'), eventType: '' },
      'u_42',
    );
    await h.impl.exportEvents(call);
    assert.doesNotMatch(h.captured.sql ?? '', /event_type = ANY/);
  });

  it('AC-7: streams in batches (multiple write()s) via the dedicated client, never this.pool', async () => {
    const h = makeExportImpl({});
    const call = makeStreamCall(
      { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-02-01T00:00:00Z'), eventType: '' },
      'u_42',
    );
    await h.impl.exportEvents(call);
    assert.strictEqual(call.writes.length, 2, 'one ExportEventsResponse per cursor batch');
    assert.ok(call.ended, 'stream ends after the last batch');
    assert.strictEqual(h.poolQueried(), false, 'export must not touch the write pool (F-06)');
  });

  it('AC-8: each emitted event carries the full wire shape incl userId + payload', async () => {
    const h = makeExportImpl({});
    const call = makeStreamCall(
      { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-02-01T00:00:00Z'), eventType: '' },
      'u_42',
    );
    await h.impl.exportEvents(call);
    const first = call.writes[0].events[0];
    assert.strictEqual(first.eventId, 'e1');
    assert.strictEqual(first.eventType, 'fill');
    assert.strictEqual(first.sourceService, 'xstockstrat-trading');
    assert.strictEqual(first.sequence, 1);
    assert.strictEqual(first.streamKey, 'order:1');
    assert.strictEqual(first.userId, 'u_42');
    assert.deepStrictEqual(first.payload, { qty: 1 });
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
    const { LedgerEvent } = await import('@xstockstrat/proto/ledger/v1/ledger');

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

describe('LedgerServiceImpl.appendEvent — DB failures (feature 258)', () => {
  function appendIdempotent(pool: any, idempotencyKey: string) {
    const impl = new LedgerServiceImpl(pool, {});
    const cbArgs: any[][] = [];
    const done = impl.appendEvent(
      makeCall({ streamKey: 'account:a-1', idempotencyKey, eventType: 'x', payload: {} }),
      (...args: any[]) => cbArgs.push(args),
    );
    return { done, cbArgs };
  }

  it('@AC-5 returns code 13 when pool.connect rejects', async () => {
    assert.ok(LedgerServiceImpl, 'ledgerServiceImpl must import — never skip silently');
    const { pool, releases } = makeIdempotentPool({
      claimRows: [],
      connectThrows: new Error('timeout exceeded when trying to connect'),
    });
    const { done, cbArgs } = appendIdempotent(pool, 'k-1');
    await assert.doesNotReject(done);
    assert.strictEqual(cbArgs.length, 1);
    assert.strictEqual(cbArgs[0][0]?.code, 13);
    assert.deepStrictEqual(releases, [], 'nothing was acquired, so nothing is released');
  });

  it('@AC-10 releases the client with the error when a query in the transaction fails', async () => {
    assert.ok(LedgerServiceImpl, 'ledgerServiceImpl must import — never skip silently');
    const { pool, calls, releases } = makeIdempotentPool({
      claimRows: [{ event_id: 'e' }],
      throwOn: /INSERT INTO ledger\.events/,
    });
    const { done, cbArgs } = appendIdempotent(pool, 'k-2');
    await assert.doesNotReject(done);
    assert.strictEqual(cbArgs.length, 1);
    assert.strictEqual(cbArgs[0][0]?.code, 13);
    assert.strictEqual(releases.length, 1);
    assert.ok(releases[0] instanceof Error, 'release must receive the caught Error');
    assert.strictEqual((releases[0] as Error).message, 'connection terminated');
    assert.ok(calls.includes('ROLLBACK'), 'the failed transaction is rolled back');
  });
});

// ---------------------------------------------------------------------------
// streamEvents — onGap ends the call non-OK (feature 248)
// ---------------------------------------------------------------------------

function makeFakeNotifier() {
  const n = {
    captured: null as any,
    unsubscribed: false,
    subscribe(sub: any) {
      n.captured = sub;
      return () => {
        n.unsubscribed = true;
      };
    },
  };
  return n;
}

describe('streamEvents onGap', () => {
  for (const [label, notFound, code] of [
    ['AC-7: no row → INTERNAL (13)', true, 13],
    ['AC-6: read error → UNAVAILABLE (14)', false, 14],
  ] as const) {
    it(`${label}, never a clean end()`, async () => {
      const notifier = makeFakeNotifier();
      const impl = new LedgerServiceImpl(makePool([]), {}, notifier);
      const call = makeStreamCall({ fromSequence: 10 });
      await impl.streamEvents(call);
      notifier.captured.onGap({ notFound, message: 'm' });
      assert.deepStrictEqual(call.destroyed, { code, message: 'm' });
      assert.strictEqual(call.ended, false);
      assert.strictEqual(notifier.unsubscribed, true);
    });
  }

  it('AC-6 / AC-7 recovery: a fresh stream from the gap replays the full rows in order', async () => {
    const rows = [11, 12].map((s) =>
      makeRow({ event_id: `e${s}`, sequence: s, payload: { n: s } }),
    );
    const impl = new LedgerServiceImpl(makePool(rows), {}, makeFakeNotifier());
    const call = makeStreamCall({ fromSequence: 11 });
    await impl.streamEvents(call);
    assert.deepStrictEqual(
      call.writes.map((w: any) => w.sequence),
      [11, 12],
    );
    assert.deepStrictEqual(
      call.writes.map((w: any) => w.payload),
      [{ n: 11 }, { n: 12 }],
    );
    assert.strictEqual(call.destroyed, null);
  });

  it('onGap during the replay query writes nothing to the destroyed call', async () => {
    let release: (r: any) => void = () => {};
    const pool = {
      query: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    };
    const notifier = makeFakeNotifier();
    const impl = new LedgerServiceImpl(pool, {}, notifier);
    const call = makeStreamCall({ fromSequence: 8 });
    const done = impl.streamEvents(call);
    notifier.captured.onGap({ notFound: false, message: 'm' });
    release({ rows: [8, 9, 10].map((s) => makeRow({ event_id: `e${s}`, sequence: s })) });
    await done;
    assert.deepStrictEqual(call.destroyed, { code: 14, message: 'm' });
    assert.strictEqual(notifier.unsubscribed, true);
    assert.deepStrictEqual(call.writes, []);
  });
});

// ---------------------------------------------------------------------------
// streamEvents — sequence normalisation (feature 248): pg returns BIGINT as a string
// ---------------------------------------------------------------------------

describe('streamEvents sequence normalisation', () => {
  const seqs = (call: any) => call.writes.map((w: any) => Number(w.sequence));

  it('AC-2: a resolved "100" after replayed "98"/"99" is delivered, and NOTIFY 100 is not duplicated', async () => {
    const rows = ['98', '99'].map((s) => makeRow({ event_id: `e${s}`, sequence: s }));
    const notifier = makeFakeNotifier();
    const impl = new LedgerServiceImpl(makePool(rows), {}, notifier);
    const call = makeStreamCall({ fromSequence: 98 });
    await impl.streamEvents(call);
    assert.deepStrictEqual(seqs(call), [98, 99]);

    notifier.captured.onEvent(makeRow({ event_id: 'e100', sequence: '100', payload: { n: 100 } }));
    assert.deepStrictEqual(seqs(call), [98, 99, 100], 'string "100" must not compare lexicographically below "99"');
    assert.deepStrictEqual(call.writes[2].payload, { n: 100 });

    notifier.captured.onEvent(makeRow({ event_id: 'e100', sequence: 100 }));
    assert.deepStrictEqual(seqs(call), [98, 99, 100], 'no duplicate for the NOTIFY number form');
  });

  it('AC-5: a resolved "100" buffered during replay is flushed exactly once', async () => {
    let release: (r: any) => void = () => {};
    const pool = {
      query: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    };
    const notifier = makeFakeNotifier();
    const impl = new LedgerServiceImpl(pool, {}, notifier);
    const call = makeStreamCall({ fromSequence: 98 });
    const done = impl.streamEvents(call);
    notifier.captured.onEvent(makeRow({ event_id: 'e100', sequence: '100' }));
    release({ rows: ['98', '99'].map((s) => makeRow({ event_id: `e${s}`, sequence: s })) });
    await done;
    assert.deepStrictEqual(seqs(call), [98, 99, 100]);
    assert.strictEqual(call.destroyed, null);
  });

  it('encodes a string int64 sequence from a pg row without throwing', async () => {
    const { LedgerEvent } = await import('@xstockstrat/proto/ledger/v1/ledger');
    const event = rowToEvent(makeRow({ sequence: '100' }));
    let bytes: Uint8Array = new Uint8Array();
    assert.doesNotThrow(() => {
      bytes = LedgerEvent.encode(event).finish();
    });
    assert.strictEqual(Number(LedgerEvent.decode(bytes).sequence), 100);
  });
});
