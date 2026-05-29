'use client';

import { useEffect, useRef, useState } from 'react';
import { BASE_PATH } from '@/lib/basepath';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type Timeframe = '10Min' | '30Min' | '1Hour' | '1Day' | '1Week' | '1Month';
type BarCount = 50 | 100 | 200;

interface Bar {
  time: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '10Min',  label: '10m' },
  { value: '30Min',  label: '30m' },
  { value: '1Hour',  label: '1h'  },
  { value: '1Day',   label: '1d'  },
  { value: '1Week',  label: '1w'  },
  { value: '1Month', label: '1mo' },
];

// Intraday timeframes get auto-refresh; daily/weekly/monthly do not.
const POLL_INTERVALS_MS: Partial<Record<Timeframe, number>> = {
  '10Min': 120_000,
  '30Min': 300_000,
  '1Hour': 900_000,
};

export function ChartPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);

  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState<string>('');
  const [timeframe, setTimeframe] = useState<Timeframe>('1Day');
  const [barCount, setBarCount] = useState<BarCount>(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load symbol list on mount
  useEffect(() => {
    fetch(`${BASE_PATH}/api/chart`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        const list: string[] = data.symbols ?? [];
        setSymbols(list);
        if (list.length > 0) setSymbol(list[0]);
      })
      .catch(() => {/* symbol list unavailable — user can type manually */});
  }, []);

  // Create chart on mount
  useEffect(() => {
    if (!containerRef.current) return;

    let cleanup: (() => void) | undefined;

    import('lightweight-charts').then(({ createChart }) => {
      if (!containerRef.current) return;

      const chart = createChart(containerRef.current, {
        width: containerRef.current.offsetWidth,
        height: 320,
        layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
        grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: '#334155' },
        timeScale: { borderColor: '#334155', timeVisible: true },
      });

      // v4 API: addCandlestickSeries (v5 renamed this to addSeries(CandlestickSeries))
      const series = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });

      chartRef.current = chart;
      seriesRef.current = series;

      const resizeObserver = new ResizeObserver(() => {
        if (containerRef.current) {
          chart.applyOptions({ width: containerRef.current.offsetWidth });
        }
      });
      resizeObserver.observe(containerRef.current);

      cleanup = () => {
        resizeObserver.disconnect();
        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
      };
    });

    return () => cleanup?.();
  }, []);

  const fetchBars = async (sym: string, tf: Timeframe, count: BarCount) => {
    if (!sym || !seriesRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${BASE_PATH}/api/chart?symbol=${encodeURIComponent(sym)}&timeframe=${tf}&limit=${count}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load bars');
      const bars: Bar[] = (data.bars ?? []).sort((a: Bar, b: Bar) => a.time - b.time);
      seriesRef.current.setData(bars);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Re-fetch when symbol, timeframe, or barCount changes
  useEffect(() => {
    if (symbol) fetchBars(symbol, timeframe, barCount);
  }, [symbol, timeframe, barCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh for intraday timeframes only
  useEffect(() => {
    const interval = POLL_INTERVALS_MS[timeframe];
    if (!symbol || !interval) return;
    const id = setInterval(() => fetchBars(symbol, timeframe, barCount), interval);
    return () => clearInterval(id);
  }, [symbol, timeframe, barCount]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base mr-auto">Chart</CardTitle>

          {/* Symbol selector */}
          {symbols.length > 0 && (
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="w-28 h-7 text-xs">
                <SelectValue placeholder="Symbol" />
              </SelectTrigger>
              <SelectContent>
                {symbols.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Timeframe switcher */}
          <div className="flex gap-1">
            {TIMEFRAMES.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setTimeframe(value)}
                className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                  timeframe === value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Bar count selector */}
          <Select
            value={String(barCount)}
            onValueChange={(v) => setBarCount(Number(v) as BarCount)}
          >
            <SelectTrigger className="w-20 h-7 text-xs">
              <SelectValue>{barCount} bars</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {([50, 100, 200] as BarCount[]).map((n) => (
                <SelectItem key={n} value={String(n)}>{n} bars</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        {error && <p className="text-xs text-destructive mb-2">{error}</p>}
        {loading && !seriesRef.current && (
          <p className="text-xs text-muted-foreground mb-2">Loading…</p>
        )}
        <div ref={containerRef} className="w-full" style={{ height: 320 }} />
      </CardContent>
    </Card>
  );
}
