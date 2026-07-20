'use client';

import { useEffect, useMemo, useState } from 'react';
import { marketDataClient } from '@/lib/browserClients/marketDataClient';
import { ConnectError } from '@connectrpc/connect';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Combobox, type ComboboxOption } from '../ui/combobox';
import { type Timeframe, TIMEFRAMES, mapBars } from '@/lib/chart';
import { useCandlestickChart } from '@/hooks/useCandlestickChart';

type BarCount = 50 | 100 | 200;

// Intraday timeframes get auto-refresh; daily does not.
const POLL_INTERVALS_MS: Partial<Record<Timeframe, number>> = {
  '15Min': 120_000,
  '1Hour': 900_000,
};

export function ChartPanel() {
  const { containerRef, seriesRef } = useCandlestickChart(320);

  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState<string>('');
  const [timeframe, setTimeframe] = useState<Timeframe>('1Day');
  const [barCount, setBarCount] = useState<BarCount>(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The tradable US-equity universe is ~10k symbols; map once so the picker
  // isn't rebuilding option objects on every keystroke/render.
  const symbolOptions = useMemo<ComboboxOption[]>(
    () => symbols.map((s) => ({ value: s })),
    [symbols],
  );

  // Load symbol list on mount
  useEffect(() => {
    marketDataClient
      .listAssets({ assetClass: 'us_equity', tradableOnly: true })
      .then((res) => {
        const list = res.assets.map((a) => a.symbol).filter(Boolean);
        setSymbols(list);
        if (list.length > 0) setSymbol(list[0]);
      })
      .catch(() => {
        /* symbol list unavailable — user can type manually */
      });
  }, []);

  const fetchBars = async (sym: string, tf: Timeframe, count: BarCount) => {
    if (!sym || !seriesRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const res = await marketDataClient.getBars({
        symbol: sym,
        timeframe: tf,
        page: { pageSize: count },
      });
      seriesRef.current.setData(mapBars(res.bars));
    } catch (err) {
      setError(err instanceof ConnectError ? err.rawMessage : (err as Error).message);
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

          {/* Symbol selector — type-ahead filter; only the top matches render,
              so the ~10k-symbol universe stays responsive. */}
          {symbols.length > 0 && (
            <Combobox
              value={symbol}
              onChange={setSymbol}
              options={symbolOptions}
              maxResults={50}
              placeholder="Symbol"
              aria-label="Chart symbol"
              className="w-28"
              inputClassName="h-7 text-xs"
            />
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
                <SelectItem key={n} value={String(n)}>
                  {n} bars
                </SelectItem>
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
