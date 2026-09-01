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

// ── Feature 031: portfolio.position.closed events for the /insights performance dashboard ──
// The dashboard derives every metric (equity curve, drawdown, rolling Sharpe, per-trade averages)
// from these realized-close events. Stored NEUTRALLY (plain dates/numbers) so both consumers can
// encode them their own way: the mock backend builds a message-init LedgerEvent (occurredAt via
// timestampFromDate), while a spec's page.route fulfills the Connect-JSON WIRE shape
// (occurredAt = RFC3339 string, payload Struct = plain object with the producer's snake_case keys)
// via `closedPositionEventWire`. The last row is a LEGACY event lacking cost_basis/opened_at
// (feature-031 additive keys) — excluded from the two per-trade averages but still counted in
// totals and the equity curve (AC-13).
export interface ClosedPositionRow {
  sequence: number;
  occurredAtIso: string;
  realizedPnl: number;
  costBasis?: number;
  openedAtIso?: string;
}

export const CLOSED_POSITION_ROWS: ClosedPositionRow[] = [
  { sequence: 1, occurredAtIso: '2026-01-10T15:00:00.000Z', realizedPnl: 100, costBasis: 2000, openedAtIso: '2026-01-05T15:00:00.000Z' },
  { sequence: 2, occurredAtIso: '2026-02-10T15:00:00.000Z', realizedPnl: 200, costBasis: 4000, openedAtIso: '2026-02-05T15:00:00.000Z' },
  { sequence: 3, occurredAtIso: '2026-03-10T15:00:00.000Z', realizedPnl: -50, costBasis: 1000, openedAtIso: '2026-03-05T15:00:00.000Z' },
  { sequence: 4, occurredAtIso: '2026-04-10T15:00:00.000Z', realizedPnl: 150, costBasis: 3000, openedAtIso: '2026-04-05T15:00:00.000Z' },
  { sequence: 5, occurredAtIso: '2026-05-10T15:00:00.000Z', realizedPnl: 80, costBasis: 1600, openedAtIso: '2026-05-05T15:00:00.000Z' },
  { sequence: 6, occurredAtIso: '2026-06-05T15:00:00.000Z', realizedPnl: -120, costBasis: 2400, openedAtIso: '2026-06-01T15:00:00.000Z' },
  { sequence: 7, occurredAtIso: '2026-06-15T15:00:00.000Z', realizedPnl: 300, costBasis: 6000, openedAtIso: '2026-06-10T15:00:00.000Z' },
  { sequence: 8, occurredAtIso: '2026-06-25T15:00:00.000Z', realizedPnl: 90, costBasis: 1800, openedAtIso: '2026-06-20T15:00:00.000Z' },
  { sequence: 9, occurredAtIso: '2026-07-10T15:00:00.000Z', realizedPnl: 60, costBasis: 1200, openedAtIso: '2026-07-05T15:00:00.000Z' },
  // Legacy event (pre-feature-031): no cost_basis / opened_at (AC-13).
  { sequence: 10, occurredAtIso: '2026-08-10T15:00:00.000Z', realizedPnl: 40 },
];

/** Total realized P&L across CLOSED_POSITION_ROWS — the equity curve's final value (AC-1). */
export const CLOSED_POSITION_TOTAL_PNL = CLOSED_POSITION_ROWS.reduce((a, r) => a + r.realizedPnl, 0);

/** One extra realized close a poll test appends to prove the 60s refetch (AC-6). */
export const CLOSED_POSITION_POLL_ROW: ClosedPositionRow = {
  sequence: 11,
  occurredAtIso: '2026-08-20T15:00:00.000Z',
  realizedPnl: 150,
  costBasis: 3000,
  openedAtIso: '2026-08-15T15:00:00.000Z',
};

/** Connect-JSON WIRE-shape LedgerEvent for a spec's page.route().fulfill (feature 031). */
export function closedPositionEventWire(row: ClosedPositionRow): JsonObject {
  const payload: JsonObject = { realized_pnl: row.realizedPnl };
  if (row.costBasis !== undefined) payload.cost_basis = row.costBasis;
  if (row.openedAtIso !== undefined) payload.opened_at = row.openedAtIso;
  return {
    eventId: `evt-closed-${row.sequence}`,
    eventType: 'portfolio.position.closed',
    sourceService: 'xstockstrat-portfolio',
    streamKey: `portfolio:${TEST_USER_ID}`,
    sequence: String(row.sequence),
    userId: TEST_USER_ID,
    occurredAt: row.occurredAtIso,
    payload,
  };
}
