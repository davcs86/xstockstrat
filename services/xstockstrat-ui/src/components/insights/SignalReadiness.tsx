'use client';
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Eyebrow } from '@/components/shared/Eyebrow';
import { Progress } from '@/components/ui/progress';
import { ReadinessRule } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { CONDITION_STATE, EnumBadge } from '@/lib/opportunityShared';
import { READINESS_CUE } from '@/lib/readinessCue';
import { readinessState } from '@/lib/readinessRollup';
import { StrategyPicker } from '@/components/insights/StrategyPicker';
import { useOpportunities, useReadiness, useStrategyAnalytics } from '@/hooks/useOpportunities';

/**
 * Signal-detail readiness. Strategy is an EXPLICIT page-controlled input (via strategyId +
 * onStrategyChange); with none selected the panel prompts, never fabricating a signal→strategy binding.
 */
export function SignalReadiness({
  symbol,
  strategyId,
  onStrategyChange,
}: {
  symbol: string;
  strategyId: string;
  onStrategyChange: (id: string) => void;
}) {
  // Trace the EXIT rule when this (symbol, strategy) is a HELD opportunity (provenance includes
  // "position", the is_held marker), else the ENTRY rule.
  const { data: opps } = useOpportunities();
  const isHeld = useMemo(
    () =>
      (opps?.opportunities ?? []).some(
        (o) =>
          o.symbol === symbol && o.strategyId === strategyId && o.provenance.includes('position'),
      ),
    [opps, symbol, strategyId],
  );
  const rule = isHeld ? ReadinessRule.EXIT : ReadinessRule.ENTRY;
  const ruleWord = isHeld ? 'exit' : 'entry';

  const { data, isLoading, error, isNotFound } = useReadiness(
    strategyId,
    symbol ? [symbol] : [],
    rule,
  );
  const readiness = data?.readiness?.[0];
  // Strategy track record block.
  const { data: analytics } = useStrategyAnalytics(strategyId || undefined);

  return (
    <Card data-testid="signal-readiness">
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">Why this fired</CardTitle>
          <StrategyPicker
            value={strategyId}
            onChange={onStrategyChange}
            ariaLabel="Strategy for Why this fired"
          />
        </div>
      </CardHeader>
      <CardContent>
        {!strategyId ? (
          <p className="text-sm text-muted-foreground">
            Select a strategy to evaluate its conditions against {symbol}.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Evaluating conditions…</p>
        ) : isNotFound ? (
          <p className="text-sm text-muted-foreground">
            This strategy no longer exists — pick another.
          </p>
        ) : error ? (
          <p className="text-sm text-sell">Failed to evaluate readiness.</p>
        ) : !readiness || readiness.conditions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This strategy has no {ruleWord} conditions to evaluate.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Progress
                value={Math.round(readiness.conviction * 100)}
                className="h-2 w-40"
                variant="default"
              />
              <span className="font-mono tabular-nums text-sm">
                {readiness.passingConditions}/{readiness.totalConditions} conditions
              </span>
              {/* The same firing cue the Watchlists and Opportunities surfaces use when all pass. */}
              {readinessState(readiness) === 'firing' && (
                <EnumBadge render={READINESS_CUE.firing} testId="readiness-cue-firing" />
              )}
              {isHeld && (
                <span
                  data-testid="readiness-exit-rule"
                  className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  exit rule
                </span>
              )}
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

        {strategyId && analytics && (
          <div className="mt-4 border-t border-border pt-3" data-testid="strategy-track-record">
            <Eyebrow as="p" className="mb-2">
              Strategy track record
            </Eyebrow>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
              <Metric label="Signals 30d" value={String(analytics.signals30d)} />
              <Metric label="Taken" value={String(analytics.taken)} />
              <Metric label="Hit rate" value={`${(analytics.blendedHitRate * 100).toFixed(0)}%`} />
              <Metric
                label="Expectancy"
                value={analytics.expectancy.toFixed(2)}
                valueClass={analytics.expectancy >= 0 ? 'text-buy' : 'text-destructive'}
              />
            </dl>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={`font-mono tabular-nums ${valueClass ?? ''}`}>{value}</dd>
    </div>
  );
}
