'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { useOrder } from '@/hooks/useOrders';
import { OrderSide, OrderStatus, OrderType } from '@xstockstrat/proto/trading/v1/trading_pb';
import { TradingMode } from '@xstockstrat/proto/common/v1/common_pb';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const STATUS_VARIANT: Record<string, 'info' | 'warning' | 'buy' | 'secondary' | 'destructive'> = {
  NEW: 'info',
  PARTIALLY_FILLED: 'warning',
  FILLED: 'buy',
  CANCELED: 'secondary',
  EXPIRED: 'secondary',
  REJECTED: 'destructive',
  PENDING_APPROVAL: 'warning',
};

const TYPE_LABEL: Record<string, string> = {
  MARKET: 'Market',
  LIMIT: 'Limit',
  STOP: 'Stop',
  STOP_LIMIT: 'Stop Limit',
  TRAILING_STOP: 'Trailing Stop',
};

function formatPrice(v: number | undefined | null): string {
  if (v === undefined || v === null || Number(v) === 0) return '—';
  return `$${Number(v).toFixed(2)}`;
}

function formatQty(v: number | undefined | null): string {
  if (v === undefined || v === null) return '—';
  return String(v);
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id;
  const { data: order, error, isLoading } = useOrder(orderId);

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/" className="flex items-center gap-1.5">
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Link>
          </Button>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading order…</p>}
        {error && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-destructive">Failed to load order: {(error as Error).message}</p>
            </CardContent>
          </Card>
        )}

        {order && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-xl font-mono">{order.symbol}</CardTitle>
                  <Badge variant={order.side === OrderSide.BUY ? 'buy' : 'sell'}>
                    {order.side === OrderSide.BUY ? 'BUY' : 'SELL'}
                  </Badge>
                </div>
                <Badge variant={STATUS_VARIANT[OrderStatus[order.status]] ?? 'secondary'}>
                  {OrderStatus[order.status] ?? 'UNKNOWN'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground font-mono mt-1">{order.orderId}</p>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                <Field label="Order type" value={TYPE_LABEL[OrderType[order.orderType]] ?? '—'} />
                <Field label="Quantity" value={formatQty(order.qty)} />
                <Field label="Filled" value={formatQty(order.filledQty)} />
                <Field label="Limit price" value={formatPrice(order.limitPrice)} />
                <Field label="Stop price" value={formatPrice(order.stopPrice)} />
                <Field label="Avg fill price" value={formatPrice(order.filledAvgPrice)} />
                <Field label="Time in force" value={order.timeInForce || '—'} />
                <Field label="Account" value={order.accountId || '—'} mono />
                <Field label="Strategy" value={order.strategyId || '—'} mono />
                <Field
                  label="Broker order id"
                  value={order.brokerOrderId || '—'}
                  mono
                />
                <Field
                  label="Mode"
                  value={order.tradingMode === TradingMode.LIVE ? 'LIVE' : 'PAPER'}
                />
              </dl>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
