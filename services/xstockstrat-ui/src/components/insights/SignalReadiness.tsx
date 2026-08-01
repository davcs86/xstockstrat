'use client';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CONDITION_STATE, EnumBadge } from '@/lib/opportunityShared';
import { useStrategyDefinitions } from '@/hooks/useStrategyDefinitions';
import { useReadiness } from '@/hooks/useOpportunities';

/**
 * Signal-detail readiness (feature 083, FR-6). EvaluateReadiness is strategy-scoped, so the
 * strategy is an EXPLICIT input — threaded from the opportunity row (`?strategy=`) when present,
 * otherwise chosen from a picker. No fabricated signal→strategy binding: with no strategy
 * selected the panel prompts instead of guessing. Renders the traced PASS/SOFT/FAIL leaves +
 * distance-to-threshold and the deterministic "N/M conditions" conviction.
 */
export function SignalReadiness({ symbol }: { symbol: string }) {
  const searchParams = useSearchParams();
  const { data: defs } = useStrategyDefinitions();
  const strategies = useMemo(() => defs?.definitions ?? [], [defs]);
  // Strategy threaded from the opportunity row (?strategy=), else chosen from the picker.
  const [strategyId, setStrategyId] = useState(searchParams?.get('strategy') ?? '');

  const { data, isLoading, error } = useReadiness(strategyId, symbol ? [symbol] : []);
  const readiness = data?.readiness?.[0];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">Readiness</CardTitle>
          <Select value={strategyId} onValueChange={setStrategyId}>
            <SelectTrigger className="h-8 w-56" aria-label="Strategy">
              <SelectValue placeholder="Select a strategy…" />
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
      </CardHeader>
      <CardContent>
        {!strategyId ? (
          <p className="text-sm text-muted-foreground">
            Select a strategy to evaluate its entry conditions against {symbol}.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Evaluating conditions…</p>
        ) : error ? (
          <p className="text-sm text-sell">Failed to evaluate readiness.</p>
        ) : !readiness || readiness.conditions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This strategy has no entry conditions to evaluate.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-2 w-40 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.round(readiness.conviction * 100)}%` }}
                />
              </div>
              <span className="font-mono tabular-nums text-sm">
                {readiness.passingConditions}/{readiness.totalConditions} conditions
              </span>
            </div>
            <ul className="divide-y divide-border rounded-md border border-border">
              {readiness.conditions.map((c, i) => (
                <li key={`${c.refName}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <EnumBadge render={CONDITION_STATE[c.state]} />
                  <span className="font-mono">
                    {c.refName} {c.fn}{' '}
                    <span className="tabular-nums">{c.threshold.toFixed(2)}</span>
                  </span>
                  <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                    {c.lhsValue.toFixed(2)}
                  </span>
                  <span
                    className={`w-16 text-right font-mono tabular-nums text-xs ${
                      c.distanceToThreshold >= 0 ? 'text-buy' : 'text-sell'
                    }`}
                  >
                    {c.distanceToThreshold >= 0 ? '+' : ''}
                    {(c.distanceToThreshold * 100).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
