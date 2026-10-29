import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { timestampToMillis } from './protoTime';

// An absent `updatedAt` counts as oldest; the polled record wins only when strictly newer (a tie keeps
// the streamed one), so a dropped stream cannot mask a fresher polled status.
export function pickFresherOrder(streamed: Order | undefined, polled: Order): Order {
  if (!streamed) return polled;
  const streamedAt = timestampToMillis(streamed.updatedAt) ?? Number.NEGATIVE_INFINITY;
  const polledAt = timestampToMillis(polled.updatedAt) ?? Number.NEGATIVE_INFINITY;
  return polledAt > streamedAt ? polled : streamed;
}
