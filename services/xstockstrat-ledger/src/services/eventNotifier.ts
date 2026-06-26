import { Client } from 'pg';
import { getLogger } from './logger';

const log = getLogger('ledger:notifier');

export interface NotifySubscription {
  /** Only deliver rows for this stream_key (raw, unsanitized). Undefined = all. */
  streamKey?: string;
  /** Only deliver rows of this event_type. Undefined = all. */
  eventType?: string;
  /** Called for each matching inserted-event row (snake_case DB-column shape). */
  onEvent: (row: any) => void;
  /**
   * Called after the listener transparently reconnects following a dropped
   * connection. Live NOTIFYs sent while disconnected were lost, so subscribers
   * use this to re-sync — the StreamEvents handler ends its call so the client
   * reconnects and replays the gap from the durable events table.
   */
  onReconnect?: () => void;
}

/**
 * EventNotifier owns a single dedicated LISTEN connection (separate from the
 * query pool) that tails the `ledger_stream_all` channel and fans every
 * inserted event out to in-process subscribers.
 *
 * This decouples live streaming from the DB query pool: a StreamEvents
 * subscriber no longer holds a pooled connection for its entire lifetime, so N
 * concurrent streams can no longer exhaust the pool and wedge AppendEvent. That
 * starvation was the root cause of position/balance-sync ledger writes silently
 * timing out (DeadlineExceeded) — `xstockstrat-portfolio` holds three permanent
 * StreamEvents subscriptions, which alone exceeded the 2-connection pool.
 *
 * The DB trigger (`ledger.notify_event_inserted`) emits every insert to both a
 * per-stream-key channel and `ledger_stream_all`, so listening on the latter
 * sees all events; per-subscriber filtering happens in-process.
 */
export class EventNotifier {
  private client: Client | null = null;
  private readonly subscribers = new Set<NotifySubscription>();
  private closing = false;
  private connectedOnce = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly makeClient: () => Client,
    private readonly channel = 'ledger_stream_all',
    private readonly reconnectDelayMs = 2000,
  ) {}

  /** Open the dedicated listener connection. Best-effort: a connect failure
   *  schedules a retry instead of throwing, so a transient DB blip at startup
   *  never crashes the service. */
  async start(): Promise<void> {
    await this.connect();
  }

  /** Register a subscriber. Returns an unsubscribe function. */
  subscribe(sub: NotifySubscription): () => void {
    this.subscribers.add(sub);
    return () => {
      this.subscribers.delete(sub);
    };
  }

  /** Close the listener connection and drop all subscribers. */
  async stop(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subscribers.clear();
    const c = this.client;
    this.client = null;
    if (c) {
      try {
        await c.end();
      } catch {
        /* already closed */
      }
    }
  }

  private async connect(): Promise<void> {
    if (this.closing) return;
    const client = this.makeClient();
    client.on('error', (err: Error) => {
      log.warn('notify listener error, reconnecting', { error: err.message });
      this.scheduleReconnect();
    });
    client.on('end', () => {
      if (!this.closing) this.scheduleReconnect();
    });
    client.on('notification', (msg: { payload?: string }) => this.dispatch(msg));
    try {
      await client.connect();
      await client.query(`LISTEN "${this.channel}"`);
      this.client = client;
      const reconnected = this.connectedOnce;
      this.connectedOnce = true;
      log.info('notify listener connected', { channel: this.channel, reconnected });
      if (reconnected) {
        // NOTIFYs sent while we were disconnected were lost — tell subscribers
        // to re-sync from the durable event table.
        for (const sub of this.subscribers) {
          try {
            sub.onReconnect?.();
          } catch {
            /* a broken subscriber must not block the others' resync */
          }
        }
      }
    } catch (err: any) {
      log.warn('notify listener connect failed, retrying', { error: err.message });
      try {
        await client.end();
      } catch {
        /* ignore */
      }
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.client = null;
    if (this.closing || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.reconnectDelayMs);
  }

  private dispatch(msg: { payload?: string }): void {
    if (!msg.payload) return;
    let row: any;
    try {
      // Notification payload is JSON from the DB trigger (snake_case columns).
      row = JSON.parse(msg.payload);
    } catch {
      return; // malformed NOTIFY payload — ignore
    }
    for (const sub of this.subscribers) {
      if (sub.streamKey && row.stream_key !== sub.streamKey) continue;
      if (sub.eventType && row.event_type !== sub.eventType) continue;
      try {
        sub.onEvent(row);
      } catch {
        // a slow/broken subscriber must not break fan-out to the others
      }
    }
  }
}
