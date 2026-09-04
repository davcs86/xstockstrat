/**
 * Best-effort Web Push side-channel on EmitAlert (feature 165), disjoint from FanoutDispatcher and
 * sharing no dedup state. Must never affect the primary StreamAlerts delivery or the EmitAlert RPC result.
 */
import webpush from 'web-push';
import { Pool } from 'pg';
import { alertSeverityToNumber, AlertSeverity } from '@xstockstrat/proto/notify/v1/notify';
import { ConfigWatcher } from '../services/configWatcher';
import { getLogger } from '../services/logger';

const log = getLogger('notify:webpush');

// TTL = push-service retention for an offline device; SEND_TIMEOUT = the outbound socket timeout —
// distinct concerns, do not conflate. Both fixed constants, not config keys (F-07).
const WEBPUSH_TTL_SECONDS = 3600;
const WEBPUSH_SEND_TIMEOUT_MS = 10000;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** The subset of the EmitAlert alert object the push channel consumes (built in notifyServiceImpl). */
export interface PushAlert {
  alertId: string;
  severity: string; // ts-proto string enum, e.g. "ALERT_SEVERITY_WARNING"
  category: string;
  title: string;
  body: string;
  targetUserId: string; // '' means broadcast to every subscription
}

interface SubscriptionRow {
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface PushPayload {
  title: string;
  body: string;
  icon: string;
  // Deterministic tag → OS-level visible-window coalescing of same-category notifications,
  // NOT content-hash dedup (the fanout dedup window is untouched).
  tag: string;
  url?: string;
}

export class WebPushDispatcher {
  private readonly vapidConfigured: boolean;

  constructor(
    private readonly pool: Pool,
    private readonly config: ConfigWatcher,
  ) {
    const priv = process.env.VAPID_PRIVATE_KEY?.trim() || '';
    const pub = process.env.VAPID_PUBLIC_KEY?.trim() || '';
    const subject = process.env.VAPID_SUBJECT?.trim() || '';
    const subjectValid = /^(mailto:|https:)/.test(subject);

    if (priv && pub && subject && !subjectValid) {
      // Malformed subject → web-push throws on every send, swallowed to WARN, silently black-holing
      // all pushes. Fail loud once and disable the channel instead.
      log.error(
        'VAPID_SUBJECT must be a mailto: or https: URL — Web Push disabled until corrected',
        { subject },
      );
    }

    this.vapidConfigured = !!priv && !!pub && !!subject && subjectValid;
    if (this.vapidConfigured) {
      webpush.setVapidDetails(subject, pub, priv);
      log.info('Web Push channel enabled');
    }
  }

  /** Best-effort Web Push. Never throws — the whole body is guarded (FR-3 / @AC-4 / @AC-5). */
  async dispatch(alert: PushAlert): Promise<void> {
    try {
      if (!this.vapidConfigured) return; // FR-5 / @AC-6 — silently disabled when VAPID absent

      // Gate on severity only, read live on every call (FR-5 / @AC-7). Never gate on a context key —
      // no producer reliably writes one (ledger 2026-08-19 020-notify-external-fanout).
      const sevNum = alertSeverityToNumber(alert.severity as AlertSeverity);
      const minSev = clamp(this.config.getInt('notify.push.min_severity', 2), 0, 4);
      if (sevNum < minSev) return;

      // Target by user (empty targetUserId = broadcast to every subscription). Reuse the injected
      // pool — no new pool (F-06).
      const rows = alert.targetUserId
        ? (
            await this.pool.query<SubscriptionRow>(
              'SELECT subscription_id, endpoint, p256dh, auth FROM notify.push_subscriptions WHERE user_id = $1',
              [alert.targetUserId],
            )
          ).rows
        : (
            await this.pool.query<SubscriptionRow>(
              'SELECT subscription_id, endpoint, p256dh, auth FROM notify.push_subscriptions',
            )
          ).rows;

      if (rows.length === 0) return;

      const payload: PushPayload = {
        title: alert.title,
        body: alert.body,
        icon: '/icon-192.png',
        tag: alert.category || 'xstockstrat',
      };
      const body = JSON.stringify(payload);

      for (const row of rows) {
        await this.sendOne(row, body, alert.alertId);
      }
    } catch (e: any) {
      log.warn('push dispatch error', { alertId: alert.alertId, channel: 'push', error: e?.message ?? String(e) });
    }
  }

  // Single outbound-network seam, isolated as a protected method so tests can override it
  // (success / 410 Gone / network error) while gate, query, and prune run for real.
  protected async deliver(subscription: webpush.PushSubscription, body: string): Promise<void> {
    await webpush.sendNotification(subscription, body, {
      TTL: WEBPUSH_TTL_SECONDS,
      timeout: WEBPUSH_SEND_TIMEOUT_MS,
    });
  }

  private async sendOne(row: SubscriptionRow, body: string, alertId: string): Promise<void> {
    try {
      await this.deliver({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body);
    } catch (error: any) {
      // A Gone (404/410) endpoint means the subscription was revoked/expired at the push service —
      // prune it so it is not retried (FR-6 / @AC-8). Any other error is caught and logged at WARN.
      const status = error?.statusCode;
      if (status === 404 || status === 410) {
        try {
          await this.pool.query('DELETE FROM notify.push_subscriptions WHERE endpoint = $1', [row.endpoint]);
          log.info('pruned expired push subscription', { alertId, endpoint: row.endpoint, status });
        } catch (delErr: any) {
          log.warn('failed to prune push subscription', { alertId, endpoint: row.endpoint, error: delErr?.message ?? String(delErr) });
        }
        return;
      }
      log.warn('push channel error', { alertId, channel: 'push', endpoint: row.endpoint, error: error?.message ?? String(error) });
    }
  }
}
