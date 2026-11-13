/**
 * Outbound webhook delivery worker: drains notify.webhook_deliveries with at-least-once delivery.
 */
import type { Pool } from 'pg';
import { AlertSeverity } from '@xstockstrat/proto/notify/v1/notify';
import { getLogger } from '../services/logger';
import { recordDelivery, type DeliveryOutcome } from '../telemetry';
import { checkCallbackUrlAgainstConfig } from './webhookUrlRule';

const log = getLogger('notify:webhook');

const TICK_MS = 5000;
const MAX_IN_FLIGHT = 4;
const RETRYABLE_STATUSES = new Set([408, 429]);

export interface WebhookDeadLetterAlert {
  severity: AlertSeverity;
  category: string;
  title: string;
  body: string;
  sourceService: string;
}

interface WorkerConfig {
  getInt(key: string, def?: number): number;
  getString(key: string, def?: string): string;
}

interface DeliveryRow {
  delivery_id: string;
  idempotency_key: string;
  callback_url: string;
  event_name: string;
  payload: unknown;
  source_service: string;
  attempts: number;
  created_at: Date;
}

export function backoffDelaySeconds(attemptNumber: number, base: number, max: number): number {
  return Math.min(base * 2 ** (attemptNumber - 1), max);
}

// Display only, for a row the URL rule no longer passes: host and port, never path or query.
function displayOrigin(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.hostname}:${url.port || '443'}`;
  } catch {
    return 'unparseable origin';
  }
}

export function networkErrorClass(error: any): string {
  const code = error?.cause?.code ?? error?.code;
  return `network: ${typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : 'error'}`;
}

export class WebhookWorker {
  // The claim: a delivery id in this map is owned by a running attempt. Valid for one instance only.
  private readonly inFlight = new Map<string, AbortController>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private stopped = false;

  constructor(
    // Single-statement queries only: the pool has one connection, and it must never be held
    // across an HTTP request (no checked-out client, no transaction).
    private readonly pool: Pick<Pool, 'query'>,
    private readonly config: WorkerConfig,
    private readonly emitAlert: (alert: WebhookDeadLetterAlert) => Promise<unknown>,
  ) {}

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  /** In-flight requests are aborted and their rows stay pending for the next start. */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const controller of this.inFlight.values()) controller.abort();
  }

  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const free = MAX_IN_FLIGHT - this.inFlight.size;
      if (free <= 0) return;
      const { rows } = await this.pool.query<DeliveryRow>(
        `SELECT delivery_id, idempotency_key, callback_url, event_name, payload, source_service,
                attempts, created_at
           FROM notify.webhook_deliveries
          WHERE state = 'pending' AND next_attempt_at <= NOW()
            AND NOT (delivery_id = ANY($1::uuid[]))
          ORDER BY next_attempt_at
          LIMIT $2`,
        [[...this.inFlight.keys()], free],
      );
      for (const row of rows) {
        if (this.stopped || this.inFlight.has(row.delivery_id)) continue;
        const controller = new AbortController();
        this.inFlight.set(row.delivery_id, controller);
        // Un-awaited: an escaped rejection here would crash the process.
        void this.attempt(row, controller)
          .catch((err: any) => log.error('webhook attempt failed', { error: err?.message ?? String(err) }))
          .finally(() => this.inFlight.delete(row.delivery_id));
      }
    } catch (err: any) {
      log.error('webhook tick failed', { error: err?.message ?? String(err) });
    } finally {
      this.ticking = false;
    }
  }

  private maxAttempts(): number {
    const v = this.config.getInt('webhook.max_attempts', 8);
    return v > 0 ? v : 8;
  }

  private backoffBaseSeconds(): number {
    const v = this.config.getInt('webhook.backoff_base_seconds', 30);
    return v > 0 ? v : 30;
  }

  private backoffMaxSeconds(): number {
    const v = this.config.getInt('webhook.backoff_max_seconds', 3600);
    return v > 0 ? v : 3600;
  }

  private requestTimeoutMs(): number {
    const v = this.config.getInt('webhook.request_timeout_seconds', 10);
    return Math.min(60, Math.max(1, v > 0 ? v : 10)) * 1000;
  }

  private async attempt(row: DeliveryRow, controller: AbortController): Promise<void> {
    try {
      await this.deliver(row, controller);
    } catch (err: any) {
      if (this.stopped) return;
      log.error('webhook attempt failed', {
        idempotencyKey: row.idempotency_key,
        error: err?.message ?? String(err),
      });
      await this.retry(row, 'internal error', 'error', displayOrigin(row.callback_url)).catch(
        (e: any) =>
          log.error('webhook retry could not be recorded', {
            idempotencyKey: row.idempotency_key,
            error: e?.message ?? String(e),
          }),
      );
    }
  }

  private async deliver(row: DeliveryRow, controller: AbortController): Promise<void> {
    const verdict = checkCallbackUrlAgainstConfig(this.config, row.callback_url);
    if (verdict.ok === false) {
      await this.markDead(row, 0, `url rejected: ${verdict.reason}`, displayOrigin(row.callback_url));
      return;
    }
    const { href, origin } = verdict;

    // Owner-fixed wire format: exactly these keys.
    const body = JSON.stringify({
      event_name: row.event_name,
      payload: {
        source_service: row.source_service,
        environment: process.env.APPLICATION_ENV === 'production' ? 'production' : 'staging',
        occurred_at: new Date(row.created_at).toISOString(),
        data: row.payload,
      },
    });

    let status: number;
    let redirected: boolean;
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs());
    try {
      // redirect 'manual': a followed redirect would bypass the allowlist.
      const res = await fetch(href, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': row.idempotency_key },
        body,
        signal: controller.signal,
      });
      status = res.status;
      redirected = res.type === 'opaqueredirect';
      void res.body?.cancel().catch(() => {});
    } catch (error: any) {
      if (this.stopped) return;
      // The error text may quote the URL: only its class is kept.
      if (error?.name === 'AbortError') await this.retry(row, 'timeout', 'timeout', origin);
      else await this.retry(row, networkErrorClass(error), 'error', origin);
      return;
    } finally {
      clearTimeout(timer);
    }

    if (status >= 200 && status < 300) {
      await this.pool.query(
        `UPDATE notify.webhook_deliveries
            SET state = 'delivered', attempts = attempts + 1, last_error = NULL, updated_at = NOW()
          WHERE delivery_id = $1 AND state = 'pending'`,
        [row.delivery_id],
      );
      recordDelivery('webhook', 'sent');
    } else if (RETRYABLE_STATUSES.has(status) || (status >= 500 && status < 600)) {
      await this.retry(row, `http ${status}`, 'http_error', origin);
    } else if (redirected || status === 0 || (status >= 300 && status < 400)) {
      await this.markDead(row, 1, 'redirect not followed', origin);
    } else {
      await this.markDead(row, 1, `http ${status}`, origin);
    }
  }

  private async retry(
    row: DeliveryRow,
    lastError: string,
    outcome: DeliveryOutcome,
    origin: string,
  ): Promise<void> {
    recordDelivery('webhook', outcome);
    const attemptNumber = row.attempts + 1;
    if (attemptNumber >= this.maxAttempts()) {
      await this.markDead(row, 1, lastError, origin);
      return;
    }
    const secs = backoffDelaySeconds(attemptNumber, this.backoffBaseSeconds(), this.backoffMaxSeconds());
    await this.pool.query(
      `UPDATE notify.webhook_deliveries
          SET attempts = attempts + 1, next_attempt_at = NOW() + make_interval(secs => $2),
              last_error = $3, updated_at = NOW()
        WHERE delivery_id = $1 AND state = 'pending'`,
      [row.delivery_id, secs, lastError],
    );
  }

  private async markDead(
    row: DeliveryRow,
    addAttempts: 0 | 1,
    lastError: string,
    origin: string,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE notify.webhook_deliveries
          SET state = 'dead', attempts = attempts + $2, last_error = $3, updated_at = NOW()
        WHERE delivery_id = $1 AND state = 'pending'`,
      [row.delivery_id, addAttempts, lastError],
    );
    if (result.rowCount !== 1) return;

    const attempts = row.attempts + addAttempts;
    // Metric and ERROR log first: they are the record if the alert below cannot be stored.
    recordDelivery('webhook', 'dead');
    log.error('webhook delivery dead', {
      eventName: row.event_name,
      origin,
      idempotencyKey: row.idempotency_key,
      attempts,
      lastError,
    });
    try {
      await this.emitAlert({
        severity: AlertSeverity.ALERT_SEVERITY_WARNING,
        category: 'webhook',
        title: `Webhook delivery dead: ${row.event_name} → ${origin}`,
        body:
          `Delivery ${row.idempotency_key} was given up after ${attempts} ` +
          `${attempts === 1 ? 'attempt' : 'attempts'}. Last error: ${lastError}.`,
        sourceService: 'xstockstrat-notify',
      });
    } catch (err: any) {
      log.error('webhook dead-letter alert failed', {
        idempotencyKey: row.idempotency_key,
        error: err?.message ?? String(err),
      });
    }
  }
}
