/**
 * fanout/fanout.ts — best-effort external alert fanout (feature 020, notify-external-fanout).
 *
 * A side-channel bolted onto EmitAlert: qualifying alerts are POSTed to a Slack incoming webhook
 * and/or SendGrid v3 mail-send. It NEVER affects the primary in-process StreamAlerts delivery or the
 * EmitAlert RPC result — every failure is caught and logged at WARN. Credentials come from
 * `type: SECRET` env vars (SLACK_WEBHOOK_URL / SENDGRID_API_KEY); the five gate/dedup/email knobs are
 * live `notify.fanout.*` config keys read on every dispatch so a change takes effect with no restart.
 */
import { createHash } from 'node:crypto';
import { alertSeverityToNumber, AlertSeverity } from '@xstockstrat/proto/notify/v1/notify';
import { ConfigWatcher } from '../services/configWatcher';
import { getLogger } from '../services/logger';

const log = getLogger('notify:fanout');

// Fixed code constant, deliberately inside AC-1's 5 s and NOT a 6th config key (F-07).
const FANOUT_HTTP_TIMEOUT_MS = 3000;

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

interface FanoutPayload {
  symbol?: string;
  source: string;
  severity: string;
  conviction?: number;
  title: string;
  body: string;
  timestamp: string;
}

export class FanoutDispatcher {
  private readonly slackWebhookUrl: string;
  private readonly sendgridApiKey: string;
  private readonly dedup: Map<string, number> = new Map();

  constructor(private readonly config: ConfigWatcher) {
    this.slackWebhookUrl = process.env.SLACK_WEBHOOK_URL?.trim() || '';
    this.sendgridApiKey = process.env.SENDGRID_API_KEY?.trim() || '';
  }

  /** Best-effort fanout. Never throws — the whole body is guarded (FR-6/AC-4). */
  async dispatch(alert: FanoutAlert): Promise<void> {
    try {
      // ── Gate (read live on every call so a config change needs no restart, AC-3) ──────────────
      const sevNum = alertSeverityToNumber(alert.severity as AlertSeverity);
      const minSev = clamp(this.config.getInt('notify.fanout.min_severity', 2), 0, 4);
      if (sevNum < minSev) return;

      const rawConviction = alert.context?.conviction;
      if (rawConviction !== undefined && rawConviction !== null) {
        const conviction = Number(rawConviction);
        if (Number.isFinite(conviction)) {
          // Only gate on conviction when it is present and numeric — never fail closed (AC-9).
          const minConf = this.config.getFloat('notify.fanout.min_confidence_threshold', 0.7);
          if (conviction < minConf) return;
        }
      }

      // ── Dedup (content hash; sweep-then-check so the Map can't grow unbounded, AC-5) ───────────
      const key = this.dedupKey(alert);
      const windowMs = this.config.getInt('notify.fanout.dedup_window_seconds', 300) * 1000;
      const cutoff = Date.now() - windowMs;
      for (const [k, ts] of this.dedup) {
        if (ts < cutoff) this.dedup.delete(k);
      }
      if (this.dedup.has(key)) return;
      this.dedup.set(key, Date.now());

      // ── Payload (FR-5) — claim no field a producer did not set ────────────────────────────────
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

      // ── Send per enabled channel, each isolated (AC-6) ────────────────────────────────────────
      if (this.slackWebhookUrl) await this.sendSlack(payload, alert.alertId);
      const from = this.config.getString('notify.fanout.sendgrid_from_email');
      const to = this.config.getString('notify.fanout.sendgrid_to_email');
      if (this.sendgridApiKey && from && to) {
        await this.sendSendgrid(payload, from, to, alert.alertId);
      }
    } catch (e: any) {
      log.warn('fanout dispatch error', { alertId: alert.alertId, error: e?.message ?? String(e) });
    }
  }

  /** Content hash: category|source|title|body plus any signal-context keys present. */
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
        log.warn('fanout channel error', { alertId, channel: 'slack', error: `HTTP ${res.status}` });
      }
    } catch (error: any) {
      log.warn('fanout channel error', { alertId, channel: 'slack', error: error?.message ?? String(error) });
    } finally {
      clearTimeout(timer);
    }
  }

  private async sendSendgrid(
    payload: FanoutPayload,
    from: string,
    to: string,
    alertId: string,
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FANOUT_HTTP_TIMEOUT_MS);
    try {
      const lines = [
        `Symbol: ${payload.symbol ?? '(n/a)'}`,
        `Source: ${payload.source}`,
        `Severity: ${payload.severity}`,
        payload.conviction !== undefined ? `Conviction: ${payload.conviction}` : 'Conviction: (n/a)',
        `Timestamp: ${payload.timestamp}`,
        '',
        payload.title,
        payload.body,
      ];
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.sendgridApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: from },
          subject: `[${payload.severity}] ${payload.title}`,
          content: [{ type: 'text/plain', value: lines.join('\n') }],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        log.warn('fanout channel error', { alertId, channel: 'sendgrid', error: `HTTP ${res.status}` });
      }
    } catch (error: any) {
      log.warn('fanout channel error', { alertId, channel: 'sendgrid', error: error?.message ?? String(error) });
    } finally {
      clearTimeout(timer);
    }
  }
}
