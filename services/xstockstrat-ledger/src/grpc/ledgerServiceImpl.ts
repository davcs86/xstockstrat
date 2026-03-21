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
            payload, metadata, occurred_at, recorded_at, sequence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
           nextval('ledger.event_seq_' || md5($5)::text))
         RETURNING sequence, recorded_at`,
        [
          eventId,
          req.event_type,
          req.source_service,
          req.correlation_id || null,
          req.stream_key,
          JSON.stringify(req.payload ?? {}),
          JSON.stringify(req.metadata ?? {}),
          req.occurred_at ? new Date(req.occurred_at.seconds * 1000) : now,
          now,
        ]
      );

      const row = result.rows[0];
      callback(null, {
        event_id: eventId,
        sequence: row.sequence,
        recorded_at: { seconds: Math.floor(row.recorded_at.getTime() / 1000) },
      });
    } catch (err: any) {
      log.error('appendEvent failed', { error: err.message, stream_key: req.stream_key });
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

    if (req.stream_key) {
      conditions.push(`stream_key = $${p++}`);
      params.push(req.stream_key);
    }
    if (req.event_type) {
      conditions.push(`event_type = $${p++}`);
      params.push(req.event_type);
    }
    if (req.source_service) {
      conditions.push(`source_service = $${p++}`);
      params.push(req.source_service);
    }
    if (req.time_range?.start) {
      conditions.push(`occurred_at >= $${p++}`);
      params.push(new Date(req.time_range.start.seconds * 1000));
    }
    if (req.time_range?.end) {
      conditions.push(`occurred_at <= $${p++}`);
      params.push(new Date(req.time_range.end.seconds * 1000));
    }
    if (req.from_sequence) {
      conditions.push(`sequence >= $${p++}`);
      params.push(req.from_sequence);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = req.page?.page_size || 100;
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
        page: { next_page_token: hasMore ? rows[rows.length - 1].event_id : '' },
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
        [req.stream_key || null, req.event_type || null, req.from_sequence || 0],
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
    const channel = `ledger_stream_${req.stream_key?.replace(/[^a-z0-9]/gi, '_') ?? 'all'}`;
    await client.query(`LISTEN "${channel}"`);

    client.on('notification', (msg) => {
      if (!msg.payload) return;
      try {
        const event = JSON.parse(msg.payload);
        if (!req.event_type || event.event_type === req.event_type) {
          call.write(event);
        }
      } catch {}
    });

    call.on('cancelled', () => {
      client.query(`UNLISTEN "${channel}"`).finally(() => client.release());
    });
  }

  async getEvent(call: any, callback: any) {
    try {
      const result = await this.pool.query(
        'SELECT * FROM ledger.events WHERE event_id = $1',
        [call.request.event_id],
      );
      if (result.rows.length === 0) {
        callback({ code: 5, message: `Event ${call.request.event_id} not found` });
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
    event_id: row.event_id,
    event_type: row.event_type,
    source_service: row.source_service,
    correlation_id: row.correlation_id ?? '',
    stream_key: row.stream_key,
    payload: row.payload,
    metadata: row.metadata ?? {},
    occurred_at: { seconds: Math.floor(new Date(row.occurred_at).getTime() / 1000) },
    recorded_at: { seconds: Math.floor(new Date(row.recorded_at).getTime() / 1000) },
    sequence: row.sequence,
  };
}
