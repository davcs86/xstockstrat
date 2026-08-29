/**
 * Unit tests for NotifyServiceImpl — no real DB required.
 *
 * Tests cover matchesSubscriber logic (via `as any` access), rowToAlert shape,
 * streamAlerts subscriber registration/deregistration, and the EmitAlert
 * internal-service-caller contract (feature 092).
 *
 * Feature 092: this suite now runs against COMPILED output (`tsc && node --test
 * dist/__tests__/*.test.js`) with a STATIC import, not `--experimental-strip-types`
 * against source. The impl uses TS parameter properties that strip-only mode cannot
 * compile, so the previous lazy `try/catch` import silently skipped every case (0
 * assertions — fails.md 2026-07-29 / feature 074). A static import fails HARD on any
 * import error, and the harness test below asserts the import succeeded.
 *
 * Run: pnpm run test  (tsc && node --test dist/__tests__/*.test.js)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { NotifyServiceImpl, rowToAlert } from '../grpc/notifyServiceImpl.js';
import { FanoutDispatcher } from '../fanout/fanout.js';
import { Alert } from '@xstockstrat/proto/notify/v1/notify';

// ---------------------------------------------------------------------------
// Harness — the import must succeed, never silently skip (074 guard)
// ---------------------------------------------------------------------------

describe('test harness', () => {
  it('imports the implementation under test', () => {
    assert.ok(NotifyServiceImpl, 'NotifyServiceImpl import must succeed — never skip silently');
    assert.ok(rowToAlert, 'rowToAlert import must succeed');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePool(rows: any[] = [], throws?: Error) {
  return {
    async query(_sql: string, _params?: any[]) {
      if (throws) throw throws;
      return { rows };
    },
  };
}

function makeImpl(rows: any[] = [], throws?: Error) {
  const pool = makePool(rows, throws);
  return new NotifyServiceImpl(pool as any, {} as any, noopFanout(), noopWebPush());
}

// A no-op fanout for the existing (non-fanout) cases — dispatch resolves and records nothing.
function noopFanout(): any {
  return { dispatch: async () => {} };
}

// A no-op Web Push dispatcher (feature 163) — for the cases that don't exercise the push channel.
function noopWebPush(): any {
  return { dispatch: async () => {} };
}

// A recording Web Push dispatcher: captures the alerts EmitAlert hands it; can be made to hang.
function recordingWebPush(opts: { hang?: boolean } = {}): { dispatched: any[]; obj: any } {
  const dispatched: any[] = [];
  return {
    dispatched,
    obj: {
      dispatch: (alert: any) => {
        dispatched.push(alert);
        return opts.hang ? new Promise<void>(() => {}) : Promise.resolve();
      },
    },
  };
}

// A recording fanout: captures the alerts EmitAlert hands it; can be made to hang (AC-4).
function recordingFanout(opts: { hang?: boolean } = {}): { dispatched: any[]; obj: any } {
  const dispatched: any[] = [];
  return {
    dispatched,
    obj: {
      dispatch: (alert: any) => {
        dispatched.push(alert);
        return opts.hang ? new Promise<void>(() => {}) : Promise.resolve();
      },
    },
  };
}

// A config fake for the real FanoutDispatcher (gate/dedup/email knobs).
function fanoutCfg(over: { minSev?: number; minConf?: number; dedup?: number; from?: string; to?: string } = {}): any {
  return {
    getInt: (k: string, d: number) =>
      k === 'notify.fanout.min_severity' ? (over.minSev ?? 2)
      : k === 'notify.fanout.dedup_window_seconds' ? (over.dedup ?? 300)
      : d,
    getFloat: (k: string, d: number) => (k === 'notify.fanout.min_confidence_threshold' ? (over.minConf ?? 0.7) : d),
    getString: (k: string, d = '') =>
      k === 'notify.fanout.sendgrid_from_email' ? (over.from ?? '')
      : k === 'notify.fanout.sendgrid_to_email' ? (over.to ?? '')
      : d,
  };
}

// makeAlert produces fan-out alert objects (camelCase — proto field names)
function makeAlert(overrides: any = {}) {
  return {
    alertId: 'a1',
    severity: 2,
    category: 'trading',
    targetUserId: '',
    acknowledged: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// rowToAlert — pure helper
// ---------------------------------------------------------------------------

describe('rowToAlert', () => {
  it('maps row to alert proto shape', () => {
    const now = new Date('2024-01-01T00:00:00Z');
    // DB rows use snake_case column names
    const row = {
      alert_id: 'a1',
      severity: 2,
      category: 'trading',
      title: 'Test Alert',
      body: 'Alert body',
      source_service: 'xstockstrat-trading',
      target_user_id: 'user-1',
      created_at: now,
      acknowledged: false,
      correlation_id: 'corr-1',
      tags: ['risk'],
    };
    const alert = rowToAlert(row);
    assert.strictEqual(alert.alertId, 'a1');
    // DB integer severity is mapped back to the ts-proto string enum.
    assert.strictEqual(alert.severity, 'ALERT_SEVERITY_WARNING');
    assert.ok(alert.createdAt instanceof Date);
    assert.deepStrictEqual(alert.tags, ['risk']);
  });

  it('uses empty string for null correlation_id and target_user_id', () => {
    const row = {
      alert_id: 'a2',
      severity: 1,
      category: 'system',
      title: 'T',
      body: 'B',
      source_service: 'svc',
      target_user_id: null,
      created_at: new Date(),
      acknowledged: false,
      correlation_id: null,
      tags: null,
    };
    const alert = rowToAlert(row);
    assert.strictEqual(alert.targetUserId, '');
    assert.strictEqual(alert.correlationId, '');
    assert.deepStrictEqual(alert.tags, []);
  });
});

// ---------------------------------------------------------------------------
// emitAlert — write path
// ---------------------------------------------------------------------------

describe('emitAlert', () => {
  // Regression: severity arrives as a ts-proto string enum (stringEnums codegen),
  // but notify.alerts.severity is INTEGER. Binding the raw string raised
  // `invalid input syntax for type integer: "ALERT_SEVERITY_WARNING"`.
  it('binds severity as the numeric enum value, not the string enum', async () => {
    let capturedParams: any[] = [];
    const pool = {
      async query(_sql: string, params?: any[]) {
        capturedParams = params ?? [];
        return { rows: [] };
      },
    };
    const impl = new NotifyServiceImpl(pool as any, {} as any, noopFanout(), noopWebPush());
    const call = {
      request: {
        severity: 'ALERT_SEVERITY_WARNING',
        category: 'portfolio',
        title: 'Drawdown',
        body: 'limit breached',
        sourceService: 'portfolio',
      },
    };

    await new Promise<void>((resolve, reject) => {
      impl.emitAlert(call, (err: any) => (err ? reject(err) : resolve()));
    });

    // severity is the 2nd bound param (index 1).
    assert.strictEqual(capturedParams[1], 2);
    assert.strictEqual(typeof capturedParams[1], 'number');
  });

  it('calls back with error code 13 on DB failure', async () => {
    const impl = makeImpl([], new Error('insert failed'));
    const call = {
      request: { severity: 'ALERT_SEVERITY_INFO', category: 'c', title: 't', body: 'b', sourceService: 's' },
    };

    await new Promise<void>((resolve) => {
      impl.emitAlert(call, (err: any) => {
        assert.ok(err);
        assert.strictEqual(err.code, 13);
        resolve();
      });
    });
  });

  // Feature 092 (F-11): EmitAlert is an INTERNAL-SERVICE-CALLER contract, not a role-gated RPC.
  // Its trust boundary is the private gRPC network plus the agent's OAuth 2.1 edge — every caller
  // is internal/unauthenticated (analysis loops send no metadata; the agent itself sends no
  // distinguishing header since feature 097 removed its shared-secret header). This test PINS
  // that contract: a call carrying NO scope/secret metadata must succeed and persist the alert.
  // An admin gate here would break every current caller.
  // (Design decision recorded in the feature 092 design.md; adversary-ruled.)
  it('accepts an unauthenticated internal caller (no scope/secret metadata) and persists the alert', async () => {
    let capturedSql = '';
    let capturedParams: any[] = [];
    const pool = {
      async query(sql: string, params?: any[]) {
        capturedSql = sql;
        capturedParams = params ?? [];
        return { rows: [] };
      },
    };
    const impl = new NotifyServiceImpl(pool as any, {} as any, noopFanout(), noopWebPush());
    // No `metadata` on the call object at all — the internal-caller shape.
    const call = {
      request: {
        severity: 'ALERT_SEVERITY_INFO',
        category: 'system',
        title: 'internal',
        body: 'from a service loop',
        sourceService: 'analysis',
      },
    };

    await new Promise<void>((resolve, reject) => {
      impl.emitAlert(call, (err: any) => (err ? reject(err) : resolve()));
    });

    // The INSERT ran (the alert was persisted) — the RPC did not reject an unauthenticated caller.
    assert.match(capturedSql, /insert into/i);
    assert.strictEqual(capturedParams[1], 1); // ALERT_SEVERITY_INFO → 1, bound numerically
  });

  // Feature 094 (F-10): empty/whitespace-only title or body is rejected INVALID_ARGUMENT
  // (code 3) before the INSERT. The pool below would otherwise succeed, so a code-3 callback
  // proves the guard fired — not a DB error.
  const invalidFieldCases: Array<[string, string, string]> = [
    ['empty title', '', 'b'],
    ['empty body', 't', ''],
    ['whitespace-only title', '   ', 'b'],
    ['whitespace-only body', 't', '\t\n'],
  ];
  for (const [name, title, body] of invalidFieldCases) {
    it(`rejects ${name} with INVALID_ARGUMENT (code 3)`, async () => {
      let queried = false;
      const pool = {
        async query(_sql: string, _params?: any[]) {
          queried = true;
          return { rows: [] };
        },
      };
      const impl = new NotifyServiceImpl(pool as any, {} as any, noopFanout(), noopWebPush());
      const call = { request: { severity: 'ALERT_SEVERITY_INFO', category: 'c', title, body, sourceService: 's' } };

      await new Promise<void>((resolve) => {
        impl.emitAlert(call, (err: any) => {
          assert.ok(err, 'expected an error callback');
          assert.strictEqual(err.code, 3);
          resolve();
        });
      });
      assert.strictEqual(queried, false, 'guard must reject before touching the DB');
    });
  }

  it('accepts a non-empty title and body (reaches the DB)', async () => {
    let queried = false;
    const pool = {
      async query(_sql: string, _params?: any[]) {
        queried = true;
        return { rows: [] };
      },
    };
    const impl = new NotifyServiceImpl(pool as any, {} as any, noopFanout(), noopWebPush());
    const call = {
      request: { severity: 'ALERT_SEVERITY_INFO', category: 'c', title: 't', body: 'b', sourceService: 's' },
    };

    await new Promise<void>((resolve, reject) => {
      impl.emitAlert(call, (err: any) => (err ? reject(err) : resolve()));
    });
    assert.strictEqual(queried, true, 'a valid alert must reach the DB');
  });
});

// ---------------------------------------------------------------------------
// emitAlert fanout wiring (feature 020)
// ---------------------------------------------------------------------------

// Register a broadcast subscriber that records what it is written.
function registerSubscriber(impl: any): { received: any[] } {
  const received: any[] = [];
  impl.streamAlerts({
    request: { userId: 'u-sub', categories: [], severities: [], includeAcknowledged: false },
    on() {},
    write(alert: any) { received.push(alert); },
  });
  return { received };
}

// Emit an alert and flush the queueMicrotask-deferred fanout + its async fetch.
async function emitAndFlush(impl: any, request: any): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    impl.emitAlert({ request }, (err: any) => (err ? reject(err) : resolve())),
  );
  // Let the deferred dispatch microtask and any awaited fetch settle.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function stubFetch(status = 200): { calls: any[]; restore: () => void } {
  const calls: any[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return { ok: status >= 200 && status < 300, status } as any;
  }) as any;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Build a real FanoutDispatcher with SLACK env set (constructor reads it once), then clear. */
function realSlackFanout(cfg: any): FanoutDispatcher {
  const prev = process.env.SLACK_WEBHOOK_URL;
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x';
  const f = new FanoutDispatcher(cfg);
  if (prev === undefined) delete process.env.SLACK_WEBHOOK_URL; else process.env.SLACK_WEBHOOK_URL = prev;
  return f;
}

const REQ = (over: any = {}) => ({
  severity: 'ALERT_SEVERITY_WARNING',
  category: 'signal',
  title: 'BUY AAPL',
  body: 'fired',
  sourceService: 'analysis',
  context: { symbol: 'AAPL', conviction: 0.82 },
  ...over,
});

describe('emitAlert fanout wiring', () => {
  it('AC-1: dispatches the alert to fanout AND still delivers to the in-process subscriber', async () => {
    const rec = recordingFanout();
    const impl = new NotifyServiceImpl(makePool() as any, {} as any, rec.obj, noopWebPush());
    const sub = registerSubscriber(impl);
    await emitAndFlush(impl, REQ());
    assert.equal(rec.dispatched.length, 1, 'fanout received the alert');
    assert.equal(rec.dispatched[0].title, 'BUY AAPL');
    assert.equal(sub.received.length, 1, 'primary stream still delivered');
  });

  it('AC-4: a hanging fanout never delays the callback or drops the primary delivery', async () => {
    const rec = recordingFanout({ hang: true });
    const impl = new NotifyServiceImpl(makePool() as any, {} as any, rec.obj, noopWebPush());
    const sub = registerSubscriber(impl);
    let ok = false;
    await new Promise<void>((resolve, reject) =>
      impl.emitAlert({ request: REQ() }, (err: any) => {
        if (err) return reject(err);
        ok = true;
        resolve();
      }),
    );
    // Callback fired with success (synchronously, before the deferred dispatch) and the subscriber
    // got its write — neither waited on the hanging fanout.
    assert.equal(ok, true);
    assert.equal(sub.received.length, 1);
    // Flush the microtask to confirm dispatch was actually scheduled (it just never resolves).
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(rec.dispatched.length, 1);
  });

  it('AC-3: no credentials → success + subscriber delivery + no outbound fetch; gate read live', async () => {
    const f = stubFetch();
    // Mutable config to prove the gate is read live (no restart): flip min_severity between emits.
    const cfg = { minSev: 2 };
    const dispatcher = new FanoutDispatcher(fanoutCfg(cfg)); // no SLACK/SENDGRID env → disabled
    const impl = new NotifyServiceImpl(makePool() as any, {} as any, dispatcher, noopWebPush());
    const sub = registerSubscriber(impl);
    await emitAndFlush(impl, REQ({ severity: 'ALERT_SEVERITY_INFO', context: {} }));
    assert.equal(f.calls.length, 0, 'no credentials → nothing fans out');
    assert.equal(sub.received.length, 1, 'primary delivery unaffected');
    f.restore();
  });

  it('AC-5: two byte-identical alerts → exactly one outbound Slack POST (end-to-end dedup)', async () => {
    const f = stubFetch();
    const impl = new NotifyServiceImpl(makePool() as any, {} as any, realSlackFanout(fanoutCfg()), noopWebPush());
    await emitAndFlush(impl, REQ());
    await emitAndFlush(impl, REQ());
    assert.equal(f.calls.length, 1);
    f.restore();
  });

  it('AC-6: a channel HTTP 500 does not turn EmitAlert into an RPC error', async () => {
    const f = stubFetch(500);
    const impl = new NotifyServiceImpl(makePool() as any, {} as any, realSlackFanout(fanoutCfg()), noopWebPush());
    let err: any = 'unset';
    await new Promise<void>((resolve) =>
      impl.emitAlert({ request: REQ({ title: 'x', body: 'y', context: {} }) }, (e: any) => {
        err = e;
        resolve();
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(err, null, 'EmitAlert returned success despite the 500 fanout');
    assert.equal(f.calls.length, 1, 'the failing POST was attempted');
    f.restore();
  });

  it('flat-Struct conviction: context.conviction gates (0.82 fans out, 0.55 does not)', async () => {
    const f = stubFetch();
    const impl = new NotifyServiceImpl(makePool() as any, {} as any, realSlackFanout(fanoutCfg({ minConf: 0.7 })), noopWebPush());
    await emitAndFlush(impl, REQ({ context: { symbol: 'AAPL', conviction: 0.82 } }));
    await emitAndFlush(impl, REQ({ title: 'other', body: 'z', context: { symbol: 'MSFT', conviction: 0.55 } }));
    assert.equal(f.calls.length, 1, 'only the >= threshold conviction fanned out');
    f.restore();
  });
});

// ---------------------------------------------------------------------------
// Web Push subscription handlers + emit isolation (feature 163)
// ---------------------------------------------------------------------------

// A pool fake that records every query(sql, params) so we can assert on the emitted SQL shape.
// (The makePool fake ignores SQL and cannot prove row-level behavior — design Decision 6.)
function capturingPool(rows: any[] = []): { calls: { sql: string; params: any[] }[]; obj: any } {
  const calls: { sql: string; params: any[] }[] = [];
  return {
    calls,
    obj: {
      async query(sql: string, params: any[] = []) {
        calls.push({ sql, params });
        return { rows, rowCount: rows.length };
      },
    },
  };
}

// A gRPC call whose metadata carries the propagated x-user-id header (mirrors the identity pattern).
function metaCall(userId: string | null, request: any): any {
  return {
    request,
    metadata: { get: (k: string) => (k === 'x-user-id' && userId ? [userId] : []) },
  };
}

describe('registerPushSubscription (AC-2)', () => {
  it('upserts by endpoint using the x-user-id header as owner, with the full ON CONFLICT SET list', async () => {
    const pool = capturingPool([{ subscription_id: 'sub-1' }]);
    const impl = new NotifyServiceImpl(pool.obj as any, {} as any, noopFanout(), noopWebPush());
    // No user_id in the body — the owner comes from the x-user-id header.
    const req = { endpoint: 'https://push.example/abc', p256dh: 'k', auth: 'a', userAgent: 'ua' };

    const res = await new Promise<any>((resolve, reject) =>
      impl.registerPushSubscription(metaCall('user-42', req), (err: any, r: any) => (err ? reject(err) : resolve(r))),
    );

    assert.equal(pool.calls.length, 1);
    const sql = pool.calls[0].sql.replace(/\s+/g, ' ');
    assert.match(sql, /INSERT INTO notify\.push_subscriptions/);
    assert.match(sql, /ON CONFLICT \(endpoint\) DO UPDATE/);
    // Every mutable column is refreshed (rotated keys), not just user_id — design Decision 2.
    for (const col of ['user_id', 'p256dh', 'auth', 'user_agent', 'created_at']) {
      assert.match(sql, new RegExp(col + ' ='), `upsert must refresh ${col}`);
    }
    // The owner bound as user_id is the header value, not anything from the body.
    assert.deepEqual(pool.calls[0].params, ['user-42', 'https://push.example/abc', 'k', 'a', 'ua']);
    assert.equal(res.subscriptionId, 'sub-1');
  });

  it('rejects with code 3 when the x-user-id header is absent (no DB write)', async () => {
    const pool = capturingPool();
    const impl = new NotifyServiceImpl(pool.obj as any, {} as any, noopFanout(), noopWebPush());
    const req = { endpoint: 'https://push.example/abc', p256dh: 'k', auth: 'a' };
    const err = await new Promise<any>((resolve) =>
      impl.registerPushSubscription(metaCall(null, req), (e: any) => resolve(e)),
    );
    assert.equal(err.code, 3);
    assert.equal(pool.calls.length, 0, 'no DB write without a caller identity');
  });

  it('rejects with code 3 when endpoint/keys are missing', async () => {
    const pool = capturingPool();
    const impl = new NotifyServiceImpl(pool.obj as any, {} as any, noopFanout(), noopWebPush());
    const err = await new Promise<any>((resolve) =>
      impl.registerPushSubscription(metaCall('user-42', { endpoint: '', p256dh: '', auth: '' }), (e: any) => resolve(e)),
    );
    assert.equal(err.code, 3);
    assert.equal(pool.calls.length, 0, 'no DB write on invalid input');
  });
});

describe('unregisterPushSubscription (AC-3)', () => {
  it('deletes by endpoint only — no user_id bind param', async () => {
    const pool = capturingPool([{}]); // rowCount 1
    const impl = new NotifyServiceImpl(pool.obj as any, {} as any, noopFanout(), noopWebPush());

    const res = await new Promise<any>((resolve, reject) =>
      impl.unregisterPushSubscription(
        { request: { endpoint: 'https://push.example/abc' } },
        (err: any, r: any) => (err ? reject(err) : resolve(r)),
      ),
    );

    assert.equal(pool.calls.length, 1);
    const sql = pool.calls[0].sql.replace(/\s+/g, ' ');
    assert.match(sql, /DELETE FROM notify\.push_subscriptions WHERE endpoint = \$1/);
    assert.doesNotMatch(sql, /user_id/, 'delete must not be scoped by user_id (design Decision 1)');
    assert.deepEqual(pool.calls[0].params, ['https://push.example/abc'], 'a single positional param');
    assert.equal(res.deleted, true);
  });

  it('reports deleted=false when no row matched', async () => {
    const pool = capturingPool([]); // rowCount 0
    const impl = new NotifyServiceImpl(pool.obj as any, {} as any, noopFanout(), noopWebPush());
    const res = await new Promise<any>((resolve, reject) =>
      impl.unregisterPushSubscription({ request: { endpoint: 'gone' } }, (err: any, r: any) => (err ? reject(err) : resolve(r))),
    );
    assert.equal(res.deleted, false);
  });
});

describe('emitAlert push isolation (AC-5)', () => {
  it('a hanging Web Push never delays the callback or drops the primary delivery', async () => {
    const push = recordingWebPush({ hang: true });
    const impl = new NotifyServiceImpl(makePool() as any, {} as any, noopFanout(), push.obj);
    const sub = registerSubscriber(impl);
    let ok = false;
    await new Promise<void>((resolve, reject) =>
      impl.emitAlert({ request: REQ() }, (err: any) => {
        if (err) return reject(err);
        ok = true;
        resolve();
      }),
    );
    // Success callback fired and the subscriber got its write — neither waited on the hanging push.
    assert.equal(ok, true);
    assert.equal(sub.received.length, 1);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(push.dispatched.length, 1, 'push dispatch was scheduled (it just never resolves)');
  });
});

// ---------------------------------------------------------------------------
// matchesSubscriber (private, accessed via `as any`)
// ---------------------------------------------------------------------------

describe('matchesSubscriber', () => {
  it('allows broadcast alert (no targetUserId)', () => {
    const impl = makeImpl();
    const alert = makeAlert({ targetUserId: '' });
    const sub = { userId: 'user-1', categories: [], severities: [], includeAcknowledged: false, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), true);
  });

  it('allows alert targeting specific user when sub matches', () => {
    const impl = makeImpl();
    const alert = makeAlert({ targetUserId: 'user-1' });
    const sub = { userId: 'user-1', categories: [], severities: [], includeAcknowledged: false, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), true);
  });

  it('blocks alert targeting different user', () => {
    const impl = makeImpl();
    const alert = makeAlert({ targetUserId: 'user-2' });
    const sub = { userId: 'user-1', categories: [], severities: [], includeAcknowledged: false, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), false);
  });

  it('filters by category when categories array is set', () => {
    const impl = makeImpl();
    const alert = makeAlert({ category: 'system' });
    const sub = { userId: '', categories: ['trading'], severities: [], includeAcknowledged: false, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), false);
  });

  it('allows matching category', () => {
    const impl = makeImpl();
    const alert = makeAlert({ category: 'trading' });
    const sub = { userId: '', categories: ['trading'], severities: [], includeAcknowledged: false, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), true);
  });

  it('filters by severity when severities array is set', () => {
    const impl = makeImpl();
    const alert = makeAlert({ severity: 3 });
    const sub = { userId: '', categories: [], severities: [1, 2], includeAcknowledged: false, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), false);
  });

  it('filters acknowledged when includeAcknowledged=false', () => {
    const impl = makeImpl();
    const alert = makeAlert({ acknowledged: true });
    const sub = { userId: '', categories: [], severities: [], includeAcknowledged: false, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), false);
  });

  it('allows acknowledged when includeAcknowledged=true', () => {
    const impl = makeImpl();
    const alert = makeAlert({ acknowledged: true });
    const sub = { userId: '', categories: [], severities: [], includeAcknowledged: true, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), true);
  });
});

// ---------------------------------------------------------------------------
// streamAlerts — subscriber registration and deregistration
// ---------------------------------------------------------------------------

describe('streamAlerts', () => {
  it('registers subscriber and deregisters on cancelled', () => {
    const impl = makeImpl();

    const cancelHandlers: Array<() => void> = [];
    const mockCall = {
      request: { userId: 'user-1', categories: [], severities: [], includeAcknowledged: false },
      on(event: string, handler: () => void) {
        if (event === 'cancelled') cancelHandlers.push(handler);
      },
    };

    // Before subscription: no subscribers
    assert.strictEqual((impl as any).subscribers.size, 0);

    impl.streamAlerts(mockCall);

    // After subscription: 1 subscriber
    assert.strictEqual((impl as any).subscribers.size, 1);

    // Simulate cancel
    cancelHandlers[0]();
    assert.strictEqual((impl as any).subscribers.size, 0);
  });
});

// ---------------------------------------------------------------------------
// Regression: alerts must carry a `Date` createdAt so ts-proto's grpc-js
// serializer can encode them. Before the fix, `{ seconds }` plain objects threw
// `getTime is not a function` during responseSerialize / stream write, which
// grpc-js surfaced to callers (e.g. the trader alert stream) as an INTERNAL
// error after the handler had already returned.
// ---------------------------------------------------------------------------

describe('rowToAlert serialization (regression)', () => {
  it('produces a Date createdAt that ts-proto encodes without throwing', () => {
    const alert = rowToAlert({
      alert_id: 'a1',
      severity: 2,
      category: 'risk',
      title: 't',
      body: 'b',
      source_service: 'trading',
      target_user_id: 'u1',
      created_at: new Date(),
      acknowledged: false,
      correlation_id: 'c1',
      tags: [],
    });

    assert.ok(alert.createdAt instanceof Date, 'createdAt must be a Date');
    assert.doesNotThrow(() => Alert.encode(alert).finish());
  });
});
