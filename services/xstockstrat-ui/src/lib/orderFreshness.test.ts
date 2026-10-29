import { describe, expect, it } from 'vitest';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { OrderStatus } from '@xstockstrat/proto/trading/v1/trading_pb';
import { ORDER_WORKING } from '../../e2e/fixtures/orders';
import { pickFresherOrder } from './orderFreshness';

const AT_10_00_00 = timestampFromDate(new Date('2026-01-05T10:00:00Z'));
const AT_10_00_05 = timestampFromDate(new Date('2026-01-05T10:00:05Z'));

function order(status: OrderStatus, updatedAt?: Order['updatedAt']): Order {
  return { ...ORDER_WORKING, status, updatedAt } as unknown as Order;
}

describe('pickFresherOrder', () => {
  it('@AC-1 a polled FILLED newer than a streamed PARTIALLY_FILLED wins', () => {
    const streamed = order(OrderStatus.PARTIALLY_FILLED, AT_10_00_00);
    const polled = order(OrderStatus.FILLED, AT_10_00_05);
    expect(pickFresherOrder(streamed, polled).status).toBe(OrderStatus.FILLED);
  });

  it('@AC-8 on an equal updatedAt the streamed record is kept', () => {
    const streamed = order(OrderStatus.CANCELED, AT_10_00_05);
    const polled = order(OrderStatus.NEW, AT_10_00_05);
    expect(pickFresherOrder(streamed, polled).status).toBe(OrderStatus.CANCELED);
  });

  it('keeps the streamed record when the poll is older', () => {
    const streamed = order(OrderStatus.FILLED, AT_10_00_05);
    const polled = order(OrderStatus.NEW, AT_10_00_00);
    expect(pickFresherOrder(streamed, polled).status).toBe(OrderStatus.FILLED);
  });

  it('keeps the streamed record when the poll has no updatedAt', () => {
    const streamed = order(OrderStatus.FILLED, AT_10_00_00);
    const polled = order(OrderStatus.NEW);
    expect(pickFresherOrder(streamed, polled).status).toBe(OrderStatus.FILLED);
  });

  it('takes the poll when only the poll has an updatedAt', () => {
    const streamed = order(OrderStatus.NEW);
    const polled = order(OrderStatus.FILLED, AT_10_00_00);
    expect(pickFresherOrder(streamed, polled).status).toBe(OrderStatus.FILLED);
  });

  it('returns the poll when there is no streamed record', () => {
    const polled = order(OrderStatus.NEW, AT_10_00_00);
    expect(pickFresherOrder(undefined, polled)).toBe(polled);
  });
});
