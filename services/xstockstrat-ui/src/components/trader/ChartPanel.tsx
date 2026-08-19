'use client';

import { useEffect, useState } from 'react';
import { marketDataClient } from '@/lib/browserClients/marketDataClient';
import { ConnectError } from '@connectrpc/connect';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '../ui/combobox';
import { type Timeframe, TIMEFRAME_ENUM, mapBars } from '@/lib/chart';
import { useCandlestickChart } from '@/hooks/useCandlestickChart';

type BarCount = 50 | 100 | 200;

// feature 140: poll interval for the daily chart auto-refresh (ms). Since feature 143 fixed the
// view at 1d, a single interval suffices — no per-timeframe map.
const DAILY_POLL_MS = 300_000;

export function ChartPanel() {
  const { containerRef, seriesRef } = useCandlestickChart(320);

  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState<string>('');
  const timeframe: Timeframe = '1Day';
  const [barCount, setBarCount] = useState<BarCount>(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        timeframeEnum: TIMEFRAME_ENUM[tf],
        page: { pageSize: count },
      });
      seriesRef.current.setData(mapBars(res.bars));
    } catch (err) {
      setError(err instanceof ConnectError ? err.rawMessage : (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Re-fetch when symbol or barCount changes (timeframe is fixed at 1d)
  useEffect(() => {
    if (symbol) fetchBars(symbol, timeframe, barCount);
  }, [symbol, timeframe, barCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // feature 140: auto-refresh the daily chart on a bounded interval so new bars appear without a
  // manual reload. The backend serves the newest page (feature 140 FR-7), so a re-fetch reflects
  // any bar the always-on ingester has added since the last poll.
  useEffect(() => {
    if (!symbol) return;
    const id = setInterval(() => fetchBars(symbol, timeframe, barCount), DAILY_POLL_MS);
    return () => clearInterval(id);
  }, [symbol, barCount]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base mr-auto">Chart</CardTitle>

          {/* Symbol selector — type-ahead filter; only the top matches render,
              so the ~10k-symbol universe stays responsive. */}
          {symbols.length > 0 && (
            <Combobox
              items={symbols}
              value={symbol || null}
              onValueChange={(value) => setSymbol(value ?? '')}
              limit={50}
            >
              <ComboboxInput
                placeholder="Symbol"
                aria-label="Chart symbol"
                showTrigger={false}
                className="w-28 h-7 text-xs"
              />
              <ComboboxContent>
                <ComboboxEmpty>No matching symbols</ComboboxEmpty>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          )}

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
        <div
          ref={containerRef}
          data-testid="chart-container"
          className="w-full"
          style={{ height: 320 }}
        />
      </CardContent>
    </Card>
  );
}
