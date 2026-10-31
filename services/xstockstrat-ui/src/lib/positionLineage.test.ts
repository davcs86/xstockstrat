import { describe, expect, it, vi } from 'vitest';
import { BROKER_ACCOUNT_ALPACA } from '../../e2e/fixtures/accounts';
import { LINEAGE_FILL_EVENTS } from '../../e2e/fixtures/ledgerEvents';
import { LINEAGE_ORDERS, ORDER_FILLED } from '../../e2e/fixtures/orders';
import { LINEAGE_MAX_ORDERS, fetchPositionLineage } from './positionLineage';

type Deps = Parameters<typeof fetchPositionLineage>[0];
type QueryReq = { streamKey: string; eventType: string; sourceService: string };

const ARGS = { symbol: 'AAPL', accountId: BROKER_ACCOUNT_ALPACA.id, mode: 'paper' as const };

function depsFor(orders: unknown[]) {
  const listOrders = vi.fn(async () => ({ orders }));
  let inFlight = 0;
  let maxInFlight = 0;
  const queryEvents = vi.fn(async (req: QueryReq) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    return { events: LINEAGE_FILL_EVENTS.filter((f) => f.streamKey === req.streamKey) };
  });
  return {
    deps: { listOrders, queryEvents } as unknown as Deps,
    listOrders,
    queryEvents,
    peak: () => maxInFlight,
  };
}

const manyOrders = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ...ORDER_FILLED, orderId: `bulk-${i}` }));

describe('fetchPositionLineage', () => {
  it('lists orders pinned to symbol, account and mode with a page of LINEAGE_MAX_ORDERS + 1', async () => {
    const { deps, listOrders } = depsFor(LINEAGE_ORDERS);
    await fetchPositionLineage(deps, ARGS);
    expect(listOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'AAPL',
        accountId: BROKER_ACCOUNT_ALPACA.id,
        tradingMode: ORDER_FILLED.tradingMode,
        page: expect.objectContaining({ pageSize: LINEAGE_MAX_ORDERS + 1 }),
      }),
    );
  });

  it('queries one order.filled stream per order from the canonical source, at most 3 at once', async () => {
    const { deps, queryEvents, peak } = depsFor(manyOrders(12));
    await fetchPositionLineage(deps, ARGS);
    expect(queryEvents).toHaveBeenCalledTimes(12);
    expect(queryEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        streamKey: 'bulk-0',
        eventType: 'order.filled',
        sourceService: 'xstockstrat-trading',
      }),
    );
    expect(peak()).toBeLessThanOrEqual(3);
    expect(peak()).toBeGreaterThan(1);
  });

  it('truncates at LINEAGE_MAX_ORDERS and says so (AC-21)', async () => {
    const { deps, queryEvents } = depsFor(manyOrders(LINEAGE_MAX_ORDERS + 1));
    const out = await fetchPositionLineage(deps, ARGS);
    expect(out.truncated).toBe(true);
    expect(queryEvents).toHaveBeenCalledTimes(LINEAGE_MAX_ORDERS);
  });

  it('is not truncated at exactly LINEAGE_MAX_ORDERS orders', async () => {
    const { deps } = depsFor(manyOrders(LINEAGE_MAX_ORDERS));
    expect((await fetchPositionLineage(deps, ARGS)).truncated).toBe(false);
  });

  it('still queries an order whose status is NEW and returns its fill (AC-22)', async () => {
    const stale = LINEAGE_ORDERS.filter((o) => o.orderId === 'o-stale');
    expect(stale[0].status).toBe(1);
    const { deps, queryEvents } = depsFor(stale);
    const out = await fetchPositionLineage(deps, ARGS);
    expect(queryEvents).toHaveBeenCalledTimes(1);
    expect(out.events.map((e) => e.eventId)).toEqual(['evt-lineage-o-stale']);
  });
});
