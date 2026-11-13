/**
 * Unit tests for FanoutDispatcher (feature 020, notify-external-fanout).
 *
 * Outbound HTTP is stubbed via globalThis.fetch; no real network, DB, or container. Credentials are
 * read from process.env in the constructor, so each test sets the env BEFORE constructing and clears
 * it after. Covers AC-2, AC-3, AC-5, AC-6, AC-7, AC-8, AC-9.
 *
 * Compiled-first harness (tsc && node --test dist/__tests__/*.test.js) with a static import.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { transports } from 'winston';

import { FanoutDispatcher } from '../fanout/fanout.js';
import { SendgridSender } from '../fanout/sendgridSender.js';
import { counterValue, install, points } from './fixtures/collectingReader.js';
import { fakeCommsgun, type FakeCommsgunOpts } from './fixtures/fakeCommsgun.js';
import { fakeConfig, type Cfg } from './fixtures/fakeConfig.js';
import { stubFetch } from './fixtures/stubFetch.js';

// ── Harness: import must succeed, never silently skip (074 guard) ─────────────
describe('fanout test harness', () => {
  it('imports FanoutDispatcher', () => {
    assert.ok(FanoutDispatcher, 'FanoutDispatcher import must succeed');
  });
});

// ── Fakes ─────────────────────────────────────────────────────────────────────

/** Construct a dispatcher with the given credential env, then clear the env (constructor read once). */
function makeDispatcher(
  env: { slack?: string; sendgrid?: string },
  cfg: Cfg,
  commsgun: ReturnType<typeof fakeCommsgun> = fakeCommsgun(),
): FanoutDispatcher {
  const prevSlack = process.env.SLACK_WEBHOOK_URL;
  const prevSg = process.env.SENDGRID_API_KEY;
  if (env.slack) process.env.SLACK_WEBHOOK_URL = env.slack; else delete process.env.SLACK_WEBHOOK_URL;
  if (env.sendgrid) process.env.SENDGRID_API_KEY = env.sendgrid; else delete process.env.SENDGRID_API_KEY;
  const config = fakeConfig(cfg);
  const d = new FanoutDispatcher(config, new SendgridSender(config), commsgun);
  // restore
  if (prevSlack === undefined) delete process.env.SLACK_WEBHOOK_URL; else process.env.SLACK_WEBHOOK_URL = prevSlack;
  if (prevSg === undefined) delete process.env.SENDGRID_API_KEY; else process.env.SENDGRID_API_KEY = prevSg;
  return d;
}

function makeAlert(overrides: any = {}): any {
  return {
    alertId: 'alert-1',
    severity: 'ALERT_SEVERITY_WARNING',
    category: 'signal',
    title: 'BUY AAPL',
    body: 'Signal fired',
    sourceService: 'analysis',
    context: {},
    createdAt: new Date('2026-08-20T14:31:00Z'),
    ...overrides,
  };
}

const GATE = { int: { 'fanout.min_severity': 2 }, float: { 'fanout.min_confidence_threshold': 0.7 } };

// ── Gate ────────────────────────────────────────────────────────────────────

describe('FanoutDispatcher gate', () => {
  it('AC-7: below the severity floor → no fanout', async () => {
    const f = stubFetch();
    const d = makeDispatcher({ slack: 'https://hooks.slack.test/x' }, GATE);
    await d.dispatch(makeAlert({ severity: 'ALERT_SEVERITY_INFO' }));
    assert.equal(f.calls.length, 0);
    f.restore();
  });

  it('AC-8: conviction below the floor → no fanout', async () => {
    const f = stubFetch();
    const d = makeDispatcher({ slack: 'https://hooks.slack.test/x' }, GATE);
    await d.dispatch(makeAlert({ context: { conviction: 0.55 } }));
    assert.equal(f.calls.length, 0);
    f.restore();
  });

  it('AC-9: no conviction key → severity alone gates (fans out, no fail-closed)', async () => {
    const f = stubFetch();
    const d = makeDispatcher({ slack: 'https://hooks.slack.test/x' }, GATE);
    await d.dispatch(makeAlert({ sourceService: 'trading', context: {} }));
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0].url, /hooks\.slack\.test/);
    f.restore();
  });

  it('AC-2 notify: a stored fanout.min_severity=3 (default 2) drops a WARNING alert', async () => {
    const f = stubFetch();
    // WARNING is ordinal 2: the default floor (2) would fan it out once; the stored floor (3) must not.
    // A reader that still asks for the namespace-prefixed spelling misses the key and fans out.
    const d = makeDispatcher({ slack: 'https://hooks.slack.test/x' }, { int: { 'fanout.min_severity': 3 } });
    await d.dispatch(makeAlert({ severity: 'ALERT_SEVERITY_WARNING' }));
    assert.equal(f.calls.length, 0);
    f.restore();
  });
});

// ── Enable-iff-set + payload ──────────────────────────────────────────────────

describe('FanoutDispatcher channels', () => {
  it('AC-3: no credentials set → nothing fans out (even CRITICAL)', async () => {
    const f = stubFetch();
    const d = makeDispatcher({}, GATE);
    await d.dispatch(makeAlert({ severity: 'ALERT_SEVERITY_CRITICAL' }));
    assert.equal(f.calls.length, 0);
    f.restore();
  });

  it('AC-2: SendGrid email carries every required field', async () => {
    const f = stubFetch();
    const d = makeDispatcher(
      { sendgrid: 'SG.key' },
      { ...GATE, str: { 'fanout.sendgrid_from_email': 'a@x.co', 'fanout.sendgrid_to_email': 'b@x.co' } },
    );
    await d.dispatch(
      makeAlert({ sourceService: 'analysis', context: { conviction: 0.82, symbol: 'AAPL' } }),
    );
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, 'https://api.sendgrid.com/v3/mail/send');
    assert.match(f.calls[0].init.headers.Authorization, /Bearer SG\.key/);
    const body = String(f.calls[0].init.body);
    for (const needle of ['AAPL', 'analysis', 'ALERT_SEVERITY_WARNING', '0.82', 'BUY AAPL', '2026-08-20T14:31:00.000Z']) {
      assert.ok(body.includes(needle), `sendgrid body must contain ${needle}`);
    }
    f.restore();
  });

  it('SendGrid stays disabled when the API key is set but to-address is empty', async () => {
    const f = stubFetch();
    const d = makeDispatcher(
      { sendgrid: 'SG.key' },
      { ...GATE, str: { 'fanout.sendgrid_from_email': 'a@x.co', 'fanout.sendgrid_to_email': '' } },
    );
    await d.dispatch(makeAlert({ context: { conviction: 0.82 } }));
    assert.equal(f.calls.length, 0);
    f.restore();
  });
});

// ── Dedup ─────────────────────────────────────────────────────────────────────

describe('FanoutDispatcher dedup', () => {
  it('AC-5: same alert twice within the window → exactly one POST', async () => {
    const f = stubFetch();
    const d = makeDispatcher(
      { slack: 'https://hooks.slack.test/x' },
      { int: { 'fanout.min_severity': 2, 'fanout.dedup_window_seconds': 300 } },
    );
    const alert = makeAlert({ context: { symbol: 'AAPL' } });
    await d.dispatch(alert);
    await d.dispatch(makeAlert({ context: { symbol: 'AAPL' } })); // byte-identical
    assert.equal(f.calls.length, 1);
    f.restore();
  });
});

// ── Error isolation ─────────────────────────────────────────────────────────

describe('FanoutDispatcher error handling', () => {
  it('AC-6: a channel HTTP 500 does not throw out of dispatch', async () => {
    const f = stubFetch(500);
    const d = makeDispatcher({ slack: 'https://hooks.slack.test/x' }, GATE);
    // Must resolve (never reject) and still have attempted the POST (the 500 path was taken).
    await d.dispatch(makeAlert({ alertId: 'alert-abc123', context: { conviction: 0.9 } }));
    assert.equal(f.calls.length, 1, 'the failing channel POST was attempted');
    f.restore();
  });

  it('a fetch that throws is swallowed (never rejects dispatch)', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('network down'); }) as any;
    const d = makeDispatcher({ slack: 'https://hooks.slack.test/x' }, GATE);
    await d.dispatch(makeAlert({ context: { conviction: 0.9 } })); // resolves — assertion is no-throw
    globalThis.fetch = original;
    assert.ok(true);
  });
});

// ── Delivery telemetry (feature 294) ──────────────────────────────────────────

describe('FanoutDispatcher delivery telemetry', () => {
  it('AC-31: a gated INFO alert counts fanout/gated_severity, no slack sample, no category or source label', async () => {
    const reader = install();
    const f = stubFetch();
    const d = makeDispatcher({}, GATE); // Slack disabled
    await d.dispatch(makeAlert({ severity: 'ALERT_SEVERITY_INFO' }));
    f.restore();
    const pts = await points(reader, 'notify.delivery');
    assert.deepEqual(
      pts.map((p) => [p.attributes.channel, p.attributes.outcome, p.value]),
      [['fanout', 'gated_severity', 1]],
    );
    assert.equal(pts.some((p) => p.attributes.channel === 'slack'), false);
    for (const p of pts) {
      assert.deepEqual(Object.keys(p.attributes).sort(), ['channel', 'outcome']);
      for (const v of Object.values(p.attributes)) {
        assert.ok(v !== 'signal' && v !== 'analysis', `label value ${String(v)} leaks category/sourceService`);
      }
    }
  });
});

// ── Email provider selection (feature 338) ────────────────────────────────────

const SG_URL = 'https://api.sendgrid.com/v3/mail/send';
const SLACK = 'https://hooks.slack.test/x';
const ENQUEUE_URL = 'https://comms.ts.example.net/v1/messages';
const RECIPIENT = 'ops@example.com';
const APP_KEY = 'k-0123456789abcdef0123456789abcdef';
const SG_ADDRESSES = { 'fanout.sendgrid_from_email': 'alerts@example.com', 'fanout.sendgrid_to_email': 'ops@example.com' };
const COMMSGUN_BASE = {
  'commsgun.enqueue_url': ENQUEUE_URL,
  'commsgun.app_id': 'xstockstrat-staging',
  'commsgun.to_email': RECIPIENT,
};

function providerCfg(mode: string | undefined, str: Record<string, string> = {}): Cfg {
  return {
    ...GATE,
    str: { ...(mode === undefined ? {} : { 'fanout.email_provider': mode }), ...SG_ADDRESSES, ...COMMSGUN_BASE, ...str },
  };
}

function provider(mode: string | undefined, opts: { str?: Record<string, string>; commsgun?: FakeCommsgunOpts; slack?: boolean; sendgrid?: boolean } = {}) {
  const commsgun = fakeCommsgun(opts.commsgun);
  const dispatcher = makeDispatcher(
    { slack: opts.slack ? SLACK : undefined, sendgrid: opts.sendgrid === false ? undefined : 'SG.key' },
    providerCfg(mode, opts.str),
    commsgun,
  );
  return { dispatcher, commsgun };
}

const sendgridPosts = (f: { calls: Array<{ url: string }> }) => f.calls.filter((c) => c.url === SG_URL);

/** Captures what the real logger writes while `run` executes. */
async function withLogs(run: () => Promise<void>): Promise<Array<Record<string | symbol, unknown>>> {
  const captured: Array<Record<string | symbol, unknown>> = [];
  const original = transports.Console.prototype.log;
  transports.Console.prototype.log = function (info: Record<string | symbol, unknown>, next: () => void) {
    captured.push(info);
    next();
  };
  try {
    await run();
  } finally {
    transports.Console.prototype.log = original;
  }
  return captured;
}

describe('FanoutDispatcher email provider', () => {
  it('@AC-1 sendgrid mode sends one SendGrid email and never queues, even with commsgun configured', async () => {
    const f = stubFetch();
    const { dispatcher, commsgun } = provider('sendgrid');
    await dispatcher.dispatch(makeAlert());
    assert.equal(sendgridPosts(f).length, 1);
    assert.equal(commsgun.enqueued.length, 0);
    f.restore();
  });

  for (const [name, opts] of [
    ['the enqueue URL is empty', { str: { 'commsgun.enqueue_url': '' } }],
    ['the app id is empty', { str: { 'commsgun.app_id': '' } }],
    ['the recipient is empty', { str: { 'commsgun.to_email': '' } }],
    ['the app key is absent', { commsgun: { keyKind: 'absent' } }],
    ['GetSecret has never succeeded', { commsgun: { keyKind: 'unknown' } }],
  ] as const) {
    it(`@AC-2 @AC-19 @AC-33 auto behaves as sendgrid when ${name}`, async () => {
      const f = stubFetch();
      const { dispatcher, commsgun } = provider('auto', opts as any);
      await dispatcher.dispatch(makeAlert());
      assert.equal(sendgridPosts(f).length, 1);
      assert.equal(commsgun.enqueued.length, 0);
      f.restore();
    });
  }

  for (const mode of ['auto', 'mailgun', undefined]) {
    it(`@AC-3 @AC-4 mode ${mode} with commsgun ready queues the rendered email and sends nothing itself`, async () => {
      const reader = install();
      const f = stubFetch();
      const { dispatcher, commsgun } = provider(mode);
      await dispatcher.dispatch(makeAlert({ alertId: 'alert-338', context: { symbol: 'AAPL', conviction: 0.82 } }));
      assert.equal(f.calls.length, 0);
      assert.equal(commsgun.enqueued.length, 1);
      const queued = commsgun.enqueued[0];
      assert.equal(queued.alertId, 'alert-338');
      assert.equal(queued.recipient, RECIPIENT);
      assert.equal(queued.subject, '[ALERT_SEVERITY_WARNING] BUY AAPL');
      assert.ok(queued.text.includes('Symbol: AAPL') && queued.text.includes('Conviction: 0.82'));
      assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'queued'), 1);
      f.restore();
    });
  }

  it('@AC-25 commsgun mode queues on the base alone, without a key', async () => {
    const f = stubFetch();
    const { dispatcher, commsgun } = provider('commsgun', { commsgun: { keyKind: 'absent' } });
    await dispatcher.dispatch(makeAlert());
    assert.equal(commsgun.enqueued.length, 1);
    assert.equal(f.calls.length, 0);
    f.restore();
  });

  it('@AC-26 commsgun mode without the base queues nothing, sends nothing, and counts unconfigured', async () => {
    const reader = install();
    const f = stubFetch();
    const { dispatcher, commsgun } = provider('commsgun', { str: { 'commsgun.enqueue_url': '' } });
    for (const title of ['one', 'two', 'three']) await dispatcher.dispatch(makeAlert({ title }));
    assert.equal(commsgun.enqueued.length, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'unconfigured'), 3);
    f.restore();
  });

  for (const mode of ['sendgrid', 'auto', 'commsgun']) {
    it(`@AC-23 a commsgun-category alert is never emailed in mode ${mode}, and Slack still gets it`, async () => {
      const f = stubFetch();
      const { dispatcher, commsgun } = provider(mode, { slack: true });
      await dispatcher.dispatch(makeAlert({ category: 'commsgun', sourceService: 'xstockstrat-notify' }));
      assert.equal(sendgridPosts(f).length, 0);
      assert.equal(commsgun.enqueued.length, 0);
      assert.equal(f.calls.length, 1);
      assert.match(f.calls[0].url, /hooks\.slack\.test/);
      f.restore();
    });
  }

  it('@AC-40 a failed enqueue in auto is counted, logged once, and sent through SendGrid once', async () => {
    const reader = install();
    const f = stubFetch();
    const { dispatcher, commsgun } = provider('auto', { commsgun: { enqueue: 'reject' } });
    const logs = await withLogs(() => dispatcher.dispatch(makeAlert()));
    assert.equal(commsgun.enqueued.length, 1);
    assert.equal(sendgridPosts(f).length, 1);
    assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'enqueue_error'), 1);
    const warns = logs.filter((r) => r[Symbol.for('level')] === 'warn');
    assert.equal(warns.length, 1);
    assert.equal(warns[0].channel, 'commsgun');
    assert.equal(warns[0].alertId, 'alert-1');
    f.restore();
  });

  it('@AC-40 a failed enqueue in commsgun mode is counted and logged once, with no SendGrid email', async () => {
    const reader = install();
    const f = stubFetch();
    const { dispatcher } = provider('commsgun', { commsgun: { enqueue: 'reject' } });
    const logs = await withLogs(() => dispatcher.dispatch(makeAlert()));
    assert.equal(f.calls.length, 0);
    assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'enqueue_error'), 1);
    assert.equal(logs.filter((r) => r[Symbol.for('level')] === 'warn').length, 1);
    f.restore();
  });

  it('dedup precedes the insert: the same alert twice is queued once (020 @AC-5)', async () => {
    const f = stubFetch();
    const { dispatcher, commsgun } = provider('auto');
    await dispatcher.dispatch(makeAlert());
    await dispatcher.dispatch(makeAlert());
    assert.equal(commsgun.enqueued.length, 1);
    f.restore();
  });

  it('@AC-18 no log line carries the recipient, the title, the key or the URL', async () => {
    const f = stubFetch(500);
    const logs = await withLogs(async () => {
      for (const [mode, enqueue] of [['auto', 'reject'], ['commsgun', 'reject'], ['sendgrid', 'resolve']] as const) {
        const { dispatcher } = provider(mode, { commsgun: { enqueue } });
        await dispatcher.dispatch(makeAlert({ title: 'AAPL breakout' }));
      }
    });
    assert.ok(logs.length >= 3, 'the failure paths log');
    const dump = JSON.stringify(logs);
    for (const secret of [RECIPIENT, 'AAPL breakout', APP_KEY, ENQUEUE_URL]) {
      assert.ok(!dump.includes(secret), `leaked: ${secret}`);
    }
    f.restore();
  });
});
