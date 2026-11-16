import { DEFAULT_UNARY_TIMEOUT_MS } from '../../src/lib/deadlines';
import { TEST_USER_ID } from './users';

/**
 * Alert fixtures (feature 203) — centralized from mock-backend.ts once the notifications inbox
 * and alert-stream specs became a second consumer (C-12). `read` is per-user state populated on
 * ListAlerts; the mock returns it directly (no join). Timestamps are omitted (default) except where
 * a test needs one.
 */

// The three StreamAlerts alerts (extracted from mock-backend.ts).
export const ALERT_STREAM_001 = {
  alertId: 'alert-stream-001',
  severity: 2,
  category: 'RISK',
  title: 'Position limit approaching',
  body: 'AAPL position is at 80% of max allowed.',
  sourceService: 'trading',
};
export const ALERT_STREAM_002 = {
  alertId: 'alert-stream-002',
  severity: 4,
  category: 'SYSTEM',
  title: 'Order rejected',
  body: 'Insufficient buying power for TSLA order.',
  sourceService: 'trading',
};
export const ALERT_STREAM_003 = {
  alertId: 'alert-stream-003',
  severity: 1,
  category: 'TRADE',
  title: 'Order filled',
  body: 'AAPL market order for 10 shares filled at $189.80.',
  sourceService: 'trading',
};
export const ALERT_STREAM_ALL = [ALERT_STREAM_001, ALERT_STREAM_002, ALERT_STREAM_003];

// feature 271 @AC-5 — a request carrying this x-trace-id makes the StreamAlerts mock hold the stream
// open past the unary default before yielding ALERT_STREAM_HELD (distinct title: proves stream delivery).
export const ALERT_STREAM_HOLD_TRACE_ID = 'trace-alert-stream-hold';
export const ALERT_STREAM_HOLD_MS = DEFAULT_UNARY_TIMEOUT_MS + 5_000;
export const ALERT_STREAM_HELD = {
  ...ALERT_STREAM_001,
  alertId: 'alert-stream-held',
  title: 'Held stream alert',
};

// The three historical ListAlerts alerts (extracted from mock-backend.ts).
export const ALERT_LIST_001 = {
  alertId: 'alert-001',
  severity: 2,
  category: 'RISK',
  title: 'Position limit approaching',
  body: 'AAPL position is at 80% of max allowed.',
  sourceService: 'trading',
};
export const ALERT_LIST_002 = {
  alertId: 'alert-002',
  severity: 4,
  category: 'SYSTEM',
  title: 'Buying power check failed',
  body: 'Insufficient buying power for TSLA order.',
  sourceService: 'trading',
};
export const ALERT_LIST_003 = {
  alertId: 'alert-strat-001',
  severity: 1,
  category: 'strategy',
  title: 'Entry trigger: Live Test Strategy',
  body: 'AAPL entry triggered (conviction 0.82)',
  sourceService: 'xstockstrat-analysis',
  tags: ['strategy_id:strat-live-001'],
};

// Read/unread variants for the inbox specs.
// AC-1 — a read alert (read=true, readAt set).
export const ALERT_READ = {
  ...ALERT_LIST_001,
  read: true,
  readAt: { seconds: BigInt(1_756_000_000), nanos: 0 },
};
// AC-2 / AC-4 — an unread alert (read=false, no readAt).
export const ALERT_UNREAD = {
  ...ALERT_LIST_002,
  read: false,
};
// AC-5 — acknowledged but unread (read/acknowledged are independent).
export const ALERT_ACKNOWLEDGED_UNREAD = {
  ...ALERT_LIST_003,
  acknowledged: true,
  read: false,
};

// The list the ListAlerts mock returns for read/unread specs. Two of the three are unread.
export const ALERT_LIST_WITH_READ_STATE = [ALERT_READ, ALERT_UNREAD, ALERT_ACKNOWLEDGED_UNREAD];
export const MOCK_UNREAD_COUNT = 2;

// Feature 344 — GetAlert detail fixtures. The mock never resolves ALERT_DETAIL_UNKNOWN_ID.
export const ALERT_DETAIL_ID = 'a1f3c0de-0000-4000-8000-000000000001';
export const ALERT_DETAIL_BROADCAST_ID = 'c9d0c0de-0000-4000-8000-000000000002';
export const ALERT_DETAIL_UNKNOWN_ID = 'b2e4c0de-0000-4000-8000-000000000003';
export const ALERT_DETAIL = {
  alertId: ALERT_DETAIL_ID,
  severity: 3,
  category: 'backfill',
  title: 'Backfill 67276d1f failed',
  body: 'Backfill job 67276d1f failed: FAILED_PRECONDITION — marketdata.fundamentals.history.enabled is false',
  sourceService: 'xstockstrat-ingest',
  targetUserId: TEST_USER_ID,
  correlationId: 'c-77',
  createdAt: { seconds: BigInt(1_763_200_000), nanos: 0 },
  context: {
    job_id: '67276d1f',
    failed_symbols: ['LYFT'],
    error: '<AioRpcError of RPC that terminated with: status = StatusCode.FAILED_PRECONDITION>',
  },
  read: false,
};
export const ALERT_DETAIL_BROADCAST = {
  ...ALERT_DETAIL,
  alertId: ALERT_DETAIL_BROADCAST_ID,
  targetUserId: '',
  title: 'Broadcast notice',
  context: {},
};
export const ALERT_DETAILS = [ALERT_DETAIL, ALERT_DETAIL_BROADCAST];

// Feature 339 unread-only drawer — per-spec stubs only; never add these to the shared mock lists.
// `createdAt` is Connect-JSON so the object can be a `page.route` body as is.
export const DRAWER_ALERT_BASE_SECONDS = 1_794_736_800; // 2026-11-15T10:00:00Z
const drawerCreatedAt = (offsetSeconds: number) =>
  new Date((DRAWER_ALERT_BASE_SECONDS + offsetSeconds) * 1000).toISOString();

export const DRAWER_ALERT_STORED_UNREAD = {
  alertId: 'alert-drawer-stored-unread',
  severity: 3,
  category: 'SYSTEM',
  title: 'Backfill 67276d1f failed',
  body: 'Historical backfill job 67276d1f failed.',
  sourceService: 'xstockstrat-marketdata',
  read: false,
  createdAt: drawerCreatedAt(0),
};
export const DRAWER_ALERT_STORED_READ = {
  alertId: 'alert-drawer-stored-read',
  severity: 1,
  category: 'SYSTEM',
  title: 'Backfill 11aa22bb done',
  body: 'Historical backfill job 11aa22bb completed.',
  sourceService: 'xstockstrat-marketdata',
  read: true,
  createdAt: drawerCreatedAt(-60),
};
export const DRAWER_ALERT_STREAMED = {
  alertId: 'alert-drawer-streamed',
  severity: 4,
  category: 'SYSTEM',
  title: 'Order rejected',
  body: 'Insufficient buying power for TSLA order.',
  sourceService: 'trading',
  createdAt: drawerCreatedAt(60),
};
export const DRAWER_ALERT_CLEAR_A = {
  alertId: 'alert-drawer-clear-a',
  severity: 3,
  category: 'SYSTEM',
  title: 'Backfill 9f8e7d6c failed',
  body: 'Historical backfill job 9f8e7d6c failed.',
  sourceService: 'xstockstrat-marketdata',
  read: false,
  createdAt: drawerCreatedAt(10),
};
export const DRAWER_ALERT_CLEAR_B = {
  alertId: 'alert-drawer-clear-b',
  severity: 2,
  category: 'RISK',
  title: 'Daily loss limit reached',
  body: 'Account daily loss limit reached; new entries are paused.',
  sourceService: 'trading',
  read: false,
  createdAt: drawerCreatedAt(20),
};
