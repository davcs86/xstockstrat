import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { ConfigWatcher } from '../services/configWatcher';
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
  ) {}

  /**
   * EmitAlert — any service calls this to emit an alert.
   * Alert is persisted to DB, then fanned-out to all matching StreamAlerts subscribers.
   */
  async emitAlert(call: any, callback: any) {
    const req = call.request;
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
          req.severity,
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
        createdAt: { seconds: Math.floor(now.getTime() / 1000) },
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
        createdAt: { seconds: Math.floor(now.getTime() / 1000) },
      });
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
    severity: row.severity,
    category: row.category,
    title: row.title,
    body: row.body,
    sourceService: row.source_service,
    targetUserId: row.target_user_id ?? '',
    createdAt: { seconds: Math.floor(new Date(row.created_at).getTime() / 1000) },
    acknowledged: row.acknowledged,
    correlationId: row.correlation_id ?? '',
    tags: row.tags ?? [],
  };
}
