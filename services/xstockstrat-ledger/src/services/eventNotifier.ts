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
   * Called after the listener reconnects following a dropped connection; NOTIFYs sent
   * while disconnected were lost, so subscribers re-sync (replay the gap).
   */
  onReconnect?: () => void;
  /** Called once when a trimmed row this subscriber matched could not be resolved. The subscriber is
   *  already removed from fan-out and must end its stream non-OK so the client replays the gap. */
  onGap: (gap: { notFound: boolean; message: string }) => void;
}

/**
 * EventNotifier owns a single dedicated LISTEN connection (separate from the query pool) that tails
 * `ledger_stream_all` and fans each insert out to in-process subscribers, filtered per-subscriber.
 * Decoupling from the pool keeps concurrent StreamEvents subscriptions from starving AppendEvent.
 */
export class EventNotifier {
  private client: Client | null = null;
  private readonly subscribers = new Set<NotifySubscription>();
  private closing = false;
  private connectedOnce = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private queue: Array<{ row: any; subs: NotifySubscription[] }> = [];
  private draining = false;
  private gen = 0;
  private readonly resolveRow: (client: Client, stub: any) => Promise<any | null>;
  private readonly channel: string;
  private readonly reconnectDelayMs: number;

  constructor(
    private readonly makeClient: () => Client,
    opts: {
      resolveRow: (client: Client, stub: any) => Promise<any | null>;
      channel?: string;
      reconnectDelayMs?: number;
    },
  ) {
    this.resolveRow = opts.resolveRow;
    this.channel = opts.channel ?? 'ledger_stream_all';
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 2000;
  }

  /** Open the dedicated listener connection. Best-effort: a connect failure schedules a retry instead
   *  of throwing, so a transient DB blip at startup never crashes the service. */
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
    this.gen++;
    this.queue = [];
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
      this.gen++;
      this.queue = [];
      if (reconnected) {
        // NOTIFYs sent while disconnected were lost — tell subscribers to re-sync.
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
    if (!this.draining && this.queue.length === 0 && row.payload !== undefined) {
      this.fanOut(row, this.matching(row));
      return;
    }
    this.queue.push({ row, subs: this.matching(row) });
    if (!this.draining) void this.drain();
  }

  private matching(row: any): NotifySubscription[] {
    const subs: NotifySubscription[] = [];
    for (const sub of this.subscribers) {
      if (sub.streamKey && row.stream_key !== sub.streamKey) continue;
      if (sub.eventType && row.event_type !== sub.eventType) continue;
      subs.push(sub);
    }
    return subs;
  }

  private fanOut(row: any, subs: NotifySubscription[]): void {
    for (const sub of subs) {
      try {
        sub.onEvent(row);
      } catch {
        // a slow/broken subscriber must not break fan-out to the others
      }
    }
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.queue.length) {
        const q = this.queue;
        const g = this.gen;
        const head = q[0];
        if (head.row.payload !== undefined) {
          this.fanOut(
            head.row,
            head.subs.filter((s) => this.subscribers.has(s)),
          );
          q.shift();
          continue;
        }
        if (head.subs.length === 0) {
          q.shift();
          continue;
        }
        const client = this.client;
        const started = Date.now();
        let resolved: any | null = null;
        let failure: any = null;
        try {
          if (!client) throw new Error('notify listener not connected');
          resolved = await this.resolveRow(client, head.row);
        } catch (err: any) {
          failure = err ?? new Error('resolve failed');
        }
        if (g !== this.gen) break;
        const live = head.subs.filter((s) => this.subscribers.has(s));
        if (!failure && resolved) {
          this.fanOut(resolved, live);
        } else {
          const notFound = !failure;
          const errMsg: string = failure?.message ?? String(failure);
          const message = notFound
            ? `ledger event ${head.row.event_id} not found while resolving trimmed notification`
            : `ledger event ${head.row.event_id} could not be resolved: ${errMsg}`;
          for (const sub of live) {
            this.subscribers.delete(sub);
            try {
              sub.onGap({ notFound, message });
            } catch {
              /* a broken subscriber must not block the others' gap signal */
            }
          }
          const timedOut =
            !notFound && (errMsg === 'Query read timeout' || failure?.code === '57014');
          log.warn('trimmed row resolve failed', {
            eventId: head.row.event_id,
            sequence: head.row.sequence,
            reason: notFound ? 'not_found' : timedOut ? 'timeout' : 'error',
            elapsedMs: Date.now() - started,
            queueDepth: q.length,
          });
          if (client && errMsg === 'Query read timeout') {
            // pg leaves the timed-out query on the wire, so the listener is replaced; a spurious
            // backstop (GC or event-loop stall over 2B) causes an avoidable fleet-wide resync.
            void client.end().catch(() => {});
          }
        }
        q.shift();
      }
    } catch (err: any) {
      log.warn('notify drain failed', { error: err?.message });
    } finally {
      this.draining = false;
      if (this.queue.length) void this.drain();
    }
  }
}
