import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { alertSeverityToNumber, alertSeverityFromJSON } from '@xstockstrat/proto/notify/v1/notify';
import { ConfigWatcher } from '../services/configWatcher';
import { FanoutDispatcher } from '../fanout/fanout';
import { WebPushDispatcher } from '../fanout/webPush';
import { getLogger } from '../services/logger';

const log = getLogger('notify:impl');

interface StreamSubscriber {
  userId: string;
  categories: string[];
  severities: number[];
  includeAcknowledged: boolean;
  call: any;
}

export class NotifyServiceImpl {
  /** Active server-streaming subscribers, keyed by subscriptionId */
  private subscribers: Map<string, StreamSubscriber> = new Map();

  constructor(
    private readonly pool: Pool,
    private readonly config: ConfigWatcher,
    private readonly fanout: FanoutDispatcher,
    private readonly webPush: WebPushDispatcher,
  ) {}

  /** EmitAlert — persist the alert, then fan out to matching StreamAlerts subscribers. */
  async emitAlert(call: any, callback: any) {
    const req = call.request;
    // F-10: reject empty/whitespace title/body — proto3 strings default to "" (never null), so the
    // NOT NULL columns never fire and a blank alert would be stored and delivered. code 3 = INVALID_ARGUMENT.
    if (!req.title?.trim() || !req.body?.trim()) {
      return callback({ code: 3, message: 'title and body are required' });
    }
    const alertId = uuidv4();
    const now = new Date();

    try {
      await this.pool.query(
        `INSERT INTO notify.alerts
           (alert_id, severity, category, title, body, source_service, target_user_id,
            context, tags, correlation_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          alertId,
          // severity is a ts-proto string enum (e.g. "ALERT_SEVERITY_WARNING") but the column is
          // INTEGER — convert to the numeric enum value before inserting.
          alertSeverityToNumber(req.severity),
          req.category,
          req.title,
          req.body,
          req.sourceService,
          req.targetUserId || null,
          JSON.stringify(req.context ?? {}),
          req.tags ?? [],
          req.correlationId || null,
          now,
        ]
      );

      // Fan-out to active StreamAlerts subscribers
      const alert = {
        alertId,
        severity: req.severity,
        category: req.category,
        title: req.title,
        body: req.body,
        sourceService: req.sourceService,
        targetUserId: req.targetUserId ?? '',
        context: req.context,
        tags: req.tags ?? [],
        correlationId: req.correlationId ?? '',
        createdAt: now,
        acknowledged: false,
      };

      let deliveredCount = 0;
      for (const [subId, sub] of this.subscribers) {
        if (this.matchesSubscriber(alert, sub)) {
          try {
            sub.call.write(alert);
            deliveredCount++;
          } catch {
            this.subscribers.delete(subId);
          }
        }
      }
      log.info('Alert emitted', { alertId, category: req.category, severity: req.severity, delivered: deliveredCount });

      callback(null, {
        alertId,
        createdAt: now,
      });

      // Best-effort fanout (feature 020): queueMicrotask defers dispatch until AFTER the success
      // callback, so it can never turn a succeeded emit into an RPC error or add stream-write latency.
      queueMicrotask(() =>
        void this.fanout.dispatch(alert).catch((e: any) =>
          log.warn('fanout dispatch rejected', { alertId, error: e?.message ?? String(e) }),
        ),
      );

      // Best-effort Web Push (feature 165): second disjoint queueMicrotask, also after the success
      // callback so a slow/failed push can never turn a succeeded emit into an RPC error.
      queueMicrotask(() =>
        void this.webPush.dispatch(alert).catch((e: any) =>
          log.warn('push dispatch rejected', { alertId, error: e?.message ?? String(e) }),
        ),
      );
    } catch (err: any) {
      log.error('emitAlert failed', { error: err.message });
      callback({ code: 13, message: err.message });
    }
  }

  /** StreamAlerts — long-lived server stream; pushes matching alerts as they are emitted. */
  streamAlerts(call: any) {
    const req = call.request;
    const subId = uuidv4();

    const subscriber: StreamSubscriber = {
      userId: req.userId ?? '',
      categories: req.categories ?? [],
      severities: req.severities ?? [],
      includeAcknowledged: req.includeAcknowledged ?? false,
      call,
    };
    this.subscribers.set(subId, subscriber);

    log.info('New StreamAlerts subscriber', {
      subId,
      userId: subscriber.userId,
      categories: subscriber.categories,
    });

    call.on('cancelled', () => {
      log.info('StreamAlerts subscriber disconnected', { subId });
      this.subscribers.delete(subId);
    });
    call.on('error', () => this.subscribers.delete(subId));
  }

  async acknowledgeAlert(call: any, callback: any) {
    try {
      await this.pool.query(
        'UPDATE notify.alerts SET acknowledged = true, acknowledged_by = $1, acknowledged_at = NOW() WHERE alert_id = $2',
        [call.request.userId, call.request.alertId]
      );
      callback(null, { success: true });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  async listAlerts(call: any, callback: any) {
    const req = call.request;
    try {
      const result = await this.pool.query(
        `SELECT * FROM notify.alerts
         WHERE ($1::text IS NULL OR target_user_id = $1 OR target_user_id IS NULL)
         ORDER BY created_at DESC LIMIT $2`,
        [req.userId || null, req.limit || 50]
      );
      callback(null, { alerts: result.rows.map(rowToAlert) });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  /**
   * RegisterPushSubscription — upsert (by globally-unique `endpoint`) for the calling user (feature 165).
   * Owner comes from the trusted propagated `x-user-id` header (C-03), never the request body.
   */
  async registerPushSubscription(call: any, callback: any) {
    const userId = (call.metadata?.get?.('x-user-id')?.[0] ?? '').toString();
    if (!userId) {
      return callback({ code: 3, message: 'x-user-id header required' });
    }
    const { endpoint, p256dh, auth, userAgent } = call.request;
    if (!endpoint || !p256dh || !auth) {
      return callback({ code: 3, message: 'endpoint, p256dh and auth are required' });
    }
    try {
      const result = await this.pool.query(
        `INSERT INTO notify.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (endpoint) DO UPDATE
           SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
               auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, created_at = NOW()
         RETURNING subscription_id`,
        [userId, endpoint, p256dh, auth, userAgent || null],
      );
      callback(null, { subscriptionId: result.rows[0].subscription_id });
    } catch (err: any) {
      log.error('registerPushSubscription failed', { error: err.message });
      callback({ code: 13, message: err.message });
    }
  }

  /**
   * UnregisterPushSubscription — delete by `endpoint` only, NOT user-scoped: an endpoint is a
   * possession-proven capability and the register upsert can reassign it, so user scoping strands rows (AC-3).
   */
  async unregisterPushSubscription(call: any, callback: any) {
    try {
      const result = await this.pool.query(
        'DELETE FROM notify.push_subscriptions WHERE endpoint = $1',
        [call.request.endpoint],
      );
      callback(null, { deleted: (result.rowCount ?? 0) > 0 });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  private matchesSubscriber(alert: any, sub: StreamSubscriber): boolean {
    if (sub.userId && alert.targetUserId && alert.targetUserId !== sub.userId) {
      return false;
    }
    if (sub.categories.length > 0 && !sub.categories.includes(alert.category)) {
      return false;
    }
    if (sub.severities.length > 0 && !sub.severities.includes(alert.severity)) {
      return false;
    }
    if (!sub.includeAcknowledged && alert.acknowledged) {
      return false;
    }
    return true;
  }
}

export function rowToAlert(row: any) {
  return {
    alertId: row.alert_id,
    // DB stores severity as the numeric enum value but ts-proto's encoder expects the string enum
    // (else UNRECOGNIZED) — convert the integer back here.
    severity: alertSeverityFromJSON(row.severity),
    category: row.category,
    title: row.title,
    body: row.body,
    sourceService: row.source_service,
    targetUserId: row.target_user_id ?? '',
    createdAt: new Date(row.created_at),
    acknowledged: row.acknowledged,
    correlationId: row.correlation_id ?? '',
    tags: row.tags ?? [],
  };
}
