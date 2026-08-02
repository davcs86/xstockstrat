'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConnectError } from '@connectrpc/connect';
import { marketDataClient } from '@/lib/browserClients/marketDataClient';
import { type Timeframe, TIMEFRAMES, TIMEFRAME_ENUM, type Bar, mapBars } from '@/lib/chart';
import { useCandlestickChart } from '@/hooks/useCandlestickChart';
import { SignalReadiness } from '@/components/insights/SignalReadiness';
import { SignalOrderTicket } from '@/components/insights/SignalOrderTicket';
import { OPPORTUNITY_ACTION, EnumBadge } from '@/lib/opportunityShared';
import { useOpportunities, useStrategyAnalytics } from '@/hooks/useOpportunities';

/** `HH:MM` local time from a protobuf-es Timestamp ({ seconds: bigint }); null when unset. */
function validUntilLabel(validUntil: { seconds: bigint } | undefined): string | null {
  if (!validUntil || !validUntil.seconds) return null;
  return new Date(Number(validUntil.seconds) * 1000).toTimeString().slice(0, 5);
}

/** A right-aligned kicker stat (feature 083 — Signal-detail header CONVICTION / EDGE grammar). */
function HeaderStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="text-right">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
        {label}
      </div>
      <div className={`font-mono text-2xl tabular-nums leading-tight ${tone ?? 'text-foreground'}`}>
        {value}
      </div>
    </div>
  );
}

export default function MarketSymbolPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = (params?.symbol ?? '').toUpperCase();
  const searchParams = useSearchParams();
  const threadedStrategy = searchParams?.get('strategy') ?? '';

  const { containerRef, seriesRef } = useCandlestickChart(480);

  const [timeframe, setTimeframe] = useState<Timeframe>('1Day');
  const [bars, setBars] = useState<Bar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch bars on symbol/timeframe change
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    marketDataClient
      .getBars({
        symbol,
        timeframe,
        timeframeEnum: TIMEFRAME_ENUM[timeframe],
        page: { pageSize: 300 },
      })
      .then((res) => {
        if (cancelled) return;
        const sorted = mapBars(res.bars);
        setBars(sorted);
        if (seriesRef.current) seriesRef.current.setData(sorted);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ConnectError ? err.rawMessage : (err as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = bars[bars.length - 1];
  const prior = bars[bars.length - 2];
  const change = latest && prior ? latest.close - prior.close : 0;
  const changePct = latest && prior && prior.close ? (change / prior.close) * 100 : 0;

  // feature 083 — Signal-detail header enrichment. The market page is the generic symbol-detail
  // page reframed as the Decide → Signal detail; when this symbol is in the ranked queue we surface
  // the opportunity's action tag / conviction / thesis / expiry. No fabrication: when the symbol
  // is not in the queue (e.g. opened from Screener), the header degrades to symbol + price only.
  const { data: oppData } = useOpportunities(0);
  const opportunity = useMemo(() => {
    const matches = (oppData?.opportunities ?? []).filter((o) => o.symbol === symbol);
    // Prefer the opportunity for the threaded strategy, else the first (highest-conviction) match.
    return matches.find((o) => o.strategyId === threadedStrategy) ?? matches[0];
  }, [oppData, symbol, threadedStrategy]);

  // Strategy for the Edge (BT) stat + track record: the threaded one, else the opportunity's.
  const strategyId = threadedStrategy || opportunity?.strategyId || '';
  const { data: analytics } = useStrategyAnalytics(strategyId || undefined);

  const conviction = opportunity ? Math.round(opportunity.conviction * 100) : null;
  const validUntil = validUntilLabel(opportunity?.validUntil);
  // Meta line pieces (only real values are joined — no placeholders).
  const metaBits = [
    strategyId || undefined,
    opportunity?.source || undefined,
    validUntil ? `valid until ${validUntil}` : undefined,
  ].filter(Boolean);

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        {/* Signal-detail header (handoff: ← Queue · symbol + action + price · CONVICTION / EDGE). */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start gap-3">
              <Button variant="ghost" size="sm" asChild className="mt-0.5">
                <Link href="/insights/opportunities" className="flex items-center gap-1.5">
                  <ArrowLeft className="h-4 w-4" />
                  Queue
                </Link>
              </Button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-2xl font-mono">{symbol}</CardTitle>
                  {opportunity && <EnumBadge render={OPPORTUNITY_ACTION[opportunity.action]} />}
                  {latest && (
                    <span className="text-xl tabular-nums font-semibold font-mono">
                      {latest.close.toFixed(2)}
                    </span>
                  )}
                  {latest && prior && (
                    <span
                      className={`text-sm tabular-nums font-mono ${
                        change >= 0 ? 'text-buy' : 'text-destructive'
                      }`}
                    >
                      {change >= 0 ? '+' : ''}
                      {change.toFixed(2)} ({change >= 0 ? '+' : ''}
                      {changePct.toFixed(2)}%)
                    </span>
                  )}
                  {opportunity?.source && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {opportunity.source}
                    </span>
                  )}
                </div>
                {metaBits.length > 0 && (
                  <div className="mt-1.5 font-mono text-xs text-muted-foreground">
                    {metaBits.join(' · ')}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-6">
                {conviction !== null && (
                  <HeaderStat label="Conviction" value={String(conviction)} tone="text-buy" />
                )}
                {analytics && (
                  <HeaderStat
                    label="Edge (BT)"
                    value={`${analytics.expectancy >= 0 ? '+' : ''}${analytics.expectancy.toFixed(2)}`}
                    tone={analytics.expectancy >= 0 ? 'text-buy' : 'text-destructive'}
                  />
                )}
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* feature 083 — Signal detail (FR-6) two-column grammar: chart + "why this fired" on the
            left, the order ticket on the right. On narrow screens the columns stack; from lg they
            sit side-by-side. Both readiness/ticket read useSearchParams, so each is in a Suspense
            boundary. */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <CardTitle className="text-base">Price</CardTitle>
                  <div className="flex gap-1">
                    {TIMEFRAMES.map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => setTimeframe(value)}
                        className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                          timeframe === value
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {error && <p className="text-xs text-destructive mb-2">{error}</p>}
                {loading && bars.length === 0 && (
                  <p className="text-xs text-muted-foreground mb-2">Loading bars…</p>
                )}
                <div ref={containerRef} className="w-full" style={{ height: 480 }} />
                {!loading && !error && bars.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No bars available for {symbol} at this timeframe
                  </p>
                )}
              </CardContent>
            </Card>

            <Suspense fallback={<div className="h-24" />}>
              <SignalReadiness symbol={symbol} />
            </Suspense>
          </div>
          <div className="lg:col-span-1">
            <Suspense fallback={<div className="h-24" />}>
              <SignalOrderTicket symbol={symbol} />
            </Suspense>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
