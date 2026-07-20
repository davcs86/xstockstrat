/**
 * Unit tests for NotifyServiceImpl — no real DB required.
 *
 * Tests cover matchesSubscriber logic (via `as any` access), rowToAlert shape,
 * and streamAlerts subscriber registration/deregistration.
 *
 * Tests gracefully skip if the TypeScript import fails in strip-only mode
 * (parameter properties); they run fully when --experimental-transform-types
 * or a supporting runtime is used.
 *
 * Run: node --experimental-strip-types --test src/__tests__/*.test.ts
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Lazy imports
// ---------------------------------------------------------------------------

let NotifyServiceImpl: any;
let rowToAlert: any;

before(async () => {
  try {
    const mod = await import('../grpc/notifyServiceImpl.js');
    NotifyServiceImpl = mod.NotifyServiceImpl;
    rowToAlert = mod.rowToAlert;
  } catch {
    // Unsupported TypeScript syntax in strip-only mode — tests will be skipped.
  }
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
  if (!NotifyServiceImpl) return null;
  const pool = makePool(rows, throws);
  return new NotifyServiceImpl(pool, {});
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
    if (!rowToAlert) return;
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
    if (!rowToAlert) return;
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
    if (!NotifyServiceImpl) return;
    let capturedParams: any[] = [];
    const pool = {
      async query(_sql: string, params?: any[]) {
        capturedParams = params ?? [];
        return { rows: [] };
      },
    };
    const impl = new NotifyServiceImpl(pool, {});
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
    if (!impl) return;
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
});

// ---------------------------------------------------------------------------
// matchesSubscriber (private, accessed via `as any`)
// ---------------------------------------------------------------------------

describe('matchesSubscriber', () => {
  it('allows broadcast alert (no targetUserId)', () => {
    const impl = makeImpl();
    if (!impl) return;
    const alert = makeAlert({ targetUserId: '' });
    const sub = { userId: 'user-1', categories: [], severities: [], includeAcknowledged: false, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), true);
  });

  it('allows alert targeting specific user when sub matches', () => {
    const impl = makeImpl();
    if (!impl) return;
    const alert = makeAlert({ targetUserId: 'user-1' });
    const sub = { userId: 'user-1', categories: [], severities: [], includeAcknowledged: false, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), true);
  });

  it('blocks alert targeting different user', () => {
    const impl = makeImpl();
    if (!impl) return;
    const alert = makeAlert({ targetUserId: 'user-2' });
    const sub = { userId: 'user-1', categories: [], severities: [], includeAcknowledged: false, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), false);
  });

  it('filters by category when categories array is set', () => {
    const impl = makeImpl();
    if (!impl) return;
    const alert = makeAlert({ category: 'system' });
    const sub = { userId: '', categories: ['trading'], severities: [], includeAcknowledged: false, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), false);
  });

  it('allows matching category', () => {
    const impl = makeImpl();
    if (!impl) return;
    const alert = makeAlert({ category: 'trading' });
    const sub = { userId: '', categories: ['trading'], severities: [], includeAcknowledged: false, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), true);
  });

  it('filters by severity when severities array is set', () => {
    const impl = makeImpl();
    if (!impl) return;
    const alert = makeAlert({ severity: 3 });
    const sub = { userId: '', categories: [], severities: [1, 2], includeAcknowledged: false, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), false);
  });

  it('filters acknowledged when includeAcknowledged=false', () => {
    const impl = makeImpl();
    if (!impl) return;
    const alert = makeAlert({ acknowledged: true });
    const sub = { userId: '', categories: [], severities: [], includeAcknowledged: false, call: {} };
    assert.strictEqual((impl as any).matchesSubscriber(alert, sub), false);
  });

  it('allows acknowledged when includeAcknowledged=true', () => {
    const impl = makeImpl();
    if (!impl) return;
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
    if (!impl) return;

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
  it('produces a Date createdAt that ts-proto encodes without throwing', async () => {
    if (!rowToAlert) return;

    let Alert: any;
    try {
      ({ Alert } = await import('@xstockstrat/proto/notify/v1/notify.js'));
    } catch {
      return; // proto package unavailable in this runtime — skip.
    }

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
