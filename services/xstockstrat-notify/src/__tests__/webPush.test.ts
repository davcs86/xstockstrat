/**
 * Unit tests for WebPushDispatcher — the best-effort Web Push channel (feature 165).
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
import * as grpc from '@grpc/grpc-js';

import { WebPushDispatcher, PushAlert } from '../fanout/webPush.js';
import type { AdminDirectory } from '../services/adminDirectory.js';

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

// Admin directory fake: returns the next result per call (an Error rejects), recording each md.
function stubAdmins(...results: (string[] | Error)[]): {
  calls: (grpc.Metadata | undefined)[];
  obj: AdminDirectory;
} {
  const calls: (grpc.Metadata | undefined)[] = [];
  return {
    calls,
    obj: {
      listAdminUserIds(md) {
        calls.push(md);
        const r = results[calls.length - 1] ?? [];
        return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
      },
    },
  };
}

type Row = { subscription_id: string; endpoint: string; p256dh: string; auth: string };

// SQL-aware pool fake: answers only the targeted and admin-audience queries; any other subscription
// SELECT throws, so an unfiltered audience query can never pass silently.
function sqlPool(subsByUser: Record<string, Row[]>): {
  calls: { sql: string; params: any[] }[];
  obj: any;
} {
  const calls: { sql: string; params: any[] }[] = [];
  return {
    calls,
    obj: {
      async query(sql: string, params: any[] = []) {
        calls.push({ sql, params });
        const q = sql.replace(/\s+/g, ' ');
        if (/^\s*DELETE/i.test(q)) return { rows: [], rowCount: 1 };
        if (/WHERE user_id = \$1/.test(q)) return { rows: subsByUser[params[0]] ?? [] };
        if (/WHERE user_id = ANY\(\$1::text\[\]\)/.test(q)) {
          return { rows: (params[0] as string[]).flatMap((u) => subsByUser[u] ?? []) };
        }
        if (/FROM notify\.push_subscriptions/.test(q)) throw new Error('unfiltered audience query');
        return { rows: [] };
      },
    },
  };
}

// Givens from acceptance.feature: user-42 and user-77 are not admins; user-99 is.
const GIVENS: Record<string, Row[]> = {
  'user-42': [
    { subscription_id: 's1', endpoint: 'https://push.example/one', p256dh: 'k1', auth: 'a1' },
    { subscription_id: 's2', endpoint: 'https://push.example/two', p256dh: 'k2', auth: 'a2' },
  ],
  'user-77': [
    { subscription_id: 's3', endpoint: 'https://push.example/three', p256dh: 'k3', auth: 'a3' },
  ],
  'user-99': [
    { subscription_id: 's9', endpoint: 'https://push.example/admin', p256dh: 'k9', auth: 'a9' },
  ],
};

const RISK = {
  targetUserId: '',
  title: 'portfolio risk limit breach',
  body: 'concentration limit breach: LYFT at 24.1%',
};

function cfg(minSev = 2): any {
  return { getInt: (k: string, d: number) => (k === 'notify.push.min_severity' ? minSev : d) };
}

// A dispatcher whose network seam is stubbed: records each deliver(subscription, body) and can be
// told to throw a given error (e.g. { statusCode: 410 }) for the next/every send.
class StubbedDispatcher extends WebPushDispatcher {
  sent: { endpoint: string; payload: any }[] = [];
  throwErr: any = null;
  lookupErrors: Record<string, unknown>[] = [];
  protected async deliver(subscription: webpush.PushSubscription, body: string): Promise<void> {
    this.sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(body) });
    if (this.throwErr) throw this.throwErr;
  }
  protected logAdminLookupError(meta: Record<string, unknown>): void {
    this.lookupErrors.push(meta);
  }
}

function withVapid(subject: string, fn: () => Promise<void> | void): Promise<void> {
  const prev = {
    p: process.env.VAPID_PRIVATE_KEY,
    u: process.env.VAPID_PUBLIC_KEY,
    s: process.env.VAPID_SUBJECT,
  };
  process.env.VAPID_PRIVATE_KEY = VAPID.privateKey;
  process.env.VAPID_PUBLIC_KEY = VAPID.publicKey;
  process.env.VAPID_SUBJECT = subject;
  const restore = () => {
    prev.p === undefined
      ? delete process.env.VAPID_PRIVATE_KEY
      : (process.env.VAPID_PRIVATE_KEY = prev.p);
    prev.u === undefined
      ? delete process.env.VAPID_PUBLIC_KEY
      : (process.env.VAPID_PUBLIC_KEY = prev.u);
    prev.s === undefined ? delete process.env.VAPID_SUBJECT : (process.env.VAPID_SUBJECT = prev.s);
  };
  return Promise.resolve(fn()).finally(restore);
}

function withoutVapid(fn: () => Promise<void> | void): Promise<void> {
  const prev = {
    p: process.env.VAPID_PRIVATE_KEY,
    u: process.env.VAPID_PUBLIC_KEY,
    s: process.env.VAPID_SUBJECT,
  };
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_SUBJECT;
  const restore = () => {
    prev.p === undefined
      ? delete process.env.VAPID_PRIVATE_KEY
      : (process.env.VAPID_PRIVATE_KEY = prev.p);
    prev.u === undefined
      ? delete process.env.VAPID_PUBLIC_KEY
      : (process.env.VAPID_PUBLIC_KEY = prev.u);
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
      const d = new StubbedDispatcher(pool.obj as any, cfg(), stubAdmins().obj);
      await d.dispatch(alert({ severity: 'ALERT_SEVERITY_CRITICAL' }));
      assert.equal(d.sent.length, 0, 'no send when VAPID is absent');
      assert.equal(pool.calls.length, 0, 'not even a subscription query');
    });
  });

  it('AC-6/Decision 3: keys present but malformed subject → disabled (no per-send throw)', async () => {
    await withVapid('not-a-url', async () => {
      const pool = capturingPool(SUBS);
      const d = new StubbedDispatcher(pool.obj as any, cfg(), stubAdmins().obj);
      await d.dispatch(alert());
      assert.equal(d.sent.length, 0, 'malformed VAPID_SUBJECT disables the channel');
    });
  });

  it("AC-4 / @AC-2: pushes to exactly the target user's subscriptions, carrying title/body", async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const pool = sqlPool(GIVENS);
      const admins = stubAdmins(['user-99']);
      const d = new StubbedDispatcher(pool.obj as any, cfg(), admins.obj);
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
      const sent = d.sent.map((s) => s.endpoint);
      assert.ok(!sent.includes('https://push.example/three'), 'no push to another user');
      assert.ok(!sent.includes('https://push.example/admin'), 'no push to the admin');
      assert.equal(admins.calls.length, 0, 'a targeted alert never looks up admins');
    });
  });

  it("@AC-5: an untargeted alert is pushed only to admin-role users' subscriptions", async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const pool = sqlPool(GIVENS);
      const d = new StubbedDispatcher(pool.obj as any, cfg(), stubAdmins(['user-99']).obj);
      await d.dispatch(alert(RISK));
      assert.deepEqual(
        d.sent.map((s) => s.endpoint),
        ['https://push.example/admin'],
      );
      assert.equal(d.sent[0].payload.title, 'portfolio risk limit breach');
      assert.match(pool.calls[0].sql.replace(/\s+/g, ' '), /WHERE user_id = ANY\(\$1::text\[\]\)/);
      assert.deepEqual(pool.calls[0].params, [['user-99']]);
    });
  });

  it("@AC-1: an untargeted alert is not pushed to any non-admin user's devices", async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const pool = sqlPool(GIVENS);
      const d = new StubbedDispatcher(pool.obj as any, cfg(), stubAdmins(['user-99']).obj);
      await d.dispatch(alert(RISK));
      const sent = d.sent.map((s) => s.endpoint);
      for (const ep of [
        'https://push.example/one',
        'https://push.example/two',
        'https://push.example/three',
      ]) {
        assert.ok(!sent.includes(ep), `no push to non-admin endpoint ${ep}`);
      }
    });
  });

  it('@AC-1: an empty admin list sends nothing and queries no subscriptions', async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const pool = sqlPool(GIVENS);
      const d = new StubbedDispatcher(pool.obj as any, cfg(), stubAdmins([]).obj);
      await d.dispatch(alert(RISK));
      assert.equal(d.sent.length, 0);
      assert.equal(pool.calls.length, 0, 'no subscription query for an empty audience');
    });
  });

  it('@AC-8: the admin audience is re-resolved per untargeted alert (a demoted admin stops)', async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const pool = sqlPool(GIVENS);
      const d = new StubbedDispatcher(pool.obj as any, cfg(), stubAdmins(['user-99'], []).obj);
      await d.dispatch(alert(RISK));
      assert.deepEqual(
        d.sent.map((s) => s.endpoint),
        ['https://push.example/admin'],
      );
      await d.dispatch(alert(RISK));
      assert.equal(d.sent.length, 1, 'second dispatch after demotion sends nothing');
    });
  });

  for (const code of [14, 13]) {
    it(`@AC-11: admin lookup failure (code ${code}) resolves, sends nothing, logs one ERROR`, async () => {
      await withVapid('mailto:ops@xstockstrat.test', async () => {
        const pool = sqlPool(GIVENS);
        const err = Object.assign(new Error('unavailable'), { code });
        const d = new StubbedDispatcher(pool.obj as any, cfg(), stubAdmins(err).obj);
        await d.dispatch(alert(RISK)); // must resolve
        assert.equal(d.sent.length, 0, 'no push on lookup failure');
        assert.equal(pool.calls.length, 0, 'no subscription query on lookup failure');
        assert.equal(d.lookupErrors.length, 1, 'escalated once at ERROR');
        assert.equal(d.lookupErrors[0].code, code);
      });
    });
  }

  it('@AC-11: the lookup-failure ERROR is rate-limited to once per 60s window', async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      let t = 0;
      const fail = () => Object.assign(new Error('unavailable'), { code: 14 });
      const d = new StubbedDispatcher(
        sqlPool(GIVENS).obj as any,
        cfg(),
        stubAdmins(fail(), fail(), fail(), fail()).obj,
        () => t,
      );
      for (const at of [0, 30_000, 59_000]) {
        t = at;
        await d.dispatch(alert(RISK));
      }
      assert.equal(d.lookupErrors.length, 1, 'three failures inside 60s → one ERROR');
      t = 60_000;
      await d.dispatch(alert(RISK));
      assert.equal(d.lookupErrors.length, 2, 'a failure at 60s escalates again');
    });
  });

  it('AC-6/AC-7 @feature-165: VAPID absent or severity below the gate → no admin lookup', async () => {
    await withoutVapid(async () => {
      const admins = stubAdmins(['user-99']);
      const d = new StubbedDispatcher(sqlPool(GIVENS).obj as any, cfg(), admins.obj);
      await d.dispatch(alert({ ...RISK, severity: 'ALERT_SEVERITY_CRITICAL' }));
      assert.equal(admins.calls.length, 0, 'VAPID absent short-circuits before the lookup');
    });
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const admins = stubAdmins(['user-99']);
      const d = new StubbedDispatcher(sqlPool(GIVENS).obj as any, cfg(2), admins.obj);
      await d.dispatch(alert({ ...RISK, severity: 'ALERT_SEVERITY_INFO' }));
      assert.equal(admins.calls.length, 0, 'severity gate short-circuits before the lookup');
      assert.equal(d.sent.length, 0);
    });
  });

  it('passes the inbound metadata through to the admin lookup', async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const md = new grpc.Metadata();
      md.set('x-trace-id', 't-1');
      const admins = stubAdmins(['user-99']);
      const d = new StubbedDispatcher(sqlPool(GIVENS).obj as any, cfg(), admins.obj);
      await d.dispatch(alert(RISK), md);
      assert.equal(admins.calls.length, 1);
      assert.strictEqual(admins.calls[0], md);
    });
  });

  it('AC-7: min_severity gate suppresses INFO, allows WARNING', async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const pool = capturingPool(SUBS);
      const d = new StubbedDispatcher(pool.obj as any, cfg(2), stubAdmins().obj); // gate = WARNING
      await d.dispatch(alert({ severity: 'ALERT_SEVERITY_INFO' }));
      assert.equal(d.sent.length, 0, 'INFO below the gate is not pushed');
      await d.dispatch(alert({ severity: 'ALERT_SEVERITY_WARNING' }));
      assert.equal(d.sent.length, 2, 'WARNING at/above the gate is pushed');
    });
  });

  it('AC-8: a 410 Gone endpoint is pruned and does not throw', async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const pool = capturingPool([SUBS[0]]);
      const d = new StubbedDispatcher(pool.obj as any, cfg(), stubAdmins().obj);
      d.throwErr = { statusCode: 410 };
      await d.dispatch(alert()); // must resolve (no throw)
      const deletes = pool.calls.filter((c) => /^\s*DELETE/i.test(c.sql));
      assert.equal(deletes.length, 1, 'the gone subscription was pruned');
      assert.match(
        deletes[0].sql.replace(/\s+/g, ' '),
        /DELETE FROM notify\.push_subscriptions WHERE endpoint = \$1/,
      );
      assert.deepEqual(deletes[0].params, ['https://push.example/one']);
    });
  });

  it('feature 274: the prune log line names the subscription id, never the push endpoint URL', async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const pool = capturingPool([SUBS[0]]);
      const d = new StubbedDispatcher(pool.obj as any, cfg(), stubAdmins().obj);
      d.throwErr = { statusCode: 410 };
      const written: string[] = [];
      const original = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        written.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      try {
        await d.dispatch(alert());
      } finally {
        process.stdout.write = original;
      }
      const output = written.join('');
      assert.match(output, /pruned expired push subscription/);
      assert.ok(
        !output.includes(SUBS[0].endpoint),
        'the capability-bearing endpoint URL was logged',
      );
      assert.ok(output.includes(SUBS[0].subscription_id), 'the subscription id is logged instead');
    });
  });

  it('AC-5: a non-Gone send error is caught (no throw, no prune)', async () => {
    await withVapid('mailto:ops@xstockstrat.test', async () => {
      const pool = capturingPool([SUBS[0]]);
      const d = new StubbedDispatcher(pool.obj as any, cfg(), stubAdmins().obj);
      d.throwErr = new Error('network down'); // no statusCode
      await d.dispatch(alert()); // must resolve
      const deletes = pool.calls.filter((c) => /^\s*DELETE/i.test(c.sql));
      assert.equal(deletes.length, 0, 'a transient error must not prune the subscription');
    });
  });
});

// A dispatcher that exposes the protected network seam so the REAL send options can be asserted.
class ExposedDispatcher extends WebPushDispatcher {
  public deliverPublic(sub: webpush.PushSubscription, body: string): Promise<void> {
    return this.deliver(sub, body);
  }
}

describe('WebPushDispatcher.deliver — send options (defect 2026-09-03)', () => {
  it('sends a deliberate 1h message TTL and a real socket timeout, not the old 10s TTL', async () => {
    const pool = capturingPool();
    const d = new ExposedDispatcher(pool.obj as any, cfg(), stubAdmins().obj);
    let opts: any = null;
    const orig = webpush.sendNotification;
    (webpush as any).sendNotification = async (_sub: any, _body: any, options: any) => {
      opts = options;
      return { statusCode: 201 } as any;
    };
    try {
      await d.deliverPublic(
        { endpoint: 'https://push.example/x', keys: { p256dh: 'k', auth: 'a' } },
        '{"t":1}',
      );
    } finally {
      (webpush as any).sendNotification = orig;
    }
    // Regression: the old code passed the 10s HTTP-timeout value as the TTL (=> TTL 10), silently
    // dropping every alert to a device offline >10s. The TTL must now be the deliberate 3600s.
    assert.equal(
      opts.TTL,
      3600,
      'push message TTL must be the deliberate 1h value, not the old 10s',
    );
    // And a real socket send timeout must be set (separate concern from the retention TTL).
    assert.equal(typeof opts.timeout, 'number', 'a real send timeout must be passed');
    assert.ok(opts.timeout >= 1000, 'the send timeout must be a sane socket timeout');
  });
});
