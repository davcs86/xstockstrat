'use client';

import { useEffect, useRef } from 'react';

/**
 * Creates a lightweight-charts candlestick chart inside the returned container ref and
 * manages its lifecycle (dynamic import, ResizeObserver, teardown). Single source of truth
 * for the chart setup shared by ChartPanel and the market-symbol page (DRY guard rail).
 *
 * Returns the container ref to attach to a div, and the series ref to call `.setData(bars)`.
 */
export function useCandlestickChart(height: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cleanup: (() => void) | undefined;

    import('lightweight-charts').then(({ createChart }) => {
      if (!containerRef.current) return;
      const chart = createChart(containerRef.current, {
        width: containerRef.current.offsetWidth,
        height,
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
      seriesRef.current = series;

      const ro = new ResizeObserver(() => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.offsetWidth });
      });
      ro.observe(containerRef.current);

      cleanup = () => {
        ro.disconnect();
        chart.remove();
        seriesRef.current = null;
      };
    });

    return () => cleanup?.();
  }, [height]);

  return { containerRef, seriesRef };
}
