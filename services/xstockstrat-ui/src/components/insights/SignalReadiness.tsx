'use client';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Eyebrow } from '@/components/shared/Eyebrow';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ReadinessRule } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { CONDITION_STATE, EnumBadge } from '@/lib/opportunityShared';
import { useStrategyDefinitions } from '@/hooks/useStrategyDefinitions';
import { useOpportunities, useReadiness, useStrategyAnalytics } from '@/hooks/useOpportunities';

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
  // Only strategies actually eligible to trade live are selectable here — `active` alone (the
  // fetch default) also admits paused/never-enabled strategies, which would be misleading to
  // evaluate readiness against.
  const strategies = useMemo(() => (defs?.definitions ?? []).filter((s) => s.liveEnabled), [defs]);
  // Strategy threaded from the opportunity row (?strategy=), else chosen from the picker.
  const [strategyId, setStrategyId] = useState(searchParams?.get('strategy') ?? '');

  // feature 138 — trace the EXIT rule when this (symbol, strategy) is a HELD opportunity, so the
  // panel explains the exit rule that actually fired (matching the header's exit-derived
  // conviction) instead of the entry rule. "position" in the queue row's provenance is exactly the
  // `is_held` marker _compute_opportunities used to pick rule="exit", so the two always agree; a
  // non-held / picked-elsewhere strategy has no such row → entry rule (unchanged).
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

  const { data, isLoading, error } = useReadiness(strategyId, symbol ? [symbol] : [], rule);
  const readiness = data?.readiness?.[0];
  // Strategy track record (feature 083 — the handoff's Signal-detail track-record block).
  const { data: analytics } = useStrategyAnalytics(strategyId || undefined);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">Why this fired</CardTitle>
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
            Select a strategy to evaluate its conditions against {symbol}.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Evaluating conditions…</p>
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
