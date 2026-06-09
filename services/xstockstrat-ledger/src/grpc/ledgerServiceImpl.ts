import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { ConfigWatcher } from '../services/configWatcher';
import { getLogger } from '../services/logger';

const log = getLogger('ledger:impl');

export class LedgerServiceImpl {
  constructor(
    private readonly pool: Pool,
    private readonly config: ConfigWatcher,
  ) {}

  /**
   * AppendEvent — core write path.
   * Events are strictly immutable once written (no UPDATE/DELETE on ledger.events).
   */
  async appendEvent(call: any, callback: any) {
    const req = call.request;
    const eventId = uuidv4();
    const now = new Date();

    try {
      const result = await this.pool.query(
        `INSERT INTO ledger.events
           (event_id, event_type, source_service, correlation_id, stream_key,
            payload, metadata, occurred_at, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING sequence, recorded_at`,
        [
          eventId,
          req.eventType,
          req.sourceService,
          req.correlationId || null,
          req.streamKey,
          JSON.stringify(req.payload ?? {}),
          JSON.stringify(req.metadata ?? {}),
          req.occurredAt ? new Date(req.occurredAt.seconds * 1000) : now,
          now,
        ]
      );

      const row = result.rows[0];
      callback(null, {
        eventId,
        sequence: row.sequence,
        recordedAt: row.recorded_at,
      });
    } catch (err: any) {
      log.error('appendEvent failed', { error: err.message, streamKey: req.streamKey });
      callback({ code: 13, message: `Internal error: ${err.message}` });
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
    if (req.timeRange?.start) {
      conditions.push(`occurred_at >= $${p++}`);
      params.push(new Date(req.timeRange.start.seconds * 1000));
    }
    if (req.timeRange?.end) {
      conditions.push(`occurred_at <= $${p++}`);
      params.push(new Date(req.timeRange.end.seconds * 1000));
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
   * Live tail is implemented via LISTEN/NOTIFY on ledger.events_inserted channel.
   */
  async streamEvents(call: any) {
    const req = call.request;

    // Replay historical events first
    try {
      const result = await this.pool.query(
        `SELECT * FROM ledger.events
         WHERE ($1::text IS NULL OR stream_key = $1)
           AND ($2::text IS NULL OR event_type = $2)
           AND sequence >= $3
         ORDER BY sequence ASC`,
        [req.streamKey || null, req.eventType || null, req.fromSequence || 0],
      );

      for (const row of result.rows) {
        call.write(rowToEvent(row));
      }
    } catch (err: any) {
      call.destroy(err);
      return;
    }

    // Tail live via pg LISTEN
    const client = await this.pool.connect();
    const channel = `ledger_stream_${req.streamKey?.replace(/[^a-z0-9]/gi, '_') ?? 'all'}`;
    await client.query(`LISTEN "${channel}"`);

    client.on('notification', (msg) => {
      if (!msg.payload) return;
      try {
        // Notification payload is JSON from a DB trigger — uses DB column names (snake_case).
        // rowToEvent converts to the camelCase shape that ts-proto encode() expects.
        const row = JSON.parse(msg.payload);
        if (!req.eventType || row.event_type === req.eventType) {
          call.write(rowToEvent(row));
        }
      } catch { /* ignore parse errors for malformed NOTIFY payloads */ }
    });

    call.on('cancelled', () => {
      client.query(`UNLISTEN "${channel}"`).finally(() => client.release());
    });
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
