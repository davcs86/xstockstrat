'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/trader/AppShell';
import { useAccountContext } from '@/context/AccountContext';
import { usePosition, usePortfolio } from '@/hooks/usePortfolio';
import { useOrders } from '@/hooks/useOrders';
import { useCandlestickChart } from '@/hooks/useCandlestickChart';
import { type Timeframe, TIMEFRAME_ENUM, mapBars } from '@/lib/chart';
import { resolveChartColor } from '@/lib/chartColors';
import { marketDataClient } from '@/lib/browserClients/marketDataClient';
import { fmtUsd, fmtSignedUsd, fmtPct, pnlClass } from '@/lib/money';
import { openR, fmtR, sideLabel } from '@/lib/positionRisk';
import { POSITION_RISK_FLAG, OPPORTUNITY_ACTION, EnumBadge } from '@/lib/opportunityShared';
import { useWatchlists } from '@/hooks/useWatchlists';
import { useOpportunities, useStrategyAnalytics } from '@/hooks/useOpportunities';
import { useFundamentals } from '@/hooks/useFundamentals';
import { MuteForStrategy } from '@/components/insights/MuteForStrategy';
import { useBacktestHistory } from '@/hooks/useStrategies';
import { useRunBacktest } from '@/hooks/useBacktest';
import { useBackfillJobs, useTriggerBackfill } from '@/hooks/useBackfills';
import { useIsAdmin } from '@/hooks/useLiveStrategies';
import { useGetStrategy } from '@/hooks/useStrategyDefinitions';
import { useIndicatorSeries, type IndicatorSeriesInput } from '@/hooks/useIndicatorSeries';
import { BackfillStatus } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { BacktestStatus } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { timestampToDate } from '@/lib/protoTime';
import { Sparkline } from '@/components/shared/Sparkline';
import { riskReward, suggestedShares } from '@/lib/orderSizing';
import { SignalReadiness } from '@/components/insights/SignalReadiness';
import { StrategyPicker } from '@/components/insights/StrategyPicker';
import { SymbolScreening } from '@/components/trader/SymbolScreening';
import { IndicatorPanels } from '@/components/trader/IndicatorPanels';
import type { IChartApi } from 'lightweight-charts';
import { SymbolSectionNav, SECTION_SCROLL_MT } from '@/components/trader/SymbolSectionNav';
import { SymbolPanelGroup, type SymbolPanel } from '@/components/trader/SymbolPanelGroup';
import { cn } from '@/components/ui/utils';
import { ConnectError } from '@connectrpc/connect';
import type { Opportunity } from '@xstockstrat/proto/analysis/v1/analysis_pb';
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
import { CardNotice } from '@/components/shared/CardNotice';
import { StatTile } from '@/components/shared/StatTile';
import { Eyebrow } from '@/components/shared/Eyebrow';
import { PageBreadcrumb } from '@/components/shared/PageBreadcrumb';
import { OrderForm } from '@/components/trader/OrderForm';
import { isNotFoundError } from '@/lib/scoreDisplay';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

type TradingMode = 'paper' | 'live';

// LineStyle.Dashed = 2 in lightweight-charts.
const DASHED = 2;

// useSearchParams() (the ?strategy= seed) must sit under a Suspense boundary or Next 15 de-opts the
// route to client-side rendering at build time.
export default function PositionDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 sm:p-6">
          <Skeleton className="h-16 w-full" />
        </div>
      }
    >
      <PositionDetailInner />
    </Suspense>
  );
}

function PositionDetailInner() {
  const params = useParams<{ symbol: string }>();
  const symbol = (params?.symbol ?? '').toUpperCase();
  const searchParams = useSearchParams();
  const { selectedAccountId, environmentMode } = useAccountContext();
  const mode: TradingMode = environmentMode ?? 'paper';

  const { data: position, error, isLoading } = usePosition(symbol, mode, selectedAccountId);
  const { data: portfolio } = usePortfolio(mode, selectedAccountId);
  const { data: ordersData } = useOrders(mode, selectedAccountId, { symbol });
  const orders = useMemo(() => ordersData?.orders ?? [], [ordersData]);

  // Owning strategy is DERIVED from orders (Position has no strategy_id): most frequent non-empty
  // strategyId; omitted when no order carries one.
  const owningStrategy = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of orders) {
      if (o.strategyId) counts.set(o.strategyId, (counts.get(o.strategyId) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }, [orders]);

  const { containerRef, seriesRef, chartRef } = useCandlestickChart(260);
  const timeframe: Timeframe = '1Day';
  const [barsError, setBarsError] = useState<string | null>(null);
  // Retain the drawn bars' closes+times so the indicator overlays reuse the exact series (parity
  // x-axis, no second bars fetch).
  const [barSeries, setBarSeries] = useState<{
    closes: number[];
    times: IndicatorSeriesInput['times'];
  }>({ closes: [], times: [] });
  // Track created price lines so a symbol/timeframe refetch replaces rather than stacks them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priceLinesRef = useRef<any[]>([]);

  // Computed safely whether or not a position exists — the chart section renders for every symbol,
  // held or not, so these must never reach into an undefined `position`.
  const avg = Number(position?.avgEntryPrice ?? 0);
  const stop = Number(position?.stopPrice ?? 0);
  const last = Number(position?.currentPrice ?? 0);
  const hasStop = Number(position?.stopPrice ?? 0) > 0;
  const working = useMemo(
    () =>
      orders.filter(
        (o) => o.status === OrderStatus.NEW || o.status === OrderStatus.PARTIALLY_FILLED,
      ).length,
    [orders],
  );

  // No dedicated membership RPC — scan useWatchlists() bindings (authoritative) for the symbol and
  // its bound strategy; the deprecated flat symbols[] is a legacy fallback.
  const { data: watchlistsData, isLoading: watchlistsLoading } = useWatchlists();
  const { isSymbolWatchlisted, boundStrategyId } = useMemo(() => {
    let found = false;
    let bound = '';
    for (const wl of watchlistsData?.watchlists ?? []) {
      for (const b of wl.bindings ?? []) {
        if ((b.symbol ?? '').toUpperCase() === symbol) {
          found = true;
          if (b.strategyId) bound = b.strategyId;
        }
      }
      // Legacy fallback: a record with an empty bindings[] still lists symbols[].
      if (!found && (wl.symbols ?? []).some((s) => s.toUpperCase() === symbol)) found = true;
    }
    return { isSymbolWatchlisted: found, boundStrategyId: bound };
  }, [watchlistsData, symbol]);

  // Effective strategy is a pure derivation (race-free once the async binding resolves):
  // pick → ?strategy= → watchlist binding → empty. Only the explicit pick is state.
  const [pickedStrategyId, setPickedStrategyId] = useState<string>();
  const urlStrategy = searchParams?.get('strategy') ?? '';
  const effectiveStrategyId = pickedStrategyId ?? (urlStrategy || boundStrategyId || '');
  // Mirror the pick to ?strategy= via replaceState (no Next nav/refetch), preserving the section-nav #hash.
  const handleStrategyChange = (id: string) => {
    setPickedStrategyId(id);
    const u = new URL(window.location.href);
    u.searchParams.set('strategy', id);
    window.history.replaceState(null, '', u.pathname + u.search + u.hash);
  };

  const { data: oppData } = useOpportunities(0);
  const symbolOpportunities = useMemo(
    () => (oppData?.opportunities ?? []).filter((o) => o.symbol === symbol),
    [oppData, symbol],
  );

  // Header live price: prefer the enriched Opportunity (parity with the queue card), else a direct
  // GetLatestPrice for an off-queue symbol (price only, no chips/overlays); omitted when unavailable.
  const headerOpp = symbolOpportunities[0];
  const [fallbackPrice, setFallbackPrice] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (headerOpp || !symbol) {
      setFallbackPrice(undefined);
      return;
    }
    let cancelled = false;
    marketDataClient
      .getLatestPrice({ symbol })
      .then((r) => {
        if (!cancelled) setFallbackPrice(r.lastPrice);
      })
      .catch(() => {
        /* best-effort — leave the header price-less */
      });
    return () => {
      cancelled = true;
    };
  }, [headerOpp, symbol]);
  const headerLivePrice = headerOpp?.livePrice ?? fallbackPrice;
  const headerChangePct = headerOpp?.changePct;
  const oppTarget = headerOpp?.targetPrice;
  const oppStop = headerOpp?.stopPrice;
  // Max signal conviction, gated finite-in-[0,1] → the ticket's blank-qty confidence auto-sizing;
  // undefined (held/off-queue, no active signal) falls back to the required-qty form (avoids the full-risk footgun).
  const signalConfidence = symbolOpportunities
    .map((o) => o.signalConfidence)
    .find((c): c is number => typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 1);
  // Client-side R:R + suggested size (presentation only — never sent to execution).
  const rr = riskReward(headerLivePrice, oppStop, oppTarget);
  const suggestedSize = suggestedShares(
    Number(portfolio?.buyingPower ?? 0),
    headerLivePrice,
    oppStop,
  );

  // loadBars is held in a ref so the poll interval runs the latest closure; latestReqRef discards
  // stale responses from a superseded load.
  const latestReqRef = useRef(0);
  const loadBars = () => {
    if (!symbol) return;
    const reqId = ++latestReqRef.current;
    marketDataClient
      .getBars({
        symbol,
        timeframe,
        timeframeEnum: TIMEFRAME_ENUM[timeframe],
        page: { pageSize: 200 },
      })
      .then((res) => {
        if (reqId !== latestReqRef.current) return; // superseded by a newer load
        // Bars with no timestamp are dropped to keep closes/times index-aligned for the indicator panels.
        const withTime = res.bars.filter((b) => b.time);
        setBarSeries({
          closes: withTime.map((b) => b.close),
          times: withTime.map((b) => b.time!),
        });
        setBarsError(null);
        const series = seriesRef.current;
        if (!series) return;
        series.setData(mapBars(res.bars));
        chartRef.current?.timeScale().fitContent();
        for (const line of priceLinesRef.current) series.removePriceLine(line);
        priceLinesRef.current = [];
        if (avg > 0) {
          priceLinesRef.current.push(
            series.createPriceLine({
              price: avg,
              color: resolveChartColor('--muted-foreground', 'gray'),
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
              color: resolveChartColor('--color-sell', 'red'),
              lineWidth: 1,
              lineStyle: DASHED,
              axisLabelVisible: true,
              title: 'stop',
            }),
          );
        }
        // Draw target/stop overlays only when the enriched Opportunity carries them — never a line at 0
        // (guard on presence, not on `> 0` of a fabricated default).
        if (oppTarget !== undefined) {
          priceLinesRef.current.push(
            series.createPriceLine({
              price: oppTarget,
              color: resolveChartColor('--color-buy', 'green'),
              lineWidth: 1,
              lineStyle: DASHED,
              axisLabelVisible: true,
              title: 'target',
            }),
          );
        }
        if (oppStop !== undefined) {
          priceLinesRef.current.push(
            series.createPriceLine({
              price: oppStop,
              color: resolveChartColor('--color-sell', 'red'),
              lineWidth: 1,
              lineStyle: DASHED,
              axisLabelVisible: true,
              title: 'signal stop',
            }),
          );
        }
      })
      .catch((err: unknown) => {
        if (reqId === latestReqRef.current) setBarsError((err as Error).message);
      });
  };
  const loadBarsRef = useRef(loadBars);
  loadBarsRef.current = loadBars;

  useEffect(() => {
    loadBarsRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, avg, stop, oppTarget, oppStop]);

  // Poll keyed on [symbol] only, so the timer isn't reset on every avg/stop tick; cleared on symbol
  // change / unmount.
  useEffect(() => {
    if (!symbol) return;
    const id = setInterval(() => loadBarsRef.current(), 300_000);
    return () => clearInterval(id);
  }, [symbol]);

  // GetPosition returns NotFound for a non-held symbol (the common case) — route that to the inline
  // notice below; reserve the error paragraph for a genuine failure (timeout, 5xx).
  const genuineError = Boolean(error) && !isNotFoundError(error);
  const positionNotFound = !isLoading && !genuineError && !position?.symbol;

  // Section-nav groups, in DOM order — a stable four-section spine regardless of what's held.
  const sectionGroups = [
    { id: 'overview', label: 'Overview' },
    { id: 'trade', label: 'Trade' },
    { id: 'research', label: 'Research' },
    { id: 'analysis', label: 'Analysis' },
  ];

  const tradePanels: SymbolPanel[] = [
    ...(position && position.symbol
      ? [
          {
            id: 'position-stats',
            label: 'Position',
            node: (
              <PositionPanel
                position={position}
                equity={Number(portfolio?.equity ?? 0)}
                owningStrategy={owningStrategy}
              />
            ),
          },
          {
            id: 'risk-exit',
            label: 'Risk & exit',
            node: <RiskExitPanel position={position} />,
          },
          ...(owningStrategy
            ? [
                {
                  id: 'why-held',
                  label: "Why it's held",
                  node: <WhyHeldPanel position={position} owningStrategy={owningStrategy} />,
                },
              ]
            : []),
        ]
      : []),
    {
      id: 'orders',
      label: 'Orders & fills',
      node: <SymbolOrdersCard symbol={symbol} orders={orders} working={working} />,
    },
    {
      id: 'place-order',
      label: 'Place order',
      node: (
        <Card>
          <CardHeader>
            <CardTitle>Trade {symbol}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Presentation only — never fed into the OrderForm/usePlaceOrder path below; rows are
                omitted when inputs are missing. */}
            {rr && (
              <div
                className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground"
                data-testid="rr-sizing"
              >
                <span>
                  R:R{' '}
                  <span className="font-mono tabular-nums text-foreground" data-testid="rr-ratio">
                    {rr.ratioLabel}
                  </span>
                </span>
                {suggestedSize > 0 && (
                  <span>
                    Suggested{' '}
                    <span
                      className="font-mono tabular-nums text-foreground"
                      data-testid="suggested-shares"
                    >
                      {suggestedSize}
                    </span>{' '}
                    sh
                  </span>
                )}
              </div>
            )}
            {/* allowOfflineRecord={false}: this ticket never flips to the "Record Offline Order"
                control (a /trader dashboard concern) even for an auto-selected offline account. */}
            <OrderForm
              mode={mode}
              initialSymbol={symbol}
              allowOfflineRecord={false}
              signalConfidence={signalConfidence}
            />
          </CardContent>
        </Card>
      ),
    },
  ];

  const opportunityPanels: SymbolPanel[] = symbolOpportunities.map((o) => ({
    id: o.opportunityKey,
    label: o.strategyId || o.symbol,
    node: <OpportunitySection opportunity={o} symbol={symbol} />,
  }));

  const analysisPanels: SymbolPanel[] = [
    {
      id: 'backtests',
      label: 'Backtests',
      node: (
        <BacktestsSection
          symbol={symbol}
          strategyId={effectiveStrategyId}
          onStrategyChange={handleStrategyChange}
        />
      ),
    },
    {
      id: 'coverage',
      label: 'Backfill coverage',
      node: <BackfillSection symbol={symbol} />,
    },
  ];

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        {/* The first crumb always returns to the Opportunities queue — never "Exposure" — for every
            entry point (a user-mandated, consistent return-to-Decide crumb). */}
        <PageBreadcrumb
          ariaLabel="Position path"
          items={[{ label: 'Opportunities', href: '/insights/opportunities' }, { label: symbol }]}
        />

        {/* Always-on title — the only title for an unheld symbol; the header price/change/sparkline
            mirror the queue card (parity), or a direct GetLatestPrice for an off-queue symbol. */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{symbol}</h1>
          {headerLivePrice !== undefined && (
            <span
              className="font-mono text-lg tabular-nums text-foreground"
              data-testid="detail-live-price"
            >
              {fmtUsd(headerLivePrice)}
            </span>
          )}
          {headerChangePct !== undefined && (
            <span
              className={cn('font-mono text-sm tabular-nums', pnlClass(headerChangePct))}
              data-testid="detail-change"
            >
              {fmtPct(headerChangePct)}
            </span>
          )}
          {headerOpp && headerOpp.sparkline.length > 0 && (
            <Sparkline points={headerOpp.sparkline} testId="detail-sparkline" />
          )}
        </div>

        {/* Section nav — gated so it never points at absent anchors (loading/error render no sections). */}
        {!isLoading && !genuineError && <SymbolSectionNav groups={sectionGroups} />}

        {isLoading && (
          <div className="space-y-3" data-testid="position-loading">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
        {genuineError && (
          <p className="text-sm text-destructive">Failed to load position: {error?.message}</p>
        )}

        {/* Sections below render for any symbol, held or not — chart, orders & fills, and the trade
            widget serve research and entry. */}
        <section id="overview" className={cn('space-y-4', SECTION_SCROLL_MT)}>
          <SymbolPriceChart
            symbol={symbol}
            chartRef={containerRef}
            barsError={barsError}
            avg={avg}
            stop={stop}
            last={last}
            hasStop={hasStop}
            target={oppTarget}
            signalStop={oppStop}
          />

          {/* Indicator overlays charted over the exact bars above; strategy resolves like Backtests/Readiness. */}
          <IndicatorSection
            symbol={symbol}
            strategyId={effectiveStrategyId}
            onStrategyChange={handleStrategyChange}
            closes={barSeries.closes}
            times={barSeries.times}
            chartRef={chartRef}
            containerRef={containerRef}
          />
        </section>

        <section id="trade" className={cn('space-y-4', SECTION_SCROLL_MT)}>
          <SymbolPanelGroup panels={tradePanels} ariaLabel="Trade panels" />
        </section>

        {/* Watchlist-conditional split, but the Opportunity card is NOT watchlist-gated; render
            neither side while membership loads (no flash of the wrong side). */}
        <section id="research" className={cn('space-y-4', SECTION_SCROLL_MT)}>
          {watchlistsLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="space-y-4">
              {/* All live-strategy opportunities, tabbed — for held/watchlisted/ad-hoc alike. */}
              <SymbolPanelGroup panels={opportunityPanels} ariaLabel="Opportunities" />
              {/* Fundamentals is symbol-level, strategy-independent → always-on. */}
              <FundamentalsSection symbol={symbol} />
              {isSymbolWatchlisted ? (
                <>
                  {/* Readiness + Mute stay watchlist-gated (a strategy binding gives them meaning). */}
                  <Suspense fallback={<div className="h-24" />}>
                    <SignalReadiness
                      symbol={symbol}
                      strategyId={effectiveStrategyId}
                      onStrategyChange={handleStrategyChange}
                    />
                  </Suspense>
                  <MuteForStrategy symbol={symbol} />
                </>
              ) : (
                <SymbolScreening symbol={symbol} />
              )}
            </div>
          )}
        </section>

        {/* Analysis: Backtests + Backfill coverage clustered — always-on for any symbol, keyed on the
            resolved strategy. */}
        <section id="analysis" className={cn('space-y-4', SECTION_SCROLL_MT)}>
          <SymbolPanelGroup panels={analysisPanels} ariaLabel="Analysis panels" />
        </section>

        {positionNotFound && (
          <CardNotice>
            No {mode} position in {symbol || 'this symbol'}.{' '}
            {selectedAccountId
              ? 'You do not hold this symbol in the selected account.'
              : 'Select an account in the header to load the position.'}
          </CardNotice>
        )}
      </div>
    </AppShell>
  );
}

// The price chart section — rendered for every symbol, so its captions read the page-level
// avg/stop/last/hasStop locals (which no-op with no position), not a Position object.
function SymbolPriceChart({
  symbol,
  chartRef,
  barsError,
  avg,
  stop,
  last,
  hasStop,
  target,
  signalStop,
}: {
  symbol: string;
  chartRef: React.RefObject<HTMLDivElement>;
  barsError: string | null;
  avg: number;
  stop: number;
  last: number;
  hasStop: boolean;
  // The opportunity's strategy-derived target / stop (undefined ⇒ no line, no legend).
  target?: number;
  signalStop?: number;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Price · {symbol}</CardTitle>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {avg > 0 ? `avg ${fmtUsd(avg)}` : ''}
              {hasStop ? ` · stop ${fmtUsd(stop)}` : ''}
              {last > 0 ? ` · last ${fmtUsd(last)}` : ''}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {barsError && <p className="mb-2 text-xs text-destructive">{barsError}</p>}
        {/* Shared chart canvas: candlestick pane 0 + the indicator panes. Uses min-height so
            IndicatorPanels can grow it imperatively as panes are added. */}
        <div ref={chartRef} className="w-full" style={{ minHeight: 260 }} />
        {(avg > 0 || hasStop || target !== undefined || signalStop !== undefined) && (
          <div
            className="flex flex-wrap gap-4 pt-2 font-mono text-[11px] text-muted-foreground"
            data-testid="chart-legend"
          >
            {avg > 0 && (
              <span>
                <span className="text-muted-foreground">— —</span> avg cost {fmtUsd(avg)}
              </span>
            )}
            {hasStop && (
              <span>
                <span className="text-destructive">— —</span> stop {fmtUsd(stop)}
              </span>
            )}
            {/* The strategy signal's target / stop overlays; absent → no entry. */}
            {target !== undefined && (
              <span data-testid="legend-target">
                <span className="text-buy">— —</span> target {fmtUsd(target)}
              </span>
            )}
            {signalStop !== undefined && (
              <span data-testid="legend-signal-stop">
                <span className="text-destructive">— —</span> signal stop {fmtUsd(signalStop)}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Orders & fills — rendered for every symbol, reading only the top-level orders list and the
// page-level symbol (never a Position field).
function SymbolOrdersCard({
  symbol,
  orders,
  working,
}: {
  symbol: string;
  orders: Order[];
  working: number;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Orders &amp; fills · {symbol}</CardTitle>
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
          <DataTable
            columns={SYMBOL_ORDERS_COLUMNS}
            data={orders}
            getRowId={(o) => o.orderId}
            rowClassName={() => 'cursor-pointer'}
          />
        )}
      </CardContent>
    </Card>
  );
}

// Module scope: no per-instance closures — depends only on row.original + module-level helpers.
const SYMBOL_ORDERS_COLUMNS: ColumnDef<Order>[] = [
  {
    id: 'side',
    header: 'Side',
    cell: ({ row }) => <OrderSideBadge side={row.original.side} />,
  },
  {
    id: 'type',
    header: 'Type',
    meta: { className: 'font-mono text-xs text-muted-foreground' },
    cell: ({ row }) => TYPE_LABEL[OrderType[row.original.orderType]] ?? '—',
  },
  {
    accessorKey: 'qty',
    header: 'Qty',
    meta: { className: 'text-right tabular-nums' },
  },
  {
    accessorKey: 'filledQty',
    header: 'Filled',
    meta: { className: 'text-right tabular-nums hidden sm:table-cell text-muted-foreground' },
  },
  {
    id: 'avgFill',
    header: 'Avg fill',
    meta: { className: 'text-right tabular-nums' },
    cell: ({ row }) => formatOrderPrice(row.original.filledAvgPrice),
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <OrderStatusBadge status={row.original.status} intentState={row.original.intentState} />
    ),
  },
  {
    id: 'origin',
    header: 'Origin',
    meta: { className: 'font-mono text-xs text-muted-foreground hidden md:table-cell' },
    cell: ({ row }) => row.original.strategyId || 'Manual',
  },
  {
    id: 'open',
    header: () => <span className="sr-only">Open</span>,
    enableSorting: false,
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <Button asChild size="sm" variant="ghost" className="h-8">
        <Link href={`/trader/orders/${row.original.orderId}`}>View →</Link>
      </Button>
    ),
  },
];

// Held-position detail — three self-contained Card panels for the Trade group. The chart, orders,
// and trade widget stay hoisted to the page level so they render for unheld symbols too.

// Position panel — the header (symbol/side/price/day/weight + Unrealized + Open R) and the stat grid.
function PositionPanel({
  position,
  equity,
  owningStrategy,
}: {
  position: Position;
  equity: number;
  owningStrategy: string;
}) {
  const r = openR(position);
  const marketValue = Number(position.marketValue ?? 0);
  const weightPct = equity > 0 ? Math.abs(marketValue) / equity : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Position</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
              <Eyebrow>Unrealized</Eyebrow>
              <div
                className={`font-mono text-2xl tabular-nums ${pnlClass(position.unrealizedPnl)}`}
              >
                {fmtSignedUsd(position.unrealizedPnl)}
              </div>
              <div className={`font-mono text-xs tabular-nums ${pnlClass(position.unrealizedPnl)}`}>
                {fmtPct(position.unrealizedPnlPct)}
              </div>
            </div>
            <div className="text-right">
              <Eyebrow>Open R</Eyebrow>
              <div className={`font-mono text-2xl tabular-nums ${r === null ? '' : pnlClass(r)}`}>
                {fmtR(r)}
              </div>
            </div>
          </div>
        </div>

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
      </CardContent>
    </Card>
  );
}

// Risk & exit panel — the stop-distance meter + the risk/exit detail list.
function RiskExitPanel({ position }: { position: Position }) {
  const hasStop = Number(position.stopPrice ?? 0) > 0;
  // The stop-distance meter fills toward the stop: 0% distance = full (at the stop), further = less.
  const stopDist = Number(position.stopDistancePct ?? 0);
  const stopMeterPct = hasStop ? Math.max(4, Math.min(100, 100 - stopDist * 100 * 10)) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Risk &amp; exit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
        {/* Numeric readings share the StatTile grid; id/rule/flag stay a label↔value list below. */}
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border sm:grid-cols-3">
          <StatTile
            size="md"
            label="Risk at stop"
            value={position.riskAtStop ? `-${fmtUsd(position.riskAtStop)}` : '—'}
            tone={position.riskAtStop ? 'loss' : undefined}
          />
          <StatTile
            size="md"
            label="Stop distance"
            value={hasStop ? `${fmtPct(position.stopDistancePct)}` : '—'}
          />
          <StatTile
            size="md"
            label="Day P&L"
            value={fmtSignedUsd(position.dayPnl)}
            tone={Number(position.dayPnl ?? 0) >= 0 ? 'gain' : 'loss'}
          />
        </div>
        <dl className="space-y-1.5 text-sm">
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
        </dl>
      </CardContent>
    </Card>
  );
}

// Why-it's-held panel — the orders-derived owning strategy (a DISPLAY value only). Rendered only
// when an owning strategy is derivable, so the panel is never fabricated.
function WhyHeldPanel({
  position,
  owningStrategy,
}: {
  position: Position;
  owningStrategy: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Why it&apos;s held</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Held under <span className="font-mono">{owningStrategy}</span>
          {position.factor ? ` in the ${position.factor} factor bucket` : ''}
          {position.exitRule ? `; exits on ${position.exitRule}.` : '.'}
        </p>
        <Button asChild variant="ghost" size="sm" className="px-0">
          <Link href={`/insights/strategies/${owningStrategy}`}>Open {owningStrategy} →</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// Opportunity/conviction section for a watchlisted symbol. When no opportunity matches, an explicit
// no-data notice (never fabricated).
function OpportunitySection({
  opportunity,
  symbol,
}: {
  opportunity: Opportunity | undefined;
  symbol: string;
}) {
  // Edge (BT) — the strategy's backtested expectancy. Hook is called unconditionally (before the
  // early return) to satisfy the rules of hooks; it no-ops when there's no strategy.
  const { data: analytics } = useStrategyAnalytics(opportunity?.strategyId || undefined);
  if (!opportunity) {
    return <CardNotice>No current opportunity for {symbol}.</CardNotice>;
  }
  // conviction is a deterministic ordinal, NOT a probability — shown as a scaled number alongside
  // the authoritative "N/M conditions", never re-labeled as a % confidence.
  const conviction = Math.round(opportunity.conviction * 100);
  const validUntil = opportunity.validUntil?.seconds
    ? new Date(Number(opportunity.validUntil.seconds) * 1000).toTimeString().slice(0, 5)
    : null;
  const metaBits = [
    opportunity.strategyId || undefined,
    opportunity.source || undefined,
    validUntil ? `valid until ${validUntil}` : undefined,
  ].filter(Boolean);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Opportunity</CardTitle>
          <EnumBadge render={OPPORTUNITY_ACTION[opportunity.action]} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <Eyebrow>Conviction</Eyebrow>
            <span className="font-mono text-2xl tabular-nums text-buy">{conviction}</span>
          </div>
          <span className="text-sm text-muted-foreground">
            {opportunity.passingConditions}/{opportunity.totalConditions} conditions
          </span>
          {analytics && (
            <div className="ml-auto text-right">
              <Eyebrow>Edge (BT)</Eyebrow>
              <span
                className={`font-mono text-xl tabular-nums ${
                  analytics.expectancy >= 0 ? 'text-buy' : 'text-destructive'
                }`}
              >
                {analytics.expectancy >= 0 ? '+' : ''}
                {analytics.expectancy.toFixed(2)}
              </span>
            </div>
          )}
        </div>
        {opportunity.thesis && (
          <p className="text-sm text-muted-foreground">{opportunity.thesis}</p>
        )}
        {metaBits.length > 0 && (
          <p className="font-mono text-xs text-muted-foreground">{metaBits.join(' · ')}</p>
        )}
      </CardContent>
    </Card>
  );
}

// Fundamentals section — GetFundamentals ratios/metrics. A no-data symbol surfaces as an error, so
// ANY error renders the explicit no-data state (no fabricated 0s).
function FundamentalsSection({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useFundamentals(symbol);
  const f = data?.fundamentals;
  const rows: { label: string; value: string }[] = f
    ? [
        { label: 'Market cap', value: fmtUsd(f.marketCap) },
        { label: 'P/E', value: f.peRatio ? f.peRatio.toFixed(2) : '—' },
        { label: 'P/B', value: f.pbRatio ? f.pbRatio.toFixed(2) : '—' },
        { label: 'Div yield', value: f.dividendYield ? fmtPct(f.dividendYield) : '—' },
        { label: 'EPS', value: f.eps ? f.eps.toFixed(2) : '—' },
        { label: 'Beta', value: f.beta ? f.beta.toFixed(2) : '—' },
        { label: 'ROE', value: f.roe ? fmtPct(f.roe) : '—' },
        { label: 'Debt/Equity', value: f.debtToEquity ? f.debtToEquity.toFixed(2) : '—' },
      ]
    : [];
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Fundamentals</CardTitle>
          {f?.stale && (
            <Badge variant="secondary" className="text-[11px]">
              stale
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading fundamentals…</p>
        ) : error ? (
          <p className="text-sm text-muted-foreground">
            No fundamentals data for {symbol}
            {error instanceof ConnectError ? ` — ${error.rawMessage}` : ''}.
          </p>
        ) : (
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border sm:grid-cols-4">
            {rows.map((r) => (
              <StatTile key={r.label} size="md" label={r.label} value={r.value} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Backtests section — run history for the resolved strategy, client-side filtered to runs including
// this symbol, plus a "Run backtest" action. History-list only (per-run detail stays on strategies/[id]).
function BacktestsSection({
  symbol,
  strategyId,
  onStrategyChange,
}: {
  symbol: string;
  strategyId: string;
  onStrategyChange: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: history, isLoading } = useBacktestHistory(strategyId || undefined);
  const { mutate: runBacktest, isPending, data: runResult, error } = useRunBacktest();

  const runs = useMemo(
    () => (history?.runs ?? []).filter((r) => r.symbols.includes(symbol)),
    [history, symbol],
  );

  // No strategy selected → nothing to back-test against, but the picker is still offered so the user
  // can resolve one from here.
  if (!strategyId) {
    return (
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Backtests</CardTitle>
            <StrategyPicker
              value={strategyId}
              onChange={onStrategyChange}
              ariaLabel="Strategy for Backtests"
            />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No strategy resolves for {symbol} — pick a live strategy above, add it to a watchlist
            bound to a strategy, or place an order under one, to back-test it here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const errorMessage = error instanceof ConnectError ? error.rawMessage : (error?.message ?? null);

  function handleRun() {
    // Fixed default window/capital, matching the reference runner on /insights/strategies/[id].
    const isoToTimestamp = (iso: string) => {
      const ms = new Date(iso).getTime();
      return { seconds: BigInt(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1_000_000 };
    };
    runBacktest(
      {
        strategyIdRef: strategyId,
        symbols: [symbol],
        initialCapital: 100000,
        range: { start: isoToTimestamp('2024-01-01'), end: isoToTimestamp('2024-12-31') },
      },
      {
        onSuccess: () =>
          queryClient.invalidateQueries({ queryKey: ['analysis-backtests', strategyId] }),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Backtests</CardTitle>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{strategyId}</span>
            <StrategyPicker
              value={strategyId}
              onChange={onStrategyChange}
              ariaLabel="Strategy for Backtests"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={handleRun} disabled={isPending} data-testid="run-backtest">
            {isPending ? 'Running…' : 'Run backtest'}
          </Button>
          <span className="text-xs text-muted-foreground">
            {symbol} · 2024 · $100k — history covers this strategy&apos;s runs only.
          </span>
        </div>
        {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
        {/* A data-less symbol returns a successful RPC with status INSUFFICIENT_DATA + coverage_gaps,
            not an error — surface it inline and point at the Backfill panel to ingest the history. */}
        {runResult && runResult.status === BacktestStatus.INSUFFICIENT_DATA && (
          <div
            className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
            data-testid="backtest-insufficient"
          >
            <Badge variant="warning">Insufficient data</Badge>
            <span>
              No ingested history for {symbol} in this window
              {runResult.coverageGaps[0]
                ? ` — has ${runResult.coverageGaps[0].barsHave}, needs ${runResult.coverageGaps[0].barsNeed} bars`
                : ''}
              . Ingest it from the Backfill coverage panel, then re-run.
            </span>
          </div>
        )}
        {runResult && runResult.status === BacktestStatus.OK && (
          <p className="text-sm text-muted-foreground" data-testid="backtest-ok">
            Run complete — {((runResult.totalReturn ?? 0) * 100).toFixed(2)}% return over{' '}
            {runResult.totalTrades ?? 0} trade{(runResult.totalTrades ?? 0) === 1 ? '' : 's'}.
          </p>
        )}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading backtest history…</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="no-backtests">
            No backtests including {symbol} under {strategyId} yet.
          </p>
        ) : (
          <Table data-testid="backtests-table">
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Return</TableHead>
                <TableHead className="text-right">Sharpe</TableHead>
                <TableHead className="text-right">Trades</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const insufficient = run.status === BacktestStatus.INSUFFICIENT_DATA;
                return (
                  <TableRow key={run.backtestId} data-testid="backtest-row">
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {timestampToDate(run.completedAt)?.toLocaleDateString() ?? '—'}
                    </TableCell>
                    <TableCell>
                      {insufficient ? (
                        <Badge variant="warning">No data</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">OK</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${insufficient ? 'text-muted-foreground' : pnlClass(run.totalReturn ?? 0)}`}
                    >
                      {((run.totalReturn ?? 0) * 100).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {(run.sharpeRatio ?? 0).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {String(run.totalTrades ?? 0)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// Indicator overlay panels section — resolves the strategy (watchlist binding, else owning
// strategy) and charts its components. No strategy/zero components → no-data; RPC never fires empty.
function IndicatorSection({
  symbol,
  strategyId,
  onStrategyChange,
  closes,
  times,
  chartRef,
  containerRef,
}: {
  symbol: string;
  strategyId: string;
  onStrategyChange: (id: string) => void;
  closes: number[];
  times: IndicatorSeriesInput['times'];
  chartRef: React.RefObject<IChartApi | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { data: strategy, isLoading: strategyLoading } = useGetStrategy(strategyId || undefined);
  const hasComponents = (strategy?.components?.length ?? 0) > 0;
  // Only fire the series RPC once we know the resolved strategy actually has components to chart.
  const activeStrategyId = strategyId && hasComponents ? strategyId : '';
  const { data: series, isLoading: seriesLoading } = useIndicatorSeries({
    strategyId: activeStrategyId,
    symbol,
    closes,
    times,
  });

  // Stable Card shell: the "Indicators" title + strategy picker persist on every branch so the user
  // can select a strategy even from the empty / no-strategy state.
  const loading =
    (strategyId && strategyLoading) || (strategyId && hasComponents && (seriesLoading || !series));
  let body: React.ReactNode;
  if (loading) {
    body = <Skeleton className="h-40 w-full" data-testid="indicator-panels-loading" />;
  } else if (!strategyId || !hasComponents) {
    body = (
      <p className="text-sm text-muted-foreground" data-testid="indicator-panels-empty">
        {strategyId
          ? 'This strategy has no components to chart.'
          : `No strategy resolves for ${symbol} to chart indicators.`}
      </p>
    );
  } else {
    body = (
      <IndicatorPanels
        components={series!.components}
        times={times}
        chartRef={chartRef}
        containerRef={containerRef}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Indicators</CardTitle>
          <StrategyPicker
            value={strategyId}
            onChange={onStrategyChange}
            ariaLabel="Strategy for Indicators"
          />
        </div>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

// Backfill coverage section — the symbol's ingested OHLCV date span (dates only). Reduces completed
// jobs into one covered window; an empty job list is an explicit no-coverage state.
function BackfillSection({ symbol }: { symbol: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useBackfillJobs({ symbol });
  const { data: isAdmin } = useIsAdmin();
  const {
    mutate: triggerBackfill,
    isPending: triggerPending,
    error: triggerError,
  } = useTriggerBackfill();
  const jobs = data?.jobs ?? [];
  const completed = jobs.filter(
    (j) => j.status === BackfillStatus.COMPLETED && j.range?.start && j.range?.end,
  );
  // Any non-terminal job for this symbol means a backfill is already in flight — don't offer a
  // second trigger (matches the ingest server's own de-dup posture and keeps the panel honest).
  const inFlight = jobs.some(
    (j) => j.status === BackfillStatus.QUEUED || j.status === BackfillStatus.RUNNING,
  );
  let coverStart = Infinity;
  let coverEnd = -Infinity;
  for (const j of completed) {
    coverStart = Math.min(coverStart, Number(j.range!.start!.seconds));
    coverEnd = Math.max(coverEnd, Number(j.range!.end!.seconds));
  }
  const hasCoverage = completed.length > 0;
  const fmtDay = (secs: number) => new Date(secs * 1000).toISOString().slice(0, 10);

  // Full daily history for this symbol (daily is the only servable interval; omitting range = full
  // history). Admin-only; the BFF + ingest server re-check server-side.
  function handleTrigger() {
    triggerBackfill(
      {
        symbols: [symbol],
        timeframeEnum: TIMEFRAME_ENUM['1Day'],
        range: undefined,
        overwrite: false,
      },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: ['insights-backfill-jobs'] }) },
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Backfill coverage</CardTitle>
          {isAdmin && (
            <Button
              size="sm"
              onClick={handleTrigger}
              disabled={triggerPending || inFlight}
              data-testid="trigger-backfill"
            >
              {triggerPending ? 'Starting…' : inFlight ? 'Backfill running…' : 'Start backfill'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading ingested coverage…</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="no-backfill">
            No ingested coverage for {symbol} yet.
          </p>
        ) : hasCoverage ? (
          <p className="text-sm" data-testid="backfill-coverage">
            Ingested{' '}
            <span className="font-mono tabular-nums">
              {fmtDay(coverStart)} → {fmtDay(coverEnd)}
            </span>{' '}
            across {completed.length} completed job{completed.length > 1 ? 's' : ''}.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="backfill-pending">
            {jobs.length} backfill job{jobs.length > 1 ? 's' : ''} for {symbol} — none completed
            with a recorded range yet.
          </p>
        )}
        {isAdmin && !hasCoverage && !inFlight && (
          <p className="text-xs text-muted-foreground">Ingests full daily history for {symbol}.</p>
        )}
        {triggerError && (
          <p className="text-sm text-destructive" data-testid="trigger-backfill-error">
            {triggerError.message}
          </p>
        )}
      </CardContent>
    </Card>
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
