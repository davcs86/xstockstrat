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
import { useStrategyDefinitions } from '@/hooks/useStrategyDefinitions';
import { useReadiness } from '@/hooks/useOpportunities';

type SymbolReadiness = {
  symbol: string;
  passingConditions: number;
  totalConditions: number;
};

/** Green = all conditions pass, paper = some pass, sell = none (feature 083, FR-7). */
function dotClass(r: SymbolReadiness): string {
  if (r.totalConditions > 0 && r.passingConditions === r.totalConditions) return 'bg-buy';
  if (r.passingConditions > 0) return 'bg-paper';
  return 'bg-sell';
}

const isReady = (r: SymbolReadiness) =>
  r.totalConditions > 0 && r.passingConditions === r.totalConditions;

/**
 * Per-watchlist readiness overlay (feature 083, FR-7). Like Signal-detail, readiness is
 * strategy-scoped, so the strategy is chosen explicitly (default none → no evaluation). When
 * chosen, EvaluateReadiness runs over the watchlist's symbols and each renders a state dot +
 * "N/M conditions", with an "N ready" headline count.
 */
export function WatchlistReadiness({ symbols }: { symbols: string[] }) {
  const { data: defs } = useStrategyDefinitions();
  const strategies = defs?.definitions ?? [];
  const [strategyId, setStrategyId] = useState('');
  const { data } = useReadiness(strategyId, symbols);
  const readiness = (data?.readiness ?? []) as SymbolReadiness[];
  const readyCount = readiness.filter(isReady).length;

  if (symbols.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-3" data-testid="watchlist-readiness">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Readiness
          {strategyId && readiness.length > 0 && (
            <span className="ml-1 text-buy">— {readyCount} ready</span>
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
        <ul className="flex flex-wrap gap-2">
          {readiness.map((r) => (
            <li
              key={r.symbol}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"
            >
              <span className={cn('h-2 w-2 rounded-full', dotClass(r))} />
              <span className="font-mono">{r.symbol}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {r.passingConditions}/{r.totalConditions}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
