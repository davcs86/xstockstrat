import type { SparklinePoint } from '@xstockstrat/proto/analysis/v1/analysis_pb';

/**
 * Compact sparkline over an Opportunity's recent daily closes. A point with an UNSET close
 * (warm-up/missing bar) renders a muted gap bar — never a NaN/0 spike. Shared, so keep it DRY.
 */
export function Sparkline({ points, testId }: { points: SparklinePoint[]; testId?: string }) {
  const closes = points.map((p) => (p.close === undefined ? null : p.close));
  const present = closes.filter((c): c is number => c !== null);
  const min = present.length ? Math.min(...present) : 0;
  const max = present.length ? Math.max(...present) : 1;
  const span = max - min || 1;
  return (
    <div className="flex h-8 items-end gap-px" data-testid={testId} aria-hidden>
      {closes.map((c, i) => {
        // Gap → a short muted stub; a present close → a bar whose height tracks the value.
        const pct = c === null ? 0 : Math.round(((c - min) / span) * 90) + 10;
        return (
          <span
            key={i}
            className={`w-1 rounded-sm ${c === null ? 'bg-muted' : 'bg-primary/60'}`}
            style={{ height: `${pct}%` }}
            data-gap={c === null ? '' : undefined}
          />
        );
      })}
    </div>
  );
}
