'use client';

import { useEffect, useRef } from 'react';
import type { IChartApi } from 'lightweight-charts';
import { CHART_GRID_TOKEN, resolveChartColor } from '@/lib/chartColors';

/**
 * Creates a lightweight-charts **v5** candlestick chart inside the returned container ref and manages
 * its lifecycle (dynamic import, ResizeObserver, teardown). Single source of truth for the chart
 * setup shared by ChartPanel and the trader symbol page (DRY guard rail).
 *
 * Colors come from the theme `--chart-*` tokens via `resolveChartColor` (feature 146) — no hardcoded
 * hex. The fallbacks are CSS named colors, not brand hex, and are effectively unreachable: the chart
 * is created only client-side (useEffect) where the static dark-only tokens always resolve.
 *
 * Returns:
 * - `containerRef` — attach to the chart div.
 * - `seriesRef` — the candlestick series (pane 0); call `.setData(bars)` / `.createPriceLine(...)`.
 *   Left as `any` to preserve the existing consumer contract (callers pass plain-`number` bar times,
 *   not the branded `UTCTimestamp`).
 * - `chartRef` — the underlying v5 chart instance, so the symbol page can add native indicator
 *   **panes** to the SAME instance (shared time scale + one native crosshair, feature 146 Step 5).
 *   Null until the async chart is created and again after teardown.
 */
export function useCandlestickChart(height: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cleanup: (() => void) | undefined;

    import('lightweight-charts').then(({ createChart, CandlestickSeries }) => {
      if (!containerRef.current) return;
      const textColor = resolveChartColor('--muted-foreground', 'gray');
      const gridColor = resolveChartColor(CHART_GRID_TOKEN, 'gray');
      const borderColor = resolveChartColor('--border', 'gray');
      const upColor = resolveChartColor('--color-buy', 'green');
      const downColor = resolveChartColor('--color-sell', 'red');

      const chart = createChart(containerRef.current, {
        width: containerRef.current.offsetWidth,
        height,
        layout: { background: { color: 'transparent' }, textColor },
        grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
        crosshair: { mode: 1 },
        // A fixed minimum price-scale width keeps every pane's plot area left edge aligned once the
        // symbol page stacks indicator panes on this instance (feature 146 Step 5) — differing
        // y-label widths (price vs RSI vs MACD) would otherwise shift the left edge per pane.
        rightPriceScale: { borderColor, minimumWidth: 64 },
        timeScale: { borderColor, timeVisible: true },
      });
      chartRef.current = chart;
      // v5 API: addSeries(CandlestickSeries, …) — replaces v4 addCandlestickSeries.
      const series = chart.addSeries(CandlestickSeries, {
        upColor,
        downColor,
        borderVisible: false,
        wickUpColor: upColor,
        wickDownColor: downColor,
      });
      seriesRef.current = series;

      const ro = new ResizeObserver(() => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.offsetWidth });
      });
      ro.observe(containerRef.current);

      cleanup = () => {
        ro.disconnect();
        chart.remove();
        seriesRef.current = null;
        chartRef.current = null;
      };
    });

    return () => cleanup?.();
  }, [height]);

  return { containerRef, seriesRef, chartRef };
}
