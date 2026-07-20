import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { ConfigWatcher } from '../services/configWatcher';
import { EventNotifier } from '../services/eventNotifier';
import { getLogger } from '../services/logger';

const log = getLogger('ledger:impl');

export class LedgerServiceImpl {
  constructor(
    private readonly pool: Pool,
    private readonly config: ConfigWatcher,
    // Shared LISTEN/NOTIFY fan-out used by StreamEvents. Optional only so unit
    // tests (which never exercise streaming) can construct the impl with a
    // bare pool; production always wires it.
    private readonly notifier?: EventNotifier,
  ) {}

  /**
   * AppendEvent — core write path.
   * Events are strictly immutable once written (no UPDATE/DELETE on ledger.events).
   *
   * When the request carries an `idempotency_key`, the event is appended at most once
   * for that key: a retried AppendEvent (e.g. after a transient transport failure such
   * as a ledger restart GOAWAY) returns the originally-stored event instead of inserting
   * a duplicate. An empty key preserves the prior behavior (every call inserts).
   */
  async appendEvent(call: any, callback: any) {
    const req = call.request;
    const idempotencyKey: string = req.idempotencyKey || '';
    const eventId = uuidv4();
    const now = new Date();

    // event-insert columns + values, shared by the plain and idempotent paths.
    const insertSql = `INSERT INTO ledger.events
         (event_id, event_type, source_service, correlation_id, stream_key,
          payload, metadata, occurred_at, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING sequence, recorded_at`;
    const insertParams = [
      eventId,
      req.eventType,
      req.sourceService,
      req.correlationId || null,
      req.streamKey,
      JSON.stringify(req.payload ?? {}),
      JSON.stringify(req.metadata ?? {}),
      // occurredAt is decoded by ts-proto (useDate) into a JS Date — pass it
      // straight through. Treating it as a protobuf `{ seconds }` object here
      // produced `new Date(undefined * 1000)` → Invalid Date, which Postgres
      // rejected as `invalid input syntax for type timestamp` ("0NaN-NaN-NaN…").
      toValidDate(req.occurredAt, now),
      now,
    ];

    // Plain path — no dedup key, behave exactly as before.
    if (!idempotencyKey) {
      try {
        const result = await this.pool.query(insertSql, insertParams);
        const row = result.rows[0];
        callback(null, { eventId, sequence: row.sequence, recordedAt: row.recorded_at });
      } catch (err: any) {
        log.error('appendEvent failed', { error: err.message, streamKey: req.streamKey });
        callback({ code: 13, message: `Internal error: ${err.message}` });
      }
      return;
    }

    // Idempotent path — claim the key and insert the event atomically. On a duplicate
    // key, return the event already stored for it instead of appending again.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const claim = await client.query(
        `INSERT INTO ledger.idempotency_keys (idempotency_key, event_id)
         VALUES ($1, $2) ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING event_id`,
        [idempotencyKey, eventId]
      );

      if (claim.rows.length === 0) {
        // Key already claimed — the event exists. Roll back our no-op claim and return it.
        // Reuse the transaction's own connection for the lookup (post-ROLLBACK the
        // session is reusable): borrowing a second pooled connection here would
        // require pool max >= 2 and self-deadlock at max = 1.
        await client.query('ROLLBACK');
        const existing = await client.query(
          `SELECT e.event_id, e.sequence, e.recorded_at
             FROM ledger.idempotency_keys k
             JOIN ledger.events e ON e.event_id = k.event_id
            WHERE k.idempotency_key = $1`,
          [idempotencyKey]
        );
        if (existing.rows.length === 0) {
          callback({ code: 13, message: 'idempotency key present but its event was not found' });
          return;
        }
        const r = existing.rows[0];
        log.info('appendEvent deduplicated', {
          idempotencyKey,
          eventId: r.event_id,
          streamKey: req.streamKey,
        });
        callback(null, { eventId: r.event_id, sequence: r.sequence, recordedAt: r.recorded_at });
        return;
      }

      const result = await client.query(insertSql, insertParams);
      await client.query('COMMIT');
      const row = result.rows[0];
      callback(null, { eventId, sequence: row.sequence, recordedAt: row.recorded_at });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      log.error('appendEvent failed', { error: err.message, streamKey: req.streamKey });
      callback({ code: 13, message: `Internal error: ${err.message}` });
    } finally {
      client.release();
    }
  }

  /**
   * QueryEvents — paginated event query with optional filters.
   */
  async queryEvents(call: any, callback: any) {
    const req = call.request;
    const conditions: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (req.streamKey) {
      conditions.push(`stream_key = $${p++}`);
      params.push(req.streamKey);
    }
    if (req.eventType) {
      conditions.push(`event_type = $${p++}`);
      params.push(req.eventType);
    }
    if (req.sourceService) {
      conditions.push(`source_service = $${p++}`);
      params.push(req.sourceService);
    }
    // timeRange.start/end are ts-proto Date objects (useDate) — pass through.
    if (req.timeRange?.start) {
      conditions.push(`occurred_at >= $${p++}`);
      params.push(req.timeRange.start);
    }
    if (req.timeRange?.end) {
      conditions.push(`occurred_at <= $${p++}`);
      params.push(req.timeRange.end);
    }
    if (req.fromSequence) {
      conditions.push(`sequence >= $${p++}`);
      params.push(req.fromSequence);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = req.page?.pageSize || 100;
    params.push(limit + 1);

    try {
      const result = await this.pool.query(
        `SELECT * FROM ledger.events ${where} ORDER BY recorded_at ASC LIMIT $${p}`,
        params,
      );

      const hasMore = result.rows.length > limit;
      const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

      callback(null, {
        events: rows.map(rowToEvent),
        page: { nextPageToken: hasMore ? rows[rows.length - 1].event_id : '' },
      });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  /**
   * StreamEvents — server-streaming; replays from sequence then tails live.
   *
   * Live tailing uses the shared EventNotifier (a single dedicated LISTEN
   * connection that fans out to all subscribers) rather than a per-stream
   * pooled connection, so an open stream never holds a pool connection for its
   * lifetime. Replay borrows a pool connection only for the duration of the
   * historical query and releases it immediately.
   */
  async streamEvents(call: any) {
    const req = call.request;
    const notifier = this.notifier;
    if (!notifier) {
      call.destroy(new Error('event notifier not configured'));
      return;
    }

    // Highest sequence written so far. Seeded just below fromSequence so the
    // first replayed row (sequence === fromSequence) is delivered.
    let maxSeq = req.fromSequence ? req.fromSequence - 1 : 0;
    let live = false;
    let buffer: any[] = [];

    const writeRow = (row: any) => {
      if (row.sequence > maxSeq) maxSeq = row.sequence;
      // rowToEvent converts the snake_case DB/NOTIFY row to the camelCase shape
      // that ts-proto encode() expects.
      call.write(rowToEvent(row));
    };

    // Subscribe to live events BEFORE replaying history: events inserted during
    // replay are buffered (not lost), then flushed (deduped by sequence) once
    // replay finishes, after which delivery switches to direct/live.
    const unsubscribe = notifier.subscribe({
      streamKey: req.streamKey || undefined,
      eventType: req.eventType || undefined,
      onEvent: (row) => {
        if (!live) {
          buffer.push(row);
          return;
        }
        if (row.sequence > maxSeq) writeRow(row);
      },
      onReconnect: () => {
        // The listener missed live NOTIFYs while reconnecting. End the stream so
        // the client reconnects and replays the gap from the durable table
        // (consumers resume from their last processed sequence).
        try {
          call.end();
        } catch {
          /* already closing */
        }
      },
    });

    // Release the subscription on every termination path — not just
    // 'cancelled' — so a dropped/closed/errored stream can never leak it.
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      unsubscribe();
    };
    call.on('cancelled', cleanup);
    call.on('close', cleanup);
    call.on('error', cleanup);

    // Replay history (borrow + release a pool connection — no long-held conn).
    try {
      const result = await this.pool.query(
        `SELECT * FROM ledger.events
         WHERE ($1::text IS NULL OR stream_key = $1)
           AND ($2::text IS NULL OR event_type = $2)
           AND sequence >= $3
         ORDER BY sequence ASC`,
        [req.streamKey || null, req.eventType || null, req.fromSequence || 0],
      );
      for (const row of result.rows) writeRow(row);
    } catch (err: any) {
      cleanup();
      call.destroy(err);
      return;
    }

    // If the client went away while we were replaying, stop here — the
    // subscription is already released and the call is dead.
    if (cleaned) return;

    // Flush events buffered during replay (dedup by sequence), then go live.
    // This block is synchronous, so no notification can interleave between the
    // flush and the `live = true` switch.
    for (const row of buffer) {
      if (row.sequence > maxSeq) writeRow(row);
    }
    buffer = [];
    live = true;
  }

  async getEvent(call: any, callback: any) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM ledger.events WHERE event_id = $1',
        [call.request.eventId],
      );
      if (result.rows.length === 0) {
        callback({ code: 5, message: `Event ${call.request.eventId} not found` });
        return;
      }
      callback(null, rowToEvent(result.rows[0]));
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }
}

/**
 * Coerce a ts-proto timestamp field (a JS `Date` under the default `useDate`
 * codegen) into a valid Date for Postgres, falling back when the value is
 * missing or an Invalid Date. Guards the append path — the immutable event
 * store must never persist a NaN timestamp.
 */
export function toValidDate(value: unknown, fallback: Date): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return fallback;
}

export function rowToEvent(row: any) {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    sourceService: row.source_service,
    correlationId: row.correlation_id ?? '',
    streamKey: row.stream_key,
    payload: row.payload,
    metadata: row.metadata ?? {},
    occurredAt: new Date(row.occurred_at),
    recordedAt: new Date(row.recorded_at),
    sequence: row.sequence,
  };
}
