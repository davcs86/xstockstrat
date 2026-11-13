import type { Pool } from 'pg';
import { AlertSeverity } from '@xstockstrat/proto/notify/v1/notify';
import type { CommsgunSecret } from '../services/commsgunSecret';
import { getLogger } from '../services/logger';
import { recordDelivery, type DeliveryOutcome } from '../telemetry';
import { commsgunBody, type CommsgunClient } from './commsgunClient';
import { commsgunSettings, emailMode, workerRoute } from './emailProvider';
import type { RenderedEmail } from './emailRender';
import type { SendgridSender } from './sendgridSender';
import { backoffDelaySeconds } from './webhookWorker';

const log = getLogger('notify:commsgun-worker');

// Fixed mechanism constants (F-07), the same values as the webhook worker's.
const TICK_MS = 5000;
const MAX_IN_FLIGHT = 4;

const ALERT_CATEGORY = 'commsgun';
const ALERT_SOURCE = 'xstockstrat-notify';

export interface CommsgunAlert {
  severity: AlertSeverity;
  category: string;
  title: string;
  body: string;
  sourceService: string;
}

export interface CommsgunWorkerDeps {
  secret: Pick<CommsgunSecret, 'state' | 'failures'>;
  client: Pick<CommsgunClient, 'send'>;
  sendgrid: Pick<SendgridSender, 'enabled' | 'send'>;
}

interface WorkerConfig {
  getInt(key: string, def?: number): number;
  getString(key: string, def?: string): string;
}

export interface OutboxEmail extends RenderedEmail {
  alertId: string;
  recipient: string;
}

interface OutboxRow {
  outbox_id: string;
  alert_id: string;
  recipient: string;
  subject: string;
  text_body: string;
  attempts: number;
}

// A pg error message can quote row values: only its SQLSTATE (or a fixed word) is ever logged.
function errorCode(err: any): string {
  return typeof err?.code === 'string' && /^[A-Z0-9]{1,10}$/.test(err.code) ? err.code : 'error';
}

export class CommsgunWorker {
  // The claim: an outbox id in this map is owned by a running attempt. Valid for one instance only.
  private readonly inFlight = new Map<string, AbortController>();
  private readonly terminalSteps = new Set<Promise<void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private stopped = false;
  private lastAppId = '';

  constructor(
    // Single-statement queries only: the pool has one connection, and it must never be held
    // across an HTTP request (no checked-out client, no transaction).
    private readonly pool: Pick<Pool, 'query'>,
    private readonly config: WorkerConfig,
    private readonly deps: CommsgunWorkerDeps,
    private readonly emitAlert: (alert: CommsgunAlert) => Promise<unknown>,
  ) {}

  /** One row per alert; a repeat is a no-op. Rejects when the insert fails. */
  async enqueue(email: OutboxEmail): Promise<void> {
    await this.pool.query(
      `INSERT INTO notify.email_outbox (alert_id, recipient, subject, text_body)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (alert_id) DO NOTHING`,
      [email.alertId, email.recipient, email.subject, email.text],
    );
    const { appId } = commsgunSettings(this.config);
    if (appId) this.lastAppId = appId;
  }

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  /** Aborts in-flight POSTs (their rows stay pending) and waits for terminal steps under way. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const controller of this.inFlight.values()) controller.abort();
    await Promise.allSettled([...this.terminalSteps]);
  }

  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const settings = commsgunSettings(this.config);
      const route = workerRoute(emailMode(this.config), settings.baseSet, this.deps.secret.state().kind);
      if (route !== 'attempt') return;

      const rows = await this.selectDue();
      if (rows.length > 0 && settings.appId) {
        // commsgun scopes idempotency per app: a changed app can duplicate an accepted send.
        if (this.lastAppId && this.lastAppId !== settings.appId) {
          log.warn('commsgun app id changed while emails are queued', { pending: rows.length });
        }
        this.lastAppId = settings.appId;
      }
      for (const row of rows) {
        if (this.stopped || this.inFlight.has(row.outbox_id)) continue;
        const controller = new AbortController();
        this.inFlight.set(row.outbox_id, controller);
        // Un-awaited: an escaped rejection here would crash the process.
        void this.attempt(row, controller)
          .catch((err: any) => log.error('commsgun attempt failed', { outboxId: row.outbox_id, error: errorCode(err) }))
          .finally(() => this.inFlight.delete(row.outbox_id));
      }
    } catch (err: any) {
      log.error('commsgun tick failed', { error: errorCode(err) });
    } finally {
      this.ticking = false;
    }
  }

  private async selectDue(): Promise<OutboxRow[]> {
    const free = MAX_IN_FLIGHT - this.inFlight.size;
    if (free <= 0) return [];
    const { rows } = await this.pool.query<OutboxRow>(
      `SELECT outbox_id, alert_id, recipient, subject, text_body, attempts
         FROM notify.email_outbox
        WHERE state = 'pending' AND next_attempt_at <= NOW()
          AND NOT (outbox_id = ANY($1::uuid[]))
        ORDER BY next_attempt_at
        LIMIT $2`,
      [[...this.inFlight.keys()], free],
    );
    return rows;
  }

  private maxAttempts(): number {
    const v = this.config.getInt('commsgun.max_attempts', 8);
    return v > 0 ? v : 8;
  }

  private backoffBaseSeconds(): number {
    const v = this.config.getInt('commsgun.backoff_base_seconds', 30);
    return v > 0 ? v : 30;
  }

  private backoffMaxSeconds(): number {
    const v = this.config.getInt('commsgun.backoff_max_seconds', 3600);
    return v > 0 ? v : 3600;
  }

  private async attempt(row: OutboxRow, controller: AbortController): Promise<void> {
    try {
      await this.deliver(row, controller);
    } catch (err: any) {
      if (this.stopped) return;
      log.error('commsgun attempt failed', { alertId: row.alert_id, outboxId: row.outbox_id, error: errorCode(err) });
      await this.retry(row, 'internal', 'error', null).catch((e: any) =>
        log.error('commsgun retry could not be recorded', {
          alertId: row.alert_id,
          outboxId: row.outbox_id,
          error: errorCode(e),
        }),
      );
    }
  }

  private async deliver(row: OutboxRow, controller: AbortController): Promise<void> {
    // Read live per attempt: a rotated key or a corrected app id reaches rows already queued.
    const settings = commsgunSettings(this.config);
    const key = this.deps.secret.state();
    if (!settings.url || !settings.appId) return this.retry(row, 'no_endpoint', 'no_endpoint', null);
    if (key.kind === 'absent') return this.retry(row, 'no_app_key', 'no_app_key', null);
    if (key.kind === 'unknown') return this.retry(row, 'secret_unresolved', 'secret_unresolved', null);

    const result = await this.deps.client.send(
      {
        url: settings.url,
        appId: settings.appId,
        key: key.value,
        alertId: row.alert_id,
        body: commsgunBody({ recipient: row.recipient, subject: row.subject, text: row.text_body }),
      },
      controller,
    );
    // Stopped mid-request: the row stays pending and the attempt is not counted.
    if (this.stopped) return;

    if (result.kind === 'delivered') {
      await this.pool.query(
        `UPDATE notify.email_outbox
            SET state = 'delivered', attempts = attempts + 1, last_error = NULL,
                recipient = NULL, subject = NULL, text_body = NULL, updated_at = NOW()
          WHERE outbox_id = $1 AND state = 'pending'`,
        [row.outbox_id],
      );
      recordDelivery('commsgun', 'sent');
    } else if (result.kind === 'retry') {
      await this.retry(row, result.errorClass, result.outcome, result.retryAfterSeconds);
    } else {
      recordDelivery('commsgun', 'http_error');
      await this.endUndelivered(row, 1, result.errorClass);
    }
  }

  private async retry(
    row: OutboxRow,
    errorClass: string,
    outcome: DeliveryOutcome,
    retryAfterSeconds: number | null,
  ): Promise<void> {
    recordDelivery('commsgun', outcome);
    const attemptNumber = row.attempts + 1;
    if (attemptNumber >= this.maxAttempts()) {
      await this.endUndelivered(row, 1, errorClass);
      return;
    }
    const max = this.backoffMaxSeconds();
    const backoff = backoffDelaySeconds(attemptNumber, this.backoffBaseSeconds(), max);
    const secs = Math.min(Math.max(backoff, retryAfterSeconds ?? 0), max);
    await this.pool.query(
      `UPDATE notify.email_outbox
          SET attempts = attempts + 1, next_attempt_at = NOW() + make_interval(secs => $2),
              last_error = $3, updated_at = NOW()
        WHERE outbox_id = $1 AND state = 'pending'`,
      [row.outbox_id, secs, errorClass],
    );
  }

  // Tracked so stop() can wait: a terminal step must not be cut between its UPDATE and its sends.
  private endUndelivered(row: OutboxRow, addAttempts: 0 | 1, errorClass: string): Promise<void> {
    const step = this.runUndelivered(row, addAttempts, errorClass);
    this.terminalSteps.add(step);
    const done = () => this.terminalSteps.delete(step);
    step.then(done, done);
    return step;
  }

  private async runUndelivered(row: OutboxRow, addAttempts: 0 | 1, errorClass: string): Promise<void> {
    // The mode at this moment decides the fallback; SendGrid is never a fallback of a pinned mode.
    const fallback = emailMode(this.config) === 'auto' && this.deps.sendgrid.enabled() ? 'sendgrid' : 'none';
    // The one statement that decides the outcome: side effects below run only for the row it changed.
    const result = await this.pool.query(
      `UPDATE notify.email_outbox
          SET state = 'undelivered', fallback = $2, attempts = attempts + $3, last_error = $4,
              recipient = NULL, subject = NULL, text_body = NULL, updated_at = NOW()
        WHERE outbox_id = $1 AND state = 'pending'`,
      [row.outbox_id, fallback, addAttempts, errorClass],
    );
    if (result.rowCount !== 1) return;

    const attempts = row.attempts + addAttempts;
    // Metric and WARN first: they are the record if the alert below cannot be stored.
    recordDelivery('commsgun', 'dead');
    log.warn('commsgun delivery undelivered', {
      alertId: row.alert_id,
      outboxId: row.outbox_id,
      attempts,
      errorClass,
    });

    // Alert before any fallback send; a row left unstamped is re-raised by the sweep.
    try {
      await this.emitAlert(undeliveredAlert(row, attempts, errorClass, fallback));
      await this.pool.query(
        `UPDATE notify.email_outbox SET escalated_at = NOW(), updated_at = NOW()
          WHERE outbox_id = $1 AND escalated_at IS NULL`,
        [row.outbox_id],
      );
    } catch (err: any) {
      log.error('commsgun escalation alert failed', {
        alertId: row.alert_id,
        outboxId: row.outbox_id,
        error: errorCode(err),
      });
    }

    if (fallback === 'sendgrid') await this.sendFallback(row);
  }

  // At most once: the row is already terminal, so a failure here is never retried.
  private async sendFallback(row: OutboxRow): Promise<void> {
    try {
      const sent = await this.deps.sendgrid.send({ subject: row.subject, text: row.text_body }, row.alert_id);
      if (!sent) return;
      await this.pool.query(
        `UPDATE notify.email_outbox SET fallback_sent_at = NOW(), updated_at = NOW()
          WHERE outbox_id = $1 AND fallback = 'sendgrid' AND fallback_sent_at IS NULL`,
        [row.outbox_id],
      );
    } catch (err: any) {
      log.error('commsgun fallback could not be recorded', {
        alertId: row.alert_id,
        outboxId: row.outbox_id,
        error: errorCode(err),
      });
    }
  }
}

// Ids, counts and classes only: never a recipient, subject, body, URL, app id or key.
function undeliveredAlert(row: OutboxRow, attempts: number, errorClass: string, fallback: string): CommsgunAlert {
  return {
    severity: AlertSeverity.ALERT_SEVERITY_WARNING,
    category: ALERT_CATEGORY,
    title: `Email undelivered via commsgun: alert ${row.alert_id}`,
    body:
      `The email for alert ${row.alert_id} was given up after ${attempts} ` +
      `${attempts === 1 ? 'attempt' : 'attempts'} (last error: ${errorClass}). ` +
      `Fallback: ${fallback}. Outbox row ${row.outbox_id}.`,
    sourceService: ALERT_SOURCE,
  };
}
