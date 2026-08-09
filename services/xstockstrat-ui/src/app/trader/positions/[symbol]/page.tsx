'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/trader/AppShell';
import { useAccountContext } from '@/context/AccountContext';
import { usePosition, usePortfolio } from '@/hooks/usePortfolio';
import { useOrders } from '@/hooks/useOrders';
import { useCandlestickChart } from '@/hooks/useCandlestickChart';
import { type Timeframe, TIMEFRAMES, TIMEFRAME_ENUM, mapBars } from '@/lib/chart';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { marketDataClient } from '@/lib/browserClients/marketDataClient';
import { fmtUsd, fmtSignedUsd, fmtPct, pnlClass } from '@/lib/money';
import { openR, fmtR, sideLabel } from '@/lib/positionRisk';
import { POSITION_RISK_FLAG, EnumBadge } from '@/lib/opportunityShared';
import {
  OrderSideBadge,
  OrderStatusBadge,
  TYPE_LABEL,
  formatUsd as formatOrderPrice,
} from '@/components/trader/orderShared';
import { OrderType, OrderStatus } from '@xstockstrat/proto/trading/v1/trading_pb';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import type { Position } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatTile } from '@/components/shared/StatTile';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

type TradingMode = 'paper' | 'live';

// A dashed reference overlay drawn on the price chart. LineStyle.Dashed = 2 in lightweight-charts.
const DASHED = 2;

export default function PositionDetailPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = (params?.symbol ?? '').toUpperCase();
  const { selectedAccountId, environmentMode } = useAccountContext();
  const mode: TradingMode = environmentMode ?? 'paper';

  const { data: position, error, isLoading } = usePosition(symbol, mode, selectedAccountId);
  // Portfolio equity is the denominator for "% of equity" (weight). Read-only broker mirror.
  const { data: portfolio } = usePortfolio(mode, selectedAccountId);
  // This symbol's orders (both working and filled) — the Orders & fills table + strategy lineage.
  const { data: ordersData } = useOrders(mode, selectedAccountId, { symbol });
  const orders = useMemo(() => ordersData?.orders ?? [], [ordersData]);

  // Owning strategy is DERIVED from the symbol's orders (Position has no strategy_id): the most
  // frequent non-empty strategyId. Never fabricated — omitted entirely when no order carries one.
  const owningStrategy = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of orders) {
      if (o.strategyId) counts.set(o.strategyId, (counts.get(o.strategyId) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }, [orders]);

  // Candlestick chart (marketdata bars) with avg-cost / stop reference overlays.
  const { containerRef, seriesRef } = useCandlestickChart(260);
  const [timeframe, setTimeframe] = useState<Timeframe>('1Day');
  const [barsError, setBarsError] = useState<string | null>(null);
  // Track created price lines so a symbol/timeframe refetch replaces rather than stacks them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priceLinesRef = useRef<any[]>([]);

  const avg = Number(position?.avgEntryPrice ?? 0);
  const stop = Number(position?.stopPrice ?? 0);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setBarsError(null);
    marketDataClient
      .getBars({
        symbol,
        timeframe,
        timeframeEnum: TIMEFRAME_ENUM[timeframe],
        page: { pageSize: 200 },
      })
      .then((res) => {
        if (cancelled) return;
        const series = seriesRef.current;
        if (!series) return;
        series.setData(mapBars(res.bars));
        // Replace overlays (avg cost always; stop only when the position has a resting stop).
        for (const line of priceLinesRef.current) series.removePriceLine(line);
        priceLinesRef.current = [];
        if (avg > 0) {
          priceLinesRef.current.push(
            series.createPriceLine({
              price: avg,
              color: '#94a3b8',
              lineWidth: 1,
              lineStyle: DASHED,
              axisLabelVisible: true,
              title: 'avg cost',
            }),
          );
        }
        if (stop > 0) {
          priceLinesRef.current.push(
            series.createPriceLine({
              price: stop,
              color: '#e0787a',
              lineWidth: 1,
              lineStyle: DASHED,
              axisLabelVisible: true,
              title: 'stop',
            }),
          );
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setBarsError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe, avg, stop, seriesRef]);

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/trader/positions" className="flex items-center gap-1.5">
              <ArrowLeft className="h-4 w-4" />
              Exposure
            </Link>
          </Button>
        </div>

        {isLoading && (
          <div className="space-y-3" data-testid="position-loading">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive">Failed to load position: {error.message}</p>
        )}
        {!isLoading && !error && (!position || !position.symbol) && (
          <EmptyState
            title={`No ${mode} position in ${symbol || 'this symbol'}`}
            description={
              selectedAccountId
                ? 'You do not hold this symbol in the selected account.'
                : 'Select an account in the header to load the position.'
            }
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/trader/positions">Back to Exposure</Link>
              </Button>
            }
          />
        )}

        {position && position.symbol && (
          <PositionBody
            position={position}
            equity={Number(portfolio?.equity ?? 0)}
            orders={orders}
            owningStrategy={owningStrategy}
            timeframe={timeframe}
            onTimeframe={setTimeframe}
            barsError={barsError}
            chartRef={containerRef}
          />
        )}
      </div>
    </AppShell>
  );
}

// PositionBody renders the risk-framed detail once a Position is loaded. Split out so the loading /
// empty / error branches above stay flat and every field below can assume a present Position.
function PositionBody({
  position,
  equity,
  orders,
  owningStrategy,
  timeframe,
  onTimeframe,
  barsError,
  chartRef,
}: {
  position: Position;
  equity: number;
  orders: Order[];
  owningStrategy: string;
  timeframe: Timeframe;
  onTimeframe: (t: Timeframe) => void;
  barsError: string | null;
  chartRef: React.RefObject<HTMLDivElement>;
}) {
  const r = openR(position);
  const marketValue = Number(position.marketValue ?? 0);
  const weightPct = equity > 0 ? Math.abs(marketValue) / equity : null;
  const hasStop = Number(position.stopPrice ?? 0) > 0;
  // The stop-distance meter fills toward the stop: 0% distance = full (at the stop), further = less.
  const stopDist = Number(position.stopDistancePct ?? 0);
  const stopMeterPct = hasStop ? Math.max(4, Math.min(100, 100 - stopDist * 100 * 10)) : 0;
  const working = orders.filter(
    (o) => o.status === OrderStatus.NEW || o.status === OrderStatus.PARTIALLY_FILLED,
  ).length;

  return (
    <>
      {/* Header — symbol, side + qty, price, day change, weight; big Unrealized + Open R. */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-2xl font-semibold tracking-tight">
              {position.symbol}
            </span>
            <Badge variant="secondary" className="font-mono">
              {sideLabel(position.qty).toUpperCase()} {position.qty}
            </Badge>
            <span className="font-mono text-base tabular-nums">
              {fmtUsd(position.currentPrice)}
            </span>
            <span className={`font-mono text-sm tabular-nums ${pnlClass(position.dayPnl)}`}>
              {fmtSignedUsd(position.dayPnl)} ({fmtPct(position.dayPnlPct)})
            </span>
            {weightPct !== null && (
              <Badge variant="secondary" className="font-mono">
                {(weightPct * 100).toFixed(1)}% of equity
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {position.accountId ? `${position.accountId} · ` : ''}
            {position.exitRule ? `exit rule ${position.exitRule}` : 'no exit rule set'}
            {owningStrategy ? ` · owned by ${owningStrategy}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
              Unrealized
            </div>
            <div className={`font-mono text-2xl tabular-nums ${pnlClass(position.unrealizedPnl)}`}>
              {fmtSignedUsd(position.unrealizedPnl)}
            </div>
            <div className={`font-mono text-xs tabular-nums ${pnlClass(position.unrealizedPnl)}`}>
              {fmtPct(position.unrealizedPnlPct)}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
              Open R
            </div>
            <div className={`font-mono text-2xl tabular-nums ${r === null ? '' : pnlClass(r)}`}>
              {fmtR(r)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* Left column: stat grid + price chart + orders & fills. */}
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border sm:grid-cols-3">
            <StatTile size="md" label="Avg cost" value={fmtUsd(position.avgEntryPrice)} />
            <StatTile size="md" label="Last" value={fmtUsd(position.currentPrice)} />
            <StatTile size="md" label="Cost basis" value={fmtUsd(position.costBasis)} />
            <StatTile size="md" label="Market value" value={fmtUsd(position.marketValue)} />
            <StatTile
              size="md"
              label="Unrealized"
              value={fmtSignedUsd(position.unrealizedPnl)}
              tone={Number(position.unrealizedPnl ?? 0) >= 0 ? 'gain' : 'loss'}
            />
            <StatTile
              size="md"
              label="Day P&L"
              value={fmtSignedUsd(position.dayPnl)}
              tone={Number(position.dayPnl ?? 0) >= 0 ? 'gain' : 'loss'}
            />
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Price · entry to stop</CardTitle>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    avg {fmtUsd(position.avgEntryPrice)}
                    {hasStop ? ` · stop ${fmtUsd(position.stopPrice)}` : ''} · last{' '}
                    {fmtUsd(position.currentPrice)}
                  </span>
                  <Tabs value={timeframe} onValueChange={(v) => onTimeframe(v as Timeframe)}>
                    <TabsList>
                      {TIMEFRAMES.map(({ value, label }) => (
                        <TabsTrigger key={value} value={value}>
                          {label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {barsError && <p className="mb-2 text-xs text-destructive">{barsError}</p>}
              <div ref={chartRef} className="w-full" style={{ height: 260 }} />
              <div className="flex flex-wrap gap-4 pt-2 font-mono text-[11px] text-muted-foreground">
                <span>
                  <span className="text-muted-foreground">— —</span> avg cost{' '}
                  {fmtUsd(position.avgEntryPrice)}
                </span>
                {hasStop && (
                  <span>
                    <span className="text-destructive">— —</span> stop {fmtUsd(position.stopPrice)}
                  </span>
                )}
                {hasStop && (
                  <span className="ml-auto">
                    distance to stop {fmtPct(position.stopDistancePct)}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Orders &amp; fills · {position.symbol}</CardTitle>
                <span className="text-xs text-muted-foreground">
                  {orders.length} total · {working} working
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <EmptyState
                  title="No orders for this symbol"
                  description="Orders you place for this position will appear here, traced to their origin signal."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Side</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Filled</TableHead>
                      <TableHead className="text-right">Avg fill</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">Origin</TableHead>
                      <TableHead className="sr-only">Open</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((o) => (
                      <TableRow key={o.orderId} className="cursor-pointer">
                        <TableCell>
                          <OrderSideBadge side={o.side} />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {TYPE_LABEL[OrderType[o.orderType]] ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{o.qty}</TableCell>
                        <TableCell className="text-right tabular-nums hidden sm:table-cell text-muted-foreground">
                          {o.filledQty}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatOrderPrice(o.filledAvgPrice)}
                        </TableCell>
                        <TableCell>
                          <OrderStatusBadge status={o.status} intentState={o.intentState} />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground hidden md:table-cell">
                          {o.strategyId || 'Manual'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild size="sm" variant="ghost" className="h-8">
                            <Link href={`/trader/orders/${o.orderId}`}>View →</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar: risk & exit / manage / why-it's-held / broker. */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                Risk &amp; exit
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                  <span>{hasStop ? `stop ${fmtUsd(position.stopPrice)}` : 'no stop set'}</span>
                  <span>{hasStop ? `${fmtPct(position.stopDistancePct)} away` : '—'}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={hasStop ? 'h-full bg-destructive' : 'h-full bg-muted'}
                    style={{ width: `${stopMeterPct}%` }}
                  />
                </div>
              </div>
              <dl className="space-y-1.5 text-sm">
                <Row label="Risk at stop" valueClass="text-destructive tabular-nums font-mono">
                  {position.riskAtStop ? `-${fmtUsd(position.riskAtStop)}` : '—'}
                </Row>
                <Row label="Exit rule" valueClass="font-mono text-xs">
                  {position.exitRule || '—'}
                </Row>
                <Row label="Stop order" valueClass="font-mono text-xs">
                  {position.stopOrderId || '—'}
                </Row>
                <Row label="Take-profit order" valueClass="font-mono text-xs">
                  {position.takeProfitOrderId || '—'}
                </Row>
                <Row label="Factor bucket">{position.factor || 'Unclassified'}</Row>
                <Row label="Flag">
                  {position.flag ? <EnumBadge render={POSITION_RISK_FLAG[position.flag]} /> : '—'}
                </Row>
                <Row
                  label="Day P&L"
                  valueClass={`tabular-nums font-mono ${pnlClass(position.dayPnl)}`}
                >
                  {fmtSignedUsd(position.dayPnl)}
                </Row>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                Manage
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {['Add', 'Trim', 'Move stop', 'Close'].map((label) => (
                  <Button key={label} asChild variant="outline" size="sm" className="min-h-[44px]">
                    <Link href={`/trader?symbol=${encodeURIComponent(position.symbol)}`}>
                      {label}
                    </Link>
                  </Button>
                ))}
              </div>
              <Button asChild className="min-h-[44px] w-full">
                <Link href={`/trader?symbol=${encodeURIComponent(position.symbol)}`}>
                  Open order ticket
                </Link>
              </Button>
            </CardContent>
          </Card>

          {owningStrategy && (
            <Card>
              <CardHeader>
                <CardTitle className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                  Why it&apos;s held
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Held under <span className="font-mono">{owningStrategy}</span>
                  {position.factor ? ` in the ${position.factor} factor bucket` : ''}
                  {position.exitRule ? `; exits on ${position.exitRule}.` : '.'}
                </p>
                <Button asChild variant="ghost" size="sm" className="px-0">
                  <Link href={`/insights/strategies/${owningStrategy}`}>
                    Open {owningStrategy} →
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                Broker
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Row label="Account" valueClass="font-mono text-xs">
                {position.accountId || '—'}
              </Row>
              <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                The broker owns the ledger and the P&amp;L · xstockstrat mirrors it read-only.
              </p>
              <Button asChild variant="ghost" size="sm" className="px-0">
                <Link href="/trader/portfolio">See all positions →</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

// A label/value row for the sidebar dl blocks (local to this page).
function Row({
  label,
  valueClass = '',
  children,
}: {
  label: string;
  valueClass?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right ${valueClass}`}>{children}</dd>
    </div>
  );
}
