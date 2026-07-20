'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConnectError } from '@connectrpc/connect';
import { marketDataClient } from '@/lib/browserClients/marketDataClient';
import { type Timeframe, TIMEFRAMES, type Bar, mapBars } from '@/lib/chart';
import { useCandlestickChart } from '@/hooks/useCandlestickChart';

export default function MarketSymbolPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = (params?.symbol ?? '').toUpperCase();

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
      .getBars({ symbol, timeframe, page: { pageSize: 300 } })
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

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/insights" className="flex items-center gap-1.5">
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-4">
                <CardTitle className="text-2xl font-mono">{symbol}</CardTitle>
                {latest && (
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl tabular-nums font-semibold">
                      ${latest.close.toFixed(2)}
                    </span>
                    <span
                      className={`text-sm tabular-nums ${
                        change >= 0 ? 'text-buy' : 'text-destructive'
                      }`}
                    >
                      {change >= 0 ? '+' : ''}
                      {change.toFixed(2)} ({change >= 0 ? '+' : ''}
                      {changePct.toFixed(2)}%)
                    </span>
                  </div>
                )}
              </div>
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
      </div>
    </AppShell>
  );
}
