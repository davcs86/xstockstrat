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
  title: 'Order rejected',
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
