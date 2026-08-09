'use client';
import { useState } from 'react';
import {
  OrderSide as PbOrderSide,
  OrderType as PbOrderType,
  OrderStatus as PbOrderStatus,
} from '@xstockstrat/proto/trading/v1/trading_pb';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import type { OrderFilters } from '@/hooks/useOrders';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { FilterToolbar } from '../shared/FilterToolbar';

// Sentinel string values for the "any" option in each select (empty SelectItem values
// are not allowed by Radix). They map back to "no filter on this dimension".
const ANY = 'any';

const SIDE_OPTIONS: { value: string; label: string }[] = [
  { value: ANY, label: 'Any side' },
  { value: String(PbOrderSide.BUY), label: 'Buy' },
  { value: String(PbOrderSide.SELL), label: 'Sell' },
];

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: ANY, label: 'Any type' },
  { value: String(PbOrderType.MARKET), label: 'Market' },
  { value: String(PbOrderType.LIMIT), label: 'Limit' },
  { value: String(PbOrderType.STOP), label: 'Stop' },
  { value: String(PbOrderType.STOP_LIMIT), label: 'Stop Limit' },
  { value: String(PbOrderType.TRAILING_STOP), label: 'Trailing Stop' },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: ANY, label: 'Any status' },
  { value: String(PbOrderStatus.NEW), label: 'New' },
  { value: String(PbOrderStatus.PARTIALLY_FILLED), label: 'Partially Filled' },
  { value: String(PbOrderStatus.FILLED), label: 'Filled' },
  { value: String(PbOrderStatus.CANCELED), label: 'Canceled' },
  { value: String(PbOrderStatus.EXPIRED), label: 'Expired' },
  { value: String(PbOrderStatus.REJECTED), label: 'Rejected' },
  { value: String(PbOrderStatus.PENDING_APPROVAL), label: 'Pending Approval' },
];

interface OrderFiltersProps {
  // Called whenever the user applies a filter change. The emitted object is consumed
  // by useOrders and sent server-side (the gRPC service applies symbol/side/type/status/range).
  onChange: (filters: OrderFilters) => void;
}

// OrderFilters renders the controlled, server-side filter inputs (FR-2): symbol, side,
// order type, status, and a created-at date range. Account scoping is handled globally by
// the AppShell AccountSelector and merged in by the page.
export function OrderFiltersPanel({ onChange }: OrderFiltersProps) {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<string>(ANY);
  const [orderType, setOrderType] = useState<string>(ANY);
  const [status, setStatus] = useState<string>(ANY);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const emit = (
    overrides?: Partial<{
      symbol: string;
      side: string;
      orderType: string;
      status: string;
      from: string;
      to: string;
    }>,
  ) => {
    const s = overrides?.symbol ?? symbol;
    const sd = overrides?.side ?? side;
    const ot = overrides?.orderType ?? orderType;
    const st = overrides?.status ?? status;
    const f = overrides?.from ?? from;
    const t = overrides?.to ?? to;

    const filters: OrderFilters = {};
    if (s.trim()) filters.symbol = s.trim().toUpperCase();
    if (sd !== ANY) filters.side = Number(sd) as PbOrderSide;
    if (ot !== ANY) filters.orderType = Number(ot) as PbOrderType;
    if (st !== ANY) filters.status = Number(st) as PbOrderStatus;
    if (f || t) {
      filters.range = {
        ...(f ? { start: timestampFromDate(new Date(f)) } : {}),
        ...(t ? { end: timestampFromDate(new Date(t)) } : {}),
      };
    }
    onChange(filters);
  };

  const reset = () => {
    setSymbol('');
    setSide(ANY);
    setOrderType(ANY);
    setStatus(ANY);
    setFrom('');
    setTo('');
    onChange({});
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Input
            className="uppercase"
            placeholder="Symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onBlur={() => emit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') emit();
            }}
            aria-label="Filter by symbol"
          />

          {/* side/order-type/status Selects + date range render inside FilterToolbar (FR-12) —
              symbol stays a sibling Input here since it's free text, not a Select (see
              121-shadcn-migration-medium-confidence implementation-spec.md Step 14). */}
          <FilterToolbar
            filters={[
              {
                value: side,
                onValueChange: (v) => {
                  setSide(v);
                  emit({ side: v });
                },
                options: SIDE_OPTIONS,
                ariaLabel: 'Filter by side',
              },
              {
                value: orderType,
                onValueChange: (v) => {
                  setOrderType(v);
                  emit({ orderType: v });
                },
                options: TYPE_OPTIONS,
                ariaLabel: 'Filter by order type',
              },
              {
                value: status,
                onValueChange: (v) => {
                  setStatus(v);
                  emit({ status: v });
                },
                options: STATUS_OPTIONS,
                ariaLabel: 'Filter by status',
              },
            ]}
            dateRange={{
              from,
              to,
              onFromChange: (v) => {
                setFrom(v);
                emit({ from: v });
              },
              onToChange: (v) => {
                setTo(v);
                emit({ to: v });
              },
            }}
            activeFilterCount={0}
            onClear={reset}
            clearPlacement="trailing"
          />
        </div>
      </CardContent>
    </Card>
  );
}
