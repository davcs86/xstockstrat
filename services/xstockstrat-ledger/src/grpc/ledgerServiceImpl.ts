import { Pool, Client } from 'pg';
import Cursor from 'pg-cursor';
import { v4 as uuidv4 } from 'uuid';
import { ConfigWatcher } from '../services/configWatcher';
import { EventNotifier } from '../services/eventNotifier';
import { getLogger } from '../services/logger';

const log = getLogger('ledger:impl');

// ExportEvents cursor page size — one response message per page.
const EXPORT_BATCH_SIZE = 1000;

function readCursor(cursor: Cursor, rowCount: number): Promise<any[]> {
  return new Promise((resolve, reject) => {
    cursor.read(rowCount, (err: Error | undefined, rows: any[]) => (err ? reject(err) : resolve(rows)));
  });
}

export class LedgerServiceImpl {
  constructor(
    private readonly pool: Pool,
    private readonly config: ConfigWatcher,
    // Optional only so streaming-free unit tests can pass a bare pool; production always wires it.
    private readonly notifier?: EventNotifier,
  ) {}

  /**
   * AppendEvent — core write path; events are immutable once written. A non-empty `idempotency_key`
   * appends at most once (a retry returns the stored event); an empty key inserts on every call.
   */
  async appendEvent(call: any, callback: any) {
    const req = call.request;
    const idempotencyKey: string = req.idempotencyKey || '';
    const eventId = uuidv4();
    const now = new Date();

    // Owner precedence: request field, else x-user-id metadata, else NULL.
    const userId: string | null =
      (req.userId && String(req.userId)) || call.metadata?.get?.('x-user-id')?.[0] || null;

    const insertSql = `INSERT INTO ledger.events
         (event_id, event_type, source_service, correlation_id, stream_key,
          payload, metadata, occurred_at, recorded_at, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING sequence, recorded_at`;
    const insertParams = [
      eventId,
      req.eventType,
      req.sourceService,
      req.correlationId || null,
      req.streamKey,
      JSON.stringify(req.payload ?? {}),
      JSON.stringify(req.metadata ?? {}),
      // occurredAt is a ts-proto useDate JS Date; toValidDate guards against a NaN timestamp.
      toValidDate(req.occurredAt, now),
      now,
      userId,
    ];

    // Plain path — no dedup key.
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

    // Idempotent path — claim key + insert atomically; on duplicate, return the stored event.
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
        // Reuse this txn connection for the lookup: a second pooled connection self-deadlocks at pool max=1.
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
        page: { nextPageToken: hasMore ? rows[rows.length - 1].event_id : '', totalCount: rows.length },
      });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  /**
   * StreamEvents — server-streaming; replays from sequence, then tails live. Live tailing uses the
   * shared EventNotifier, not a pooled connection, so an open stream never holds one (replay borrows one).
   */
  async streamEvents(call: any) {
    const req = call.request;
    const notifier = this.notifier;
    if (!notifier) {
      call.destroy(new Error('event notifier not configured'));
      return;
    }

    // Seeded just below fromSequence so the first replayed row (== fromSequence) is delivered.
    let maxSeq = req.fromSequence ? req.fromSequence - 1 : 0;
    let live = false;
    let buffer: any[] = [];

    const writeRow = (row: any) => {
      if (row.sequence > maxSeq) maxSeq = row.sequence;
      call.write(rowToEvent(row));
    };

    // Subscribe BEFORE replaying: events inserted during replay are buffered, then
    // flushed (deduped by sequence), then delivery goes live.
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
        // Missed NOTIFYs during reconnect — end the stream so the client reconnects and replays the gap.
        try {
          call.end();
        } catch {
          /* already closing */
        }
      },
    });

    // Release the subscription on every termination path so a dropped/closed/errored stream can't leak it.
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

    // Client went away during replay — subscription already released, call is dead.
    if (cleaned) return;

    // Flush buffered events (dedup by sequence) then go live; synchronous so no NOTIFY
    // interleaves before live=true.
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

  /**
   * ExportEvents — server-streaming export scoped to the inbound x-user-id (`WHERE user_id = $1` never
   * matches other users' or NULL rows). Reads run on a dedicated pg.Client, never the pool, so a long export can't freeze AppendEvent.
   */
  async exportEvents(call: any) {
    // Config gate — FAILED_PRECONDITION (code 9) when disabled.
    if (!this.config.getBool('ledger.export.enabled', true)) {
      call.destroy({ code: 9, message: 'ledger export is disabled' });
      return;
    }

    const req = call.request;
    const start = toValidDate(req.start, new Date(0));
    const end = toValidDate(req.end, new Date());

    // Window bound — INVALID_ARGUMENT (code 3) with the exact message.
    const maxDays = this.config.getInt('ledger.export.max_window_days', 365);
    const spanDays = (end.getTime() - start.getTime()) / 86_400_000;
    if (spanDays > maxDays) {
      call.destroy({ code: 3, message: 'window exceeds ledger.export.max_window_days' });
      return;
    }

    // Empty caller matches nothing (user_id = '' never true), excluding historical NULL-user_id rows.
    const caller: string = call.metadata?.get?.('x-user-id')?.[0] ?? '';

    // Optional event_type subset.
    const types = String(req.eventType || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const params: any[] = [caller, start, end];
    let sql = `SELECT * FROM ledger.events WHERE user_id = $1 AND occurred_at BETWEEN $2 AND $3`;
    if (types.length) {
      params.push(types);
      sql += ` AND event_type = ANY($4)`;
    }
    sql += ` ORDER BY sequence ASC`;

    try {
      await this.streamExportRows(sql, params, (rows) => {
        call.write({ events: rows.map(rowToEvent) });
      });
      call.end();
    } catch (err: any) {
      log.error('exportEvents failed', { error: err.message });
      call.destroy({ code: 13, message: `Internal error: ${err.message}` });
    }
  }

  /**
   * Open a dedicated pg.Client (never a pooled connection) and read the export query in
   * cursor batches, emitting each page via `onBatch`.
   */
  protected async streamExportRows(
    sql: string,
    params: any[],
    onBatch: (rows: any[]) => void,
  ): Promise<void> {
    const opts = (this.pool as any).options ?? {};
    const client = new Client({ connectionString: opts.connectionString, ssl: opts.ssl });
    await client.connect();
    try {
      const cursor = client.query(new Cursor(sql, params));
      for (;;) {
        const rows = await readCursor(cursor, EXPORT_BATCH_SIZE);
        if (rows.length === 0) break;
        onBatch(rows);
      }
      await cursor.close().catch(() => {});
    } finally {
      await client.end().catch(() => {});
    }
  }
}

/**
 * Coerce a ts-proto useDate value to a valid Date, falling back when missing or Invalid —
 * the immutable event store must never persist a NaN timestamp.
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
    userId: row.user_id ?? '',
  };
}
