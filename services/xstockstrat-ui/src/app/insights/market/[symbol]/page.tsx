'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConnectError } from '@connectrpc/connect';
import { marketDataClient } from '@/lib/browserClients/marketDataClient';
import { type Timeframe, TIMEFRAMES, TIMEFRAME_ENUM, type Bar, mapBars } from '@/lib/chart';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCandlestickChart } from '@/hooks/useCandlestickChart';
import { SignalReadiness } from '@/components/insights/SignalReadiness';
import { SignalOrderTicket } from '@/components/insights/SignalOrderTicket';
import { OPPORTUNITY_ACTION, EnumBadge } from '@/lib/opportunityShared';
import { useOpportunities, useStrategyAnalytics } from '@/hooks/useOpportunities';
import { useStrategyDefinitions, useManageStrategy } from '@/hooks/useStrategyDefinitions';
import { StrategyOperation } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { Eyebrow } from '@/components/shared/Eyebrow';
import { PageBreadcrumb } from '@/components/shared/PageBreadcrumb';

/** `HH:MM` local time from a protobuf-es Timestamp ({ seconds: bigint }); null when unset. */
function validUntilLabel(validUntil: { seconds: bigint } | undefined): string | null {
  if (!validUntil || !validUntil.seconds) return null;
  return new Date(Number(validUntil.seconds) * 1000).toTimeString().slice(0, 5);
}

/** A right-aligned kicker stat (feature 083 — Signal-detail header CONVICTION / EDGE grammar). */
function HeaderStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="text-right">
      <Eyebrow>{label}</Eyebrow>
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
        {/* FR-10b: kept alongside the existing "← Queue" back-link below rather than replacing it
            — their labels ("Opportunities" vs "Queue") don't collide, and signal-detail.spec.ts
            already asserts a `Queue`-named link that a replacement would break. */}
        <PageBreadcrumb
          ariaLabel="Signal path"
          items={[{ label: 'Opportunities', href: '/insights/opportunities' }, { label: symbol }]}
        />
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
                    <Badge variant="outline" className="text-[11px] text-muted-foreground">
                      {opportunity.source}
                    </Badge>
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
                  <Tabs value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}>
                    <TabsList>
                      {TIMEFRAMES.map(({ value, label }) => (
                        <TabsTrigger key={value} value={value}>
                          {label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
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

            <MuteForStrategy symbol={symbol} />
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

/**
 * feature 132 — "mute this symbol for a strategy": pick one of the caller's own strategies and
 * append this symbol (uppercase) to its deny list via a MASKED manageStrategy update
 * (updateMask=['denied_symbols']) — the first UI exercise of the mask path, so it touches only the
 * deny list and never clobbers the rest of the definition. The strategy-definitions query is
 * invalidated on success (wired in useManageStrategy), so the "already muted" state reflects after
 * the write.
 */
function MuteForStrategy({ symbol }: { symbol: string }) {
  const { data } = useStrategyDefinitions(true);
  const { mutate, isPending } = useManageStrategy();
  const [picked, setPicked] = useState('');
  const definitions = data?.definitions ?? [];
  const chosen = definitions.find((s) => s.strategyId === picked);
  const alreadyDenied = chosen?.deniedSymbols?.includes(symbol) ?? false;

  function mute() {
    if (!chosen) return;
    const next = Array.from(new Set([...(chosen.deniedSymbols ?? []), symbol]));
    mutate({
      operation: StrategyOperation.UPDATE,
      definition: { strategyId: chosen.strategyId, deniedSymbols: next },
      updateMask: ['denied_symbols'],
    });
  }

  return (
    <Card data-testid="mute-for-strategy">
      <CardHeader>
        <CardTitle className="text-base">Mute {symbol} for a strategy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Adds {symbol} to the strategy&apos;s entry-only deny list — a held position still exits.
        </p>
        <div className="flex items-center gap-2">
          <select
            data-testid="mute-strategy-select"
            className="rounded border bg-background px-2 py-1 text-sm"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
          >
            <option value="">Select a strategy…</option>
            {definitions.map((s) => (
              <option key={s.strategyId} value={s.strategyId}>
                {s.displayName || s.strategyId}
                {s.deniedSymbols?.length ? ` (denies ${s.deniedSymbols.length})` : ''}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="secondary"
            data-testid="mute-submit"
            disabled={!chosen || alreadyDenied || isPending}
            onClick={mute}
          >
            {alreadyDenied ? 'Muted' : 'Mute'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
