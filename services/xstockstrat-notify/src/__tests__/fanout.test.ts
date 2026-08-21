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

import { FanoutDispatcher } from '../fanout/fanout.js';

// ── Harness: import must succeed, never silently skip (074 guard) ─────────────
describe('fanout test harness', () => {
  it('imports FanoutDispatcher', () => {
    assert.ok(FanoutDispatcher, 'FanoutDispatcher import must succeed');
  });
});

// ── Fakes ─────────────────────────────────────────────────────────────────────

type Cfg = { int?: Record<string, number>; float?: Record<string, number>; str?: Record<string, string> };

function fakeConfig(cfg: Cfg = {}): any {
  return {
    getInt: (k: string, d: number) => cfg.int?.[k] ?? d,
    getFloat: (k: string, d: number) => cfg.float?.[k] ?? d,
    getString: (k: string, d = '') => cfg.str?.[k] ?? d,
  };
}

interface FetchCall {
  url: string;
  init: any;
}

function stubFetch(status = 200): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return { ok: status >= 200 && status < 300, status } as any;
  }) as any;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Construct a dispatcher with the given credential env, then clear the env (constructor read once). */
function makeDispatcher(env: { slack?: string; sendgrid?: string }, cfg: Cfg): FanoutDispatcher {
  const prevSlack = process.env.SLACK_WEBHOOK_URL;
  const prevSg = process.env.SENDGRID_API_KEY;
  if (env.slack) process.env.SLACK_WEBHOOK_URL = env.slack; else delete process.env.SLACK_WEBHOOK_URL;
  if (env.sendgrid) process.env.SENDGRID_API_KEY = env.sendgrid; else delete process.env.SENDGRID_API_KEY;
  const d = new FanoutDispatcher(fakeConfig(cfg));
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

const GATE = { int: { 'notify.fanout.min_severity': 2 }, float: { 'notify.fanout.min_confidence_threshold': 0.7 } };

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
      { ...GATE, str: { 'notify.fanout.sendgrid_from_email': 'a@x.co', 'notify.fanout.sendgrid_to_email': 'b@x.co' } },
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
      { ...GATE, str: { 'notify.fanout.sendgrid_from_email': 'a@x.co', 'notify.fanout.sendgrid_to_email': '' } },
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
      { int: { 'notify.fanout.min_severity': 2, 'notify.fanout.dedup_window_seconds': 300 } },
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
