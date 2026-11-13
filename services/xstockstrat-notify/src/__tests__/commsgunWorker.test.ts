// CommsgunWorker tests (feature 338). The pool is a scripted fake and the client, sender and secret
// are fakes: no network, no database. The logger is replaced before the modules under test load.
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as grpc from '@grpc/grpc-js';
import configProto = require('@xstockstrat/proto/config/v1/config');
import mtlsModule = require('../mtls');
import loggerModule = require('../services/logger');
import type { CommsgunSendResult } from '../fanout/commsgunClient';
import type { CommsgunKeyState } from '../services/commsgunSecret';
import { counterValue, install } from './fixtures/collectingReader';
import { fakeConfig } from './fixtures/fakeConfig';
import { alertRecorder, scriptedPool, settle, type PoolOpts } from './fixtures/scriptedPool';

type WorkerModule = typeof import('../fanout/commsgunWorker');
type WatcherModule = typeof import('../services/configWatcher');

const ENQUEUE_URL = 'https://comms.ts.example.net/v1/messages';
const APP_ID = 'xstockstrat-staging';
const RECIPIENT = 'ops@example.com';
const KEY = 'k-0123456789abcdef0123456789abcdef';
const TITLE = 'AAPL breakout';
const SUBJECT = `[ALERT_SEVERITY_WARNING] ${TITLE}`;
const TEXT = `Symbol: AAPL\nSource: analysis\n\n${TITLE}\nprice crossed the 50-day average`;
const ALERT_ID = '7b0c1a52-4d1e-4b7a-9c53-0f6a3f1d2e90';
const OUTBOX = { idColumn: 'outbox_id', table: 'notify.email_outbox' } as const;

interface LogRecord {
  level: string;
  msg: string;
  meta: unknown;
}
const records: LogRecord[] = [];
const capture = (level: string) => (msg: unknown, meta?: unknown) => {
  records.push({ level, msg: String(msg), meta });
};
const fakeLog = { debug: capture('debug'), info: capture('info'), warn: capture('warn'), error: capture('error') };

class FakeStream extends EventEmitter {
  cancel(): void {}
}
const streams: FakeStream[] = [];
class FakeConfigServiceClient {
  watchConfig(): FakeStream {
    const stream = new FakeStream();
    streams.push(stream);
    return stream;
  }
  close(): void {}
}

let CommsgunWorker: WorkerModule['CommsgunWorker'];
let ConfigWatcher: WatcherModule['ConfigWatcher'];

before(async () => {
  Object.assign(configProto, { ConfigServiceClient: FakeConfigServiceClient });
  Object.assign(mtlsModule, { clientCredentials: () => grpc.credentials.createInsecure() });
  Object.assign(loggerModule, { getLogger: () => fakeLog });
  ({ CommsgunWorker } = await import('../fanout/commsgunWorker'));
  ({ ConfigWatcher } = await import('../services/configWatcher'));
});

const stopFns: Array<() => unknown> = [];

afterEach(async () => {
  for (const stop of stopFns.splice(0)) await stop();
  mock.timers.reset();
  records.length = 0;
});

// ── Fakes ─────────────────────────────────────────────────────────────────────

/** A live config: the returned `str` / `int` maps can be changed between ticks. */
function liveConfig(mode = 'auto', int: Record<string, number> = {}, str: Record<string, string> = {}) {
  const strings: Record<string, string> = {
    'fanout.email_provider': mode,
    'commsgun.enqueue_url': ENQUEUE_URL,
    'commsgun.app_id': APP_ID,
    'commsgun.to_email': RECIPIENT,
    ...str,
  };
  const ints = { ...int };
  return { config: fakeConfig({ int: ints, str: strings }), str: strings, int: ints };
}

function fakeSecret(initial: CommsgunKeyState = { kind: 'key', value: KEY }) {
  const box = { state: initial, failures: { count: 0, statusClass: '' } };
  return { box, state: () => box.state, failures: () => box.failures };
}

const DELIVERED: CommsgunSendResult = { kind: 'delivered' };
function retry(errorClass: string, outcome: 'http_error' | 'timeout' | 'error' = 'http_error', retryAfterSeconds: number | null = null): CommsgunSendResult {
  return { kind: 'retry', errorClass, outcome, retryAfterSeconds };
}
function permanent(errorClass: string): CommsgunSendResult {
  return { kind: 'permanent', errorClass };
}

/** Replays `script` in order (the last entry repeats); 'hang' stays open until its controller aborts. */
function fakeClient(script: Array<CommsgunSendResult | 'hang'> = [DELIVERED]) {
  const calls: Array<{ request: any; controller: AbortController }> = [];
  return {
    calls,
    send(request: any, controller: AbortController): Promise<CommsgunSendResult> {
      const step = script[Math.min(calls.length, script.length - 1)];
      calls.push({ request, controller });
      if (step !== 'hang') return Promise.resolve(step);
      return new Promise((resolve) => {
        controller.signal.addEventListener('abort', () => resolve(retry('timeout', 'timeout')));
      });
    },
  };
}

function fakeSender(opts: { enabled?: boolean; result?: boolean; events?: string[] } = {}) {
  const box = { enabled: opts.enabled ?? true, result: opts.result ?? true };
  const calls: Array<{ email: any; alertId: string }> = [];
  let release: (() => void) | null = null;
  const sender = {
    box,
    calls,
    /** Makes the next send wait until the returned function is called. */
    holdNext(): () => void {
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      release = () => open();
      pending = gate;
      return () => release?.();
    },
    enabled: () => box.enabled,
    async send(email: any, alertId: string): Promise<boolean> {
      calls.push({ email, alertId });
      opts.events?.push('sendgrid');
      const wait = pending;
      pending = null;
      if (wait) await wait;
      return box.result;
    },
  };
  let pending: Promise<void> | null = null;
  return sender;
}

function row(over: Record<string, unknown> = {}): any {
  return {
    outbox_id: 'o-1',
    alert_id: ALERT_ID,
    recipient: RECIPIENT,
    subject: SUBJECT,
    text_body: TEXT,
    attempts: 0,
    ...over,
  };
}

interface Rig {
  rows?: any[];
  mode?: string;
  int?: Record<string, number>;
  str?: Record<string, string>;
  secret?: CommsgunKeyState;
  script?: Array<CommsgunSendResult | 'hang'>;
  sender?: { enabled?: boolean; result?: boolean };
  pool?: PoolOpts;
  failAlert?: boolean;
  /** Rows the alert sweep finds, and the pending count its reroute alert reports. */
  sweep?: any[];
  pendingCount?: number;
}

function rig(r: Rig = {}) {
  const events: string[] = [];
  const live = liveConfig(r.mode ?? 'auto', r.int, r.str);
  const secret = fakeSecret(r.secret);
  const client = fakeClient(r.script);
  const sender = fakeSender({ ...r.sender, events });
  const pool = scriptedPool(r.rows ?? [row()], {
    ...OUTBOX,
    dueMatch: /next_attempt_at <= NOW\(\)/,
    selects: [
      { match: /escalated_at IS NULL/, rows: r.sweep ?? [] },
      { match: /COUNT\(\*\)/, rows: [{ n: r.pendingCount ?? 0 }] },
    ],
    onQuery: (sql) => {
      if (/SET escalated_at/.test(sql)) events.push('stamp:escalated');
      if (/SET fallback_sent_at/.test(sql)) events.push('stamp:fallback_sent');
      if (/SET state = 'undelivered'/.test(sql)) events.push('update:undelivered');
    },
    ...r.pool,
  });
  const emit = alertRecorder(r.failAlert);
  const emitAlert = async (alert: any) => {
    events.push('alert');
    return emit.fn(alert);
  };
  const worker = new CommsgunWorker(pool.obj as any, live.config, { secret, client, sendgrid: sender }, emitAlert);
  stopFns.push(() => worker.stop());
  const terminal = () => pool.matching(/SET state = 'undelivered'/);
  const escalated = () => pool.matching(/SET escalated_at = NOW\(\)/);
  const fallbackSent = () => pool.matching(/SET fallback_sent_at = NOW\(\)/);
  const dueSelects = () => pool.matching(/next_attempt_at <= NOW\(\)/);
  const rerouted = () => pool.matching(/SET state = 'rerouted'/);
  const bulkStamps = () => pool.matching(/SET escalated_at = NOW\(\).*ANY\(\$1/);
  return {
    worker, pool, live, secret, client, sender, alerts: emit.alerts, events,
    terminal, escalated, fallbackSent, dueSelects, rerouted, bulkStamps,
  };
}

async function tick(worker: { tick(): Promise<void> }): Promise<void> {
  await worker.tick();
  await settle();
}

function warns(): LogRecord[] {
  return records.filter((r) => r.level === 'warn');
}

describe('commsgun worker harness', () => {
  it('imports the modules under test', () => {
    assert.equal(typeof CommsgunWorker, 'function');
    assert.equal(typeof ConfigWatcher, 'function');
  });
});

describe('enqueue', () => {
  it('@AC-4 inserts one row per alert, insert-if-absent, with the rendered content', async () => {
    const t = rig({ rows: [] });
    await t.worker.enqueue({ alertId: ALERT_ID, recipient: RECIPIENT, subject: SUBJECT, text: TEXT });
    const inserts = t.pool.matching(/^INSERT INTO notify\.email_outbox/);
    assert.equal(inserts.length, 1);
    assert.match(inserts[0].sql.replace(/\s+/g, ' '), /\(alert_id, recipient, subject, text_body\) VALUES \(\$1, ?\$2, ?\$3, ?\$4\) ON CONFLICT \(alert_id\) DO NOTHING/);
    assert.deepEqual(inserts[0].params, [ALERT_ID, RECIPIENT, SUBJECT, TEXT]);
  });

  it('rejects when the insert fails, so the caller can decide', async () => {
    const t = rig({ rows: [], pool: { failOn: /INSERT INTO notify\.email_outbox/ } });
    await assert.rejects(t.worker.enqueue({ alertId: ALERT_ID, recipient: RECIPIENT, subject: SUBJECT, text: TEXT }));
  });
});

describe('attempt', () => {
  it('@AC-4 @AC-8 a delivered answer ends the row delivered, blanks its content and counts sent', async () => {
    const reader = install();
    const t = rig({ script: [DELIVERED] });
    await tick(t.worker);
    assert.equal(t.client.calls.length, 1);
    const { request } = t.client.calls[0];
    assert.equal(request.url, ENQUEUE_URL);
    assert.equal(request.appId, APP_ID);
    assert.equal(request.key, KEY);
    assert.equal(request.alertId, ALERT_ID);
    assert.deepEqual(JSON.parse(request.body), { channel: 'email', to: [RECIPIENT], subject: SUBJECT, text: TEXT });
    const delivered = t.pool.delivered();
    assert.equal(delivered.length, 1);
    assert.deepEqual(delivered[0].params, ['o-1']);
    const sql = delivered[0].sql.replace(/\s+/g, ' ');
    assert.match(sql, /attempts = attempts \+ 1/);
    assert.match(sql, /last_error = NULL/);
    assert.match(sql, /recipient = NULL, subject = NULL, text_body = NULL/);
    assert.match(sql, /WHERE outbox_id = \$1 AND state = 'pending'/);
    assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'sent'), 1);
    assert.equal(await counterValue(reader, 'notify.delivery', 'channel', 'commsgun'), 1);
    assert.equal(t.sender.calls.length, 0);
    assert.equal(t.alerts.length, 0);
  });

  it('@AC-6 a new worker over a pool that already holds a pending row delivers it', async () => {
    const pending = row({ outbox_id: 'o-restart' });
    const first = rig({ rows: [] });
    await tick(first.worker);
    assert.equal(first.client.calls.length, 0);
    const second = rig({ rows: [pending] });
    await tick(second.worker);
    assert.deepEqual(second.pool.delivered().map((c) => c.params[0]), ['o-restart']);
  });

  it('@AC-7 a retry then a delivery are two sends of the same alert id and body', async () => {
    const t = rig({ script: [retry('5xx'), DELIVERED] });
    await tick(t.worker);
    assert.equal(t.pool.retried().length, 1);
    assert.equal(t.pool.retried()[0].params[0], 'o-1');
    assert.ok(t.pool.retried()[0].params[1] > 0);
    assert.equal(t.pool.retried()[0].params[2], '5xx');
    t.pool.addDue(row({ attempts: 1 }));
    await tick(t.worker);
    assert.equal(t.client.calls.length, 2);
    const [a, b] = t.client.calls.map((c) => c.request);
    assert.equal(a.alertId, b.alertId);
    assert.equal(a.body, b.body);
    assert.equal(t.pool.delivered().length, 1);
  });

  for (const [name, result, outcome] of [
    ['a 5xx', retry('5xx', 'http_error'), 'http_error'],
    ['@AC-20 a timeout', retry('timeout', 'timeout'), 'timeout'],
    ['@AC-21 a network error', retry('network: ECONNRESET', 'error'), 'error'],
  ] as const) {
    it(`${name} is retried, counted as ${outcome}, and keeps the row pending`, async () => {
      const reader = install();
      const t = rig({ script: [result] });
      await tick(t.worker);
      assert.equal(t.pool.retried().length, 1);
      assert.equal(t.pool.retried()[0].params[2], result.kind === 'retry' ? result.errorClass : '');
      assert.equal(t.terminal().length, 0);
      assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', outcome), 1);
    });
  }

  it('@AC-9 @AC-37 Retry-After raises the wait and backoff_max_seconds caps it', async () => {
    const wait = async (attempts: number, retryAfter: number | null, int: Record<string, number> = {}) => {
      const t = rig({ rows: [row({ attempts })], script: [retry('429', 'http_error', retryAfter)], int });
      await tick(t.worker);
      return t.pool.retried()[0].params[1];
    };
    assert.equal(await wait(0, 120), 120, 'Retry-After 120 beats the 30 s backoff');
    assert.equal(await wait(0, 120, { 'commsgun.backoff_max_seconds': 60 }), 60, 'capped by backoff_max_seconds');
    assert.equal(await wait(0, 5), 30, 'a shorter Retry-After never shortens the backoff');
    assert.deepEqual([await wait(0, null), await wait(1, null), await wait(2, null)], [30, 60, 120]);
  });

  it('@AC-15 @AC-24 each attempt uses the current key and the configured app id', async () => {
    const t = rig({ rows: [row(), row({ outbox_id: 'o-2', alert_id: 'a-2' })], script: [retry('5xx'), DELIVERED] });
    await tick(t.worker);
    assert.equal(t.client.calls.length, 2);
    for (const call of t.client.calls) {
      assert.equal(call.request.key, KEY);
      assert.equal(call.request.appId, APP_ID);
    }
    t.secret.box.state = { kind: 'key', value: 'new-key-0123456789abcdef0123456789' };
    t.pool.addDue(row({ attempts: 1 }));
    await tick(t.worker);
    assert.equal(t.client.calls[2].request.key, 'new-key-0123456789abcdef0123456789');
  });

  it('@AC-3 an unrecognised stored mode with the base and a key attempts and delivers', async () => {
    const t = rig({ mode: 'mailgun' });
    await tick(t.worker);
    assert.equal(t.client.calls.length, 1);
    assert.equal(t.pool.delivered().length, 1);
    assert.equal(t.pool.matching(/SET state = 'rerouted'/).length, 0);
  });
});

describe('attempts that make no request', () => {
  for (const [name, setup, errorClass] of [
    ['the key is absent', { secret: { kind: 'absent' } as CommsgunKeyState }, 'no_app_key'],
    ['GetSecret has never succeeded', { secret: { kind: 'unknown' } as CommsgunKeyState }, 'secret_unresolved'],
    ['the app id is empty', { str: { 'commsgun.app_id': '' } }, 'no_endpoint'],
    ['the enqueue URL is empty', { str: { 'commsgun.enqueue_url': '' } }, 'no_endpoint'],
  ] as const) {
    it(`@AC-38 in commsgun mode, when ${name}, the attempt is a retry classed ${errorClass} with its own outcome`, async () => {
      const reader = install();
      const t = rig({ mode: 'commsgun', ...setup });
      await tick(t.worker);
      assert.equal(t.client.calls.length, 0);
      assert.equal(t.pool.retried().length, 1);
      assert.equal(t.pool.retried()[0].params[2], errorClass);
      assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', errorClass), 1);
      assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'error'), 0);
    });
  }

  it('@AC-25 a missing key uses up the attempts and ends the row undelivered without SendGrid', async () => {
    const t = rig({
      mode: 'commsgun',
      secret: { kind: 'absent' },
      int: { 'commsgun.max_attempts': 2 },
      rows: [row({ attempts: 1 })],
    });
    await tick(t.worker);
    assert.equal(t.client.calls.length, 0);
    assert.deepEqual(t.terminal()[0].params, ['o-1', 'none', 1, 'no_app_key']);
    assert.equal(t.sender.calls.length, 0);
    assert.equal(t.alerts.length, 1);
  });
});

describe('terminal step', () => {
  it('@AC-10 @AC-32 auto: a permanent status ends the row, alerts, then falls back to SendGrid once', async () => {
    const t = rig({ script: [permanent('401')] });
    await tick(t.worker);
    assert.equal(t.client.calls.length, 1);
    assert.deepEqual(t.terminal()[0].params, ['o-1', 'sendgrid', 1, '401']);
    assert.deepEqual(t.events, ['update:undelivered', 'alert', 'stamp:escalated', 'sendgrid', 'stamp:fallback_sent']);
    assert.equal(t.sender.calls.length, 1);
    assert.deepEqual(t.sender.calls[0], { email: { subject: SUBJECT, text: TEXT }, alertId: ALERT_ID });
    assert.deepEqual(t.escalated()[0].params, ['o-1']);
    assert.deepEqual(t.fallbackSent()[0].params, ['o-1']);
  });

  it('@AC-11 the last allowed attempt ends the row, an earlier one retries', async () => {
    const last = rig({ int: { 'commsgun.max_attempts': 3 }, rows: [row({ attempts: 2 })], script: [retry('5xx')] });
    await tick(last.worker);
    assert.deepEqual(last.terminal()[0].params, ['o-1', 'sendgrid', 1, '5xx']);
    assert.equal(last.sender.calls.length, 1);
    const earlier = rig({ int: { 'commsgun.max_attempts': 3 }, rows: [row({ attempts: 1 })], script: [retry('5xx')] });
    await tick(earlier.worker);
    assert.equal(earlier.terminal().length, 0);
    assert.equal(earlier.pool.retried().length, 1);
  });

  it('@AC-12 commsgun mode has no fallback and the terminal statement blanks the content', async () => {
    const t = rig({ mode: 'commsgun', int: { 'commsgun.max_attempts': 3 }, rows: [row({ attempts: 2 })], script: [retry('5xx')] });
    await tick(t.worker);
    assert.deepEqual(t.terminal()[0].params, ['o-1', 'none', 1, '5xx']);
    assert.match(t.terminal()[0].sql.replace(/\s+/g, ' '), /recipient = NULL, subject = NULL, text_body = NULL/);
    assert.equal(t.sender.calls.length, 0);
    assert.equal(t.fallbackSent().length, 0);
  });

  it('@AC-13 an undelivered row is logged, counted as dead and raises one commsgun alert', async () => {
    const reader = install();
    const t = rig({ mode: 'commsgun', int: { 'commsgun.max_attempts': 1 }, script: [retry('5xx')] });
    await tick(t.worker);
    const undelivered = warns().filter((r) => /undelivered/.test(r.msg));
    assert.equal(undelivered.length, 1);
    assert.deepEqual(undelivered[0].meta, { alertId: ALERT_ID, outboxId: 'o-1', attempts: 1, errorClass: '5xx' });
    assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'dead'), 1);
    assert.equal(t.alerts.length, 1);
    const alert = t.alerts[0];
    assert.equal(alert.category, 'commsgun');
    assert.equal(alert.severity, 'ALERT_SEVERITY_WARNING');
    assert.equal(alert.sourceService, 'xstockstrat-notify');
    assert.ok(`${alert.title} ${alert.body}`.includes(ALERT_ID));
    assert.ok(alert.body.includes('5xx'));
    assert.equal(t.sender.calls.length, 0);
  });

  it('@AC-22 auto with SendGrid not enabled ends without fallback, and still alerts', async () => {
    const t = rig({ int: { 'commsgun.max_attempts': 1 }, script: [retry('5xx')], sender: { enabled: false } });
    await tick(t.worker);
    assert.deepEqual(t.terminal()[0].params, ['o-1', 'none', 1, '5xx']);
    assert.equal(t.sender.calls.length, 0);
    assert.equal(t.alerts.length, 1);
    assert.ok(t.alerts[0].body.includes(ALERT_ID));
  });

  it('a failing alert leaves the row unstamped, still falls back once, and nothing escapes', async () => {
    const t = rig({ script: [permanent('422')], failAlert: true });
    await tick(t.worker);
    assert.equal(t.escalated().length, 0);
    assert.equal(t.sender.calls.length, 1);
    assert.equal(t.fallbackSent().length, 1);
  });

  it('a SendGrid fallback that is not accepted leaves no fallback_sent_at stamp', async () => {
    const t = rig({ script: [permanent('422')], sender: { result: false } });
    await tick(t.worker);
    assert.equal(t.sender.calls.length, 1);
    assert.equal(t.fallbackSent().length, 0);
    assert.equal(t.escalated().length, 1);
  });

  it('has no side effect when the terminal statement changed no row', async () => {
    const reader = install();
    const t = rig({ script: [permanent('401')], pool: { updateRowCount: 0 } });
    await tick(t.worker);
    assert.equal(t.terminal().length, 1);
    assert.equal(t.alerts.length, 0);
    assert.equal(t.sender.calls.length, 0);
    assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'dead'), 0);
    assert.equal(warns().filter((r) => /undelivered/.test(r.msg)).length, 0);
  });
});

describe('hold', () => {
  it('@AC-33 auto with the base set and an unresolved key neither selects nor sends, then delivers', async () => {
    const t = rig({ secret: { kind: 'unknown' } });
    for (let i = 0; i < 3; i++) await tick(t.worker);
    assert.equal(t.dueSelects().length, 0);
    assert.equal(t.client.calls.length, 0);
    assert.equal(t.pool.updates().length, 0);
    t.secret.box.state = { kind: 'key', value: KEY };
    await tick(t.worker);
    assert.equal(t.pool.delivered().length, 1);
  });
});

describe('app id change', () => {
  it('@AC-39 warns once, without either id, and sends as the new app to the queued recipient', async () => {
    const t = rig({ rows: [row()], script: [retry('5xx')] });
    await t.worker.enqueue({ alertId: ALERT_ID, recipient: RECIPIENT, subject: SUBJECT, text: TEXT });
    t.live.str['commsgun.app_id'] = 'xstockstrat-x';
    await tick(t.worker);
    t.pool.addDue(row({ outbox_id: 'o-2', alert_id: 'a-2' }));
    await tick(t.worker);
    const changed = warns().filter((r) => /app id changed/.test(r.msg));
    assert.equal(changed.length, 1);
    const dump = JSON.stringify(changed[0]);
    assert.ok(!dump.includes(APP_ID) && !dump.includes('xstockstrat-x'), 'the WARN names an app id');
    assert.equal(t.client.calls.length, 2);
    for (const call of t.client.calls) {
      assert.equal(call.request.appId, 'xstockstrat-x');
      assert.deepEqual(JSON.parse(call.request.body).to, [RECIPIENT]);
    }
  });

  it('does not warn when the app id is unchanged or was never remembered', async () => {
    const t = rig({ rows: [row()], script: [retry('5xx')] });
    await tick(t.worker);
    t.pool.addDue(row({ attempts: 1 }));
    await tick(t.worker);
    assert.equal(warns().filter((r) => /app id changed/.test(r.msg)).length, 0);
  });
});

describe('shutdown', () => {
  it('@AC-36 stop aborts an in-flight POST: no UPDATE, no metric, the attempt is not counted', async () => {
    const reader = install();
    const t = rig({ script: ['hang'] });
    await tick(t.worker);
    assert.equal(t.client.calls.length, 1);
    assert.equal(t.client.calls[0].controller.signal.aborted, false);
    await t.worker.stop();
    await settle();
    assert.equal(t.client.calls[0].controller.signal.aborted, true);
    assert.equal(t.pool.updates().length, 0);
    assert.equal(await counterValue(reader, 'notify.delivery', 'channel', 'commsgun'), 0);
  });

  it('stop waits for a terminal step that is already past its UPDATE', async () => {
    const t = rig({ script: [permanent('401')] });
    const release = t.sender.holdNext();
    await tick(t.worker);
    assert.equal(t.sender.calls.length, 1, 'the fallback send has started');
    let stopped = false;
    const stopping = t.worker.stop().then(() => (stopped = true));
    await settle();
    assert.equal(stopped, false, 'stop() resolved before the fallback send finished');
    release();
    await stopping;
    assert.equal(t.fallbackSent().length, 1);
  });

  it('a stopped worker does not tick', async () => {
    const t = rig();
    await t.worker.stop();
    await tick(t.worker);
    assert.equal(t.pool.calls.length, 0);
  });
});

describe('confidentiality', () => {
  it('@AC-18 no log line, alert text or statement parameter carries content, the key or the URL', async () => {
    const t = rig({ int: { 'commsgun.max_attempts': 2 }, script: [retry('5xx'), permanent('422')] });
    await tick(t.worker);
    t.pool.addDue(row({ attempts: 1 }));
    await tick(t.worker);
    assert.equal(t.terminal().length, 1);
    const updates = t.pool.updates().map((c) => c.params);
    const dump = JSON.stringify({ records, alerts: t.alerts, updates });
    for (const secret of [RECIPIENT, TITLE, KEY, ENQUEUE_URL, 'comms.ts.example.net']) {
      assert.ok(!dump.includes(secret), `leaked: ${secret}`);
    }
  });
});

describe('isolation', () => {
  it('uses single statements only: no checked-out client, no transaction', async () => {
    const t = rig({ script: [permanent('401')] });
    await tick(t.worker);
    assert.equal(t.pool.connects(), 0);
    assert.equal(t.pool.matching(/BEGIN|COMMIT/).length, 0);
  });

  it('keeps at most 4 requests in flight and selects only into the free slots', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => row({ outbox_id: `o-${i}`, alert_id: `a-${i}` }));
    const t = rig({ rows, script: ['hang'] });
    await tick(t.worker);
    assert.equal(t.client.calls.length, 4);
    assert.equal(t.dueSelects()[0].params[1], 4);
    await tick(t.worker);
    assert.equal(t.client.calls.length, 4);
    assert.equal(t.dueSelects().length, 1, 'no select while every slot is taken');
  });

  it('runs one tick at a time', async () => {
    const t = rig({ pool: { hangSelect: true } });
    void t.worker.tick();
    await settle();
    await t.worker.tick();
    assert.equal(t.dueSelects().length, 1);
  });

  it('a failing statement inside an attempt is contained and recorded as an internal retry', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const t = rig({ pool: { failOn: /SET state = 'delivered'/ } });
      await tick(t.worker);
      assert.equal(t.pool.retried().length, 1);
      assert.equal(t.pool.retried()[0].params[2], 'internal');
      const dump = JSON.stringify(records);
      assert.ok(!dump.includes('db down'), 'the error text reached a log');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    assert.equal(unhandled.length, 0);
  });
});

describe('config readers', () => {
  it('a stored 0 or negative reads as the default for each of the three keys', async () => {
    for (const bad of [0, -3]) {
      const keep = rig({ int: { 'commsgun.max_attempts': bad }, rows: [row({ attempts: 6 })], script: [retry('5xx')] });
      await tick(keep.worker);
      assert.equal(keep.pool.retried().length, 1, `max_attempts ${bad}: attempt 7 of 8 must retry`);
      const end = rig({ int: { 'commsgun.max_attempts': bad }, rows: [row({ attempts: 7 })], script: [retry('5xx')] });
      await tick(end.worker);
      assert.equal(end.terminal().length, 1, `max_attempts ${bad}: attempt 8 of 8 must end`);

      const base = rig({ int: { 'commsgun.backoff_base_seconds': bad }, script: [retry('5xx')] });
      await tick(base.worker);
      assert.equal(base.pool.retried()[0].params[1], 30, `backoff_base_seconds ${bad}`);

      const cap = rig({
        int: { 'commsgun.backoff_max_seconds': bad, 'commsgun.max_attempts': 50 },
        rows: [row({ attempts: 9 })],
        script: [retry('5xx')],
      });
      await tick(cap.worker);
      assert.equal(cap.pool.retried()[0].params[1], 3600, `backoff_max_seconds ${bad}`);
    }
  });

  it('reads every key live through the real ConfigWatcher snapshot', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const snapshot = (values: Record<string, { intVal?: number; stringVal?: string }>, version: string) => {
      const built: Record<string, configProto.ConfigValue> = {};
      for (const [k, v] of Object.entries(values)) built[k] = configProto.ConfigValue.fromPartial(v);
      return configProto.ConfigSnapshot.fromPartial({ namespace: 'notify', version, values: built });
    };
    streams.length = 0;
    const watcher = new ConfigWatcher('xstockstrat-config:50060', 'notify');
    await settle();
    // Every stored value differs from its code default (auto / '' / '' / '' / 8 / 30 / 3600).
    const stored = {
      'fanout.email_provider': { stringVal: 'commsgun' },
      'commsgun.enqueue_url': { stringVal: 'https://hub.example/v1/messages' },
      'commsgun.app_id': { stringVal: 'xstockstrat' },
      'commsgun.to_email': { stringVal: 'desk@example.com' },
      'commsgun.max_attempts': { intVal: 3 },
      'commsgun.backoff_base_seconds': { intVal: 7 },
      'commsgun.backoff_max_seconds': { intVal: 11 },
    };
    streams[0].emit('data', snapshot(stored, '1'));

    const client = fakeClient([retry('5xx')]);
    const sender = fakeSender();
    const pool = scriptedPool(
      [row({ outbox_id: 'o-1', attempts: 0 }), row({ outbox_id: 'o-2', attempts: 1 }), row({ outbox_id: 'o-3', attempts: 2 })],
      { ...OUTBOX, dueMatch: /next_attempt_at <= NOW\(\)/ },
    );
    const emit = alertRecorder();
    const worker = new CommsgunWorker(pool.obj as any, watcher, { secret: fakeSecret(), client, sendgrid: sender }, emit.fn);
    stopFns.push(() => worker.stop());
    await tick(worker);
    assert.equal(client.calls.length, 3);
    assert.equal(client.calls[0].request.url, 'https://hub.example/v1/messages');
    assert.equal(client.calls[0].request.appId, 'xstockstrat');
    const secsById = Object.fromEntries(pool.retried().map((c) => [c.params[0], c.params[1]]));
    assert.deepEqual(secsById, { 'o-1': 7, 'o-2': 11 }, 'base 7 doubled to 14 is capped at max 11');
    const ended = pool.matching(/SET state = 'undelivered'/);
    assert.deepEqual(ended.map((c) => c.params), [['o-3', 'none', 1, '5xx']], 'max_attempts 3; commsgun mode has no fallback');

    // A later snapshot clears the URL: the next attempt makes no request.
    streams[0].emit('data', snapshot({ ...stored, 'commsgun.enqueue_url': { stringVal: '' } }, '2'));
    pool.addDue(row({ outbox_id: 'o-9' }));
    await tick(worker);
    assert.equal(client.calls.length, 3);
    assert.equal(pool.retried().slice(-1)[0].params[2], 'no_endpoint');
  });
});

// ── Reroutes, alert sweep and incidents (Steps 16+17) ─────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function twoRows(): any[] {
  return [row({ outbox_id: 'o-1', alert_id: 'a-1' }), row({ outbox_id: 'o-2', alert_id: 'a-2' })];
}

/** What a later sweep finds for rows this worker rerouted: their persisted state, content blanked. */
function sweptRow(over: Record<string, unknown>): any {
  return {
    outbox_id: 'o-1',
    alert_id: ALERT_ID,
    state: 'rerouted',
    fallback: 'sendgrid',
    reroute_reason: 'deliberate',
    attempts: 0,
    last_error: null,
    fallback_sent_at: null,
    ...over,
  };
}

function commsgunAlerts(alerts: any[]): any[] {
  return alerts.filter((a) => a.category === 'commsgun');
}

describe('reroute', () => {
  it('@AC-27 a deliberate switch to sendgrid reroutes pending rows through SendGrid without an alert', async () => {
    const reader = install();
    const t = rig({ mode: 'sendgrid', rows: twoRows() });
    await tick(t.worker);
    await tick(t.worker);
    assert.equal(t.client.calls.length, 0);
    assert.deepEqual(t.rerouted().map((c) => c.params), [
      ['o-1', 'deliberate', 'sendgrid'],
      ['o-2', 'deliberate', 'sendgrid'],
    ]);
    const sql = t.rerouted()[0].sql.replace(/\s+/g, ' ');
    assert.match(sql, /last_error = NULL, recipient = NULL, subject = NULL, text_body = NULL/);
    assert.match(sql, /WHERE outbox_id = \$1 AND state = 'pending'/);
    assert.equal(t.sender.calls.length, 2);
    assert.deepEqual(t.sender.calls[0], { email: { subject: SUBJECT, text: TEXT }, alertId: 'a-1' });
    assert.equal(t.fallbackSent().length, 2);
    assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'rerouted'), 2);
    assert.equal(t.alerts.length, 0);
  });

  it('@AC-28 a deliberate switch with SendGrid not enabled drops the rows and alerts once', async () => {
    const dropped = [
      sweptRow({ outbox_id: 'o-1', fallback: 'none' }),
      sweptRow({ outbox_id: 'o-2', fallback: 'none' }),
    ];
    const t = rig({ mode: 'sendgrid', rows: twoRows(), sender: { enabled: false }, sweep: [] });
    await tick(t.worker);
    assert.deepEqual(t.rerouted().map((c) => c.params[2]), ['none', 'none']);
    assert.equal(t.sender.calls.length, 0);
    assert.equal(t.alerts.length, 0, 'the alert comes from the next sweep');
    const next = rig({ mode: 'sendgrid', rows: [], sender: { enabled: false }, sweep: dropped });
    for (let i = 0; i < 3; i++) await tick(next.worker);
    assert.equal(commsgunAlerts(next.alerts).length, 1);
    assert.match(next.alerts[0].body, /\b2\b.*dropped/);
    assert.deepEqual(next.bulkStamps().map((c) => c.params), [[['o-1', 'o-2']]]);
  });

  it('@AC-29 lost configuration in auto drains through SendGrid and alerts once per drain', async () => {
    const t = rig({ mode: 'auto', rows: twoRows(), str: { 'commsgun.enqueue_url': '' } });
    await tick(t.worker);
    assert.equal(t.client.calls.length, 0);
    assert.deepEqual(t.rerouted().map((c) => c.params), [
      ['o-1', 'lost_config', 'sendgrid'],
      ['o-2', 'lost_config', 'sendgrid'],
    ]);
    assert.equal(t.sender.calls.length, 2);
    const confirmed = [
      sweptRow({ outbox_id: 'o-1', reroute_reason: 'lost_config', fallback_sent_at: new Date() }),
      sweptRow({ outbox_id: 'o-2', reroute_reason: 'lost_config', fallback_sent_at: new Date() }),
    ];
    const next = rig({ mode: 'auto', rows: [], str: { 'commsgun.enqueue_url': '' }, sweep: confirmed });
    for (let i = 0; i < 3; i++) await tick(next.worker);
    assert.equal(commsgunAlerts(next.alerts).length, 1);
    assert.match(next.alerts[0].body, /\b2\b.*SendGrid/);
    assert.deepEqual(next.bulkStamps().map((c) => c.params), [[['o-1', 'o-2']]]);
  });

  it('@AC-42 without the base an unresolved key does not hold the queue, and the stalled-key incident stays silent', async () => {
    const t = rig({ mode: 'auto', rows: twoRows(), str: { 'commsgun.enqueue_url': '' }, secret: { kind: 'unknown' } });
    t.secret.box.failures = { count: 2, statusClass: 'UNAVAILABLE' };
    for (let i = 0; i < 3; i++) await tick(t.worker);
    assert.deepEqual(t.rerouted().map((c) => c.params[1]), ['lost_config', 'lost_config']);
    assert.equal(t.sender.calls.length, 2);
    assert.equal(t.alerts.length, 0, 'no stalled-key alert without the base; the drain alert comes from the sweep');
  });

  it('a row reaching its terminal step while the mode is sendgrid is rerouted, not ended undelivered', async () => {
    const t = rig({ mode: 'commsgun', int: { 'commsgun.max_attempts': 1 }, script: ['hang'] });
    await tick(t.worker);
    t.live.str['fanout.email_provider'] = 'sendgrid';
    // The request times out after the switch: its attempt is the last allowed one.
    t.client.calls[0].controller.abort();
    await settle();
    assert.equal(t.terminal().length, 0);
    assert.deepEqual(t.rerouted().map((c) => c.params), [['o-1', 'deliberate', 'sendgrid']]);
    assert.equal(t.sender.calls.length, 1);
    assert.equal(t.alerts.length, 0);
  });

  it('a reroute that changed no row has no side effect', async () => {
    const t = rig({ mode: 'sendgrid', pool: { updateRowCount: 0 } });
    await tick(t.worker);
    assert.equal(t.rerouted().length, 1);
    assert.equal(t.sender.calls.length, 0);
  });
});

describe('alert sweep', () => {
  it('@AC-30 a reroute interrupted before its send is alerted as unconfirmed, never re-sent', async () => {
    const t = rig({ mode: 'sendgrid', rows: [], sweep: [sweptRow({})] });
    await tick(t.worker);
    assert.equal(t.sender.calls.length, 0);
    assert.equal(t.client.calls.length, 0);
    assert.equal(commsgunAlerts(t.alerts).length, 1);
    assert.match(t.alerts[0].body, /\b1\b.*not confirmed/);
    assert.deepEqual(t.bulkStamps().map((c) => c.params), [[['o-1']]]);
  });

  it('@AC-31 an undelivered row whose escalation was lost is re-raised and stamped, without a send', async () => {
    const lost = sweptRow({ state: 'undelivered', reroute_reason: null, attempts: 8, last_error: '5xx' });
    const t = rig({ rows: [], sweep: [lost] });
    await tick(t.worker);
    assert.equal(t.alerts.length, 1);
    assert.equal(t.alerts[0].category, 'commsgun');
    assert.ok(`${t.alerts[0].title} ${t.alerts[0].body}`.includes(ALERT_ID));
    assert.ok(t.alerts[0].body.includes('5xx'));
    assert.deepEqual(t.escalated().map((c) => c.params), [['o-1']]);
    assert.equal(t.sender.calls.length, 0);
  });

  it('excludes rows in flight from the sweep select', async () => {
    const t = rig({ script: ['hang'] });
    await tick(t.worker);
    await tick(t.worker);
    const sweeps = t.pool.matching(/escalated_at IS NULL/).filter((c) => /^\s*SELECT/.test(c.sql));
    assert.equal(sweeps.length, 2);
    assert.deepEqual(sweeps[0].params[0], []);
    assert.deepEqual(sweeps[1].params[0], ['o-1']);
  });

  it('the sweep select is the needs-alert predicate, word for word', async () => {
    const t = rig({ rows: [] });
    await tick(t.worker);
    const sweep = t.pool.matching(/^SELECT .*escalated_at IS NULL/)[0].sql.replace(/\s+/g, ' ');
    assert.ok(
      sweep.includes(
        "escalated_at IS NULL AND (state = 'undelivered' OR (state = 'rerouted' AND (reroute_reason = 'lost_config' OR fallback_sent_at IS NULL)))",
      ),
      sweep,
    );
  });

  it('a failing alert stamps nothing and sets no latch, so the next sweep alerts again', async () => {
    const drops = () => [sweptRow({ fallback: 'none' })];
    const t = rig({ mode: 'sendgrid', rows: [], sweep: drops(), failAlert: true });
    await tick(t.worker);
    assert.equal(t.alerts.length, 1);
    assert.equal(t.bulkStamps().length, 0);
    const undelivered = rig({ rows: [], sweep: [sweptRow({ state: 'undelivered', reroute_reason: null })], failAlert: true });
    await tick(undelivered.worker);
    assert.equal(undelivered.escalated().length, 0);
  });

  it('one worker: a second batch in the same drain is silent; leaving and re-entering the route alerts again', async () => {
    const sweepRows: any[] = [sweptRow({ outbox_id: 'o-1', fallback: 'none' })];
    const live = liveConfig('sendgrid');
    const events: string[] = [];
    const pool = scriptedPool([], { ...OUTBOX, dueMatch: /next_attempt_at <= NOW\(\)/ });
    // Feed the sweep from a mutable list, each row handed out once.
    const query = pool.obj.query.bind(pool.obj);
    pool.obj.query = (async (sql: string, params: any[] = []) => {
      if (/^\s*SELECT/.test(sql) && /escalated_at IS NULL/.test(sql)) {
        await query(sql, params);
        const rows = sweepRows.splice(0);
        return { rows, rowCount: rows.length };
      }
      return query(sql, params);
    }) as any;
    const emit = alertRecorder();
    const worker = new CommsgunWorker(
      pool.obj as any,
      live.config,
      { secret: fakeSecret(), client: fakeClient(), sendgrid: fakeSender({ enabled: false, events }) },
      emit.fn,
    );
    stopFns.push(() => worker.stop());
    await tick(worker);
    assert.equal(emit.alerts.length, 1);
    sweepRows.push(sweptRow({ outbox_id: 'o-2', fallback: 'none' }));
    await tick(worker);
    assert.equal(emit.alerts.length, 1, 'same drain: stamped without a second alert');
    assert.equal(pool.matching(/SET escalated_at = NOW\(\).*ANY\(\$1/).length, 2);
    // The route leaves (commsgun) and re-enters (sendgrid): a new drain.
    live.str['fanout.email_provider'] = 'commsgun';
    await tick(worker);
    live.str['fanout.email_provider'] = 'sendgrid';
    sweepRows.push(sweptRow({ outbox_id: 'o-3', fallback: 'none' }));
    await tick(worker);
    await tick(worker);
    assert.equal(emit.alerts.length, 2);
  });

  it('the drain alert reports the rows still pending', async () => {
    const t = rig({ mode: 'sendgrid', rows: [], sweep: [sweptRow({ fallback: 'none' })], pendingCount: 96, sender: { enabled: false } });
    await tick(t.worker);
    assert.match(t.alerts[0].body, /\b96\b.*pending/);
  });
});

describe('standing incidents', () => {
  it('@AC-26 pinned to commsgun without the base: one alert, none within 24 h, one more after 24 h', async () => {
    mock.timers.enable({ apis: ['Date'] });
    const t = rig({ mode: 'commsgun', rows: [], str: { 'commsgun.enqueue_url': '' } });
    await tick(t.worker);
    assert.equal(t.alerts.length, 1);
    assert.equal(t.alerts[0].category, 'commsgun');
    assert.ok(t.alerts[0].body.includes('commsgun.enqueue_url'), 'the alert names the missing key');
    assert.ok(!JSON.stringify(t.alerts).includes(RECIPIENT));
    for (let i = 0; i < 3; i++) await tick(t.worker);
    mock.timers.tick(DAY_MS - 1);
    await tick(t.worker);
    assert.equal(t.alerts.length, 1);
    mock.timers.tick(1);
    await tick(t.worker);
    assert.equal(t.alerts.length, 2);
    // The condition ends and starts again: a new incident.
    t.live.str['commsgun.enqueue_url'] = ENQUEUE_URL;
    await tick(t.worker);
    t.live.str['commsgun.enqueue_url'] = '';
    await tick(t.worker);
    assert.equal(t.alerts.length, 3);
  });

  for (const [name, state, failures, base, want, text] of [
    ['the key is absent', { kind: 'absent' }, { count: 0, statusClass: '' }, true, 1, 'absent'],
    ['one UNAVAILABLE failure', { kind: 'unknown' }, { count: 1, statusClass: 'UNAVAILABLE' }, true, 0, ''],
    ['two PERMISSION_DENIED failures', { kind: 'unknown' }, { count: 2, statusClass: 'PERMISSION_DENIED' }, true, 1, 'PERMISSION_DENIED'],
    ['two failures but no base', { kind: 'unknown' }, { count: 2, statusClass: 'PERMISSION_DENIED' }, false, 0, ''],
    ['an absent key but no base', { kind: 'absent' }, { count: 0, statusClass: '' }, false, 0, ''],
  ] as const) {
    it(`@AC-34 auto, ${name}: ${want} stalled-key alert`, async () => {
      const t = rig({ rows: [], secret: state as CommsgunKeyState, str: base ? {} : { 'commsgun.enqueue_url': '' } });
      t.secret.box.failures = { ...failures };
      await tick(t.worker);
      await tick(t.worker);
      assert.equal(t.alerts.length, want);
      if (want) assert.ok(t.alerts[0].body.includes(text), t.alerts[0].body);
      assert.ok(!JSON.stringify(t.alerts).includes(KEY));
    });
  }

  it('@AC-35 the stalled-key alert repeats once after 24 hours and ends when the key resolves', async () => {
    mock.timers.enable({ apis: ['Date'] });
    const t = rig({ rows: [], secret: { kind: 'absent' } });
    await tick(t.worker);
    mock.timers.tick(DAY_MS);
    await tick(t.worker);
    assert.equal(t.alerts.length, 2);
    t.secret.box.state = { kind: 'key', value: KEY };
    mock.timers.tick(DAY_MS);
    await tick(t.worker);
    assert.equal(t.alerts.length, 2);
  });

  it('a failed incident alert sets no timer: the next tick raises it again', async () => {
    const t = rig({ mode: 'commsgun', rows: [], str: { 'commsgun.to_email': '' }, failAlert: true });
    await tick(t.worker);
    await tick(t.worker);
    assert.equal(t.alerts.length, 2);
  });

  it('auto with an absent key and pending rows raises both the drain alert and the stalled-key alert', async () => {
    const drained = [sweptRow({ reroute_reason: 'lost_config', fallback_sent_at: new Date() })];
    const t = rig({ rows: [], secret: { kind: 'absent' }, sweep: drained });
    await tick(t.worker);
    assert.equal(t.alerts.length, 2);
    assert.notEqual(t.alerts[0].body, t.alerts[1].body);
    assert.notEqual(t.alerts[0].title, t.alerts[1].title);
  });
});
