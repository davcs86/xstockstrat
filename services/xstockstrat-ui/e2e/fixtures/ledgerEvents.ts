// Ledger event fixtures for the /trader ledger-export e2e (feature 021).
// Shape source: xstockstrat.ledger.v1.LedgerEvent (Connect-JSON camelCase). One row per
// event_type across the five exportable classes, with distinct ascending `sequence` and the
// canonical TEST_USER_ID owner, so a spec can assert global-sequence ordering, type filtering,
// and the per-event wire shape (incl. user_id + payload). See INVENTORY.md.
import type { JsonObject } from '@bufbuild/protobuf';
import { TEST_USER_ID } from './users';

export interface LedgerExportFixtureRow {
  eventId: string;
  eventType: string;
  sourceService: string;
  correlationId: string;
  streamKey: string;
  sequence: bigint;
  userId: string;
  occurredAtIso: string;
  payload: JsonObject;
}

// Deliberately NOT in sequence order in the array, so a test proves the export sorts by `sequence`.
export const LEDGER_EXPORT_EVENTS: LedgerExportFixtureRow[] = [
  {
    eventId: 'evt-fill-1',
    eventType: 'fill',
    sourceService: 'xstockstrat-trading',
    correlationId: 'corr-1',
    streamKey: 'order:o1',
    sequence: BigInt(1),
    userId: TEST_USER_ID,
    occurredAtIso: '2026-01-01T10:00:00.000Z',
    payload: { order_id: 'o1', symbol: 'AAPL', qty: 10, fill_price: 180.5 },
  },
  {
    eventType: 'signal',
    eventId: 'evt-signal-1',
    sourceService: 'xstockstrat-analysis',
    correlationId: 'corr-2',
    streamKey: 'signal:s1',
    sequence: BigInt(2),
    userId: TEST_USER_ID,
    occurredAtIso: '2026-01-01T11:00:00.000Z',
    payload: { symbol: 'MSFT', confidence: 0.8 },
  },
  {
    eventId: 'evt-pnl-1',
    eventType: 'pnl_snapshot',
    sourceService: 'xstockstrat-portfolio',
    correlationId: 'corr-3',
    streamKey: 'account:a1',
    sequence: BigInt(3),
    userId: TEST_USER_ID,
    occurredAtIso: '2026-01-01T12:00:00.000Z',
    payload: { equity: 100000, day_pnl: 250 },
  },
  {
    eventId: 'evt-config-1',
    eventType: 'config_change',
    sourceService: 'xstockstrat-config',
    correlationId: 'corr-4',
    streamKey: 'config:trading',
    sequence: BigInt(4),
    userId: TEST_USER_ID,
    occurredAtIso: '2026-01-01T13:00:00.000Z',
    payload: { key: 'trading.risk.atr_multiplier', new_value: '1.5' },
  },
  {
    eventId: 'evt-alert-1',
    eventType: 'alert',
    sourceService: 'xstockstrat-notify',
    correlationId: 'corr-5',
    streamKey: 'alert:al1',
    sequence: BigInt(5),
    userId: TEST_USER_ID,
    occurredAtIso: '2026-01-01T14:00:00.000Z',
    payload: { severity: 'WARNING', title: 'Order requires approval' },
  },
];

// Sentinel event_type a test passes to make the mock throw FAILED_PRECONDITION, simulating
// ledger.export.enabled=false (there is no config service in the e2e mock backend).
export const EXPORT_DISABLED_SENTINEL = '__export_disabled__';
