// Real-TimescaleDB tier (iv): needs a migrated database at LEDGER_DB_TEST_URL; run via `pnpm run test:db`.
// Runtime dependencies only (pg, node:*) — production tsc emits this file.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { EventNotifier } from '../../services/eventNotifier';
import {
  RESOLVE_TIMEOUT_KEY,
  makeListenerClient,
  makeResolveRow,
} from '../../services/eventRowResolver';
import { LedgerServiceImpl } from '../../grpc/ledgerServiceImpl';
import { LARGE_PAYLOAD } from '../fixtures/ledgerEvents';
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

function makeConfig(timeoutMs: number) {
  return {
    getInt: (k: string, d: number) => (k === RESOLVE_TIMEOUT_KEY ? timeoutMs : d),
    getBool: (_k: string, d: boolean) => d,
  };
}

type ResolveRow = (client: Client, stub: any) => Promise<any | null>;

async function wire(timeoutMs: number, wrap?: (real: ResolveRow) => ResolveRow) {
  const cfg = makeConfig(timeoutMs);
  const real = makeResolveRow(cfg) as ResolveRow;
  const notifier = new EventNotifier(makeListenerClient(url as string, false, cfg), {
    resolveRow: wrap ? wrap(real) : real,
  });
  await notifier.start();
  const impl = new LedgerServiceImpl(pool, cfg as any, notifier);
  return { notifier, impl };
}

async function nextSequence(): Promise<number> {
  const r = await pool.query('SELECT coalesce(max(sequence), 0) + 1 AS next FROM ledger.events');
  return Number(r.rows[0].next);
}

function append(impl: LedgerServiceImpl, request: any): Promise<any> {
  return new Promise((resolve, reject) =>
    impl.appendEvent({ request, metadata: { get: () => [] } }, (err: any, resp: any) =>
      err ? reject(err) : resolve(resp),
    ),
  );
}

function getEvent(impl: LedgerServiceImpl, eventId: string): Promise<any> {
  return new Promise((resolve, reject) =>
    impl.getEvent({ request: { eventId } }, (err: any, resp: any) =>
      err ? reject(err) : resolve(resp),
    ),
  );
}

async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function event(streamKey: string, overrides: any = {}) {
  return {
    eventType: 'order.filled',
    sourceService: 'xstockstrat-trading',
    streamKey,
    payload: { note: 'small' },
    metadata: {},
    ...overrides,
  };
}

async function appendGapTriple(impl: LedgerServiceImpl, streamKey: string) {
  const e10 = await append(impl, event(streamKey));
  const e11 = await append(impl, event(streamKey, { payload: LARGE_PAYLOAD }));
  const e12 = await append(impl, event(streamKey));
  return { e10, e11, e12 };
}

describe('StreamEvents trimmed-row resolve (real TimescaleDB)', () => {
  it('AC-1: a trimmed live event round-trips to the full row and equals GetEvent; one chunk, one row', async () => {
    const { notifier, impl } = await wire(2000);
    const raw = new Client({ connectionString: url });
    await raw.connect();
    const notifications: string[] = [];
    raw.on('notification', (msg) => msg.payload && notifications.push(msg.payload));
    await raw.query('LISTEN ledger_stream_all');
    try {
      const call = makeRecordingCall({ fromSequence: await nextSequence() });
      await impl.streamEvents(call);
      const appended = await append(
        impl,
        event(`order:${randomUUID()}`, {
          payload: LARGE_PAYLOAD,
          correlationId: 'corr-42',
          metadata: { broker: 'alpaca' },
          userId: 'user-7',
        }),
      );

      await waitFor(() => call.writes.some((w: any) => w.eventId === appended.eventId));
      const live = call.writes.find((w: any) => w.eventId === appended.eventId);
      assert.deepStrictEqual(live, await getEvent(impl, appended.eventId));
      assert.deepStrictEqual(live.payload, LARGE_PAYLOAD);
      assert.strictEqual(live.correlationId, 'corr-42');
      assert.deepStrictEqual(live.metadata, { broker: 'alpaca' });
      assert.strictEqual(live.userId, 'user-7');

      await waitFor(() => notifications.some((n) => JSON.parse(n).event_id === appended.eventId));
      const stub = JSON.parse(
        notifications.find((n) => JSON.parse(n).event_id === appended.eventId) as string,
      );
      assert.ok(!('payload' in stub), 'the NOTIFY body was trimmed');
      assert.deepStrictEqual(Object.keys(stub).sort(), [
        'event_id',
        'event_type',
        'recorded_at',
        'sequence',
        'stream_key',
      ]);

      const pk = [stub.event_id, stub.recorded_at];
      const plan = await pool.query(
        'EXPLAIN (FORMAT JSON) SELECT * FROM ledger.events WHERE event_id = $1 AND recorded_at = $2::timestamptz',
        pk,
      );
      const chunkScans: any[] = [];
      const walk = (node: any) => {
        // Without VERBOSE the plan carries no "Schema"; chunk relations are named _hyper_<h>_<c>_chunk.
        if (/^_hyper_\d+_\d+_chunk$/.test(node['Relation Name'] ?? '')) chunkScans.push(node);
        (node['Plans'] || []).forEach(walk);
      };
      walk(plan.rows[0]['QUERY PLAN'][0]['Plan']);
      assert.strictEqual(chunkScans.length, 1, 'the PK read scans exactly one chunk');
      const rows = await pool.query(
        'SELECT * FROM ledger.events WHERE event_id = $1 AND recorded_at = $2::timestamptz',
        pk,
      );
      assert.strictEqual(rows.rows.length, 1, 'the stub recorded_at text round-trips to the row');
    } finally {
      await raw.end();
      await notifier.stop();
    }
  });

  for (const mode of ['AC-6', 'AC-7'] as const) {
    it(`${mode}: an unresolved stub ends the stream non-OK and a replay from it recovers both rows full`, async () => {
      let first = true;
      const { notifier, impl } = await wire(2000, (real) => async (c, s) => {
        if (first) {
          first = false;
          if (mode === 'AC-6') throw new Error('injected resolve failure');
          return null;
        }
        return real(c, s);
      });
      try {
        const call = makeRecordingCall({ fromSequence: await nextSequence() });
        await impl.streamEvents(call);
        const { e10, e11, e12 } = await appendGapTriple(impl, `order:${randomUUID()}`);

        await waitFor(() => call.destroyed !== null);
        await sleep(100);
        assert.strictEqual(call.destroyed.code, mode === 'AC-6' ? 14 : 13);
        assert.strictEqual(call.ended, false);
        assert.deepStrictEqual(
          call.writes.map((w: any) => w.eventId),
          [e10.eventId],
        );

        const replay = makeRecordingCall({ fromSequence: Number(e11.sequence) });
        await impl.streamEvents(replay);
        assert.deepStrictEqual(
          replay.writes.map((w: any) => w.eventId),
          [e11.eventId, e12.eventId],
        );
        assert.deepStrictEqual(replay.writes[0].payload, LARGE_PAYLOAD);
      } finally {
        await notifier.stop();
      }
    });
  }

  it('AC-9: a resolve past statement_timeout ends only the matching stream (code 14) within 2B', async () => {
    const B = 200;
    const { notifier, impl } = await wire(B, (real) => async (c, s) => {
      await c.query('SELECT pg_sleep(1)');
      return real(c, s);
    });
    try {
      const from = await nextSequence();
      const call = makeRecordingCall({ fromSequence: from });
      await impl.streamEvents(call);
      const other = makeRecordingCall({ fromSequence: from, eventType: 'account.balance.synced' });
      await impl.streamEvents(other);

      const streamKey = `order:${randomUUID()}`;
      await append(impl, event(streamKey));
      await waitFor(() => call.writes.length === 1);
      const t0 = Date.now();
      const e11 = await append(impl, event(streamKey, { payload: LARGE_PAYLOAD }));
      const e12 = await append(impl, event(streamKey));
      await waitFor(() => call.destroyed !== null, 2000);
      const elapsed = Date.now() - t0;
      await sleep(100);

      assert.strictEqual(call.destroyed.code, 14);
      assert.ok(elapsed < 2 * B, `stream ended after ${elapsed} ms (bound ${2 * B} ms)`);
      const ids = call.writes.map((w: any) => w.eventId);
      assert.ok(!ids.includes(e11.eventId) && !ids.includes(e12.eventId));
      assert.strictEqual(other.destroyed, null, 'the non-matching stream is not destroyed');
      assert.strictEqual(other.ended, false);

      const replay = makeRecordingCall({ fromSequence: Number(e11.sequence) });
      await impl.streamEvents(replay);
      assert.deepStrictEqual(
        replay.writes.map((w: any) => w.eventId),
        [e11.eventId, e12.eventId],
      );
      assert.deepStrictEqual(replay.writes[0].payload, LARGE_PAYLOAD);
    } finally {
      await notifier.stop();
    }
  });
});
