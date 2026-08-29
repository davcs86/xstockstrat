/**
 * Unit tests for WebPushDispatcher — the best-effort Web Push channel (feature 162).
 *
 * Runs compile-first (`tsc && node --test dist/__tests__/*.test.js`) with a STATIC import and a hard
 * "import succeeded" assertion (feature-074 zero-assertion trap guard — same posture as the notify
 * fanout suite). The outbound network send (`web-push`) is stubbed by overriding the protected
 * `deliver` seam, so the gate, subscription query, and 404/410 prune logic all run for real; a real
 * VAPID keypair is generated so `webpush.setVapidDetails` (which validates key format) succeeds.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';

import { WebPushDispatcher, PushAlert } from '../fanout/webPush.js';

// ---------------------------------------------------------------------------
// Harness — the import must succeed, never silently skip (074 guard)
// ---------------------------------------------------------------------------

describe('webpush test harness', () => {
  it('imports the dispatcher under test', () => {
    assert.ok(WebPushDispatcher, 'WebPushDispatcher import must succeed — never skip silently');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VAPID = webpush.generateVAPIDKeys(); // real, format-valid keys

// A pool fake recording every query(sql, params). `rows` is the SELECT result.
function capturingPool(rows: any[] = []): { calls: { sql: string; params: any[] }[]; obj: any } {
  const calls: { sql: string; params: any[] }[] = [];
  return {
    calls,
    obj: {
      async query(sql: string, params: any[] = []) {
        calls.push({ sql, params });
        // Only SELECTs return subscription rows; DELETE returns nothing meaningful here.
        return /^\s*SELECT/i.test(sql) ? { rows } : { rows: [], rowCount: 1 };
      },
    },
  };
}

function cfg(minSev = 2): any {
  return { getInt: (k: string, d: number) => (k === 'notify.push.min_severity' ? minSev : d) };
}

// A dispatcher whose network seam is stubbed: records each deliver(subscription, body) and can be
// told to throw a given error (e.g. { statusCode: 410 }) for the next/every send.
class StubbedDispatcher extends WebPushDispatcher {
  sent: { endpoint: string; payload: any }[] = [];
  throwErr: any = null;
  protected async deliver(subscription: webpush.PushSubscription, body: string): Promise<void> {
    this.sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(body) });
    if (this.throwErr) throw this.throwErr;
  }
}

function withVapid(subject: string, fn: () => Promise<void> | void): Promise<void> {
  const prev = { p: process.env.VAPID_PRIVATE_KEY, u: process.env.VAPID_PUBLIC_KEY, s: process.env.VAPID_SUBJECT };
  process.env.VAPID_PRIVATE_KEY = VAPID.privateKey;
  process.env.VAPID_PUBLIC_KEY = VAPID.publicKey;
  process.env.VAPID_SUBJECT = subject;
  const restore = () => {
    prev.p === undefined ? delete process.env.VAPID_PRIVATE_KEY : (process.env.VAPID_PRIVATE_KEY = prev.p);
    prev.u === undefined ? delete process.env.VAPID_PUBLIC_KEY : (process.env.VAPID_PUBLIC_KEY = prev.u);
    prev.s === undefined ? delete process.env.VAPID_SUBJECT : (process.env.VAPID_SUBJECT = prev.s);
  };
  return Promise.resolve(fn()).finally(restore);
}

function withoutVapid(fn: () => Promise<void> | void): Promise<void> {
  const prev = { p: process.env.VAPID_PRIVATE_KEY, u: process.env.VAPID_PUBLIC_KEY, s: process.env.VAPID_SUBJECT };
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_SUBJECT;
  const restore = () => {
    prev.p === undefined ? delete process.env.VAPID_PRIVATE_KEY : (process.env.VAPID_PRIVATE_KEY = prev.p);
    prev.u === undefined ? delete process.env.VAPID_PUBLIC_KEY : (process.env.VAPID_PUBLIC_KEY = prev.u);
    prev.s === undefined ? delete process.env.VAPID_SUBJECT : (process.env.VAPID_SUBJECT = prev.s);
  };
  return Promise.resolve(fn()).finally(restore);
}

function alert(over: Partial<PushAlert> = {}): PushAlert {
  return {
    alertId: 'a1',
    severity: 'ALERT_SEVERITY_WARNING',
    category: 'trading',
    title: 'Order filled',
    body: 'AAPL 10 @ 190.00',
    targetUserId: 'user-42',
    ...over,
  };
}

const SUBS = [
  { subscription_id: 's1', endpoint: 'https://push.example/one', p256dh: 'k1', auth: 'a1' },
  { subscription_id: 's2', endpoint: 'https://push.example/two', p256dh: 'k2', auth: 'a2' },
];

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe('WebPushDispatcher.dispatch', () => {
  it('AC-6: no VAPID env → channel disabled, no send, no throw', async () => {
    await withoutVapid(async () => {
      const pool = capturingPool(SUBS);
      const d = new StubbedDispatcher(pool.obj as any, cfg());
      await d.dispatch(alert({ severity: 'ALERT_SEVERITY_CRITICAL' }));
      assert.equal(d.sent.length, 0, 'no send when VAPID is absent');
      assert.equal(pool.calls.length, 0, 'not even a subscription query');
    });
  });

  it('AC-6/Decision 3: keys present but malformed subject → disabled (no per-send throw)', async () => {
    await withVapid('not-a-url', async () => {
      const pool = capturingPool(SUBS);
      const d = new StubbedDispatcher(pool.obj as any, cfg());
      await d.dispatch(alert());
      assert.equal(d.sent.length, 0, 'malformed VAPID_SUBJECT disables the channel');
    });
  });

  it('AC-4: pushes to every subscription of the target user, carrying title/body', async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const pool = capturingPool(SUBS);
      const d = new StubbedDispatcher(pool.obj as any, cfg());
      await d.dispatch(alert());
      assert.equal(d.sent.length, 2, 'one send per subscription');
      assert.deepEqual(d.sent.map((s) => s.endpoint).sort(), [
        'https://push.example/one',
        'https://push.example/two',
      ]);
      assert.equal(d.sent[0].payload.title, 'Order filled');
      assert.equal(d.sent[0].payload.body, 'AAPL 10 @ 190.00');
      // Targeted query used the user id.
      assert.match(pool.calls[0].sql.replace(/\s+/g, ' '), /WHERE user_id = \$1/);
      assert.deepEqual(pool.calls[0].params, ['user-42']);
    });
  });

  it('AC-4: broadcast (empty targetUserId) queries all subscriptions', async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const pool = capturingPool(SUBS);
      const d = new StubbedDispatcher(pool.obj as any, cfg());
      await d.dispatch(alert({ targetUserId: '' }));
      assert.equal(d.sent.length, 2);
      assert.doesNotMatch(pool.calls[0].sql, /WHERE user_id/, 'broadcast selects all rows');
    });
  });

  it('AC-7: min_severity gate suppresses INFO, allows WARNING', async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const pool = capturingPool(SUBS);
      const d = new StubbedDispatcher(pool.obj as any, cfg(2)); // gate = WARNING
      await d.dispatch(alert({ severity: 'ALERT_SEVERITY_INFO' }));
      assert.equal(d.sent.length, 0, 'INFO below the gate is not pushed');
      await d.dispatch(alert({ severity: 'ALERT_SEVERITY_WARNING' }));
      assert.equal(d.sent.length, 2, 'WARNING at/above the gate is pushed');
    });
  });

  it('AC-8: a 410 Gone endpoint is pruned and does not throw', async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const pool = capturingPool([SUBS[0]]);
      const d = new StubbedDispatcher(pool.obj as any, cfg());
      d.throwErr = { statusCode: 410 };
      await d.dispatch(alert()); // must resolve (no throw)
      const deletes = pool.calls.filter((c) => /^\s*DELETE/i.test(c.sql));
      assert.equal(deletes.length, 1, 'the gone subscription was pruned');
      assert.match(deletes[0].sql.replace(/\s+/g, ' '), /DELETE FROM notify\.push_subscriptions WHERE endpoint = \$1/);
      assert.deepEqual(deletes[0].params, ['https://push.example/one']);
    });
  });

  it('AC-5: a non-Gone send error is caught (no throw, no prune)', async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const pool = capturingPool([SUBS[0]]);
      const d = new StubbedDispatcher(pool.obj as any, cfg());
      d.throwErr = new Error('network down'); // no statusCode
      await d.dispatch(alert()); // must resolve
      const deletes = pool.calls.filter((c) => /^\s*DELETE/i.test(c.sql));
      assert.equal(deletes.length, 0, 'a transient error must not prune the subscription');
    });
  });
});
