/**
 * Best-effort Slack/SendGrid side-channel on EmitAlert (feature 020). Must never affect the primary
 * StreamAlerts delivery or the EmitAlert RPC result — every failure is caught and logged at WARN.
 */
import { createHash } from 'node:crypto';
import { alertSeverityToNumber, AlertSeverity } from '@xstockstrat/proto/notify/v1/notify';
import { ConfigWatcher } from '../services/configWatcher';
import { getLogger } from '../services/logger';
import { recordDelivery } from '../telemetry';
import { renderEmail, type FanoutPayload } from './emailRender';
import { FANOUT_HTTP_TIMEOUT_MS, SendgridSender } from './sendgridSender';

const log = getLogger('notify:fanout');

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** The camelCase alert object EmitAlert builds and hands to dispatch(). */
export interface FanoutAlert {
  alertId: string;
  severity: string; // ts-proto string enum, e.g. "ALERT_SEVERITY_WARNING"
  category: string;
  title: string;
  body: string;
  sourceService: string;
  context?: Record<string, unknown>;
  createdAt: Date;
}

export class FanoutDispatcher {
  private readonly slackWebhookUrl: string;
  private readonly sendgrid: SendgridSender;
  private readonly dedup: Map<string, number> = new Map();

  constructor(private readonly config: ConfigWatcher) {
    this.slackWebhookUrl = process.env.SLACK_WEBHOOK_URL?.trim() || '';
    this.sendgrid = new SendgridSender(config);
  }

  /** Credential presence only; email can still be off when the from/to config keys are empty. */
  enabledChannels(): { slack: boolean; sendgrid: boolean } {
    return { slack: !!this.slackWebhookUrl, sendgrid: this.sendgrid.hasCredential() };
  }

  /** Best-effort fanout. Never throws — the whole body is guarded (FR-6/AC-4). */
  async dispatch(alert: FanoutAlert): Promise<void> {
    try {
      // Gate read live per call so a config change needs no restart (AC-3).
      const sevNum = alertSeverityToNumber(alert.severity as AlertSeverity);
      const minSev = clamp(this.config.getInt('fanout.min_severity', 2), 0, 4);
      if (sevNum < minSev) {
        recordDelivery('fanout', 'gated_severity');
        return;
      }

      const rawConviction = alert.context?.conviction;
      if (rawConviction !== undefined && rawConviction !== null) {
        const conviction = Number(rawConviction);
        if (Number.isFinite(conviction)) {
          // Only gate on conviction when it is present and numeric — never fail closed (AC-9).
          const minConf = this.config.getFloat('fanout.min_confidence_threshold', 0.7);
          if (conviction < minConf) {
            recordDelivery('fanout', 'gated_conviction');
            return;
          }
        }
      }

      // Dedup by content hash; sweep-then-check so the Map can't grow unbounded (AC-5).
      const key = this.dedupKey(alert);
      const windowMs = this.config.getInt('fanout.dedup_window_seconds', 300) * 1000;
      const cutoff = Date.now() - windowMs;
      for (const [k, ts] of this.dedup) {
        if (ts < cutoff) this.dedup.delete(k);
      }
      if (this.dedup.has(key)) {
        recordDelivery('fanout', 'deduped');
        return;
      }
      this.dedup.set(key, Date.now());

      // Payload: claim no field a producer did not set (FR-5).
      const ctx = alert.context ?? {};
      const payload: FanoutPayload = {
        source: alert.sourceService,
        severity: alert.severity,
        title: alert.title,
        body: alert.body,
        timestamp: new Date(alert.createdAt).toISOString(),
      };
      if (typeof ctx.symbol === 'string' && ctx.symbol) payload.symbol = ctx.symbol;
      if (rawConviction !== undefined && rawConviction !== null && Number.isFinite(Number(rawConviction))) {
        payload.conviction = Number(rawConviction);
      }

      // Send per enabled channel, each isolated (AC-6).
      if (this.slackWebhookUrl) await this.sendSlack(payload, alert.alertId);
      if (this.sendgrid.enabled()) await this.sendgrid.send(renderEmail(payload), alert.alertId);
    } catch (e: any) {
      recordDelivery('fanout', 'dispatch_error');
      log.warn('fanout dispatch error', { alertId: alert.alertId, error: e?.message ?? String(e) });
    }
  }

  private dedupKey(alert: FanoutAlert): string {
    const ctx = alert.context ?? {};
    const parts = [alert.category, alert.sourceService, alert.title, alert.body];
    for (const k of ['symbol', 'trigger_type', 'strategy_id'] as const) {
      if (ctx[k] !== undefined && ctx[k] !== null) parts.push(`${k}=${String(ctx[k])}`);
    }
    return createHash('sha256').update(parts.join('|')).digest('hex');
  }

  private async sendSlack(payload: FanoutPayload, alertId: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FANOUT_HTTP_TIMEOUT_MS);
    try {
      const summary =
        `[${payload.severity}] ${payload.title}` +
        (payload.symbol ? ` (${payload.symbol})` : '') +
        `\n${payload.body}` +
        (payload.conviction !== undefined ? `\nconviction: ${payload.conviction}` : '') +
        `\nsource: ${payload.source} · ${payload.timestamp}`;
      const res = await fetch(this.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: summary }),
        signal: controller.signal,
      });
      if (!res.ok) {
        recordDelivery('slack', 'http_error');
        log.warn('fanout channel error', { alertId, channel: 'slack', error: `HTTP ${res.status}` });
      } else {
        recordDelivery('slack', 'sent');
      }
    } catch (error: any) {
      recordDelivery('slack', error?.name === 'AbortError' ? 'timeout' : 'error');
      log.warn('fanout channel error', { alertId, channel: 'slack', error: error?.message ?? String(error) });
    } finally {
      clearTimeout(timer);
    }
  }
}
