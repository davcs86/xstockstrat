'use client';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import type { ComponentSeries } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { Eyebrow } from '@/components/shared/Eyebrow';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

// Stacked indicator overlay panels beneath the price chart (feature 125, FR-6). One panel per
// declared strategy component; each draws every one of that component's named series as its own
// line (primary "value" + secondaries like bb.upper/macd.signal/stoch.d). A component that failed to
// compute (soft-deleted formula, sandbox error) renders a per-panel error state instead of a chart —
// per-component fault isolation surfaced to the UI. Built from the shadcn `chart` (recharts) wrapper.
// Each component renders as a bordered strip (not a nested Card) so the enclosing "Indicators" card
// reads as one framed unit, matching the single-Card price chart above it (UI-consistency pass).
const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

export function IndicatorPanels({ components }: { components: ComponentSeries[] }) {
  if (components.length === 0) return null;
  return (
    <div
      className="divide-y divide-border overflow-hidden rounded-md border border-border"
      data-testid="indicator-panels"
    >
      {components.map((comp) => (
        <IndicatorPanel key={comp.refName} comp={comp} />
      ))}
    </div>
  );
}

function IndicatorPanel({ comp }: { comp: ComponentSeries }) {
  if (comp.error) {
    return (
      <div className="space-y-1 p-3" data-testid="indicator-panel-error">
        <Eyebrow>{comp.refName}</Eyebrow>
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t compute this indicator — {comp.error}
        </p>
      </div>
    );
  }

  const config: ChartConfig = {};
  comp.series.forEach((s, i) => {
    config[s.name] = { label: s.name, color: SERIES_COLORS[i % SERIES_COLORS.length] };
  });

  const len = comp.series[0]?.values.length ?? 0;
  const data = Array.from({ length: len }, (_, i) => {
    const row: Record<string, number | null> = { i };
    for (const s of comp.series) {
      // An UNSET IndicatorValue (warm-up head / gap) has `value === undefined` → render a gap
      // (recharts null + connectNulls={false}), never a fabricated 0 (AC-4a/P-03). A genuine 0
      // reading has `value === 0` and is kept. `?? null` maps only undefined/null → gap.
      row[s.name] = s.values[i]?.value ?? null;
    }
    return row;
  });

  return (
    <div className="space-y-1 p-3" data-testid="indicator-panel">
      <Eyebrow>{comp.refName}</Eyebrow>
      <ChartContainer config={config} className="aspect-auto h-[140px] w-full">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="i" hide />
          <YAxis width={44} domain={['dataMin', 'dataMax']} tick={{ fontSize: 10 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {comp.series.map((s) => (
            <Line
              key={s.name}
              dataKey={s.name}
              type="monotone"
              stroke={`var(--color-${s.name})`}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  );
}
