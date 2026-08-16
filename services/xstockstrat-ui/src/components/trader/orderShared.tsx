// Shared order-table building blocks used by OrderBook, OrdersTable, and the order-detail
// page: the status/type lookup tables, price formatting, and the recurring badge cell content
// (feature 135 migrated all `Table`-based consumers to the shared `DataTable` composite, whose
// `ColumnDef.cell` renderers need bare content, not a `<TableCell>` wrapper — the pre-migration
// `OrderSymbolCell`/`OrderSideCell`/`OrderStatusCell` wrappers were removed as dead code once
// their last call sites (`OrdersTable.tsx`, `OrderBook.tsx`) migrated to inlined/bare-content
// equivalents; `OrderSideBadge`/`OrderStatusBadge` below are the bare-content forms still in use).
// Single source of truth (DRY guard rail — see docs/patterns/dry-guard-rail.md).

import { OrderSide, OrderStatus, IntentState } from '@xstockstrat/proto/trading/v1/trading_pb';
import { Badge } from '../ui/badge';

export const STATUS_VARIANT: Record<
  string,
  'info' | 'warning' | 'buy' | 'secondary' | 'destructive'
> = {
  NEW: 'info',
  PARTIALLY_FILLED: 'warning',
  FILLED: 'buy',
  CANCELED: 'secondary',
  EXPIRED: 'secondary',
  REJECTED: 'destructive',
  PENDING_APPROVAL: 'warning',
};

export const TYPE_LABEL: Record<string, string> = {
  MARKET: 'Market',
  LIMIT: 'Limit',
  STOP: 'Stop',
  STOP_LIMIT: 'Stop Limit',
  TRAILING_STOP: 'Trailing Stop',
};

/** `$1234.56`, or `—` for empty/zero. */
export function formatUsd(v: number | string | undefined | null): string {
  if (v === undefined || v === null || Number(v) === 0) return '—';
  return `$${Number(v).toFixed(2)}`;
}

export function OrderSideBadge({ side }: { side: OrderSide }) {
  return (
    <Badge variant={side === OrderSide.BUY ? 'buy' : 'sell'}>
      {side === OrderSide.BUY ? 'BUY' : 'SELL'}
    </Badge>
  );
}

export function OrderStatusBadge({
  status,
  intentState,
}: {
  status: OrderStatus;
  intentState: IntentState;
}) {
  const name = OrderStatus[status] ?? 'UNKNOWN';
  return (
    <div className="flex items-center gap-1">
      <Badge variant={STATUS_VARIANT[name] ?? 'secondary'}>{name}</Badge>
      <IntentStateBadge intentState={intentState} />
    </div>
  );
}

// intent_state describes whether the platform knows if a PlaceOrder/ReplaceOrder/
// CancelOrder command actually reached the broker — orthogonal to OrderStatus (feature
// 101). Only UNKNOWN needs a visible signal per product-spec's literal requirement; every
// other state renders nothing, so existing terminal/working orders are visually unchanged.
interface IntentRender {
  label: string;
  variant: 'warning';
}
export const INTENT_STATE_RENDER: Record<IntentState, IntentRender | null> = {
  [IntentState.UNSPECIFIED]: null,
  [IntentState.PENDING]: null,
  [IntentState.COMPLETED]: null,
  [IntentState.REJECTED]: null,
  [IntentState.UNKNOWN]: { label: 'Uncertain — verify with broker', variant: 'warning' },
};

export function IntentStateBadge({ intentState }: { intentState: IntentState }) {
  const r = INTENT_STATE_RENDER[intentState];
  if (!r) return null;
  return (
    <Badge
      variant={r.variant}
      title="Command outcome unknown — check the broker dashboard before retrying"
    >
      {r.label}
    </Badge>
  );
}
