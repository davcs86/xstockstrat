'use client';
import { useState } from 'react';
import { cn } from '@/components/ui/utils';
import { Badge } from '@/components/ui/badge';
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
import { isFiring, rollupReadiness } from '@/lib/readinessRollup';

type Readiness = NonNullable<Awaited<ReturnType<typeof useReadiness>>['data']>['readiness'][number];

const hasData = (r: Readiness) => r.totalConditions > 0;

/** Green = firing (all pass), paper = partway, sell = none pass, muted = no data (feature 083/097). */
function barClass(r: Readiness): string {
  if (!hasData(r)) return 'bg-muted-foreground/40';
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

/** Per-symbol state label: firing / N away / no data (an un-evaluable symbol, feature 097). */
function stateLabel(r: Readiness): string {
  if (!hasData(r)) return 'no data';
  if (isFiring(r)) return 'firing';
  return `${r.totalConditions - r.passingConditions} away`;
}

/**
 * Per-watchlist readiness overlay (feature 083, enriched by feature 097). Readiness is
 * strategy-scoped — the strategy is chosen explicitly (default none → no evaluation), never a
 * fabricated per-symbol binding. When chosen, EvaluateReadiness runs over the watchlist's symbols and
 * the view shows a ready/watching/quiet/no-data roll-up, a single "Evaluated against: <strategy>"
 * caption, and per-symbol rows (readiness bar + firing/N-away/no-data + blocking condition + an
 * "in queue" mark for symbols currently on the opportunity queue).
 */
export function WatchlistReadiness({
  symbols,
  inQueue,
}: {
  symbols: string[];
  inQueue?: Set<string>;
}) {
  const { data: defs } = useStrategyDefinitions();
  const strategies = defs?.definitions ?? [];
  const [strategyId, setStrategyId] = useState('');
  const { data } = useReadiness(strategyId, symbols);
  const readiness = data?.readiness ?? [];
  const evaluated = Boolean(strategyId) && readiness.length > 0;
  // Roll-up and the per-row states both derive from this ONE useReadiness result (C-10(b)); the
  // count is reconciled against the requested `symbols` set so it always sums to symbols.length.
  const counts = rollupReadiness(readiness, symbols);
  const strategyName =
    strategies.find((s) => s.strategyId === strategyId)?.displayName || strategyId;

  if (symbols.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-3" data-testid="watchlist-readiness">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Readiness — ranked by how close each name is to firing
          {evaluated && (
            <span className="ml-1" data-testid="readiness-rollup">
              · <span className="text-buy">{counts.ready} ready</span> · {counts.watching} watching
              · {counts.quiet} quiet
              {counts.nodata > 0 && <> · {counts.nodata} no-data</>}
            </span>
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
      {evaluated && (
        <>
          {/* Single caption — readiness is strategy-scoped, so the strategy is stated once, not
              repeated per row (which would visually imply a per-symbol binding — feature 083). */}
          <p className="mb-2 text-xs text-muted-foreground" data-testid="evaluated-against">
            Evaluated against: <span className="font-medium text-foreground">{strategyName}</span>
          </p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {[...readiness]
              .sort((a, b) => b.conviction - a.conviction)
              .map((r) => {
                const queued = inQueue?.has(r.symbol.toUpperCase()) ?? false;
                return (
                  <li key={r.symbol} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className="w-14 font-mono font-semibold">{r.symbol}</span>
                    {/* Signal-readiness bar (conviction) + firing / N-away / no-data state. */}
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
                          isFiring(r)
                            ? 'text-buy'
                            : hasData(r)
                              ? 'text-muted-foreground'
                              : 'text-muted-foreground/60',
                        )}
                      >
                        {stateLabel(r)}
                      </span>
                    </div>
                    {queued && (
                      <Badge variant="info" data-testid="in-queue">
                        in queue
                      </Badge>
                    )}
                    {/* Blocking condition — what's keeping it from firing. */}
                    <span className="ml-auto truncate font-mono text-muted-foreground">
                      {blockingCondition(r)}
                    </span>
                  </li>
                );
              })}
          </ul>
        </>
      )}
    </div>
  );
}
