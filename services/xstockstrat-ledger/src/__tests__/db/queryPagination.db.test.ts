// Real-TimescaleDB tier (iv): needs a migrated database at LEDGER_DB_TEST_URL; run via `pnpm run test:db`.
// Runtime dependencies only (pg, node:*) — production tsc emits this file.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { EventNotifier } from '../../services/eventNotifier';
import {
  RESOLVE_TIMEOUT_KEY,
  makeListenerClient,
  makeResolveRow,
} from '../../services/eventRowResolver';
import { LedgerServiceImpl, REPLAY_BATCH_SIZE, toSeq } from '../../grpc/ledgerServiceImpl';
import { makeRecordingCall } from '../fixtures/streamCall';

const url = process.env.LEDGER_DB_TEST_URL;
let pool: Pool;

before(() => {
  if (!url) throw new Error('LEDGER_DB_TEST_URL is required');
  pool = new Pool({ connectionString: url, max: 1 });
});

after(async () => {
  await pool?.end();
});

const N = 2 * REPLAY_BATCH_SIZE + 500;
const PAGE_SIZE = 1000;
const OWNER = 'user-a';
// Generous: CI runners are noisy; the assertion is "append is not starved", not a latency SLO.
const APPEND_CEILING_MS = 5000;

const cfg = {
  getInt: (k: string, d: number) => (k === RESOLVE_TIMEOUT_KEY ? 2000 : d),
  getBool: (_k: string, d: boolean) => d,
};

// No explicit `sequence`: the column default (nextval) assigns it, as in production.
// Even rows carry OWNER; odd rows keep user_id NULL.
async function seed(streamKey: string, n: number): Promise<void> {
  await pool.query(
    `INSERT INTO ledger.events
       (event_id, event_type, source_service, stream_key, payload, metadata, occurred_at, recorded_at, user_id)
     SELECT gen_random_uuid(), 'pagination.seed', 'xstockstrat-test', $1, '{}'::jsonb, '{}'::jsonb,
            now(), now(), CASE WHEN i % 2 = 0 THEN $2::text ELSE NULL END
       FROM generate_series(1, $3::int) AS i`,
    [streamKey, OWNER, n],
  );
}

function queryEvents(impl: LedgerServiceImpl, request: any, userId?: string): Promise<any> {
  const metadata = { get: (k: string) => (k === 'x-user-id' && userId ? [userId] : []) };
  return new Promise((resolve, reject) =>
    impl.queryEvents({ request, metadata }, (err: any, resp: any) =>
      err ? reject(err) : resolve(resp),
    ),
  );
}

function appendOne(impl: LedgerServiceImpl, streamKey: string): Promise<any> {
  const request = {
    eventType: 'pagination.append',
    sourceService: 'xstockstrat-test',
    streamKey,
    payload: {},
    metadata: {},
  };
  return new Promise((resolve, reject) =>
    impl.appendEvent({ request, metadata: { get: () => [] } }, (err: any, resp: any) =>
      err ? reject(err) : resolve(resp),
    ),
  );
}

async function walk(
  impl: LedgerServiceImpl,
  request: any,
  userId?: string,
): Promise<{ events: any[]; pages: number; lastToken: string; pageMs: number[] }> {
  const events: any[] = [];
  const pageMs: number[] = [];
  let token = '';
  let pages = 0;
  do {
    const t0 = Date.now();
    const resp = await queryEvents(
      impl,
      { ...request, page: { pageSize: PAGE_SIZE, pageToken: token } },
      userId,
    );
    pageMs.push(Date.now() - t0);
    events.push(...resp.events);
    token = resp.page.nextPageToken;
    pages++;
    assert.ok(pages <= 10, 'token walk did not terminate');
  } while (token !== '');
  return { events, pages, lastToken: token, pageMs };
}

async function expectedIds(streamKey: string): Promise<string[]> {
  const r = await pool.query(
    'SELECT event_id FROM ledger.events WHERE stream_key = $1 ORDER BY sequence ASC',
    [streamKey],
  );
  return r.rows.map((row) => row.event_id);
}

describe('QueryEvents / StreamEvents pagination (real TimescaleDB)', () => {
  it('AC-1: the page-token walk returns every seeded row exactly once, ascending, ownerOnly-scoped', async () => {
    const streamKey = randomUUID();
    await seed(streamKey, N);
    const impl = new LedgerServiceImpl(pool, cfg as any);

    const all = await walk(impl, { streamKey });
    assert.strictEqual(all.pages, Math.ceil(N / PAGE_SIZE));
    assert.strictEqual(all.lastToken, '');
    assert.strictEqual(all.events.length, N);
    assert.strictEqual(new Set(all.events.map((e) => e.eventId)).size, N, 'no duplicates');
    for (let i = 1; i < all.events.length; i++) {
      assert.ok(
        toSeq(all.events[i].sequence) > toSeq(all.events[i - 1].sequence),
        `sequence strictly ascending at ${i}`,
      );
    }
    assert.deepStrictEqual(
      all.events.map((e) => e.eventId),
      await expectedIds(streamKey),
    );

    const owned = await walk(impl, { streamKey, ownerOnly: true }, OWNER);
    assert.strictEqual(owned.events.length, N / 2);
    assert.ok(owned.events.every((e) => e.userId === OWNER));
    assert.strictEqual(owned.pages, Math.ceil(N / 2 / PAGE_SIZE));
    assert.strictEqual(owned.lastToken, '');

    console.log(
      `token_walk pages=${all.pages} per_page_ms=${all.pageMs.join(',')} ` +
        `owner_per_page_ms=${owned.pageMs.join(',')}`,
    );
  });

  it('AC-5: concurrent replays over a one-connection pool do not starve AppendEvent', async () => {
    const streamKey = randomUUID();
    await seed(streamKey, N);
    const notifier = new EventNotifier(makeListenerClient(url as string, false, cfg), {
      resolveRow: makeResolveRow(cfg) as any,
    });
    await notifier.start();
    try {
      const impl = new LedgerServiceImpl(pool, cfg as any, notifier);
      const expected = await expectedIds(streamKey);
      assert.strictEqual(expected.length, N);

      const calls = [0, 1, 2].map(() => makeRecordingCall({ streamKey }));
      const t0 = Date.now();
      let done = false;
      const replays = Promise.all(calls.map((c) => impl.streamEvents(c))).then(() => {
        done = true;
      });

      const latencies: number[] = [];
      const otherKey = randomUUID();
      do {
        const a0 = Date.now();
        await appendOne(impl, otherKey);
        latencies.push(Date.now() - a0);
      } while (!done);
      await replays;
      const replayMs = Date.now() - t0;

      for (const c of calls) {
        assert.strictEqual(c.destroyed, null);
        assert.deepStrictEqual(
          c.writes.map((w: any) => w.eventId),
          expected,
          'each replay delivers every pre-bound row once, ascending',
        );
      }
      const maxAppendMs = Math.max(...latencies);
      console.log(
        `replay max_append_ms=${maxAppendMs} appends=${latencies.length} replay_ms=${replayMs}`,
      );
      assert.ok(
        maxAppendMs < APPEND_CEILING_MS,
        `max appendEvent latency ${maxAppendMs} ms (ceiling ${APPEND_CEILING_MS} ms)`,
      );
    } finally {
      await notifier.stop();
    }
  });
});
