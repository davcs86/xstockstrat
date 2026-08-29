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

  /**
   * EmitAlert — any service calls this to emit an alert.
   * Alert is persisted to DB, then fanned-out to all matching StreamAlerts subscribers.
   */
  async emitAlert(call: any, callback: any) {
    const req = call.request;
    // F-10: reject empty (or whitespace-only) title/body before persisting. proto3 strings
    // default to "" (never null), so the NOT NULL columns never fire — a blank alert would
    // otherwise be stored and delivered blank. code 3 === INVALID_ARGUMENT.
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
          // `severity` is a ts-proto string enum (stringEnums codegen), e.g.
          // "ALERT_SEVERITY_WARNING"; the column is INTEGER. Convert to the numeric
          // enum value before inserting — passing the string raised
          // `invalid input syntax for type integer: "ALERT_SEVERITY_WARNING"`.
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

      // Best-effort external fanout (feature 020). queueMicrotask defers dispatch until AFTER the
      // success callback has reported, so fanout can never turn a succeeded emit into an RPC error
      // and never adds latency to the primary stream write (FR-6/AC-4). Both the floating-promise
      // .catch here and the dispatcher's own full-body try/catch guard the unhandled-rejection path.
      queueMicrotask(() =>
        void this.fanout.dispatch(alert).catch((e: any) =>
          log.warn('fanout dispatch rejected', { alertId, error: e?.message ?? String(e) }),
        ),
      );

      // Best-effort Web Push (feature 162). Second, disjoint queueMicrotask beside the fanout one —
      // deferred until AFTER the success callback so a slow/failed push can never turn a succeeded
      // emit into an RPC error or add latency to the primary StreamAlerts write (FR-3/AC-4/AC-5).
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

  /**
   * StreamAlerts — server-streaming RPC.
   * Connection is long-lived. Server pushes alerts as they are emitted.
   * Filters by userId, categories, severities.
   */
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
   * RegisterPushSubscription — upsert a Web Push subscription for the calling user (feature 162).
   * `user_id` is injected by the BFF from the verified session (never trusted from the browser).
   * Keyed on `endpoint` (globally unique) so a re-subscribe from the same browser updates in place
   * and refreshes the rotated p256dh/auth keys instead of duplicating (AC-2).
   */
  async registerPushSubscription(call: any, callback: any) {
    const { userId, endpoint, p256dh, auth, userAgent } = call.request;
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
   * UnregisterPushSubscription — delete a Web Push subscription by endpoint (feature 162).
   * Endpoint-only (no user scoping): an endpoint is a possession-proven capability, and the register
   * upsert can reassign an endpoint to another user, so a user-scoped delete could strand the row (AC-3).
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
    // User filter: broadcast (no target) OR matches target
    if (sub.userId && alert.targetUserId && alert.targetUserId !== sub.userId) {
      return false;
    }
    // Category filter
    if (sub.categories.length > 0 && !sub.categories.includes(alert.category)) {
      return false;
    }
    // Severity filter
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
    // DB stores severity as the numeric enum value; ts-proto's encoder expects the
    // string enum (stringEnums) and maps anything else to UNRECOGNIZED, so convert
    // the integer back to the string enum here.
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
