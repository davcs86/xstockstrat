'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConnectError } from '@connectrpc/connect';
import { marketDataClient } from '@/lib/browserClients';

type Timeframe = '10Min' | '30Min' | '1Hour' | '1Day' | '1Week' | '1Month';

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '10Min', label: '10m' },
  { value: '30Min', label: '30m' },
  { value: '1Hour', label: '1h' },
  { value: '1Day', label: '1d' },
  { value: '1Week', label: '1w' },
  { value: '1Month', label: '1mo' },
];

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export default function MarketSymbolPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = (params?.symbol ?? '').toUpperCase();

  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);

  const [timeframe, setTimeframe] = useState<Timeframe>('1Day');
  const [bars, setBars] = useState<Bar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create chart on mount
  useEffect(() => {
    if (!containerRef.current) return;
    let cleanup: (() => void) | undefined;

    import('lightweight-charts').then(({ createChart }) => {
      if (!containerRef.current) return;
      const chart = createChart(containerRef.current, {
        width: containerRef.current.offsetWidth,
        height: 480,
        layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
        grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: '#334155' },
        timeScale: { borderColor: '#334155', timeVisible: true },
      });
      // v4 API: addCandlestickSeries (v5 renamed this to addSeries(CandlestickSeries))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const series = (chart as any).addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });
      chartRef.current = chart;
      seriesRef.current = series;

      const ro = new ResizeObserver(() => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.offsetWidth });
      });
      ro.observe(containerRef.current);

      cleanup = () => {
        ro.disconnect();
        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
      };
    });

    return () => cleanup?.();
  }, []);

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
        const mapped: Bar[] = res.bars.map((b) => ({
          time: b.time ? Number(b.time.seconds) : 0,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: Number(b.volume),
        }));
        const sorted = mapped.sort((a, b) => a.time - b.time);
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
  }, [symbol, timeframe]);

  const latest = bars[bars.length - 1];
  const prior = bars[bars.length - 2];
  const change = latest && prior ? latest.close - prior.close : 0;
  const changePct = latest && prior && prior.close ? (change / prior.close) * 100 : 0;

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/" className="flex items-center gap-1.5">
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
