'use client';
import useSWR from 'swr';
import { BASE_PATH } from '@/lib/basepath';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
};

const STATUS_VARIANT: Record<string, 'info' | 'warning' | 'buy' | 'secondary' | 'destructive'> = {
  ORDER_STATUS_NEW: 'info',
  ORDER_STATUS_PARTIALLY_FILLED: 'warning',
  ORDER_STATUS_FILLED: 'buy',
  ORDER_STATUS_CANCELED: 'secondary',
  ORDER_STATUS_EXPIRED: 'secondary',
  ORDER_STATUS_REJECTED: 'destructive',
  ORDER_STATUS_PENDING_APPROVAL: 'warning',
};

const TYPE_LABEL: Record<string, string> = {
  ORDER_TYPE_MARKET: 'Market',
  ORDER_TYPE_LIMIT: 'Limit',
  ORDER_TYPE_STOP: 'Stop',
  ORDER_TYPE_STOP_LIMIT: 'Stop Limit',
};

function formatPrice(v: unknown): string {
  if (v === undefined || v === null || v === '' || Number(v) === 0) return '—';
  return `$${Number(v).toFixed(2)}`;
}

function formatQty(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  return String(v);
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id;
  const { data: order, error, isLoading } = useSWR(orderId ? `${BASE_PATH}/api/orders/${orderId}` : null, fetcher, {
    refreshInterval: 5000,
  });

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
                  <Badge variant={order.side === 'ORDER_SIDE_BUY' ? 'buy' : 'sell'}>
                    {order.side === 'ORDER_SIDE_BUY' ? 'BUY' : 'SELL'}
                  </Badge>
                </div>
                <Badge variant={STATUS_VARIANT[order.status] ?? 'secondary'}>
                  {order.status?.replace('ORDER_STATUS_', '') ?? 'UNKNOWN'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground font-mono mt-1">{order.order_id ?? order.orderId}</p>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                <Field label="Order type" value={TYPE_LABEL[order.order_type ?? order.orderType] ?? '—'} />
                <Field label="Quantity" value={formatQty(order.qty)} />
                <Field label="Filled" value={formatQty(order.filled_qty ?? order.filledQty)} />
                <Field label="Limit price" value={formatPrice(order.limit_price ?? order.limitPrice)} />
                <Field label="Stop price" value={formatPrice(order.stop_price ?? order.stopPrice)} />
                <Field label="Avg fill price" value={formatPrice(order.filled_avg_price ?? order.filledAvgPrice)} />
                <Field label="Time in force" value={order.time_in_force ?? order.timeInForce ?? '—'} />
                <Field label="Account" value={order.account_id ?? order.accountId ?? '—'} mono />
                <Field label="Strategy" value={order.strategy_id ?? order.strategyId ?? '—'} mono />
                <Field
                  label="Broker order id"
                  value={order.broker_order_id ?? order.brokerOrderId ?? '—'}
                  mono
                />
                <Field
                  label="Mode"
                  value={
                    (order.trading_mode ?? order.tradingMode)?.toString().includes('LIVE') ? 'LIVE' : 'PAPER'
                  }
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
