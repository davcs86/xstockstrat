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
// Rows one alert sweep reads; a larger backlog is covered by the following ticks.
const SWEEP_BATCH = 100;
// A standing incident is alerted when it starts and again each time this much time has passed.
const INCIDENT_REPEAT_MS = 24 * 60 * 60 * 1000;

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

type RerouteReason = 'deliberate' | 'lost_config';

interface SweptRow {
  outbox_id: string;
  alert_id: string;
  state: 'undelivered' | 'rerouted';
  fallback: 'none' | 'sendgrid';
  reroute_reason: RerouteReason | null;
  attempts: number;
  last_error: string | null;
  fallback_sent_at: Date | null;
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
  // One alert per drain: set by the sweep, cleared when the route leaves that reroute.
  private readonly drainAlerted: Record<RerouteReason, boolean> = { deliberate: false, lost_config: false };
  // Standing incidents: when each was last alerted, or null while its condition does not hold.
  private pinnedAlertedAt: number | null = null;
  private stalledAlertedAt: number | null = null;

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
      // Alerts first: a row a stopped process left without one is covered before new work starts.
      await this.sweep();

      const mode = emailMode(this.config);
      const settings = commsgunSettings(this.config);
      const key = this.deps.secret.state();
      const route = workerRoute(mode, settings.baseSet, key.kind);
      if (route !== 'reroute_lost') this.drainAlerted.lost_config = false;
      if (route !== 'reroute_deliberate') this.drainAlerted.deliberate = false;
      await this.standingIncidents(mode, settings, key.kind);
      if (route === 'hold') return;

      const rows = await this.selectDue();
      if (route !== 'attempt') {
        const reason: RerouteReason = route === 'reroute_deliberate' ? 'deliberate' : 'lost_config';
        for (const row of rows) this.claim(row, () => this.endRerouted(row, reason));
        return;
      }
      if (rows.length > 0 && settings.appId) {
        // commsgun scopes idempotency per app: a changed app can duplicate an accepted send.
        if (this.lastAppId && this.lastAppId !== settings.appId) {
          log.warn('commsgun app id changed while emails are queued', { pending: rows.length });
        }
        this.lastAppId = settings.appId;
      }
      for (const row of rows) this.claim(row, (controller) => this.attempt(row, controller));
    } catch (err: any) {
      log.error('commsgun tick failed', { error: errorCode(err) });
    } finally {
      this.ticking = false;
    }
  }

  private claim(row: OutboxRow, work: (controller: AbortController) => Promise<void>): void {
    if (this.stopped || this.inFlight.has(row.outbox_id)) return;
    const controller = new AbortController();
    this.inFlight.set(row.outbox_id, controller);
    // Un-awaited: an escaped rejection here would crash the process.
    void work(controller)
      .catch((err: any) => log.error('commsgun attempt failed', { outboxId: row.outbox_id, error: errorCode(err) }))
      .finally(() => this.inFlight.delete(row.outbox_id));
  }

  // Raises the alerts that persisted rows still require. It never sends an email.
  private async sweep(): Promise<void> {
    const { rows } = await this.pool.query<SweptRow>(
      `SELECT outbox_id, alert_id, state, fallback, reroute_reason, attempts, last_error, fallback_sent_at
         FROM notify.email_outbox
        WHERE escalated_at IS NULL AND (state = 'undelivered' OR (state = 'rerouted' AND (reroute_reason = 'lost_config' OR fallback_sent_at IS NULL)))
          AND NOT (outbox_id = ANY($1::uuid[]))
        ORDER BY outbox_id
        LIMIT $2`,
      [[...this.inFlight.keys()], SWEEP_BATCH],
    );
    for (const row of rows.filter((r) => r.state === 'undelivered')) {
      try {
        await this.emitAlert(undeliveredAlert(row, row.attempts, row.last_error ?? 'unknown', row.fallback));
        await this.stampEscalated(row.outbox_id);
      } catch (err: any) {
        log.error('commsgun escalation alert failed', {
          alertId: row.alert_id,
          outboxId: row.outbox_id,
          error: errorCode(err),
        });
      }
    }
    for (const reason of ['deliberate', 'lost_config'] as const) {
      const group = rows.filter((r) => r.state === 'rerouted' && r.reroute_reason === reason);
      if (group.length === 0) continue;
      try {
        if (!this.drainAlerted[reason]) {
          await this.emitAlert(drainAlert(reason, group, await this.pendingCount()));
          this.drainAlerted[reason] = true;
        }
        // Rows of a drain already alerted are covered by that alert.
        await this.pool.query(
          `UPDATE notify.email_outbox SET escalated_at = NOW(), updated_at = NOW()
            WHERE outbox_id = ANY($1::uuid[]) AND escalated_at IS NULL`,
          [group.map((r) => r.outbox_id)],
        );
      } catch (err: any) {
        log.error('commsgun reroute alert failed', { reason, rows: group.length, error: errorCode(err) });
      }
    }
  }

  private async pendingCount(): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM notify.email_outbox WHERE state = 'pending'`,
    );
    return rows[0]?.n ?? 0;
  }

  private async stampEscalated(outboxId: string): Promise<void> {
    await this.pool.query(
      `UPDATE notify.email_outbox SET escalated_at = NOW(), updated_at = NOW()
        WHERE outbox_id = $1 AND escalated_at IS NULL`,
      [outboxId],
    );
  }

  private async standingIncidents(
    mode: ReturnType<typeof emailMode>,
    settings: ReturnType<typeof commsgunSettings>,
    keyKind: 'key' | 'absent' | 'unknown',
  ): Promise<void> {
    // Pinned to commsgun while it cannot be addressed: nothing is queued, so nothing else would alert.
    if (mode === 'commsgun' && !settings.baseSet) {
      this.pinnedAlertedAt = await this.raiseStanding(this.pinnedAlertedAt, () => pinnedAlert(settings));
    } else {
      this.pinnedAlertedAt = null;
    }
    // auto quietly uses SendGrid while the key is missing or cannot be read: say so once commsgun is set up.
    const failures = this.deps.secret.failures();
    const cause = keyKind === 'absent' ? 'absent' : keyKind === 'unknown' && failures.count >= 2 ? failures.statusClass : null;
    if (mode === 'auto' && settings.baseSet && cause !== null) {
      this.stalledAlertedAt = await this.raiseStanding(this.stalledAlertedAt, () => stalledKeyAlert(cause));
    } else {
      this.stalledAlertedAt = null;
    }
  }

  // Returns when the incident was last alerted; a failed alert leaves that unchanged, so the next tick retries.
  private async raiseStanding(alertedAt: number | null, build: () => CommsgunAlert): Promise<number | null> {
    const now = Date.now();
    if (alertedAt !== null && now - alertedAt < INCIDENT_REPEAT_MS) return alertedAt;
    try {
      await this.emitAlert(build());
      return now;
    } catch (err: any) {
      log.error('commsgun incident alert failed', { error: errorCode(err) });
      return alertedAt;
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
    // Pinned to sendgrid by now: the row is rerouted like any other pending row, not a commsgun failure.
    if (emailMode(this.config) === 'sendgrid') return this.endRerouted(row, 'deliberate');
    return this.track(this.runUndelivered(row, addAttempts, errorClass));
  }

  private endRerouted(row: OutboxRow, reason: RerouteReason): Promise<void> {
    return this.track(this.runRerouted(row, reason));
  }

  private track(step: Promise<void>): Promise<void> {
    this.terminalSteps.add(step);
    const done = () => this.terminalSteps.delete(step);
    step.then(done, done);
    return step;
  }

  // No commsgun request and no alert here: the sweep alerts from what this leaves in the table.
  private async runRerouted(row: OutboxRow, reason: RerouteReason): Promise<void> {
    const fallback = this.deps.sendgrid.enabled() ? 'sendgrid' : 'none';
    const result = await this.pool.query(
      `UPDATE notify.email_outbox
          SET state = 'rerouted', reroute_reason = $2, fallback = $3, last_error = NULL,
              recipient = NULL, subject = NULL, text_body = NULL, updated_at = NOW()
        WHERE outbox_id = $1 AND state = 'pending'`,
      [row.outbox_id, reason, fallback],
    );
    if (result.rowCount !== 1) return;
    recordDelivery('commsgun', 'rerouted');
    log.warn('commsgun email rerouted', { alertId: row.alert_id, outboxId: row.outbox_id, reason, fallback });
    if (fallback === 'sendgrid') await this.sendFallback(row);
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
      await this.stampEscalated(row.outbox_id);
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
function undeliveredAlert(
  row: Pick<OutboxRow, 'alert_id' | 'outbox_id'>,
  attempts: number,
  errorClass: string,
  fallback: string,
): CommsgunAlert {
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

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function drainAlert(reason: RerouteReason, rows: SweptRow[], pending: number): CommsgunAlert {
  const viaSendgrid = rows.filter((r) => r.fallback === 'sendgrid').length;
  const unconfirmed = rows.filter((r) => r.fallback === 'sendgrid' && !r.fallback_sent_at).length;
  const dropped = rows.filter((r) => r.fallback === 'none').length;
  const tail = `${plural(pending, 'email is', 'emails are')} still pending in the outbox.`;
  if (reason === 'lost_config') {
    return {
      severity: AlertSeverity.ALERT_SEVERITY_WARNING,
      category: ALERT_CATEGORY,
      title: 'Commsgun is no longer ready: queued emails were rerouted',
      body:
        `${plural(rows.length, 'queued email was', 'queued emails were')} rerouted because commsgun is not ready ` +
        `in auto mode: ${viaSendgrid} handed to SendGrid (${unconfirmed} not confirmed), ` +
        `${dropped} dropped because SendGrid is not enabled. ${tail}`,
      sourceService: ALERT_SOURCE,
    };
  }
  return {
    severity: AlertSeverity.ALERT_SEVERITY_WARNING,
    category: ALERT_CATEGORY,
    title: 'Queued emails were not sent after the switch to sendgrid',
    body:
      `After the email provider was set to sendgrid, ${plural(dropped, 'pending email was', 'pending emails were')} ` +
      `dropped because SendGrid is not enabled, and ${plural(unconfirmed, 'SendGrid send was', 'SendGrid sends were')} ` +
      `not confirmed. ${tail}`,
    sourceService: ALERT_SOURCE,
  };
}

// Key names only: an operator fixes the incident in config-ui by these names.
function pinnedAlert(settings: { url: string; appId: string; to: string }): CommsgunAlert {
  const missing = [
    settings.url ? '' : 'commsgun.enqueue_url',
    settings.appId ? '' : 'commsgun.app_id',
    settings.to ? '' : 'commsgun.to_email',
  ].filter(Boolean);
  return {
    severity: AlertSeverity.ALERT_SEVERITY_WARNING,
    category: ALERT_CATEGORY,
    title: 'Alert email is pinned to commsgun, which is not configured',
    body:
      `notify.fanout.email_provider is commsgun, but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} ` +
      'empty. No alert email is being sent or queued. Set the missing keys, or change the provider.',
    sourceService: ALERT_SOURCE,
  };
}

function stalledKeyAlert(cause: string): CommsgunAlert {
  const why =
    cause === 'absent'
      ? 'notify.commsgun.app_key is not set (cause: absent)'
      : `notify.commsgun.app_key could not be read from the config service (cause: ${cause})`;
  return {
    severity: AlertSeverity.ALERT_SEVERITY_WARNING,
    category: ALERT_CATEGORY,
    title: 'Commsgun is set up but its app key is not available',
    body: `${why}. In auto mode alert email goes through SendGrid until the key is available.`,
    sourceService: ALERT_SOURCE,
  };
}
