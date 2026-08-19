'use client';
import { useEffect } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { ComponentSeries } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { Eyebrow } from '@/components/shared/Eyebrow';
import { resolveChartColor } from '@/lib/chartColors';
import { toLineData } from '@/lib/indicatorChart';
import type { IndicatorSeriesInput } from '@/hooks/useIndicatorSeries';

// Indicator overlay panes (feature 146). Every chartable strategy component is drawn as its own
// native lightweight-charts v5 PANE on the SAME chart instance as the OHLCV candlestick (pane 0),
// so price + indicators share one time scale and one native crosshair — one coherent instrument,
// superseding the previous recharts card-per-panel. A component that failed to compute renders a DOM
// error strip and gets no pane (per-component fault isolation). Warm-up/gap points render as gaps,
// never a fabricated 0 (the src/lib/indicatorChart mapper; FR-3/AC-3). This component owns the
// imperative pane lifecycle on the shared chart and renders the DOM legend + error strips; the actual
// lines live in the price card's canvas above.

const PRICE_PANE_HEIGHT = 260;
const INDICATOR_PANE_HEIGHT = 120;
// Theme tokens per named sub-series; fallbacks are CSS named colors (no brand hex), unreachable
// client-side where the static dark tokens always resolve.
const SERIES_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'] as const;
const SERIES_FALLBACK = ['teal', 'slateblue', 'goldenrod', 'indianred', 'silver'] as const;

function isChartable(c: ComponentSeries): boolean {
  return !c.error && c.series.length > 0;
}

export function IndicatorPanels({
  components,
  times,
  chartRef,
  containerRef,
}: {
  components: ComponentSeries[];
  times: IndicatorSeriesInput['times'];
  chartRef: React.RefObject<IChartApi | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Draw one pane per chartable component on the shared chart. Disposal-safe: removes its own series
  // + panes and restores the price-only height on unmount / strategy switch — never calls into a
  // disposed chart (guarded), so re-resolving the strategy (IndicatorSection) can't crash the chart.
  useEffect(() => {
    let cancelled = false;
    // Capture the async-created chart/container the draw actually used, so cleanup operates on that
    // instance rather than reading a possibly-changed ref at teardown time.
    let usedChart: IChartApi | null = null;
    let usedContainer: HTMLDivElement | null = null;
    const added: ISeriesApi<'Line'>[] = [];
    const chartable = components.filter(isChartable);
    // The parity times are protobuf-es Timestamps ({ seconds: bigint }); the request-input type is
    // a wider union incl. undefined — narrow to the mapper's shape.
    const paneTimes = (times ?? []) as { seconds: bigint | number }[];

    import('lightweight-charts').then(({ LineSeries }) => {
      const draw = () => {
        if (cancelled) return;
        const chart = chartRef.current;
        const container = containerRef.current;
        if (!chart || !container) {
          // Chart is created asynchronously by useCandlestickChart — wait for it.
          requestAnimationFrame(draw);
          return;
        }
        usedChart = chart;
        usedContainer = container;
        const total = PRICE_PANE_HEIGHT + INDICATOR_PANE_HEIGHT * chartable.length;
        // Grow the shared canvas + its container so the panes have room. SymbolPriceChart declares
        // only `min-height`, so setting `height` here does not fight React's style reconciliation.
        container.style.height = `${total}px`;
        chart.resize(container.clientWidth, total);

        let paneIndex = 1;
        for (const comp of chartable) {
          comp.series.forEach((s, si) => {
            const color = resolveChartColor(SERIES_TOKENS[si % 5], SERIES_FALLBACK[si % 5]);
            const line = chart.addSeries(
              LineSeries,
              { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false },
              paneIndex,
            );
            line.setData(toLineData(s.values, paneTimes));
            added.push(line);
          });
          paneIndex++;
        }
        // Price pane taller than each indicator pane (stretch factors are relative weights).
        chart
          .panes()
          .forEach((p, i) =>
            p.setStretchFactor(i === 0 ? PRICE_PANE_HEIGHT : INDICATOR_PANE_HEIGHT),
          );
      };
      draw();
    });

    return () => {
      cancelled = true;
      const chart = usedChart;
      const container = usedContainer;
      if (!chart) return;
      try {
        for (const s of added) chart.removeSeries(s);
        const panes = chart.panes();
        for (let i = panes.length - 1; i >= 1; i--) chart.removePane(i);
        if (container) {
          container.style.height = `${PRICE_PANE_HEIGHT}px`;
          chart.resize(container.clientWidth, PRICE_PANE_HEIGHT);
        }
      } catch {
        // chart already disposed by useCandlestickChart teardown — nothing to clean up.
      }
    };
  }, [components, times, chartRef, containerRef]);

  if (components.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="indicator-panels">
      {components.map((comp) =>
        comp.error ? (
          <div key={comp.refName} className="space-y-1" data-testid="indicator-panel-error">
            <Eyebrow>{comp.refName}</Eyebrow>
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t compute this indicator — {comp.error}
            </p>
          </div>
        ) : (
          <div
            key={comp.refName}
            className="flex flex-wrap items-center gap-x-3 gap-y-1"
            data-testid="indicator-panel"
            data-series-count={comp.series.length}
            data-series={comp.series.map((s) => s.name).join(',')}
          >
            <Eyebrow>{comp.refName}</Eyebrow>
            {comp.series.map((s, si) => (
              <span
                key={s.name}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: `var(${SERIES_TOKENS[si % 5]})` }}
                />
                {s.name}
              </span>
            ))}
          </div>
        ),
      )}
    </div>
  );
}
