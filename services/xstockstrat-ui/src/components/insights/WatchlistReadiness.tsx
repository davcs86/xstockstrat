'use client';
import { useState } from 'react';
import { cn } from '@/components/ui/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConditionState } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { useStrategyDefinitions } from '@/hooks/useStrategyDefinitions';
import { useReadiness } from '@/hooks/useOpportunities';

type Readiness = NonNullable<Awaited<ReturnType<typeof useReadiness>>['data']>['readiness'][number];

const isFiring = (r: Readiness) =>
  r.totalConditions > 0 && r.passingConditions === r.totalConditions;

/** Green = firing (all pass), paper = partway, sell = none pass (feature 083, FR-7). */
function barClass(r: Readiness): string {
  if (isFiring(r)) return 'bg-buy';
  if (r.passingConditions > 0) return 'bg-paper';
  return 'bg-sell';
}

/** The first not-yet-passing condition — what's holding the signal back. */
function blockingCondition(r: Readiness): string {
  const c = r.conditions.find((x) => x.state !== ConditionState.PASS);
  if (!c) return '—';
  return `${c.refName} ${c.fn} ${c.threshold.toFixed(2)}`;
}

/**
 * Per-watchlist readiness overlay (feature 083, FR-7). Like Signal-detail, readiness is
 * strategy-scoped, so the strategy is chosen explicitly (default none → no evaluation). When
 * chosen, EvaluateReadiness runs over the watchlist's symbols and each renders a readiness bar +
 * "firing / N away" state + the blocking condition, with an "N ready" headline count.
 */
export function WatchlistReadiness({ symbols }: { symbols: string[] }) {
  const { data: defs } = useStrategyDefinitions();
  const strategies = defs?.definitions ?? [];
  const [strategyId, setStrategyId] = useState('');
  const { data } = useReadiness(strategyId, symbols);
  const readiness = data?.readiness ?? [];
  const readyCount = readiness.filter(isFiring).length;

  if (symbols.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-3" data-testid="watchlist-readiness">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Readiness — ranked by how close each name is to firing
          {strategyId && readiness.length > 0 && (
            <span className="ml-1 text-buy">· {readyCount} ready</span>
          )}
        </span>
        <Select value={strategyId} onValueChange={setStrategyId}>
          <SelectTrigger className="h-7 w-48 text-xs" aria-label="Readiness strategy">
            <SelectValue placeholder="Evaluate against…" />
          </SelectTrigger>
          <SelectContent>
            {strategies.map((s) => (
              <SelectItem key={s.strategyId} value={s.strategyId}>
                {s.displayName || s.strategyId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {strategyId && readiness.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {[...readiness]
            .sort((a, b) => b.conviction - a.conviction)
            .map((r) => {
              const away = r.totalConditions - r.passingConditions;
              return (
                <li key={r.symbol} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span className="w-14 font-mono font-semibold">{r.symbol}</span>
                  {/* Signal-readiness bar (conviction) + firing / N-away state. */}
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full', barClass(r))}
                        style={{ width: `${Math.round(r.conviction * 100)}%` }}
                      />
                    </div>
                    <span
                      className={cn(
                        'w-16 font-mono tabular-nums',
                        isFiring(r) ? 'text-buy' : 'text-muted-foreground',
                      )}
                    >
                      {isFiring(r) ? 'firing' : `${away} away`}
                    </span>
                  </div>
                  {/* Blocking condition — what's keeping it from firing. */}
                  <span className="ml-auto truncate font-mono text-muted-foreground">
                    {blockingCondition(r)}
                  </span>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
